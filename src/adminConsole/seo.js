// Google Search Console for the admin dashboard: how kynq shows up in Google search.
//
// Setup (once): the same service account used for Google Analytics works here.
//   1. In Google Cloud, enable the "Google Search Console API" for the project.
//   2. In Search Console > Settings > Users and permissions, add the service account's email (Restricted is enough).
//   3. On the backend set SEARCH_CONSOLE_SITE to the property exactly as Search Console lists it:
//      "sc-domain:kynq.in" for a Domain property, or "https://kynq.in/" for a URL-prefix property.
// Without these the dashboard shows a setup screen; nothing else is affected.
import { accessToken, hasServiceAccount } from "./ga.js";
import { cached, dayKeys, fillSeries } from "./util.js";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
// kynq.in Domain property. Not a secret; SEARCH_CONSOLE_SITE overrides it.
const SITE = process.env.SEARCH_CONSOLE_SITE || "sc-domain:kynq.in";
const API = "https://www.googleapis.com/webmasters/v3/sites";
const DAY = 86_400_000;
// Search Console reports up to ~2 days behind; ending 2 days back keeps every day in range complete.
const LAG_DAYS = 2;

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export function seoStatus() {
  const missing = [];
  if (!SITE) missing.push("SEARCH_CONSOLE_SITE");
  if (!hasServiceAccount()) missing.push("GA_SERVICE_ACCOUNT_JSON (or GA_SERVICE_ACCOUNT_FILE)");
  return { configured: missing.length === 0, missing };
}

async function query(body) {
  const token = await accessToken(SCOPE);
  const r = await fetch(`${API}/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Search Console returned ${r.status}`), { status: r.status });
  return j.rows ?? [];
}

function friendlyError(err) {
  const msg = String(err?.message || err);
  if (err?.status === 403 || /permission|forbidden|sufficient/i.test(msg)) return { error: "Search Console says this service account can't read the site.", hint: "In Search Console > Settings > Users and permissions, add the service account's email, and check SEARCH_CONSOLE_SITE matches the property exactly (sc-domain:kynq.in or https://kynq.in/)." };
  if (err?.status === 404 || /not found|no site/i.test(msg)) return { error: "Search Console doesn't know that site.", hint: "SEARCH_CONSOLE_SITE must be the property exactly as listed in Search Console: sc-domain:kynq.in for a Domain property, or https://kynq.in/ (with the trailing slash) for a URL-prefix one." };
  if (/has not been used|disabled|accessNotConfigured/i.test(msg)) return { error: "The Search Console API isn't switched on.", hint: "In Google Cloud, enable \"Google Search Console API\" for the same project as the service account." };
  if (/service account key|invalid_grant|private key/i.test(msg)) return { error: "Google rejected the service account key.", hint: "Check GA_SERVICE_ACCOUNT_JSON / GA_SERVICE_ACCOUNT_FILE contains the full, current key." };
  return { error: msg, hint: null };
}

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const metrics = (r) => ({ clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: round(r.ctr ?? 0, 4), position: round(r.position ?? 0, 1) });
const stripHost = (url) => { try { const u = new URL(url); return u.pathname + u.search || "/"; } catch { return url; } };

// A Domain property reports kynq.in and www.kynq.in (and http/https) separately; with the host
// stripped they share a path, so fold them: clicks/impressions add up, CTR is recomputed,
// position is averaged by impressions.
function mergePages(list) {
  const out = new Map();
  for (const r of list) {
    const cur = out.get(r.page);
    if (!cur) { out.set(r.page, { ...r }); continue; }
    const imp = cur.impressions + r.impressions;
    cur.position = imp ? Math.round(((cur.position * cur.impressions + r.position * r.impressions) / imp) * 10) / 10 : cur.position;
    cur.clicks += r.clicks; cur.impressions = imp;
    cur.ctr = imp ? Math.round((cur.clicks / imp) * 10000) / 10000 : 0;
  }
  return [...out.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

export function seo({ days }) {
  const status = seoStatus();
  if (!status.configured) return Promise.resolve({ configured: false, missing: status.missing });
  return cached(`seo:${days}`, 900_000, async () => {
    const endMs = Date.now() - LAG_DAYS * DAY;
    const startMs = endMs - (days - 1) * DAY;
    const prevEnd = startMs - DAY;
    const prevStart = prevEnd - (days - 1) * DAY;
    const range = { startDate: iso(startMs), endDate: iso(endMs) };
    const dim = (dimensions, rowLimit) => query({ ...range, dimensions, rowLimit, type: "web" });

    const [totalRows, prevRows, dayRows, queryRows, pageRows, countryRows, deviceRows] = await Promise.all([
      query({ ...range, type: "web" }),
      query({ startDate: iso(prevStart), endDate: iso(prevEnd), type: "web" }),
      dim(["date"], 500),
      dim(["query"], 25),
      dim(["page"], 25),
      dim(["country"], 8),
      dim(["device"], 4),
    ]);

    const keys = dayKeys(startMs, endMs);
    const byDay = new Map(dayRows.map((r) => [r.keys[0], r]));
    return {
      configured: true,
      site: SITE,
      range: { days, startDate: range.startDate, endDate: range.endDate },
      totals: metrics(totalRows[0] ?? {}),
      previous: metrics(prevRows[0] ?? {}),
      series: fillSeries(keys, byDay, (date, r) => ({ date, clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0 })),
      queries: queryRows.map((r) => ({ query: r.keys[0], ...metrics(r) })),
      pages: mergePages(pageRows.map((r) => ({ page: stripHost(r.keys[0]), ...metrics(r) }))),
      countries: countryRows.map((r) => ({ country: r.keys[0].toUpperCase(), ...metrics(r) })),
      devices: deviceRows.map((r) => ({ device: r.keys[0].toLowerCase(), ...metrics(r) })),
      notes: [
        `Search Console data runs about ${LAG_DAYS} days behind, so this range ends ${range.endDate}.`,
        "Google hides very rare searches to protect privacy, so the listed searches add up to a bit less than the total.",
        "Position is the average ranking of your result in Google (1 is the top of page one).",
      ],
      generatedAt: Date.now(),
    };
  }).catch((err) => ({ configured: true, range: { days }, ...friendlyError(err) }));
}
