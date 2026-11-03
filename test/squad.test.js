// Duo mode (squad.js): two friends match together with another duo or one solo person.
// Drives real Socket.io connections, signed in as real users, against a throwaway local database.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
for (const k of ["EMAIL_USERNAME", "EMAIL_PASSWORD", "ADMIN_EMAIL"]) process.env[k] = "";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";
import { io as connect } from "socket.io-client";

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let server, io, port, squad;
const sockets = [];
const users = {};

async function makeUser(name) {
  const { getOrCreateUser, saveUser, createAuthSession } = await import("../src/gift/session.js");
  const { user } = await getOrCreateUser(`${name}@test.local`, name);
  await saveUser({ ...user, name, ageVerified: true, dob: "1998-01-01" });
  const { token } = await createAuthSession(user.id);
  return { id: user.id, token };
}
// A signed-in device that remembers the latest sq:state and every event it saw.
async function device(name) {
  const s = connect(`http://127.0.0.1:${port}`, { path: "/kynq-extra/socket.io", transports: ["websocket"], extraHeaders: { cookie: `kynq_auth=${users[name].token}` }, reconnection: false });
  sockets.push(s);
  const d = { s, id: users[name].id, state: null, events: [] };
  s.on("sq:state", (st) => { d.state = st; });
  s.onAny((ev, p) => d.events.push({ ev, p }));
  await new Promise((res, rej) => { s.on("connect", res); s.on("connect_error", rej); });
  return d;
}
const emit = (d, ev, payload = {}) => new Promise((r) => d.s.emit(ev, payload, r));
async function until(check, ms = 8000, what = "condition") {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return; await wait(40); }
  assert.fail(`timed out waiting for ${what}`);
}
const inCall = (d, n) => d.state?.room?.kind === "call" && d.state.room.members.length === n;
async function makeDuo(a, b) {
  const made = await emit(a, "duo:create");
  assert.equal(made.ok, true);
  const joined = await emit(b, "duo:join", { code: made.state.duo.code });
  assert.equal(joined.ok, true, joined.reason);
  await until(() => a.state?.duo?.members.length === 2, 3000, "both in the duo");
  return made.state.duo;
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_squad$1"));
  await mongoose.connection.dropDatabase();
  const { initSignaling } = await import("../src/kynqExtra/signaling.js");
  squad = await import("../src/kynqExtra/squad.js");
  server = http.createServer();
  io = initSignaling(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  for (const n of ["asha", "bilal", "chen", "divya", "esha", "farid", "gopal", "hari", "isha", "jay"]) users[n] = await makeUser(n);
});
after(async () => {
  if (!URI) return;
  for (const s of sockets) s.disconnect();
  (await import("../src/kynqExtra/matchmaker.js")).stopMatchmaker();
  await new Promise((r) => io.close(() => r()));
  await mongoose.disconnect();
});

test("a friend joins with the code; a wrong code and a full duo are refused", db, async () => {
  const a = await device("asha"), b = await device("bilal"), c = await device("chen");
  const duo = await makeDuo(a, b);
  assert.equal(b.state.duo.id, duo.id);
  assert.deepEqual(a.state.duo.members.map((m) => m.name).sort(), ["asha", "bilal"]);
  assert.equal(a.state.room.kind, "lobby");
  assert.equal((await emit(c, "duo:join", { code: "NOPE42" })).ok, false);
  assert.match((await emit(c, "duo:join", { code: duo.code })).reason, /full/);
  // Can't search until the duo is complete.
  const solo = await emit(c, "duo:create");
  assert.match((await emit(c, "duo:queue")).reason, /friend/);
  assert.ok(solo.state.duo.code);
  for (const d of [a, b, c]) await emit(d, "duo:leave");
  assert.equal(a.state.duo, null);
});

test("duo meets duo: 4 people in one call, signals only reach people in it, Next sends both duos back", db, async () => {
  const a = await device("asha"), b = await device("bilal"), c = await device("chen"), d = await device("divya"), e = await device("esha");
  await makeDuo(a, b);
  await makeDuo(c, d);
  assert.equal((await emit(a, "duo:queue")).ok, true);
  assert.equal((await emit(c, "duo:queue")).ok, true);
  await until(() => [a, b, c, d].every((x) => inCall(x, 4)), 5000, "a 4-person call");
  const roomId = a.state.room.id;
  assert.ok([b, c, d].every((x) => x.state.room.id === roomId));

  // WebRTC signaling goes to the named person in the room, and nobody outside can use it.
  a.s.emit("sq:signal", { to: d.id, type: "offer", payload: { sdp: "x" } });
  await until(() => d.events.some((x) => x.ev === "sq:signal" && x.p.from === a.id), 2000, "the offer to reach divya");
  e.s.emit("sq:signal", { to: d.id, type: "offer", payload: { sdp: "evil" } });
  a.s.emit("sq:chat", { text: "hi all" });
  await until(() => [b, c, d].every((x) => x.events.some((y) => y.ev === "sq:chat" && y.p.text === "hi all")), 2000, "chat to everyone");
  assert.ok(!d.events.some((x) => x.ev === "sq:signal" && x.p.from === e.id), "outsider's signal must not arrive");

  // Next: the call ends; each duo is back in its own lobby and searching again, but not
  // straight back with each other.
  assert.equal((await emit(b, "sq:next")).ok, true);
  await until(() => [a, b, c, d].every((x) => x.state.room?.kind === "lobby" && x.state.duo?.queued), 3000, "both duos back in lobbies, searching");
  assert.ok(a.events.some((x) => x.ev === "sq:ended" && x.p.reason === "next"));
  assert.equal(a.state.room.id, b.state.room.id, "friends share a lobby");
  assert.notEqual(a.state.room.id, c.state.room.id);
  await wait(1500);
  assert.ok(!inCall(a, 4), "the same two duos aren't instantly rematched");
  for (const x of [a, b, c, d, e]) await emit(x, "duo:leave");
});

test("a waiting duo gets first pick over a 1:1 match", db, async () => {
  const a = await device("asha"), b = await device("bilal"), c = await device("chen"), d = await device("divya");
  await makeDuo(a, b);
  await emit(a, "duo:queue");
  await wait(3200);
  // Two solo people who allow duos arrive together: one goes to the duo, the other waits.
  await Promise.all([emit(c, "queue:join", { squadOk: true }), emit(d, "queue:join", { squadOk: true })]);
  await until(() => inCall(a, 3), 4000, "the duo to get one of them");
  for (const x of [a, b, c, d]) { await emit(x, "duo:leave"); await emit(x, "queue:leave"); }
});

test("a duo takes a solo person who allows duos; their Next sends them back to 1:1 and the duo keeps searching", db, async () => {
  const f = await device("farid"), g = await device("gopal"), h = await device("hari"), i = await device("isha");
  await makeDuo(f, g);
  // hari searches 1:1 WITHOUT allowing duos: never taken.
  assert.equal((await emit(h, "queue:join", {})).ok, true);
  assert.equal((await emit(f, "duo:queue")).ok, true);
  await wait(4000);
  assert.ok(!inCall(f, 3), "someone who didn't allow duos is never taken");
  await emit(h, "queue:leave");
  // isha allows duos (the default on the web): the duo has waited, so it gets her first.
  assert.equal((await emit(i, "queue:join", { squadOk: true })).ok, true);
  await until(() => [f, g, i].every((x) => inCall(x, 3)), 8000, "a 3-person call");
  assert.ok(i.events.some((x) => x.ev === "squad:matched"), "the solo person is told to open the group call");
  assert.ok(!h.state?.room, "someone who didn't allow duos is never pulled in");

  // The solo person can't be matched 1:1 meanwhile (they left the queue).
  assert.equal((await emit(i, "sq:next")).ok, true);
  await until(() => i.state?.room === null && f.state.room?.kind === "lobby" && f.state.duo?.queued, 3000, "solo out, duo searching again");
  assert.ok(i.events.some((x) => x.ev === "sq:ended"));
  for (const x of [f, g, h, i]) { await emit(x, "duo:leave"); await emit(x, "queue:leave"); }
});

test("blocked people are never put in the same call, and a duo member searching 1:1 leaves the duo", db, async () => {
  const { blockUser } = await import("../src/kynqExtra/blocks.js");
  const a = await device("asha"), b = await device("bilal"), j = await device("jay");
  await blockUser(users.jay.id, users.bilal.id);
  await makeDuo(a, b);
  await emit(a, "duo:queue");
  await emit(j, "queue:join", { squadOk: true });
  await wait(5500);
  assert.ok(!inCall(a, 3), "jay blocked bilal: no call");
  await emit(j, "queue:leave");

  // jay can't join a duo with someone he blocked either.
  assert.equal((await emit(j, "duo:join", { code: a.state.duo.code })).ok, false);

  // bilal starts a normal 1:1 search: he leaves the duo, asha stays and stops searching.
  await emit(b, "queue:join", {});
  await until(() => a.state.duo?.members.length === 1 && !a.state.duo.queued, 3000, "asha alone, not searching");
  await emit(b, "queue:leave");
  await emit(a, "duo:leave");
});

test("moderation only accepts reports about people in the same group call", db, async () => {
  assert.equal(squad.inSquadCall("nobody", "sqc_missing", "x"), false);
});
