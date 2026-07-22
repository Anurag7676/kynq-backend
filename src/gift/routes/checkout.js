import express from "express";
import { collection } from "../store.js";
import { getScopedId } from "../session.js";
import { computeTotals, createOrder, setOrderStatus } from "../orders-store.js";
import { ok, created, badRequest, wrap } from "../http.js";

const router = express.Router();
const carts = collection("carts");
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;

// POST /api/checkout/session
router.post("/session", wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.customer?.name || !b.customer?.email) return badRequest(res, "customer name + email required");

  const { scopedId, userId } = await getScopedId(req, res);
  const cart = (await carts.get(scopedId)) ?? { items: [] };
  if (!cart.items || cart.items.length === 0) return badRequest(res, "cart is empty");

  const totals = computeTotals(cart.items);
  const order = await createOrder({
    sessionId: scopedId,
    userId: userId ?? undefined,
    status: "pending_payment",
    items: cart.items,
    subtotal: totals.subtotal, shipping: totals.shipping, tax: totals.tax, total: totals.total,
    amountDueToday: totals.dueToday, amountDueLater: totals.dueLater, currency: totals.currency,
    customer: { name: b.customer.name, email: b.customer.email, phone: b.customer.phone },
    shippingAddress: b.shippingAddress
      ? { name: b.customer.name, email: b.customer.email, ...b.shippingAddress }
      : undefined,
  });

  const successUrl = `${CLIENT_URL}/checkout/confirmation?order=${order.id}`;

  if (!stripeConfigured) {
    // Demo mode — mark paid, clear cart, return confirmation url.
    await setOrderStatus(order.id, "paid", "demo mode: no Stripe configured");
    await carts.set(scopedId, { sessionId: scopedId, items: [], itemCount: 0, subtotal: 0, currency: "INR", updatedAt: Date.now() });
    return created(res, { url: successUrl, orderId: order.id, mode: "demo" });
  }

  // Stripe mode would create a Checkout Session here.
  return created(res, { url: successUrl, orderId: order.id, mode: "demo" });
}));

export default router;
