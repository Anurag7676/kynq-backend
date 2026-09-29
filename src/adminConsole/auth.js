// Admin sign-in: Google proves who someone is; an allowlist decides who may enter.
// The session is a short-lived signed cookie, separate from the customer session.
//
// Two roles:
//   owner    — ADMIN_EMAILS (env), full access to every section, always.
//   subadmin — created by an owner (see subadmins.js), scoped to whichever
//              sections that owner picked. Re-checked from the database on
//              EVERY request (not just at sign-in), so revoking access or
//              editing someone's sections takes effect on their very next
//              click, not their next login.
//
// Settings (environment):
//   ADMIN_EMAILS         comma-separated Google emails that are owners (required; nobody can sign in without it)
//   JWT_SECRET           signs the admin cookie (already used by the rest of the backend)
//   GOOGLE_CLIENT_ID     the same Google client the main site uses
//   CONSOLE_DEV_LOGIN    "true" enables POST /auth/dev-login, only when NODE_ENV is not production
import jwt from "jsonwebtoken";
import { unauthorized, forbidden } from "../gift/http.js";
import { getActiveSubadmin } from "./subadmins.js";

const COOKIE = "kynq_admin";
const SESSION_S = 8 * 60 * 60; // 8 hours

// Where the admin app may call from. The production site, plus local dev addresses outside production
// (3007 is the port already registered with Google for local sign-in).
export const CONSOLE_ORIGINS = ["https://admin.kynq.in", ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:3008", "http://localhost:3007"])];

export const adminEmails = () =>
  (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const isOwner = (email) => !!email && adminEmails().includes(String(email).toLowerCase());

/** email → { email, name, role, allowedSections } | null. allowedSections is
 * "all" for an owner, an array of section keys for a subadmin. */
export async function resolveAdmin(email, fallbackName) {
  if (!email) return null;
  const clean = String(email).toLowerCase();
  if (isOwner(clean)) return { email: clean, name: fallbackName ?? null, role: "owner", allowedSections: "all" };
  const sub = await getActiveSubadmin(clean);
  if (!sub) return null;
  return { email: clean, name: sub.name ?? fallbackName ?? null, role: "subadmin", allowedSections: sub.allowedSections };
}

const cookieOpts = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_S * 1000,
  path: "/",
});

export function startSession(res, admin) {
  const token = jwt.sign({ kind: "console", email: admin.email, name: admin.name || null }, process.env.JWT_SECRET, { expiresIn: SESSION_S });
  res.cookie(COOKIE, token, cookieOpts());
}
export const endSession = (res) => res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });

/** Google access token -> { email, name }, or throws an Error with a user-facing message. */
export async function verifyGoogleAccessToken(accessToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Google sign-in isn't set up on the server.");
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!r.ok) throw new Error("Google couldn't verify that sign-in.");
  const t = await r.json();
  if (t.aud !== clientId && t.azp !== clientId) throw new Error("That sign-in wasn't issued for kynq.");
  if (Number(t.expires_in) <= 0) throw new Error("That sign-in has expired.");
  let email = t.email;
  let name = null;
  let verified = String(t.email_verified) === "true";
  try {
    const u = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (u.ok) { const ui = await u.json(); name = ui.name ?? null; email = email || ui.email; if (ui.email_verified !== undefined) verified = ui.email_verified === true || ui.email_verified === "true"; }
  } catch { /* the name is optional */ }
  if (!email || !verified) throw new Error("That Google account's email isn't verified.");
  return { email: String(email).toLowerCase(), name };
}

/** Requires a valid admin cookie AND that the email is still allowed in right now — re-resolved
 * from ADMIN_EMAILS / the subadmins collection on every request, not trusted from the cookie. */
export async function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return unauthorized(res, "Sign in required");
  let claims;
  try { claims = jwt.verify(token, process.env.JWT_SECRET); } catch { return unauthorized(res, "Session expired"); }
  if (claims.kind !== "console") return unauthorized(res, "Invalid session");
  const admin = await resolveAdmin(claims.email, claims.name);
  if (!admin) return forbidden(res, "This account no longer has admin access.");
  req.admin = admin;
  next();
}

/** Gate a route to one or more sidebar sections (a subadmin needs just one of them — for data a
 * route shares across pages, e.g. /traffic/realtime feeds both Overview's live strip and Traffic
 * itself). Owners pass everything regardless. Keys are assigned by an owner — see subadmins.js. */
export function requireSection(...keys) {
  return (req, res, next) => {
    if (req.admin.role === "owner" || keys.some((k) => req.admin.allowedSections.includes(k))) return next();
    return forbidden(res, "You don't have access to this section.");
  };
}

/** Only owners manage who else gets in — a subadmin can never grant or see other subadmins. */
export function requireOwner(req, res, next) {
  if (req.admin.role !== "owner") return forbidden(res, "Only owners can manage team access.");
  next();
}

/** Writes must come from the admin app itself (defence in depth on top of SameSite cookies). */
export function sameOriginWrites(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !CONSOLE_ORIGINS.includes(origin)) return forbidden(res, "Cross-site request blocked");
  next();
}
