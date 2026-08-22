// Session + auth layer for the gift API. Two cookies:
//   kynq_session — anonymous shopping session (scopes cart/wishlist pre-login)
//   kynq_auth    — signed-in session token (email OTP auth, see otp.js)
// Ports lib/server/{session,scope,auth,auth-store}.

import { collection, makeToken, makeId } from "./store.js";

const ANON_COOKIE = "kynq_session";
const AUTH_COOKIE = "kynq_auth";
const ONE_YEAR_S = 60 * 60 * 24 * 365;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const users = collection("users");
const sessions = collection("auth-sessions");

function cookieOpts(maxAgeS) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeS * 1000,
  };
}

// ─── Anonymous session ─────────────────────────────────────
export function getOrCreateSession(req, res) {
  const existing = req.cookies?.[ANON_COOKIE];
  if (existing) return { sessionId: existing, isNew: false };
  const sessionId = makeToken();
  res.cookie(ANON_COOKIE, sessionId, cookieOpts(ONE_YEAR_S));
  return { sessionId, isNew: true };
}

// ─── Users ─────────────────────────────────────────────────
export async function findUserById(id) {
  const all = await users.list();
  return all.find((u) => u.id === id) ?? null;
}
export async function getOrCreateUser(email, name) {
  const key = email.toLowerCase().trim();
  const existing = await users.get(key);
  const now = Date.now();
  if (existing) {
    const updated = { ...existing, lastSeenAt: now, name: existing.name ?? name };
    await users.set(key, updated);
    return updated;
  }
  const user = { id: `usr_${makeId()}`, email: key, name, createdAt: now, lastSeenAt: now, addresses: [] };
  await users.set(key, user);
  return user;
}
export async function saveUser(user) {
  await users.set(user.email.toLowerCase().trim(), user);
  return user;
}

function addressKey(a) {
  return [a.line1, a.city, a.postalCode].map((s) => (s || "").trim().toLowerCase()).join("|");
}

// Called from checkout — fills in the account's name (if it was never set,
// e.g. the user signed in via /login or the checkout gate rather than
// /register) and saves the shipping address to their address book (deduped
// by line1+city+postalCode, so re-ordering to the same place doesn't create
// duplicates). Both are no-ops if there's nothing new to save.
export async function syncProfileFromCheckout(userId, { name, address } = {}) {
  const user = await findUserById(userId);
  if (!user) return;

  let changed = false;
  const next = { ...user, addresses: user.addresses ? [...user.addresses] : [] };

  if (!next.name && name) {
    next.name = name;
    changed = true;
  }

  if (address?.line1 && address?.city && address?.postalCode) {
    const key = addressKey(address);
    const exists = next.addresses.some((a) => addressKey(a) === key);
    if (!exists) {
      next.addresses.push({
        id: makeId("addr"),
        label: address.label,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country || "India",
        isDefault: next.addresses.length === 0,
      });
      changed = true;
    }
  }

  if (changed) await saveUser(next);
}

// ─── Auth sessions ─────────────────────────────────────────
export async function createAuthSession(userId) {
  const token = makeToken();
  const now = Date.now();
  const session = { token, userId, createdAt: now, expiresAt: now + THIRTY_DAYS_MS };
  await sessions.set(token, session);
  return session;
}
async function getAuthSession(token) {
  const s = await sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) { await sessions.delete(token); return null; }
  return s;
}

export async function signIn(res, userId) {
  const session = await createAuthSession(userId);
  res.cookie(AUTH_COOKIE, session.token, cookieOpts(THIRTY_DAYS_MS / 1000));
}
export async function signOut(req, res) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (token) await sessions.delete(token);
  res.clearCookie(AUTH_COOKIE, { path: "/" });
}
export async function getCurrentUser(req) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return null;
  const session = await getAuthSession(token);
  if (!session) return null;
  return findUserById(session.userId);
}
export async function requireCurrentUser(req) {
  const u = await getCurrentUser(req);
  if (!u) throw new Error("UNAUTHORIZED");
  return u;
}

// ─── Scoped id (cart/wishlist) ─────────────────────────────
export async function getScopedId(req, res) {
  const user = await getCurrentUser(req);
  if (user) return { scopedId: user.id, userId: user.id, isAuthenticated: true };
  const { sessionId } = getOrCreateSession(req, res);
  return { scopedId: sessionId, userId: null, isAuthenticated: false };
}
