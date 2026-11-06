// Razorpay client: Orders API, Standard Checkout signature check, webhook signature check.
// Docs: https://razorpay.com/docs/api/orders/create/
//       https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
//       https://razorpay.com/docs/webhooks/validate-test/
//
// Required env vars (Razorpay Dashboard → Account & Settings → API Keys / Webhooks):
//   RAZORPAY_KEY_ID          — rzp_live_… (or rzp_test_… for test mode); also sent to the browser
//   RAZORPAY_KEY_SECRET      — the key secret (server only)
//   RAZORPAY_WEBHOOK_SECRET  — the secret you type when creating the webhook (NOT the key secret)
import crypto from "crypto";

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const BASE_URL = "https://api.razorpay.com/v1";

export const razorpayConfigured = !!(KEY_ID && KEY_SECRET);
export const razorpayKeyId = KEY_ID;
export const razorpayMode = KEY_ID?.startsWith("rzp_live_") ? "live" : "test";
if (razorpayConfigured && !WEBHOOK_SECRET) {
  console.error("[razorpay] RAZORPAY_WEBHOOK_SECRET is not set — webhooks will be refused (payments still confirm through checkout verification).");
}

const auth = () => `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;

/** Rupees (major unit, may have paise) → paise (integer), as Razorpay bills. */
export const toPaise = (rupees) => Math.round(Number(rupees) * 100);

// POST /v1/orders. `receipt` is our own order id (≤ 40 chars), so every webhook can find the
// order without a lookup; `notes.kynq_order_id` repeats it on the payment and refund entities.
export async function createRazorpayOrder({ orderId, amount, currency = "INR", notes = {} }) {
  const res = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers: { Authorization: auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: toPaise(amount), currency, receipt: String(orderId).slice(0, 40), notes: { kynq_order_id: orderId, ...notes } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.description || `Razorpay order creation failed (${res.status})`);
    err.razorpay = json;
    throw err;
  }
  return json; // { id: "order_…", amount, currency, receipt, status: "created", … }
}

// GET /v1/orders/{id}: reconciliation when neither the checkout callback nor a webhook landed.
export async function getRazorpayOrder(razorpayOrderId) {
  const res = await fetch(`${BASE_URL}/orders/${encodeURIComponent(razorpayOrderId)}`, { headers: { Authorization: auth() } });
  if (!res.ok) return null;
  return res.json(); // { status: "created" | "attempted" | "paid", amount_paid, … }
}

const safeEqual = (a, b) => {
  try { return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
};

/** Checkout success handler: signature = hex(HMAC-SHA256(order_id + "|" + payment_id, key secret)). */
export function verifyRazorpayPayment({ razorpayOrderId, razorpayPaymentId, signature }) {
  if (!KEY_SECRET || !razorpayOrderId || !razorpayPaymentId || typeof signature !== "string") return false;
  const expected = crypto.createHmac("sha256", KEY_SECRET).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

/** Webhook: X-Razorpay-Signature = hex(HMAC-SHA256(raw body, webhook secret)). Raw body only. */
export function verifyRazorpayWebhook(rawBody, signature) {
  if (!WEBHOOK_SECRET || typeof signature !== "string") return false;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}
