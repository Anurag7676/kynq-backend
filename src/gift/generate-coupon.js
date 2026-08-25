// Generate one or more percentage-off coupon codes.
//
// Usage:
//   node src/gift/generate-coupon.js --percent 20 --code SUMMER20
//   node src/gift/generate-coupon.js --percent 20 --code SUMMER20 --expires 2026-09-30 --max 100 --min 500
//   node src/gift/generate-coupon.js --percent 15 --count 50 --prefix WELCOME   (50 unique single-use codes)
//
// Flags:
//   --percent   required, 1-100
//   --code      coupon code (default: random if omitted, or the --prefix + random)
//   --count     how many codes to generate (default 1)
//   --prefix    prefix for auto-generated codes, e.g. WELCOME -> WELCOME-A1B2C3
//   --expires   YYYY-MM-DD — coupon stops working after this date
//   --max       max total redemptions across all customers (default: unlimited,
//               except bulk-generated batches which default to 1 — single-use)
//   --min       minimum cart subtotal (rupees) required to use the coupon
import dotenv from "dotenv"; dotenv.config();
import mongoose from "mongoose";
import crypto from "crypto";
import connectDB from "./db.js";
import { createCoupon } from "./coupons.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function randomCode(prefix) {
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return prefix ? `${prefix}-${suffix}` : suffix;
}

function usage() {
  console.error(
    "usage: node src/gift/generate-coupon.js --percent <1-100> [--code CODE] [--count N] " +
    "[--prefix TEXT] [--expires YYYY-MM-DD] [--max N] [--min N]"
  );
}

const args = parseArgs(process.argv.slice(2));
const percentOff = Number(args.percent);
if (!(percentOff > 0 && percentOff <= 100)) {
  usage();
  process.exit(1);
}

const count = Number(args.count) || 1;

let expiresAt = null;
if (args.expires) {
  expiresAt = new Date(args.expires).getTime();
  if (Number.isNaN(expiresAt)) {
    console.error(`invalid --expires date: ${args.expires} (expected YYYY-MM-DD)`);
    process.exit(1);
  }
}

// Bulk batches (count > 1) are single-use per code by default — that's the
// normal shape for "50 unique influencer/invite codes". A single named
// coupon (count 1, e.g. a sitewide SUMMER20) defaults to unlimited unless
// --max is given.
const maxRedemptions = args.max ? Number(args.max) : (count > 1 ? 1 : null);
const minSubtotal = args.min ? Number(args.min) : null;

await connectDB();

const created = [];
for (let i = 0; i < count; i++) {
  const code = count === 1 && args.code ? args.code : randomCode(args.prefix || args.code);
  try {
    const coupon = await createCoupon({ code, percentOff, expiresAt, maxRedemptions, minSubtotal });
    created.push(coupon.code);
  } catch (err) {
    console.error(`  skipped ${code}: ${err.message}`);
  }
}

console.log(`\ncreated ${created.length}/${count} coupon(s) — ${percentOff}% off` +
  (expiresAt ? `, expires ${args.expires}` : "") +
  (maxRedemptions ? `, max ${maxRedemptions} use(s) each` : "") +
  (minSubtotal ? `, min order ₹${minSubtotal}` : "") + ":\n");
created.forEach((c) => console.log(`  ${c}`));
console.log("");

await mongoose.connection.close();
process.exit(0);
