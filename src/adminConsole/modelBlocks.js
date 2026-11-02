// "Model blocks": everyone the nudity model (kynqExtra/moderation.js) acted on — locked out, banned,
// or had a call ended — with the evidence behind it, so a person can check it and undo it.
// Moderation events (and their frames) are kept 7 days, so the list covers the last 7 days plus
// anyone still locked out by the model.
import { col, pageParams, usersById, displayName, maskEmail } from "./util.js";
import { logAudit } from "./audit.js";

const ACTIONS = ["locked_24h", "locked_168h", "banned", "cooldown_1h", "ended_peer_only"];
const MODEL_REASONS = ["nudity", "nudity_reported"];
const VIEWS = ["blocked", "recent"];

const lockOf = (u, now) => {
  if (!u || !MODEL_REASONS.includes(u.kynqExtraRestrictedReason)) return null;
  if (u.kynqExtraRestricted) return { permanent: true, until: null };
  const until = Number(u.kynqExtraRestrictedUntil) || 0;
  return until > now ? { permanent: false, until } : null;
};

/** People the model acted on: "blocked" = locked out right now, "recent" = anyone acted on in 7 days. */
export async function listModelBlocks(query) {
  const { page, limit, skip } = pageParams(query);
  const view = VIEWS.includes(query?.view) ? query.view : "blocked";
  const now = Date.now();
  const events = col("moderation_events");

  // Latest action per person over the last 7 days (frames left out: they're big).
  const acted = await events.aggregate([
    { $match: { action: { $in: ACTIONS } } },
    { $project: { subject: 1, at: 1, action: 1, kind: 1, serverScores: 1, nsfw: 1 } },
    { $sort: { at: -1 } },
    { $group: { _id: "$subject", lastAt: { $first: "$at" }, lastAction: { $first: "$action" }, lastKind: { $first: "$kind" }, lastPorn: { $first: "$serverScores.Porn" }, actions: { $sum: 1 } } },
  ]).toArray();
  const lockedNow = await col("users").find(
    { kynqExtraRestrictedReason: { $in: MODEL_REASONS }, $or: [{ kynqExtraRestricted: true }, { kynqExtraRestrictedUntil: { $gt: now } }] },
    { projection: { id: 1 } },
  ).toArray();

  const byId = new Map(acted.map((a) => [a._id, a]));
  for (const u of lockedNow) if (!byId.has(u.id)) byId.set(u.id, { _id: u.id, lastAt: null, lastAction: null, lastKind: null, lastPorn: null, actions: 0 });
  const people = await usersById([...byId.keys()]);

  let rows = [...byId.values()].map((a) => {
    const u = people.get(a._id);
    const lock = lockOf(u, now);
    return {
      id: a._id, name: displayName(u), email: u?.email ? maskEmail(u.email) : null,
      blocked: !!lock, permanent: !!lock?.permanent, until: lock?.until ?? null,
      lastAt: a.lastAt, lastAction: a.lastAction, lastKind: a.lastKind,
      lastPorn: a.lastPorn == null ? null : Math.round(a.lastPorn * 100) / 100, actions: a.actions,
      amnestyAt: u?.moderationAmnestyAt ?? null,
    };
  });
  const counts = { blocked: rows.filter((r) => r.blocked).length, recent: rows.length };
  if (view === "blocked") rows = rows.filter((r) => r.blocked);
  rows.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
  return { view, total: rows.length, page, limit, counts, rows: rows.slice(skip, skip + limit) };
}

/** One person: lock state, strikes and every model event about them (last 7 days, no frames). */
export async function modelBlockDetail(userId) {
  const now = Date.now();
  const [user] = (await usersById([userId])).values();
  if (!user) throw Object.assign(new Error("user not found"), { code: "not_found" });
  const [events, strikes] = await Promise.all([
    col("moderation_events").find({ subject: userId }, { projection: { frame: 0, expireAt: 0 } }).sort({ at: -1 }).limit(50).toArray(),
    col("moderation_strikes").countDocuments({ userId }),
  ]);
  const withFrame = new Set((await col("moderation_events").find({ subject: userId, frame: { $exists: true } }, { projection: { _id: 1 } }).toArray()).map((e) => String(e._id)));
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
  const lock = lockOf(user, now);
  return {
    id: userId, name: displayName(user), email: user.email ? maskEmail(user.email) : null,
    blocked: !!lock, permanent: !!lock?.permanent, until: lock?.until ?? null, reason: user.kynqExtraRestrictedReason ?? null,
    strikes, amnestyAt: user.moderationAmnestyAt ?? null,
    events: events.map((e) => ({
      id: String(e._id), at: e.at, kind: e.kind, level: e.level, callId: e.callId,
      action: e.action ?? null, evidence: e.confirmed ?? null,
      clientScore: r2(e.nsfw), serverPorn: r2(e.serverScores?.Porn), serverSexy: r2(e.serverScores?.Sexy),
      hasFrame: withFrame.has(String(e._id)),
    })),
  };
}

/** The frame the model flagged (JPEG, base64), for checking it by eye. Every view is audited. */
export async function modelBlockFrame(eventId, admin) {
  const e = await col("moderation_events").findOne({ _id: eventId }, { projection: { frame: 1, subject: 1 } });
  if (!e?.frame) throw Object.assign(new Error("frame not found (frames are kept 7 days)"), { code: "not_found" });
  await logAudit(admin.email, "moderation.frame_viewed", eventId, { subject: e.subject });
  return { image: `data:image/jpeg;base64,${e.frame}` };
}

/** Lift a model lockout (and, by default, its strikes, so the ladder starts again). */
export async function unblockModel(userId, { clearStrikes = true } = {}, admin) {
  const [user] = (await usersById([userId])).values();
  if (!user) throw Object.assign(new Error("user not found"), { code: "not_found" });
  if (user.kynqExtraRestrictedReason && !MODEL_REASONS.includes(user.kynqExtraRestrictedReason)) {
    throw Object.assign(new Error("this person was restricted by an admin, not the model: use Users"), { code: "bad_request" });
  }
  await col("users").updateOne({ id: userId }, { $set: { kynqExtraRestricted: false, kynqExtraRestrictedUntil: 0 }, $unset: { kynqExtraRestrictedReason: "" } });
  const cleared = clearStrikes ? (await col("moderation_strikes").deleteMany({ userId })).deletedCount : 0;
  await logAudit(admin.email, "moderation.unblock", userId, { clearStrikes, strikesCleared: cleared });
  return modelBlockDetail(userId);
}
