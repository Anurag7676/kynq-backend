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
import { isBlockedEitherWay } from "./blocks.js";
import { createCall, wasRecentlyMatched } from "./calls-store.js";
import { recordMatch } from "./pulse.js";
import crypto from "crypto";
import { startMeter } from "./chat-meter.js";
import { debit, credit, InsufficientBalanceError } from "./wallet.js";
import { ECONOMY } from "./economy.js";
import { activePassExpiry, startPass, cancelPass } from "./gender-pass.js";
import { DEMO_MATCH_ENABLED, DEMO_FALLBACK_MS, pickDemoMatch } from "./demo-accounts.js";

const TICK_MS = 1000;

// scopedId -> { scopedId, socketId, topics, locationScope, location, joinedAt }
const queue = new Map();
let tickHandle = null;

export function joinQueue({ scopedId, socketId, topics, locationScope, location, gender, genderPref }) {
  queue.set(scopedId, {
    scopedId,
    socketId,
    topics: topics ?? [],
    locationScope: locationScope ?? "worldwide",
    location: location ?? {}, // { city, state, country } — best-effort, from client/IP
    gender: gender ?? null,         // from the saved profile (server-side)
    genderPref: genderPref ?? null, // paid extra; null = anyone
    joinedAt: Date.now(),
  });
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

function locationCompatible(a, b) {
  if (a.locationScope === "worldwide" || b.locationScope === "worldwide") return true;
  // Both must agree on the scope AND the corresponding location field to
  // avoid a same-city seeker being matched against a same-country seeker
  // who happens to share a country but not a city.
  const scope = a.locationScope === b.locationScope ? a.locationScope : null;
  if (!scope) return false;
  if (scope === "same-city") return !!a.location.city && a.location.city === b.location.city;
  if (scope === "same-state") return !!a.location.state && a.location.state === b.location.state;
  if (scope === "same-country") return !!a.location.country && a.location.country === b.location.country;
  return false;
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
    if (!e.genderPref) continue;
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

async function findMatchFor(entry, candidates) {
  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (candidate.scopedId === entry.scopedId) continue;
    if (!locationCompatible(entry, candidate)) continue;
    if (!genderCompatible(entry, candidate)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await isBlockedEitherWay(entry.scopedId, candidate.scopedId)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await wasRecentlyMatched(entry.scopedId, candidate.scopedId)) continue;

    const score = topicOverlapScore(entry, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

// Exported for tests / manual triggering; the running server calls this on
// a timer via startMatchmaker().
export async function runMatchTick(io) {
  const waiting = [...queue.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  const matchedThisTick = new Set();

  for (const entry of waiting) {
    if (matchedThisTick.has(entry.scopedId) || !queue.has(entry.scopedId)) continue;

    const candidates = waiting.filter(
      (c) => !matchedThisTick.has(c.scopedId) && queue.has(c.scopedId) && c.scopedId !== entry.scopedId
    );
    // eslint-disable-next-line no-await-in-loop
    const match = await findMatchFor(entry, candidates);
    if (!match) {
      // Staging-only: nobody real is available yet — offer a clearly-labelled
      // demo account instead of leaving the tester staring at an empty queue.
      // See demo-accounts.js — inert unless explicitly enabled there.
      if (DEMO_MATCH_ENABLED && Date.now() - entry.joinedAt >= DEMO_FALLBACK_MS) {
        // eslint-disable-next-line no-await-in-loop
        const demo = await pickDemoMatch().catch((err) => { console.error("[kynqExtra] demo match failed:", err); return null; });
        if (demo) {
          matchedThisTick.add(entry.scopedId);
          queue.delete(entry.scopedId);
          console.log(`[kynqExtra] match:demo  scopedId=${entry.scopedId} demoId=${demo.id} waitedMs=${Date.now() - entry.joinedAt}`);
          io.to(entry.socketId).emit("match:demo", demo);
        }
      }
      continue;
    }

    // Paid preference: charge now, before anything is committed.
    let charge = { failed: null, paid: [] };
    if (entry.genderPref || match.genderPref) {
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
