// Staging-only demo matches: a seeded test identity (scripts/seed-demo-
// users.mjs — accounts tagged isDemoSeed:true) paired with a video clip
// served from S3, so a tester's queue never sits empty. NEVER a stand-in
// for a real person — the client shows a visible "Demo account" badge
// (never "Stranger"), and none of the real-match side effects happen: no
// Koins, no chat-meter timer, no `calls` record, no friend requests (the
// client never learns a real scopedId for these, so Add Friend can't even
// render).
//
// Hard off unless explicitly turned on. This must NEVER run in production —
// set DEMO_MATCH_ACCOUNTS=true ONLY in the staging deployment's own env.
// NODE_ENV alone is not trusted for this: the flag must be explicit, and
// production is refused even if someone sets the flag there by mistake.
import mongoose from "mongoose";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { collection } from "../gift/store.js";

// Persisted (not in-memory) — a real seeker's "already seen" list must
// survive a server restart/redeploy, same as everything else here. Keyed by
// the seeker's own scopedId; { seen: [videoKey, ...] }. Tracked by VIDEO,
// not by demo user id — with far fewer clips than demo users, tracking by
// user id alone would still repeat the same clip under a different name.
// The actual requirement is "no repeat clip," so that's what's tracked.
const SEEN_COLLECTION = "kynq_extra_demo_seen";
const seenStore = collection(SEEN_COLLECTION);

// Same pattern as wallet.js/chat-meter.js/gifts.js — a `_key`-indexed lookup
// collection needs its index created once, or every get()/set() falls back
// to a full collection scan once this has more than a handful of docs (one
// doc per real tester who's ever hit the demo fallback).
let indexesReady = null;
export function ensureDemoAccountIndexes() {
  if (!indexesReady) {
    indexesReady = mongoose.connection.collection(SEEN_COLLECTION)
      .createIndex({ _key: 1 }, { unique: true })
      .catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}

const requested = process.env.DEMO_MATCH_ACCOUNTS === "true";
export const DEMO_MATCH_ENABLED = requested && process.env.NODE_ENV !== "production";

if (requested && process.env.NODE_ENV === "production") {
  console.error("[kynqExtra] DEMO_MATCH_ACCOUNTS=true but NODE_ENV=production — refusing to enable demo accounts.");
}

// How long a real searcher waits before being offered a demo match — long
// enough that two real testers online at once still match each other first.
//
// The wait GROWS each time the same person is handed a demo, so someone with nobody
// around isn't shown clip after clip: 30s for the first, then 1 min, 3 min, and 5 min
// from the fourth on. A real match resets it to 30s, and so does 30 minutes away.
// Kept in memory (it's staging-only soft state; a restart just starts everyone at 30s).
export const DEMO_DELAY_STEPS_MS = [30_000, 60_000, 180_000, 300_000];
export const DEMO_FALLBACK_MS = DEMO_DELAY_STEPS_MS[0]; // the first wait
const DEMO_BACKOFF_RESET_MS = 30 * 60_000;
const demoBackoff = new Map(); // scopedId -> { count, lastAt }

/** How long this person waits before being offered a demo, given how many they've had. */
export function demoDelayMs(scopedId, now = Date.now()) {
  const s = demoBackoff.get(scopedId);
  if (!s) return DEMO_DELAY_STEPS_MS[0];
  if (now - s.lastAt > DEMO_BACKOFF_RESET_MS) { demoBackoff.delete(scopedId); return DEMO_DELAY_STEPS_MS[0]; }
  return DEMO_DELAY_STEPS_MS[Math.min(s.count, DEMO_DELAY_STEPS_MS.length - 1)];
}

/** They were just handed a demo: the next wait is one step longer. Returns that next wait. */
export function noteDemoServed(scopedId, now = Date.now()) {
  if (demoBackoff.size > 1000) for (const [id, s] of demoBackoff) if (now - s.lastAt > DEMO_BACKOFF_RESET_MS) demoBackoff.delete(id);
  const prev = demoBackoff.get(scopedId);
  const count = prev && now - prev.lastAt <= DEMO_BACKOFF_RESET_MS ? prev.count + 1 : 1;
  demoBackoff.set(scopedId, { count, lastAt: now });
  return demoDelayMs(scopedId, now);
}

/** They got a real match: start again from the shortest wait. */
export function resetDemoBackoff(scopedId) { demoBackoff.delete(scopedId); }

const BUCKET = process.env.DEMO_VIDEO_BUCKET || "kynq-extra-media";
const PREFIX = process.env.DEMO_VIDEO_PREFIX || "videos/";
const PRESIGN_TTL_S = 2 * 60 * 60; // 2h — long enough for one sitting, expires on its own after
const CACHE_TTL_MS = 5 * 60_000; // re-list S3 / re-query demo users every 5 min, not every match

let s3Client = null;
function s3() {
  if (s3Client) return s3Client;
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return null;
  s3Client = new S3Client({ region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "ap-south-1" });
  return s3Client;
}

let cachedKeys = [];
let keysCachedAt = 0;
async function videoKeys() {
  const c = s3();
  if (!c) return [];
  if (cachedKeys.length && Date.now() - keysCachedAt < CACHE_TTL_MS) return cachedKeys;
  try {
    const out = await c.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
    cachedKeys = (out.Contents ?? []).map((o) => o.Key).filter((k) => k && k.toLowerCase().endsWith(".mp4"));
    keysCachedAt = Date.now();
  } catch (err) {
    console.error("[kynqExtra] couldn't list demo videos from S3:", err.message);
  }
  return cachedKeys;
}

let cachedUsers = [];
let usersCachedAt = 0;
async function demoIdentities() {
  if (cachedUsers.length && Date.now() - usersCachedAt < CACHE_TTL_MS) return cachedUsers;
  cachedUsers = await mongoose.connection.collection("users")
    .find({ isDemoSeed: true }).project({ id: 1, name: 1, city: 1, demoVideoKey: 1 }).toArray()
    .catch((err) => { console.error("[kynqExtra] couldn't load seeded demo users:", err.message); return []; });
  usersCachedAt = Date.now();
  return cachedUsers;
}

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * A seeded identity + its assigned S3 clip's presigned URL — or null if
 * anything needed isn't ready (flag off, no AWS creds, nothing uploaded to
 * S3 yet, or no demo users seeded yet). Safe to call unconditionally; a null
 * return is simply a no-op for the caller.
 *
 * `seekerScopedId` drives the no-repeat rule — THE major requirement here:
 * a seeker must never see the same CLIP twice in a row. Picking is done by
 * clip first (from whichever clips this seeker hasn't seen yet), then a
 * demo identity assigned to that clip (scripts/assign-demo-videos.mjs
 * assigns each demo user a fixed clip — several users can share one clip
 * since there are far fewer clips than demo users). Once a seeker has been
 * shown every clip, the cycle resets. Persisted per-seeker in Mongo, so it
 * survives restarts, not just one process's lifetime.
 */
export async function pickDemoMatch(seekerScopedId) {
  if (!DEMO_MATCH_ENABLED) return null;
  const [keys, users] = await Promise.all([videoKeys(), demoIdentities()]);
  if (!keys.length || !users.length) return null;

  const seenDoc = seekerScopedId ? await seenStore.get(seekerScopedId).catch(() => null) : null;
  const seen = new Set(seenDoc?.seen ?? []);
  let unseenKeys = keys.filter((k) => !seen.has(k));
  if (!unseenKeys.length) { unseenKeys = keys; seen.clear(); } // shown every clip — start a fresh cycle

  const key = rand(unseenKeys);
  // Prefer a demo identity actually assigned to this clip; fall back to any
  // identity if none are (e.g. assign-demo-videos.mjs hasn't run yet).
  const candidates = users.filter((u) => u.demoVideoKey === key);
  const user = rand(candidates.length ? candidates : users);

  const videoUrl = await getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: PRESIGN_TTL_S })
    .catch((err) => { console.error("[kynqExtra] couldn't sign a demo video URL:", err.message); return null; });
  if (!videoUrl) return null;

  if (seekerScopedId) {
    seen.add(key);
    await seenStore.set(seekerScopedId, { seen: [...seen], updatedAt: Date.now() }).catch((err) => {
      console.error("[kynqExtra] couldn't persist demo-seen state:", err.message);
    });
  }

  return { id: user.id, name: user.name, city: user.city ?? null, videoUrl };
}
