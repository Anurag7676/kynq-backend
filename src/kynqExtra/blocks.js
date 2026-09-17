// User-to-user blocks for Kynq Extra — respected by the matchmaker (a
// blocked pair is never matched again in either direction) and checked
// before letting a socket rejoin a room with someone who blocked them.
import { collection, makeId } from "../gift/store.js";

const blocks = collection("blocks");

function pairKey(a, b) {
  return [a, b].sort().join("|");
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

export { pairKey };
