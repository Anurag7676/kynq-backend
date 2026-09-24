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

// Email-code sign-in is switched off: Google is the only way in. The routes
// stay (returning 410) so an old client gets a clear message instead of a 404.
// otp.js is untouched, so turning this back on is a small revert.
const emailCodesOff = (req, res) =>
  res.status(410).json({ success: false, error: "email_sign_in_disabled", message: "Email codes are turned off. Please continue with Google." });
router.post("/request-otp", otpLimiter, emailCodesOff);

// ─── Sign in with Google (Master Spec v3 §8) ───
// Enabled purely by configuration: set GOOGLE_CLIENT_ID (an OAuth "Web
// application" client id from Google Cloud) in Backend/.env and restart. The
// frontend reads the id from /google/config at runtime, so it needs no rebuild.
// With no id configured this is inert and email codes remain the way in.
//
// The 18+ check is unchanged and still applies to Google sign-ups: a new
// account has no date of birth, so Kynq Extra's onboarding gate stops it until
// one is confirmed. (Google does not give us a verified age.)
router.get("/google/config", wrap(async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || null;
  ok(res, { enabled: !!clientId, clientId });
}));

router.post("/google", otpLimiter, wrap(async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).json({ success: false, message: "Google sign-in isn't set up yet." });
  const credential = req.body?.credential;   // ID token (the rendered "Continue with Google" button)
  const accessToken = req.body?.accessToken; // access token (the direct Google popup on Start matching)
  const next = safeNext(req.body?.next);
  const hasCredential = typeof credential === "string" && credential;
  const hasAccessToken = typeof accessToken === "string" && accessToken;
  if (!hasCredential && !hasAccessToken) return badRequest(res, "missing Google credential");

  // Either way Google verifies the token's signature/expiry for us. We must
  // still check it was issued FOR THIS APP (aud) — otherwise a token minted for
  // any other site's Google login would sign people in here.
  let email, name, emailVerified;
  try {
    if (hasCredential) {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!r.ok) return unauthorized(res, "Google couldn't verify that sign-in. Please try again.");
      const t = await r.json();
      const issuerOk = t.iss === "accounts.google.com" || t.iss === "https://accounts.google.com";
      if (t.aud !== clientId || !issuerOk) return unauthorized(res, "That sign-in wasn't issued for kynq.");
      if (Number(t.exp) * 1000 <= Date.now()) return unauthorized(res, "That sign-in has expired. Please try again.");
      ({ email, name } = t); emailVerified = String(t.email_verified) === "true";
    } else {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
      if (!r.ok) return unauthorized(res, "Google couldn't verify that sign-in. Please try again.");
      const t = await r.json();
      if (t.aud !== clientId && t.azp !== clientId) return unauthorized(res, "That sign-in wasn't issued for kynq.");
      if (Number(t.expires_in) <= 0) return unauthorized(res, "That sign-in has expired. Please try again.");
      email = t.email; emailVerified = String(t.email_verified) === "true";
      // tokeninfo doesn't carry the display name; ask userinfo (best effort).
      try {
        const u = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
        if (u.ok) { const ui = await u.json(); name = ui.name; email = email || ui.email; if (ui.email_verified !== undefined) emailVerified = ui.email_verified === true || ui.email_verified === "true"; }
      } catch { /* name is optional */ }
    }
  } catch {
    return res.status(502).json({ success: false, message: "Couldn't reach Google. Please try again." });
  }
  if (!email || !emailVerified) return unauthorized(res, "That Google account's email isn't verified.");

  const user = await getOrCreateUser(email, name);
  const { sessionId: anonSessionId } = getOrCreateSession(req, res);
  await mergeAnonymousIntoUser(anonSessionId, user.id);
  await signIn(res, user.id);
  ok(res, { ok: true, user, next });
}));

router.post("/verify-otp", otpLimiter, emailCodesOff); // see above

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
