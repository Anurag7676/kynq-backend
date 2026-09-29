// Admin-facing read side of campus tracking links. Write path (hit logging,
// conversion attribution) lives in kynqExtra/campusLinks.js — this file only
// aggregates for the dashboard.
import { col, dayExpr, fillSeries, dayKeys, rangeFromQuery, pageParams } from "./util.js";
import { createCampusLink, listCampusLinkDocs } from "../kynqExtra/campusLinks.js";

// createdAt is stored as a plain epoch-ms number, so $hour/$dayOfWeek need the same $toDate wrap dayExpr uses.
const hourExpr = (field) => ({ $hour: { date: { $toDate: field }, timezone: "Asia/Kolkata" } });
// Mongo's $dayOfWeek is 1=Sunday..7=Saturday; remap to 0=Monday..6=Sunday to match the Heatmap component's [Mon..Sun] column order.
const dowExpr = (field) => ({ $mod: [{ $add: [{ $dayOfWeek: { date: { $toDate: field }, timezone: "Asia/Kolkata" } }, 5] }, 7] });

// The link is just the homepage with a query param — no redirect hop, no
// separate domain ever involved. The frontend's CampusTracker reads it on
// load and calls POST /api/campus/track directly (see gift/routes/campus.js),
// the same way every other kynq-extra call already talks to the backend.
const SITE_URL = process.env.FRONTEND_URL || "https://kynq.in";
const shareUrl = (id) => `${SITE_URL}/?campus=${id}`;

export async function createCampus(name, admin) {
  const doc = await createCampusLink(name, admin?.email);
  return { ...doc, url: shareUrl(doc.id) };
}

/** One row per campus: total clicks, unique visitors, conversions — no filters, just the list view. */
export async function listCampusLinks() {
  const docs = await listCampusLinkDocs();
  if (!docs.length) return [];
  const ids = docs.map((d) => d.id);

  const [hitAgg, convAgg] = await Promise.all([
    col("campus_link_hits").aggregate([
      { $match: { campusId: { $in: ids }, isBot: false } },
      { $group: { _id: "$campusId", clicks: { $sum: 1 }, uniqueIps: { $addToSet: "$ip" } } },
    ]).toArray(),
    col("campus_link_conversions").aggregate([
      { $match: { campusId: { $in: ids } } },
      { $group: { _id: "$campusId", conversions: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const hitsById = new Map(hitAgg.map((h) => [h._id, h]));
  const convById = new Map(convAgg.map((c) => [c._id, c.conversions]));

  return docs
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((d) => {
      const h = hitsById.get(d.id);
      const clicks = h?.clicks ?? 0;
      const uniqueVisitors = h?.uniqueIps?.length ?? 0;
      const conversions = convById.get(d.id) ?? 0;
      return {
        id: d.id, slug: d.slug, name: d.name, url: shareUrl(d.id), createdAt: d.createdAt, createdBy: d.createdBy,
        clicks, uniqueVisitors, conversions,
        conversionRate: clicks ? Math.round((conversions / clicks) * 1000) / 10 : 0,
      };
    });
}

/** Aggregate across every campus, for the top-of-page dashboard: totals, a daily trend, global
 * breakdowns, and a leaderboard scoped to the same range — same shape as Overview/Finance. */
export async function campusOverview(query = {}) {
  const { days, from } = rangeFromQuery(query);
  const docs = await listCampusLinkDocs();
  const ids = docs.map((d) => d.id);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const match = { createdAt: { $gte: from }, isBot: false };
  const matchIds = ids.length ? { ...match, campusId: { $in: ids } } : match;
  // Traffic-quality composition looks at EVERY hit (bots and suspicious ones
  // included) — everywhere else in this function deliberately excludes bots,
  // this is the one place that needs the full picture to report on them.
  const allMatch = { createdAt: { $gte: from }, ...(ids.length ? { campusId: { $in: ids } } : {}) };

  const [totalsAgg, timeline, byDevice, byLocation, bySource, byBrowser, byOs, byHour, heatmapAgg, quality, perCampus, conversions] = await Promise.all([
    col("campus_link_hits").aggregate([{ $match: matchIds }, { $group: { _id: null, clicks: { $sum: 1 }, uniqueIps: { $addToSet: "$ip" } } }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: matchIds }, { $group: { _id: dayExpr("$createdAt"), n: { $sum: 1 } } }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: matchIds }, { $group: { _id: "$device", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: matchIds }, { $group: { _id: { country: "$country", region: "$region", city: "$city" }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: matchIds }, { $group: { _id: { $ifNull: ["$referrer", "direct"] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: matchIds }, { $group: { _id: "$browser", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: matchIds }, { $group: { _id: "$os", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: matchIds }, { $group: { _id: hourExpr("$createdAt"), n: { $sum: 1 } } }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: matchIds }, { $group: { _id: { h: hourExpr("$createdAt"), dow: dowExpr("$createdAt") }, n: { $sum: 1 } } }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: allMatch }, { $group: { _id: { $cond: ["$isBot", "bot", { $cond: ["$suspicious", "suspicious", "real"] }] }, n: { $sum: 1 } } }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: matchIds }, { $group: { _id: "$campusId", clicks: { $sum: 1 }, uniqueIps: { $addToSet: "$ip" } } }]).toArray(),
    col("campus_link_conversions").aggregate([{ $match: { createdAt: { $gte: from }, ...(ids.length ? { campusId: { $in: ids } } : {}) } }, { $group: { _id: "$campusId", n: { $sum: 1 } } }]).toArray(),
  ]);

  const totals = totalsAgg[0] ?? { clicks: 0, uniqueIps: [] };
  const convByCampus = new Map(conversions.map((c) => [c._id, c.n]));
  const totalConversions = conversions.reduce((s, c) => s + c.n, 0);
  const byDate = new Map(timeline.map((t) => [t._id, t.n]));
  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const r of byHour) hourCounts[r._id] = r.n;
  const heatGrid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const r of heatmapAgg) heatGrid[r._id.dow][r._id.h] = r.n;
  const qualityByKey = new Map(quality.map((q) => [q._id, q.n]));

  const SORTS = { clicks: "clicks", conversions: "conversions", conversionRate: "conversionRate", uniqueVisitors: "uniqueVisitors" };
  const sortKey = SORTS[query.sort] ?? SORTS.clicks;
  const fullLeaderboard = perCampus
    .map((r) => {
      const doc = byId.get(r._id);
      const clicks = r.clicks;
      const campusConversions = convByCampus.get(r._id) ?? 0;
      return {
        id: r._id, name: doc?.name ?? "(deleted campus)", slug: doc?.slug ?? "", url: doc ? shareUrl(doc.id) : "",
        clicks, uniqueVisitors: r.uniqueIps.length, conversions: campusConversions,
        conversionRate: clicks ? Math.round((campusConversions / clicks) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b[sortKey] - a[sortKey]);
  const lbPage = Math.max(1, Math.floor(Number(query.page)) || 1);
  const lbLimit = Math.min(50, Math.max(1, Math.floor(Number(query.limit)) || 10));
  const lbSkip = (lbPage - 1) * lbLimit;
  const leaderboard = fullLeaderboard.slice(lbSkip, lbSkip + lbLimit);

  return {
    range: { days, from, to: Date.now() },
    totals: {
      campuses: docs.length,
      clicks: totals.clicks,
      uniqueVisitors: totals.uniqueIps.length,
      conversions: totalConversions,
      conversionRate: totals.clicks ? Math.round((totalConversions / totals.clicks) * 1000) / 10 : 0,
    },
    series: { clicks: fillSeries(dayKeys(from, Date.now()), byDate, (date, n) => ({ date, count: n ?? 0 })) },
    byDevice: byDevice.map((r) => ({ device: r._id ?? "unknown", clicks: r.n })),
    byLocation: byLocation.map((r) => ({ country: r._id.country, region: r._id.region, city: r._id.city, clicks: r.n })),
    bySource: bySource.map((r) => ({ source: r._id, clicks: r.n })),
    byBrowser: byBrowser.map((r) => ({ browser: r._id ?? "unknown", clicks: r.n })),
    byOs: byOs.map((r) => ({ os: r._id ?? "unknown", clicks: r.n })),
    byHour: hourCounts.map((count, hour) => ({ hour, count })),
    heatmap: heatGrid,
    trafficQuality: { real: qualityByKey.get("real") ?? 0, suspicious: qualityByKey.get("suspicious") ?? 0, bot: qualityByKey.get("bot") ?? 0 },
    leaderboard,
    leaderboardSort: sortKey,
    leaderboardPage: lbPage, leaderboardLimit: lbLimit, leaderboardTotal: fullLeaderboard.length,
    generatedAt: Date.now(),
  };
}

// query: days (7|30|90), country, region, city, device, browser, os, source
// (referrer contains), suspicious ("only"|"exclude"), bot ("include"|only real by default)
function buildMatch(campusId, query, from) {
  const match = { campusId, createdAt: { $gte: from } };
  if (query.bot !== "include") match.isBot = false;
  if (query.country) match.country = query.country;
  if (query.region) match.region = query.region;
  if (query.city) match.city = query.city;
  if (query.device) match.device = query.device;
  if (query.browser) match.browser = query.browser;
  if (query.os) match.os = query.os;
  if (query.suspicious === "only") match.suspicious = true;
  else if (query.suspicious === "exclude") match.suspicious = { $ne: true };
  if (query.source) {
    match.referrer = query.source === "direct" ? { $in: [null, ""] } : { $regex: query.source, $options: "i" };
  }
  return match;
}

export async function campusLinkDetail(id, query = {}) {
  const link = (await listCampusLinkDocs()).find((d) => d.id === id);
  if (!link) return null;
  const { days, from } = rangeFromQuery(query);
  const match = buildMatch(id, query, from);
  const { page, limit, skip } = pageParams(query, 100);

  const [hits, timeline, byCountry, byDevice, byBrowser, byOs, bySource, convCount, totalClicks] = await Promise.all([
    col("campus_link_hits").find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    col("campus_link_hits").aggregate([{ $match: match }, { $group: { _id: dayExpr("$createdAt"), n: { $sum: 1 } } }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: match }, { $group: { _id: { country: "$country", region: "$region", city: "$city" }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: match }, { $group: { _id: "$device", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: match }, { $group: { _id: "$browser", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: match }, { $group: { _id: "$os", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]).toArray(),
    col("campus_link_hits").aggregate([{ $match: match }, { $group: { _id: { $ifNull: ["$referrer", "direct"] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]).toArray(),
    col("campus_link_conversions").countDocuments({ campusId: id }),
    col("campus_link_hits").countDocuments(match),
  ]);

  const byDate = new Map(timeline.map((t) => [t._id, t.n]));
  return {
    id: link.id, slug: link.slug, name: link.name, url: shareUrl(link.id), createdAt: link.createdAt,
    totals: { clicks: totalClicks, conversions: convCount, conversionRate: totalClicks ? Math.round((convCount / totalClicks) * 1000) / 10 : 0 },
    timeline: fillSeries(dayKeys(from, Date.now()), byDate, (date, n) => ({ date, clicks: n ?? 0 })),
    byLocation: byCountry.map((r) => ({ country: r._id.country, region: r._id.region, city: r._id.city, clicks: r.n })),
    byDevice: byDevice.map((r) => ({ device: r._id ?? "unknown", clicks: r.n })),
    byBrowser: byBrowser.map((r) => ({ browser: r._id ?? "unknown", clicks: r.n })),
    byOs: byOs.map((r) => ({ os: r._id ?? "unknown", clicks: r.n })),
    bySource: bySource.map((r) => ({ source: r._id, clicks: r.n })),
    recentHits: hits.map((h) => ({
      id: h.id, createdAt: h.createdAt, country: h.country, region: h.region, city: h.city,
      device: h.device, browser: h.browser, os: h.os, referrer: h.referrer, isBot: h.isBot, suspicious: h.suspicious,
    })),
    hitsPage: page, hitsLimit: limit, hitsTotal: totalClicks,
    filtersApplied: { days, ...query },
  };
}
