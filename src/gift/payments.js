// The payment gateway behind every purchase (Koin packs and shop orders), in one place.
//
// Razorpay is the gateway. Cashfree is kept only as a switch-back: it runs when
// PAYMENT_PROVIDER=cashfree is set (and its keys are present), never by default.
// The endpoints the site calls don't change with the gateway: POST /api/checkout/session and
// POST /api/kynq-extra/coins/orders answer with `mode` ("razorpay" | "cashfree" | "demo") and
// what that gateway's checkout needs.
//
// Settling is shared too: whichever path learns of a payment first (the checkout callback, a
// webhook, or a reconcile poll) calls settlePaid(), which is idempotent per order.
import { collection } from "./store.js";
import { getOrder, markOrderPaid, setOrderStatus } from "./orders-store.js";
import { sendOrderConfirmationEmail } from "./order-email.js";
import { cashfreeConfigured, cashfreeMode, createCashfreeOrder, getCashfreeOrder } from "./cashfree.js";
import { razorpayConfigured, razorpayKeyId, razorpayMode, createRazorpayOrder, getRazorpayOrder } from "./razorpay.js";

const carts = collection("carts");

const wanted = String(process.env.PAYMENT_PROVIDER || "").toLowerCase();
/** "razorpay" | "cashfree" | null (no gateway configured). */
export const paymentProvider = wanted === "cashfree" && cashfreeConfigured ? "cashfree" : razorpayConfigured ? "razorpay" : null;
export const paymentsConfigured = !!paymentProvider;
// Without a gateway, orders are marked paid with no payment ("demo mode"): fine on a laptop, a
// free-money hole anywhere real. So demo mode exists ONLY outside production.
export const demoPaymentsAllowed = !paymentsConfigured && process.env.NODE_ENV !== "production";
export const PAYMENTS_UNAVAILABLE = "Payments aren't set up yet. Please try again later.";
/** Test or live money, for the admin console. */
export const paymentMode = paymentProvider === "razorpay" ? razorpayMode : paymentProvider === "cashfree" ? (cashfreeMode === "production" ? "live" : "test") : "test";
if (!paymentsConfigured && process.env.NODE_ENV === "production") {
  console.error("[payments] no payment gateway configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) — every purchase will be refused until it is.");
} else if (paymentsConfigured) {
  console.log(`[payments] gateway: ${paymentProvider} (${paymentMode})`);
}

/**
 * Start a payment for one of our orders. Returns `refs` (store them on the order) and `client`
 * (send to the browser: everything that gateway's checkout needs, nothing secret).
 */
export async function startPayment({ orderId, amount, currency = "INR", customer, description, returnUrl }) {
  if (paymentProvider === "razorpay") {
    const rz = await createRazorpayOrder({ orderId, amount, currency });
    return {
      refs: { paymentProvider: "razorpay", razorpayOrderId: rz.id },
      client: {
        mode: "razorpay",
        razorpay: {
          keyId: razorpayKeyId, orderId: rz.id, amount: rz.amount, currency: rz.currency,
          name: "kynq", description: description || "kynq purchase",
          prefill: { name: customer?.name || "", email: customer?.email || "", contact: customer?.phone || "" },
          notes: { kynq_order_id: orderId },
        },
      },
    };
  }
  if (paymentProvider === "cashfree") {
    const cf = await createCashfreeOrder({ orderId, amount, currency, customer, returnUrl });
    return {
      refs: { paymentProvider: "cashfree", cashfreeOrderId: cf.order_id, cashfreePaymentSessionId: cf.payment_session_id },
      client: { mode: "cashfree", cashfreeMode, paymentSessionId: cf.payment_session_id },
    };
  }
  throw new Error(PAYMENTS_UNAVAILABLE);
}

/** Ask the gateway directly about a still-pending order: "paid" | "expired" | null (don't know yet). */
export async function gatewayStatus(order) {
  if (order?.razorpayOrderId && razorpayConfigured) {
    const rz = await getRazorpayOrder(order.razorpayOrderId).catch(() => null);
    return rz?.status === "paid" ? "paid" : null;
  }
  if (order?.cashfreeOrderId && cashfreeConfigured) {
    const cf = await getCashfreeOrder(order.cashfreeOrderId).catch(() => null);
    return cf?.order_status === "PAID" ? "paid" : cf?.order_status === "EXPIRED" ? "expired" : null;
  }
  return null;
}

// ─── Settling, for both kinds of order (coin ids start with "coin_") ───
// Imported lazily: kynqExtra/coins.js imports this file.
const coins = () => import("../kynqExtra/coins.js");

/** Mark one of our orders paid (idempotent). */
export async function settlePaid(orderId, note) {
  if (String(orderId).startsWith("coin_")) return (await coins()).markCoinOrderPaid(orderId, note);
  const order = await getOrder(orderId);
  if (!order) return null;
  if (order.status === "paid") return order;
  const paid = await markOrderPaid(orderId, note);
  await carts.set(order.sessionId, { sessionId: order.sessionId, items: [], itemCount: 0, subtotal: 0, currency: "INR", updatedAt: Date.now() });
  sendOrderConfirmationEmail(paid).catch((err) => console.error("[payments] confirmation email failed:", err.message));
  return paid;
}

/** A failed or abandoned attempt: the order stays payable. */
export async function settleFailed(orderId, note) {
  if (String(orderId).startsWith("coin_")) return (await coins()).recordCoinOrderFailure(orderId, note);
  const order = await getOrder(orderId);
  if (order && order.status === "pending_payment") await setOrderStatus(orderId, "pending_payment", note);
  return order;
}

/** A completed refund: Koins are taken back; shop orders are marked refunded. */
export async function settleRefunded(orderId, note) {
  if (String(orderId).startsWith("coin_")) return (await coins()).markCoinOrderRefunded(orderId, note);
  const order = await getOrder(orderId);
  if (order && order.status === "paid") await setOrderStatus(orderId, "refunded", note);
  return order;
}
