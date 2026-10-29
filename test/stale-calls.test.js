// "already in a call" when nobody is in a call: stale active calls (lost to a restart) must never
// trap a user. Drives real Socket.io connections against a throwaway local database.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
process.env.KYNQ_RECONNECT_GRACE_MS = "300"; // sweep starts at 3× grace; keep the test fast
for (const k of ["EMAIL_USERNAME", "EMAIL_PASSWORD", "ADMIN_EMAIL"]) process.env[k] = "";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";
import { io as connect } from "socket.io-client";

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");
const C = (n) => mongoose.connection.collection(n);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;

let server, io, port, store, users = {};
const sockets = [];

async function makeUser(email) {
  const { getOrCreateUser, saveUser, createAuthSession } = await import("../src/gift/session.js");
  const { user } = await getOrCreateUser(email, email.split("@")[0]);
  await saveUser({ ...user, ageVerified: true, dob: "1998-01-01" });
  const { token } = await createAuthSession(user.id);
  return { id: user.id, token };
}
function open(u) {
  const s = connect(`http://127.0.0.1:${port}`, { path: "/kynq-extra/socket.io", transports: ["websocket"], extraHeaders: { cookie: `kynq_auth=${u.token}` }, reconnection: false });
  sockets.push(s);
  const resumed = new Promise((r) => s.on("call:resumed", r));
  return new Promise((res, rej) => { s.on("connect", () => res({ s, resumed })); s.on("connect_error", rej) });
}
const emit = (s, ev, payload = {}) => new Promise((r) => s.emit(ev, payload, r));
const callDoc = (id) => C("calls").findOne({ _key: id });
async function insertCall(id, a, b, startedAt, lastEventAt = startedAt) {
  await C("calls").insertOne({ _key: id, id, participantA: a, participantB: b, status: "active", startedAt, endedAt: null, endReason: null, events: [{ at: startedAt, kind: "started" }, { at: lastEventAt, kind: "connected" }] });
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_stale_calls$1"));
  await mongoose.connection.dropDatabase();
  store = await import("../src/kynqExtra/calls-store.js");
  const { initSignaling } = await import("../src/kynqExtra/signaling.js");
  server = http.createServer();
  io = initSignaling(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  for (const n of ["stuck", "peer", "alive1", "alive2", "joiner", "joinpeer"]) users[n] = await makeUser(`${n}@test.local`);
  await wait(1500); // let the server's first-minute reconnect allowance (3× grace) pass
});
after(async () => {
  if (!URI) return;
  for (const s of sockets) s.disconnect();
  (await import("../src/kynqExtra/matchmaker.js")).stopMatchmaker();
  await new Promise((r) => io.close(() => r()));
  await mongoose.disconnect();
});

test("store: history newest first, active lookup, stale close keeps rewards out", db, async () => {
  const U = "usr_store_a", O = "usr_store_b", now = Date.now();
  await insertCall("cs_old", U, O, now - 3 * DAY, now - 3 * DAY + 60_000);
  await insertCall("cs_new", O, U, now - DAY, now - DAY + 30_000);
  await C("calls").updateOne({ _key: "cs_old" }, { $set: { status: "ended" } });
  const history = await store.listCallsForUser(U, 10);
  assert.deepEqual(history.map((c) => c.id), ["cs_new", "cs_old"]);
  assert.equal((await store.findActiveCallForUser(U)).id, "cs_new");
  const ended = await store.endStaleCall("cs_new");
  assert.equal(ended.status, "ended");
  assert.equal(ended.endReason, "stale");
  assert.equal(ended.endedAt, now - DAY + 30_000, "ended at its last activity, not now");
  assert.equal(await store.endStaleCall("cs_old"), null, "an ended call is left alone");
});

test("a days-old leftover call is closed on connect, not resumed, and matching works", db, async () => {
  await insertCall("c_stuck", users.stuck.id, users.peer.id, Date.now() - 2 * DAY);
  const { s, resumed } = await open(users.stuck);
  const got = await Promise.race([resumed.then(() => "resumed"), wait(700).then(() => "not resumed")]);
  assert.equal(got, "not resumed");
  const doc = await callDoc("c_stuck");
  assert.equal(doc.status, "ended"); assert.equal(doc.endReason, "stale");
  const ack = await emit(s, "queue:join", { topics: [], locationScope: "worldwide" });
  assert.equal(ack?.ok, true, `queue:join should work, got ${JSON.stringify(ack)}`);
  await emit(s, "queue:leave");
});

test("a live call with the other person connected is still resumed after a reload", db, async () => {
  await open(users.alive2); // the other person is online (connected before this row appears)
  await insertCall("c_live", users.alive1.id, users.alive2.id, Date.now() - 60_000, Date.now() - 5_000);
  const { resumed } = await open(users.alive1); // fresh page load for alive1
  const payload = await Promise.race([resumed, wait(5000).then(() => null)]);
  assert.equal(payload?.callId, "c_live");
  assert.equal((await callDoc("c_live")).status, "active");
});

test("Start matching while a call is still attached ends that call instead of refusing", db, async () => {
  await open(users.joinpeer);
  await insertCall("c_attached", users.joiner.id, users.joinpeer.id, Date.now() - 30_000, Date.now() - 2_000);
  const { s, resumed } = await open(users.joiner);
  assert.equal((await Promise.race([resumed, wait(5000).then(() => null)]))?.callId, "c_attached");
  const ack = await emit(s, "queue:join", { topics: [], locationScope: "worldwide" });
  assert.equal(ack?.ok, true, `expected to join the queue, got ${JSON.stringify(ack)}`);
  const doc = await callDoc("c_attached");
  assert.equal(doc.status, "ended"); assert.equal(doc.endReason, "ended_by_user");
  await emit(s, "queue:leave");
});

test("the sweep closes calls nobody is in and leaves occupied ones alone", db, async () => {
  const { sweepStaleCallsNow } = await import("../src/kynqExtra/signaling.js");
  await insertCall("c_orphan", "usr_gone_1", "usr_gone_2", Date.now() - 5 * 3_600_000);
  const closed = await sweepStaleCallsNow();
  assert.ok(closed >= 1, "closed at least the orphan");
  assert.equal((await callDoc("c_orphan")).endReason, "stale");
  assert.equal((await callDoc("c_live")).status, "active", "alive1 is in c_live's room, so it stays");
});
