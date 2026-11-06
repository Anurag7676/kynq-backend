// Koin card payments are taken by kynq.online (its Cashfree account), not by kynq.in's own gateway.
// kynq.online's side lives in the kynq-online repo: backend/src/hosted-payments.js and partners.js.
//
//   create  POST https://kynq.online/api/payments/partner          (our coin order → its payment + checkout URL)
//   status  GET  https://kynq.online/api/payments/partner/<coin_id> (reconcile, used by gatewayStatus)
//   result  POST https://api.kynq.in/api/webhooks/kynq-online      (kynq.online tells us; routes/webhook-kynq-online.js)
//
// Both directions are signed with one shared secret:
//   X-KQ-Partner: kynq.in · X-KQ-Timestamp: <ms> · X-KQ-Signature: hex(HMAC-SHA256(secret, `${ts}.${METHOD}.${path}.${body}`))
// Requests older than 5 minutes are refused.
//
// Env:
//   KYNQ_ONLINE_PARTNER_SECRET  the shared secret (kynq.online's KYNQ_IN_PARTNER_SECRET); unset = off
//   KYNQ_ONLINE_API_URL         default https://kynq.online
import crypto from "crypto";

const BASE = (process.env.KYNQ_ONLINE_API_URL || "https://kynq.online").replace(/\/$/, "");
const SECRET = process.env.KYNQ_ONLINE_PARTNER_SECRET || "";
const PARTNER = "kynq.in";
const MAX_SKEW_MS = 5 * 60 * 1000;

export const kynqOnlineConfigured = !!SECRET;

const sign = (ts, method, path, body) =>
  crypto.createHmac("sha256", SECRET).update(`${ts}.${method.toUpperCase()}.${path}.${body}`).digest("hex");

async function call(method, path, payload) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const ts = String(Date.now());
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-KQ-Partner": PARTNER,
      "X-KQ-Timestamp": ts,
      "X-KQ-Signature": sign(ts, method, path, body),
    },
    body: body || undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.message || `kynq.online ${method} ${path} failed (${res.status})`);
    err.status = res.status;
    err.kynqOnline = json;
    throw err;
  }
  return json;
}

/** Start (or, for the same order id, get back) the payment. Returns { id, status, amount, checkoutUrl, … }. */
export async function createKynqOnlinePayment({ orderId, amount, description, customer, returnUrl }) {
  const { payment } = await call("POST", "/api/payments/partner", { reference: orderId, amount, currency: "INR", description, customer, returnUrl });
  return payment;
}

/** The payment for one of our orders, as kynq.online sees it after checking Cashfree; null if none. */
export async function getKynqOnlinePayment(orderId) {
  try {
    return (await call("GET", `/api/payments/partner/${encodeURIComponent(orderId)}`)).payment;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Checks a result kynq.online posted to us. `path` is the path it was posted to. */
export function verifyKynqOnlineCallback(rawBody, headers, path) {
  if (!SECRET) return false;
  const ts = String(headers["x-kq-timestamp"] || "");
  const given = String(headers["x-kq-signature"] || "");
  if (headers["x-kq-partner"] !== PARTNER || !/^\d{13}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return false;
  const expected = sign(ts, "POST", path, rawBody);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}
