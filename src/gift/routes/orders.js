import express from "express";
import { collection } from "../store.js";
import { getOrCreateSession, getCurrentUser } from "../session.js";
import { getOrder, listOrdersForActor, setOrderStatus } from "../orders-store.js";
import { ok, notFound, badRequest, wrap } from "../http.js";
import { cashfreeConfigured, getCashfreeOrder } from "../cashfree.js";
import { sendOrderConfirmationEmail } from "../order-email.js";

const router = express.Router();
const carts = collection("carts");

// Reconcile a still-pending order against Cashfree directly. This is the
// fallback path for when the webhook hasn't landed yet — including local
// dev, where Cashfree can never reach http://localhost at all.
async function reconcileIfPending(order) {
  if (!cashfreeConfigured || order.status !== "pending_payment" || !order.cashfreeOrderId) return order;
  const cf = await getCashfreeOrder(order.cashfreeOrderId).catch(() => null);
  if (cf?.order_status === "PAID") {
    const updated = await setOrderStatus(order.id, "paid", "reconciled via GET /orders/:id (cashfree order_status=PAID)");
    await carts.set(order.sessionId, { sessionId: order.sessionId, items: [], itemCount: 0, subtotal: 0, currency: "INR", updatedAt: Date.now() });
    sendOrderConfirmationEmail(updated).catch((err) => console.error("[orders] confirmation email failed:", err.message));
    return updated;
  }
  return order;
}

// GET /api/orders — orders owned by current actor
router.get("/", wrap(async (req, res) => {
  const { sessionId } = getOrCreateSession(req, res);
  const user = await getCurrentUser(req);
  const orders = await listOrdersForActor({ userId: user?.id ?? null, sessionId });
  ok(res, { orders, total: orders.length });
}));

// GET /api/orders/:id — only if owned by current actor
router.get("/:id", wrap(async (req, res) => {
  const { sessionId } = getOrCreateSession(req, res);
  const user = await getCurrentUser(req);
  let order = await getOrder(req.params.id);
  if (!order) return notFound(res, "order not found");
  const ownsByUser = user?.id && order.userId === user.id;
  const ownsBySession = order.sessionId === sessionId;
  if (!ownsByUser && !ownsBySession) return notFound(res, "order not found");
  order = await reconcileIfPending(order);
  ok(res, { order });
}));

// PATCH /api/orders/:id — cancel an order (only pending_payment or paid)
router.patch("/:id", wrap(async (req, res) => {
  const { sessionId } = getOrCreateSession(req, res);
  const user = await getCurrentUser(req);
  const order = await getOrder(req.params.id);
  if (!order) return notFound(res, "order not found");
  const ownsByUser = user?.id && order.userId === user.id;
  const ownsBySession = order.sessionId === sessionId;
  if (!ownsByUser && !ownsBySession) return notFound(res, "order not found");

  const action = req.body?.action;
  if (action === "cancel") {
    const cancellable = ["pending_payment", "paid"];
    if (!cancellable.includes(order.status)) {
      return badRequest(res, `cannot cancel order in "${order.status}" status`);
    }
    const updated = await setOrderStatus(order.id, "cancelled", "cancelled by customer");
    return ok(res, { order: updated });
  }
  badRequest(res, "unknown action — supported: cancel");
}));

export default router;
