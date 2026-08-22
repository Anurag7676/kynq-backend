// Cashfree Payment Gateway client — Orders API + webhook signature verification.
// Docs: https://www.cashfree.com/docs/payments/online/web/redirect
//       https://www.cashfree.com/docs/api-reference/vrs/webhook-signature-verification
//
// Required env vars (from the Cashfree dashboard → Developers → API Keys):
//   CASHFREE_APP_ID      — Client ID
//   CASHFREE_SECRET_KEY  — Client Secret (also the webhook signing secret)
//   CASHFREE_ENV         — "sandbox" (test mode) or "production" (default: sandbox)
//   CASHFREE_API_VERSION — optional, defaults to 2025-01-01
import crypto from "crypto";

const APP_ID = process.env.CASHFREE_APP_ID;
const SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const ENV = process.env.CASHFREE_ENV === "production" ? "production" : "sandbox";
const API_VERSION = process.env.CASHFREE_API_VERSION || "2025-01-01";

export const cashfreeConfigured = !!(APP_ID && SECRET_KEY);
export const cashfreeMode = ENV; // passed to the frontend JS SDK's Cashfree({ mode })

const BASE_URL = ENV === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";

function headers() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-api-version": API_VERSION,
    "x-client-id": APP_ID,
    "x-client-secret": SECRET_KEY,
  };
}

// POST /pg/orders — order_amount is in rupees (major unit), not paise.
export async function createCashfreeOrder({ orderId, amount, currency, customer, returnUrl }) {
  const res = await fetch(`${BASE_URL}/orders`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      order_id: orderId,
      order_amount: amount,
      order_currency: currency,
      customer_details: {
        customer_id: sanitizeCustomerId(customer.id || customer.email),
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone,
      },
      order_meta: { return_url: returnUrl },
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.message || `Cashfree order creation failed (${res.status})`);
    err.cashfree = json;
    throw err;
  }
  return json; // { order_id, payment_session_id, order_status, ... }
}

// GET /pg/orders/{order_id} — used as a reconciliation fallback when a
// webhook hasn't landed yet (e.g. localhost, where Cashfree can't reach us).
export async function getCashfreeOrder(orderId) {
  const res = await fetch(`${BASE_URL}/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) return null;
  return res.json(); // { order_status: "PAID" | "ACTIVE" | "EXPIRED" | ..., ... }
}

// x-webhook-signature = base64(HMAC-SHA256(x-webhook-timestamp + rawBody, secretKey))
// Must be computed over the exact raw body, not a re-serialized JSON object.
export function verifyCashfreeWebhookSignature(rawBody, timestamp, signature) {
  if (!timestamp || !signature) return false;
  const expected = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(timestamp + rawBody)
    .digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false; // length mismatch etc.
  }
}

function sanitizeCustomerId(raw) {
  // Cashfree customer_id allows alphanumeric + a few symbols only.
  return String(raw || "guest").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50) || "guest";
}
