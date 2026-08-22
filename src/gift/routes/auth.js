import express from "express";
import rateLimit from "express-rate-limit";
import { collection } from "../store.js";
import {
  getOrCreateUser, saveUser,
  signIn, signOut, getCurrentUser, getOrCreateSession,
} from "../session.js";
import { requestOtp, verifyOtp } from "../otp.js";
import { mergeAnonymousIntoUser } from "../merge.js";
import { ok, badRequest, unauthorized, tooMany, wrap } from "../http.js";

const router = express.Router();
const users = collection("users");

// IP-scoped, on top of otp.js's own per-email cooldown/attempt-cap — this
// guards against one IP hammering many different email addresses, which a
// per-email limit alone doesn't catch. Mounted only on the two OTP routes,
// not the whole /api/auth router (GET /me is polled far more often than
// this and needs its own, much larger budget — see app.js).
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "too_many_requests", message: "too many attempts — try again later." },
});

// Only allow redirecting back into our own app — a `next` value is
// client-supplied, so treat it as untrusted and restrict it to a
// same-app relative path.
function safeNext(raw) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return "/account";
  return raw;
}

// POST /api/auth/request-otp — email a 6-digit sign-in code (logged in dev)
router.post("/request-otp", otpLimiter, wrap(async (req, res) => {
  const email = req.body?.email;
  const name = req.body?.name;
  if (!email || !/.+@.+\..+/.test(email)) return badRequest(res, "valid email required");
  if (name) await getOrCreateUser(email, name);

  const result = await requestOtp(email);
  if (!result.ok && result.reason === "cooldown") {
    return tooMany(res, "a code was just sent — wait a moment before requesting another.", { retryAfterMs: result.retryAfterMs });
  }
  ok(res, { ok: true, message: "if that email exists, a code is on its way." });
}));

// POST /api/auth/verify-otp — verify the code, sign in, fold in the guest cart
router.post("/verify-otp", otpLimiter, wrap(async (req, res) => {
  const email = req.body?.email;
  const code = req.body?.code;
  const next = safeNext(req.body?.next);
  if (!email || !code) return badRequest(res, "email and code required");

  const result = await verifyOtp(email, code);
  if (!result.ok) return badRequest(res, otpErrorMessage(result.reason), { reason: result.reason });

  const user = await getOrCreateUser(email);
  // Fold the guest's cart/wishlist/orders into the account before the
  // anonymous session cookie stops being consulted (getScopedId() switches
  // to user.id the moment kynq_auth is set below).
  const { sessionId: anonSessionId } = getOrCreateSession(req, res);
  await mergeAnonymousIntoUser(anonSessionId, user.id);
  await signIn(res, user.id);
  ok(res, { ok: true, user, next });
}));

function otpErrorMessage(reason) {
  switch (reason) {
    case "wrong_code": return "that code's wrong. try again?";
    case "expired": return "that code expired. request a new one.";
    case "too_many_attempts": return "too many wrong tries. request a new code.";
    case "no_code": return "request a code first.";
    default: return "couldn't verify that code.";
  }
}

// GET /api/auth/me
router.get("/me", wrap(async (req, res) => {
  ok(res, { user: await getCurrentUser(req) });
}));

// PATCH /api/auth/me — update name
router.patch("/me", wrap(async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me) return unauthorized(res);
  const name = req.body?.name;
  if (!name) return badRequest(res, "name required");
  const next = { ...me, name: String(name).slice(0, 120) };
  await saveUser(next);
  ok(res, { user: next });
}));

// POST /api/auth/signout
router.post("/signout", wrap(async (req, res) => {
  await signOut(req, res);
  ok(res, { ok: true });
}));

// ─── Addresses (GET/POST /api/auth/me/addresses, PATCH/DELETE /:addressId) ───
function newAddrId() { return "addr_" + Math.random().toString(36).slice(2, 11); }

router.get("/me/addresses", wrap(async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me) return unauthorized(res);
  ok(res, { addresses: me.addresses || [] });
}));

router.post("/me/addresses", wrap(async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me) return unauthorized(res);
  const a = req.body || {};
  if (!a.line1 || !a.city || !a.postalCode) return badRequest(res, "line1, city, postalCode required");
  const addr = { id: newAddrId(), label: a.label, line1: a.line1, line2: a.line2, city: a.city, state: a.state, postalCode: a.postalCode, country: a.country || "India", isDefault: !!a.isDefault };
  const addresses = [...(me.addresses || []), addr];
  await saveUser({ ...me, addresses });
  ok(res, { addresses });
}));

router.patch("/me/addresses/:addressId", wrap(async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me) return unauthorized(res);
  const addresses = (me.addresses || []).map((a) => (a.id === req.params.addressId ? { ...a, ...req.body, id: a.id } : a));
  await saveUser({ ...me, addresses });
  ok(res, { addresses });
}));

router.delete("/me/addresses/:addressId", wrap(async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me) return unauthorized(res);
  const addresses = (me.addresses || []).filter((a) => a.id !== req.params.addressId);
  await saveUser({ ...me, addresses });
  ok(res, { addresses });
}));

export default router;
