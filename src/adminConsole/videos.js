// Demo-match clips in S3 (the same bucket/prefix demo-accounts.js serves from): list, preview,
// upload, delete, and spreading the seeded demo users across the clips.
//
// Uploads stream through this server (the bucket has no CORS rules, so browsers can't PUT to it
// directly). Only .mp4 files are accepted, checked by extension, content type AND the file's own
// "ftyp" header, and an existing clip is never overwritten.
import { Readable } from "node:stream";
import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { col } from "./util.js";
import { logAudit } from "./audit.js";
import { clearDemoVideoCache } from "../kynqExtra/demo-accounts.js";

const BUCKET = process.env.DEMO_VIDEO_BUCKET || "kynq-extra-media";
const PREFIX = process.env.DEMO_VIDEO_PREFIX || "videos/";
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const PREVIEW_TTL_S = 60 * 60;

let client = null;
function s3() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw Object.assign(new Error("AWS credentials are not set on the backend."), { code: "bad_request" });
  client ??= new S3Client({ region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "ap-south-1" });
  return client;
}

const bad = (message) => Object.assign(new Error(message), { code: "bad_request" });
const isClipKey = (key) => typeof key === "string" && key.startsWith(PREFIX) && !key.includes("..") && key.toLowerCase().endsWith(".mp4");

async function allClips() {
  const out = [];
  let token;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key && o.Key.toLowerCase().endsWith(".mp4")) out.push(o);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function assignedCounts() {
  const rows = await col("users").aggregate([{ $match: { isDemoSeed: true } }, { $group: { _id: "$demoVideoKey", n: { $sum: 1 } } }]).toArray();
  return new Map(rows.map((r) => [r._id ?? null, r.n]));
}

export async function listVideos() {
  const [clips, counts] = await Promise.all([allClips(), assignedCounts()]);
  const videos = await Promise.all(clips
    .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0))
    .map(async (o) => ({
      key: o.Key,
      name: o.Key.slice(PREFIX.length),
      sizeBytes: o.Size ?? 0,
      uploadedAt: o.LastModified ? o.LastModified.getTime() : null,
      assignedUsers: counts.get(o.Key) ?? 0,
      url: await getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }), { expiresIn: PREVIEW_TTL_S }),
    })));
  const keys = new Set(clips.map((c) => c.Key));
  const demoUsers = [...counts.values()].reduce((a, b) => a + b, 0);
  const orphaned = [...counts.entries()].filter(([k]) => !k || !keys.has(k)).reduce((a, [, n]) => a + n, 0);
  return {
    bucket: BUCKET, prefix: PREFIX, maxUploadBytes: MAX_UPLOAD_BYTES,
    totals: { videos: clips.length, bytes: clips.reduce((a, c) => a + (c.Size ?? 0), 0), demoUsers, unassignedUsers: orphaned },
    videos,
  };
}

/** Round-robin every seeded demo user over the current clips (same rule as scripts/assign-demo-videos.mjs). */
async function spread(keys, filter = { isDemoSeed: true }) {
  const users = await col("users").find(filter).project({ id: 1 }).sort({ id: 1 }).toArray();
  if (!users.length || !keys.length) return 0;
  const sorted = [...keys].sort();
  await col("users").bulkWrite(users.map((u, i) => ({ updateOne: { filter: { id: u.id }, update: { $set: { demoVideoKey: sorted[i % sorted.length] } } } })));
  return users.length;
}

export async function rebalance(admin) {
  const keys = (await allClips()).map((c) => c.Key);
  if (!keys.length) throw bad("There are no clips to assign.");
  const users = await spread(keys);
  await logAudit(admin.email, "video.rebalance", null, { videos: keys.length, users });
  return { videos: keys.length, users };
}

// Reads just enough of the upload to check it's an MP4 (bytes 4..8 are "ftyp"), BEFORE anything is
// sent to S3, then hands back a stream that replays those bytes followed by the rest of the body.
// The size cap is enforced by Content-Length (Node stops reading the body there, and S3 requires
// the exact length), so nothing can fail mid-stream except the client giving up.
async function checkedMp4Body(req) {
  const it = req[Symbol.asyncIterator]();
  let head = Buffer.alloc(0);
  while (head.length < 12) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await it.next();
    if (done) break;
    head = Buffer.concat([head, value]);
  }
  if (head.length < 12) throw bad("That file is too small to be a video.");
  if (head.subarray(4, 8).toString("ascii") !== "ftyp") { req.resume(); throw bad("That file isn't a valid MP4 video."); }
  return Readable.from((async function* body() {
    yield head;
    for (;;) {
      const { value, done } = await it.next();
      if (done) return;
      yield value;
    }
  })());
}

const safeName = (raw) => {
  const base = String(raw || "").split(/[\\/]/).pop().replace(/\.mp4$/i, "");
  const clean = base.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80);
  return `${clean || "clip"}.mp4`;
};

export async function uploadVideo(req, admin) {
  const name = safeName(req.query.name);
  if (!/\.mp4$/i.test(String(req.query.name || ""))) throw bad("Only .mp4 files can be uploaded.");
  const type = String(req.headers["content-type"] || "").split(";")[0].trim();
  if (type !== "video/mp4") throw bad("Only MP4 videos (video/mp4) can be uploaded.");
  const length = Number(req.headers["content-length"]);
  if (!Number.isFinite(length) || length <= 0) throw bad("The upload is missing its size.");
  if (length > MAX_UPLOAD_BYTES) throw bad(`That file is over the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`);

  const key = `${PREFIX}${name}`;
  const exists = await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })).then(() => true, (err) => (err?.$metadata?.httpStatusCode === 404 ? false : Promise.reject(err)));
  if (exists) throw bad(`A clip named ${name} already exists. Rename the file and try again.`);

  const body = await checkedMp4Body(req);
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentLength: length, ContentType: "video/mp4" }));

  // Give the new clip its share of demo users straight away: take every Nth user from the others.
  const keys = (await allClips()).map((c) => c.Key);
  const share = Math.floor((await col("users").countDocuments({ isDemoSeed: true })) / Math.max(1, keys.length));
  if (share > 0) {
    const ids = (await col("users").find({ isDemoSeed: true, demoVideoKey: { $ne: key } }).project({ id: 1 }).sort({ id: 1 }).toArray())
      .filter((_, i) => i % keys.length === 0).slice(0, share).map((u) => u.id);
    await col("users").updateMany({ id: { $in: ids } }, { $set: { demoVideoKey: key } });
  }
  clearDemoVideoCache();
  await logAudit(admin.email, "video.upload", key, { bytes: length });
  return { key, name, sizeBytes: length };
}

export async function deleteVideo(key, admin) {
  if (!isClipKey(key)) throw bad("That isn't a demo clip.");
  const remaining = (await allClips()).map((c) => c.Key).filter((k) => k !== key);
  if (remaining.length === 0) throw bad("This is the last clip. Upload another before deleting it, or demo matches stop working.");
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  // The demo users who were showing this clip move to the remaining ones.
  const moved = await spread(remaining, { isDemoSeed: true, demoVideoKey: key });
  clearDemoVideoCache();
  await logAudit(admin.email, "video.delete", key, { reassignedUsers: moved });
  return { key, reassignedUsers: moved };
}
