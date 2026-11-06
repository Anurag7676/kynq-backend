import express from "express";
import { ok, wrap } from "../http.js";
import { verifyKynqOnlineCallback } from "../kynq-online.js";
import { settlePaid } from "../payments.js";
import { getCoinOrder, expireCoinOrder } from "../../kynqExtra/coins.js";

const router = express.Router();
const PATH = "/api/webhooks/kynq-online";

// POST /api/webhooks/kynq-online: kynq.online reports the result of a Koin payment it took through
// Cashfree. Mounted with express.raw() so the signature (see gift/kynq-online.js) is checked over the
// exact bytes sent. kynq.online has already verified the payment with Cashfree's API; here it must
// also be the payment we started for this order, for this order's amount. Settling goes through
// settlePaid → markCoinOrderPaid, which credits a given order at most once, so a repeated or late
// notification is harmless. Answers 200 to anything validly signed so kynq.online stops retrying.
router.post("/", wrap(async (req, res) => {
  const raw = req.body instanceof Buffer ? req.body.toString("utf8") : "";
  if (!verifyKynqOnlineCallback(raw, req.headers, PATH)) {
    console.error("[webhook:kynq-online] signature verification failed");
    return res.status(401).json({ error: "invalid signature" });
  }
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: "invalid json" }); }
  const payment = event?.payment;
  const orderId = String(payment?.reference || "");
  const order = orderId.startsWith("coin_") ? await getCoinOrder(orderId) : null;
  if (!order || order.paymentProvider !== "kynq-online" || order.kynqOnlinePaymentId !== payment.id) {
    console.error(`[webhook:kynq-online] no matching coin order for ${orderId} / ${payment?.id}`);
    return ok(res, { received: true });
  }

  if (event.event === "payment.paid") {
    if (Number(payment.amount) !== Number(order.amount) || payment.currency !== "INR") {
      console.error(`[webhook:kynq-online] amount mismatch on ${orderId}: paid ${payment.amount} ${payment.currency}, order ${order.amount}`);
      return ok(res, { received: true });
    }
    await settlePaid(orderId, `kynq.online payment ${payment.id} (${payment.provider} ${payment.providerPaymentId ?? ""})`.trim());
  } else if (event.event === "payment.expired") {
    await expireCoinOrder(orderId, "kynq.online payment expired");
  }
  console.log(`[webhook:kynq-online] ${event.event} order=${orderId}`);
  ok(res, { received: true });
}));

export default router;
