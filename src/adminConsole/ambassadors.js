// Campus ambassador activity monitoring — the admin-facing side of the daily
// challenge in kynqExtra/ambassador.js. Read-only aggregation over
// ambassador_days / ambassador_months; the challenge logic itself (crediting
// Koins, checking the goal, granting + gating the monthly spend) lives
// entirely in ambassador.js and is never duplicated here.
import { col, displayName, maskEmail, pageParams } from "./util.js";
import { ECONOMY } from "../kynqExtra/economy.js";
import { peekGoodiesProgress, goodieTiers, createGoodieTier, deleteGoodieTier } from "../kynqExtra/ambassador.js";
import { logAudit } from "./audit.js";

const todayKey = () => new Date().toISOString().slice(0, 10);
const monthKey = () => new Date().toISOString().slice(0, 7);

/** One row per approved ambassador: who they are, and today's progress. */
export async function listAmbassadors(query) {
  const { page, limit, skip } = pageParams(query);
  const [total, users] = await Promise.all([
    col("users").countDocuments({ isAmbassador: true }),
    col("users").find({ isAmbassador: true }).sort({ ambassadorSince: -1 }).skip(skip).limit(limit).toArray(),
  ]);
  const ids = users.map((u) => u.id);
  const date = todayKey();
  const todayRows = ids.length
    ? await col("ambassador_days").find({ userId: { $in: ids }, date }).toArray()
    : [];
  const todayByUser = new Map(todayRows.map((r) => [r.userId, r]));

  // Lifetime days-completed count, in the same query (cheap: it's already scoped to these ids).
  const completedRows = ids.length
    ? await col("ambassador_days").aggregate([
        { $match: { userId: { $in: ids }, rewardedAt: { $ne: null } } },
        { $group: { _id: "$userId", days: { $sum: 1 }, koins: { $sum: "$rewardKoins" } } },
      ]).toArray()
    : [];
  const completedByUser = new Map(completedRows.map((r) => [r._id, r]));

  // Days completed so far THIS month, for the goodies progress column.
  const month = monthKey();
  const monthRows = ids.length
    ? await col("ambassador_days").aggregate([
        { $match: { userId: { $in: ids }, date: { $regex: `^${month}` }, rewardedAt: { $ne: null } } },
        { $group: { _id: "$userId", days: { $sum: 1 } } },
      ]).toArray()
    : [];
  const monthDaysByUser = new Map(monthRows.map((r) => [r._id, r.days]));

  // Monthly Koin-spend gate — read-only here (admin viewing the list never
  // triggers a grant; that only happens lazily off the ambassador's own
  // dashboard load, see ambassador.js).
  const grantRows = ids.length
    ? await col("ambassador_months").find({ userId: { $in: ids }, month }).toArray()
    : [];
  const grantByUser = new Map(grantRows.map((r) => [r.userId, r]));

  const goal = ECONOMY.ambassador;
  return {
    total, page, limit,
    goal: { calls: goal.dailyQualifyingCalls, callSeconds: goal.dailyCallSeconds, minCallSecondsToQualify: goal.minCallSecondsToQualify, rewardKoins: goal.dailyRewardKoins, monthlyGrantKoins: goal.monthlyGrantKoins },
    ambassadors: users.map((u) => {
      const t = todayByUser.get(u.id);
      const c = completedByUser.get(u.id);
      const grant = grantByUser.get(u.id);
      return {
        id: u.id, name: displayName(u), emailMasked: maskEmail(u.email), ambassadorSince: u.ambassadorSince ?? null,
        today: { calls: t?.calls ?? 0, callSeconds: t?.callSeconds ?? 0, goalMet: !!t?.rewardedAt },
        totalDaysCompleted: c?.days ?? 0, totalKoinsEarned: c?.koins ?? 0,
        daysThisMonth: monthDaysByUser.get(u.id) ?? 0,
        monthlyGrant: grant ? { grantedAt: grant.grantedAt, amount: grant.grantAmount } : null,
      };
    }),
  };
}

/** One ambassador's full day-by-day history — the admin drill-down. */
export async function ambassadorDetail(id) {
  const u = await col("users").findOne({ id, isAmbassador: true });
  if (!u) return null;
  const [days, goodies] = await Promise.all([
    col("ambassador_days").find({ userId: id }).sort({ date: -1 }).limit(60).toArray(),
    peekGoodiesProgress(id),
  ]);
  return {
    id: u.id, name: displayName(u), emailMasked: maskEmail(u.email), ambassadorSince: u.ambassadorSince ?? null,
    days: days.map((d) => ({ date: d.date, calls: d.calls, callSeconds: d.callSeconds, goalMet: !!d.rewardedAt, rewardKoins: d.rewardKoins ?? 0 })),
    goodies,
  };
}

// ─── Goodie tier management (admin-configurable milestones) ───────────────
export async function listGoodieTiers() {
  return goodieTiers();
}
export async function addGoodieTier(body, admin) {
  const tier = await createGoodieTier({ label: body?.label, requiredDays: Number(body?.requiredDays) });
  await logAudit(admin.email, "ambassador.goodie_tier.create", tier.id, { label: tier.label, requiredDays: tier.requiredDays });
  return tier;
}
export async function removeGoodieTier(id, admin) {
  const removed = await deleteGoodieTier(id);
  if (removed) await logAudit(admin.email, "ambassador.goodie_tier.delete", id);
  return removed;
}
