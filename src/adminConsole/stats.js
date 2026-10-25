// The numbers behind Overview, Analytics and Finance. Everything here counts REAL users only
// (never the seeded demo accounts), reads indexed fields over a bounded date range, and does the
// counting inside MongoDB so only small summaries leave the database.
import KynqExtraReport from "../models/kynqExtraReportModel.js";
import { DAY, col, REAL_USER, dayKeys, fillSeries, dayExpr, istDay, istHour, startOfIstDay, cached, usersById, displayName, ensureConsoleIndexes, excludedUserIds } from "./util.js";

const IST_OFFSET = 19_800_000;
const TTL = 60_000;

export const TX_LABEL = {
  chat_minutes: "Chat rewards", first_chat: "First-chat bonus", referral: "Referral rewards", game_win: "Game wins", question_bonus: "Question rewards",
  coin_purchase: "Purchased Koins", coin_refund: "Refunded purchases", game_refund: "Game refunds", gender_preference_refund: "Preference refunds",
  daily_activity: "Daily activity", filter_unlock: "Lens unlocks", game_fee: "Game fees", gender_preference: "Preference passes", gift_purchase: "Gifts",
  ambassador_daily: "Campus ambassador reward", ambassador_monthly_grant: "Campus ambassador monthly grant", admin_grant: "Admin grant",
};
const labelOf = (type) => TX_LABEL[type] ?? type;

const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);
const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const toMap = (rows, key = "_id", val = "count") => new Map(rows.map((r) => [r[key], r[val]]));

async function activeUsersSince(since) {
  const rows = await col("calls").aggregate([
    { $match: { startedAt: { $gte: since } } },
    { $project: { p: ["$participantA", "$participantB"] } },
    { $unwind: "$p" },
    { $group: { _id: "$p" } },
    { $count: "n" },
  ]).toArray();
  return rows[0]?.n ?? 0;
}

async function callStats(from, to) {
  const rows = await col("calls").aggregate([
    { $match: { startedAt: { $gte: from, $lte: to } } },
    { $project: { dur: { $cond: [{ $and: [{ $ne: ["$endedAt", null] }, { $gt: ["$endedAt", 0] }] }, { $subtract: ["$endedAt", "$startedAt"] }, null] } } },
    { $group: { _id: null, total: { $sum: 1 }, avg: { $avg: { $cond: [{ $and: [{ $gt: ["$dur", 1000] }, { $lt: ["$dur", 6 * 3_600_000] }] }, "$dur", null] } } } },
  ]).toArray();
  return { total: rows[0]?.total ?? 0, avgDurationSec: Math.round((rows[0]?.avg ?? 0) / 1000) };
}

async function revenueStats(from, to, excluded) {
  const rows = await col("coin_orders").aggregate([
    { $match: { userId: { $nin: excluded }, status: "paid", paidAt: { $gte: from, $lte: to } } },
    { $group: { _id: null, inr: { $sum: "$amount" }, orders: { $sum: 1 } } },
  ]).toArray();
  return { inr: rows[0]?.inr ?? 0, orders: rows[0]?.orders ?? 0 };
}

const perDay = async (collection, match, field) =>
  toMap(await col(collection).aggregate([{ $match: match }, { $group: { _id: dayExpr(field), count: { $sum: 1 } } }]).toArray());

// ─── Overview ───
export function overview({ days, from, to }) {
  return cached(`overview:${days}`, TTL, async () => {
    await ensureConsoleIndexes();
    const prevFrom = from - days * DAY;
    const now = Date.now();
    const keys = dayKeys(from, to);
    const inRange = { createdAt: { $gte: from, $lte: to } };
    const users = col("users");
    const excluded = await excludedUserIds();
    const todayStart = startOfIstDay(now);

    const [total, newUsers, prevNew, verifiedTotal, verifiedNew, dau, wau, mau, calls, prevCalls, revenue, prevRevenue, signupsByDay, callsByDay, revByDayRows, openReports, inboxTotal, inboxHandled, activeRows, latest, signupsToday, signupsYesterday, callsToday, callsYesterday, revToday, revYesterday] = await Promise.all([
      users.countDocuments(REAL_USER),
      users.countDocuments({ ...REAL_USER, ...inRange }),
      users.countDocuments({ ...REAL_USER, createdAt: { $gte: prevFrom, $lt: from } }),
      users.countDocuments({ ...REAL_USER, ageVerified: true }),
      users.countDocuments({ ...REAL_USER, ...inRange, ageVerified: true }),
      activeUsersSince(now - DAY),
      activeUsersSince(now - 7 * DAY),
      activeUsersSince(now - 30 * DAY),
      callStats(from, to),
      callStats(prevFrom, from - 1),
      revenueStats(from, to, excluded),
      revenueStats(prevFrom, from - 1, excluded),
      perDay("users", { ...REAL_USER, ...inRange }, "$createdAt"),
      perDay("calls", { startedAt: { $gte: from, $lte: to } }, "$startedAt"),
      col("coin_orders").aggregate([{ $match: { userId: { $nin: excluded }, status: "paid", paidAt: { $gte: from, $lte: to } } }, { $group: { _id: dayExpr("$paidAt"), inr: { $sum: "$amount" } } }]).toArray(),
      KynqExtraReport.countDocuments({ status: "open" }),
      col("contact-messages").countDocuments({}),
      col("admin_inbox_status").countDocuments({ status: { $in: ["in_progress", "done"] } }),
      // Distinct people in a call, per day, and total call minutes per day.
      col("calls").aggregate([
        { $match: { startedAt: { $gte: from, $lte: to } } },
        { $project: { d: dayExpr("$startedAt"), p: ["$participantA", "$participantB"], dur: { $cond: [{ $and: [{ $gt: ["$endedAt", "$startedAt"] }, { $lt: [{ $subtract: ["$endedAt", "$startedAt"] }, 6 * 3_600_000] }] }, { $subtract: ["$endedAt", "$startedAt"] }, 0] } } },
        { $group: { _id: "$d", people: { $addToSet: "$p" }, ms: { $sum: "$dur" } } },
        { $project: { people: { $size: { $reduce: { input: "$people", initialValue: [], in: { $setUnion: ["$$value", "$$this"] } } } }, ms: 1 } },
      ]).toArray(),
      users.find(REAL_USER, { projection: { id: 1, name: 1, createdAt: 1, state: 1, ageVerified: 1, gender: 1 } }).sort({ createdAt: -1 }).limit(8).toArray(),
      // Today vs yesterday (India time).
      users.countDocuments({ ...REAL_USER, createdAt: { $gte: todayStart } }),
      users.countDocuments({ ...REAL_USER, createdAt: { $gte: todayStart - DAY, $lt: todayStart } }),
      col("calls").countDocuments({ startedAt: { $gte: todayStart } }),
      col("calls").countDocuments({ startedAt: { $gte: todayStart - DAY, $lt: todayStart } }),
      revenueStats(todayStart, now, excluded),
      revenueStats(todayStart - DAY, todayStart - 1, excluded),
    ]);
    const activeByDay = new Map(activeRows.map((r) => [r._id, r]));

    const revByDay = toMap(revByDayRows, "_id", "inr");
    return {
      range: { days, from, to },
      kpis: {
        users: { total, new: newUsers, previousNew: prevNew },
        ageVerified: { total: verifiedTotal, new: verifiedNew },
        active: { dau, wau, mau },
        calls: { total: calls.total, previousTotal: prevCalls.total, avgDurationSec: calls.avgDurationSec },
        revenue: { inr: revenue.inr, previousInr: prevRevenue.inr, paidOrders: revenue.orders },
        openReports,
        newInbox: Math.max(0, inboxTotal - inboxHandled),
      },
      series: {
        signups: fillSeries(keys, signupsByDay, (date, v) => ({ date, count: v ?? 0 })),
        calls: fillSeries(keys, callsByDay, (date, v) => ({ date, count: v ?? 0 })),
        revenue: fillSeries(keys, revByDay, (date, v) => ({ date, inr: v ?? 0 })),
        active: fillSeries(keys, activeByDay, (date, v) => ({ date, count: v?.people ?? 0 })),
        minutes: fillSeries(keys, activeByDay, (date, v) => ({ date, count: Math.round((v?.ms ?? 0) / 60_000) })),
      },
      today: {
        signups: { today: signupsToday, yesterday: signupsYesterday },
        calls: { today: callsToday, yesterday: callsYesterday },
        revenue: { today: revToday.inr, yesterday: revYesterday.inr },
      },
      recentSignups: latest.map((u) => ({ id: u.id, name: displayName(u), createdAt: u.createdAt, state: u.state ?? null, gender: u.gender ?? null, ageVerified: !!u.ageVerified })),
      generatedAt: Date.now(),
    };
  });
}

// ─── Analytics ───
const LENGTH_BUCKETS = [["<30s", 0, 30], ["30s-1m", 30, 60], ["1-3m", 60, 180], ["3-5m", 180, 300], ["5-10m", 300, 600], ["10-30m", 600, 1800], ["30m+", 1800, Infinity]];
const weekStart = (ts) => { const d = startOfIstDay(ts); const dow = new Date(d + IST_OFFSET).getUTCDay(); return d - ((dow + 6) % 7) * DAY; };

export function analytics({ days, from, to }) {
  return cached(`analytics:${days}`, TTL, async () => {
    await ensureConsoleIndexes();
    return computeAnalytics({ days, from, to });
  });
}

// Every number is computed INSIDE MongoDB and only small summaries come back. The old version
// copied ~260k documents into Node per load (all users several times, all calls twice) and
// counted them in JavaScript: minutes per load, timeouts, and a frozen API while it ran.
const IST_DAY_START = (field) => ({ $subtract: [{ $multiply: [{ $floor: { $divide: [{ $add: [field, IST_OFFSET] }, DAY] } }, DAY] }, IST_OFFSET] });
const VALID_DUR = { dur: { $gt: 1000, $lt: 6 * 3_600_000 } };
const toRows = (rows, limit) => rows.slice(0, limit).map((r) => ({ key: r._id, count: r.n }));

export async function computeAnalytics({ days, from, to }) {
  const keys = dayKeys(from, to);
  const now = Date.now();
  const thisWeek = weekStart(now);
  const cohortStarts = Array.from({ length: 6 }, (_, i) => thisWeek - i * 7 * DAY); // newest first
  const oldest = cohortStarts[cohortStarts.length - 1];
  const callsSince = Math.min(from, oldest); // covers both the funnel cohort and the retention weeks
  const excluded = await excludedUserIds();
  const inRange = { createdAt: { $gte: from, $lte: to } };
  const opt = { maxTimeMS: 120_000 };

  const [cohortRows, perPersonRows, rewardedRows, payerRows, callFacet, peopleFacet, gameRows, retentionBase] = await Promise.all([
    // Funnel steps 1–2: who signed up in the range, and who finished the age step.
    col("users").aggregate([
      { $match: { ...REAL_USER, ...inRange } },
      { $group: { _id: null, signedUp: { $sum: 1 }, verified: { $sum: { $cond: [{ $eq: ["$ageVerified", true] }, 1, 0] } } } },
    ], opt).toArray(),
    // One pass over calls, grouped per person, joined to the person once. Serves the funnel's
    // "had a real call" and the D1/D7 retention.
    col("calls").aggregate([
      { $match: { startedAt: { $gte: callsSince } } },
      { $project: { startedAt: 1, p: ["$participantA", "$participantB"] } },
      { $unwind: "$p" },
      { $match: { p: { $nin: [null, ""] } } },
      { $group: { _id: "$p", times: { $push: "$startedAt" } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "id", pipeline: [{ $match: REAL_USER }, { $project: { _id: 0, createdAt: 1 } }], as: "u" } },
      { $unwind: "$u" },
      { $project: { createdAt: "$u.createdAt", sds: IST_DAY_START("$u.createdAt"), times: 1 } },
      { $facet: {
        called: [{ $match: inRange }, { $count: "n" }],
        retention: [
          { $match: { createdAt: { $gte: oldest } } },
          { $project: {
            week: { $floor: { $divide: [{ $subtract: ["$createdAt", oldest] }, 7 * DAY] } },
            a1: { $anyElementTrue: [{ $map: { input: "$times", as: "t", in: { $and: [{ $gte: ["$$t", { $add: ["$sds", DAY] }] }, { $lt: ["$$t", { $add: ["$sds", 2 * DAY] }] }] } } }] },
            a7: { $anyElementTrue: [{ $map: { input: "$times", as: "t", in: { $and: [{ $gte: ["$$t", { $add: ["$sds", DAY] }] }, { $lt: ["$$t", { $add: ["$sds", 8 * DAY] }] }] } } }] },
            e1: { $lte: [{ $add: ["$sds", 2 * DAY] }, now] },
            e7: { $lte: [{ $add: ["$sds", 8 * DAY] }, now] },
          } },
          { $group: { _id: "$week",
            a1: { $sum: { $cond: [{ $and: ["$e1", "$a1"] }, 1, 0] } },
            a7: { $sum: { $cond: [{ $and: ["$e7", "$a7"] }, 1, 0] } } } },
        ],
      } },
    ], { ...opt, allowDiskUse: true }).toArray(),
    // Funnel step 4: chatted 10 eligible minutes (earned a chat reward).
    col("wallet_transactions").aggregate([
      { $match: { type: "chat_minutes" } },
      { $group: { _id: "$userId" } },
      { $lookup: { from: "users", localField: "_id", foreignField: "id", pipeline: [{ $match: { ...REAL_USER, ...inRange } }, { $project: { _id: 1 } }], as: "u" } },
      { $match: { "u.0": { $exists: true } } },
      { $count: "n" },
    ], opt).toArray(),
    // Funnel step 5: bought Koins (never counting test, admin or demo accounts).
    col("coin_orders").aggregate([
      { $match: { status: "paid", userId: { $nin: excluded } } },
      { $group: { _id: "$userId" } },
      { $lookup: { from: "users", localField: "_id", foreignField: "id", pipeline: [{ $match: { ...REAL_USER, ...inRange } }, { $project: { _id: 1 } }], as: "u" } },
      { $match: { "u.0": { $exists: true } } },
      { $count: "n" },
    ], opt).toArray(),
    // Calls in the range: totals, length, per day / hour / weekday (India time), reasons.
    col("calls").aggregate([
      { $match: { startedAt: { $gte: from, $lte: to } } },
      { $project: {
        d: { $toDate: "$startedAt" },
        reason: { $cond: [{ $in: [{ $ifNull: ["$endReason", ""] }, [""]] }, "unknown", "$endReason"] },
        dur: { $cond: [{ $and: [{ $gt: ["$endedAt", 0] }, { $gt: ["$endedAt", "$startedAt"] }] }, { $subtract: ["$endedAt", "$startedAt"] }, null] },
      } },
      { $facet: {
        total: [{ $count: "n" }],
        perDay: [{ $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$d", timezone: "Asia/Kolkata" } }, n: { $sum: 1 } } }],
        heat: [{ $group: { _id: { dow: { $isoDayOfWeek: { date: "$d", timezone: "Asia/Kolkata" } }, h: { $hour: { date: "$d", timezone: "Asia/Kolkata" } } }, n: { $sum: 1 } } }],
        reasons: [{ $group: { _id: "$reason", n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }],
        durStats: [{ $match: VALID_DUR }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: "$dur" } } }],
        lengths: [{ $match: VALID_DUR }, { $bucket: { groupBy: "$dur", boundaries: LENGTH_BUCKETS.map(([, lo]) => lo * 1000).concat(6 * 3_600_000), output: { n: { $sum: 1 } } } }],
      } },
    ], opt).toArray(),
    // Who the users are (everyone, not just the range).
    col("users").aggregate([
      { $match: REAL_USER },
      { $facet: {
        gender: [{ $project: { g: { $ifNull: ["$gender", "not set"] } } }, { $match: { g: { $ne: "" } } }, { $group: { _id: "$g", n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 10 }],
        states: [{ $match: { state: { $nin: [null, ""] } } }, { $group: { _id: "$state", n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 10 }],
        topics: [{ $unwind: "$interests" }, { $match: { interests: { $nin: [null, ""] } } }, { $group: { _id: "$interests", n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 10 }],
        ages: [
          { $project: { born: { $cond: [{ $eq: [{ $type: "$dob" }, "string"] }, { $dateFromString: { dateString: "$dob", onError: null, onNull: null } }, null] } } },
          { $project: { age: { $cond: [{ $eq: ["$born", null] }, null, { $floor: { $divide: [{ $subtract: [now, { $toLong: "$born" }] }, 365.2425 * DAY] } }] } } },
          { $group: { _id: { $switch: { branches: [
            { case: { $eq: ["$age", null] }, then: "unknown" },
            { case: { $lt: ["$age", 18] }, then: "under 18" },
            { case: { $lte: ["$age", 24] }, then: "18-24" },
            { case: { $lte: ["$age", 34] }, then: "25-34" },
            { case: { $lte: ["$age", 44] }, then: "35-44" },
          ], default: "45+" } }, n: { $sum: 1 } } },
          { $sort: { n: -1, _id: 1 } },
        ],
      } },
    ], opt).toArray(),
    col("game_sessions").aggregate([{ $match: inRange }, { $group: { _id: "$gameType", sessions: { $sum: 1 } } }, { $sort: { sessions: -1 } }], opt).toArray(),
    // Retention denominators: everyone who signed up in the six weeks, per week, and how many are
    // old enough to be measured for D1 / D7.
    col("users").aggregate([
      { $match: { ...REAL_USER, createdAt: { $gte: oldest } } },
      { $project: { week: { $floor: { $divide: [{ $subtract: ["$createdAt", oldest] }, 7 * DAY] } }, sds: IST_DAY_START("$createdAt") } },
      { $group: { _id: "$week", size: { $sum: 1 },
        e1: { $sum: { $cond: [{ $lte: [{ $add: ["$sds", 2 * DAY] }, now] }, 1, 0] } },
        e7: { $sum: { $cond: [{ $lte: [{ $add: ["$sds", 8 * DAY] }, now] }, 1, 0] } } } },
    ], opt).toArray(),
  ]);

  // Exact median call length: the middle value(s), fetched by position (no rows copied out).
  const durStats = callFacet[0]?.durStats[0] ?? { n: 0, avg: 0 };
  let medianMs = 0;
  if (durStats.n) {
    const mid = Math.floor(durStats.n / 2);
    const mids = await col("calls").aggregate([
      { $match: { startedAt: { $gte: from, $lte: to } } },
      { $project: { dur: { $cond: [{ $and: [{ $gt: ["$endedAt", 0] }, { $gt: ["$endedAt", "$startedAt"] }] }, { $subtract: ["$endedAt", "$startedAt"] }, null] } } },
      { $match: VALID_DUR },
      { $sort: { dur: 1 } },
      { $skip: durStats.n % 2 ? mid : mid - 1 },
      { $limit: durStats.n % 2 ? 1 : 2 },
    ], { ...opt, allowDiskUse: true }).toArray();
    medianMs = median(mids.map((r) => r.dur));
  }

  const cohort = cohortRows[0] ?? { signedUp: 0, verified: 0 };
  const funnel = [
    { key: "signed_up", label: "Signed up", count: cohort.signedUp },
    { key: "age_verified", label: "Finished the age step", count: cohort.verified },
    { key: "first_call", label: "Had a real call", count: perPersonRows[0]?.called[0]?.n ?? 0 },
    { key: "first_reward", label: "Chatted 10 eligible min", count: rewardedRows[0]?.n ?? 0 },
    { key: "paid", label: "Bought Koins", count: payerRows[0]?.n ?? 0 },
  ];

  const cf = callFacet[0] ?? {};
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)); // [Mon..Sun][hour], India time
  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const { _id, n } of cf.heat ?? []) { heat[_id.dow - 1][_id.h] += n; hourCounts[_id.h] += n }
  const lengthBy = new Map((cf.lengths ?? []).map((b) => [b._id, b.n]));
  const calls = {
    total: cf.total?.[0]?.n ?? 0,
    avgDurationSec: durStats.n ? Math.round(durStats.avg / 1000) : 0,
    medianDurationSec: Math.round(medianMs / 1000),
    endReasons: (cf.reasons ?? []).map((r) => ({ reason: r._id, count: r.n })),
    perDay: fillSeries(keys, toMap(cf.perDay ?? [], "_id", "n"), (date, v) => ({ date, count: v ?? 0 })),
    byHour: hourCounts.map((count, hour) => ({ hour, count })),
    heatmap: heat,
    lengthBuckets: LENGTH_BUCKETS.map(([label, lo]) => ({ label, count: lengthBy.get(lo * 1000) ?? 0 })),
  };

  // Retention: weekly signup cohorts (newest six). Active = took part in a real call.
  const actives = new Map((perPersonRows[0]?.retention ?? []).map((r) => [r._id, r]));
  const bases = new Map(retentionBase.map((r) => [r._id, r]));
  const retention = cohortStarts.map((start) => {
    const week = Math.round((start - oldest) / (7 * DAY));
    const b = bases.get(week) ?? { size: 0, e1: 0, e7: 0 };
    const a = actives.get(week) ?? { a1: 0, a7: 0 };
    return {
      cohort: istDay(start), size: b.size,
      d1: b.e1 ? round(a.a1 / b.e1, 3) : null, d7: b.e7 ? round(a.a7 / b.e7, 3) : null,
      // The counts behind the percentages: how many could be measured yet, and how many came back.
      eligibleD1: b.e1, cameBackD1: a.a1, eligibleD7: b.e7, cameBackD7: a.a7,
    };
  }).filter((c) => c.size > 0);

  const pf = peopleFacet[0] ?? {};
  const people = { gender: toRows(pf.gender ?? [], 10), states: toRows(pf.states ?? [], 10), ageBands: toRows(pf.ages ?? [], 6), topics: toRows(pf.topics ?? [], 10) };

  return {
    range: { days, from, to },
    funnel, calls, retention, people,
    games: gameRows.map((g) => ({ type: g._id || "unknown", sessions: g.sessions })),
    notes: [
      "Active means took part in at least one real call. Demo clips are never counted.",
      "How long people wait for a match is not recorded yet, so it can't be shown here.",
    ],
  };
}

// ─── Finance ───
export function finance({ days, from, to }) {
  return cached(`finance:${days}`, TTL, async () => {
    await ensureConsoleIndexes();
    const keys = dayKeys(from, to);
    const orders = col("coin_orders"); const tx = col("wallet_transactions");
    // Money and Koin figures leave out seeded demo accounts and our own test accounts (see excludedUserIds).
    const demoIds = await excludedUserIds();
    const real = { userId: { $nin: demoIds } };
    const paidMatch = { ...real, status: "paid", paidAt: { $gte: from, $lte: to } };

    const [paidAgg, refundAgg, failed, pending, payerRows, revDayRows, packRows, issuedRows, spentRows, outstandingRows, spenderRows, recent, totalUsers, koinDayRows] = await Promise.all([
      orders.aggregate([{ $match: paidMatch }, { $group: { _id: null, inr: { $sum: "$amount" }, orders: { $sum: 1 } } }]).toArray(),
      orders.aggregate([{ $match: { ...real, status: "refunded", refundedAt: { $gte: from, $lte: to } } }, { $group: { _id: null, inr: { $sum: "$amount" }, orders: { $sum: 1 } } }]).toArray(),
      orders.countDocuments({ ...real, status: "cancelled", createdAt: { $gte: from, $lte: to } }),
      orders.countDocuments({ ...real, status: "pending_payment", createdAt: { $gte: from, $lte: to } }),
      orders.distinct("userId", paidMatch),
      orders.aggregate([{ $match: paidMatch }, { $group: { _id: dayExpr("$paidAt"), inr: { $sum: "$amount" }, orders: { $sum: 1 } } }]).toArray(),
      orders.aggregate([{ $match: paidMatch }, { $group: { _id: "$packId", coins: { $first: "$coins" }, priceInr: { $first: "$amount" }, orders: { $sum: 1 }, inr: { $sum: "$amount" } } }, { $sort: { inr: -1 } }]).toArray(),
      tx.aggregate([{ $match: { ...real, createdAt: { $gte: from, $lte: to }, amount: { $gt: 0 } } }, { $group: { _id: "$type", amount: { $sum: "$amount" } } }, { $sort: { amount: -1 } }]).toArray(),
      tx.aggregate([{ $match: { ...real, createdAt: { $gte: from, $lte: to }, amount: { $lt: 0 } } }, { $group: { _id: "$type", amount: { $sum: { $abs: "$amount" } } } }, { $sort: { amount: -1 } }]).toArray(),
      tx.aggregate([{ $match: real }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
      orders.aggregate([{ $match: paidMatch }, { $group: { _id: "$userId", inr: { $sum: "$amount" }, orders: { $sum: 1 } } }, { $sort: { inr: -1 } }, { $limit: 5 }]).toArray(),
      orders.find(real).sort({ createdAt: -1 }).limit(15).toArray(),
      col("users").countDocuments({ ...REAL_USER, createdAt: { $lte: to } }),
      tx.aggregate([{ $match: { ...real, createdAt: { $gte: from, $lte: to } } }, { $group: { _id: { d: dayExpr("$createdAt"), pos: { $gt: ["$amount", 0] } }, amount: { $sum: { $abs: "$amount" } } } }]).toArray(),
    ]);

    const gross = paidAgg[0]?.inr ?? 0; const paidOrders = paidAgg[0]?.orders ?? 0; const refunded = refundAgg[0]?.inr ?? 0; const payers = payerRows.length;
    const names = await usersById([...spenderRows.map((s) => s._id), ...recent.map((o) => o.userId)]);
    const revByDay = new Map(revDayRows.map((r) => [r._id, r]));
    const koinByDay = new Map();
    for (const r of koinDayRows) { const e = koinByDay.get(r._id.d) ?? { issued: 0, spent: 0 }; e[r._id.pos ? "issued" : "spent"] += r.amount; koinByDay.set(r._id.d, e); }
    // Same rule as gift/cashfree.js: anything but "production" is Cashfree's sandbox (test money).
    const cashfreeEnv = String(process.env.CASHFREE_ENV || "").toLowerCase();

    return {
      range: { days, from, to },
      totals: {
        grossInr: gross, refundedInr: refunded, netInr: gross - refunded,
        paidOrders, refundedOrders: refundAgg[0]?.orders ?? 0, failedOrders: failed, pendingOrders: pending,
        payers, payingRate: totalUsers ? round(payers / totalUsers, 4) : 0,
        aovInr: paidOrders ? round(gross / paidOrders, 1) : 0,
      },
      gateway: { mode: cashfreeEnv === "production" ? "live" : "test" },
      series: {
        revenue: fillSeries(keys, revByDay, (date, v) => ({ date, inr: v?.inr ?? 0, orders: v?.orders ?? 0 })),
        koins: fillSeries(keys, koinByDay, (date, v) => ({ date, issued: v?.issued ?? 0, spent: v?.spent ?? 0 })),
      },
      byPack: packRows.map((p) => ({ packId: p._id, coins: p.coins, priceInr: p.priceInr, orders: p.orders, inr: p.inr })),
      koins: {
        issued: { total: issuedRows.reduce((a, r) => a + r.amount, 0), bySource: issuedRows.map((r) => ({ type: r._id, label: labelOf(r._id), amount: r.amount })) },
        spent: { total: spentRows.reduce((a, r) => a + r.amount, 0), bySink: spentRows.map((r) => ({ type: r._id, label: labelOf(r._id), amount: r.amount })) },
        outstanding: outstandingRows[0]?.total ?? 0,
      },
      topSpenders: spenderRows.map((s) => ({ userId: s._id, name: displayName(names.get(s._id)), inr: s.inr, orders: s.orders })),
      recentOrders: recent.map((o) => ({ id: o.id, userId: o.userId, name: displayName(names.get(o.userId)), packId: o.packId, coins: o.coins, inr: o.amount, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt ?? null })),
      notes: [
        "Revenue is gross, before payment-gateway fees (fees are not in our data).",
        "Not counted: seeded demo accounts, admin accounts, TEST_USER_EMAILS and @example.com test accounts.",
        "Paying rate and revenue per user are measured against all real users signed up by the end of the range.",
      ],
    };
  });
}
