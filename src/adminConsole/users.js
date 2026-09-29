// Users: search, profile view, restrict, and the (audited) reveal of a full email address.
import { col, REAL_USER, pageParams, escapeRegex, maskEmail, displayName, setRestrictedById, setAmbassadorById } from "./util.js";
import { TX_LABEL } from "./stats.js";
import { reportsForUser } from "./moderation.js";
import { logAudit } from "./audit.js";

const ageOf = (dob) => { const t = Date.parse(dob); return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / (365.2425 * 86_400_000)); };

async function balances(ids) {
  if (!ids.length) return new Map();
  const rows = await col("wallet_transactions").aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: "$userId", total: { $sum: "$amount" } } }]).toArray();
  return new Map(rows.map((r) => [r._id, r.total]));
}

const row = (u, koins) => ({
  id: u.id, name: displayName(u), emailMasked: maskEmail(u.email), createdAt: u.createdAt ?? null, lastSeenAt: u.lastSeenAt ?? null,
  restricted: !!u.kynqExtraRestricted, ageVerified: !!u.ageVerified, gender: u.gender ?? null, state: u.state ?? null, koins,
  isAmbassador: !!u.isAmbassador,
});

export async function listUsers(query) {
  const { page, limit, skip } = pageParams(query);
  const q = String(query?.q || "").trim().slice(0, 80);
  const filter = { ...REAL_USER };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ name: rx }, { email: rx }, { id: q }];
  }
  if (query?.filter === "restricted") filter.kynqExtraRestricted = true;
  if (query?.filter === "ambassador") filter.isAmbassador = true;
  if (query?.filter === "paying") filter.id = { $in: (await col("coin_orders").distinct("userId", { status: "paid" })).filter(Boolean) };

  const [total, users] = await Promise.all([
    col("users").countDocuments(filter),
    col("users").find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
  ]);
  const bal = await balances(users.map((u) => u.id));
  return { total, page, limit, users: users.map((u) => row(u, bal.get(u.id) ?? 0)) };
}

export async function getUser(id) {
  const u = await col("users").findOne({ id });
  if (!u) return null;
  const callFilter = { $or: [{ participantA: id }, { participantB: id }] };
  const [bal, history, callTotal, recentCalls, reports, orders] = await Promise.all([
    balances([id]),
    col("wallet_transactions").find({ userId: id }).sort({ createdAt: -1 }).limit(50).toArray(),
    col("calls").countDocuments(callFilter),
    col("calls").find(callFilter).sort({ startedAt: -1 }).limit(10).toArray(),
    reportsForUser(id),
    col("coin_orders").find({ userId: id }).sort({ createdAt: -1 }).limit(20).toArray(),
  ]);
  return {
    user: {
      id: u.id, name: displayName(u), emailMasked: maskEmail(u.email), createdAt: u.createdAt ?? null, lastSeenAt: u.lastSeenAt ?? null,
      restricted: !!u.kynqExtraRestricted, ageVerified: !!u.ageVerified, age: u.dob ? ageOf(u.dob) : null,
      gender: u.gender ?? null, state: u.state ?? null, city: u.city ?? null, interests: Array.isArray(u.interests) ? u.interests : [],
      isAmbassador: !!u.isAmbassador, ambassadorSince: u.ambassadorSince ?? null,
    },
    wallet: { balance: bal.get(id) ?? 0, history: history.map((t) => ({ id: t.id, type: t.type, label: TX_LABEL[t.type] ?? t.type, amount: t.amount, createdAt: t.createdAt })) },
    calls: {
      total: callTotal,
      recent: recentCalls.map((c) => ({
        id: c.id, startedAt: c.startedAt, durationSec: c.endedAt && c.endedAt > c.startedAt ? Math.round((c.endedAt - c.startedAt) / 1000) : null,
        endReason: c.endReason ?? null, otherUserId: c.participantA === id ? c.participantB : c.participantA,
      })),
    },
    reports,
    orders: orders.map((o) => ({ id: o.id, packId: o.packId, coins: o.coins, inr: o.amount, status: o.status, createdAt: o.createdAt })),
  };
}

export async function restrictUser(id, restricted, admin) {
  if (!(await setRestrictedById(id, restricted))) return null;
  await logAudit(admin.email, "user.restrict", id, { restricted });
  return { id, restricted };
}

export async function setAmbassador(id, enrolled, admin) {
  if (!(await setAmbassadorById(id, enrolled))) return null;
  await logAudit(admin.email, "user.ambassador", id, { enrolled });
  return { id, isAmbassador: enrolled };
}

export async function revealEmail(id, admin) {
  const u = await col("users").findOne({ id });
  if (!u) return null;
  await logAudit(admin.email, "user.reveal_email", id);
  return { email: u.email };
}
