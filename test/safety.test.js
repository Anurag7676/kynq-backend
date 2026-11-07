// Appeals ("I was wrongly blocked"), the caution flag for risky accounts, and the safety stats.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
for (const k of ["EMAIL_USERNAME", "EMAIL_PASSWORD", "ADMIN_EMAIL"]) process.env[k] = "";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");

let appeals, stats, profile, user, old;
const col = (n) => mongoose.connection.collection(n);
before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_safety$1"));
  await mongoose.connection.dropDatabase();
  appeals = await import("../src/kynqExtra/appeals.js");
  stats = await import("../src/kynqExtra/safety-stats.js");
  profile = await import("../src/kynqExtra/profile.js");
  const { getOrCreateUser } = await import("../src/gift/session.js");
  ({ user } = await getOrCreateUser("locked@test.local", "Locked Person"));
  ({ user: old } = await getOrCreateUser("old@test.local", "Old Hand"));
  await col("users").updateOne({ id: old.id }, { $set: { createdAt: Date.now() - 30 * 86_400_000 } });
});
after(async () => { if (URI) await mongoose.disconnect(); });

test("a locked-out person appeals with the token; unblocking lifts the lock and the strikes", db, async () => {
  await col("users").updateOne({ id: user.id }, { $set: { kynqExtraRestrictedUntil: Date.now() + 86_400_000, kynqExtraRestrictedReason: "nudity" } });
  await col("moderation_strikes").insertOne({ userId: user.id, at: Date.now(), level: 1 });
  const token = await appeals.appealTokenFor(user.id);
  await assert.rejects(appeals.submitAppeal({ token: "nope", message: "I was only showing my face, please check." }), /expired/);
  await assert.rejects(appeals.submitAppeal({ token, message: "no" }), /more/);
  await appeals.submitAppeal({ token, message: "I was only showing my face, please check." });
  await appeals.submitAppeal({ token, message: "Second message replaces the first one." });
  const open = await appeals.listAppeals();
  assert.equal(open.length, 1, "one open appeal per person");
  assert.equal(open[0].message, "Second message replaces the first one.");
  assert.equal(open[0].strikes, 1);
  await appeals.resolveAppeal(open[0].id, "unblock", { email: "mod@test.local" });
  const u = await col("users").findOne({ id: user.id });
  assert.equal(Number(u.kynqExtraRestrictedUntil) || 0, 0);
  assert.equal(await col("moderation_strikes").countDocuments({ userId: user.id }), 0);
  assert.equal((await appeals.listAppeals()).length, 0);
});

test("caution: new accounts and people with recent nudity strikes", db, async () => {
  assert.equal((await profile.publicCard(user.id)).caution, true, "under 3 days old");
  assert.equal((await profile.publicCard(old.id)).caution, false);
  await col("moderation_strikes").insertOne({ userId: old.id, at: Date.now(), level: 1 });
  assert.equal((await profile.publicCard(old.id)).caution, true, "a recent strike");
});

test("safety stats: per-call summaries by viewer gender, counted once; lockouts vs overturned", db, async () => {
  await stats.recordShieldSummary({ viewer: "a", gender: "female", callId: "c1", blurred: true, noFace: true, reported: true });
  await stats.recordShieldSummary({ viewer: "a", gender: "female", callId: "c1", blurred: true, blocked: true });
  await stats.recordShieldSummary({ viewer: "b", gender: "male", callId: "c1" });
  const s = await stats.safetyStats(7);
  assert.equal(s.totals.callsWatched, 2);
  assert.equal(s.totals.femaleCalls, 1);
  assert.equal(s.totals.blurredRate, 0.5);
  assert.equal(s.totals.femaleReportsPer1000, 1000);
  assert.equal(s.totals.blockedRate, 0.5, "a later update adds the new flag, not another call");
  assert.equal(s.totals.overturned, 1, "the appeal's unblock counts as overturned");
});
