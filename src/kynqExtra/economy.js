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
    // Spec §2: "no daily cap on recurring chat rewards" — so this is OFF.
    // It exists as a lever: set to a number of seconds (e.g. 30 * 60) to stop
    // rewarding the SAME two people after that much chat per day. It never
    // limits how much one user can earn overall. null = disabled.
    perPairDailyRewardedSecondsCap: null,
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
    // Spec §3 lists Tic Tac Toe and Rock Paper Scissors as "Free — proposed".
    // The rest of the list was cut off in the spec, so everything below the
    // first two is PROPOSED. 0 = free (starts instantly, no invitation).
    // >0 = paid: starter pays, the other player accepts/declines and plays free.
    prices: {
      "tic-tac-toe": 0,
      "rock-paper-scissors": 0,
      "this-or-that": 0,       // PROPOSED (the unpriced fragment in the spec)
      "would-you-rather": 5,   // PROPOSED
      "quick-quiz": 5,         // PROPOSED
      "guess-the-word": 5,     // PROPOSED
      "truth-or-dare": 10,     // PROPOSED
    },
    inviteTtlMs: 30_000,
  },

  genderPreference: {
    // Spec §5: "10 Koins per 5 MIN match … deducted only when the matching
    // preference successfully results in a match." Read as: 10 Koins charged
    // once per successful preference match (PROPOSED reading of "5 MIN").
    pricePerMatch: 10,
  },

  filters: {
    price: 10,                          // per premium filter
    unlockMs: 24 * 60 * 60 * 1000,      // "unlocked for 24 hours from purchase"
    // Which lenses are premium is not in the spec (PROPOSED). Everything not
    // listed — colour filters, Beauty, and the other lenses — stays free.
    premiumLenses: ["puppy", "kitty", "bunny", "crown", "flowers", "butterflies", "blush"],
  },
};

export const gamePrice = (gameType) => ECONOMY.games.prices[gameType] ?? 0;
export const isPremiumLens = (lensId) => ECONOMY.filters.premiumLenses.includes(lensId);
