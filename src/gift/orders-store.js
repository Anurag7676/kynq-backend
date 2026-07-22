import { collection, makeId } from "./store.js";

const orders = collection("orders");

const GST_RATE_INR = 0.18;
const SHIPPING_USD = 1500;

export function computeTotals(items) {
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
  const shipping = currency === "INR" ? 0 : SHIPPING_USD;
  const tax = Math.round(subtotal * (currency === "INR" ? GST_RATE_INR : 0));
  const total = subtotal + shipping + tax;
  dueToday += shipping + tax;
  return { subtotal, shipping, tax, total, dueToday, dueLater, currency };
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
