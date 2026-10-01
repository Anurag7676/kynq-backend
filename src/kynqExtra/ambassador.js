// Campus ambassador daily challenge + monthly goodies eligibility.
//
// Daily task: ECONOMY.ambassador.dailyQualifyingCalls calls AND
// dailyCallSeconds of call time, on a single day, with every qualifying call
// STARTING inside the windowStartHour–windowEndHour IST window (8–10 PM) —
// an approved ambassador who hits both earns a one-time Koin bonus for that
// day. "Time on the app" is real call time, not tab-open/session time — kynq
// has no such tracking today, and it would be trivial to fake (leave a tab
// open overnight). Call time is already server-timed and already anti-gamed
// (see chat-meter.js): only a call both people were genuinely connected to
// counts.
//
// A call only counts toward EITHER goal once it lasted at least
// minCallSecondsToQualify (3 minutes) AND started inside the daily window.
// Below either bar it counts toward neither the call count nor the time
// total — otherwise a string of instant "Next" taps right at the window edge
// could fake a day, or calls outside 8–10pm could count at all.
//
// Monthly goodies gate: separately from the daily streak, an ambassador is
// granted ECONOMY.ambassador.monthlyGrantKoins Koins once per calendar month
// and must spend all of it (anywhere in the app) within that same month to
// be eligible for that month's goodies — see monthlySpendProgress(). Which
// goodie tier they've earned on top of that gate comes from
// ambassador_goodie_tiers (admin-configurable, see goodieTiers()).
//
// Day boundary: plain UTC date slicing, same convention pulse.js already uses
// for "matches today" — not India-midnight-exact, but consistent with the
// rest of this folder rather than introducing a second day-boundary rule.
// The 8–10pm WINDOW check below is IST-exact regardless of server TZ (it's
// the actual product rule, unlike the day-boundary convention).
import mongoose from "mongoose";
import { credit, spentSince } from "./wallet.js";
import { ECONOMY } from "./economy.js";

const coll = (n) => mongoose.connection.collection(n);
const DAYS = "ambassador_days";
const MONTHS = "ambassador_months";
const TIERS = "ambassador_goodie_tiers";

let indexesReady = null;
export function ensureAmbassadorIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([
      coll(DAYS).createIndex({ _key: 1 }, { unique: true }),
      coll(DAYS).createIndex({ userId: 1, date: 1 }),
      coll(MONTHS).createIndex({ _key: 1 }, { unique: true }),
      coll(MONTHS).createIndex({ userId: 1, month: 1 }),
      coll(TIERS).createIndex({ requiredDays: 1 }),
      coll("users").createIndex({ isAmbassador: 1 }),
    ]).catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}

const dayKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
const monthKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 7);

// IST hour for a timestamp, independent of the server's own timezone.
function istHour(ts) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ECONOMY.ambassador.timezone, hour: "numeric", hour12: false }).formatToParts(ts);
  return Number(parts.find((p) => p.type === "hour")?.value ?? -1) % 24;
}

function isInDailyWindow(ts) {
  const h = istHour(ts);
  return h >= ECONOMY.ambassador.windowStartHour && h < ECONOMY.ambassador.windowEndHour;
}

// Registered by signaling.js, same pattern as chat-meter.js's onReward — pushes a
// live update to the ambassador's own client the moment they hit the day's goal.
let notify = () => {};
export function onGoalMet(fn) { notify = fn; }

/** Called once per ended call (both directions), from signaling.js right after endCall(). */
export async function recordCallForAmbassadors(call) {
  if (!call?.startedAt || !call?.endedAt) return;
  const durationSec = Math.round((call.endedAt - call.startedAt) / 1000);
  if (durationSec < ECONOMY.ambassador.minCallSecondsToQualify) return; // too short to count toward either goal
  if (!isInDailyWindow(call.startedAt)) return; // started outside the 8-10pm IST window
  await ensureAmbassadorIndexes();
  for (const userId of [call.participantA, call.participantB]) {
    if (!userId) continue;
    // eslint-disable-next-line no-await-in-loop
    await creditAmbassadorCall(userId, durationSec).catch((err) => console.error("[ambassador] failed to record call for", userId, ":", err.message));
  }
}

async function creditAmbassadorCall(userId, durationSec) {
  const user = await coll("users").findOne({ id: userId }, { projection: { isAmbassador: 1 } });
  if (!user?.isAmbassador) return; // the vast majority of calls — cheap early exit before any write

  const date = dayKey();
  const key = `${userId}:${date}`;
  const goal = ECONOMY.ambassador;
  const r = await coll(DAYS).findOneAndUpdate(
    { _key: key },
    { $inc: { calls: 1, callSeconds: durationSec }, $set: { userId, date, updatedAt: Date.now() }, $setOnInsert: { _key: key, createdAt: Date.now(), rewardedAt: null } },
    { upsert: true, returnDocument: "after" },
  );
  const doc = r?.value ?? r;
  if (!doc || doc.rewardedAt) return; // already rewarded today — never pay twice

  const goalMet = doc.calls >= goal.dailyQualifyingCalls && doc.callSeconds >= goal.dailyCallSeconds;
  if (!goalMet) return;

  // Claim the reward atomically: only the write that flips rewardedAt from null wins,
  // so two calls ending in the same instant for the same person can't double-pay.
  const claimed = await coll(DAYS).findOneAndUpdate(
    { _key: key, rewardedAt: null },
    { $set: { rewardedAt: Date.now(), rewardKoins: goal.dailyRewardKoins } },
    { returnDocument: "after" },
  );
  if (!(claimed?.value ?? claimed)) return; // someone else's concurrent write already claimed it

  const tx = await credit(userId, "ambassador_daily", { refId: date, amount: goal.dailyRewardKoins, note: "campus ambassador: today's goal" }).catch((err) => {
    console.error("[ambassador] Koin credit failed for", userId, ":", err.message);
    return null;
  });
  notify(userId, { earned: goal.dailyRewardKoins, calls: doc.calls, callSeconds: doc.callSeconds, date });
  console.log(`[ambassador] goal met  userId=${userId} date=${date} calls=${doc.calls} callSeconds=${doc.callSeconds} rewarded=${!!tx}`);
}

/** Today's progress for one ambassador — drives their own progress screen. */
export async function todayProgress(userId) {
  const date = dayKey();
  const doc = await coll(DAYS).findOne({ _key: `${userId}:${date}` });
  const goal = ECONOMY.ambassador;
  return {
    date,
    calls: doc?.calls ?? 0,
    callSeconds: doc?.callSeconds ?? 0,
    goalCalls: goal.dailyQualifyingCalls,
    goalCallSeconds: goal.dailyCallSeconds,
    minCallSecondsToQualify: goal.minCallSecondsToQualify,
    goalMet: !!doc?.rewardedAt,
    rewardKoins: doc?.rewardKoins ?? goal.dailyRewardKoins,
    windowStartHour: goal.windowStartHour,
    windowEndHour: goal.windowEndHour,
    inWindowNow: isInDailyWindow(Date.now()),
  };
}

/** This ambassador's day-by-day history, most recent first. */
export async function history(userId, limit = 30) {
  const rows = await coll(DAYS).find({ userId }).sort({ date: -1 }).limit(limit).toArray();
  return rows.map((d) => ({ date: d.date, calls: d.calls, callSeconds: d.callSeconds, goalMet: !!d.rewardedAt, rewardKoins: d.rewardKoins ?? 0 }));
}

export async function isAmbassador(userId) {
  const user = await coll("users").findOne({ id: userId }, { projection: { isAmbassador: 1 } });
  return !!user?.isAmbassador;
}

// ─── Monthly Koin grant + spend gate ───────────────────────────────────────

/** Grants this month's Koins once (idempotent via refId=month) — call lazily,
 * the first time anything asks for this ambassador's monthly progress. */
async function ensureMonthlyGrant(userId) {
  await ensureAmbassadorIndexes();
  const month = monthKey();
  const key = `${userId}:${month}`;
  const existing = await coll(MONTHS).findOne({ _key: key });
  if (existing) return existing;
  const grantedAt = Date.now();
  await coll(MONTHS).updateOne(
    { _key: key },
    { $setOnInsert: { _key: key, userId, month, grantedAt, grantAmount: ECONOMY.ambassador.monthlyGrantKoins } },
    { upsert: true },
  );
  await credit(userId, "ambassador_monthly_grant", { refId: month, amount: ECONOMY.ambassador.monthlyGrantKoins, note: "campus ambassador: monthly Koin grant" }).catch((err) => {
    console.error("[ambassador] monthly grant credit failed for", userId, ":", err.message);
  });
  return coll(MONTHS).findOne({ _key: key });
}

/** This month's grant + how much of it has been spent since the grant — the
 * gate an ambassador must clear (spend it all) to be goodies-eligible. Grants
 * lazily on first call (the ambassador's own dashboard load). */
export async function monthlySpendProgress(userId) {
  const grant = await ensureMonthlyGrant(userId);
  return monthlySpendFromGrant(userId, grant);
}

async function monthlySpendFromGrant(userId, grant) {
  const goal = ECONOMY.ambassador.monthlyGrantKoins;
  if (!grant) return { month: monthKey(), grantedAt: null, grantAmount: goal, spent: 0, spendGoal: goal, spendCleared: false };
  const spent = await spentSince(userId, grant.grantedAt);
  return { month: grant.month, grantedAt: grant.grantedAt, grantAmount: grant.grantAmount ?? goal, spent, spendGoal: goal, spendCleared: spent >= goal };
}

/** Read-only version for admin views — never grants. Shows "not granted yet"
 * until the ambassador has loaded their own dashboard at least once this month. */
export async function peekMonthlySpendProgress(userId) {
  await ensureAmbassadorIndexes();
  const grant = await coll(MONTHS).findOne({ _key: `${userId}:${monthKey()}` });
  return monthlySpendFromGrant(userId, grant);
}

/** Days the daily goal was met so far in the given month (default: current). */
export async function daysCompletedInMonth(userId, month = monthKey()) {
  return coll(DAYS).countDocuments({ userId, date: { $regex: `^${month}` }, rewardedAt: { $ne: null } });
}

// ─── Goodie tiers (admin-configurable) ─────────────────────────────────────

/** All tiers, ascending by days required. */
export async function goodieTiers() {
  return (await coll(TIERS).find({}).sort({ requiredDays: 1 }).toArray()).map(stripTier);
}

export async function createGoodieTier({ label, requiredDays }) {
  if (!label?.trim()) throw new Error("label is required");
  if (!Number.isFinite(requiredDays) || requiredDays < 1) throw new Error("requiredDays must be a positive number");
  const doc = { id: `tier_${Date.now()}_${Math.round(Math.random() * 1e6)}`, label: label.trim(), requiredDays: Math.round(requiredDays), createdAt: Date.now() };
  await coll(TIERS).insertOne(doc);
  return stripTier(doc);
}

export async function deleteGoodieTier(id) {
  const r = await coll(TIERS).deleteOne({ id });
  return r.deletedCount > 0;
}

function stripTier(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

function withTierStatus(spend, daysCompleted, tiers) {
  const withStatus = tiers.map((t) => ({ ...t, daysCompleted, unlocked: spend.spendCleared && daysCompleted >= t.requiredDays }));
  return { month: spend.month, spend, daysCompleted, tiers: withStatus, nextTier: withStatus.find((t) => !t.unlocked) ?? null };
}

/** This ambassador's full goodies picture for the current month: the spend
 * gate, days completed, and which tiers are unlocked/next. Grants the
 * monthly Koins lazily if this is the first call this month. */
export async function goodiesProgress(userId) {
  const [spend, daysCompleted, tiers] = await Promise.all([monthlySpendProgress(userId), daysCompletedInMonth(userId), goodieTiers()]);
  return withTierStatus(spend, daysCompleted, tiers);
}

/** Read-only version for admin views — never grants. */
export async function peekGoodiesProgress(userId) {
  const [spend, daysCompleted, tiers] = await Promise.all([peekMonthlySpendProgress(userId), daysCompletedInMonth(userId), goodieTiers()]);
  return withTierStatus(spend, daysCompleted, tiers);
}
