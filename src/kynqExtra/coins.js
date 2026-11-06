// Coin packs bought with real money through the payment gateway (gift/payments.js: Razorpay).
//
// A coin order is its own record (`coin_orders`) with its own id namespace
// (`coin_…`) — that id is also the Cashfree order_id, so the shared webhook
// can route by prefix. Payment states:
//   pending_payment → paid        (webhook, or reconcile against Cashfree)
//   pending_payment → cancelled   (Cashfree order creation failed)
//   paid            → refunded    (refund webhook; coins are reversed)
// A failed or abandoned attempt keeps the order pending with `lastFailure`
// so the same order can be retried. Crediting goes through wallet.credit
// with the order id as the idempotency key, so duplicate webhooks and
// reconcile races can never credit twice. The wallet is never written from
// anything the client sends.
import mongoose from "mongoose";
import { collection, makeId } from "../gift/store.js";
import { koinGatewayConfigured, demoPaymentsAllowed, PAYMENTS_UNAVAILABLE, startKoinPayment, gatewayStatus } from "../gift/payments.js";
import { credit, debit } from "./wallet.js";
import { recordCreatorCommission, reverseCreatorCommission } from "./creators.js";
import { assignKoinInvoiceNumber } from "../accounting/core.js";

const orders = collection("coin_orders");
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// Prices are placeholders pending a business decision; coins/price ratios
// improve with pack size. Server-only: the client never sends amounts.
export const COIN_PACKS = [
  { id: "pack_500", coins: 500, priceInr: 99 },
  { id: "pack_1000", coins: 1000, priceInr: 189 },
  { id: "pack_2500", coins: 2500, priceInr: 449 },
  { id: "pack_5000", coins: 5000, priceInr: 849 },
];

export function listPacks() {
  return COIN_PACKS.map((p) => ({ ...p, currency: "INR" }));
}

function withEvent(order, type, note) {
  return { ...order, events: [...(order.events ?? []), { type, note: note ?? null, at: Date.now() }], updatedAt: Date.now() };
}

export async function getCoinOrder(id) {
  return orders.get(id);
}

// Indexed query (was: load every order, filter in JS).
let userIndexReady = null;
export async function listCoinOrdersForUser(userId, limit = 20) {
  const c = mongoose.connection.collection("coin_orders");
  userIndexReady ??= c.createIndex({ userId: 1, createdAt: -1 }).catch((err) => { userIndexReady = null; throw err; });
  await userIndexReady;
  const rows = await c.find({ userId }).sort({ createdAt: -1 }).limit(Math.min(100, Math.max(1, limit))).toArray();
  return rows.map(({ _id, _key, ...rest }) => rest);
}

/**
 * Create an order for `packId` and start its payment (through kynq.online, see
 * gift/payments.js startKoinPayment). Returns what the client needs to pay (or, in
 * demo mode without keys, the already-paid order). `returnOrigin` is the site the
 * buyer is sent back to after paying; it defaults to CLIENT_URL.
 */
export async function createCoinOrder({ user, packId, phone, returnOrigin }) {
  const pack = COIN_PACKS.find((p) => p.id === packId);
  if (!pack) throw Object.assign(new Error("unknown pack"), { code: "BAD_PACK" });

  // Fail closed BEFORE creating anything: no keys in production = no sale.
  if (!koinGatewayConfigured && !demoPaymentsAllowed) throw Object.assign(new Error(PAYMENTS_UNAVAILABLE), { code: "PAYMENTS_UNAVAILABLE" });

  const id = makeId("coin");
  const now = Date.now();
  let order = {
    id, userId: user.id, packId: pack.id, coins: pack.coins,
    amount: pack.priceInr, currency: "INR",
    status: "pending_payment", createdAt: now, updatedAt: now, paidAt: null, lastFailure: null,
    events: [{ type: "created", note: null, at: now }],
  };
  await orders.set(id, order);

  if (!koinGatewayConfigured) {
    // Demo mode (never in production — see demoPaymentsAllowed).
    order = await markCoinOrderPaid(id, "demo mode: no payment gateway configured");
    return { order, mode: "demo" };
  }

  try {
    const { refs, client } = await startKoinPayment({
      orderId: id,
      amount: pack.priceInr,
      currency: "INR",
      customer: { id: user.id, name: user.name || "kynq member", email: user.email, phone },
      description: `${pack.coins.toLocaleString("en-IN")} Koins`,
      returnUrl: `${returnOrigin || CLIENT_URL}/store/coins?coin_order=${id}`,
    });
    order = withEvent({ ...order, ...refs }, `${refs.paymentProvider}_order_created`);
    await orders.set(id, order);
    return { order, ...client };
  } catch (err) {
    order = withEvent({ ...order, status: "cancelled" }, "gateway_order_failed", err.message);
    await orders.set(id, order);
    throw Object.assign(new Error("couldn't start payment — try again in a moment"), { code: "PAYMENT_START_FAILED", cause: err });
  }
}

/** Idempotent: a second call (duplicate webhook, reconcile race) is a no-op. */
export async function markCoinOrderPaid(id, note) {
  const order = await orders.get(id);
  if (!order) return null;
  if (order.status === "paid" || order.status === "refunded") return order;
  // Credit first (its idempotency key is the order id), then flip status —
  // if we crash in between, the next call finds the credit already applied
  // and just completes the status change.
  await credit(order.userId, "coin_purchase", { refId: id, amount: order.coins, note: `bought ${order.coins} coins` });
  const next = withEvent({ ...order, status: "paid", paidAt: Date.now(), lastFailure: null }, "paid", note);
  // Compare-and-set on the status we read: when the webhook, the return and a status poll settle
  // the same order at once, only one of them flips it, so only one goes on to the commission and
  // the invoice number (a loser used to take a number too, leaving gaps in the KQ series).
  const flipped = await mongoose.connection.collection("coin_orders").updateOne(
    { _key: id, status: order.status },
    { $set: { ...next, _key: id } },
  );
  if (!flipped.modifiedCount) return orders.get(id);
  await recordCreatorCommission(next); // creator referral program; once per order, never throws
  await assignKoinInvoiceNumber(id);   // KQ/<FY>/<n>; never throws
  return next;
}

export async function recordCoinOrderFailure(id, note) {
  const order = await orders.get(id);
  if (!order || order.status !== "pending_payment") return order;
  const next = withEvent({ ...order, lastFailure: { note, at: Date.now() } }, "payment_failed", note);
  await orders.set(id, next);
  return next;
}

/** Idempotent reversal of a refunded purchase. The balance may go negative. */
export async function markCoinOrderRefunded(id, note) {
  const order = await orders.get(id);
  if (!order || order.status !== "paid") return order;
  await debit(order.userId, "coin_refund", order.coins, { refId: id, note: `refund of ${order.coins} coins`, allowNegative: true });
  const next = withEvent({ ...order, status: "refunded", refundedAt: Date.now() }, "refunded", note);
  await orders.set(id, next);
  await reverseCreatorCommission(id);
  return next;
}

/** Ask the gateway directly when neither the checkout callback nor a webhook has landed. */
export async function reconcileCoinOrder(order) {
  if (order.status !== "pending_payment") return order;
  const status = await gatewayStatus(order);
  if (status === "paid") return markCoinOrderPaid(order.id, `reconciled via GET (${order.paymentProvider ?? "gateway"} order paid)`);
  if (status === "expired") return expireCoinOrder(order.id, "gateway order expired");
  return order;
}

/** A gateway order that can no longer be paid: the coin order is cancelled (no-op unless pending). */
export async function expireCoinOrder(id, note) {
  const order = await orders.get(id);
  if (!order || order.status !== "pending_payment") return order;
  const next = withEvent({ ...order, status: "cancelled" }, "expired", note);
  await orders.set(id, next);
  return next;
}

/** Called by the shared Cashfree webhook for order ids in the coin namespace. */
export async function handleCoinWebhook(event) {
  const orderId = event?.data?.order?.order_id;
  if (!orderId) return;
  switch (event.type) {
    case "PAYMENT_SUCCESS_WEBHOOK":
      await markCoinOrderPaid(orderId, `cashfree payment ${event.data.payment?.cf_payment_id ?? ""}`.trim());
      break;
    case "PAYMENT_FAILED_WEBHOOK":
      await recordCoinOrderFailure(orderId, event.data.payment?.payment_message || "payment failed");
      break;
    case "PAYMENT_USER_DROPPED_WEBHOOK":
      await recordCoinOrderFailure(orderId, "checkout abandoned");
      break;
    case "REFUND_STATUS_WEBHOOK":
      if (event.data.refund?.refund_status === "SUCCESS") {
        await markCoinOrderRefunded(orderId, `cashfree refund ${event.data.refund?.cf_refund_id ?? ""}`.trim());
      }
      break;
    default:
      break;
  }
}

// ─── UPI straight to kynq's own business account (no gateway) ───
// The buyer pays our UPI id (QR, or a button that opens their UPI app with the amount and a
// reference filled in), then types the 12-digit UTR their app shows. A person checks it against
// the bank statement in the admin console and approves it; only then are the Koins credited
// (markCoinOrderPaid, same exactly-once path as gateway payments). Statuses:
//   pending_payment → payment_review (UTR sent) → paid (approved) | rejected
// UPI_VPA / UPI_PAYEE_NAME override the account below (set either to "off" to turn UPI off).
// Alerts for new UTRs go to UPI_ALERT_EMAIL (default hi@kynq.in).
const UPI_VPA = (process.env.UPI_VPA ?? "bk7676581@ybl").trim();
const UPI_PAYEE_NAME = (process.env.UPI_PAYEE_NAME ?? "kynq").trim();
export const upiDirectEnabled = !!(UPI_VPA && UPI_PAYEE_NAME) && UPI_VPA !== "off" && UPI_PAYEE_NAME !== "off";

// Koins by card / gateway (Cashfree, Razorpay) are hidden: UPI only. KOIN_CARD_PAYMENTS=on
// brings the gateway back for Koins (the shop checkout is separate and unaffected).
export const koinCardPaymentsEnabled = process.env.KOIN_CARD_PAYMENTS === "on";
const UPI_ALERT_EMAIL = process.env.UPI_ALERT_EMAIL || "hi@kynq.in";
const MAX_UTR_TRIES = 3;

/** The short reference the buyer's UPI app carries in the payment note: matches it to the order. */
const upiRef = (id) => id.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();

async function upiPayload(order) {
  const note = `KYNQ ${upiRef(order.id)}`;
  const q = new URLSearchParams({ pa: UPI_VPA, pn: UPI_PAYEE_NAME, am: Number(order.amount).toFixed(2), cu: "INR", tn: note });
  const url = `upi://pay?${q.toString().replace(/\+/g, "%20")}`;
  const QR = (await import("qrcode")).default;
  const qrSvg = await QR.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { vpa: UPI_VPA, payeeName: UPI_PAYEE_NAME, amount: order.amount, note, url, qrSvg };
}

let utrIndexReady = null;
const ensureUtrIndex = () => {
  // One UTR pays one order: the same reference can't be submitted twice (races included).
  utrIndexReady ??= mongoose.connection.collection("coin_orders")
    .createIndex({ utr: 1 }, { unique: true, partialFilterExpression: { utr: { $type: "string" } } })
    .catch((err) => { utrIndexReady = null; throw err; });
  return utrIndexReady;
};

export async function createUpiCoinOrder({ user, packId }) {
  if (!upiDirectEnabled) throw Object.assign(new Error("UPI payments aren't available right now."), { code: "PAYMENTS_UNAVAILABLE" });
  const pack = COIN_PACKS.find((p) => p.id === packId);
  if (!pack) throw Object.assign(new Error("unknown pack"), { code: "BAD_PACK" });
  const id = makeId("coin");
  const now = Date.now();
  const order = {
    id, userId: user.id, packId: pack.id, coins: pack.coins, amount: pack.priceInr, currency: "INR",
    method: "upi_direct", upiRef: upiRef(id), utr: null, utrTries: 0,
    status: "pending_payment", createdAt: now, updatedAt: now, paidAt: null, lastFailure: null,
    events: [{ type: "created", note: "upi direct", at: now }],
  };
  await orders.set(id, order);
  return { order, mode: "upi", upi: await upiPayload(order) };
}

/** The buyer's UTR (12 digits) for their UPI order: queues it for review. */
export async function submitUpiUtr({ orderId, userId, utr }) {
  const clean = String(utr ?? "").replace(/\s+/g, "");
  if (!/^\d{12}$/.test(clean)) throw Object.assign(new Error("Enter the 12-digit UTR / UPI reference number from your UPI app."), { code: "BAD_UTR" });
  const order = await orders.get(orderId);
  if (!order || order.userId !== userId || order.method !== "upi_direct") throw Object.assign(new Error("order not found"), { code: "NOT_FOUND" });
  if (order.status === "paid") return order;
  if (!["pending_payment", "payment_review", "rejected"].includes(order.status)) throw Object.assign(new Error("This order can't take a payment any more. Start a new one."), { code: "BAD_STATE" });
  if ((order.utrTries ?? 0) >= MAX_UTR_TRIES) throw Object.assign(new Error(`Too many attempts. Write to ${UPI_ALERT_EMAIL} with your UTR and we'll sort it out.`), { code: "TOO_MANY" });
  await ensureUtrIndex();
  const taken = await mongoose.connection.collection("coin_orders").findOne({ utr: clean, id: { $ne: orderId } }, { projection: { _id: 1 } });
  if (taken) throw Object.assign(new Error("That UTR has already been used for another order."), { code: "UTR_USED" });
  const next = withEvent({ ...order, status: "payment_review", utr: clean, utrTries: (order.utrTries ?? 0) + 1, utrAt: Date.now(), lastFailure: null }, "utr_submitted", clean);
  try { await orders.set(orderId, next); }
  catch (err) { if (err?.code === 11000) throw Object.assign(new Error("That UTR has already been used for another order."), { code: "UTR_USED" }); throw err; }
  const { sendEmail } = await import("../config/emailConfig.js");
  sendEmail({
    to: UPI_ALERT_EMAIL,
    subject: `UPI payment to check: ₹${order.amount} · UTR ${clean}`,
    text: `A buyer says they paid ₹${order.amount} by UPI for ${order.coins} Koins.\n\nUTR: ${clean}\nPayment note: KYNQ ${order.upiRef}\nOrder: ${orderId}\n\nCheck it on the bank statement, then approve or reject it in the admin console (Finance → UPI payments).`,
  }).catch((err) => console.error("[upi] alert email failed:", err.message));
  return next;
}

/** UPI orders waiting for a person to check (newest first), and recently decided ones. */
export async function listUpiOrders({ status = "payment_review", limit = 100 } = {}) {
  const rows = await mongoose.connection.collection("coin_orders")
    .find({ method: "upi_direct", ...(status === "all" ? { status: { $in: ["payment_review", "paid", "rejected"] } } : { status }) })
    .sort({ utrAt: -1, createdAt: -1 }).limit(Math.min(500, limit)).toArray();
  return rows.map(({ _id, _key, ...rest }) => rest);
}

export async function approveUpiOrder(id, adminEmail) {
  const order = await orders.get(id);
  if (!order || order.method !== "upi_direct") return null;
  if (order.status !== "payment_review") return order;
  return markCoinOrderPaid(id, `UPI UTR ${order.utr} approved by ${adminEmail}`);
}

export async function rejectUpiOrder(id, adminEmail, reason) {
  const order = await orders.get(id);
  if (!order || order.method !== "upi_direct" || order.status !== "payment_review") return order ?? null;
  const note = String(reason || "payment not found on the bank statement").slice(0, 200);
  // The UTR is freed (null) so a mistyped one can be corrected; the buyer sees why.
  const next = withEvent({ ...order, status: "rejected", utr: null, lastFailure: { note, at: Date.now() } }, "rejected", `${note} (by ${adminEmail}, UTR was ${order.utr})`);
  await orders.set(id, next);
  return next;
}
