// Admin-facing read side of the creator referral program. The write path (clicks,
// signup attribution, commission on paid Koin orders, payouts) lives in
// kynqExtra/creators.js — this file only aggregates for the dashboard.
//
// Range-based numbers (clicks, signups, revenue, commission in the chosen range) sit
// beside lifetime money numbers (earned, paid, due), because payouts don't follow the
// date picker.
import { col, dayExpr, fillSeries, dayKeys, usersById, displayName } from "./util.js";
import {
  CREATORS, CREATOR_CLICKS, CREATOR_SIGNUPS, CREATOR_COMMISSIONS, CREATOR_PAYOUTS,
  ensureCreatorIndexes, createCreator, updateCreator, getCreator, addCreatorPayout,
} from "../kynqExtra/creators.js";

const SITE_URL = process.env.FRONTEND_URL || "https://kynq.in";
export const creatorUrl = (code) => `${SITE_URL}/?creator=${encodeURIComponent(code)}`;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
const rate = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : 0);
const strip = ({ _id, _key, ...rest }) => rest;

async function allCreators() {
  return (await col(CREATORS).find({}).sort({ createdAt: -1 }).toArray()).map(strip);
}

/** {creatorId → {…sums}} for one collection, optionally within a time range. */
async function sumBy(collection, match, group) {
  const rows = await col(collection).aggregate([{ $match: match }, { $group: { _id: "$creatorId", ...group } }]).toArray();
  return new Map(rows.map((r) => [r._id, r]));
}

async function moneyLifetime() {
  const [earned, paid] = await Promise.all([
    sumBy(CREATOR_COMMISSIONS, {}, {
      earned: { $sum: { $cond: [{ $eq: ["$status", "earned"] }, "$commission", 0] } },
      reversed: { $sum: { $cond: [{ $eq: ["$status", "reversed"] }, "$commission", 0] } },
      revenue: { $sum: { $cond: [{ $eq: ["$status", "earned"] }, "$orderAmount", 0] } },
    }),
    sumBy(CREATOR_PAYOUTS, {}, { paid: { $sum: "$amount" } }),
  ]);
  return { earned, paid };
}

function seriesFor(match, from, to) {
  const inRange = { createdAt: { $gte: from, $lte: to } };
  const day = { $group: { _id: dayExpr("$createdAt"), n: { $sum: 1 } } };
  return Promise.all([
    col(CREATOR_CLICKS).aggregate([{ $match: { ...match, ...inRange } }, day]).toArray(),
    col(CREATOR_SIGNUPS).aggregate([{ $match: { ...match, ...inRange } }, day]).toArray(),
    col(CREATOR_COMMISSIONS).aggregate([{ $match: { ...match, ...inRange, status: "earned" } }, { $group: { _id: dayExpr("$createdAt"), revenue: { $sum: "$orderAmount" }, commission: { $sum: "$commission" } } }]).toArray(),
  ]).then(([clicks, signups, money]) => {
    const c = new Map(clicks.map((r) => [r._id, r.n]));
    const s = new Map(signups.map((r) => [r._id, r.n]));
    const m = new Map(money.map((r) => [r._id, r]));
    return fillSeries(dayKeys(from, to), c, (date, clicks) => ({ date, clicks: clicks ?? 0, signups: s.get(date) ?? 0, revenue: r2(m.get(date)?.revenue), commission: r2(m.get(date)?.commission) }));
  });
}

/** List page: program totals for the range + one row per creator. */
export async function creatorsOverview({ days, from, to }) {
  await ensureCreatorIndexes();
  const inRange = { createdAt: { $gte: from, $lte: to } };
  const [list, clicks, signups, money, buyersRows, life, series] = await Promise.all([
    allCreators(),
    sumBy(CREATOR_CLICKS, inRange, { n: { $sum: 1 } }),
    sumBy(CREATOR_SIGNUPS, inRange, { n: { $sum: 1 } }),
    sumBy(CREATOR_COMMISSIONS, { ...inRange, status: "earned" }, { revenue: { $sum: "$orderAmount" }, commission: { $sum: "$commission" }, orders: { $sum: 1 } }),
    col(CREATOR_COMMISSIONS).aggregate([{ $match: { ...inRange, status: "earned" } }, { $group: { _id: { c: "$creatorId", u: "$userId" } } }, { $group: { _id: "$_id.c", n: { $sum: 1 } } }]).toArray(),
    moneyLifetime(),
    seriesFor({}, from, to),
  ]);
  const buyers = new Map(buyersRows.map((r) => [r._id, r.n]));

  const rows = list.map((c) => {
    const e = life.earned.get(c.id), p = life.paid.get(c.id)?.paid ?? 0;
    const earned = r2(e?.earned), clk = clicks.get(c.id)?.n ?? 0, su = signups.get(c.id)?.n ?? 0;
    return {
      id: c.id, code: c.code, name: c.name, handle: c.handle, email: c.email, url: creatorUrl(c.code),
      commissionRate: c.commissionRate, active: c.active !== false, createdAt: c.createdAt,
      clicks: clk, signups: su, conversionRate: rate(su, clk), buyers: buyers.get(c.id) ?? 0,
      revenue: r2(money.get(c.id)?.revenue), commission: r2(money.get(c.id)?.commission), orders: money.get(c.id)?.orders ?? 0,
      lifetime: { revenue: r2(e?.revenue), earned, paid: r2(p), due: r2(earned - p) },
    };
  }).sort((a, b) => b.commission - a.commission || b.signups - a.signups || b.clicks - a.clicks);

  const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
  const totals = {
    creators: rows.length, active: rows.filter((r) => r.active).length,
    clicks: sum((r) => r.clicks), signups: sum((r) => r.signups), buyers: sum((r) => r.buyers), orders: sum((r) => r.orders),
    revenue: r2(sum((r) => r.revenue)), commission: r2(sum((r) => r.commission)),
    due: r2(sum((r) => Math.max(0, r.lifetime.due))), paid: r2(sum((r) => r.lifetime.paid)),
  };
  totals.conversionRate = rate(totals.signups, totals.clicks);
  return {
    range: { days, from, to }, totals, series, creators: rows,
    notes: [
      "A signup counts when a new account is created within 30 days of clicking a creator's link (last click wins). Existing accounts are never counted.",
      "Commission is the creator's rate (10% by default) of the rupee amount of every paid Koin order by people they referred. Refunds reverse it.",
      "Due and paid are lifetime totals; everything else follows the date range.",
    ],
  };
}

/** Detail page for one creator. */
export async function creatorDetail(id, { days, from, to }) {
  const c = await getCreator(id);
  if (!c) return null;
  await ensureCreatorIndexes();
  const inRange = { createdAt: { $gte: from, $lte: to } };
  const me = { creatorId: id };
  const [clicks, signups, money, series, life, referredRows, commissions, payouts, byDevice, byCountry] = await Promise.all([
    col(CREATOR_CLICKS).countDocuments({ ...me, ...inRange }),
    col(CREATOR_SIGNUPS).countDocuments({ ...me, ...inRange }),
    col(CREATOR_COMMISSIONS).aggregate([{ $match: { ...me, ...inRange, status: "earned" } }, { $group: { _id: null, revenue: { $sum: "$orderAmount" }, commission: { $sum: "$commission" }, orders: { $sum: 1 }, buyers: { $addToSet: "$userId" } } }]).toArray(),
    seriesFor(me, from, to),
    moneyLifetime(),
    // Everyone they ever referred, with what each has spent (lifetime).
    col(CREATOR_SIGNUPS).aggregate([
      { $match: me }, { $sort: { createdAt: -1 } }, { $limit: 200 },
      { $lookup: { from: CREATOR_COMMISSIONS, let: { u: "$userId" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$userId", "$$u"] }, { $eq: ["$creatorId", id] }, { $eq: ["$status", "earned"] }] } } }, { $group: { _id: null, spent: { $sum: "$orderAmount" }, commission: { $sum: "$commission" }, orders: { $sum: 1 } } }], as: "m" } },
    ]).toArray(),
    col(CREATOR_COMMISSIONS).find(me).sort({ createdAt: -1 }).limit(50).toArray(),
    col(CREATOR_PAYOUTS).find(me).sort({ createdAt: -1 }).limit(50).toArray(),
    col(CREATOR_CLICKS).aggregate([{ $match: { ...me, ...inRange } }, { $group: { _id: "$device", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
    col(CREATOR_CLICKS).aggregate([{ $match: { ...me, ...inRange } }, { $group: { _id: "$country", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }]).toArray(),
  ]);
  const people = await usersById([...referredRows.map((r) => r.userId), ...commissions.map((r) => r.userId)]);
  const who = (uid) => ({ id: uid, name: displayName(people.get(uid)) });
  const m = money[0];
  const e = life.earned.get(id), paid = r2(life.paid.get(id)?.paid);
  const earned = r2(e?.earned);

  return {
    creator: { ...c, url: creatorUrl(c.code), active: c.active !== false },
    range: { days, from, to },
    totals: {
      clicks, signups, conversionRate: rate(signups, clicks), buyers: m?.buyers?.length ?? 0, orders: m?.orders ?? 0,
      revenue: r2(m?.revenue), commission: r2(m?.commission),
    },
    lifetime: { referred: referredRows.length, revenue: r2(e?.revenue), earned, reversed: r2(e?.reversed), paid, due: r2(earned - paid) },
    series,
    referred: referredRows.map((r) => ({ user: who(r.userId), joinedAt: r.createdAt, orders: r.m[0]?.orders ?? 0, spent: r2(r.m[0]?.spent), commission: r2(r.m[0]?.commission) }))
      .sort((a, b) => b.spent - a.spent || b.joinedAt - a.joinedAt),
    commissions: commissions.map((x) => ({ orderId: x.orderId, user: who(x.userId), orderAmount: x.orderAmount, coins: x.coins, rate: x.rate, commission: x.commission, status: x.status, createdAt: x.createdAt })),
    payouts: payouts.map(strip),
    byDevice: byDevice.map((r) => ({ key: r._id || "unknown", count: r.n })),
    byCountry: byCountry.map((r) => ({ key: r._id || "Unknown", count: r.n })),
  };
}

export async function createCreatorForAdmin(body, admin) {
  const doc = await createCreator(body || {}, admin?.email);
  return { ...doc, url: creatorUrl(doc.code) };
}
export async function updateCreatorForAdmin(id, body) {
  const doc = await updateCreator(id, body || {});
  return doc ? { ...doc, url: creatorUrl(doc.code) } : null;
}
export const recordPayout = (id, body, admin) => addCreatorPayout(id, body || {}, admin?.email);

/**
 * What a creator sees about themselves on kynq.in/creator. Same numbers as the admin
 * detail, minus anything about other people: referred users are "Referred user #n",
 * commissions carry no user, payouts carry no internal note or admin email.
 */
export async function creatorPortal(id, range) {
  const d = await creatorDetail(id, range);
  if (!d) return null;
  const order = [...d.referred].sort((a, b) => a.joinedAt - b.joinedAt);
  const num = new Map(order.map((r, i) => [r.user.id, i + 1]));
  const c = d.creator;
  return {
    creator: { name: c.name, handle: c.handle, code: c.code, url: c.url, commissionRate: c.commissionRate, active: c.active },
    range: d.range, totals: d.totals, lifetime: d.lifetime, series: d.series,
    referred: d.referred.map((r) => ({ n: num.get(r.user.id), joinedAt: r.joinedAt, orders: r.orders, commission: r.commission })),
    commissions: d.commissions.map((x) => ({ n: num.get(x.user.id) ?? null, createdAt: x.createdAt, orderAmount: x.orderAmount, rate: x.rate, commission: x.commission, status: x.status })),
    payouts: d.payouts.map((p) => ({ id: p.id, createdAt: p.createdAt, amount: p.amount, reference: p.reference })),
  };
}
