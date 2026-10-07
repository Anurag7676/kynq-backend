// Google Analytics 4 for the admin dashboard, read through the GA Data API.
//
// Setup (once): in Google Cloud enable "Google Analytics Data API", create a service account and a JSON key,
// then in GA4 (Admin > Property access management) add the service account's email as a Viewer. Settings:
//   GA_PROPERTY_ID            the numeric GA4 property id (NOT the G-XXXX measurement id)
//   GA_SERVICE_ACCOUNT_JSON   the key file's contents (raw JSON or base64), or
//   GA_SERVICE_ACCOUNT_FILE   a path to the key file (handy locally)
// Without these the dashboard simply shows a "connect Google Analytics" screen; nothing else is affected.
import fs from "node:fs";
import jwt from "jsonwebtoken";
import { cached } from "./util.js";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const API = "https://analyticsdata.googleapis.com/v1beta";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

// The events the app sends (see lib/analytics.ts in the site): the sign-up funnel, seen from GA's side.
export const FUNNEL_EVENTS = ["page_view", "cta_start_click", "signup_started", "signin_completed", "signup_completed", "match_started", "call_connected", "call_failed", "eligible_chat_completed"];

// Fallback when neither setting is given: Backend/key.json (gitignored — copy it onto the server by hand).
const DEFAULT_KEY_FILE = new URL("../../key.json", import.meta.url);

function credentials() {
  try {
    const raw = process.env.GA_SERVICE_ACCOUNT_JSON;
    const file = process.env.GA_SERVICE_ACCOUNT_FILE || (fs.existsSync(DEFAULT_KEY_FILE) ? DEFAULT_KEY_FILE : null);
    const text = raw ? (raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) : file ? fs.readFileSync(file, "utf8") : null;
    if (!text) return null;
    const c = JSON.parse(text);
    return c.client_email && c.private_key ? c : null;
  } catch {
    return null;
  }
}

export function gaStatus() {
  const missing = [];
  if (!process.env.GA_PROPERTY_ID) missing.push("GA_PROPERTY_ID");
  if (!credentials()) missing.push("GA_SERVICE_ACCOUNT_JSON (or GA_SERVICE_ACCOUNT_FILE)");
  return { configured: missing.length === 0, missing };
}

// One cached token per scope (Analytics and Search Console share the same service account).
const tokenCache = new Map();
const tokenPending = new Map();
async function fetchToken(scope) {
  const c = credentials();
  const uri = c.token_uri || DEFAULT_TOKEN_URI;
  const assertion = jwt.sign({ iss: c.client_email, scope, aud: uri }, c.private_key, { algorithm: "RS256", expiresIn: 3600 });
  const r = await fetch(uri, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error_description || "Google rejected the service account key.");
  tokenCache.set(scope, { token: j.access_token, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}
// Requests that start together share one token request.
export async function accessToken(scope = SCOPE) {
  const hit = tokenCache.get(scope);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  if (!tokenPending.has(scope)) tokenPending.set(scope, fetchToken(scope).finally(() => tokenPending.delete(scope)));
  return tokenPending.get(scope);
}
export const hasServiceAccount = () => !!credentials();

async function call(method, body) {
  const token = await accessToken();
  const r = await fetch(`${API}/properties/${encodeURIComponent(process.env.GA_PROPERTY_ID)}:${method}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Google Analytics returned ${r.status}`), { status: r.status });
  return j;
}

// Turns a report into plain rows: [{ dims: [..], mets: [numbers] }]
const rows = (report) => (report?.rows || []).map((r) => ({ dims: (r.dimensionValues || []).map((d) => d.value), mets: (r.metricValues || []).map((m) => Number(m.value) || 0) }));
const isoDate = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
const notSet = (v) => (!v || v === "(not set)" ? "Unknown" : v);

// A friendlier message for the setup mistakes people actually make.
function friendlyError(err) {
  const msg = String(err?.message || err);
  if (err?.status === 403 || /permission|forbidden|not have/i.test(msg)) return { error: "Google Analytics says this service account can't read the property.", hint: "In GA4 > Admin > Property access management, add the service account's email as a Viewer, and make sure the Analytics Data API is enabled in Google Cloud." };
  if (err?.status === 400 && /property/i.test(msg)) return { error: "Google Analytics didn't accept the property id.", hint: "GA_PROPERTY_ID must be the numeric property id from GA4 > Admin > Property details, not the G-XXXX measurement id." };
  if (/service account key|invalid_grant|private key/i.test(msg)) return { error: "Google rejected the service account key.", hint: "Check GA_SERVICE_ACCOUNT_JSON / GA_SERVICE_ACCOUNT_FILE contains the full, current key." };
  return { error: msg, hint: null };
}

export function realtime() {
  const status = gaStatus();
  if (!status.configured) return Promise.resolve({ configured: false, missing: status.missing });
  return cached("ga:realtime", 30_000, async () => {
    {
      const [totals, pages, countries] = await Promise.all([
        call("runRealtimeReport", { metrics: [{ name: "activeUsers" }], minuteRanges: [{ name: "last30", startMinutesAgo: 29, endMinutesAgo: 0 }, { name: "last5", startMinutesAgo: 4, endMinutesAgo: 0 }] }),
        call("runRealtimeReport", { dimensions: [{ name: "unifiedScreenName" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], limit: 8 }),
        call("runRealtimeReport", { dimensions: [{ name: "country" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], limit: 6 }),
      ]);
      const byRange = Object.fromEntries(rows(totals).map((r) => [r.dims[0], r.mets[0]]));
      return {
        configured: true,
        realtime: {
          activeNow: byRange.last30 ?? 0, last5: byRange.last5 ?? 0,
          pages: rows(pages).map((r) => ({ page: notSet(r.dims[0]), users: r.mets[0] })),
          countries: rows(countries).map((r) => ({ country: notSet(r.dims[0]), users: r.mets[0] })),
        },
        generatedAt: Date.now(),
      };
    }
  }).catch((err) => ({ configured: true, ...friendlyError(err) }));
}

export function traffic({ days }) {
  const status = gaStatus();
  if (!status.configured) return Promise.resolve({ configured: false, missing: status.missing });
  return cached(`ga:traffic:${days}`, 300_000, async () => {
    {
      const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "today" }];
      const top = (dimension, metric, limit, extra = {}) => ({ dateRanges, dimensions: [{ name: dimension }], metrics: [{ name: metric }], orderBys: [{ metric: { metricName: metric }, desc: true }], limit, ...extra });
      const [a, b] = await Promise.all([
        call("batchRunReports", { requests: [
          { dateRanges, metrics: ["activeUsers", "newUsers", "sessions", "engagementRate", "averageSessionDuration", "screenPageViews"].map((name) => ({ name })) },
          { dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }, { name: "sessions" }], orderBys: [{ dimension: { dimensionName: "date" } }], limit: 100 },
          { dateRanges, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 8 },
          top("sessionSource", "sessions", 8),
          { dateRanges, dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "engagementRate" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 10 },
        ] }),
        call("batchRunReports", { requests: [
          top("country", "activeUsers", 8),
          top("region", "activeUsers", 10, { dimensionFilter: { filter: { fieldName: "country", stringFilter: { value: "India", matchType: "EXACT" } } } }),
          top("deviceCategory", "activeUsers", 5),
          { dateRanges, dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: FUNNEL_EVENTS } } }, limit: 20 },
        ] }),
      ]);
      const [totals, series, channels, sources, landing] = a.reports || [];
      const [countries, states, devices, events] = b.reports || [];
      const t = rows(totals)[0]?.mets ?? [];
      const eventCounts = new Map(rows(events).map((r) => [r.dims[0], r.mets[0]]));
      return {
        configured: true,
        range: { days },
        totals: { users: t[0] ?? 0, newUsers: t[1] ?? 0, sessions: t[2] ?? 0, engagementRate: t[3] ?? 0, avgSessionSec: Math.round(t[4] ?? 0), pageViews: t[5] ?? 0 },
        series: rows(series).map((r) => ({ date: isoDate(r.dims[0]), users: r.mets[0], sessions: r.mets[1] })),
        channels: rows(channels).map((r) => ({ channel: notSet(r.dims[0]), sessions: r.mets[0], users: r.mets[1] })),
        sources: rows(sources).map((r) => ({ source: notSet(r.dims[0]), sessions: r.mets[0] })),
        landingPages: rows(landing).map((r) => ({ page: notSet(r.dims[0]), sessions: r.mets[0], users: r.mets[1], engagementRate: r.mets[2] })),
        countries: rows(countries).map((r) => ({ country: notSet(r.dims[0]), users: r.mets[0] })),
        states: rows(states).map((r) => ({ state: notSet(r.dims[0]), users: r.mets[0] })),
        devices: rows(devices).map((r) => ({ device: notSet(r.dims[0]), users: r.mets[0] })),
        events: FUNNEL_EVENTS.map((name) => ({ name, count: eventCounts.get(name) ?? 0 })),
        notes: ["Google Analytics reports can lag by several hours; today's numbers may still grow.", "Numbers here are Google's own (visitors, including people who never sign up)."],
        generatedAt: Date.now(),
      };
    }
  }).catch((err) => ({ configured: true, range: { days }, ...friendlyError(err) }));
}
