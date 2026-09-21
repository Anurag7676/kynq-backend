// The account dashboard's numbers, aggregated from the FULL ledger — the wallet
// endpoint only returns the latest 50 transactions, which would make any
// "last 30 days" total wrong. Everything here is read-only.

import mongoose from "mongoose";
import { getBalance } from "./wallet.js";
import { listCallsForUser } from "./calls-store.js";
import { countFriends } from "./friends.js";

const coll = (n) => mongoose.connection.collection(n);
const DAY_MS = 86_400_000;
const IST = 5.5 * 3_600_000; // days roll over at midnight IST, like the win cap
const dayKey = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const startOfDay = (ms) => Math.floor((ms + IST) / DAY_MS) * DAY_MS - IST;

// What each ledger type means to a person.
// Two are RETIRED reward types (the daily-activity and 7-day-streak payouts were
// removed); the ledger still holds them and they were real Koins, so they count.
const EARN = { chat_minutes: "Chatting", first_chat: "First chat bonus", referral: "Invites", game_win: "Game wins", daily_activity: "Daily bonus (retired)", challenge_streak: "Challenge streak (retired)" };
const SPEND = { game_fee: "Games", filter_unlock: "Lenses & filters", gender_preference: "Match preference", gift_purchase: "Gifts" };
const REFUND = new Set(["coin_refund", "game_refund", "gender_preference_refund"]);

/**
 * Every ledger row lands in exactly one group, so the dashboard's totals always
 * reconcile with the ledger. Unrecognised types are not dropped: money in goes
 * to earned/"Other", money out to spent/"Other".
 */
function classify(r) {
  if (EARN[r.type]) return { group: "earn", key: r.type, label: EARN[r.type] };
  if (SPEND[r.type]) return { group: "spend", key: r.type, label: SPEND[r.type] };
  if (r.type === "coin_purchase") return { group: "buy", key: r.type, label: "Bought" };
  if (REFUND.has(r.type)) return { group: "refund", key: r.type, label: "Refund" };
  return r.amount > 0 ? { group: "earn", key: "other", label: "Other" } : { group: "spend", key: "other", label: "Other" };
}
const total = (rows, group) => rows.filter((r) => classify(r).group === group).reduce((n, r) => n + Math.abs(r.amount), 0);
function breakdown(rows, group) {
  const m = new Map();
  for (const r of rows) { const c = classify(r); if (c.group !== group) continue; const e = m.get(c.key) ?? { type: c.key, label: c.label, amount: 0 }; e.amount += Math.abs(r.amount); m.set(c.key, e); }
  return [...m.values()].filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
}

export async function activitySummary(userId, days) {
  const now = Date.now();
  const from = startOfDay(now) - (days - 1) * DAY_MS;        // first day of the range
  const prevFrom = from - days * DAY_MS;                      // the equal period before it
  const rows = await coll("wallet_transactions").find({ userId, createdAt: { $gte: prevFrom } }).sort({ createdAt: -1 }).toArray();
  const cur = rows.filter((r) => r.createdAt >= from);
  const prev = rows.filter((r) => r.createdAt < from);

  // Daily series, zero-filled so the chart has no gaps.
  const daily = [];
  for (let i = 0; i < days; i += 1) daily.push({ day: dayKey(from + i * DAY_MS), earned: 0, spent: 0 });
  const at = new Map(daily.map((d) => [d.day, d]));
  for (const r of cur) {
    const d = at.get(dayKey(r.createdAt)); if (!d) continue;
    const g = classify(r).group
    if (g === "earn") d.earned += r.amount;
    else if (g === "spend") d.spent += Math.abs(r.amount);
  }


  // Calls: only finished ones have a duration. Sessions are capped at 3h so one
  // orphaned call (never closed properly) can't inflate the total.
  const calls = (await listCallsForUser(userId, 2000)).filter((c) => c.startedAt >= prevFrom);
  const minutesOf = (list) => Math.round(list.filter((c) => c.endedAt).reduce((n, c) => n + Math.min(c.endedAt - c.startedAt, 3 * 3_600_000), 0) / 60_000);
  const callsCur = calls.filter((c) => c.startedAt >= from);
  const callsPrev = calls.filter((c) => c.startedAt < from);

  const feed = [
    ...rows.slice(0, 40).map((r) => ({
      id: r.id,
      kind: classify(r).group,
      label: String(r.reason || r.type).replace(/^./, (c) => c.toUpperCase()),
      amount: r.amount, at: r.createdAt,
    })),
    ...callsCur.slice(0, 40).filter((c) => c.endedAt).map((c) => ({ id: c.id, kind: "call", label: "Video chat", minutes: Math.max(1, Math.round(Math.min(c.endedAt - c.startedAt, 3 * 3_600_000) / 60_000)), amount: null, at: c.startedAt })),
  ].sort((a, b) => b.at - a.at).slice(0, 14);

  return {
    days, now,
    balance: await getBalance(userId),
    earned: { total: total(cur, "earn"), previous: total(prev, "earn"), breakdown: breakdown(cur, "earn") },
    spent: { total: total(cur, "spend"), previous: total(prev, "spend"), breakdown: breakdown(cur, "spend") },
    bought: total(cur, "buy"),
    chat: { minutes: minutesOf(callsCur), previousMinutes: minutesOf(callsPrev), calls: callsCur.length, previousCalls: callsPrev.length },
    activeDays: new Set(callsCur.map((c) => dayKey(c.startedAt))).size,
    friends: await countFriends(userId),
    daily, feed,
  };
}
