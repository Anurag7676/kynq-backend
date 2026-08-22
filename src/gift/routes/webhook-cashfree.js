import express from "express";
import { setOrderStatus, getOrder } from "../orders-store.js";
import { collection } from "../store.js";
import { ok, badRequest, wrap } from "../http.js";
import { verifyCashfreeWebhookSignature } from "../cashfree.js";
import { sendOrderConfirmationEmail } from "../order-email.js";

const router = express.Router();
const carts = collection("carts");

// POST /api/webhooks/cashfree — mounted with express.raw() so req.body is a
// Buffer; signature is HMAC-SHA256(x-webhook-timestamp + rawBody, secret).
// Configure this URL in the Cashfree dashboard (Developers → Webhooks).
// Note: Cashfree cannot reach http://localhost — in local dev, orders are
// reconciled instead on GET /api/orders/:id (see routes/orders.js).
router.post("/", wrap(async (req, res) => {
  const signature = req.headers["x-webhook-signature"];
  const timestamp = req.headers["x-webhook-timestamp"];
  const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : JSON.stringify(req.body);

  if (!verifyCashfreeWebhookSignature(rawBody, timestamp, signature)) {
    console.error("[webhook:cashfree] signature verification failed");
    return badRequest(res, "invalid signature");
  }

  const event = JSON.parse(rawBody);
  const orderId = event?.data?.order?.order_id;
  if (!orderId) return ok(res, { received: true });

  const order = await getOrder(orderId);
  if (!order) {
    console.error(`[webhook:cashfree] unknown order ${orderId}`);
    return ok(res, { received: true });
  }

  if (event.type === "PAYMENT_SUCCESS_WEBHOOK") {
    if (order.status !== "paid") {
      const paidOrder = await setOrderStatus(orderId, "paid", `cashfree payment ${event.data.payment?.cf_payment_id}`);
      await carts.set(order.sessionId, { sessionId: order.sessionId, items: [], itemCount: 0, subtotal: 0, currency: "INR", updatedAt: Date.now() });
      sendOrderConfirmationEmail(paidOrder).catch((err) => console.error("[webhook:cashfree] confirmation email failed:", err.message));
    }
    console.log(`[webhook:cashfree] order ${orderId} marked paid`);
  } else if (event.type === "PAYMENT_FAILED_WEBHOOK") {
    await setOrderStatus(orderId, "pending_payment", `cashfree payment failed: ${event.data.payment?.payment_message || "unknown"}`);
  } else if (event.type === "PAYMENT_USER_DROPPED_WEBHOOK") {
    await setOrderStatus(orderId, "pending_payment", "cashfree checkout abandoned by customer");
  }

  ok(res, { received: true });
}));

export default router;
