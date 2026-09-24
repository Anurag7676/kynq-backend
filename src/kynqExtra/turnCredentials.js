// coturn's time-limited "REST API" credential scheme (RFC-adjacent, coturn
// docs: `use-auth-secret` + `static-auth-secret`) — mints short-lived TURN
// creds from existing session identity, no separate vendor account or
// webhook. See the plan's TURN decision (self-hosted coturn for V1).
//
// STATIC fallback: most managed TURN providers' free tiers (Metered.ca,
// Twilio, Cloudflare) hand you one fixed username/credential pair instead of
// a shared secret to mint from. Good enough to unblock real calls before
// coturn is standing up — the coturn scheme above is preferred whenever both
// are set, since it's per-user and time-limited rather than one shared,
// non-expiring credential.
import crypto from "crypto";

const TURN_SECRET = process.env.TURN_SECRET;
const TURN_URLS = (process.env.TURN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
const CREDENTIAL_TTL_S = 12 * 60 * 60; // 12h — long enough for a call, short enough to limit relay abuse if leaked

const STATIC_TURN_URLS = (process.env.STATIC_TURN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
const STATIC_TURN_USERNAME = process.env.STATIC_TURN_USERNAME;
const STATIC_TURN_PASSWORD = process.env.STATIC_TURN_PASSWORD;

const coturnConfigured = !!(TURN_SECRET && TURN_URLS.length > 0);
const staticConfigured = !!(STATIC_TURN_URLS.length > 0 && STATIC_TURN_USERNAME && STATIC_TURN_PASSWORD);

export const turnConfigured = coturnConfigured || staticConfigured;

// A bare "turn:host:port" URL is UDP-only in browsers. Some mobile networks
// block UDP, so offer TCP too (coturn listens on both), and add the same host
// as a STUN server. ICE tries every route and keeps the one that works, so
// this costs nothing when UDP is fine.
function expandUrls(urls) {
  const out = [];
  for (const u of urls) {
    if (/^turns?:/i.test(u) && !u.includes("?")) { out.push(`${u}?transport=udp`, `${u}?transport=tcp`); }
    else out.push(u);
  }
  const first = urls.find((u) => /^turn:/i.test(u));
  if (first) out.push(first.replace(/^turn:/i, "stun:").replace(/\?.*$/, ""));
  return [...new Set(out)];
}

export function mintTurnCredentials(scopedId) {
  if (coturnConfigured) {
    const timestamp = Math.floor(Date.now() / 1000) + CREDENTIAL_TTL_S;
    const username = `${timestamp}:${scopedId}`;
    const password = crypto.createHmac("sha1", TURN_SECRET).update(username).digest("base64");
    return { username, password, ttl: CREDENTIAL_TTL_S, urls: expandUrls(TURN_URLS) };
  }
  if (staticConfigured) {
    return { username: STATIC_TURN_USERNAME, password: STATIC_TURN_PASSWORD, ttl: CREDENTIAL_TTL_S, urls: expandUrls(STATIC_TURN_URLS) };
  }
  return null;
}
