import { collection, makeId } from "./store.js";
import { redeemCoupon } from "./coupons.js";

const orders = collection("orders");

const GST_RATE_INR = 0.18;
const SHIPPING_USD = 1500;

// discount (major currency unit, already resolved server-side via
// evaluateCoupon — never a client-supplied amount) is taken off the
// subtotal before tax, matching how GST is actually charged on a
// discounted sale. It's applied against dueToday only — kynq has no live
// made-to-order/deposit product today (the dueLater branch below is dead
// in practice), so there's no real deposit split to prorate it across.
export function computeTotals(items, discount = 0) {
  const currency = items[0]?.currency ?? "INR";
  let subtotal = 0, dueToday = 0, dueLater = 0;
  for (const it of items) {
    const line = it.unitPrice * it.qty;
    subtotal += line;
    if (it.kind === "mto" && it.variant?.isDeposit && it.variant.depositPercent && it.variant.depositPercent < 100) {
      const deposit = Math.round((line * it.variant.depositPercent) / 100);
      dueToday += deposit; dueLater += line - deposit;
    } else {
      dueToday += line;
    }
  }
  const discountedSubtotal = Math.max(0, subtotal - discount);
  const shipping = currency === "INR" ? 0 : SHIPPING_USD;
  const tax = Math.round(discountedSubtotal * (currency === "INR" ? GST_RATE_INR : 0));
  const total = discountedSubtotal + shipping + tax;
  dueToday = Math.max(0, dueToday - discount) + shipping + tax;
  return { subtotal, discount, shipping, tax, total, dueToday, dueLater, currency };
}

export async function createOrder(input) {
  const now = Date.now();
  const order = { ...input, id: makeId("ord"), createdAt: now, updatedAt: now, events: [{ at: now, kind: "created" }] };
  await orders.set(order.id, order);
  return order;
}
export async function getOrder(id) {
  return orders.get(id);
}
export async function setOrderStatus(id, status, note) {
  const existing = await orders.get(id);
  if (!existing) return null;
  const now = Date.now();
  const next = { ...existing, status, updatedAt: now, events: [...(existing.events ?? []), { at: now, kind: `status:${status}`, note }] };
  await orders.set(id, next);
  return next;
}
// The single place an order actually transitions to "paid" — every payment
// path (demo mode, Cashfree webhook, GET /orders/:id reconciliation) should
// call this instead of setOrderStatus directly, so a coupon only ever gets
// redeemed once money has actually landed, not at checkout-session creation.
export async function markOrderPaid(id, note) {
  const order = await setOrderStatus(id, "paid", note);
  if (order?.coupon?.code) {
    await redeemCoupon(order.coupon.code).catch((err) =>
      console.error(`[orders] coupon redemption failed for ${order.coupon.code}:`, err.message)
    );
  }
  return order;
}
export async function updateOrder(id, patch) {
  const existing = await orders.get(id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  await orders.set(id, next);
  return next;
}
export async function findOrderByStripeSession(sid) {
  return (await orders.find((o) => o.stripeSessionId === sid))[0] ?? null;
}
export async function listOrdersForActor({ userId, sessionId }) {
  const all = await orders.list();
  const owned = all.filter((o) => (userId && o.userId === userId) || o.sessionId === sessionId);
  owned.sort((a, b) => b.createdAt - a.createdAt);
  return owned;
}
