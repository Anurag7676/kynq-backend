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

// Searches for the brand itself (and its common misspellings). Everything else is "found us by topic":
// the number SEO pages actually move.
const BRAND_RE = "kyn[qgk]|kinq|kynk";
const brandFilter = (operator) => [{ filters: [{ dimension: "query", operator, expression: BRAND_RE }] }];

// Typical share of clicks by Google position (rounded industry averages). Only used to rank
// opportunities by "extra clicks if this reached position 3" — an estimate, labelled as one.
const CTR_AT = [0, 0.28, 0.16, 0.11, 0.08, 0.065, 0.05, 0.04, 0.035, 0.03, 0.025];
const ctrAt = (p) => (p >= 1 && p <= 10 ? CTR_AT[Math.round(p)] : 0.01);

const POSITION_BUCKETS = [
  { key: "top3", label: "Top 3", max: 3.5 },
  { key: "page1", label: "4 to 10", max: 10.5 },
  { key: "page2", label: "11 to 20", max: 20.5 },
  { key: "deep", label: "21 and lower", max: Infinity },
];

// Page types, from the URL. Keep in sync with the site's SEO page clusters.
const PAGE_GROUPS = [
  { key: "home", label: "Home page", test: (p) => p === "/" },
  { key: "alternatives", label: "Alternatives and comparisons", test: (p) => /alternative|-vs-|sites-like/.test(p) },
  { key: "safety", label: "Safety and trust", test: (p) => /safe|safety|is-omegle-back|trust/.test(p) },
  { key: "ambassador", label: "Campus ambassador", test: (p) => /ambassador/.test(p) },
  { key: "hinglish", label: "Hinglish and Hindi", test: (p) => /hindi|hinglish|kaise|dost|baat|yaar/.test(p) },
  { key: "guides", label: "Guides, games and questions", test: (p) => /guide|journal|question|icebreaker|games|never-have|truth|make-friends|meet-new|strangers|faq/.test(p) },
  { key: "about", label: "About and legal", test: (p) => /^\/(what-is-kynq|about|terms|privacy|contact|careers|story)/.test(p) },
  { key: "store", label: "Gift store (old)", test: (p) => /^\/(shop|gift|gifts|occasions|bundles|collections|drops|custom|wishes|store|care|moments|in-the-wild|crossed-threads|search|cart|checkout)/.test(p) },
  { key: "app", label: "App pages", test: (p) => /^\/(match|login|register|account|messages|history|kynq-koins|extra)/.test(p) },
];
const groupOf = (page) => (PAGE_GROUPS.find((g) => g.test(page)) ?? { key: "other", label: "Other" });

function sumMetrics(list) {
  const clicks = list.reduce((n, r) => n + r.clicks, 0);
  const impressions = list.reduce((n, r) => n + r.impressions, 0);
  const position = impressions ? round(list.reduce((n, r) => n + r.position * r.impressions, 0) / impressions, 1) : 0;
  return { clicks, impressions, ctr: impressions ? round(clicks / impressions, 4) : 0, position };
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

    const prevRange = { startDate: iso(prevStart), endDate: iso(prevEnd) };
    const [totalRows, prevRows, dayRows, queryRows, pageRows, countryRows, deviceRows, brandRows, otherRows, prevBrandRows, prevOtherRows, otherDayRows] = await Promise.all([
      query({ ...range, type: "web" }),
      query({ ...prevRange, type: "web" }),
      dim(["date"], 500),
      dim(["query"], 1000), // all of them: buckets and opportunities need more than the top 25
      dim(["page"], 1000),
      dim(["country"], 8),
      dim(["device"], 4),
      query({ ...range, type: "web", dimensionFilterGroups: brandFilter("includingRegex") }),
      query({ ...range, type: "web", dimensionFilterGroups: brandFilter("excludingRegex") }),
      query({ ...prevRange, type: "web", dimensionFilterGroups: brandFilter("includingRegex") }),
      query({ ...prevRange, type: "web", dimensionFilterGroups: brandFilter("excludingRegex") }),
      query({ ...range, type: "web", dimensions: ["date"], rowLimit: 500, dimensionFilterGroups: brandFilter("excludingRegex") }),
    ]);

    const queries = queryRows.map((r) => ({ query: r.keys[0], ...metrics(r) }));
    const pages = mergePages(pageRows.map((r) => ({ page: stripHost(r.keys[0]), ...metrics(r) })));
    const isBrand = (q) => new RegExp(BRAND_RE, "i").test(q);

    const positions = POSITION_BUCKETS.map((b, i) => {
      const min = i === 0 ? 0 : POSITION_BUCKETS[i - 1].max;
      const inB = queries.filter((q) => q.position > min && q.position <= b.max);
      return { key: b.key, label: b.label, queries: inB.length, clicks: inB.reduce((n, q) => n + q.clicks, 0), impressions: inB.reduce((n, q) => n + q.impressions, 0) };
    });

    const opportunities = queries
      .filter((q) => !isBrand(q.query) && q.position > 3 && q.impressions >= 10)
      .map((q) => ({ ...q, extraClicks: Math.round(q.impressions * Math.max(0, ctrAt(3) - q.ctr)) }))
      .filter((q) => q.extraClicks > 0)
      .sort((a, b) => b.extraClicks - a.extraClicks)
      .slice(0, 10);

    const groups = new Map();
    for (const pg of pages) { const g = groupOf(pg.page); const cur = groups.get(g.key) ?? { key: g.key, label: g.label, pages: [] }; cur.pages.push(pg); groups.set(g.key, cur); }
    const pageGroups = [...groups.values()].map((g) => ({ key: g.key, label: g.label, pages: g.pages.length, ...sumMetrics(g.pages) })).sort((a, b) => b.impressions - a.impressions);
    const otherByDay = new Map(otherDayRows.map((r) => [r.keys[0], r]));

    // Google publishes days one at a time; a day with no final data yet would draw as a fall to 0.
    // End the series (and the range shown) at the last day Google has actually finished.
    const lastDay = dayRows.reduce((m, r) => (r.keys[0] > m ? r.keys[0] : m), "");
    const shownEnd = lastDay && lastDay < range.endDate ? lastDay : range.endDate;
    const keys = dayKeys(startMs, endMs).filter((k) => k <= shownEnd);
    const byDay = new Map(dayRows.map((r) => [r.keys[0], r]));
    return {
      configured: true,
      site: SITE,
      range: { days, startDate: range.startDate, endDate: shownEnd },
      totals: metrics(totalRows[0] ?? {}),
      previous: metrics(prevRows[0] ?? {}),
      series: fillSeries(keys, byDay, (date, r) => ({ date, clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0, otherClicks: otherByDay.get(date)?.clicks ?? 0 })),
      // Brand = searches for "kynq" itself; other = people who found kynq by topic.
      brand: { current: metrics(brandRows[0] ?? {}), previous: metrics(prevBrandRows[0] ?? {}) },
      other: { current: metrics(otherRows[0] ?? {}), previous: metrics(prevOtherRows[0] ?? {}) },
      positions,
      opportunities,
      pageGroups,
      queries: queries.slice(0, 25),
      pages: pages.slice(0, 25),
      countries: countryRows.map((r) => ({ country: r.keys[0].toUpperCase(), ...metrics(r) })),
      devices: deviceRows.map((r) => ({ device: r.keys[0].toLowerCase(), ...metrics(r) })),
      notes: [
        `Google finishes Search Console numbers about ${LAG_DAYS} to 3 days late, so this range ends ${shownEnd}, the last finished day.`,
        "Google hides very rare searches to protect privacy, so the listed searches add up to a bit less than the total.",
        "Position is the average ranking of your result in Google (1 is the top of page one).",
        "Brand searches contain \"kynq\" (or a common misspelling). Brand and other add up to a little less than the total because Google hides rare searches.",
        "Extra clicks are an estimate: what each search would get at position 3 with a typical click-through rate, minus what it gets now.",
      ],
      generatedAt: Date.now(),
    };
  }).catch((err) => ({ configured: true, range: { days }, ...friendlyError(err) }));
}
