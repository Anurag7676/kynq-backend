// Coin packs bought with real money through Cashfree.
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
import { collection, makeId } from "../gift/store.js";
import { cashfreeConfigured, cashfreeMode, createCashfreeOrder, getCashfreeOrder } from "../gift/cashfree.js";
import { credit, debit } from "./wallet.js";

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

export async function listCoinOrdersForUser(userId, limit = 20) {
  const all = await orders.find((o) => o.userId === userId);
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/**
 * Create an order for `packId` and, when Cashfree is configured, the
 * matching Cashfree order. Returns what the client needs to pay (or, in
 * demo mode without keys, the already-paid order).
 */
export async function createCoinOrder({ user, packId, phone }) {
  const pack = COIN_PACKS.find((p) => p.id === packId);
  if (!pack) throw Object.assign(new Error("unknown pack"), { code: "BAD_PACK" });

  const id = makeId("coin");
  const now = Date.now();
  let order = {
    id, userId: user.id, packId: pack.id, coins: pack.coins,
    amount: pack.priceInr, currency: "INR",
    status: "pending_payment", createdAt: now, updatedAt: now, paidAt: null, lastFailure: null,
    events: [{ type: "created", note: null, at: now }],
  };
  await orders.set(id, order);

  if (!cashfreeConfigured) {
    // Demo mode — same behaviour as the physical checkout without keys.
    order = await markCoinOrderPaid(id, "demo mode: no Cashfree keys configured");
    return { order, mode: "demo" };
  }

  try {
    const cf = await createCashfreeOrder({
      orderId: id,
      amount: pack.priceInr,
      currency: "INR",
      customer: { id: user.id, name: user.name || "kynq member", email: user.email, phone },
      returnUrl: `${CLIENT_URL}/store?coin_order=${id}`,
    });
    order = withEvent({ ...order, cashfreeOrderId: cf.order_id, cashfreePaymentSessionId: cf.payment_session_id }, "cashfree_order_created");
    await orders.set(id, order);
    return { order, mode: "cashfree", cashfreeMode, paymentSessionId: cf.payment_session_id };
  } catch (err) {
    order = withEvent({ ...order, status: "cancelled" }, "cashfree_order_failed", err.message);
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
  await orders.set(id, next);
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
  return next;
}

/** Ask Cashfree directly when a webhook hasn't landed (e.g. localhost). */
export async function reconcileCoinOrder(order) {
  if (!cashfreeConfigured || order.status !== "pending_payment" || !order.cashfreeOrderId) return order;
  const cf = await getCashfreeOrder(order.cashfreeOrderId).catch(() => null);
  if (cf?.order_status === "PAID") return markCoinOrderPaid(order.id, "reconciled via GET (cashfree order_status=PAID)");
  if (cf?.order_status === "EXPIRED") {
    const next = withEvent({ ...order, status: "cancelled" }, "expired", "cashfree order expired");
    await orders.set(order.id, next);
    return next;
  }
  return order;
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
