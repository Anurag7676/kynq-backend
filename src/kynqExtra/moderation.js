// Nudity protection (server side). Modelled on Monkey's system (server-chosen random snapshot
// seconds, an on-device score, upload only on demand, server escalation), plus one thing it
// doesn't do: the person WATCHING also scans the video they receive, so a modified client can't
// switch protection off for the people it calls.
//
// Signals (both from phones/browsers running the same open-source NSFWJS MobileNetV2 model):
//   self  — your own camera, at random seconds the server picks per call (mod:shots)
//   peer  — the video you are receiving, scanned every 1–2 s by your device
// "nsfw" below = Porn + Hentai probability.
//
// What happens (all thresholds live here, nothing is decided by the client):
//   nsfw >= HIGH  → the device must send the frame; the server re-scores it in its own thread.
//                   Confirmed (server nsfw >= CONFIRM):
//                     · the call ends for both, each told why (mod:action)
//                     · self-detected, or peer-detected and corroborated (their own camera also
//                       scored >= MEDIUM in this call, or a second person confirmed them within
//                       24 h): a strike → locked out 24 h, then 7 days, then permanently
//                     · peer-detected only: 1 h cool-down (a single reporter can't get someone
//                       banned on their own) and it's kept for review
//   MEDIUM..HIGH  → logged (the watcher's device already blurred it)
// Frames are kept 7 days for review, then deleted automatically (TTL index).
import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import mongoose from "mongoose";

export const NSFW_HIGH = 0.85;
export const NSFW_MEDIUM = 0.55;
export const NSFW_CONFIRM = 0.7;
const HOUR = 3_600_000;
const STRIKE_LADDER_MS = [24 * HOUR, 7 * 24 * HOUR, Infinity];
const PEER_ONLY_COOLDOWN_MS = HOUR;
const STRIKE_WINDOW_MS = 90 * 24 * HOUR;
const KEEP_MS = 7 * 24 * HOUR;
const MAX_FRAME_B64 = 200_000;

const col = (n) => mongoose.connection.collection(n);
const nsfwOf = (s) => (Number(s?.Porn) || 0) + (Number(s?.Hentai) || 0);

let indexesReady = null;
export function ensureModerationIndexes() {
  indexesReady ??= Promise.all([
    col("moderation_events").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
    col("moderation_events").createIndex({ subject: 1, at: -1 }),
    col("moderation_events").createIndex({ callId: 1 }),
    col("moderation_strikes").createIndex({ userId: 1, at: -1 }),
  ]).catch((err) => { indexesReady = null; console.error("[moderation] index creation failed:", err.message); });
  return indexesReady;
}

// ─── Snapshot schedule: random seconds, more often early in the call (when most flashing
// happens), unknown to the client in advance beyond this call. ───
export function shotSchedule() {
  const out = [];
  let t = 2 + Math.random() * 3;
  while (t < 1800) {
    out.push(Math.round(t * 10) / 10);
    t += t < 120 ? 6 + Math.random() * 9 : 15 + Math.random() * 25;
  }
  return out;
}

// ─── Server re-score, off the main thread ───
let worker = null;
let seq = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./moderation-worker.js", import.meta.url));
  worker.unref();
  worker.on("message", ({ id, ok, scores, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    ok ? p.resolve(scores ?? null) : p.reject(new Error(error));
  });
  worker.on("error", (err) => { console.error("[moderation] worker crashed:", err.message); for (const p of pending.values()) p.reject(err); pending.clear(); worker = null; });
  return worker;
}
function ask(msg, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("moderation check timed out")); }, timeoutMs);
    timer.unref?.(); // never keeps the process alive on its own
    pending.set(id, { resolve, reject, timer });
    getWorker().postMessage({ ...msg, id });
  });
}
export const warmModeration = () => ask({ warm: true }, 60_000).catch((err) => console.error("[moderation] warm-up failed:", err.message));
// Local end-to-end tests only (never in production): make the server's re-check report explicit,
// so the full live path (call ends, lockout) can be exercised without real explicit images.
const TEST_EXPLICIT = process.env.NODE_ENV !== "production" && process.env.KYNQ_MODERATION_TEST_EXPLICIT === "1";
export const scoreFrame = (base64) => (TEST_EXPLICIT ? Promise.resolve({ Drawing: 0, Hentai: 0.05, Neutral: 0.02, Porn: 0.9, Sexy: 0.03 }) : ask({ base64 }));

// ─── Lockouts ───
async function strikesOf(userId) {
  return col("moderation_strikes").countDocuments({ userId, at: { $gte: Date.now() - STRIKE_WINDOW_MS } });
}
async function lockOut(userId, ms, reason) {
  const { enforceRestriction } = await import("./restrictions.js");
  const set = ms === Infinity ? { kynqExtraRestricted: true, kynqExtraRestrictedReason: reason } : { kynqExtraRestrictedUntil: Date.now() + ms, kynqExtraRestrictedReason: reason };
  await col("users").updateOne({ id: userId }, { $set: set });
  await enforceRestriction(userId).catch((err) => console.error("[moderation] enforce failed:", err.message));
  console.log(`[moderation] locked out userId=${userId} for=${ms === Infinity ? "permanent" : Math.round(ms / 60000) + "min"} reason=${reason}`);
}

/** Has someone else (not this reporter) had them confirmed in the last 24 h? */
async function otherConfirmedReporter(subject, reporter) {
  return !!(await col("moderation_events").findOne({ subject, kind: "peer", confirmed: true, reporter: { $ne: reporter }, at: { $gte: Date.now() - 24 * HOUR } }, { projection: { _id: 1 } }));
}
/** Did their own camera already score as risky in this call? */
async function selfFlaggedInCall(subject, callId) {
  return !!(await col("moderation_events").findOne({ subject, callId, kind: "self", nsfw: { $gte: NSFW_MEDIUM } }, { projection: { _id: 1 } }));
}

// Per-socket flood guard (a device scans every 1–2 s; anything faster is not our client).
const lastAt = new Map();

/**
 * One score from a device. `endForModeration(callId, offenderId)` is provided by signaling.
 * Returns the ack payload.
 */
export async function handleScore({ socket, scopedId, payload, endForModeration, score = scoreFrame }) {
  await ensureModerationIndexes();
  const { callId, kind, scores, frame } = payload ?? {};
  if (!callId || callId !== socket.data.currentCallId) return { ok: false, reason: "not in that call" };
  if (kind !== "self" && kind !== "peer") return { ok: false, reason: "bad kind" };
  const now = Date.now();
  if (now - (lastAt.get(socket.id) ?? 0) < 400) return { ok: false, reason: "too fast" };
  lastAt.set(socket.id, now);

  const subject = kind === "self" ? scopedId : socket.data.peerScopedId;
  if (!subject) return { ok: false, reason: "no peer" };
  const nsfw = nsfwOf(scores);
  if (nsfw < NSFW_MEDIUM) return { ok: true };

  const base = { at: now, expireAt: new Date(now + KEEP_MS), callId, kind, reporter: scopedId, subject, nsfw, clientScores: scores };
  if (nsfw < NSFW_HIGH) {
    await col("moderation_events").insertOne({ ...base, level: "medium" });
    return { ok: true };
  }
  // High: we need to see the frame before acting on anyone.
  if (typeof frame !== "string" || !frame.length) return { ok: true, needFrame: true };
  if (frame.length > MAX_FRAME_B64) return { ok: false, reason: "frame too large" };
  const b64 = frame.replace(/^data:image\/\w+;base64,/, "");

  let serverScores = null;
  try { serverScores = await score(b64); } catch (err) { console.error("[moderation] server score failed:", err.message); }
  const serverNsfw = nsfwOf(serverScores);
  const confirmed = serverScores ? serverNsfw >= NSFW_CONFIRM : false;
  const id = crypto.randomUUID();
  await col("moderation_events").insertOne({ ...base, _id: id, level: "high", frame: b64, serverScores, serverNsfw, confirmed });
  console.log(`[moderation] high ${kind} subject=${subject} reporter=${scopedId} client=${nsfw.toFixed(2)} server=${serverScores ? serverNsfw.toFixed(2) : "n/a"} confirmed=${confirmed}`);
  if (!confirmed) return { ok: true, confirmed: false };

  // Confirmed nudity: end the call now, then lock out per the ladder.
  await endForModeration(callId, subject).catch((err) => console.error("[moderation] end call failed:", err.message));
  const strong = kind === "self" || (await selfFlaggedInCall(subject, callId)) || (await otherConfirmedReporter(subject, scopedId));
  if (strong) {
    const prior = await strikesOf(subject);
    const ms = STRIKE_LADDER_MS[Math.min(prior, STRIKE_LADDER_MS.length - 1)];
    await col("moderation_strikes").insertOne({ userId: subject, at: now, eventId: id, callId, level: prior + 1 });
    await col("moderation_events").updateOne({ _id: id }, { $set: { action: ms === Infinity ? "banned" : `locked_${Math.round(ms / HOUR)}h` } });
    await lockOut(subject, ms, "nudity");
  } else {
    await col("moderation_events").updateOne({ _id: id }, { $set: { action: "cooldown_1h", needsReview: true } });
    await lockOut(subject, PEER_ONLY_COOLDOWN_MS, "nudity_reported");
  }
  return { ok: true, confirmed: true };
}
