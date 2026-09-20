// Game-win Koins. (Product owner, 2026-09-21 — reverses Master Spec v3's
// "no game-win reward": every game pays the winner a flat amount; playing
// without winning pays nothing.)
//
// Free games make this the easiest reward in the app to farm — two accounts
// can play Tic Tac Toe against each other all day. Two server-side rules
// bound it, both atomic so parallel sockets can't slip past:
//
//   1. ONCE PER OPPONENT PER DAY. The ledger key is
//      game_win:<user>:<day>:<opponent>, and the ledger's unique index makes a
//      second credit a no-op. Beating the same person again pays nothing.
//   2. DAILY CAP. At most ECONOMY.games.win.maxRewardedPerDay paid wins a day,
//      claimed with a guarded $inc on game_win_day (count < cap).
//
// So the ceiling is cap × reward per day (5 × 5 = 25), and reaching it needs
// that many DIFFERENT opponents.
//
// "Win" = the engine named a winner for that move: the game for Tic Tac Toe,
// the round for round-based games (RPS, quiz, guess-the-word). Rule 1 means a
// long run of rounds against one person still pays once.

import mongoose from "mongoose";
import { credit } from "./wallet.js";
import { ECONOMY } from "./economy.js";

const DAY = "game_win_day";
const coll = (n) => mongoose.connection.collection(n);
// Days roll over at midnight IST — the audience is in India.
const dayOf = (ms = Date.now()) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);

let indexed = null;
function ensureIndexes() {
  indexed ??= coll(DAY).createIndex({ _key: 1 }, { unique: true }).catch((e) => { indexed = null; throw e; });
  return indexed;
}

/**
 * Pay the winner if the rules allow. Never throws into the game flow.
 * @returns {Promise<{ paid: number, reason?: "cap"|"repeat"|"off"|"error" }>}
 */
export async function rewardGameWin(winnerId, opponentId, gameType) {
  const cfg = ECONOMY.games.win;
  if (!cfg || cfg.reward <= 0) return { paid: 0, reason: "off" };
  if (!winnerId || !opponentId || winnerId === opponentId) return { paid: 0, reason: "off" };
  try {
    await ensureIndexes();
    const day = dayOf();
    const key = `${winnerId}:${day}`;

    // Claim a slot under the cap. The filter makes the increment conditional,
    // so two wins landing together can't both take the last slot.
    await coll(DAY).updateOne({ _key: key }, { $setOnInsert: { _key: key, userId: winnerId, day, count: 0 } }, { upsert: true }).catch((e) => { if (e?.code !== 11000) throw e; });
    const claimed = await coll(DAY).updateOne({ _key: key, count: { $lt: cfg.maxRewardedPerDay } }, { $inc: { count: 1 } });
    if (!claimed.modifiedCount) return { paid: 0, reason: "cap" };

    const res = await credit(winnerId, "game_win", { refId: `${day}:${opponentId}`, amount: cfg.reward, note: `won a game (${gameType})` });
    if (res?.duplicate) {
      // Already paid for beating this person today — hand the slot back.
      await coll(DAY).updateOne({ _key: key, count: { $gt: 0 } }, { $inc: { count: -1 } });
      return { paid: 0, reason: "repeat" };
    }
    return { paid: cfg.reward };
  } catch (err) {
    console.error("[kynq-extra] game win reward failed:", err.message);
    return { paid: 0, reason: "error" };
  }
}
