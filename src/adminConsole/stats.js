// The numbers behind Overview, Analytics and Finance. Everything here counts REAL users only
// (never the seeded demo accounts) and reads indexed fields over a bounded date range.
import KynqExtraReport from "../models/kynqExtraReportModel.js";
import { DAY, col, REAL_USER, dayKeys, fillSeries, dayExpr, istDay, istHour, startOfIstDay, cached, usersById, displayName, ensureConsoleIndexes, excludedUserIds } from "./util.js";

const IST_OFFSET = 19_800_000;
const CAP = 100_000; // never pull more than this many rows into memory for one view
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
const ageOf = (dob) => { const t = Date.parse(dob); if (Number.isNaN(t)) return null; return Math.floor((Date.now() - t) / (365.2425 * DAY)); };
const ageBand = (a) => (a == null ? "unknown" : a < 18 ? "under 18" : a <= 24 ? "18-24" : a <= 34 ? "25-34" : a <= 44 ? "35-44" : "45+");
const tally = (values, limit = 10) => {
  const m = new Map();
  for (const v of values) if (v != null && v !== "") m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => ({ key, count }));
};

export function analytics({ days, from, to }) {
  return cached(`analytics:${days}`, TTL, async () => {
    await ensureConsoleIndexes();
    const keys = dayKeys(from, to);

    // Funnel: people who signed up in the range, and how far they got.
    const cohort = await col("users").find({ ...REAL_USER, createdAt: { $gte: from, $lte: to } }, { projection: { id: 1, ageVerified: 1 } }).limit(CAP).toArray();
    const ids = cohort.map((u) => u.id);
    const excludedSet = new Set(await excludedUserIds());
    const distinctPeople = async (collection, field, match) => new Set((await col(collection).distinct(field, match)).filter(Boolean));
    const [calledA, calledB, rewarded, payers] = await Promise.all([
      distinctPeople("calls", "participantA", { participantA: { $in: ids } }),
      distinctPeople("calls", "participantB", { participantB: { $in: ids } }),
      distinctPeople("wallet_transactions", "userId", { userId: { $in: ids }, type: "chat_minutes" }),
      distinctPeople("coin_orders", "userId", { userId: { $in: ids.filter((id) => !excludedSet.has(id)) }, status: "paid" }),
    ]);
    const idSet = new Set(ids);
    const called = new Set([...calledA, ...calledB].filter((id) => idSet.has(id)));
    const funnel = [
      { key: "signed_up", label: "Signed up", count: cohort.length },
      { key: "age_verified", label: "Finished the age step", count: cohort.filter((u) => u.ageVerified).length },
      { key: "first_call", label: "Had a real call", count: called.size },
      { key: "first_reward", label: "Chatted 10 eligible min", count: rewarded.size },
      { key: "paid", label: "Bought Koins", count: payers.size },
    ];

    // Calls in the range.
    const callRows = await col("calls").find({ startedAt: { $gte: from, $lte: to } }, { projection: { startedAt: 1, endedAt: 1, endReason: 1 } }).limit(CAP).toArray();
    const durations = callRows.filter((c) => c.endedAt && c.endedAt > c.startedAt).map((c) => c.endedAt - c.startedAt).filter((d) => d > 1000 && d < 6 * 3_600_000);
    const perDayMap = new Map(); const hourCounts = Array.from({ length: 24 }, () => 0); const reasons = new Map();
    const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)); // [Mon..Sun][hour], India time
    for (const c of callRows) {
      const d = istDay(c.startedAt); perDayMap.set(d, (perDayMap.get(d) || 0) + 1);
      hourCounts[istHour(c.startedAt)] += 1;
      heat[(new Date(c.startedAt + IST_OFFSET).getUTCDay() + 6) % 7][istHour(c.startedAt)] += 1;
      const r = c.endReason || "unknown"; reasons.set(r, (reasons.get(r) || 0) + 1);
    }
    const calls = {
      total: callRows.length,
      avgDurationSec: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000) : 0,
      medianDurationSec: Math.round(median(durations) / 1000),
      endReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
      perDay: fillSeries(keys, perDayMap, (date, v) => ({ date, count: v ?? 0 })),
      byHour: hourCounts.map((count, hour) => ({ hour, count })),
      heatmap: heat,
      lengthBuckets: LENGTH_BUCKETS.map(([label, lo, hi]) => ({ label, count: durations.filter((d) => d >= lo * 1000 && d < hi * 1000).length })),
    };

    // Retention: weekly signup cohorts (newest six). Active = took part in a real call.
    const now = Date.now();
    const thisWeek = weekStart(now);
    const cohortStarts = Array.from({ length: 6 }, (_, i) => thisWeek - i * 7 * DAY);
    const oldest = cohortStarts[cohortStarts.length - 1];
    const recentUsers = await col("users").find({ ...REAL_USER, createdAt: { $gte: oldest } }, { projection: { id: 1, createdAt: 1 } }).limit(CAP).toArray();
    const rids = recentUsers.map((u) => u.id);
    const rcalls = rids.length
      ? await col("calls").find({ startedAt: { $gte: oldest }, $or: [{ participantA: { $in: rids } }, { participantB: { $in: rids } }] }, { projection: { startedAt: 1, participantA: 1, participantB: 1 } }).limit(CAP).toArray()
      : [];
    const callTimes = new Map();
    for (const c of rcalls) for (const p of [c.participantA, c.participantB]) { if (!callTimes.has(p)) callTimes.set(p, []); callTimes.get(p).push(c.startedAt); }
    const retention = cohortStarts.map((start) => {
      const members = recentUsers.filter((u) => u.createdAt >= start && u.createdAt < start + 7 * DAY);
      let e1 = 0, a1 = 0, e7 = 0, a7 = 0;
      for (const u of members) {
        const sds = startOfIstDay(u.createdAt); const times = callTimes.get(u.id) || [];
        if (sds + 2 * DAY <= now) { e1 += 1; if (times.some((t) => t >= sds + DAY && t < sds + 2 * DAY)) a1 += 1; }
        if (sds + 8 * DAY <= now) { e7 += 1; if (times.some((t) => t >= sds + DAY && t < sds + 8 * DAY)) a7 += 1; }
      }
      return { cohort: istDay(start), size: members.length, d1: e1 ? round(a1 / e1, 3) : null, d7: e7 ? round(a7 / e7, 3) : null };
    }).filter((c) => c.size > 0);

    // Who the users are (everyone, not just the range).
    const everyone = await col("users").find(REAL_USER, { projection: { gender: 1, state: 1, interests: 1, dob: 1 } }).limit(CAP).toArray();
    const people = {
      gender: tally(everyone.map((u) => u.gender ?? "not set")),
      states: tally(everyone.map((u) => u.state)),
      ageBands: tally(everyone.map((u) => ageBand(u.dob ? ageOf(u.dob) : null)), 6),
      topics: tally(everyone.flatMap((u) => (Array.isArray(u.interests) ? u.interests : []))),
    };

    const gameRows = await col("game_sessions").aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: "$gameType", sessions: { $sum: 1 } } }, { $sort: { sessions: -1 } }]).toArray();

    return {
      range: { days, from, to },
      funnel, calls, retention, people,
      games: gameRows.map((g) => ({ type: g._id || "unknown", sessions: g.sessions })),
      notes: [
        "Active means took part in at least one real call. Demo clips are never counted.",
        "How long people wait for a match is not recorded yet, so it can't be shown here.",
      ],
    };
  });
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
