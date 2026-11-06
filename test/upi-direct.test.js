// Koins paid by UPI straight to our account: order + UPI link/QR, UTR checks (format, one UTR
// per order, owner only), Koins credited only when a person approves, rejection frees the UTR.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
for (const k of ["EMAIL_USERNAME", "EMAIL_PASSWORD", "ADMIN_EMAIL"]) process.env[k] = "";
process.env.UPI_VPA = "kynq@testbank";
process.env.UPI_PAYEE_NAME = "kynq Test Pvt Ltd";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");

let coins, wallet, buyer, other;
before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_upi$1"));
  await mongoose.connection.dropDatabase();
  coins = await import("../src/kynqExtra/coins.js");
  wallet = await import("../src/kynqExtra/wallet.js");
  const { getOrCreateUser } = await import("../src/gift/session.js");
  ({ user: buyer } = await getOrCreateUser("upi-buyer@test.local", "Buyer"));
  ({ user: other } = await getOrCreateUser("upi-other@test.local", "Other"));
});
after(async () => { if (URI) await mongoose.disconnect(); });

test("UPI order → UTR → approved: Koins credited once, only on approval", db, async () => {
  assert.equal(coins.upiDirectEnabled, true);
  const start = await wallet.getBalance(buyer.id);
  const { order, mode, upi } = await coins.createUpiCoinOrder({ user: buyer, packId: "pack_500" });
  assert.equal(mode, "upi");
  assert.match(upi.url, /^upi:\/\/pay\?pa=kynq%40testbank&pn=kynq%20Test%20Pvt%20Ltd&am=99\.00&cu=INR&tn=KYNQ%20[A-Z0-9]{8}$/);
  assert.match(upi.qrSvg, /^<svg/);

  await assert.rejects(coins.submitUpiUtr({ orderId: order.id, userId: buyer.id, utr: "12345" }), /12-digit/);
  await assert.rejects(coins.submitUpiUtr({ orderId: order.id, userId: other.id, utr: "123456789012" }), /not found/);
  const sent = await coins.submitUpiUtr({ orderId: order.id, userId: buyer.id, utr: "1234 5678 9012" });
  assert.equal(sent.status, "payment_review");
  assert.equal(await wallet.getBalance(buyer.id), start, "nothing credited before a person approves");

  // The same UTR can't pay a second order.
  const second = await coins.createUpiCoinOrder({ user: buyer, packId: "pack_500" });
  await assert.rejects(coins.submitUpiUtr({ orderId: second.order.id, userId: buyer.id, utr: "123456789012" }), /already been used/);

  assert.equal((await coins.listUpiOrders()).some((o) => o.id === order.id), true);
  const paid = await coins.approveUpiOrder(order.id, "admin@test.local");
  assert.equal(paid.status, "paid");
  await coins.approveUpiOrder(order.id, "admin@test.local");
  assert.equal(await wallet.getBalance(buyer.id), start + 500, "credited exactly once");
});

test("a rejected UTR is freed and the buyer can correct it", db, async () => {
  const { order } = await coins.createUpiCoinOrder({ user: buyer, packId: "pack_1000" });
  await coins.submitUpiUtr({ orderId: order.id, userId: buyer.id, utr: "999988887777" });
  const rejected = await coins.rejectUpiOrder(order.id, "admin@test.local", "not on the statement");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.lastFailure.note, "not on the statement");
  const again = await coins.submitUpiUtr({ orderId: order.id, userId: buyer.id, utr: "999988887778" });
  assert.equal(again.status, "payment_review");
});
