// Ticket notifications.
//
// In-app: one row per (event, person) in task_notifications. Every row has a unique `dedupe`
// key, so retries, double clicks and a second backend instance can never produce a duplicate.
// The person who caused an event is never notified about it.
//
// Email (only if EMAIL_* is configured and TASKS_EMAIL isn't "off"):
//   • assignments and @mentions are emailed, but batched: a background tick every minute sends
//     each person ONE email covering everything new for them, and nobody gets more than
//     EMAIL_DAILY_CAP of these a day. Everything else is in-app only.
//   • a daily digest at TASKS_DIGEST_AT (default 09:30, team timezone) lists each person's overdue, due-soon and other
//     open tickets. Sent at most once per person per day (task_digests has a unique key).
//
// Deadline reminders (due today/tomorrow, overdue) are created by the same background tick, once
// per ticket per due date, so they keep working with nobody's dashboard open.
import crypto from "node:crypto";
import { col } from "../util.js";
import { sendEmail } from "../../config/emailConfig.js";
import { roster } from "./team.js";
import { TICKETS, NOTIFICATIONS, DIGESTS, OPEN_STATUSES, today, addDays, localHourMin, ticketUrl, adminUrl, strip } from "./store.js";

export const TYPES = ["assigned", "reassigned", "mention", "reply", "due_soon", "overdue", "in_review", "reopened"];
const EMAILED = new Set(["assigned", "mention"]);
const EMAIL_DAILY_CAP = 12;
const digestAt = () => process.env.TASKS_DIGEST_AT || "09:30";

let indexes = null;
export const ensureNotificationIndexes = () => (indexes ??= Promise.all([
  col(NOTIFICATIONS).createIndex({ dedupe: 1 }, { unique: true }),
  col(NOTIFICATIONS).createIndex({ to: 1, at: -1 }),
  col(NOTIFICATIONS).createIndex({ to: 1, readAt: 1 }),
  col(NOTIFICATIONS).createIndex({ emailPending: 1 }, { partialFilterExpression: { emailPending: true } }),
  col(DIGESTS).createIndex({ key: 1 }, { unique: true }),
]).catch((err) => { indexes = null; throw err; }));

/**
 * Records one notification per recipient. `recipients` may contain the actor or duplicates;
 * both are dropped. `dedupe` is a stable id for the event (a comment id, a ticket version…).
 * Never throws: a failed notification must not fail the ticket change that caused it.
 */
export async function notify({ type, recipients, ticket, actor = null, text = null, dedupe }) {
  try {
    await ensureNotificationIndexes();
    const to = [...new Set(recipients.filter(Boolean))].filter((e) => e !== actor);
    if (!to.length) return;
    const now = Date.now();
    const docs = to.map((email) => ({
      id: `ntf_${crypto.randomBytes(6).toString("hex")}`, to: email, type,
      ticketId: ticket.id, ticketKey: ticket.key, ticketTitle: ticket.title,
      actor, text: text ? String(text).slice(0, 240) : null,
      at: now, readAt: null, dedupe: `${type}:${dedupe}:${email}`,
      emailPending: EMAILED.has(type),
    }));
    await col(NOTIFICATIONS).insertMany(docs, { ordered: false }).catch((err) => { if (err?.code !== 11000 && !err?.writeErrors?.every((e) => e.code === 11000)) throw err; });
  } catch (err) {
    console.error("[tasks] notify failed:", err.message);
  }
}

// ─── Reading (always the signed-in person's own notifications) ───
export async function listNotifications(admin, { limit = 30, before = null, unread = false } = {}) {
  await ensureNotificationIndexes();
  const q = { to: admin.email, ...(unread ? { readAt: null } : {}), ...(before ? { at: { $lt: Number(before) } } : {}) };
  const n = Math.min(100, Math.max(1, Number(limit) || 30));
  const rows = await col(NOTIFICATIONS).find(q, { projection: { dedupe: 0, emailPending: 0 } }).sort({ at: -1 }).limit(n + 1).toArray();
  return { items: rows.slice(0, n).map(strip), hasMore: rows.length > n, unread: await unreadCount(admin) };
}
export const unreadCount = (admin) => col(NOTIFICATIONS).countDocuments({ to: admin.email, readAt: null });
export async function markRead(admin, ids) {
  const q = { to: admin.email, readAt: null, ...(ids === "all" ? {} : { id: { $in: (Array.isArray(ids) ? ids : []).map(String).slice(0, 200) } }) };
  const r = await col(NOTIFICATIONS).updateMany(q, { $set: { readAt: Date.now() } });
  return { updated: r.modifiedCount, unread: await unreadCount(admin) };
}

// ─── Background: reminders, batched emails, digest ───
const emailOn = () => process.env.TASKS_EMAIL !== "off" && !!process.env.EMAIL_USERNAME && !!process.env.EMAIL_PASSWORD;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LINE = {
  assigned: (n, who) => `${who} assigned you ${n.ticketKey}`,
  reassigned: (n, who) => `${who} reassigned ${n.ticketKey}`,
  mention: (n, who) => `${who} mentioned you on ${n.ticketKey}`,
};

/** Due today/tomorrow and overdue reminders for assignees, once per ticket per due date. */
export async function createDeadlineReminders() {
  const d = today(), tomorrow = addDays(d, 1);
  const rows = await col(TICKETS).find({ status: { $in: OPEN_STATUSES }, owner: { $ne: null }, dueDate: { $ne: null, $lte: tomorrow } }, { projection: { id: 1, key: 1, title: 1, owner: 1, dueDate: 1 } }).limit(1000).toArray();
  for (const t of rows) {
    if (t.dueDate < d) await notify({ type: "overdue", recipients: [t.owner], ticket: t, text: `Was due ${t.dueDate}`, dedupe: `${t.id}:${t.dueDate}` });
    else await notify({ type: "due_soon", recipients: [t.owner], ticket: t, text: t.dueDate === d ? "Due today" : "Due tomorrow", dedupe: `${t.id}:${t.dueDate}` });
  }
  return rows.length;
}

async function emailsSentToday(email) {
  return col(DIGESTS).countDocuments({ kind: "instant", email, day: today() });
}

/** One email per person covering all their new assignments/mentions. */
export async function sendPendingEmails() {
  const pending = await col(NOTIFICATIONS).find({ emailPending: true }).sort({ at: 1 }).limit(500).toArray();
  if (!pending.length) return 0;
  const team = new Map((await roster()).map((m) => [m.email, m]));
  const byPerson = Map.groupBy ? Map.groupBy(pending, (n) => n.to) : pending.reduce((m, n) => m.set(n.to, [...(m.get(n.to) ?? []), n]), new Map());
  let sent = 0;
  for (const [email, list] of byPerson) {
    const ids = list.map((n) => n.id);
    const still = team.has(email);
    const capped = !still || (await emailsSentToday(email)) >= EMAIL_DAILY_CAP;
    if (emailOn() && !capped) {
      const items = list.map((n) => `<li style="margin:0 0 8px"><a href="${ticketUrl(n.ticketKey)}">${esc(n.ticketKey)} · ${esc(n.ticketTitle)}</a><br><span style="color:#666">${esc(LINE[n.type]?.(n, team.get(n.actor)?.name ?? n.actor ?? "Someone") ?? n.type)}${n.text ? `: “${esc(n.text)}”` : ""}</span></li>`).join("");
      const subject = list.length === 1 ? LINE[list[0].type]?.(list[0], team.get(list[0].actor)?.name ?? "Someone") ?? "KYNQ ticket update" : `${list.length} ticket updates for you`;
      try {
        await sendEmail({ to: email, subject: `[KYNQ Tasks] ${subject}`, html: `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#111"><ul style="padding-left:18px">${items}</ul><p><a href="${adminUrl()}/tasks/notifications/">Open notifications</a></p><p style="color:#888;font-size:12px">You get at most ${EMAIL_DAILY_CAP} of these a day. Everything is also in KYNQ Admin.</p></div>` });
        await col(DIGESTS).insertOne({ key: `instant:${email}:${Date.now()}:${crypto.randomBytes(3).toString("hex")}`, kind: "instant", email, day: today(), at: Date.now(), count: list.length });
        sent++;
      } catch (err) { console.error("[tasks] email failed:", err.message); }
    }
    // Sent, capped, or email disabled: either way don't try again (in-app still has it).
    await col(NOTIFICATIONS).updateMany({ id: { $in: ids } }, { $set: { emailPending: false } });
  }
  return sent;
}

/** Daily digest of open work, once per person per day, at or after TASKS_DIGEST_AT. */
export async function sendDigests() {
  if (localHourMin() < digestAt()) return 0;
  const d = today(), soon = addDays(d, 2);
  const team = await roster();
  let sent = 0;
  for (const m of team) {
    const key = `digest:${m.email}:${d}`;
    if (await col(DIGESTS).findOne({ key })) continue;
    const open = await col(TICKETS).find({ owner: m.email, status: { $in: OPEN_STATUSES } }, { projection: { key: 1, title: 1, dueDate: 1, status: 1, priority: 1 } }).sort({ dueDate: 1 }).limit(100).toArray();
    // Claim the day first (unique key) so two instances or a retry can't double-send.
    try { await col(DIGESTS).insertOne({ key, kind: "digest", email: m.email, day: d, at: Date.now(), count: open.length }); } catch (err) { if (err?.code === 11000) continue; throw err; }
    if (!open.length || !emailOn()) continue;
    const overdue = open.filter((t) => t.dueDate && t.dueDate < d);
    const dueSoon = open.filter((t) => t.dueDate && t.dueDate >= d && t.dueDate <= soon);
    const rest = open.length - overdue.length - dueSoon.length;
    const list = (title, rows) => rows.length ? `<p style="margin:16px 0 6px;font-weight:600">${title}</p><ul style="padding-left:18px;margin:0">${rows.map((t) => `<li><a href="${ticketUrl(t.key)}">${esc(t.key)}</a> ${esc(t.title)}${t.dueDate ? ` <span style="color:#888">· due ${t.dueDate}</span>` : ""}</li>`).join("")}</ul>` : "";
    try {
      await sendEmail({ to: m.email, subject: `[KYNQ Tasks] ${overdue.length ? `${overdue.length} overdue · ` : ""}${open.length} open ticket${open.length === 1 ? "" : "s"}`, html: `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#111"><p>Good morning ${esc(m.name.split(" ")[0])}. Here's your work for today.</p>${list("Overdue", overdue)}${list("Due in the next 2 days", dueSoon)}${rest ? `<p style="margin-top:16px">Plus ${rest} more open ticket${rest === 1 ? "" : "s"}.</p>` : ""}<p><a href="${adminUrl()}/tasks/my/">Open my tickets</a></p></div>` });
      sent++;
    } catch (err) { console.error("[tasks] digest failed:", err.message); }
  }
  return sent;
}

let timer = null, running = false;
export async function runTaskJobs() {
  if (running) return;
  running = true;
  try {
    await ensureNotificationIndexes();
    await createDeadlineReminders();
    await sendPendingEmails();
    await sendDigests();
  } catch (err) { console.error("[tasks] background run failed:", err.message); }
  finally { running = false; }
}
/**
 * Every minute, inside the backend process (no dashboard needs to be open). On by default in
 * production only; locally set TASKS_JOBS=on (a dev backend may be pointed at the live DB).
 */
export function startTaskJobs() {
  const on = process.env.TASKS_JOBS ? process.env.TASKS_JOBS === "on" : process.env.NODE_ENV === "production";
  if (timer || !on) return;
  setTimeout(runTaskJobs, 45_000); // after the DB connects
  timer = setInterval(runTaskJobs, 60_000);
}
