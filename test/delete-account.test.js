// Account deletion: personal data gone, legal/safety records anonymised or kept, others untouched.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
for (const k of ["EMAIL_USERNAME", "EMAIL_PASSWORD", "ADMIN_EMAIL"]) process.env[k] = "";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");
const C = (n) => mongoose.connection.collection(n);

let deleteAccount, getOrCreateUser, createAuthSession;
before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_delete_account$1")); await mongoose.connection.dropDatabase();
  ({ deleteAccount } = await import("../src/gift/delete-account.js"));
  ({ getOrCreateUser, createAuthSession } = await import("../src/gift/session.js"));
});
after(async () => { if (URI) await mongoose.disconnect(); });

test("delete account: deletes personal data, anonymises what must be kept, leaves others alone", db, async () => {
  const { user: me } = await getOrCreateUser("leaving@test.local", "Leaving Person");
  const { user: other } = await getOrCreateUser("staying@test.local", "Staying Person");
  const U = me.id, O = other.id;
  assert.match(U, /^usr_/); assert.match(O, /^usr_/);
  await createAuthSession(U);
  await C("wallet_balances").insertOne({ _key: U, userId: U, balance: 40 });
  await C("wallet_transactions").insertOne({ userId: U, type: "purchase", amount: 100 });
  await C("friendships").insertOne({ _key: `${U}:${O}`, a: U, b: O });
  await C("dm_messages").insertOne({ from: U, to: O, text: "hi" });
  await C("blocks").insertOne({ blockerScopedId: O, blockedScopedId: U });
  await C("calls").insertOne({ _key: "call1", participantA: U, participantB: O });
  await C("chat_messages").insertOne({ _key: "call1", messages: [{ from: U, text: "hello" }] });
  await C("coin_orders").insertOne({ id: "co1", userId: U, status: "paid", invoiceNo: "KQ/2026-27/0001", customer: { id: U, name: "Leaving Person", email: "leaving@test.local", phone: "999" } });
  await C("orders").insertOne({ id: "o1", userId: U, customer: { name: "Leaving Person", email: "leaving@test.local" }, shippingAddress: { line1: "1 Street", city: "Pune", state: "MH", country: "IN" } });
  await C("kynqextrareports").insertOne({ reporterScopedId: O, reportedScopedId: U, reason: "abuse" });
  await C("kynqextrareports").insertOne({ reporterScopedId: U, reportedScopedId: O, reason: "spam" });
  await C("filter_unlocks").insertOne({ _key: `${U}:puppy` });
  await C("pair_question_answers").insertOne({ qid: "q1", picks: [{ userId: U, choice: 0 }, { userId: O, choice: 1 }] });
  await C("friendships").insertOne({ _key: "x:y", a: "x", b: O }); // unrelated

  const r = await deleteAccount(me);
  assert.match(r.anonId, /^del_[0-9a-f]{20}$/);

  // Personal data is gone.
  assert.equal(await C("users").countDocuments({ id: U }), 0);
  assert.equal(await C("auth-sessions").countDocuments({ userId: U }), 0);
  assert.equal(await C("wallet_balances").countDocuments({ _key: U }), 0);
  assert.equal(await C("friendships").countDocuments({ $or: [{ a: U }, { b: U }] }), 0);
  assert.equal(await C("dm_messages").countDocuments({ from: U }), 0);
  assert.equal(await C("blocks").countDocuments({ blockedScopedId: U }), 0);
  assert.equal(await C("chat_messages").countDocuments({ _key: "call1" }), 0);
  assert.equal(await C("filter_unlocks").countDocuments({}), 0);

  // Kept but anonymised.
  const co = await C("coin_orders").findOne({ id: "co1" });
  assert.equal(co.userId, r.anonId); assert.equal(co.invoiceNo, "KQ/2026-27/0001"); assert.equal(co.customer.email, null);
  const o = await C("orders").findOne({ id: "o1" });
  assert.deepEqual(o.shippingAddress, { state: "MH", country: "IN" }); assert.equal(o.customer.name, "Deleted user");
  assert.equal((await C("wallet_transactions").findOne({})).userId, r.anonId);
  assert.equal((await C("calls").findOne({ _key: "call1" })).participantA, r.anonId);
  assert.equal((await C("pair_question_answers").findOne({ qid: "q1" })).picks[0].userId, r.anonId);
  assert.equal((await C("kynqextrareports").findOne({ reason: "spam" })).reporterScopedId, r.anonId);
  // Reports ABOUT them stay as they are (safety).
  assert.equal((await C("kynqextrareports").findOne({ reason: "abuse" })).reportedScopedId, U);

  // Other people are untouched; the deletion is recorded without the email.
  assert.equal(await C("users").countDocuments({ id: O }), 1);
  assert.equal(await C("friendships").countDocuments({ _key: "x:y" }), 1);
  const tomb = await C("deleted_accounts").findOne({ anonId: r.anonId });
  assert.ok(tomb && tomb.emailHash && !JSON.stringify(tomb).includes("leaving@test.local"));

  // Idempotent.
  await deleteAccount(me);
});
