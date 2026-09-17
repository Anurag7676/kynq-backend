// coturn's time-limited "REST API" credential scheme (RFC-adjacent, coturn
// docs: `use-auth-secret` + `static-auth-secret`) — mints short-lived TURN
// creds from existing session identity, no separate vendor account or
// webhook. See the plan's TURN decision (self-hosted coturn for V1).
import crypto from "crypto";

const TURN_SECRET = process.env.TURN_SECRET;
const TURN_URLS = (process.env.TURN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
const CREDENTIAL_TTL_S = 12 * 60 * 60; // 12h — long enough for a call, short enough to limit relay abuse if leaked

export const turnConfigured = !!(TURN_SECRET && TURN_URLS.length > 0);

export function mintTurnCredentials(scopedId) {
  if (!turnConfigured) return null;
  const timestamp = Math.floor(Date.now() / 1000) + CREDENTIAL_TTL_S;
  const username = `${timestamp}:${scopedId}`;
  const password = crypto.createHmac("sha1", TURN_SECRET).update(username).digest("base64");
  return { username, password, ttl: CREDENTIAL_TTL_S, urls: TURN_URLS };
}
