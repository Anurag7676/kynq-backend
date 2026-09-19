// Gender-preference pass. (Master Spec v3 §5, as clarified by the product owner)
//
// Pricing model: 10 Koins buys a 5-MINUTE PASS. While it is live, every
// preference match is free.
//
// The spec also says: "Koins are deducted only when the matching preference
// successfully results in a match." A pass charged the moment you switch the
// preference on would break that — you could search for five minutes, match
// nobody, and still have paid. So the two rules are combined like this:
//
//   • Turning the preference on costs nothing.
//   • The pass is CHARGED at your first successful preference match, and its
//     5 minutes run FROM THAT MOMENT.
//   • Any further preference match inside the window is free.
//   • When it lapses, the next successful preference match starts (and
//     charges for) a new pass.
//
// So you never pay for a preference that found you no one.
//
// The pass is persisted: a server restart must not make someone pay twice
// inside a window they already bought.

import { collection } from "../gift/store.js";
import { ECONOMY } from "./economy.js";

const passes = collection("gender_passes"); // _key: userId → { userId, expiresAt, startedAt, chargeId }

/** ms-epoch expiry of the user's live pass, or 0 if none. */
export async function activePassExpiry(userId) {
  const p = await passes.get(userId);
  return p && p.expiresAt > Date.now() ? p.expiresAt : 0;
}

/** Start a pass at `startedAt` (the moment of the paid match). */
export async function startPass(userId, chargeId, startedAt = Date.now()) {
  const expiresAt = startedAt + ECONOMY.genderPreference.passMs;
  await passes.set(userId, { userId, startedAt, expiresAt, chargeId });
  return expiresAt;
}

/** Undo a pass whose paid match never actually happened (call creation failed). */
export async function cancelPass(userId, chargeId) {
  const p = await passes.get(userId);
  if (p && p.chargeId === chargeId) await passes.delete(userId);
}
