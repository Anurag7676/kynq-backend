import express from "express";
import { ok, badRequest, wrap } from "../http.js";
import { verifyRazorpayWebhook } from "../razorpay.js";
import { settlePaid, settleFailed, settleRefunded } from "../payments.js";

const router = express.Router();

// POST /api/webhooks/razorpay: mounted with express.raw() so req.body is the exact raw Buffer the
// signature is computed over. Set up in Razorpay Dashboard → Account & Settings → Webhooks:
//   URL     https://api-prod.kynq.in/api/webhooks/razorpay
//   Secret  the value of RAZORPAY_WEBHOOK_SECRET
//   Events  order.paid, payment.captured, payment.failed, refund.processed
// Coin packs and shop orders share it: `receipt` / notes.kynq_order_id carry our own order id.
// Always 200 for events we can't use, so Razorpay doesn't retry them forever.
router.post("/", wrap(async (req, res) => {
  const raw = req.body instanceof Buffer ? req.body.toString("utf8") : JSON.stringify(req.body ?? {});
  if (!verifyRazorpayWebhook(raw, req.headers["x-razorpay-signature"])) {
    console.error("[webhook:razorpay] signature verification failed");
    return badRequest(res, "invalid signature");
  }
  const event = JSON.parse(raw);
  const order = event?.payload?.order?.entity;
  const payment = event?.payload?.payment?.entity;
  const refund = event?.payload?.refund?.entity;
  const ourId = order?.receipt || payment?.notes?.kynq_order_id || refund?.notes?.kynq_order_id;
  if (!ourId) return ok(res, { received: true });

  switch (event.event) {
    case "order.paid":
    case "payment.captured":
      await settlePaid(ourId, `razorpay ${event.event} ${payment?.id ?? ""}`.trim());
      break;
    case "payment.failed":
      await settleFailed(ourId, `razorpay payment failed: ${payment?.error_description || payment?.error_reason || "unknown"}`);
      break;
    case "refund.processed":
      // Only a full refund takes the purchase back; a partial one is a goodwill adjustment.
      if (payment && Number(payment.amount_refunded) >= Number(payment.amount)) await settleRefunded(ourId, `razorpay refund ${refund?.id ?? ""}`.trim());
      break;
    default:
      break;
  }
  console.log(`[webhook:razorpay] ${event.event} order=${ourId}`);
  ok(res, { received: true });
}));

export default router;
