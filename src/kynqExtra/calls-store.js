// Calls, recent-match history, and game-session state for Kynq Extra.
// Same collection() key-value pattern as Backend/src/gift/orders-store.js —
// _key-addressed documents with an events[] audit trail on mutable records.
import { collection, makeId } from "../gift/store.js";

const calls = collection("calls");
const recentMatches = collection("recent_matches");
const gameSessions = collection("game_sessions");

const RECENT_MATCH_WINDOW_MS = 30 * 60 * 1000; // don't re-match the same pair for 30 min

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
