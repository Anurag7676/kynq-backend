// Sprints (1 week by default) and the backlog.
//
//   backlog  = every ticket with sprintId: null. That's where work waits.
//   sprint   = planned → active (one at a time) → completed. The founder plans, starts and
//              completes sprints and moves tickets in and out; teammates see progress.
//
// Each ticket keeps a `sprints` log: [{ id, addedAt, removedAt, result }], result being
// null (still in it), "done", "carried" (unfinished at completion, moved on) or "moved"
// (taken out mid-sprint). The report is computed from that log, live for an active sprint and
// frozen into the sprint document when it's completed, so later edits never rewrite history.
//
// Per-person numbers count tickets (no estimates). Founder sees everyone plus "needs
// attention" flags with the reason; a teammate sees the sprint totals and only their own row.
import crypto from "node:crypto";
import { col } from "../util.js";
import { logAudit } from "../audit.js";
import { roster, isOwner, forbid, bad, missing, conflict } from "./team.js";
import { TICKETS, SPRINTS, OPEN_STATUSES, DAY, today, addDays, strip } from "./store.js";

const TZ = (Number(process.env.TASKS_TZ_OFFSET_MIN) || 330) * 60_000;
const dayStart = (d) => Date.parse(`${d}T00:00:00Z`) - TZ;
const dayEnd = (d) => dayStart(d) + DAY - 1;
const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const SPRINT_DAYS = 7;

let ready = null;
export const ensureSprints = () => (ready ??= Promise.all([
  col(SPRINTS).createIndex({ id: 1 }, { unique: true }),
  col(SPRINTS).createIndex({ number: -1 }),
  col(SPRINTS).createIndex({ status: 1 }),
  col(TICKETS).createIndex({ sprintId: 1, status: 1 }),
  col(TICKETS).createIndex({ "sprints.id": 1 }),
]).catch((err) => { ready = null; throw err; }));

const publicSprint = (s) => { const { _id, report, ...rest } = s; return rest; };

/** Validates a target sprint for adding tickets: must exist and not be completed. */
export async function assignableSprint(sprintId) {
  if (sprintId === null || sprintId === undefined || sprintId === "") return null;
  const s = await col(SPRINTS).findOne({ id: String(sprintId) });
  if (!s) bad("that sprint doesn't exist");
  if (s.status === "completed") bad(`${s.name} is already completed`);
  return s;
}

/** Mongo update parts that move ticket `t` into `sprintId` (null = backlog), keeping the log. */
export function sprintMove(t, sprintId, now) {
  if ((t.sprintId ?? null) === (sprintId ?? null)) return null;
  const log = (t.sprints ?? []).map((e) => (e.id === t.sprintId && e.removedAt == null ? { ...e, removedAt: now, result: "moved" } : e));
  if (sprintId) log.push({ id: sprintId, addedAt: now, removedAt: null, result: null });
  return { sprintId: sprintId ?? null, sprints: log };
}

// ─── CRUD ───
export async function listSprints(admin) {
  await ensureSprints();
  const sprints = await col(SPRINTS).find({}, { projection: { report: 0 } }).sort({ number: -1 }).limit(100).toArray();
  const counts = await col(TICKETS).aggregate([
    { $match: { sprintId: { $in: sprints.map((s) => s.id) } } },
    { $group: { _id: "$sprintId", total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } } } },
  ]).toArray();
  const c = new Map(counts.map((x) => [x._id, x]));
  const backlog = await col(TICKETS).countDocuments({ sprintId: null, status: { $in: OPEN_STATUSES } });
  return {
    today: today(), backlog, canManage: isOwner(admin),
    items: sprints.map((s) => ({ ...publicSprint(s), total: s.status === "completed" ? s.summary?.scope ?? 0 : c.get(s.id)?.total ?? 0, done: s.status === "completed" ? s.summary?.done ?? 0 : c.get(s.id)?.done ?? 0, completion: s.summary?.completion ?? null })),
  };
}

export async function activeSprint() {
  await ensureSprints();
  return col(SPRINTS).findOne({ status: "active" }, { projection: { report: 0 } });
}

async function nextDates() {
  const last = await col(SPRINTS).find({}).sort({ number: -1 }).limit(1).toArray();
  const t = today();
  const start = last[0] && addDays(last[0].endDate, 1) > t ? addDays(last[0].endDate, 1) : t;
  return { startDate: start, endDate: addDays(start, SPRINT_DAYS - 1) };
}

function cleanSprintFields(b, partial) {
  const out = {};
  if (b.name !== undefined) { const n = String(b.name ?? "").trim(); if (!n || n.length > 60) bad("sprint name is 1–60 characters"); out.name = n; }
  if (b.goal !== undefined) { const g = String(b.goal ?? "").trim(); if (g.length > 300) bad("goal is too long (max 300)"); out.goal = g || null; }
  for (const k of ["startDate", "endDate"]) if (b[k] !== undefined) { if (!isDay(b[k])) bad(`${k} must be YYYY-MM-DD`); out[k] = b[k]; }
  if (!partial && (!out.startDate || !out.endDate)) bad("start and end dates are required");
  return out;
}

export async function createSprint(body, admin) {
  if (!isOwner(admin)) forbid("Only the founder plans sprints.");
  await ensureSprints();
  const b = body ?? {};
  const fields = cleanSprintFields({ ...(await nextDates()), ...b }, false);
  if (fields.endDate < fields.startDate) bad("the sprint ends before it starts");
  const r = await col("fos_counters").findOneAndUpdate({ _id: "sprint" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  const number = (r?.value ?? r)?.seq ?? 1;
  const doc = { id: `spr_${crypto.randomBytes(6).toString("hex")}`, number, name: fields.name ?? `Sprint ${number}`, goal: fields.goal ?? null, startDate: fields.startDate, endDate: fields.endDate, status: "planned", createdBy: admin.email, createdAt: Date.now(), startedAt: null, completedAt: null, committed: [], summary: null };
  await col(SPRINTS).insertOne(doc);
  await logAudit(admin.email, "tasks.sprint.create", doc.name, { startDate: doc.startDate, endDate: doc.endDate });
  return publicSprint(doc);
}

async function findSprint(id) {
  await ensureSprints();
  const s = await col(SPRINTS).findOne({ id: String(id) });
  if (!s) missing("sprint not found");
  return s;
}

export async function updateSprint(id, body, admin) {
  if (!isOwner(admin)) forbid("Only the founder edits sprints.");
  const s = await findSprint(id);
  if (s.status === "completed") bad("a completed sprint can't be edited");
  const set = cleanSprintFields(body ?? {}, true);
  if ((set.endDate ?? s.endDate) < (set.startDate ?? s.startDate)) bad("the sprint ends before it starts");
  await col(SPRINTS).updateOne({ id: s.id }, { $set: set });
  return publicSprint({ ...s, ...set });
}

export async function deleteSprint(id, admin) {
  if (!isOwner(admin)) forbid("Only the founder deletes sprints.");
  const s = await findSprint(id);
  if (s.status !== "planned") bad("only a sprint that hasn't started can be deleted");
  const now = Date.now();
  for (const t of await col(TICKETS).find({ sprintId: s.id }).toArray()) {
    await col(TICKETS).updateOne({ id: t.id }, { $set: { sprintId: null, updatedAt: now, sprints: (t.sprints ?? []).filter((e) => e.id !== s.id) } });
  }
  await col(SPRINTS).deleteOne({ id: s.id });
  await logAudit(admin.email, "tasks.sprint.delete", s.name, {});
  return { id: s.id };
}

export async function startSprint(id, admin) {
  if (!isOwner(admin)) forbid("Only the founder starts sprints.");
  const s = await findSprint(id);
  if (s.status !== "planned") bad(`${s.name} has already ${s.status === "active" ? "started" : "finished"}`);
  const running = await activeSprint();
  if (running) conflict(`${running.name} is still active. Complete it first.`);
  const now = Date.now();
  const committed = (await col(TICKETS).find({ sprintId: s.id }, { projection: { id: 1 } }).toArray()).map((t) => t.id);
  const r = await col(SPRINTS).updateOne({ id: s.id, status: "planned" }, { $set: { status: "active", startedAt: now, committed } });
  if (!r.modifiedCount) conflict("someone else just changed this sprint");
  await logAudit(admin.email, "tasks.sprint.start", s.name, { committed: committed.length });
  return publicSprint({ ...s, status: "active", startedAt: now, committed });
}

/**
 * Completes the active sprint. Unfinished tickets go to `moveTo`: a planned sprint's id,
 * "new" (creates the next sprint) or "backlog". The report is frozen afterwards.
 */
export async function completeSprint(id, body, admin) {
  if (!isOwner(admin)) forbid("Only the founder completes sprints.");
  const s = await findSprint(id);
  if (s.status !== "active") bad("only the active sprint can be completed");
  let target = null;
  const moveTo = body?.moveTo ?? "backlog";
  if (moveTo === "new") target = await createSprint({}, admin);
  else if (moveTo !== "backlog") { target = await assignableSprint(moveTo); if (target.id === s.id) bad("pick a different sprint"); }
  const now = Date.now();
  const tickets = await col(TICKETS).find({ sprintId: s.id }).toArray();
  let carried = 0;
  for (const t of tickets) {
    const finished = t.status === "done" || t.status === "cancelled";
    const log = (t.sprints ?? []).map((e) => (e.id === s.id && e.removedAt == null ? { ...e, ...(finished ? { result: t.status === "done" ? "done" : "cancelled" } : { removedAt: now, result: "carried" }) } : e));
    if (finished) { await col(TICKETS).updateOne({ id: t.id }, { $set: { sprints: log } }); continue; }
    carried++;
    if (target) log.push({ id: target.id, addedAt: now, removedAt: null, result: null });
    await col(TICKETS).updateOne({ id: t.id }, { $set: { sprints: log, sprintId: target?.id ?? null, updatedAt: now }, $push: { history: { at: now, by: admin.email, type: "sprint", from: s.name, to: target?.name ?? "Backlog", text: "carried over" } } });
  }
  const closed = { ...s, status: "completed", completedAt: now };
  const report = await buildReport(closed, { owner: true });
  const r = await col(SPRINTS).updateOne({ id: s.id, status: "active" }, { $set: { status: "completed", completedAt: now, report, summary: report.summary, carriedTo: target?.id ?? null } });
  if (!r.modifiedCount) conflict("someone else just changed this sprint");
  await logAudit(admin.email, "tasks.sprint.complete", s.name, { ...report.summary, carriedTo: target?.name ?? "Backlog" });
  return { sprint: publicSprint(closed), carried, carriedTo: target ? { id: target.id, name: target.name } : null };
}

/** Bulk move tickets into a sprint (or back to the backlog with sprintId null). Founder only. */
export async function moveTickets(body, admin) {
  if (!isOwner(admin)) forbid("Only the founder plans sprints.");
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String))].slice(0, 300) : [];
  if (!ids.length) bad("pick at least one ticket");
  const target = await assignableSprint(body?.sprintId ?? null);
  const now = Date.now();
  let moved = 0;
  for (const id of ids) {
    const t = await col(TICKETS).findOne(/^[A-Z]+-\d+$/i.test(id) ? { key: id.toUpperCase() } : { id });
    if (!t) continue;
    const m = sprintMove(t, target?.id ?? null, now);
    if (!m) continue;
    const from = t.sprintId ? (await col(SPRINTS).findOne({ id: t.sprintId }))?.name ?? "a sprint" : "Backlog";
    await col(TICKETS).updateOne({ id: t.id }, { $set: { ...m, updatedAt: now }, $inc: { version: 1 }, $push: { history: { at: now, by: admin.email, type: "sprint", from, to: target?.name ?? "Backlog" } } });
    moved++;
  }
  return { moved, sprint: target ? { id: target.id, name: target.name } : null };
}

// ─── Report ───
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

/** The sprint report: summary, burndown, people (+ flags for the founder), ticket lists. */
async function buildReport(s, { owner, email }) {
  const start = s.startedAt ?? dayStart(s.startDate);
  const end = s.completedAt ?? Math.max(Date.now(), start);
  const rows = await col(TICKETS).find({ "sprints.id": s.id }, { projection: { description: 0 } }).toArray();
  const team = await roster();
  const nameOf = (e) => team.find((m) => m.email === e)?.name ?? (e ? e.split("@")[0] : "Unassigned");
  const committedSet = new Set(s.committed ?? []);

  const items = rows.map((t) => {
    const entries = (t.sprints ?? []).filter((e) => e.id === s.id);
    const first = entries[0], last = entries.at(-1);
    const movedOut = last.result === "moved";
    const doneInSprint = t.status === "done" && t.completedAt != null && t.completedAt <= end && (last.removedAt == null || t.completedAt <= last.removedAt) && !movedOut;
    const startedAt = (t.history ?? []).find((h) => h.type === "status" && h.to === "in_progress")?.at ?? first.addedAt;
    return {
      key: t.key, title: t.title, owner: t.owner, priority: t.priority, status: t.status, dueDate: t.dueDate,
      committed: committedSet.has(t.id) || (s.status === "planned") || first.addedAt <= start,
      added: s.status !== "planned" && first.addedAt > start && !committedSet.has(t.id),
      removed: movedOut, cancelled: t.status === "cancelled" && !movedOut,
      done: s.status === "completed" ? last.result === "done" : doneInSprint,
      carried: last.result === "carried" || (s.status === "active" && !doneInSprint && !movedOut && t.status !== "cancelled"),
      carriedSprints: (t.sprints ?? []).filter((e) => e.result === "carried").length,
      completedAt: doneInSprint || last.result === "done" ? t.completedAt : null,
      cycleDays: t.completedAt && (doneInSprint || last.result === "done") ? Math.max(0, (t.completedAt - startedAt) / DAY) : null,
      addedAt: first.addedAt, removedAt: movedOut ? last.removedAt : null,
    };
  });
  const scope = items.filter((i) => !i.removed && !i.cancelled);
  const done = scope.filter((i) => i.done);
  const endDay = s.completedAt ? today(s.completedAt) : today();
  const overdue = scope.filter((i) => !i.done && i.dueDate && i.dueDate < endDay);
  const summary = {
    committed: items.filter((i) => i.committed).length,
    added: items.filter((i) => i.added && !i.removed).length,
    removed: items.filter((i) => i.removed).length,
    cancelled: items.filter((i) => i.cancelled).length,
    scope: scope.length, done: done.length,
    carried: s.status === "completed" ? scope.filter((i) => !i.done).length : 0,
    remaining: s.status === "completed" ? 0 : scope.filter((i) => !i.done).length,
    completion: pct(done.length, scope.length),
    overdue: overdue.length,
  };

  // Burndown: open tickets in scope at the end of each day (up to today), plus the ideal line.
  const days = [];
  for (let d = s.startDate; d <= s.endDate && days.length < 60; d = addDays(d, 1)) days.push(d);
  const burndown = days.map((d, i) => {
    const ts = dayEnd(d);
    const future = ts > end && d > endDay;
    const inScope = items.filter((x) => !x.cancelled && x.addedAt <= Math.max(ts, start) && !(x.removedAt && x.removedAt <= ts));
    const open = inScope.filter((x) => !(x.completedAt && x.completedAt <= ts)).length;
    return { date: d, remaining: future ? null : open, ideal: Math.round((summary.committed * (days.length - 1 - i)) / Math.max(1, days.length - 1) * 10) / 10 };
  });

  // People.
  const elapsed = Math.min(1, Math.max(0, (Math.min(Date.now(), end) - start) / Math.max(DAY, dayEnd(s.endDate) - start)));
  const daysIn = (Math.min(Date.now(), end) - start) / DAY;
  const byPerson = new Map();
  for (const i of scope) {
    const k = i.owner ?? null;
    const p = byPerson.get(k) ?? { email: k, name: nameOf(k), assigned: 0, done: 0, inProgress: 0, overdue: 0, carried: 0, cycle: [], tickets: [] };
    p.assigned++; if (i.done) { p.done++; if (i.cycleDays != null) p.cycle.push(i.cycleDays); }
    if (!i.done && i.status === "in_progress") p.inProgress++;
    if (!i.done && i.dueDate && i.dueDate < endDay) p.overdue++;
    if (!i.done && s.status === "completed") p.carried++;
    p.tickets.push(i);
    byPerson.set(k, p);
  }
  let people = [...byPerson.values()].map((p) => {
    const flags = [];
    if (p.email) {
      const repeat = p.tickets.filter((t) => !t.done && t.carriedSprints >= (s.status === "completed" ? 2 : 1));
      if (p.assigned >= 2 && (s.status === "completed" || elapsed >= 0.5) && pct(p.done, p.assigned) < 50) flags.push(`Finished ${p.done} of ${p.assigned}`);
      if (p.overdue) flags.push(`${p.overdue} overdue`);
      for (const t of repeat.slice(0, 2)) flags.push(`${t.key} carried over ${t.carriedSprints + (s.status === "completed" ? 0 : 1)} sprints`);
      if (p.done === 0 && p.inProgress === 0 && daysIn >= 3 && s.status !== "planned") flags.push("Nothing started yet");
    }
    const avg = p.cycle.length ? Math.round((p.cycle.reduce((a, b) => a + b, 0) / p.cycle.length) * 10) / 10 : null;
    return { email: p.email, name: p.name, assigned: p.assigned, done: p.done, completion: pct(p.done, p.assigned), inProgress: p.inProgress, overdue: p.overdue, carried: p.carried, avgCycleDays: avg, flags };
  }).sort((a, b) => (b.flags.length - a.flags.length) || ((a.completion ?? 101) - (b.completion ?? 101)));
  if (!owner) people = people.filter((p) => p.email === email).map((p) => ({ ...p, flags: [] }));

  const lite = (i) => ({ key: i.key, title: i.title, owner: i.owner, status: i.status, priority: i.priority, dueDate: i.dueDate, added: i.added, carriedSprints: i.carriedSprints });
  const mine = (i) => owner || i.owner === email;
  return {
    sprint: publicSprint(s), summary, burndown, people, elapsed: Math.round(elapsed * 100),
    tickets: {
      done: scope.filter((i) => i.done && mine(i)).map(lite),
      notDone: scope.filter((i) => !i.done && mine(i)).map(lite),
      removed: items.filter((i) => i.removed && mine(i)).map(lite),
    },
    frozen: s.status === "completed",
  };
}

/** Per-person completion across the last completed sprints (founder) or just me. */
async function trend(admin) {
  const done = await col(SPRINTS).find({ status: "completed" }, { projection: { id: 1, name: 1, number: 1, "report.people": 1, summary: 1 } }).sort({ number: -1 }).limit(6).toArray();
  const sprints = done.reverse();
  const people = new Map();
  for (const s of sprints) for (const p of s.report?.people ?? []) {
    if (!p.email || (!isOwner(admin) && p.email !== admin.email)) continue;
    const row = people.get(p.email) ?? { email: p.email, name: p.name, values: {} };
    row.values[s.id] = p.completion; people.set(p.email, row);
  }
  return { sprints: sprints.map((s) => ({ id: s.id, name: s.name, completion: s.summary?.completion ?? null })), people: [...people.values()] };
}

export async function sprintReport(id, admin) {
  const s = await findSprint(id);
  const owner = isOwner(admin);
  let report;
  if (s.status === "completed" && s.report) {
    report = s.report;
    if (!owner) {
      report = { ...report, people: report.people.filter((p) => p.email === admin.email).map((p) => ({ ...p, flags: [] })),
        tickets: Object.fromEntries(Object.entries(report.tickets).map(([k, v]) => [k, v.filter((t) => t.owner === admin.email)])) };
    }
  } else report = await buildReport(s, { owner, email: admin.email });
  return { ...report, sprint: publicSprint(s), trend: await trend(admin), canManage: owner };
}

/** For the Tasks overview: the active sprint's progress, or null. */
export async function activeSummary() {
  const s = await activeSprint();
  if (!s) return null;
  const [total, done] = await Promise.all([
    col(TICKETS).countDocuments({ sprintId: s.id, status: { $ne: "cancelled" } }),
    col(TICKETS).countDocuments({ sprintId: s.id, status: "done" }),
  ]);
  const t = today();
  return { id: s.id, name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate, total, done, daysLeft: Math.round((Date.parse(s.endDate) - Date.parse(t)) / DAY), ended: s.endDate < t };
}
export { strip };
