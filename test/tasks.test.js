// Tasks: team from Admin → Team, ticket lifecycle, permissions, comments, notifications,
// JSON import, concurrent edits, reminders and digests, migration of old Founder OS tasks.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
for (const k of ["EMAIL_USERNAME", "EMAIL_PASSWORD", "ADMIN_EMAIL"]) process.env[k] = "";
process.env.ADMIN_EMAILS = "founder@test.local";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const tk = await import("../src/adminConsole/tasks/tickets.js");
const nt = await import("../src/adminConsole/tasks/notify.js");
const { TaskError, roster, clearRosterCache } = await import("../src/adminConsole/tasks/team.js");
const { today, addDays } = await import("../src/adminConsole/tasks/store.js");
const { upsertSubadmin } = await import("../src/adminConsole/subadmins.js");

const FOUNDER = { email: "founder@test.local", role: "owner", allowedSections: "all" };
// Subadmins with unrelated sections: Tasks needs no section grant.
const DEV = { email: "dev@test.local", role: "subadmin", allowedSections: ["moderation"] };
const MKT = { email: "mkt@test.local", role: "subadmin", allowedSections: ["inbox"] };
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof TaskError && e.code === code);
const inbox = async (who, type) => (await nt.listNotifications(who, { limit: 100 })).items.filter((n) => !type || n.type === type);

test("field validation", () => {
  assert.throws(() => tk.cleanTicketFields({ title: "" }, false), /title is required/);
  assert.throws(() => tk.cleanTicketFields({ title: "x", priority: "normal" }, false), /priority/);
  assert.throws(() => tk.cleanTicketFields({ title: "x", status: "blocked" }, false), /status/);
  assert.throws(() => tk.cleanTicketFields({ title: "x", dueDate: "20-10-2026" }, false), /YYYY-MM-DD/);
  assert.deepEqual(tk.cleanTicketFields({ title: "x", labels: ["Bug", "bug", "big fix"] }, false).labels, ["bug", "big-fix"]);
});

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");
before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_tasks$1")); await mongoose.connection.dropDatabase();
  await upsertSubadmin(DEV.email, "Dev Patel", ["moderation"], FOUNDER);
  await upsertSubadmin(MKT.email, "Meera Rao", ["inbox"], FOUNDER);
  clearRosterCache();
  // An old Founder OS task, as the earlier code stored it.
  await mongoose.connection.collection("fos_tasks").insertOne({ id: "tsk_old1", title: "Old blocked task", owner: DEV.email, priority: "normal", status: "blocked", blockerReason: "waiting", dueDate: null, createdBy: FOUNDER.email, createdAt: 1, updatedAt: 1, completedAt: null, history: [{ at: 1, by: FOUNDER.email, type: "created" }, { at: 2, by: MKT.email, type: "comment", text: "old comment" }] });
});
after(async () => { if (URI) await mongoose.disconnect(); });

test("team comes from Admin → Team: owners plus every active subadmin", db, async () => {
  const team = await roster();
  assert.deepEqual(team.map((m) => m.email).sort(), [DEV.email, FOUNDER.email, MKT.email].sort());
  assert.equal(team.find((m) => m.email === DEV.email).name, "Dev Patel");
});

test("old Founder OS tasks are migrated in place", db, async () => {
  await tk.ensureTickets();
  const t = await tk.getTicket("tsk_old1", FOUNDER);
  assert.match(t.key, /^KYNQ-\d+$/);
  assert.equal(t.status, "in_progress"); assert.equal(t.blocked, true); assert.equal(t.priority, "medium"); assert.equal(t.version, 0);
  assert.equal(t.comments.length, 1); assert.equal(t.comments[0].body, "old comment");
  await tk.migrate(); // idempotent
  assert.equal((await tk.getTicket("tsk_old1", FOUNDER)).comments.length, 1);
});

let T; // the main ticket
test("1-5: founder creates + assigns; dev is notified, opens it and moves it", db, async () => {
  T = await tk.createTicket({ title: "Fix video reconnect", description: "WebRTC drops", priority: "urgent", dueDate: addDays(today(), 3), labels: ["bug"], owner: DEV.email }, FOUNDER);
  assert.match(T.key, /^KYNQ-\d+$/);
  const [n] = await inbox(DEV, "assigned");
  assert.equal(n.ticketKey, T.key); assert.equal(n.actor, FOUNDER.email);
  assert.equal((await inbox(FOUNDER)).length, 0, "the actor isn't notified");
  const seen = await tk.getTicket(T.key, DEV);
  assert.equal(seen.canEdit, true); assert.equal(seen.canPlan, false);
  const moved = await tk.updateTicket(T.key, { status: "in_progress", version: seen.version }, DEV);
  assert.equal(moved.status, "in_progress"); assert.equal(moved.version, 1);
  assert.equal(moved.history.at(-1).type, "status");
});

test("6-9: comments, replies and @mentions notify the right people once", db, async () => {
  const c1 = await tk.addComment(T.key, { body: "Found the reconnect issue. Working on a fix." }, DEV);
  assert.equal((await inbox(FOUNDER, "reply")).length, 1, "founder (creator) gets the reply");
  await tk.addComment(T.key, { body: "@dev please update once tested.", parentId: c1.id }, FOUNDER);
  const mentions = await inbox(DEV, "mention");
  assert.equal(mentions.length, 1);
  assert.equal((await inbox(DEV, "reply")).length, 0, "a mention isn't also a reply notification");
  // Mentioning someone shares the ticket with them.
  await tk.addComment(T.key, { body: "@mkt can you prep a post about this?" }, FOUNDER);
  assert.equal((await tk.getTicket(T.key, MKT)).key, T.key);
  assert.equal((await inbox(MKT, "mention")).length, 1);
  // Edit/delete: only the author or the founder.
  await rejects(tk.editComment(c1.id, { body: "hijack" }, MKT), "forbidden");
  assert.equal((await tk.editComment(c1.id, { body: "Fixed, testing now." }, DEV)).body, "Fixed, testing now.");
  assert.equal((await tk.deleteComment(c1.id, FOUNDER)).deleted, true);
});

test("in review, reopen and reassign notifications", db, async () => {
  await tk.updateTicket(T.key, { status: "in_review" }, DEV);
  assert.equal((await inbox(FOUNDER, "in_review")).length, 1);
  await tk.updateTicket(T.key, { status: "done" }, FOUNDER);
  await tk.updateTicket(T.key, { status: "todo" }, FOUNDER);
  assert.equal((await inbox(DEV, "reopened")).length, 1);
  await tk.updateTicket(T.key, { owner: MKT.email }, FOUNDER);
  assert.equal((await inbox(MKT, "assigned")).length, 1);
  assert.equal((await inbox(DEV, "reassigned")).length, 1);
  await tk.updateTicket(T.key, { owner: DEV.email }, FOUNDER);
});

test("12: permissions are enforced per ticket", db, async () => {
  const secret = await tk.createTicket({ title: "Founder-only planning" }, FOUNDER);
  await rejects(tk.getTicket(secret.key, DEV), "not_found");
  await rejects(tk.addComment(secret.key, { body: "hi" }, DEV), "not_found");
  await rejects(tk.updateTicket(secret.key, { status: "done" }, DEV), "not_found");
  assert.ok(!(await tk.listTickets({ view: "all" }, DEV)).items.some((t) => t.key === secret.key));
  assert.ok(!(await tk.listTickets({ q: "Founder-only" }, DEV)).items.length, "search respects access");
  // Assignee can't change priority/due date or reassign; can't assign others when creating.
  await rejects(tk.updateTicket(T.key, { priority: "low" }, DEV), "forbidden");
  await rejects(tk.updateTicket(T.key, { owner: MKT.email }, DEV), "forbidden");
  await rejects(tk.createTicket({ title: "x", owner: MKT.email }, DEV), "forbidden");
  await rejects(tk.updateTicket(T.key, { watchers: [MKT.email] }, DEV), "forbidden");
  // A watcher (shared via mention) can view and comment but not edit.
  await rejects(tk.updateTicket(T.key, { status: "done" }, MKT), "forbidden");
  // Own ticket: full control over planning fields.
  const own = await tk.createTicket({ title: "Dev's own ticket", priority: "low" }, DEV);
  assert.equal((await tk.updateTicket(own.key, { priority: "high", dueDate: today() }, DEV)).priority, "high");
  await rejects(tk.deleteTicket(T.key, DEV), "forbidden");
  // Notifications are private to their recipient.
  const [n] = await inbox(DEV);
  assert.equal((await nt.markRead(MKT, [n.id])).updated, 0);
  assert.equal((await nt.markRead(DEV, [n.id])).updated, 1);
});

test("concurrent edits: a stale version is refused", db, async () => {
  const t = await tk.getTicket(T.key, FOUNDER);
  await tk.updateTicket(T.key, { title: "Fix video reconnect (Android)", version: t.version }, FOUNDER);
  await rejects(tk.updateTicket(T.key, { status: "in_progress", version: t.version }, DEV), "conflict");
});

test("10-11: JSON import — validation, unknown assignees, confirm, idempotent, notifications", db, async () => {
  const json = { tickets: [
    { title: "Publish 5 reels", assigneeEmail: MKT.email, priority: "high", status: "todo", labels: ["marketing"] },
    { title: "Fix TURN fallback", assigneeEmail: DEV.email, priority: "urgent", dueDate: today() },
    { title: "Ghost task", assigneeEmail: "nobody@test.local", owner: "x" },
  ] };
  await rejects(tk.previewImport(json, DEV), "forbidden");
  const p = await tk.previewImport(json, FOUNDER);
  assert.equal(p.valid, false); assert.equal(p.errors, 1);
  assert.equal(p.rows[2].unknownAssignee, "nobody@test.local");
  assert.match(p.rows[2].errors.join(";"), /unknown field: owner/);
  const failed = await tk.commitImport({ ...json, idempotencyKey: "import-test-1" }, FOUNDER);
  assert.equal(failed.committed, false); assert.equal(failed.created.length, 0);
  json.tickets.pop();
  const r = await tk.commitImport({ ...json, idempotencyKey: "import-test-1" }, FOUNDER);
  assert.equal(r.committed, true); assert.equal(r.created.length, 2);
  const n = Number(r.created[0].key.split("-")[1]);
  assert.equal(r.created[1].key, `KYNQ-${n + 1}`, "consecutive keys");
  const again = await tk.commitImport({ ...json, idempotencyKey: "import-test-1" }, FOUNDER);
  assert.equal(again.duplicate, true); assert.deepEqual(again.created.map((c) => c.key), r.created.map((c) => c.key));
  assert.equal((await tk.listTickets({ q: "Publish 5 reels" }, FOUNDER)).total, 1, "no duplicates");
  assert.ok((await inbox(MKT, "assigned")).some((x) => x.ticketKey === r.created[0].key));
  const board = await tk.listTickets({ view: "all", status: "open" }, DEV);
  assert.ok(board.items.some((t) => t.key === r.created[1].key), "assignee sees imported ticket");
});

test("deadline reminders run once per ticket per due date", db, async () => {
  const late = await tk.createTicket({ title: "Late thing", owner: DEV.email, dueDate: addDays(today(), -2) }, FOUNDER);
  await nt.createDeadlineReminders(); await nt.createDeadlineReminders();
  const od = (await inbox(DEV, "overdue")).filter((x) => x.ticketKey === late.key);
  assert.equal(od.length, 1);
  const soon = (await inbox(DEV, "due_soon"));
  assert.ok(soon.length >= 1);
  assert.equal(new Set(soon.map((x) => x.ticketKey)).size, soon.length, "one per ticket");
});

test("emails: pending flags clear even with email off; digest claims the day once", db, async () => {
  assert.ok((await mongoose.connection.collection("task_notifications").countDocuments({ emailPending: true })) > 0);
  await nt.sendPendingEmails();
  assert.equal(await mongoose.connection.collection("task_notifications").countDocuments({ emailPending: true }), 0);
  process.env.TASKS_DIGEST_AT = "00:00";
  await nt.sendDigests(); await nt.sendDigests();
  assert.equal(await mongoose.connection.collection("task_digests").countDocuments({ kind: "digest" }), 3, "one per team member per day");
});

test("overview counts and lists", db, async () => {
  const o = await tk.overview(FOUNDER);
  assert.ok(o.counts.open >= 4); assert.ok(o.counts.overdue >= 1); assert.ok(o.counts.blocked >= 1);
  assert.ok(o.attention.some((t) => t.reason.startsWith("Blocked")));
  assert.ok(o.workload.find((w) => w.email === DEV.email).open >= 2);
  const mine = await tk.overview(DEV);
  assert.equal(mine.workload, null);
  assert.ok(mine.mine.every((t) => t.owner === DEV.email));
  assert.ok((await tk.listTickets({ flag: "overdue" }, FOUNDER)).items.every((t) => t.overdue));
});
