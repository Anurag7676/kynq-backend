import express from "express";
import { ok, wrap } from "../http.js";
import { verifyKynqOnlineCallback, kynqOnlinePaymentModeAccepted } from "../kynq-online.js";
import { settlePaid, settleRefunded } from "../payments.js";
import { getCoinOrder, expireCoinOrder } from "../../kynqExtra/coins.js";

const router = express.Router();
const PATH = "/api/webhooks/kynq-online";

// POST /api/webhooks/kynq-online: kynq.online reports the result of a Koin payment it took through
// Cashfree. Mounted with express.raw() so the signature (see gift/kynq-online.js) is checked over the
// exact bytes sent. kynq.online has already verified the payment with Cashfree's API; here it must
// also be the payment we started for this order, for this order's amount, and (on a production
// server) taken in Cashfree's production mode. Events:
//   payment.paid      credit the Koins: settlePaid → markCoinOrderPaid, at most once per order
//   payment.refunded  a full refund: settleRefunded → markCoinOrderRefunded, reverses the Koins once
//   payment.expired   the order is cancelled (only while still pending)
// So a repeated or late notification is harmless. Answers 200 to anything validly signed so
// kynq.online stops retrying.
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

  if (event.event === "payment.paid" || event.event === "payment.refunded") {
    if (Number(payment.amount) !== Number(order.amount) || payment.currency !== "INR") {
      console.error(`[webhook:kynq-online] amount mismatch on ${orderId} (${event.event}): ${payment.amount} ${payment.currency}, order ${order.amount}`);
      return ok(res, { received: true });
    }
    if (event.event === "payment.paid") {
      if (!kynqOnlinePaymentModeAccepted(payment)) {
        console.error(`[webhook:kynq-online] ${orderId} paid in ${payment.mode ?? "unknown"} mode; not crediting on a production server`);
        return ok(res, { received: true });
      }
      await settlePaid(orderId, `kynq.online payment ${payment.id} (${payment.provider} ${payment.providerPaymentId ?? ""})`.trim());
    } else {
      await settleRefunded(orderId, `kynq.online refund of payment ${payment.id}`);
    }
  } else if (event.event === "payment.expired") {
    await expireCoinOrder(orderId, "kynq.online payment expired");
  }
  console.log(`[webhook:kynq-online] ${event.event} order=${orderId}`);
  ok(res, { received: true });
}));

export default router;
