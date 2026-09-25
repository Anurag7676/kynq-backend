// KYNQ Extra economy — EVERY tunable number lives here (Master Spec v3).
// Change a price or a reward in this file; no logic elsewhere hardcodes one.
//
// Items marked PROPOSED are places where the spec was silent, cut off or
// ambiguous; the value is the most literal sensible reading. They are product
// decisions, not engineering ones — edit freely.

export const ECONOMY = {
  chat: {
    blockSeconds: 10 * 60,     // "every 10 eligible chat minutes"
    rewardPerBlock: 10,        // "+10 Koins"
    firstChatBonus: 20,        // "+20 Koins after first 10 eligible minutes", once ever
    // DECIDED by the product owner (2026-09-20). Spec §2 says "no daily cap" —
    // and there still is none on what a USER can earn. This only stops the
    // SAME TWO PEOPLE being rewarded after 30 minutes together per day, which
    // shuts down two idle accounts farming each other around the clock. Real
    // users meeting different people never reach it. null = disabled.
    perPairDailyRewardedSecondsCap: 30 * 60,
    // Clients heartbeat ~every 5s while their video link is "connected". If
    // either side misses this long, the clock stops ("disconnected time does
    // not count") until both are beating again.
    heartbeatStaleMs: 15_000,
  },

  referral: {
    reward: 100,               // to the referrer, once per qualifying referral
    maxAttachPerReferrerPerDay: 20, // anti-farm throttle (PROPOSED)
  },

  games: {
    // Winning pays; playing doesn't. DECIDED by the product owner 2026-09-21
    // (reverses v3's "no game-win reward"). Anti-farming limits live in
    // game-rewards.js: once per opponent per day, and this daily cap.
    win: { reward: 5, maxRewardedPerDay: 5 },
    // CONFIRMED by the product owner (2026-09-20). The spec's list was cut
    // off after the first two; these prices were proposed and then approved.
    // 0 = free (starts instantly, no invitation). >0 = paid: the starter pays,
    // the other player accepts/declines and plays free. (The spec mentions 8
    // games; 7 exist — an 8th has not been specified.)
    prices: {
      "tic-tac-toe": 0,
      "rock-paper-scissors": 0,
      "this-or-that": 0,
      "would-you-rather": 5,
      "quick-quiz": 5,
      "guess-the-word": 5,
      "truth-or-dare": 10,
    },
    inviteTtlMs: 30_000,
  },

  genderPreference: {
    // DECIDED by the product owner (2026-09-20): "N Koins per 5 MIN" is a
    // 5-MINUTE PASS. Charged at the first successful preference match (spec:
    // "deducted only when the matching preference successfully results in a
    // match"), runs 5 minutes from then; further preference matches inside the
    // window are free. See gender-pass.js.
    price: 100, // raised from 10 on 2026-09-24 (product owner)
    passMs: 5 * 60 * 1000,
    // Only these preferences are charged. Male / Other / Anyone are free:
    // never debited, never need a pass, never refunded.
    paidPreferences: ["female"],
  },

  filters: {
    price: 10,                          // per premium filter
    unlockMs: 24 * 60 * 60 * 1000,      // "unlocked for 24 hours from purchase"
    // CONFIRMED by the product owner (2026-09-20): every lens is premium
    // except Heart shades and Halo. Colour filters and Beauty stay free.
    premiumLenses: ["puppy", "kitty", "bunny", "crown", "flowers", "butterflies", "blush", "devil", "robot", "vampire", "bighead"],
  },
};

export const gamePrice = (gameType) => ECONOMY.games.prices[gameType] ?? 0;
export const isPremiumLens = (lensId) => ECONOMY.filters.premiumLenses.includes(lensId);

// True when a gender preference value costs Koins (currently only "female").
export function isPaidGenderPreference(pref) {
  return !!pref && ECONOMY.genderPreference.paidPreferences.includes(pref);
}
