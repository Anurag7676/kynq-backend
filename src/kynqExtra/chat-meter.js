// Eligible chat time → Koins. (Master Spec v3 §2)
//
// The rules, and how each is enforced:
//  • "Chat time must be verified by the server" — only THIS process's clock is
//    used. A client can claim to be connected, but it can never claim more
//    seconds than really elapsed while both sockets were in the call.
//  • "Queue time does not count" — a meter only exists for a matched call, and
//    only runs once BOTH participants report their media connected.
//  • "Disconnected time does not count" — two layers. The meter pauses the
//    instant either SOCKET drops (the reconnect grace period is not rewarded).
//    And because a socket can stay up while the video link itself dies, each
//    client heartbeats only while its WebRTC connection is genuinely
//    "connected"; time is counted only while BOTH heartbeats are fresh, and
//    never more than heartbeatStaleMs past the last one.
//  • "Minutes carry over between matches" — seconds accumulate in one
//    cumulative per-user counter, so a 6 min call + a 4 min call = one reward.
//  • "Each milestone credited only once" — milestone k is credited with the
//    ledger key chat_minutes:<user>:<k>. The wallet's unique index makes that
//    exactly-once even if two flushes race or the server crashes mid-way.
//  • "First-chat bonus only once" — ledger key first_chat:<user>. This is the
//    SAME key the old rule used, so anyone already paid is never paid again.
//
// Meters are in memory; time is flushed to Mongo every FLUSH_MS, so a restart
// loses at most that much unpaid time and long calls pay out while they run.

import mongoose from "mongoose";
import { credit } from "./wallet.js";
import { ECONOMY } from "./economy.js";
import { qualifyReferralIfDue } from "./referrals.js";

const TIME = "chat_time";
const PAIR = "chat_pair_day";
const FLUSH_MS = 30_000;
const coll = (n) => mongoose.connection.collection(n);

// callId -> { a, b, beats: Map<userId, lastBeatMs>, runningSince: number|null }
const meters = new Map();
let notify = () => {};
let timer = null;

/** signaling registers a push so the UI can show "+10 Koins" live. */
export function onReward(fn) { notify = fn; }

export function startMeter(callId, a, b) {
  if (!meters.has(callId)) meters.set(callId, { a, b, beats: new Map(), runningSince: null });
  if (!timer) { timer = setInterval(() => { for (const id of meters.keys()) flush(id).catch(logErr); }, FLUSH_MS); timer.unref?.(); }
}

const staleMs = () => ECONOMY.chat.heartbeatStaleMs;
const fresh = (m, now) => now - (m.beats.get(m.a) ?? 0) <= staleMs() && now - (m.beats.get(m.b) ?? 0) <= staleMs();

/** Heartbeat: this participant's WebRTC media is up right now. Idempotent. */
export function markConnected(callId, userId) {
  const m = meters.get(callId);
  if (!m || (userId !== m.a && userId !== m.b)) return;
  const now = Date.now();
  m.beats.set(userId, now);
  if (m.runningSince == null && fresh(m, now)) m.runningSince = now;
}

/** A socket dropped: bank what's earned, stop the clock, require re-connect. */
export async function pauseMeter(callId) {
  const m = meters.get(callId);
  if (!m) return;
  await flush(callId);
  m.runningSince = null;
  m.beats.clear();
}

export async function endMeter(callId) {
  if (!meters.has(callId)) return;
  await flush(callId);
  meters.delete(callId);
}

async function flush(callId) {
  const m = meters.get(callId);
  if (!m || m.runningSince == null) return;
  const now = Date.now();
  // Never count past the point either side's media was last confirmed.
  const staleAt = Math.min(m.beats.get(m.a) ?? 0, m.beats.get(m.b) ?? 0) + staleMs();
  const end = Math.min(now, staleAt);
  const secs = Math.floor((end - m.runningSince) / 1000);
  if (now > staleAt) { m.runningSince = null; if (secs <= 0) return; } // stopped until both beat again
  else if (secs <= 0) return;
  // Advance BEFORE awaiting: JS is single-threaded, so read→compute→advance is
  // atomic. A concurrent flush (timer vs. call end) then sees ~0s, never the
  // same interval twice.
  if (m.runningSince != null) m.runningSince += secs * 1000;

  let rewarded = secs;
  const cap = ECONOMY.chat.perPairDailyRewardedSecondsCap;
  if (cap != null) rewarded = await applyPairCap(m.a, m.b, secs, cap);
  if (rewarded <= 0) return;
  await Promise.all([accrue(m.a, rewarded, m.b), accrue(m.b, rewarded, m.a)]);
}

async function applyPairCap(a, b, secs, cap) {
  await ensureChatMeterIndexes();
  const key = `${new Date().toISOString().slice(0, 10)}:${[a, b].sort().join("|")}`;
  const r = await coll(PAIR).findOneAndUpdate({ _key: key }, { $inc: { seconds: secs } }, { upsert: true, returnDocument: "after" });
  const total = (r?.value ?? r)?.seconds ?? secs;
  const before = total - secs;
  return Math.max(0, Math.min(secs, cap - before));
}

async function accrue(userId, secs, partnerId) {
  await ensureChatMeterIndexes();
  const r = await coll(TIME).findOneAndUpdate(
    { _key: userId },
    { $inc: { eligibleSeconds: secs }, $set: { updatedAt: Date.now() }, $setOnInsert: { userId, paidThrough: 0 } },
    { upsert: true, returnDocument: "after" },
  );
  const doc = r?.value ?? r;
  if (!doc) return;

  const { blockSeconds, rewardPerBlock } = ECONOMY.chat;
  const reached = Math.floor(doc.eligibleSeconds / blockSeconds);
  const paid = doc.paidThrough ?? 0;
  let earned = 0;
  for (let k = paid + 1; k <= reached; k += 1) {
    const tx = await credit(userId, "chat_minutes", { refId: String(k), amount: rewardPerBlock, note: `${(blockSeconds / 60) * k} minutes of chat` });
    if (!tx.duplicate) earned += rewardPerBlock;
    if (k === 1) {
      const bonus = await credit(userId, "first_chat"); // idempotent: once ever
      if (!bonus.duplicate) earned += ECONOMY.chat.firstChatBonus;
    }
  }
  if (reached > paid) await coll(TIME).updateOne({ _key: userId, paidThrough: { $lt: reached } }, { $set: { paidThrough: reached } });

  // Referral: pays the referrer once this user has a full block of chat that
  // was NOT with the referrer (two friends can't farm it off each other).
  const paidOut = await qualifyReferralIfDue(userId, partnerId, secs, doc.eligibleSeconds).catch((e) => { logErr(e); return null; });
  if (paidOut) notify(paidOut.referrerId, { earned: paidOut.amount, reason: "referral" });

  if (earned > 0) notify(userId, { earned, eligibleSeconds: doc.eligibleSeconds });
}

export async function getChatProgress(userId) {
  const doc = await coll(TIME).findOne({ _key: userId });
  const total = doc?.eligibleSeconds ?? 0;
  const { blockSeconds, rewardPerBlock } = ECONOMY.chat;
  return { eligibleSeconds: total, blockSeconds, rewardPerBlock, secondsToNextReward: blockSeconds - (total % blockSeconds) };
}

// The $inc-upsert below is only race-safe if the unique index already exists:
// without it, two concurrent first-writes can create TWO counter docs for one
// user and split their minutes. So it's awaited (once) before any write, not
// just fired at boot when Mongo may not be connected yet.
let indexesReady = null;
export function ensureChatMeterIndexes() {
  indexesReady ??= Promise.all([
    coll(TIME).createIndex({ _key: 1 }, { unique: true }),
    coll(PAIR).createIndex({ _key: 1 }, { unique: true }),
  ]).catch((err) => { indexesReady = null; throw err; });
  return indexesReady;
}

function logErr(err) { console.error("[kynqExtra] chat-meter:", err?.message ?? err); }
