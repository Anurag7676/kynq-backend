// Resolves the same identity Backend/src/gift/session.js uses for HTTP
// requests (kynq_session / kynq_auth cookies -> scopedId), but for a
// Socket.io handshake, which never passes through the cookie-parser
// Express middleware. Read-only: unlike session.js's getScopedId(), this
// can't set a fresh anonymous cookie (no HTTP response to attach one to),
// so a user must have already loaded a kynq.in page at least once (which
// mints kynq_session) before opening a socket. That's true of every real
// user by construction — the queue UI only renders after the page loads.
import { collection } from "../gift/store.js";
import { findUserById } from "../gift/session.js";

const sessions = collection("auth-sessions");

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const pair of cookieHeader.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

// Returns { scopedId, userId, isAuthenticated } or null if the socket has
// no session cookie at all (should be rejected by the caller).
export async function resolveSocketIdentity(handshake) {
  const cookies = parseCookies(handshake.headers?.cookie);
  const authToken = cookies["kynq_auth"];

  if (authToken) {
    const session = await sessions.get(authToken);
    if (session && session.expiresAt > Date.now()) {
      const user = await findUserById(session.userId);
      if (user) return { scopedId: user.id, userId: user.id, isAuthenticated: true };
    }
  }

  const anonId = cookies["kynq_session"];
  if (anonId) return { scopedId: anonId, userId: null, isAuthenticated: false };

  return null;
}
