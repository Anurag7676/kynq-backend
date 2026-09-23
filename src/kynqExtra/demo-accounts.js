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
// the seeker's own scopedId; { seen: [demoUserId, ...] }.
const seenStore = collection("kynq_extra_demo_seen");

const requested = process.env.DEMO_MATCH_ACCOUNTS === "true";
export const DEMO_MATCH_ENABLED = requested && process.env.NODE_ENV !== "production";

if (requested && process.env.NODE_ENV === "production") {
  console.error("[kynqExtra] DEMO_MATCH_ACCOUNTS=true but NODE_ENV=production — refusing to enable demo accounts.");
}

// How long a real searcher waits before being offered a demo match — long
// enough that two real testers online at once still match each other first.
export const DEMO_FALLBACK_MS = 120_000; // 2 minutes

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
 * `seekerScopedId` picks WHICH demo identity: a seeker never gets the same
 * demo account twice in a row — the pool of not-yet-seen demo users shrinks
 * each time, and only resets (everyone becomes eligible again) once they've
 * genuinely gone through all of them. Persisted per-seeker in Mongo, so it
 * survives restarts, not just one process's lifetime.
 *
 * Each demo identity always shows the SAME clip (its `demoVideoKey`,
 * assigned once by scripts/assign-demo-videos.mjs — round-robinned, since
 * there are usually fewer clips than demo users) rather than a different
 * random one every time it's picked. A demo user seeded before that script
 * ran falls back to a random clip so nothing breaks in the meantime.
 */
export async function pickDemoMatch(seekerScopedId) {
  if (!DEMO_MATCH_ENABLED) return null;
  const [keys, users] = await Promise.all([videoKeys(), demoIdentities()]);
  if (!keys.length || !users.length) return null;

  const seenDoc = seekerScopedId ? await seenStore.get(seekerScopedId).catch(() => null) : null;
  const seen = new Set(seenDoc?.seen ?? []);
  let pool = users.filter((u) => !seen.has(u.id));
  if (!pool.length) { pool = users; seen.clear(); } // exhausted the whole roster — start a fresh cycle

  const user = rand(pool);
  const key = keys.includes(user.demoVideoKey) ? user.demoVideoKey : rand(keys);
  const videoUrl = await getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: PRESIGN_TTL_S })
    .catch((err) => { console.error("[kynqExtra] couldn't sign a demo video URL:", err.message); return null; });
  if (!videoUrl) return null;

  if (seekerScopedId) {
    seen.add(user.id);
    await seenStore.set(seekerScopedId, { seen: [...seen], updatedAt: Date.now() }).catch((err) => {
      console.error("[kynqExtra] couldn't persist demo-seen state:", err.message);
    });
  }

  return { id: user.id, name: user.name, city: user.city ?? null, videoUrl };
}
