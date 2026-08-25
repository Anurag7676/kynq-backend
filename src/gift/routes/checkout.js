import express from "express";
import { collection } from "../store.js";
import { getScopedId, syncProfileFromCheckout } from "../session.js";
import { computeTotals, createOrder, markOrderPaid, setOrderStatus, updateOrder } from "../orders-store.js";
import { ok, created, badRequest, unauthorized, wrap } from "../http.js";
import { cashfreeConfigured, cashfreeMode, createCashfreeOrder } from "../cashfree.js";
import { sendOrderConfirmationEmail } from "../order-email.js";
import { evaluateCoupon } from "../coupons.js";

const router = express.Router();
const carts = collection("carts");
// Prod default; CLIENT_URL overrides for local dev. This drives the
// post-payment successUrl Cashfree redirects to — same bug class as the
// confirmation email's "view your order" link (see email-layout.js): with
// no CLIENT_URL set in production, this silently fell back to localhost.
const CLIENT_URL = process.env.CLIENT_URL || "https://kynq.in";

// POST /api/checkout/session
router.post("/session", wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.customer?.name || !b.customer?.email) return badRequest(res, "customer name + email required");
  if (cashfreeConfigured && !b.customer?.phone) return badRequest(res, "customer phone required");

  const { scopedId, userId } = await getScopedId(req, res);
  // Checkout requires an account — enforced here, not just in the UI, since
  // the UI gate alone is trivially bypassed with a direct API call.
  if (!userId) return unauthorized(res, "sign in to check out");
  const cart = (await carts.get(scopedId)) ?? { items: [] };
  if (!cart.items || cart.items.length === 0) return badRequest(res, "cart is empty");

  // Fill in the account name (if never set — e.g. signed in via /login or
  // the checkout gate rather than /register) and save this shipping address
  // for next time. Independent of payment outcome — this is about the
  // account, not the order.
  await syncProfileFromCheckout(userId, { name: b.customer.name, address: b.shippingAddress });

  // Re-validate the coupon against this cart server-side — never trust a
  // discount amount from the client. Invalid/expired/exhausted codes fail
  // the whole checkout rather than silently charging full price, so the
  // customer isn't surprised by a total that doesn't match what they saw.
  let discount = 0;
  let coupon;
  if (b.couponCode) {
    const result = await evaluateCoupon(b.couponCode, cart.subtotal);
    if (!result.valid) return badRequest(res, result.reason);
    discount = result.discount;
    coupon = {
      code: result.coupon.code,
      type: result.coupon.type,
      percentOff: result.coupon.percentOff,
      amountOff: result.coupon.amountOff,
      discount,
    };
  }

  const totals = computeTotals(cart.items, discount);
  const order = await createOrder({
    sessionId: scopedId,
    userId: userId ?? undefined,
    status: "pending_payment",
    items: cart.items,
    subtotal: totals.subtotal, discount: totals.discount, coupon,
    shipping: totals.shipping, tax: totals.tax, total: totals.total,
    amountDueToday: totals.dueToday, amountDueLater: totals.dueLater, currency: totals.currency,
    customer: { name: b.customer.name, email: b.customer.email, phone: b.customer.phone },
    shippingAddress: b.shippingAddress
      ? { name: b.customer.name, email: b.customer.email, ...b.shippingAddress }
      : undefined,
  });

  const successUrl = `${CLIENT_URL}/checkout/confirmation?order=${order.id}`;

  if (!cashfreeConfigured) {
    // Demo mode — mark paid, clear cart, return confirmation url directly.
    const paidOrder = await markOrderPaid(order.id, "demo mode: no Cashfree keys configured");
    await carts.set(scopedId, { sessionId: scopedId, items: [], itemCount: 0, subtotal: 0, currency: "INR", updatedAt: Date.now() });
    sendOrderConfirmationEmail(paidOrder).catch((err) => console.error("[checkout] confirmation email failed:", err.message));
    return created(res, { url: successUrl, orderId: order.id, mode: "demo" });
  }

  // Cashfree only bills INR-major-unit amounts and only supports INR/USD-ish
  // currencies it's onboarded for — our totals are already INR-only in
  // practice (see computeTotals: non-INR carts get a flat USD shipping add,
  // but kynq only sells in INR today).
  try {
    const cf = await createCashfreeOrder({
      orderId: order.id,
      amount: totals.dueToday,
      currency: totals.currency,
      customer: { id: userId || scopedId, name: b.customer.name, email: b.customer.email, phone: b.customer.phone },
      returnUrl: successUrl,
    });
    await updateOrder(order.id, { cashfreeOrderId: cf.order_id, cashfreePaymentSessionId: cf.payment_session_id });
    return created(res, {
      orderId: order.id,
      mode: "cashfree",
      cashfreeMode,
      paymentSessionId: cf.payment_session_id,
    });
  } catch (err) {
    console.error("[checkout] Cashfree order creation failed:", err.message, err.cashfree);
    await setOrderStatus(order.id, "cancelled", `cashfree order creation failed: ${err.message}`);
    return badRequest(res, "couldn't start payment — try again in a moment");
  }
}));

export default router;
