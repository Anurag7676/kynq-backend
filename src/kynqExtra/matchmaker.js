// In-memory, single-process matchmaking queue for Kynq Extra (see the
// plan's "Matchmaking queue" decision — Redis only gets introduced once a
// second backend instance exists; pre-paying that infra tax now isn't
// worth it for a queue that's realistically dozens-to-low-hundreds deep).
//
// A ~1s tick scans waiting entries (longest-waiting first) and pairs
// compatible candidates. Compatibility = topic overlap + location-scope
// match + not blocked + not recently matched. The resulting call is
// persisted (calls-store.js survives process restarts); the live queue
// itself does not need to.
import { blockedPairsAmong, pairKey } from "./blocks.js";
import { createCall, recentlyMatchedPairsAmong } from "./calls-store.js";
import { recordMatch } from "./pulse.js";
import crypto from "crypto";
import { startMeter } from "./chat-meter.js";
import { debit, credit, InsufficientBalanceError } from "./wallet.js";
import { ECONOMY, isPaidGenderPreference } from "./economy.js";
import { activePassExpiry, startPass, cancelPass } from "./gender-pass.js";
import { DEMO_MATCH_ENABLED, demoDelayMs, noteDemoServed, resetDemoBackoff, pickDemoMatch } from "./demo-accounts.js";

const TICK_MS = 1000;

// The "where to match" choice (worldwide / India / my state) is switched off for
// now: with few people online, narrowing the pool leaves people waiting, so every
// search is worldwide whatever the client sends (old tabs and old saved settings
// included). Set true to bring the location rules back; the front end has the same
// switch in lib/features.ts.
export const LOCATION_FILTER_ENABLED = false;

// Topics are switched off for matching too. They only ever gave a preference for someone
// with the same interest, but with few people online every search should draw on everyone,
// so the server ignores whatever topics the client sends (old tabs included) and every
// search is treated as "all topics". The picker in the app still saves the choice. Set true
// to bring the same-interest preference back.
export const TOPIC_MATCHING_ENABLED = false;

// A pair that just talked is normally not matched again (see calls-store's
// 30-minute window), so people meet someone new. But with a small pool that
// would leave everyone stuck: if BOTH people have already waited this long and
// the only option left is a recent partner, let them meet again. Fresh
// partners are always preferred, and blocked pairs are never relaxed.
const RECENT_RELAX_MS = 45_000;

// scopedId -> { scopedId, socketId, topics, locationScope, location, joinedAt }
const queue = new Map();
let tickHandle = null;

export function joinQueue({ scopedId, socketId, topics, locationScope, location, gender, genderPref }) {
  // A repeat join (the client can join from the home page AND from the room for one
  // click, or re-join after a reconnect) must NOT restart the person's wait: every
  // wait-based rule (widening, rematch after 45s, the demo fallback) is measured from
  // the FIRST join. Only the preferences and the socket are refreshed.
  const joinedAt = queue.get(scopedId)?.joinedAt ?? Date.now();
  queue.set(scopedId, {
    scopedId,
    socketId,
    topics: TOPIC_MATCHING_ENABLED ? (topics ?? []) : [],
    locationScope: LOCATION_FILTER_ENABLED ? normScope(locationScope ?? "worldwide") : "worldwide",
    location: LOCATION_FILTER_ENABLED ? (location ?? {}) : {}, // { city, state, country } — best-effort, from client/IP
    gender: gender ?? null,         // from the saved profile (server-side)
    genderPref: genderPref ?? null, // paid extra; null = anyone
    joinedAt,
  });
}

/** How long (ms) this person has been waiting, or null if they are not queued. */
export function waitedMs(scopedId) {
  const e = queue.get(scopedId);
  return e ? Date.now() - e.joinedAt : null;
}

export function leaveQueue(scopedId) {
  queue.delete(scopedId);
}

export function isQueued(scopedId) {
  return queue.has(scopedId);
}

export function queueDepth() {
  return queue.size;
}

const normScope = (s) => (s === "same-city" ? "same-state" : s);

// How long a narrow search waits before it widens. With a small pool, "my state"
// or "India" can strand someone for minutes even though people are searching, so
// a search relaxes one step at a time: my state -> India -> worldwide.
const WIDEN_TO_COUNTRY_MS = 30_000;
const WIDEN_TO_WORLD_MS = 60_000;

function effectiveScope(entry, now) {
  const scope = normScope(entry.locationScope);
  const waited = now - entry.joinedAt;
  if (scope === "worldwide") return scope;
  if (waited >= WIDEN_TO_WORLD_MS) return "worldwide";
  if (scope === "same-state" && waited >= WIDEN_TO_COUNTRY_MS) return "same-country";
  return scope;
}

// Does `other` satisfy what `owner` asked for? Each person's choice is a rule
// about the OTHER person, so two people match only if both are satisfied. If the
// other person's location isn't known (e.g. they chose worldwide and never set
// one) we give the benefit of the doubt rather than refuse: kynq is India-only,
// and refusing would strand people for something we can't check.
function satisfies(owner, other, scope) {
  if (scope === "worldwide") return true;
  if (scope === "same-country") {
    const mine = owner.location.country || "India", theirs = other.location.country || "India";
    return mine === theirs;
  }
  if (scope === "same-state") {
    if (!owner.location.state) return false;        // asked for "my state" but has none saved
    if (!other.location.state) return true;          // unknown: benefit of the doubt
    return owner.location.state === other.location.state;
  }
  return false;
}

export function locationCompatible(a, b, now = Date.now()) {
  return satisfies(a, b, effectiveScope(a, now)) && satisfies(b, a, effectiveScope(b, now));
}

// Gender preference (Master Spec v3 §5). HONESTY NOTE: gender is self-declared
// and cannot be verified, so this filters on what people SAY. Someone who has
// not declared a gender can never satisfy a preference (they still match
// everyone who has none).
function genderCompatible(a, b) {
  if (a.genderPref && b.gender !== a.genderPref) return false;
  if (b.genderPref && a.gender !== b.genderPref) return false;
  return true;
}

// "Koins are deducted only when the matching preference successfully results
// in a match." So the charge happens at the moment of pairing — and BEFORE the
// call is created, so nobody can join with 10 Koins, spend them while queued,
// and get the preference for free. Returns null when the pair can go ahead,
// or the scopedId whose preference could not be paid for (that pair is
// abandoned; anything already charged for it is refunded).
async function chargePreferences(a, b) {
  const price = ECONOMY.genderPreference.price;
  const chargeId = crypto.randomUUID();
  const paid = [];
  for (const e of [a, b]) {
    if (!isPaidGenderPreference(e.genderPref)) continue; // free preference: no debit, no pass
    // A live 5-minute pass covers this match — nothing to charge.
    // eslint-disable-next-line no-await-in-loop
    if (await activePassExpiry(e.scopedId)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await debit(e.scopedId, "gender_preference", price, { refId: chargeId, note: `gender preference — ${ECONOMY.genderPreference.passMs / 60000}-minute pass` });
      paid.push(e.scopedId);
    } catch (err) {
      for (const id of paid) await credit(id, "gender_preference_refund", { refId: chargeId, amount: price, note: "match didn't go ahead — refunded" }).catch(() => {}); // eslint-disable-line no-await-in-loop
      if (err instanceof InsufficientBalanceError) return { failed: e.scopedId, chargeId };
      throw err;
    }
  }
  return { failed: null, chargeId, paid };
}

function topicOverlapScore(a, b) {
  if (a.topics.length === 0 || b.topics.length === 0) return 0; // no filter = compatible, no bonus
  const overlap = a.topics.filter((t) => b.topics.includes(t)).length;
  return overlap;
}

// Synchronous — blockedPairs/recentPairs are pre-fetched ONCE per tick
// (see runMatchTick) instead of 2 DB round-trips per candidate pair, which
// was O(n²) round-trips/tick and the actual scaling bottleneck at more than
// a few dozen concurrent seekers. With those as plain Sets, this whole scan
// is pure in-memory work — a 1000-deep queue is ~1M cheap comparisons,
// comfortably under the 1s tick budget.
export function findMatchFor(entry, candidates, blockedPairs, recentPairs) {
  let best = null;
  let bestScore = -Infinity;
  const now = Date.now();
  for (const candidate of candidates) {
    if (candidate.scopedId === entry.scopedId) continue;
    if (!locationCompatible(entry, candidate, now)) continue;
    if (!genderCompatible(entry, candidate)) continue;
    const key = pairKey(entry.scopedId, candidate.scopedId);
    if (blockedPairs.has(key)) continue;
    const recent = recentPairs.has(key);
    if (recent && !(now - entry.joinedAt >= RECENT_RELAX_MS && now - candidate.joinedAt >= RECENT_RELAX_MS)) continue;

    // A recent partner only wins if nobody fresh is available.
    const score = topicOverlapScore(entry, candidate) - (recent ? 1000 : 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

// Why two people who are both waiting did NOT pair. Logged (rarely) when people
// have been stuck for a while, so "7 online but nobody connects" can be answered
// from the server log instead of guessed at.
let lastExplainAt = 0;
function explainStuck(waiting, blockedPairs, recentPairs, now) {
  if (waiting.length < 2 || now - lastExplainAt < 20_000) return;
  if (!waiting.some((e) => now - e.joinedAt >= 20_000)) return;
  lastExplainAt = now;
  const short = (id) => id.slice(-6);
  const lines = [];
  const list = waiting.slice(0, 8);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i], b = list[j];
      const key = pairKey(a.scopedId, b.scopedId);
      let why = "compatible (should pair next tick)";
      if (blockedPairs.has(key)) why = "blocked";
      else if (!locationCompatible(a, b, now)) why = `location (${a.locationScope} vs ${b.locationScope})`;
      else if (!genderCompatible(a, b)) why = `gender preference (${a.genderPref ?? "any"} vs ${b.genderPref ?? "any"})`;
      else if (recentPairs.has(key) && !(now - a.joinedAt >= RECENT_RELAX_MS && now - b.joinedAt >= RECENT_RELAX_MS)) why = "met recently (rematch after both wait 45s)";
      lines.push(`${short(a.scopedId)}<->${short(b.scopedId)}: ${why}`);
    }
  }
  console.log(`[kynqExtra] stuck queue (${waiting.length} waiting, longest ${Math.round((now - waiting[0].joinedAt) / 1000)}s): ${lines.join(" | ")}`);
}

// Exported for tests / manual triggering; the running server calls this on
// a timer via startMatchmaker().
export async function runMatchTick(io) {
  const waiting = [...queue.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  const matchedThisTick = new Set();

  // ONE pair of queries for the whole tick, not per candidate pair — see
  // blockedPairsAmong/recentlyMatchedPairsAmong for why this matters at scale.
  const waitingIds = waiting.map((e) => e.scopedId);
  const [blockedPairs, recentPairs] = await Promise.all([
    blockedPairsAmong(waitingIds),
    recentlyMatchedPairsAmong(waitingIds),
  ]);

  for (const entry of waiting) {
    if (matchedThisTick.has(entry.scopedId) || !queue.has(entry.scopedId)) continue;

    const candidates = waiting.filter(
      (c) => !matchedThisTick.has(c.scopedId) && queue.has(c.scopedId) && c.scopedId !== entry.scopedId
    );
    const match = findMatchFor(entry, candidates, blockedPairs, recentPairs);
    if (!match) {
      // Staging-only: nobody real is available yet — offer a clearly-labelled
      // demo account instead of leaving the tester staring at an empty queue.
      // See demo-accounts.js — inert unless explicitly enabled there.
      if (DEMO_MATCH_ENABLED && Date.now() - entry.joinedAt >= demoDelayMs(entry.scopedId)) {
        // eslint-disable-next-line no-await-in-loop
        const demo = await pickDemoMatch(entry.scopedId).catch((err) => { console.error("[kynqExtra] demo match failed:", err); return null; });
        if (demo) {
          matchedThisTick.add(entry.scopedId);
          queue.delete(entry.scopedId);
          console.log(`[kynqExtra] match:demo  scopedId=${entry.scopedId} demoId=${demo.id} waitedMs=${Date.now() - entry.joinedAt} nextDemoAfterMs=${noteDemoServed(entry.scopedId)}`);
          io.to(entry.socketId).emit("match:demo", demo);
        }
      }
      continue;
    }

    // Paid preference: charge now, before anything is committed.
    let charge = { failed: null, paid: [] };
    if (isPaidGenderPreference(entry.genderPref) || isPaidGenderPreference(match.genderPref)) {
      // eslint-disable-next-line no-await-in-loop
      charge = await chargePreferences(entry, match).catch((err) => { console.error("[kynqExtra] preference charge failed:", err); return { failed: "error", paid: [] }; });
      if (charge.failed) {
        // Can't pay any more → drop just their preference and let them keep
        // searching as a normal (free) match. The other person is untouched.
        const broke = queue.get(charge.failed);
        if (broke) { broke.genderPref = null; io.to(broke.socketId).emit("queue:preference-dropped", { reason: "insufficient" }); }
        continue;
      }
    }

    matchedThisTick.add(entry.scopedId);
    matchedThisTick.add(match.scopedId);
    queue.delete(entry.scopedId);
    queue.delete(match.scopedId);
    resetDemoBackoff(entry.scopedId);
    resetDemoBackoff(match.scopedId);

    let call;
    try {
      // eslint-disable-next-line no-await-in-loop
      call = await createCall(entry.scopedId, match.scopedId);
    } catch (err) {
      // Charged for a match that never happened → give it straight back.
      for (const id of charge.paid ?? []) await credit(id, "gender_preference_refund", { refId: charge.chargeId, amount: ECONOMY.genderPreference.price, note: "match didn't go ahead — refunded" }).catch(() => {}); // eslint-disable-line no-await-in-loop
      for (const id of charge.paid ?? []) await cancelPass(id, charge.chargeId).catch(() => {}); // eslint-disable-line no-await-in-loop
      console.error("[kynqExtra] createCall failed:", err);
      continue;
    }
    // The match is real → the pass they just paid for starts NOW.
    for (const id of charge.paid ?? []) {
      // eslint-disable-next-line no-await-in-loop
      const passExpiresAt = await startPass(id, charge.chargeId, call.startedAt ?? Date.now()).catch(() => 0);
      io.to((id === entry.scopedId ? entry : match).socketId).emit("wallet:updated", { spent: ECONOMY.genderPreference.price, reason: "gender_preference", passExpiresAt });
    }
    // Koins are earned by eligible chat TIME now (Master Spec v3 §2), not by
    // merely being matched. The meter runs once both sides report connected.
    startMeter(call.id, entry.scopedId, match.scopedId);

    const roomId = call.id;
    const socketA = io.sockets.sockets.get(entry.socketId);
    const socketB = io.sockets.sockets.get(match.socketId);
    socketA?.join(roomId);
    socketB?.join(roomId);
    if (socketA) { socketA.data.currentCallId = call.id; socketA.data.peerScopedId = match.scopedId; }
    if (socketB) { socketB.data.currentCallId = call.id; socketB.data.peerScopedId = entry.scopedId; }

    recordMatch(entry.location?.city, match.location?.city);
    console.log(`[kynqExtra] match:found  callId=${call.id} a=${entry.scopedId} b=${match.scopedId} waitedMsA=${Date.now() - entry.joinedAt} waitedMsB=${Date.now() - match.joinedAt} queueDepth=${queue.size}`);
    io.to(entry.socketId).emit("match:found", { callId: call.id, peerScopedId: match.scopedId, initiator: true });
    io.to(match.socketId).emit("match:found", { callId: call.id, peerScopedId: entry.scopedId, initiator: false });
  }

  explainStuck([...queue.values()].sort((a, b) => a.joinedAt - b.joinedAt), blockedPairs, recentPairs, Date.now());
}

export function startMatchmaker(io) {
  if (tickHandle) return;
  tickHandle = setInterval(() => {
    runMatchTick(io).catch((err) => console.error("[kynqExtra:matchmaker] tick error:", err));
  }, TICK_MS);
}

export function stopMatchmaker() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
}
