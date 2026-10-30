// Push notifications: token bookkeeping (push.js). Sending through Firebase is exercised against a
// real phone separately; here FIREBASE_SERVICE_ACCOUNT_B64 is unset, so sends must be silent no-ops.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
delete process.env.FIREBASE_SERVICE_ACCOUNT_B64;
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");
const C = () => mongoose.connection.collection("push_tokens");
const tok = (n) => `fcm_token_${n}_${"x".repeat(40)}`;
let push;

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_push$1"));
  await mongoose.connection.dropDatabase();
  push = await import("../src/kynqExtra/push.js");
});
after(async () => { if (URI) await mongoose.disconnect(); });

test("a phone registers once; registering again just refreshes it", db, async () => {
  await push.registerToken("u1", tok(1));
  await push.registerToken("u1", tok(1));
  assert.equal(await C().countDocuments({ token: tok(1) }), 1);
});

test("a shared phone's token moves to whoever signed in last", db, async () => {
  await push.registerToken("u2", tok(1));
  assert.equal((await C().findOne({ token: tok(1) })).userId, "u2");
  assert.equal(await C().countDocuments({ userId: "u1" }), 0);
});

test("junk tokens are refused", db, async () => {
  await assert.rejects(push.registerToken("u1", "short"));
  await assert.rejects(push.registerToken("u1", 12345));
});

test("at most 5 phones per person (the newest)", db, async () => {
  for (let i = 10; i < 17; i++) { await push.registerToken("u3", tok(i)); await new Promise((r) => setTimeout(r, 3)); }
  const left = (await C().find({ userId: "u3" }).toArray()).map((t) => t.token);
  assert.equal(left.length, 5);
  assert.ok(left.includes(tok(16)) && !left.includes(tok(10)));
});

test("signing out and deleting the account stop notifications", db, async () => {
  await push.unregisterToken(tok(16));
  assert.equal(await C().countDocuments({ token: tok(16) }), 0);
  await push.deleteTokensForUser("u3");
  assert.equal(await C().countDocuments({ userId: "u3" }), 0);
});

test("without Firebase configured, sending is a silent no-op", db, async () => {
  assert.equal(push.pushConfigured(), false);
  assert.deepEqual(await push.notify.message("u2", { fromId: "u9", fromName: "A", text: "hi" }), { sent: 0 });
});

test("broadcast refuses when push isn't configured (no silent 'sent: 0' for a campaign)", db, async () => {
  await assert.rejects(push.broadcast({ title: "Hi", body: "There" }), /isn't configured/);
  await assert.rejects(push.broadcast({ title: "", body: "There" }), /required/);
});

test("promo templates are short enough for a phone banner", db, async () => {
  for (const t of push.PROMO_TEMPLATES) { assert.ok(t.title.length <= 40, t.title); assert.ok(t.body.length <= 120, t.body); assert.ok(t.route.startsWith("/m/")); }
});
