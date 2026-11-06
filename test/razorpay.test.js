// Razorpay payments end to end, with Razorpay's API stubbed: a Koin pack order, the checkout
// signature check (a forged one is refused), crediting exactly once (checkout callback + webhook),
// the webhook signature check, and a refund taking the Koins back.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
for (const k of ["EMAIL_USERNAME", "EMAIL_PASSWORD", "ADMIN_EMAIL"]) process.env[k] = "";
process.env.RAZORPAY_KEY_ID = "rzp_test_unit";
process.env.RAZORPAY_KEY_SECRET = "key_secret_unit";
process.env.RAZORPAY_WEBHOOK_SECRET = "webhook_secret_unit";
delete process.env.PAYMENT_PROVIDER;

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import mongoose from "mongoose";

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest("hex");
let server, base, user, coins, wallet;

// Razorpay's Orders API, stubbed: everything else goes to the real network stack (our own server).
const realFetch = globalThis.fetch;
const rzOrders = new Map();
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.razorpay.com/")) return realFetch(url, opts);
  if (opts.method === "POST" && u.endsWith("/v1/orders")) {
    const body = JSON.parse(opts.body);
    const o = { id: `order_${crypto.randomBytes(6).toString("hex")}`, entity: "order", amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes, status: "created" };
    rzOrders.set(o.id, o);
    return new Response(JSON.stringify(o), { status: 200 });
  }
  const m = u.match(/\/v1\/orders\/([^/]+)$/);
  if (m) return new Response(JSON.stringify(rzOrders.get(m[1]) ?? {}), { status: rzOrders.has(m[1]) ? 200 : 404 });
  return new Response("{}", { status: 404 });
};

const post = async (path, body, headers = {}) => {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const res = await realFetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: raw });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_razorpay$1"));
  await mongoose.connection.dropDatabase();
  const app = (await import("../src/app.js")).default;
  coins = await import("../src/kynqExtra/coins.js");
  wallet = await import("../src/kynqExtra/wallet.js");
  const { getOrCreateUser } = await import("../src/gift/session.js");
  ({ user } = await getOrCreateUser("payer@test.local", "Payer"));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (!URI) return;
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});

const balance = async () => (await wallet.getBalance(user.id));

test("a Koin pack is paid through Razorpay: verified once, credited once, refunded back", db, async () => {
  const start = await balance();
  const res = await coins.createCoinOrder({ user, packId: "pack_500", phone: "9999999999" });
  assert.equal(res.mode, "razorpay");
  assert.equal(res.razorpay.keyId, "rzp_test_unit");
  assert.equal(res.razorpay.amount, 9900, "₹99 is billed as 9900 paise");
  const orderId = res.order.id;
  const rzOrder = res.razorpay.orderId;
  assert.equal(rzOrders.get(rzOrder).receipt, orderId);

  // A forged signature is refused and nothing is credited.
  const bad = await post("/api/razorpay/verify", { orderId, razorpay_order_id: rzOrder, razorpay_payment_id: "pay_1", razorpay_signature: "deadbeef" });
  assert.equal(bad.status, 400);
  assert.equal(await balance(), start);

  // The real checkout callback credits the pack.
  const sig = hmac("key_secret_unit", `${rzOrder}|pay_1`);
  const good = await post("/api/razorpay/verify", { orderId, razorpay_order_id: rzOrder, razorpay_payment_id: "pay_1", razorpay_signature: sig });
  assert.equal(good.status, 200, JSON.stringify(good.json));
  assert.equal(await balance(), start + 500);

  // The webhook for the same payment arrives later: no second credit.
  const event = JSON.stringify({ event: "order.paid", payload: { order: { entity: { id: rzOrder, receipt: orderId } }, payment: { entity: { id: "pay_1", amount: 9900, amount_refunded: 0, notes: { kynq_order_id: orderId } } } } });
  const forged = await post("/api/webhooks/razorpay", event, { "X-Razorpay-Signature": "nope" });
  assert.equal(forged.status, 400);
  const wh = await post("/api/webhooks/razorpay", event, { "X-Razorpay-Signature": hmac("webhook_secret_unit", event) });
  assert.equal(wh.status, 200);
  assert.equal(await balance(), start + 500, "credited exactly once");
  assert.equal((await coins.getCoinOrder(orderId)).status, "paid");

  // A full refund takes the Koins back.
  const refund = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 9900 } }, payment: { entity: { id: "pay_1", amount: 9900, amount_refunded: 9900, notes: { kynq_order_id: orderId } } } } });
  const rf = await post("/api/webhooks/razorpay", refund, { "X-Razorpay-Signature": hmac("webhook_secret_unit", refund) });
  assert.equal(rf.status, 200);
  assert.equal((await coins.getCoinOrder(orderId)).status, "refunded");
  assert.equal(await balance(), start);
});

test("a payment that only reached Razorpay is picked up by the reconcile poll", db, async () => {
  const start = await balance();
  const res = await coins.createCoinOrder({ user, packId: "pack_1000" });
  rzOrders.get(res.razorpay.orderId).status = "paid"; // paid, but no callback and no webhook yet
  const order = await coins.reconcileCoinOrder(await coins.getCoinOrder(res.order.id));
  assert.equal(order.status, "paid");
  assert.equal(await balance(), start + 1000);
});
