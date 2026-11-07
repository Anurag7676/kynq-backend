// Is the nudity protection working? Daily counters, split by the VIEWER's gender, so we can see
// what women actually run into. Each device sends one summary per 1:1 call it watched
// (mod:summary): did it ever blur, hide for "no face", or block what it received; did they report.
// Gender comes from the viewer's saved profile on the server, never from the payload.
// Plus, from the server's own records: model lockouts per day and how many were overturned
// (unblocked from Model blocks or by an approved appeal) — the false-block rate.
import mongoose from "mongoose";

const col = (n) => mongoose.connection.collection(n);
const DAY = 86_400_000;
const istDay = (ms) => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
// Devices send a summary as soon as they've scanned, and again whenever something new happens
// (first blur, first "no face", a block, a report), so a closed tab still counts. Per call and
// viewer, the call is counted once and each flag once. (A server restart may recount one call.)
const seen = new Map(); // `${callId}:${viewer}` → { at, flags already counted }
const FLAGS = ["blurred", "noFace", "blocked", "reported"];

export async function recordShieldSummary({ viewer, gender, callId, ...flags }) {
  if (!viewer || typeof callId !== "string" || !callId) return;
  const key = `${callId}:${viewer}`;
  const before = seen.get(key);
  const inc = {};
  if (!before) inc.calls = 1;
  const counted = new Set(before?.counted ?? []);
  for (const f of FLAGS) if (flags[f] === true && !counted.has(f)) { inc[f] = 1; counted.add(f); }
  seen.set(key, { at: before?.at ?? Date.now(), counted: [...counted] });
  if (seen.size > 50_000) for (const [k, v] of seen) if (Date.now() - v.at > DAY) seen.delete(k);
  if (!Object.keys(inc).length) return;
  const g = gender === "female" || gender === "male" ? gender : "other";
  await col("shield_stats").updateOne(
    { _id: `${istDay(Date.now())}:${g}` },
    { $setOnInsert: { day: istDay(Date.now()), gender: g }, $inc: inc },
    { upsert: true },
  );
}

/** The admin "Safety" numbers for the last `days` days (IST), newest first. */
export async function safetyStats(days = 14) {
  const n = Math.min(90, Math.max(1, Number(days) || 14));
  const since = Date.now() - n * DAY;
  const fromDay = istDay(since);
  const [shield, locks, overturnedAudit, appeals] = await Promise.all([
    col("shield_stats").find({ day: { $gte: fromDay } }).toArray(),
    col("moderation_strikes").aggregate([{ $match: { at: { $gte: since } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: { $add: ["$at", 19_800_000] } } } }, n: { $sum: 1 } } }]).toArray(),
    col("admin_audit").aggregate([{ $match: { action: "moderation.unblock", at: { $gte: since } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: { $add: [{ $toLong: "$at" }, 19_800_000] } } } }, n: { $sum: 1 } } }]).toArray().catch(() => []),
    col("appeals").aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray().catch(() => []),
  ]);
  const byDay = new Map();
  const row = (d) => byDay.get(d) ?? byDay.set(d, { day: d, calls: 0, femaleCalls: 0, blurred: 0, femaleBlurred: 0, noFace: 0, blocked: 0, femaleReported: 0, locks: 0, overturned: 0 }).get(d);
  for (const s of shield) {
    const r = row(s.day);
    const v = (k) => Number(s[k]) || 0; // a counter only exists once it has been incremented
    r.calls += v("calls"); r.blurred += v("blurred"); r.noFace += v("noFace"); r.blocked += v("blocked");
    if (s.gender === "female") { r.femaleCalls += v("calls"); r.femaleBlurred += v("blurred"); r.femaleReported += v("reported"); }
  }
  for (const l of locks) row(l._id).locks += l.n;
  for (const o of overturnedAudit) row(o._id).overturned += o.n;
  const series = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  const sum = (k) => series.reduce((t, r) => t + r[k], 0);
  const rate = (a, b) => (b ? a / b : null);
  return {
    days: n,
    totals: {
      callsWatched: sum("calls"), blurredRate: rate(sum("blurred"), sum("calls")), noFaceRate: rate(sum("noFace"), sum("calls")), blockedRate: rate(sum("blocked"), sum("calls")),
      femaleCalls: sum("femaleCalls"), femaleReportsPer1000: sum("femaleCalls") ? (sum("femaleReported") / sum("femaleCalls")) * 1000 : null,
      locks: sum("locks"), overturned: sum("overturned"), falseBlockRate: rate(sum("overturned"), sum("locks")),
      openAppeals: appeals.find((a) => a._id === "open")?.n ?? 0,
    },
    series,
  };
}
