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
// Same collection() key-value pattern as the rest of kynqExtra.
import { collection, makeId } from "../gift/store.js";
import { isBlockedEitherWay, pairKey } from "./blocks.js";
import { listCallsForUser } from "./calls-store.js";

const requests = collection("friend_requests");
const friendships = collection("friendships");
const dms = collection("dm_messages");

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
  const calls = await listCallsForUser(a, 500);
  return calls.some((c) => (c.participantA === a && c.participantB === b) || (c.participantA === b && c.participantB === a));
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

export async function statusMap(me, ids) {
  const out = {};
  for (const id of ids) out[id] = await statusFor(me, id); // eslint-disable-line no-await-in-loop
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

export async function listFriends(me) {
  const all = await friendships.find((f) => f.a === me || f.b === me);
  const out = [];
  for (const f of all) {
    const other = f.a === me ? f.b : f.a;
    // eslint-disable-next-line no-await-in-loop
    const last = await lastDm(me, other);
    // eslint-disable-next-line no-await-in-loop
    const unread = await unreadCount(me, other);
    out.push({ userId: other, since: f.since, last, unread });
  }
  return out.sort((x, y) => (y.last?.at ?? y.since) - (x.last?.at ?? x.since));
}

export async function listRequests(me) {
  const all = await requests.find((r) => r.status === "pending" && (r.from === me || r.to === me));
  return {
    incoming: all.filter((r) => r.to === me).map((r) => ({ userId: r.from, callId: r.callId, at: r.createdAt })),
    outgoing: all.filter((r) => r.from === me).map((r) => ({ userId: r.to, callId: r.callId, at: r.createdAt })),
  };
}

// ─── Direct messages ───

async function lastDm(a, b) {
  const key = pairKey(a, b);
  const all = await dms.find((m) => m.pairKey === key);
  if (!all.length) return null;
  const m = all.reduce((p, c) => (c.at > p.at ? c : p));
  return { text: m.text, from: m.from, at: m.at };
}

async function unreadCount(me, other) {
  const key = pairKey(me, other);
  const all = await dms.find((m) => m.pairKey === key && m.to === me && !m.readAt);
  return all.length;
}

export async function listDm(me, other, { limit = 100, before } = {}) {
  if (!(await areFriends(me, other))) throw new FriendError("You can only message friends", 403);
  const key = pairKey(me, other);
  let all = await dms.find((m) => m.pairKey === key && (!before || m.at < before));
  all = all.sort((x, y) => x.at - y.at);
  return all.slice(-limit);
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
  const key = pairKey(me, other);
  const unread = await dms.find((m) => m.pairKey === key && m.to === me && !m.readAt);
  const now = Date.now();
  for (const m of unread) await dms.set(m.id, { ...m, readAt: now }); // eslint-disable-line no-await-in-loop
  return { marked: unread.length, readAt: now, ids: unread.map((m) => m.id) };
}

export async function summary(me) {
  const [reqs, friends] = await Promise.all([listRequests(me), listFriends(me)]);
  return {
    pendingIncoming: reqs.incoming.length,
    unread: friends.reduce((n, f) => n + f.unread, 0),
    friends: friends.length,
  };
}
