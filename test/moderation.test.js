// Nudity protection: the server's decisions (moderation.js). The device-side model is out of
// scope here; a stub stands in for the server's own re-score so every branch can be driven.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
for (const k of ["EMAIL_USERNAME", "EMAIL_PASSWORD", "ADMIN_EMAIL"]) process.env[k] = "";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");
const C = (n) => mongoose.connection.collection(n);
const HOUR = 3_600_000;
let mod, session;

const EXPLICIT = { Drawing: 0, Hentai: 0.05, Neutral: 0.02, Porn: 0.9, Sexy: 0.03 };
const LIKELY = { Drawing: 0, Hentai: 0.1, Neutral: 0.3, Porn: 0.5, Sexy: 0.1 };
const SAFE = { Drawing: 0.01, Hentai: 0.01, Neutral: 0.97, Porn: 0.005, Sexy: 0.005 };
const FRAME = "data:image/jpeg;base64," + "A".repeat(200);

let n = 0;
function call(me, peer) {
  const callId = `call_mod_${++n}`;
  return { callId, socket: { id: `sock_${n}_${Math.random()}`, data: { currentCallId: callId, peerScopedId: peer } }, me, peer };
}
async function send(c, { kind, scores, frame, server = EXPLICIT }) {
  const ended = [];
  const r = await mod.handleScore({ socket: c.socket, scopedId: c.me, payload: { callId: c.callId, kind, scores, frame }, endForModeration: async (callId, offender) => { ended.push({ callId, offender }); }, score: async () => server });
  return { r, ended };
}
const user = (id) => C("users").findOne({ id });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_moderation$1"));
  await mongoose.connection.dropDatabase();
  for (const id of ["u_nude", "u_victim", "u_victim2", "u_innocent", "u_liar"]) await C("users").insertOne({ id, email: `${id}@t.local`, name: id });
  mod = await import("../src/kynqExtra/moderation.js");
  session = await import("../src/gift/session.js");
});
after(async () => { if (URI) await mongoose.disconnect(); });

test("safe frames do nothing; likely ones are only logged", db, async () => {
  assert.deepEqual((await send(call("u_victim", "u_innocent"), { kind: "peer", scores: SAFE })).r, { ok: true });
  const { r, ended } = await send(call("u_victim", "u_innocent"), { kind: "peer", scores: LIKELY });
  assert.equal(r.ok, true); assert.equal(ended.length, 0);
  assert.equal(await C("moderation_events").countDocuments({ subject: "u_innocent", level: "medium" }), 1);
  assert.equal(session.isLockedOut(await user("u_innocent")), false);
});

test("explicit without a frame: the server asks for the frame first", db, async () => {
  const c = call("u_victim", "u_innocent");
  const { r, ended } = await send(c, { kind: "peer", scores: EXPLICIT });
  assert.equal(r.needFrame, true); assert.equal(ended.length, 0);
});

test("a fake report can't punish anyone: server re-score says safe → no action", db, async () => {
  const c = call("u_liar", "u_innocent");
  const { r, ended } = await send(c, { kind: "peer", scores: EXPLICIT, frame: FRAME, server: SAFE });
  assert.equal(r.confirmed, false); assert.equal(ended.length, 0);
  assert.equal(session.isLockedOut(await user("u_innocent")), false);
});

test("own camera confirmed explicit: call ends, 24 h lockout, then 7 days, then permanent", db, async () => {
  const before = Date.now();
  const first = await send(call("u_nude", "u_victim"), { kind: "self", scores: EXPLICIT, frame: FRAME });
  assert.equal(first.r.confirmed, true);
  assert.deepEqual(first.ended.map((e) => e.offender), ["u_nude"]);
  let u = await user("u_nude");
  assert.ok(u.kynqExtraRestrictedUntil >= before + 24 * HOUR - 5000 && u.kynqExtraRestrictedUntil <= Date.now() + 24 * HOUR + 5000, "about 24 h");
  assert.equal(session.isLockedOut(u), true);

  await send(call("u_nude", "u_victim"), { kind: "self", scores: EXPLICIT, frame: FRAME });
  u = await user("u_nude");
  assert.ok(u.kynqExtraRestrictedUntil >= Date.now() + 7 * 24 * HOUR - 10_000, "about 7 days");

  await send(call("u_nude", "u_victim"), { kind: "self", scores: EXPLICIT, frame: FRAME });
  u = await user("u_nude");
  assert.equal(u.kynqExtraRestricted, true, "permanent after the third");
  assert.equal(await C("moderation_strikes").countDocuments({ userId: "u_nude" }), 3);
});

test("seen by one viewer only: call ends, 1 h cool-down, kept for review; a second viewer makes it a strike", db, async () => {
  await C("users").insertOne({ id: "u_flasher", email: "f@t.local", name: "f" });
  const one = await send(call("u_victim", "u_flasher"), { kind: "peer", scores: EXPLICIT, frame: FRAME });
  assert.equal(one.r.confirmed, true);
  assert.deepEqual(one.ended.map((e) => e.offender), ["u_flasher"]);
  let u = await user("u_flasher");
  assert.ok(u.kynqExtraRestrictedUntil <= Date.now() + HOUR + 5000 && u.kynqExtraRestrictedUntil > Date.now() + HOUR - 5000, "about 1 h");
  assert.equal(await C("moderation_strikes").countDocuments({ userId: "u_flasher" }), 0);
  assert.equal(await C("moderation_events").countDocuments({ subject: "u_flasher", needsReview: true }), 1);

  await send(call("u_victim2", "u_flasher"), { kind: "peer", scores: EXPLICIT, frame: FRAME });
  u = await user("u_flasher");
  assert.equal(await C("moderation_strikes").countDocuments({ userId: "u_flasher" }), 1, "second viewer → strike");
  assert.ok(u.kynqExtraRestrictedUntil >= Date.now() + 24 * HOUR - 10_000, "24 h");
});

test("a timed lockout lapses on its own", db, async () => {
  assert.equal(session.isLockedOut({ kynqExtraRestrictedUntil: Date.now() - 1000 }), false);
  assert.equal(session.isLockedOut({ kynqExtraRestrictedUntil: Date.now() + 1000 }), true);
  assert.equal(session.isLockedOut({ kynqExtraRestricted: true }), true);
});

test("snapshot seconds are random, start early, and get sparser", db, async () => {
  const a = mod.shotSchedule(), b = mod.shotSchedule();
  assert.ok(a[0] >= 2 && a[0] <= 5);
  assert.notDeepEqual(a, b);
  assert.ok(a.filter((s) => s < 120).length >= 7, "frequent in the first 2 minutes");
  assert.ok(a.every((s, i) => i === 0 || s > a[i - 1]));
});

test("only the device in the call can report, and not faster than a scanner would", db, async () => {
  const c = call("u_victim", "u_innocent");
  const wrong = await mod.handleScore({ socket: c.socket, scopedId: c.me, payload: { callId: "other_call", kind: "peer", scores: EXPLICIT }, endForModeration: async () => {} });
  assert.equal(wrong.ok, false);
  await send(c, { kind: "peer", scores: SAFE });
  const flood = await send(c, { kind: "peer", scores: SAFE });
  assert.equal(flood.r.reason, "too fast");
});
