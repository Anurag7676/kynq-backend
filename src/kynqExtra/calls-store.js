// Calls, recent-match history, and game-session state for Kynq Extra.
// Same collection() key-value pattern as Backend/src/gift/orders-store.js —
// _key-addressed documents with an events[] audit trail on mutable records.
import mongoose from "mongoose";
import { collection, makeId } from "../gift/store.js";

const RECENT_MATCHES_COLLECTION = "recent_matches";
const calls = collection("calls");
const recentMatches = collection(RECENT_MATCHES_COLLECTION);
const gameSessions = collection("game_sessions");

const RECENT_MATCH_WINDOW_MS = 30 * 60 * 1000; // don't re-match the same pair for 30 min

// participantA/participantB/matchedAt aren't indexed by the generic _key
// store — recentlyMatchedPairsAmong() below needs a real query on them.
let indexesReady = null;
export function ensureCallsIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([
      mongoose.connection.collection(RECENT_MATCHES_COLLECTION).createIndex({ participantA: 1, matchedAt: 1 }),
      mongoose.connection.collection(RECENT_MATCHES_COLLECTION).createIndex({ participantB: 1, matchedAt: 1 }),
      // Live-path lookups on calls (reconnect resume, history, stale sweep) query these directly.
      mongoose.connection.collection("calls").createIndex({ participantA: 1, startedAt: -1 }),
      mongoose.connection.collection("calls").createIndex({ participantB: 1, startedAt: -1 }),
      mongoose.connection.collection("calls").createIndex({ status: 1, startedAt: 1 }),
    ]).catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}

export async function createCall(participantA, participantB) {
  const id = makeId("call");
  const now = Date.now();
  const call = {
    id,
    participantA,
    participantB,
    status: "active",
    startedAt: now,
    endedAt: null,
    endReason: null,
    events: [{ at: now, kind: "started" }],
  };
  await calls.set(id, call);

  const pairKey = [participantA, participantB].sort().join("|");
  await recentMatches.set(`${pairKey}:${now}`, {
    participantA,
    participantB,
    callId: id,
    matchedAt: now,
  });

  return call;
}

export async function endCall(callId, reason) {
  const call = await calls.get(callId);
  if (!call) return null;
  const now = Date.now();
  const next = {
    ...call,
    status: "ended",
    endedAt: now,
    endReason: reason,
    events: [...call.events, { at: now, kind: "ended", note: reason }],
  };
  await calls.set(callId, next);
  return next;
}

export async function getCall(callId) {
  return calls.get(callId);
}

// Indexed queries on the raw collection (participantA / participantB / startedAt are indexed;
// see ensureConsoleIndexes). The generic collection().find() loads EVERY call into Node and
// filters in JavaScript, which ran on every socket connection.
const callsRaw = () => mongoose.connection.collection("calls");
const strip = (doc) => { if (!doc) return null; const { _id, _key, ...rest } = doc; return rest; };
const forUser = (scopedId) => ({ $or: [{ participantA: scopedId }, { participantB: scopedId }] });

// Call history — most recent first, both directions (caller could be
// participantA or participantB). Used by GET /api/kynq-extra/calls.
export async function listCallsForUser(scopedId, limit = 50) {
  const docs = await callsRaw().find(forUser(scopedId)).sort({ startedAt: -1 }).limit(limit).toArray();
  return docs.map(strip);
}

// Find a still-active call a user is (or very recently was) part of — used
// by the reconnection grace-period flow to re-associate a fresh socket
// connection with the call it dropped out of, without the client needing
// to remember/pass a callId across a full page reload. Newest first.
export async function findActiveCallForUser(scopedId) {
  const doc = await callsRaw().findOne({ status: "active", ...forUser(scopedId) }, { sort: { startedAt: -1 } });
  return strip(doc);
}

// Calls still marked active, oldest first — for the stale-call sweep.
export async function listActiveCalls(limit = 500) {
  const docs = await callsRaw().find({ status: "active" }, { projection: { _id: 0, id: 1, participantA: 1, participantB: 1, startedAt: 1, events: 1 } }).sort({ startedAt: 1 }).limit(limit).toArray();
  return docs;
}

// Close a call nobody is in any more (lost to a server restart mid-call, both sides gone).
// Ended at its LAST RECORDED ACTIVITY, not now, and with reason "stale", so it never earns
// chat rewards, ambassador credit, or skews call-length stats with a days-long "call".
export async function endStaleCall(callId) {
  const call = await calls.get(callId);
  if (!call || call.status !== "active") return null;
  const lastSeen = Math.max(call.startedAt || 0, ...(call.events || []).map((e) => e.at || 0));
  const next = {
    ...call,
    status: "ended",
    endedAt: lastSeen,
    endReason: "stale",
    events: [...(call.events || []), { at: Date.now(), kind: "ended", note: "stale: nobody connected (lost to a restart or both sides gone)" }],
  };
  await calls.set(callId, next);
  return next;
}

// Recently-matched pairs are excluded from re-matching for
// RECENT_MATCH_WINDOW_MS — checked by the matchmaker before pairing two
// candidates. Cheap because the matchmaking queue itself is small
// (dozens-to-low-hundreds waiting at once); this is an O(n) scan of a
// bounded recent-history window, not the whole collection's lifetime.
export async function wasRecentlyMatched(scopedIdA, scopedIdB) {
  const cutoff = Date.now() - RECENT_MATCH_WINDOW_MS;
  const pairKey = [scopedIdA, scopedIdB].sort().join("|");
  const matches = await recentMatches.find(
    (m) => [m.participantA, m.participantB].sort().join("|") === pairKey && m.matchedAt >= cutoff
  );
  return matches.length > 0;
}

// Batch version for the matchmaker: ONE indexed query for the whole waiting
// queue instead of recentMatches.find() (a full collection scan pulled into
// JS) run once per candidate PAIR — that was the actual O(n²)-round-trips
// bottleneck at scale, not raw compute. Returns a Set of sorted "a|b"
// pairKeys matched within the window, restricted to pairs involving at
// least one of the given scopedIds.
export async function recentlyMatchedPairsAmong(scopedIds) {
  if (!scopedIds.length) return new Set();
  const cutoff = Date.now() - RECENT_MATCH_WINDOW_MS;
  const docs = await mongoose.connection.collection(RECENT_MATCHES_COLLECTION)
    .find({
      matchedAt: { $gte: cutoff },
      $or: [{ participantA: { $in: scopedIds } }, { participantB: { $in: scopedIds } }],
    })
    .project({ participantA: 1, participantB: 1 })
    .toArray()
    .catch((err) => { console.error("[kynqExtra] recentlyMatchedPairsAmong query failed:", err.message); return []; });
  return new Set(docs.map((m) => [m.participantA, m.participantB].sort().join("|")));
}

// ─── Game sessions ─────────────────────────────────────────

export async function createGameSession(callId, gameType, initialState, firstTurnScopedId) {
  const id = makeId("game");
  const now = Date.now();
  const session = {
    id,
    callId,
    gameType,
    state: initialState,
    turnOf: firstTurnScopedId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await gameSessions.set(id, session);
  return session;
}

export async function getGameSession(id) {
  return gameSessions.get(id);
}

export async function updateGameSession(id, patch) {
  const existing = await gameSessions.get(id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  await gameSessions.set(id, next);
  return next;
}
