// Premium face filters. (Master Spec v3 §6)
//
//  • Basic filters are free; premium ones cost ECONOMY.filters.price Koins.
//  • A purchase unlocks that one filter for 24h "from the time of purchase",
//    usable across any number of chats; switching between unlocked filters is
//    free; after 24h it must be bought again.
//  • Previewing is free and is done client-side, to the user's own screen only.
//
// Charging exactly once:
//   The debit key is filter_unlock:<user>:<lens>:<n>, where n is how many
//   times this user has bought this lens before. Two concurrent requests (a
//   double-click, a retry) read the same n, so they share a key and the
//   wallet's unique index lets only one of them charge.
//   If the process dies AFTER charging but BEFORE recording the unlock, n has
//   not advanced — the next attempt reuses the same key, the wallet reports it
//   as already paid (no second charge), and the unlock is written then, timed
//   from the ORIGINAL purchase. So a crash can never cost the user Koins for
//   nothing, and can never grant more than 24h.
//
// "If a filter fails to activate, no Koins should be deducted": the client
// only offers Unlock once face tracking has actually loaded, so a filter that
// cannot run is never sold. There is deliberately NO client-triggered refund —
// "unlock, use it, claim it failed" would be free filters for everyone.
//
// Honest limitation: filters render in the user's own browser, so this gate is
// enforced by the UI, not cryptographically. A determined user could bypass it
// locally. For a cosmetic that's an acceptable trade; the ledger stays correct.

import { collection } from "../gift/store.js";
import { debit, InsufficientBalanceError } from "./wallet.js";
import { ECONOMY, isPremiumLens } from "./economy.js";

const unlocks = collection("filter_unlocks"); // _key: `${userId}:${lensId}`

export class FilterError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export { InsufficientBalanceError };

export function filterCatalog() {
  const { price, unlockMs, premiumLenses } = ECONOMY.filters;
  return { price, unlockHours: unlockMs / 3_600_000, premium: premiumLenses };
}

/** { lensId: expiresAt } for unlocks that are still live. */
export async function activeUnlocks(userId) {
  const now = Date.now();
  const mine = await unlocks.find((u) => u.userId === userId && u.expiresAt > now);
  return Object.fromEntries(mine.map((u) => [u.lensId, u.expiresAt]));
}

export async function unlockFilter(userId, lensId) {
  if (!isPremiumLens(lensId)) throw new FilterError("That filter is free — no unlock needed");
  const key = `${userId}:${lensId}`;
  const now = Date.now();
  const existing = await unlocks.get(key);
  if (existing && existing.expiresAt > now) return { lensId, expiresAt: existing.expiresAt, charged: 0, alreadyUnlocked: true };

  const n = existing?.purchases ?? 0;
  const { price, unlockMs } = ECONOMY.filters;
  // Throws InsufficientBalanceError without moving any Koins.
  const tx = await debit(userId, "filter_unlock", price, { refId: `${lensId}:${n}`, note: `unlocked the ${lensId} filter for ${unlockMs / 3_600_000}h` });

  const expiresAt = tx.createdAt + unlockMs; // 24h from the PURCHASE, even on a recovered retry
  if (expiresAt <= now) {
    // A recovered charge whose 24h has already lapsed: count it as used and
    // start a fresh purchase rather than handing back an expired unlock.
    await unlocks.set(key, { userId, lensId, expiresAt, purchases: n + 1, lastTxId: tx.id, updatedAt: now });
    return unlockFilter(userId, lensId);
  }
  await unlocks.set(key, { userId, lensId, expiresAt, purchases: n + 1, lastTxId: tx.id, updatedAt: now });
  return { lensId, expiresAt, charged: tx.duplicate ? 0 : price, alreadyUnlocked: false };
}
