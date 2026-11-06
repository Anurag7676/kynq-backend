// Koin card payments taken by kynq.online, with kynq.online stubbed: the signed create call, the
// redirect, the signed result callback (forged / stale / wrong amount / wrong payment refused),
// crediting exactly once, reconcile by status check, expiry, and kynq.in's own Cashfree never used.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
for (const k of ["EMAIL_USERNAME", "EMAIL_PASSWORD", "ADMIN_EMAIL", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]) process.env[k] = "";
process.env.CLIENT_URL = "https://kynq.in";
process.env.KYNQ_ONLINE_API_URL = "https://kynq-online.test";
process.env.KYNQ_ONLINE_PARTNER_SECRET = "partner_secret_unit";
// kynq.in's own Cashfree keys present on purpose: Koins must still go through kynq.online.
process.env.CASHFREE_APP_ID = "cf_app_unit";
process.env.CASHFREE_SECRET_KEY = "cf_secret_unit";
process.env.PAYMENT_PROVIDER = "cashfree";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import mongoose from "mongoose";

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");

const SECRET = process.env.KYNQ_ONLINE_PARTNER_SECRET;
const sign = (ts, method, path, body) => crypto.createHmac("sha256", SECRET).update(`${ts}.${method}.${path}.${body}`).digest("hex");

// kynq.online's partner API, stubbed. It checks kynq.in's signature on every call.
const realFetch = globalThis.fetch;
const online = { payments: new Map(), calls: [], cashfreeCalls: 0 };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname.endsWith("cashfree.com")) { online.cashfreeCalls++; return new Response("{}", { status: 500 }); }
  if (u.origin !== "https://kynq-online.test") return realFetch(url, opts);
  const h = opts.headers;
  const body = opts.body ?? "";
  const signed = h["X-KQ-Partner"] === "kynq.in" && h["X-KQ-Signature"] === sign(h["X-KQ-Timestamp"], opts.method, u.pathname, body);
  online.calls.push({ method: opts.method, path: u.pathname, signed, body: body ? JSON.parse(body) : null });
  if (!signed) return new Response(JSON.stringify({ message: "bad signature" }), { status: 401 });
  if (opts.method === "POST" && u.pathname === "/api/payments/partner") {
    const b = JSON.parse(body);
    const p = online.payments.get(b.reference) ?? {
      id: `kqp_${crypto.randomBytes(16).toString("base64url")}`, reference: b.reference, status: "pending", amount: b.amount,
      currency: "INR", provider: "cashfree", providerPaymentId: null, paidAt: null,
    };
    p.checkoutUrl = `https://kynq-online.test/pay/?id=${p.id}`;
    online.payments.set(b.reference, p);
    return new Response(JSON.stringify({ payment: p }), { status: 201 });
  }
  const m = u.pathname.match(/^\/api\/payments\/partner\/([^/]+)$/);
  if (opts.method === "GET" && m) {
    const p = online.payments.get(decodeURIComponent(m[1]));
    return p ? new Response(JSON.stringify({ payment: p }), { status: 200 }) : new Response("{}", { status: 404 });
  }
  return new Response("{}", { status: 404 });
};

let server, base, user, coins, wallet;
before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_kynq_online$1"));
  await mongoose.connection.dropDatabase();
  const app = (await import("../src/app.js")).default;
  coins = await import("../src/kynqExtra/coins.js");
  wallet = await import("../src/kynqExtra/wallet.js");
  const { getOrCreateUser } = await import("../src/gift/session.js");
  ({ user } = await getOrCreateUser("koin-buyer@test.local", "Koin Buyer"));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (!URI) return;
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});

const balance = () => wallet.getBalance(user.id);
function callback(event, payment, { ts = String(Date.now()), secret = SECRET } = {}) {
  const raw = JSON.stringify({ event, payment });
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.POST./api/webhooks/kynq-online.${raw}`).digest("hex");
  return realFetch(`${base}/api/webhooks/kynq-online`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-KQ-Partner": "kynq.in", "X-KQ-Timestamp": ts, "X-KQ-Signature": sig },
    body: raw,
  });
}
async function start(packId = "pack_1000", returnOrigin) {
  const res = await coins.createCoinOrder({ user, packId, phone: "9876543210", returnOrigin });
  return { res, payment: online.payments.get(res.order.id) };
}

test("a Koin order starts a signed payment on kynq.online and redirects there", db, async () => {
  const { res, payment } = await start("pack_1000");
  assert.equal(res.mode, "redirect");
  assert.equal(res.url, payment.checkoutUrl);
  assert.equal(res.order.paymentProvider, "kynq-online");
  assert.equal(res.order.kynqOnlinePaymentId, payment.id);
  const call = online.calls.at(-1);
  assert.equal(call.signed, true);
  assert.equal(call.body.amount, 189);
  assert.equal(call.body.reference, res.order.id);
  assert.equal(call.body.customer.phone, "9876543210");
  assert.equal(call.body.returnUrl, `https://kynq.in/store/coins?coin_order=${res.order.id}`);
  assert.equal(online.cashfreeCalls, 0, "kynq.in's own Cashfree is never called");

  const fromWww = await start("pack_500", "https://www.kynq.in");
  assert.equal(online.calls.at(-1).body.returnUrl, `https://www.kynq.in/store/coins?coin_order=${fromWww.res.order.id}`);
});

test("a signed paid result credits the Koins exactly once", db, async () => {
  const { res, payment } = await start("pack_1000");
  const before = await balance();
  const paid = { ...payment, status: "paid", providerPaymentId: "5550001", paidAt: new Date().toISOString() };
  assert.equal((await callback("payment.paid", paid)).status, 200);
  assert.equal(await balance(), before + 1000);
  assert.equal((await coins.getCoinOrder(res.order.id)).status, "paid");

  // kynq.online retrying, or the status poll racing it, adds nothing.
  assert.equal((await callback("payment.paid", paid)).status, 200);
  online.payments.set(res.order.id, paid);
  await coins.reconcileCoinOrder(await coins.getCoinOrder(res.order.id));
  assert.equal(await balance(), before + 1000);
});

test("forged, stale, wrong-amount and wrong-payment results credit nothing", db, async () => {
  const { res, payment } = await start("pack_2500");
  const before = await balance();
  const paid = { ...payment, status: "paid" };
  assert.equal((await callback("payment.paid", paid, { secret: "wrong" })).status, 401);
  assert.equal((await callback("payment.paid", paid, { ts: String(Date.now() - 10 * 60_000) })).status, 401);
  assert.equal((await callback("payment.paid", { ...paid, amount: 1 })).status, 200);
  assert.equal((await callback("payment.paid", { ...paid, id: "kqp_someoneelsespayment000" })).status, 200);
  assert.equal(await balance(), before);
  assert.equal((await coins.getCoinOrder(res.order.id)).status, "pending_payment");
});

test("without a callback, the status check settles the order (the page's existing poll)", db, async () => {
  const { res, payment } = await start("pack_500");
  const before = await balance();
  assert.equal((await coins.reconcileCoinOrder(await coins.getCoinOrder(res.order.id))).status, "pending_payment");
  online.payments.set(res.order.id, { ...payment, status: "paid" });
  const settled = await coins.reconcileCoinOrder(await coins.getCoinOrder(res.order.id));
  assert.equal(settled.status, "paid");
  assert.equal(await balance(), before + 500);
  assert.equal(online.calls.at(-1).signed, true);
});

test("a paid status for the wrong amount is not trusted on reconcile", db, async () => {
  const { res, payment } = await start("pack_500");
  online.payments.set(res.order.id, { ...payment, status: "paid", amount: 1 });
  const after = await coins.reconcileCoinOrder(await coins.getCoinOrder(res.order.id));
  assert.equal(after.status, "pending_payment");
});

test("results arriving at the same moment credit once and use one invoice number", db, async () => {
  const counters = mongoose.connection.collection("acct_counters");
  const seq = async () => (await counters.find({ _id: /^KQ:/ }).toArray()).reduce((s, c) => s + (c.seq ?? 0), 0);
  const { res, payment } = await start("pack_1000");
  const before = { balance: await balance(), seq: await seq() };
  const paid = { ...payment, status: "paid", providerPaymentId: "5550009" };
  online.payments.set(res.order.id, paid);
  const order = await coins.getCoinOrder(res.order.id);
  await Promise.all([
    callback("payment.paid", paid),
    callback("payment.paid", paid),
    coins.reconcileCoinOrder(order),
    coins.markCoinOrderPaid(res.order.id, "parallel"),
  ]);
  assert.equal(await balance(), before.balance + 1000);
  assert.equal(await seq(), before.seq + 1, "exactly one invoice number taken");
  assert.match((await coins.getCoinOrder(res.order.id)).invoiceNo ?? "", /^KQ\//);
});

test("an expired payment cancels the order", db, async () => {
  const { res, payment } = await start("pack_500");
  assert.equal((await callback("payment.expired", { ...payment, status: "expired" })).status, 200);
  assert.equal((await coins.getCoinOrder(res.order.id)).status, "cancelled");
});
