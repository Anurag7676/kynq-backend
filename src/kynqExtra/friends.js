// Friends + direct messages for Kynq Extra.
//
// Rules (all enforced here, never trusted from the client):
// - You can only send a request to someone you've actually matched with
//   (a call record exists between you). No cold-adding by id.
// - Friendship is mutual: a request from B while A's is pending accepts it.
// - Declined requests can't be re-sent for 7 days. Requests don't expire.
// - Blocks win: blocking drops the friendship and any pending request, and
//   a blocked pair can never message or re-request.
// - DMs are text only, between accepted friends, stored in plain text
//   (like in-call chat). Not end-to-end encrypted.
//
// Same collection() key-value pattern as the rest of kynqExtra for writes; reads that span
// many documents (lists, counts, last message, unread) are real indexed Mongo queries, never
// collection().find(), which pulls the whole collection into Node.
import mongoose from "mongoose";
import { collection, makeId } from "../gift/store.js";
import { isBlockedEitherWay, pairKey } from "./blocks.js";

const requests = collection("friend_requests");
const friendships = collection("friendships");
const dms = collection("dm_messages");
const raw = (name) => mongoose.connection.collection(name);
const strip = (doc) => { if (!doc) return null; const { _id, _key, ...rest } = doc; return rest; };
const UNREAD = { $in: [null, 0] }; // readAt never set (same as the old `!m.readAt`)

// Indexes for the queries below; created once, safe to repeat.
let indexesReady = null;
export function ensureFriendIndexes() {
  indexesReady ??= Promise.all([
    raw("friendships").createIndex({ _key: 1 }),
    raw("friendships").createIndex({ a: 1 }),
    raw("friendships").createIndex({ b: 1 }),
    raw("friend_requests").createIndex({ _key: 1 }),
    raw("friend_requests").createIndex({ to: 1, status: 1 }),
    raw("friend_requests").createIndex({ from: 1, status: 1 }),
    raw("dm_messages").createIndex({ _key: 1 }),
    raw("dm_messages").createIndex({ pairKey: 1, at: -1 }),
    raw("dm_messages").createIndex({ pairKey: 1, to: 1, readAt: 1 }),
    raw("blocks").createIndex({ _key: 1 }),
  ]).catch((err) => { indexesReady = null; console.error("[friends] index creation failed:", err.message); });
  return indexesReady;
}
const friendsOf = (me) => raw("friendships").find({ $or: [{ a: me }, { b: me }] }).toArray();

const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const REQUESTS_PER_DAY = 30;
const DMS_PER_HOUR = 200;
const DM_MAX_LEN = 1000;

export class FriendError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// In-memory rate counters — fine single-process; reset on restart.
const counters = new Map();
function bump(key, limit, windowMs) {
  const now = Date.now();
  const c = counters.get(key);
  if (!c || now > c.resetAt) { counters.set(key, { n: 1, resetAt: now + windowMs }); return; }
  if (c.n >= limit) throw new FriendError("Slow down — try again later", 429);
  c.n += 1;
}

async function hadCallBetween(a, b) {
  return !!(await raw("calls").findOne({ $or: [{ participantA: a, participantB: b }, { participantA: b, participantB: a }] }, { projection: { _id: 1 } }));
}

export async function areFriends(a, b) {
  return !!(await friendships.get(pairKey(a, b)));
}

// Status of `me` towards `other`, for buttons.
export async function statusFor(me, other) {
  if (me === other) return "self";
  if (await isBlockedEitherWay(me, other)) return "blocked";
  if (await friendships.get(pairKey(me, other))) return "friends";
  const r = await requests.get(pairKey(me, other));
  if (r?.status === "pending") return r.from === me ? "requested" : "incoming";
  return "none";
}

/** statusFor for many people at once: three batched lookups instead of ~4 per person. */
export async function statusMap(me, ids) {
  await ensureFriendIndexes();
  const others = [...new Set(ids)].filter((id) => id !== me);
  const keys = others.map((id) => pairKey(me, id));
  const blockKeys = others.flatMap((id) => [`${me}>${id}`, `${id}>${me}`]);
  const [blocked, friends, reqs] = await Promise.all([
    raw("blocks").find({ _key: { $in: blockKeys } }, { projection: { _key: 1 } }).toArray(),
    raw("friendships").find({ _key: { $in: keys } }, { projection: { _key: 1 } }).toArray(),
    raw("friend_requests").find({ _key: { $in: keys }, status: "pending" }, { projection: { _key: 1, from: 1 } }).toArray(),
  ]);
  const blockedSet = new Set(blocked.map((b) => b._key)), friendSet = new Set(friends.map((f) => f._key));
  const reqBy = new Map(reqs.map((r) => [r._key, r]));
  const out = {};
  for (const id of ids) {
    if (id === me) { out[id] = "self"; continue; }
    const key = pairKey(me, id), r = reqBy.get(key);
    out[id] = blockedSet.has(`${me}>${id}`) || blockedSet.has(`${id}>${me}`) ? "blocked"
      : friendSet.has(key) ? "friends"
      : r ? (r.from === me ? "requested" : "incoming")
      : "none";
  }
  return out;
}

export async function sendRequest(from, to, { callId } = {}) {
  if (!to || to === from) throw new FriendError("Invalid user");
  if (await isBlockedEitherWay(from, to)) throw new FriendError("You can't add this person", 403);
  if (await friendships.get(pairKey(from, to))) return { status: "friends", accepted: false };
  if (!(await hadCallBetween(from, to))) throw new FriendError("You can only add people you've matched with", 403);

  const key = pairKey(from, to);
  const existing = await requests.get(key);
  const now = Date.now();
  if (existing?.status === "pending") {
    if (existing.from === from) return { status: "requested", accepted: false };
    // They asked first — this is the mutual add. Accept.
    return accept(existing, now);
  }
  if (existing?.status === "declined" && existing.declinedBy === to && now - existing.updatedAt < DECLINE_COOLDOWN_MS) {
    throw new FriendError("They declined recently — you can try again in a few days", 403);
  }
  bump(`req:${from}:${new Date().toISOString().slice(0, 10)}`, REQUESTS_PER_DAY, 24 * 60 * 60 * 1000);
  const req = { _key: key, id: key, from, to, callId: callId ?? existing?.callId ?? null, status: "pending", createdAt: now, updatedAt: now };
  await requests.set(key, req);
  return { status: "requested", accepted: false, request: req };
}

async function accept(req, now = Date.now()) {
  const key = pairKey(req.from, req.to);
  await requests.set(key, { ...req, status: "accepted", updatedAt: now });
  const f = { _key: key, id: key, a: req.from, b: req.to, since: now };
  await friendships.set(key, f);
  return { status: "friends", accepted: true, friendship: f, request: { ...req, status: "accepted" } };
}

export async function respondRequest(me, otherId, decision) {
  const key = pairKey(me, otherId);
  const req = await requests.get(key);
  if (!req || req.status !== "pending" || req.to !== me) throw new FriendError("No pending request from them", 404);
  if (decision === "accept") {
    if (await isBlockedEitherWay(me, otherId)) throw new FriendError("You can't add this person", 403);
    return accept(req);
  }
  await requests.set(key, { ...req, status: "declined", declinedBy: me, updatedAt: Date.now() });
  return { status: "none", accepted: false };
}

export async function unfriend(me, otherId) {
  const key = pairKey(me, otherId);
  await friendships.delete(key);
  const req = await requests.get(key);
  if (req) await requests.delete(key);
  return { status: "none" };
}

// Called when someone blocks: drop everything between the pair.
export async function dropOnBlock(a, b) {
  const key = pairKey(a, b);
  await friendships.delete(key);
  const req = await requests.get(key);
  if (req) await requests.delete(key);
}

/** How many friends — no per-friend DM lookups (listFriends does those). */
export async function countFriends(me) {
  await ensureFriendIndexes();
  return raw("friendships").countDocuments({ $or: [{ a: me }, { b: me }] });
}

/** Every friend with their last message and my unread count, in one aggregation over the
 *  pair's messages (newest first per pair, via the { pairKey, at } index). */
export async function listFriends(me) {
  await ensureFriendIndexes();
  const all = await friendsOf(me);
  if (!all.length) return [];
  const keys = all.map((f) => pairKey(f.a, f.b));
  const per = await raw("dm_messages").aggregate([
    { $match: { pairKey: { $in: keys } } },
    { $sort: { pairKey: 1, at: -1 } },
    { $group: {
      _id: "$pairKey",
      text: { $first: "$text" }, from: { $first: "$from" }, at: { $first: "$at" },
      unread: { $sum: { $cond: [{ $and: [{ $eq: ["$to", me] }, { $in: [{ $ifNull: ["$readAt", null] }, [null, 0]] }] }, 1, 0] } },
    } },
  ]).toArray();
  const byKey = new Map(per.map((p) => [p._id, p]));
  const out = all.map((f) => {
    const p = byKey.get(pairKey(f.a, f.b));
    return { userId: f.a === me ? f.b : f.a, since: f.since, last: p ? { text: p.text, from: p.from, at: p.at } : null, unread: p?.unread ?? 0 };
  });
  return out.sort((x, y) => (y.last?.at ?? y.since) - (x.last?.at ?? x.since));
}

export async function listRequests(me) {
  await ensureFriendIndexes();
  const all = await raw("friend_requests").find({ status: "pending", $or: [{ from: me }, { to: me }] }).toArray();
  return {
    incoming: all.filter((r) => r.to === me).map((r) => ({ userId: r.from, callId: r.callId, at: r.createdAt })),
    outgoing: all.filter((r) => r.from === me).map((r) => ({ userId: r.to, callId: r.callId, at: r.createdAt })),
  };
}

// ─── Direct messages ───

/** The newest `limit` messages (before `before`, if given), oldest first. */
export async function listDm(me, other, { limit = 100, before } = {}) {
  await ensureFriendIndexes();
  if (!(await areFriends(me, other))) throw new FriendError("You can only message friends", 403);
  const q = { pairKey: pairKey(me, other), ...(before ? { at: { $lt: before } } : {}) };
  const newest = await raw("dm_messages").find(q).sort({ at: -1 }).limit(limit).toArray();
  return newest.reverse().map(strip);
}

export async function sendDm(from, to, text) {
  const clean = String(text ?? "").trim().slice(0, DM_MAX_LEN);
  if (!clean) throw new FriendError("Say something");
  if (await isBlockedEitherWay(from, to)) throw new FriendError("You can't message this person", 403);
  if (!(await areFriends(from, to))) throw new FriendError("You can only message friends", 403);
  bump(`dm:${from}`, DMS_PER_HOUR, 60 * 60 * 1000);
  const id = makeId("dm");
  const m = { _key: id, id, pairKey: pairKey(from, to), from, to, text: clean, at: Date.now(), readAt: null };
  await dms.set(id, m);
  return m;
}

export async function markRead(me, other) {
  await ensureFriendIndexes();
  const q = { pairKey: pairKey(me, other), to: me, readAt: UNREAD };
  const ids = (await raw("dm_messages").find(q, { projection: { id: 1 } }).toArray()).map((m) => m.id);
  const now = Date.now();
  if (ids.length) await raw("dm_messages").updateMany({ ...q, id: { $in: ids } }, { $set: { readAt: now } });
  return { marked: ids.length, readAt: now, ids };
}

/** Badge numbers: three counts, no per-friend work. */
export async function summary(me) {
  await ensureFriendIndexes();
  const all = await friendsOf(me);
  const keys = all.map((f) => pairKey(f.a, f.b));
  const [pendingIncoming, unread] = await Promise.all([
    raw("friend_requests").countDocuments({ to: me, status: "pending" }),
    keys.length ? raw("dm_messages").countDocuments({ pairKey: { $in: keys }, to: me, readAt: UNREAD }) : 0,
  ]);
  return { pendingIncoming, unread, friends: all.length };
}
