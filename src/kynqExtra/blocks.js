// User-to-user blocks for Kynq Extra — respected by the matchmaker (a
// blocked pair is never matched again in either direction) and checked
// before letting a socket rejoin a room with someone who blocked them.
import mongoose from "mongoose";
import { collection, makeId } from "../gift/store.js";

const BLOCKS_COLLECTION = "blocks";
const blocks = collection(BLOCKS_COLLECTION);

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

// blockerScopedId/blockedScopedId aren't indexed by the generic _key store —
// blockedPairsAmong() below needs to $in-query both fields directly, so
// they need their own indexes, same pattern as wallet.js/chat-meter.js.
let indexesReady = null;
export function ensureBlockIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([
      mongoose.connection.collection(BLOCKS_COLLECTION).createIndex({ blockerScopedId: 1 }),
      mongoose.connection.collection(BLOCKS_COLLECTION).createIndex({ blockedScopedId: 1 }),
    ]).catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}

export async function blockUser(blockerScopedId, blockedScopedId) {
  if (blockerScopedId === blockedScopedId) return;
  const key = `${blockerScopedId}>${blockedScopedId}`;
  await blocks.set(key, {
    id: makeId("blk"),
    blockerScopedId,
    blockedScopedId,
    createdAt: Date.now(),
  });
}

export async function unblockUser(blockerScopedId, blockedScopedId) {
  await blocks.delete(`${blockerScopedId}>${blockedScopedId}`);
}

// Blocks are directional in storage but checked bidirectionally — if
// either side blocked the other, they should never be matched again.
export async function isBlockedEitherWay(scopedIdA, scopedIdB) {
  const [forward, reverse] = await Promise.all([
    blocks.get(`${scopedIdA}>${scopedIdB}`),
    blocks.get(`${scopedIdB}>${scopedIdA}`),
  ]);
  return !!(forward || reverse);
}

export async function listBlockedBy(scopedId) {
  const all = await blocks.find((b) => b.blockerScopedId === scopedId);
  return all.map((b) => b.blockedScopedId);
}

// Batch version of isBlockedEitherWay for the matchmaker: ONE query for the
// whole waiting queue instead of 2 Mongo round-trips per candidate PAIR
// (which was O(n²) round-trips per tick — the actual scaling bottleneck,
// not raw JS compute). Returns a Set of "a|b" pairKeys (sorted) where
// either side blocked the other, restricted to blocks involving at least
// one of the given scopedIds.
export async function blockedPairsAmong(scopedIds) {
  if (!scopedIds.length) return new Set();
  const docs = await mongoose.connection.collection(BLOCKS_COLLECTION)
    .find({ $or: [{ blockerScopedId: { $in: scopedIds } }, { blockedScopedId: { $in: scopedIds } }] })
    .project({ blockerScopedId: 1, blockedScopedId: 1 })
    .toArray()
    .catch((err) => { console.error("[kynqExtra] blockedPairsAmong query failed:", err.message); return []; });
  return new Set(docs.map((b) => pairKey(b.blockerScopedId, b.blockedScopedId)));
}

export { pairKey };
