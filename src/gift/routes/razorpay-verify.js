import express from "express";
import { ok, badRequest, notFound, wrap } from "../http.js";
import { verifyRazorpayPayment } from "../razorpay.js";
import { settlePaid } from "../payments.js";
import { getOrder } from "../orders-store.js";
import { getCoinOrder } from "../../kynqExtra/coins.js";

const router = express.Router();

// POST /api/razorpay/verify: the browser's Razorpay Checkout success handler posts here at once,
// so Koins land in seconds instead of waiting for the webhook. Body:
//   { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Trust comes from the signature (HMAC with our key secret), never from the client's say-so, and
// the Razorpay order must be the one we created for this order.
router.post("/verify", wrap(async (req, res) => {
  const { orderId, razorpay_order_id: rzOrder, razorpay_payment_id: rzPayment, razorpay_signature: signature } = req.body ?? {};
  if (typeof orderId !== "string" || !orderId) return badRequest(res, "orderId required");
  const order = orderId.startsWith("coin_") ? await getCoinOrder(orderId) : await getOrder(orderId);
  if (!order) return notFound(res, "order not found");
  if (order.razorpayOrderId !== rzOrder || !verifyRazorpayPayment({ razorpayOrderId: rzOrder, razorpayPaymentId: rzPayment, signature })) {
    console.error(`[razorpay] verify failed for order ${orderId}`);
    return badRequest(res, "payment could not be verified");
  }
  const settled = await settlePaid(orderId, `razorpay payment ${rzPayment} (checkout verified)`);
  ok(res, { ok: true, orderId, status: settled?.status ?? "paid" });
}));

export default router;
