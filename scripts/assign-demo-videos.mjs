// Assigns each seeded demo user (isDemoSeed:true) a fixed S3 video key,
// stored on the user doc as `demoVideoKey`. Round-robins through whatever's
// in the bucket — if there are fewer videos than demo users (very likely:
// this bucket has dozens, not thousands), multiple users share a clip, but
// each individual demo user always gets the SAME clip every time they're
// picked, instead of a different random one on every match.
//
// Idempotent — safe to re-run any time new videos are added to the bucket;
// it reassigns everyone fresh from the current video list.
import "dotenv/config";
import mongoose from "mongoose";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const BUCKET = process.env.DEMO_VIDEO_BUCKET || "kynq-extra-media";
const PREFIX = process.env.DEMO_VIDEO_PREFIX || "videos/";

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI not set — refusing to run without knowing which database this writes to.");
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw new Error("AWS credentials not set.");

  const s3 = new S3Client({ region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "ap-south-1" });
  const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
  const keys = (out.Contents ?? []).map((o) => o.Key).filter((k) => k && k.toLowerCase().endsWith(".mp4")).sort();
  if (!keys.length) throw new Error(`No .mp4 files found under s3://${BUCKET}/${PREFIX}`);

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to ${mongoose.connection.name}`);
  console.log(`${keys.length} videos available in s3://${BUCKET}/${PREFIX}\n`);

  const users = await mongoose.connection.collection("users")
    .find({ isDemoSeed: true }).project({ id: 1 }).toArray();
  if (!users.length) throw new Error("No demo users found (isDemoSeed:true) — seed them first with seed-demo-users.mjs.");

  let i = 0;
  const ops = users.map((u) => {
    const key = keys[i % keys.length];
    i += 1;
    return {
      updateOne: {
        filter: { id: u.id },
        update: { $set: { demoVideoKey: key } },
      },
    };
  });

  const res = await mongoose.connection.collection("users").bulkWrite(ops);
  console.log(`Assigned videos to ${res.modifiedCount + res.upsertedCount || users.length} demo users`);
  console.log(`~${Math.ceil(users.length / keys.length)} users per video (round-robin over ${keys.length} clips)`);

  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
