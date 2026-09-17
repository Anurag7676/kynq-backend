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

const TICK_MS = 1000;

// scopedId -> { scopedId, socketId, topics, locationScope, location, joinedAt }
const queue = new Map();
let tickHandle = null;

export function joinQueue({ scopedId, socketId, topics, locationScope, location }) {
  queue.set(scopedId, {
    scopedId,
    socketId,
    topics: topics ?? [],
    locationScope: locationScope ?? "worldwide",
    location: location ?? {}, // { city, state, country } — best-effort, from client/IP
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
    if (!match) continue;

    matchedThisTick.add(entry.scopedId);
    matchedThisTick.add(match.scopedId);
    queue.delete(entry.scopedId);
    queue.delete(match.scopedId);

    // eslint-disable-next-line no-await-in-loop
    const call = await createCall(entry.scopedId, match.scopedId);

    const roomId = call.id;
    const socketA = io.sockets.sockets.get(entry.socketId);
    const socketB = io.sockets.sockets.get(match.socketId);
    socketA?.join(roomId);
    socketB?.join(roomId);
    if (socketA) { socketA.data.currentCallId = call.id; socketA.data.peerScopedId = match.scopedId; }
    if (socketB) { socketB.data.currentCallId = call.id; socketB.data.peerScopedId = entry.scopedId; }

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
