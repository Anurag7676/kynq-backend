// Tickets: KYNQ-101 keys · Backlog → Todo → In progress → In review → Done (or Cancelled)
// priority Urgent/High/Medium/Low · labels · due date · attachments · comments · activity.
// "Blocked" is a flag with a reason (a ticket can be in progress AND blocked).
//
// Who sees and changes what (enforced here, on every call):
//   everyone on the team sees every ticket (so people know what the others are working on)
//   and can comment on any of them.
//   owner  — changes anything; the only one who can import, reassign, share, plan sprints, or
//            set priority and due dates on tickets they didn't create.
//   member — changes tickets assigned to them or created by them. "Shared with" (watchers: the
//            founder shared it, or someone @mentioned them) means they follow its updates.
//
// Concurrent edits: every ticket has a `version`. A client may send the version it last saw;
// if someone else changed the ticket meanwhile the update is refused with a conflict.
import crypto from "node:crypto";
import { col } from "../util.js";
import { logAudit } from "../audit.js";
import { roster, resolveMember, isOwner, forbid, bad, missing, conflict } from "./team.js";
import { notify } from "./notify.js";
import { assignableSprint, sprintMove, activeSprint, activeSummary } from "./sprints.js";
import { TICKETS, COMMENTS, COUNTERS, IMPORTS, SPRINTS, STATUSES, OPEN_STATUSES, PRIORITIES, KEY_PREFIX, today, weekStartTs, strip } from "./store.js";

export { STATUSES, OPEN_STATUSES, PRIORITIES };
export const IMPORT_LIMITS = { maxTickets: 100, maxBytes: 200_000 };

const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const str = (v, max, field, required = false) => {
  const s = String(v ?? "").trim();
  if (required && !s) bad(`${field} is required`);
  if (s.length > max) bad(`${field} is too long (max ${max} characters)`);
  return s || null;
};

// ─── Setup + migration of old Founder OS tasks (idempotent) ───
let ready = null;
export function ensureTickets() {
  return (ready ??= (async () => {
    await Promise.all([
      col(TICKETS).createIndex({ id: 1 }, { unique: true }),
      col(TICKETS).createIndex({ key: 1 }, { unique: true, partialFilterExpression: { key: { $type: "string" } } }),
      col(TICKETS).createIndex({ owner: 1, status: 1, dueDate: 1 }),
      col(TICKETS).createIndex({ status: 1, dueDate: 1 }),
      col(TICKETS).createIndex({ watchers: 1 }),
      col(TICKETS).createIndex({ createdBy: 1 }),
      col(TICKETS).createIndex({ updatedAt: -1 }),
      col(TICKETS).createIndex({ completedAt: -1 }),
      col(COMMENTS).createIndex({ id: 1 }, { unique: true }),
      col(COMMENTS).createIndex({ ticketId: 1, createdAt: 1 }),
      col(IMPORTS).createIndex({ key: 1 }, { unique: true }),
    ]);
    await migrate();
  })().catch((err) => { ready = null; throw err; }));
}

/** Old statuses/priorities → new ones, defaults for new fields, keys, and comments out of history. */
export async function migrate() {
  await col(TICKETS).updateMany({ status: "blocked" }, { $set: { status: "in_progress", blocked: true } });
  await col(TICKETS).updateMany({ priority: "normal" }, { $set: { priority: "medium" } });
  await col(TICKETS).updateMany({ labels: { $exists: false } }, { $set: { labels: [] } });
  await col(TICKETS).updateMany({ attachments: { $exists: false } }, { $set: { attachments: [] } });
  await col(TICKETS).updateMany({ watchers: { $exists: false } }, { $set: { watchers: [] } });
  await col(TICKETS).updateMany({ blocked: { $exists: false } }, { $set: { blocked: false } });
  await col(TICKETS).updateMany({ version: { $exists: false } }, { $set: { version: 0 } });
  await col(TICKETS).updateMany({ history: { $exists: false } }, { $set: { history: [] } });
  // Sprints: "backlog" used to be a status; now the backlog is "not in a sprint".
  await col(TICKETS).updateMany({ status: "backlog" }, { $set: { status: "todo" } });
  await col(TICKETS).updateMany({ sprintId: { $exists: false } }, { $set: { sprintId: null, sprints: [] } });
  const unkeyed = await col(TICKETS).find({ key: { $exists: false } }, { projection: { id: 1 } }).sort({ createdAt: 1 }).toArray();
  if (unkeyed.length) {
    const first = await reserveKeys(unkeyed.length);
    for (let i = 0; i < unkeyed.length; i++) await col(TICKETS).updateOne({ id: unkeyed[i].id, key: { $exists: false } }, { $set: { key: `${KEY_PREFIX}-${first + i}` } });
  }
  const withComments = await col(TICKETS).find({ "history.type": "comment" }, { projection: { id: 1, history: 1 } }).toArray();
  for (const t of withComments) {
    for (const [i, h] of t.history.filter((x) => x.type === "comment").entries()) {
      const id = `cmt_m_${t.id}_${i}_${h.at}`;
      await col(COMMENTS).updateOne({ id }, { $setOnInsert: { id, ticketId: t.id, author: h.by, body: String(h.text ?? ""), parentId: null, mentions: [], createdAt: h.at, editedAt: null, deletedAt: null } }, { upsert: true });
    }
    await col(TICKETS).updateOne({ id: t.id }, { $pull: { history: { type: "comment" } } });
  }
}

/** Reserves n consecutive ticket numbers in one atomic step; returns the first. Starts at 101. */
async function reserveKeys(n) {
  const r = await col(COUNTERS).findOneAndUpdate({ _id: "ticket" }, { $inc: { seq: n } }, { upsert: true, returnDocument: "after" });
  const seq = (r?.value ?? r)?.seq ?? n;
  return 100 + seq - n + 1;
}

// ─── Access ───
// Every console admin is on the Tasks team, and the team sees every ticket.
export const canView = (_t, admin) => !!admin?.email;
export const canEdit = (t, admin) => isOwner(admin) || t.owner === admin.email || t.createdBy === admin.email;
/** Priority, due date and assignee: the founder, or the creator of the ticket. */
const canPlan = (t, admin) => isOwner(admin) || t.createdBy === admin.email;
const visibleFilter = () => ({});

// ─── Validation ───
function cleanLabels(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) bad("labels must be a list");
  const out = [...new Set(v.map((l) => String(l).trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
  if (out.length > 8) bad("at most 8 labels");
  if (out.some((l) => l.length > 32 || !/^[a-z0-9][a-z0-9_-]*$/.test(l))) bad("labels can use letters, numbers, - and _ (max 32 characters)");
  return out;
}
/** Shared by create, update and JSON import. `partial` = only validate fields present. */
export function cleanTicketFields(b, partial) {
  const out = {};
  const has = (k) => b[k] !== undefined;
  if (!partial || has("title")) out.title = str(b.title, 200, "title", true);
  if (has("description")) out.description = str(b.description, 10_000, "description");
  if (!partial || has("priority")) { const p = b.priority ?? "medium"; if (!PRIORITIES.includes(p)) bad(`priority must be one of ${PRIORITIES.join(", ")}`); out.priority = p; }
  if (has("status")) {
    const st = b.status === "backlog" ? "todo" : b.status; // old status name: the backlog is now "not in a sprint"
    if (!STATUSES.includes(st)) bad(`status must be one of ${STATUSES.join(", ")}`); out.status = st;
  }
  if (has("dueDate")) { if (b.dueDate !== null && b.dueDate !== "" && !isDay(b.dueDate)) bad("dueDate must be YYYY-MM-DD"); out.dueDate = b.dueDate || null; }
  if (has("labels")) out.labels = cleanLabels(b.labels);
  if (has("blocked")) out.blocked = !!b.blocked;
  if (has("blockerReason")) out.blockerReason = str(b.blockerReason, 400, "blocker reason");
  return out;
}

// ─── Create / read / update / delete ───
function newTicketDoc(fields, { owner, createdBy, key, now }) {
  const status = fields.status ?? "todo";
  return {
    id: `tsk_${crypto.randomBytes(6).toString("hex")}`, key,
    title: fields.title, description: fields.description ?? null,
    owner: owner ?? null, priority: fields.priority ?? "medium", status,
    dueDate: fields.dueDate ?? null, labels: fields.labels ?? [], attachments: [], watchers: [],
    sprintId: fields.sprintId ?? null, sprints: fields.sprintId ? [{ id: fields.sprintId, addedAt: now, removedAt: null, result: null }] : [],
    blocked: false, blockerReason: null,
    createdBy, createdAt: now, updatedAt: now, completedAt: status === "done" ? now : null, version: 0,
    history: [{ at: now, by: createdBy, type: "created" }],
  };
}

export async function createTicket(body, admin) {
  await ensureTickets();
  const b = body ?? {};
  const fields = cleanTicketFields(b, false);
  const requested = b.owner === undefined ? admin.email : b.owner;
  const owner = requested === null || requested === "" ? null : await resolveMember(requested);
  if (!isOwner(admin) && owner !== admin.email) forbid("Only the founder can assign tickets to someone else.");
  if (b.sprintId) {
    if (!isOwner(admin)) forbid("Only the founder plans sprints.");
    fields.sprintId = (await assignableSprint(b.sprintId)).id;
  }
  const doc = newTicketDoc(fields, { owner, createdBy: admin.email, key: `${KEY_PREFIX}-${await reserveKeys(1)}`, now: Date.now() });
  await col(TICKETS).insertOne(doc);
  await logAudit(admin.email, "tasks.ticket.create", doc.key, { owner, title: doc.title });
  await notify({ type: "assigned", recipients: [owner], ticket: doc, actor: admin.email, dedupe: `${doc.id}:0` });
  return strip(doc);
}

async function findTicket(idOrKey) {
  const k = String(idOrKey ?? "");
  const t = await col(TICKETS).findOne(/^[A-Z]+-\d+$/i.test(k) ? { key: k.toUpperCase() } : { id: k });
  if (!t) missing("ticket not found");
  return t;
}
/** For other modules (attachments): the ticket if this person may see it. */
export async function visibleTicket(idOrKey, admin) {
  await ensureTickets();
  const t = await findTicket(idOrKey);
  if (!canView(t, admin)) missing("ticket not found");
  return t;
}

export async function getTicket(idOrKey, admin) {
  const t = await visibleTicket(idOrKey, admin);
  const comments = await col(COMMENTS).find({ ticketId: t.id }).sort({ createdAt: 1 }).toArray();
  return { ...strip(t), canEdit: canEdit(t, admin), canPlan: canPlan(t, admin), comments: comments.map((c) => publicComment(c, admin)) };
}

const TRACKED = { owner: "assignee", status: "status", priority: "priority", dueDate: "due date", labels: "labels", blocked: "blocked", watchers: "shared with" };
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function updateTicket(idOrKey, body, admin) {
  const t = await visibleTicket(idOrKey, admin);
  if (!canEdit(t, admin)) forbid("You can only change tickets you're assigned to or created. You can still comment.");
  const b = body ?? {};
  if (b.version !== undefined && b.version !== null && Number(b.version) !== (t.version ?? 0)) conflict(`${t.key} was just changed by someone else. Reload to see the latest.`);
  const set = cleanTicketFields(b, true);
  const now = Date.now();
  if (b.owner !== undefined) {
    set.owner = b.owner === null || b.owner === "" ? null : await resolveMember(b.owner);
    if (set.owner !== t.owner && !canPlan(t, admin)) forbid("Only the founder can reassign this ticket.");
    if (set.owner !== t.owner && !isOwner(admin) && set.owner !== admin.email && set.owner !== null) forbid("Only the founder can assign tickets to someone else.");
  }
  if (b.watchers !== undefined) {
    if (!isOwner(admin)) forbid("Only the founder can share tickets.");
    if (!Array.isArray(b.watchers) || b.watchers.length > 20) bad("share with a list of up to 20 people");
    const team = await roster();
    set.watchers = [...new Set(await Promise.all(b.watchers.map((w) => resolveMember(w, team))))];
  }
  let sprintPart = null, sprintEvent = null;
  if (b.sprintId !== undefined && (b.sprintId || null) !== (t.sprintId ?? null)) {
    if (!isOwner(admin)) forbid("Only the founder plans sprints.");
    const target = await assignableSprint(b.sprintId || null);
    sprintPart = sprintMove(t, target?.id ?? null, Date.now());
    const from = t.sprintId ? (await col(SPRINTS).findOne({ id: t.sprintId }))?.name ?? "a sprint" : "Backlog";
    sprintEvent = { type: "sprint", from, to: target?.name ?? "Backlog" };
  }
  for (const k of ["priority", "dueDate"]) if (set[k] !== undefined && !same(set[k], t[k]) && !canPlan(t, admin)) forbid("Only the founder can change the priority or due date of this ticket.");
  if (set.blocked === true && !(set.blockerReason ?? t.blockerReason)) bad("say what's blocking it");
  if (set.blocked === false && b.blockerReason === undefined) set.blockerReason = null;
  if (set.status && set.status !== t.status) set.completedAt = set.status === "done" ? now : null;

  const events = [];
  for (const [k, label] of Object.entries(TRACKED)) {
    if (set[k] === undefined || same(set[k], t[k] ?? (k === "labels" || k === "watchers" ? [] : null))) continue;
    events.push({ at: now, by: admin.email, type: k === "owner" ? "assigned" : k === "watchers" ? "shared" : k, field: label, from: t[k] ?? null, to: set[k], ...(k === "blocked" && set[k] ? { text: set.blockerReason ?? t.blockerReason } : {}) });
  }
  if (sprintEvent) events.push({ at: now, by: admin.email, ...sprintEvent });
  const edited = ["title", "description"].filter((k) => set[k] !== undefined && !same(set[k], t[k]));
  if (edited.length) events.push({ at: now, by: admin.email, type: "edited", text: edited.join(", ") });
  if (sprintPart) Object.assign(set, sprintPart);
  if (!events.length && Object.keys(set).every((k) => same(set[k], t[k]))) return getTicket(t.id, admin);

  const version = (t.version ?? 0) + 1;
  const r = await col(TICKETS).updateOne({ id: t.id, version: t.version ?? 0 }, { $set: { ...set, updatedAt: now, version }, ...(events.length ? { $push: { history: { $each: events, $slice: -300 } } } : {}) });
  if (!r.matchedCount) conflict(`${t.key} was just changed by someone else. Reload to see the latest.`);
  await logAudit(admin.email, "tasks.ticket.update", t.key, { changes: events.map((e) => e.type) });

  // Notifications for what changed.
  const after = { ...t, ...set };
  const dedupe = `${t.id}:${version}`;
  if (set.owner !== undefined && set.owner !== t.owner) {
    await notify({ type: "assigned", recipients: [set.owner], ticket: after, actor: admin.email, dedupe });
    const toName = set.owner ? (await roster()).find((m) => m.email === set.owner)?.name ?? set.owner : "nobody";
    await notify({ type: "reassigned", recipients: [t.owner], ticket: after, actor: admin.email, text: `Now assigned to ${toName}`, dedupe });
  }
  if (set.status && set.status !== t.status) {
    if (set.status === "in_review") await notify({ type: "in_review", recipients: [t.createdBy, ...(await roster()).filter((m) => m.isOwner).map((m) => m.email)], ticket: after, actor: admin.email, dedupe });
    if (["done", "cancelled"].includes(t.status) && OPEN_STATUSES.includes(set.status)) await notify({ type: "reopened", recipients: [after.owner, t.createdBy], ticket: after, actor: admin.email, dedupe });
  }
  return getTicket(t.id, admin);
}

export async function deleteTicket(idOrKey, admin) {
  const t = await visibleTicket(idOrKey, admin);
  if (!isOwner(admin) && t.createdBy !== admin.email) forbid("Only the founder or the ticket's creator can delete it.");
  await col(TICKETS).deleteOne({ id: t.id });
  await col(COMMENTS).deleteMany({ ticketId: t.id });
  await logAudit(admin.email, "tasks.ticket.delete", t.key, { title: t.title });
  return { id: t.id, key: t.key };
}

/**
 * Filters: view mine|all · status (comma list, or "open"/"closed") · assignee (email | "none")
 * · priority (comma list) · label · flag overdue|blocked|unassigned|due_today|review|done_week
 * · q (key/title/description) · sort updated|created|due|priority · limit (≤ 500) · offset.
 */
export async function listTickets(query = {}, admin) {
  await ensureTickets();
  const d = today();
  const and = [visibleFilter(admin)];
  if (query.view === "mine") and.push({ owner: admin.email });
  const statuses = String(query.status ?? "").split(",").filter(Boolean);
  if (statuses[0] === "open") and.push({ status: { $in: OPEN_STATUSES } });
  else if (statuses[0] === "closed") and.push({ status: { $in: ["done", "cancelled"] } });
  else if (statuses.length) and.push({ status: { $in: statuses.filter((s) => STATUSES.includes(s)) } });
  if (query.assignee === "none") and.push({ owner: null });
  else if (query.assignee) and.push({ owner: String(query.assignee).toLowerCase() });
  const pr = String(query.priority ?? "").split(",").filter((p) => PRIORITIES.includes(p));
  if (pr.length) and.push({ priority: { $in: pr } });
  if (query.label) and.push({ labels: String(query.label).toLowerCase() });
  if (query.sprint === "none" || query.sprint === "backlog") and.push({ sprintId: null });
  else if (query.sprint === "active") { const a = await activeSprint(); and.push({ sprintId: a?.id ?? "__none__" }); }
  else if (query.sprint) and.push({ sprintId: String(query.sprint) });
  const open = { status: { $in: OPEN_STATUSES } };
  const flags = {
    overdue: { ...open, dueDate: { $lt: d, $ne: null } },
    due_today: { ...open, dueDate: d },
    blocked: { ...open, blocked: true },
    unassigned: { ...open, owner: null },
    review: { status: "in_review" },
    progress: { status: "in_progress" },
    done_week: { status: "done", completedAt: { $gte: weekStartTs() } },
  };
  if (flags[query.flag]) and.push(flags[query.flag]);
  if (query.q) {
    const rx = new RegExp(String(query.q).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    and.push({ $or: [{ title: rx }, { description: rx }, { key: rx }] });
  }
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 300));
  const offset = Math.max(0, Number(query.offset) || 0);
  const sorts = { updated: { updatedAt: -1 }, created: { createdAt: -1 }, due: { dueDate: 1, updatedAt: -1 }, priority: { updatedAt: -1 } };
  const filter = { $and: and };
  const [rows, total] = await Promise.all([
    col(TICKETS).find(filter, { projection: { history: 0, description: 0 } }).sort(sorts[query.sort] ?? sorts.updated).skip(offset).limit(limit).toArray(),
    col(TICKETS).countDocuments(filter),
  ]);
  if (query.sort === "priority") rows.sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority));
  if (query.sort === "due") rows.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const counts = await col(COMMENTS).aggregate([{ $match: { ticketId: { $in: rows.map((r) => r.id) }, deletedAt: null } }, { $group: { _id: "$ticketId", n: { $sum: 1 } } }]).toArray();
  const cmap = new Map(counts.map((c) => [c._id, c.n]));
  return {
    today: d, total, offset, hasMore: offset + rows.length < total,
    items: rows.map(strip).map((t) => ({ ...t, overdue: !!t.dueDate && t.dueDate < d && OPEN_STATUSES.includes(t.status), comments: cmap.get(t.id) ?? 0, canEdit: canEdit(t, admin), canPlan: canPlan(t, admin) })),
    labels: [...new Set(rows.flatMap((r) => r.labels ?? []))].sort(),
  };
}

/** Bulk status / assignee / priority. Each ticket goes through the normal checks; per-ticket results. */
export async function bulkUpdate(body, admin) {
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String))].slice(0, 200) : [];
  if (!ids.length) bad("pick at least one ticket");
  const patch = {};
  for (const k of ["status", "owner", "priority"]) if (body?.set?.[k] !== undefined) patch[k] = body.set[k];
  if (!Object.keys(patch).length) bad("nothing to change");
  const results = [];
  for (const id of ids) {
    try { const t = await updateTicket(id, patch, admin); results.push({ id, key: t.key, ok: true }); }
    catch (err) { results.push({ id, ok: false, error: err.message }); }
  }
  return { updated: results.filter((r) => r.ok).length, results };
}

/** Bulk delete. Each ticket goes through deleteTicket's own check (founder or creator). */
export async function bulkDelete(body, admin) {
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String))].slice(0, 200) : [];
  if (!ids.length) bad("pick at least one ticket");
  const results = [];
  for (const id of ids) {
    try { const r = await deleteTicket(id, admin); results.push({ id, key: r.key, ok: true }); }
    catch (err) { results.push({ id, ok: false, error: err.message }); }
  }
  return { deleted: results.filter((r) => r.ok).length, results };
}

// ─── Comments ───
function publicComment(c, admin) {
  const deleted = !!c.deletedAt;
  return { id: c.id, ticketId: c.ticketId, parentId: c.parentId ?? null, author: c.author, body: deleted ? null : c.body, mentions: c.mentions ?? [], createdAt: c.createdAt, editedAt: c.editedAt ?? null, deleted, canEdit: !deleted && (c.author === admin.email || isOwner(admin)) };
}
/** @riya, @riya@kynq.in or @firstname → team emails. */
async function mentionsIn(body) {
  const team = await roster();
  const found = new Set();
  for (const m of String(body).matchAll(/@([a-z0-9._+-]+(?:@[a-z0-9.-]+\.[a-z]{2,})?)/gi)) {
    const t = m[1].toLowerCase().replace(/[.,!?]+$/, "");
    const hit = team.find((p) => p.email === t || p.email.split("@")[0] === t || p.name.toLowerCase().split(/\s+/)[0] === t);
    if (hit) found.add(hit.email);
  }
  return [...found];
}
export async function addComment(idOrKey, body, admin) {
  const t = await visibleTicket(idOrKey, admin);
  const text = str(body?.body, 5000, "comment", true);
  let parentId = null;
  if (body?.parentId) {
    const parent = await col(COMMENTS).findOne({ id: String(body.parentId), ticketId: t.id });
    if (!parent) bad("the comment you're replying to doesn't exist");
    parentId = parent.parentId ?? parent.id; // one level of threading
  }
  const mentions = await mentionsIn(text);
  const now = Date.now();
  const c = { id: `cmt_${crypto.randomBytes(6).toString("hex")}`, ticketId: t.id, author: admin.email, body: text, parentId, mentions, createdAt: now, editedAt: null, deletedAt: null };
  await col(COMMENTS).insertOne(c);
  // Mentioned people can see the ticket from now on (that's how a teammate shares it).
  const newWatchers = mentions.filter((e) => e !== t.owner && e !== t.createdBy);
  await col(TICKETS).updateOne({ id: t.id }, { $set: { updatedAt: now }, ...(newWatchers.length ? { $addToSet: { watchers: { $each: newWatchers } } } : {}) });

  await notify({ type: "mention", recipients: mentions, ticket: t, actor: admin.email, text, dedupe: c.id });
  // Everyone else on the thread: assignee, creator, people it's shared with, earlier commenters.
  const commenters = await col(COMMENTS).distinct("author", { ticketId: t.id });
  const participants = [t.owner, t.createdBy, ...(t.watchers ?? []), ...commenters].filter((e) => e && !mentions.includes(e));
  await notify({ type: "reply", recipients: participants, ticket: t, actor: admin.email, text, dedupe: c.id });
  return publicComment(c, admin);
}
async function ownComment(commentId, admin) {
  const c = await col(COMMENTS).findOne({ id: String(commentId) });
  if (!c || c.deletedAt) missing("comment not found");
  const t = await col(TICKETS).findOne({ id: c.ticketId });
  if (!t || !canView(t, admin)) missing("comment not found");
  if (c.author !== admin.email && !isOwner(admin)) forbid("Only the author or the founder can change this comment.");
  return c;
}
export async function editComment(commentId, body, admin) {
  const c = await ownComment(commentId, admin);
  const text = str(body?.body, 5000, "comment", true);
  await col(COMMENTS).updateOne({ id: c.id }, { $set: { body: text, mentions: await mentionsIn(text), editedAt: Date.now() } });
  return publicComment(await col(COMMENTS).findOne({ id: c.id }), admin);
}
export async function deleteComment(commentId, admin) {
  const c = await ownComment(commentId, admin);
  await col(COMMENTS).updateOne({ id: c.id }, { $set: { deletedAt: Date.now(), body: "" } });
  if (c.author !== admin.email) await logAudit(admin.email, "tasks.comment.delete", c.id, { ticketId: c.ticketId });
  return { id: c.id, deleted: true };
}

// ─── JSON import (founder only) ───
export const IMPORT_EXAMPLE = {
  tickets: [
    { title: "Fix video reconnect issue", description: "Investigate WebRTC reconnect failures.", assigneeEmail: "developer@example.com", priority: "urgent", status: "todo", dueDate: "2026-10-20", labels: ["engineering", "bug"] },
    { title: "Publish 5 Instagram reels", description: "Prepare and publish 5 reels for KYNQ.", assigneeEmail: "marketing@example.com", priority: "high", status: "todo", labels: ["marketing", "content"] },
  ],
};
const ALLOWED_IMPORT_KEYS = new Set(["title", "description", "assigneeEmail", "assignee", "priority", "status", "dueDate", "labels", "sprint"]);

/** Validates every row without writing anything. */
export async function previewImport(body, admin) {
  if (!isOwner(admin)) forbid("Only the founder can import tickets.");
  await ensureTickets();
  const raw = body ?? {};
  if (JSON.stringify(raw).length > IMPORT_LIMITS.maxBytes) bad(`the JSON is too big (max ${IMPORT_LIMITS.maxBytes / 1000} KB)`);
  const tickets = Array.isArray(raw) ? raw : raw.tickets;
  if (!Array.isArray(tickets) || !tickets.length) bad('expected {"tickets": [ ... ]} with at least one ticket');
  if (tickets.length > IMPORT_LIMITS.maxTickets) bad(`max ${IMPORT_LIMITS.maxTickets} tickets per import`);
  const team = await roster();
  // "sprint": "active" (the running sprint), "backlog", or a sprint name/number ("Sprint 3", 3).
  const open = await col(SPRINTS).find({ status: { $in: ["planned", "active"] } }, { projection: { id: 1, name: 1, number: 1, status: 1 } }).toArray();
  const resolveSprint = (v) => {
    if (v == null || v === "" || v === "backlog") return { id: null };
    if (v === "active" || v === "current") { const a = open.find((s) => s.status === "active"); return a ? { id: a.id, name: a.name } : { error: "there's no active sprint" }; }
    const hit = open.find((s) => String(s.number) === String(v).replace(/^sprint\s*/i, "") || s.name.toLowerCase() === String(v).toLowerCase());
    return hit ? { id: hit.id, name: hit.name } : { error: `sprint "${v}" isn't planned or active` };
  };
  const seen = new Map();
  const rows = tickets.map((t, index) => {
    const errors = [];
    if (!t || typeof t !== "object" || Array.isArray(t)) return { index, ok: false, errors: ["each ticket must be an object"], ticket: null, unknownAssignee: null };
    const unknown = Object.keys(t).filter((k) => !ALLOWED_IMPORT_KEYS.has(k));
    if (unknown.length) errors.push(`unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
    let fields = null, owner = null, unknownAssignee = null;
    try { fields = cleanTicketFields(t, false); } catch (e) { errors.push(e.message); }
    const ref = t.assigneeEmail ?? t.assignee;
    if (ref) {
      const r = String(ref).trim().toLowerCase();
      const hit = team.find((m) => m.email === r) ?? team.find((m) => m.email.split("@")[0] === r);
      if (hit) owner = hit.email; else { unknownAssignee = String(ref); errors.push(`"${ref}" isn't on the team (Admin → Team)`); }
    }
    const sp = resolveSprint(t.sprint);
    if (sp.error) errors.push(sp.error);
    const dupKey = String(t.title ?? "").trim().toLowerCase();
    if (dupKey && seen.has(dupKey)) errors.push(`same title as ticket #${seen.get(dupKey) + 1} in this import`);
    else if (dupKey) seen.set(dupKey, index);
    return { index, ok: !errors.length, errors, ticket: fields ? { ...fields, assignee: owner, sprintId: sp.id ?? null, sprintName: sp.name ?? null } : null, unknownAssignee };
  });
  return { valid: rows.every((r) => r.ok), count: rows.length, errors: rows.filter((r) => !r.ok).length, rows, idempotencyKey: typeof raw.idempotencyKey === "string" ? raw.idempotencyKey : null };
}

/**
 * All-or-nothing at validation: if any row is invalid nothing is created. Keys are reserved in
 * one atomic step, then inserted in one batch. Re-sending the same idempotency key returns the
 * first result instead of creating duplicates (the UI derives the key from the JSON itself).
 */
export async function commitImport(body, admin) {
  if (!isOwner(admin)) forbid("Only the founder can import tickets.");
  const key = String(body?.idempotencyKey ?? "").trim();
  if (!/^[\w.:-]{8,100}$/.test(key)) bad("idempotencyKey is required (8–100 letters, numbers, . : _ -)");
  await ensureTickets();
  const prior = await col(IMPORTS).findOne({ key });
  if (prior?.result) return { ...prior.result, duplicate: true };
  try { await col(IMPORTS).insertOne({ key, createdBy: admin.email, createdAt: Date.now(), status: "running" }); }
  catch (err) { if (err?.code === 11000) { const p = await col(IMPORTS).findOne({ key }); return { ...(p?.result ?? { created: [], errors: [] }), duplicate: true, inProgress: !p?.result }; } throw err; }
  try {
    const preview = await previewImport(body, admin);
    if (!preview.valid) {
      await col(IMPORTS).deleteOne({ key }); // nothing created: the same key can be retried after fixing
      return { created: [], errors: preview.rows.filter((r) => !r.ok).map((r) => ({ index: r.index, errors: r.errors })), committed: false };
    }
    const first = await reserveKeys(preview.rows.length);
    const now = Date.now();
    const docs = preview.rows.map((r, i) => {
      const { assignee, sprintName: _sn, ...fields } = r.ticket;
      const d = newTicketDoc(fields, { owner: assignee, createdBy: admin.email, key: `${KEY_PREFIX}-${first + i}`, now });
      d.history = [{ at: now, by: admin.email, type: "created", text: "imported from JSON" }];
      d.importKey = key;
      return d;
    });
    await col(TICKETS).insertMany(docs, { ordered: true });
    const result = { created: docs.map((d) => ({ key: d.key, id: d.id, title: d.title, owner: d.owner })), errors: [], committed: true };
    await col(IMPORTS).updateOne({ key }, { $set: { status: "done", result, count: docs.length } });
    await logAudit(admin.email, "tasks.ticket.import", key, { count: docs.length, first: docs[0]?.key, last: docs.at(-1)?.key });
    for (const d of docs) await notify({ type: "assigned", recipients: [d.owner], ticket: d, actor: admin.email, dedupe: `${d.id}:0` });
    return result;
  } catch (err) {
    const created = await col(TICKETS).find({ importKey: key }, { projection: { key: 1, id: 1, title: 1 } }).toArray();
    await col(IMPORTS).updateOne({ key }, { $set: { status: "failed", result: { created: created.map(strip), errors: [{ index: -1, errors: [err.message] }], committed: created.length > 0 } } });
    throw err;
  }
}

// ─── Overview ───
const LIGHT = { projection: { history: 0, description: 0 } };
export async function overview(admin) {
  await ensureTickets();
  const d = today();
  const base = visibleFilter(admin);
  const open = { ...base, status: { $in: OPEN_STATUSES } };
  const count = (q) => col(TICKETS).countDocuments(q);
  const [openN, progress, overdue, blocked, review, doneWeek, mine, recent, attention, workloadRows] = await Promise.all([
    count(open),
    count({ ...base, status: "in_progress" }),
    count({ ...open, dueDate: { $lt: d, $ne: null } }),
    count({ ...open, blocked: true }),
    count({ ...base, status: "in_review" }),
    count({ ...base, status: "done", completedAt: { $gte: weekStartTs() } }),
    col(TICKETS).find({ owner: admin.email, status: { $in: OPEN_STATUSES } }, LIGHT).sort({ dueDate: 1, updatedAt: -1 }).limit(100).toArray(),
    col(TICKETS).find(base, LIGHT).sort({ updatedAt: -1 }).limit(8).toArray(),
    isOwner(admin) ? col(TICKETS).find({ status: { $in: OPEN_STATUSES }, $or: [{ blocked: true }, { status: "in_review" }, { owner: null }, { dueDate: { $lt: d, $ne: null }, priority: { $in: ["urgent", "high"] } }] }, LIGHT).sort({ updatedAt: 1 }).limit(12).toArray() : [],
    isOwner(admin) ? col(TICKETS).aggregate([
      { $match: { status: { $in: OPEN_STATUSES } } },
      { $group: { _id: "$owner", open: { $sum: 1 }, progress: { $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] } }, overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $lt: ["$dueDate", d] }] }, 1, 0] } }, blocked: { $sum: { $cond: ["$blocked", 1, 0] } } } },
    ]).toArray() : [],
  ]);
  const team = await roster();
  const wl = new Map(workloadRows.map((r) => [r._id, r]));
  const reason = (t) => (t.blocked ? `Blocked: ${t.blockerReason ?? "no reason given"}` : t.status === "in_review" ? "Waiting for your review" : !t.owner ? "Nobody is assigned" : "Overdue");
  const sortMine = mine.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority));
  return {
    today: d,
    sprint: await activeSummary(),
    counts: { open: openN, progress, overdue, blocked, review, doneWeek },
    mine: sortMine.slice(0, 12).map(strip).map((t) => ({ ...t, overdue: !!t.dueDate && t.dueDate < d })),
    mineTotal: mine.length,
    recent: recent.map(strip),
    attention: attention.map(strip).map((t) => ({ ...t, reason: reason(t) })),
    workload: isOwner(admin) ? [
      ...team.map((m) => ({ email: m.email, name: m.name, open: 0, progress: 0, overdue: 0, blocked: 0, ...(wl.get(m.email) ? { ...wl.get(m.email), _id: undefined } : {}) })),
      ...(wl.get(null) ? [{ email: null, name: "Unassigned", ...wl.get(null), _id: undefined }] : []),
    ] : null,
  };
}
