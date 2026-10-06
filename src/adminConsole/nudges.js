// In-call nudges: how often each nudge is shown, clicked, waved off or left to expire, and how
// many Koins people spent right after clicking one. Reads the append-only `nudge_events` log
// written by kynqExtra/nudge-events.js. "busy" rows (auto-hidden because a panel opened) are
// left out of every rate — the person never really had a chance to answer.
import { col, cached, dayKeys, dayExpr, fillSeries, usersById, displayName } from "./util.js";
import { NUDGE_EVENTS, ensureNudgeEventIndexes } from "../kynqExtra/nudge-events.js";

const TTL = 60_000;
const ATTRIBUTION_MS = 3 * 60_000;
// What a click is expected to cost, by the action the click led to. Only these debits count.
const ACTION_DEBIT = { unlock: "filter_unlock", gender: "gender_preference", start: "game_fee" };

const rate = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : 0);
const nudges = () => col(NUDGE_EVENTS);

let indexesReady = null;
const ensureIndexes = () => (indexesReady ??= ensureNudgeEventIndexes().catch((err) => { indexesReady = null; console.error("[console] nudge index creation failed:", err.message); }));

const countsOf = (rows) => {
  const c = { shown: 0, accepted: 0, dismissed: 0, timeout: 0 };
  for (const r of rows) if (r._id in c) c[r._id] = r.count;
  return c;
};

/** Koins debited within 3 minutes after an accepted unlock / gender / game nudge. Each debit counts once. */
async function koinsFromNudges(from, to) {
  const rows = await nudges().aggregate([
    { $match: { at: { $gte: from, $lte: to }, event: "accepted", action: { $in: Object.keys(ACTION_DEBIT) } } },
    { $project: { _id: 0, userId: 1, at: 1, type: { $switch: { branches: Object.entries(ACTION_DEBIT).map(([a, t]) => ({ case: { $eq: ["$action", a] }, then: t })), default: null } } } },
    {
      $lookup: {
        from: "wallet_transactions",
        let: { u: "$userId", t: "$type", at: "$at" },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ["$userId", "$$u"] },
            { $eq: ["$type", "$$t"] },
            { $gte: ["$createdAt", "$$at"] },
            { $lte: ["$createdAt", { $add: ["$$at", ATTRIBUTION_MS] }] },
            { $lt: ["$amount", 0] },
          ] } } },
          { $project: { _id: 1, amount: 1, userId: 1 } },
        ],
        as: "tx",
      },
    },
    { $unwind: "$tx" },
    { $group: { _id: "$tx._id", userId: { $first: "$tx.userId" }, amount: { $first: "$tx.amount" } } },
    { $group: { _id: null, spent: { $sum: { $multiply: ["$amount", -1] } }, buyers: { $addToSet: "$userId" } } },
    { $project: { _id: 0, spent: 1, buyers: { $size: "$buyers" } } },
  ]).toArray();
  return { spent: rows[0]?.spent ?? 0, buyers: rows[0]?.buyers ?? 0 };
}

export function nudgeStats({ days, from, to }) {
  return cached(`nudges:${days}`, TTL, async () => {
    await ensureIndexes();
    const inRange = { at: { $gte: from, $lte: to } };
    const RATED = ["shown", "accepted", "dismissed", "timeout"];

    const [facets] = await nudges().aggregate([
      { $match: { ...inRange, event: { $in: RATED } } },
      {
        $facet: {
          byKindEvent: [{ $group: { _id: { kind: "$kind", event: "$event" }, count: { $sum: 1 } } }],
          byVariant: [
            { $match: { event: { $in: ["shown", "accepted"] } } },
            { $group: { _id: { kind: "$kind", variant: "$variant" }, shown: { $sum: { $cond: [{ $eq: ["$event", "shown"] }, 1, 0] } }, accepted: { $sum: { $cond: [{ $eq: ["$event", "accepted"] }, 1, 0] } } } },
            { $sort: { shown: -1, accepted: -1 } },
            { $limit: 20 },
          ],
          actions: [{ $match: { event: "accepted" } }, { $group: { _id: "$action", count: { $sum: 1 } } }, { $sort: { count: -1 } }],
          perDay: [
            { $match: { event: { $in: ["shown", "accepted"] } } },
            { $group: { _id: { date: dayExpr("$at"), event: "$event" }, count: { $sum: 1 } } },
          ],
          people: [{ $match: { event: "shown" } }, { $group: { _id: "$userId" } }, { $count: "n" }],
          clickers: [{ $match: { event: "accepted" } }, { $group: { _id: "$userId" } }, { $count: "n" }],
          topClickers: [
            { $match: { event: { $in: ["shown", "accepted"] } } },
            { $group: { _id: "$userId", shown: { $sum: { $cond: [{ $eq: ["$event", "shown"] }, 1, 0] } }, accepted: { $sum: { $cond: [{ $eq: ["$event", "accepted"] }, 1, 0] } } } },
            { $match: { accepted: { $gt: 0 } } },
            { $sort: { accepted: -1, shown: 1 } },
            { $limit: 20 },
          ],
        },
      },
    ]).toArray();

    const [recentRows, koins] = await Promise.all([
      nudges().find({ ...inRange, event: { $in: ["accepted", "dismissed"] } }, { projection: { _id: 0, userId: 1, kind: 1, variant: 1, event: 1, action: 1, at: 1 } }).sort({ at: -1 }).limit(50).toArray(),
      koinsFromNudges(from, to),
    ]);

    // Totals and per-kind rows from one group.
    const kinds = new Map();
    const totals = { shown: 0, accepted: 0, dismissed: 0, timeout: 0 };
    for (const r of facets.byKindEvent) {
      const k = kinds.get(r._id.kind) ?? { kind: r._id.kind, shown: 0, accepted: 0, dismissed: 0, timeout: 0 };
      k[r._id.event] += r.count; totals[r._id.event] += r.count;
      kinds.set(r._id.kind, k);
    }
    const byKind = [...kinds.values()].sort((a, b) => b.shown - a.shown).map((k) => ({ ...k, ctr: rate(k.accepted, k.shown) }));

    const shownByDay = new Map(); const acceptedByDay = new Map();
    for (const r of facets.perDay) (r._id.event === "shown" ? shownByDay : acceptedByDay).set(r._id.date, r.count);
    const perDay = fillSeries(dayKeys(from, to), shownByDay, (date, shown) => ({ date, shown: shown ?? 0, accepted: acceptedByDay.get(date) ?? 0 }));

    const people = await usersById([...recentRows.map((r) => r.userId), ...facets.topClickers.map((r) => r._id)]);
    const who = (id) => ({ id, name: displayName(people.get(id)) });

    return {
      range: { days, from, to },
      totals: {
        ...totals,
        people: facets.people[0]?.n ?? 0,
        clickers: facets.clickers[0]?.n ?? 0,
        ctr: rate(totals.accepted, totals.shown),
        dismissRate: rate(totals.dismissed, totals.shown),
      },
      byKind,
      byVariant: facets.byVariant.map((v) => ({ kind: v._id.kind, variant: v._id.variant ?? null, shown: v.shown, accepted: v.accepted, ctr: rate(v.accepted, v.shown) })),
      actions: facets.actions.map((a) => ({ action: a._id ?? "none", count: a.count })),
      perDay,
      koins,
      recent: recentRows.map((r) => ({ at: r.at, user: who(r.userId), kind: r.kind, variant: r.variant ?? null, event: r.event, action: r.action ?? null })),
      topClickers: facets.topClickers.map((r) => ({ user: who(r._id), shown: r.shown, accepted: r.accepted })),
      notes: [
        "Koins from nudges counts Koins spent on a lens unlock, a girls-only pass or a game fee within 3 minutes after someone clicked the matching nudge. Refunds are not taken off.",
        "Nudges hidden because the person opened a panel themselves are left out of every rate.",
        "Expired means the nudge timed out with no answer.",
      ],
    };
  });
}

/** One user's nudge history (all time): counts plus the last 30 events. */
export async function userNudges(userId) {
  await ensureIndexes();
  const [counts, recent] = await Promise.all([
    nudges().aggregate([{ $match: { userId } }, { $group: { _id: "$event", count: { $sum: 1 } } }]).toArray(),
    nudges().find({ userId, event: { $ne: "busy" } }, { projection: { _id: 0, at: 1, kind: 1, variant: 1, event: 1, action: 1 } }).sort({ at: -1 }).limit(30).toArray(),
  ]);
  const c = countsOf(counts);
  return {
    shown: c.shown, accepted: c.accepted, dismissed: c.dismissed, ctr: rate(c.accepted, c.shown),
    recent: recent.map((r) => ({ at: r.at, kind: r.kind, variant: r.variant ?? null, event: r.event, action: r.action ?? null })),
  };
}
