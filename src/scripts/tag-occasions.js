// One-time, idempotent migration: adds "occasion" tags to existing products
// so /api/products?tag=<occasion> can drive the curated Occasions pages
// (Birthday, Anniversary, For Her, For Him, Premium Gifts, Budget Gifts,
// Unique Gifts, KidZone). Uses the Product model's existing `tags: [String]`
// field — no schema change. $addToSet only ever adds; it never removes an
// existing tag (e.g. "rakhi"), and re-running this script is a no-op if
// nothing changed.
//
// Every slug below was cross-checked against the live catalogue
// (2026-08-24) — all 63 products are accounted for across the 8 groups,
// and every slug listed here was confirmed to exist. If you edit this list
// later, re-run the script: it reports any slug that doesn't match a real
// product instead of failing silently.
import dotenv from "dotenv"; dotenv.config();
import mongoose from "mongoose";
import connectDB from "../config/dbconnection.js";
import Product from "../models/productModel.js";

const OCCASION_TAGS = {
  birthday: [
    "fuzzy-heart-pen", "gemstone-pen", "lavender-bunny-pen", "ice-cream-pen", "flower-pen",
    "tiny-turtle-keychain", "sunflower-keychain", "moonglow-keychain", "watermelon-charm",
    "everbloom-rose-keychain", "cherry-bow-charm", "bunny-mug", "oh-buddy-mug", "nice-all-day-mug",
    "sculpted-glass-mug", "gallery-frame", "aqua-bear-frame", "pink-love-frame", "sweet-time-bottle",
    "pink-ombre-bottle", "pulse-blue-bottle", "rainbow-snuggle-bunny", "pocket-penguin",
    // "All KidZone products" — the kidzone group's full slug list, unioned in.
    "rocket-launcher", "princess-craft-kit", "pink-umbrella", "mini-cottage-kit", "catapult-basketball",
    "architect-toy-set", "happy-monkey-kit", "dino-paint-kit", "bear-buddies-kit",
    "princess-ribbon-bow", "sunny-bloom-bow",
  ],
  anniversary: [
    "crystal-silver-set", "beaded-gold-necklace", "pink-love-frame", "gallery-frame", "sweet-time-bottle",
    "ship-shadow-box", "ship-in-a-bottle", "eiffel-in-a-frame", "the-hourglass", "dream-carriage",
    "royal-glow-pillar", "mint-glow-candle", "lavender-haze-candle", "aroma-bliss-trio",
    "pendulum-clock", "sunburst-clock", "elegance-alarm-clock",
  ],
  "for-her": [
    "crystal-silver-set", "beaded-gold-necklace", "sunny-bloom-bow", "princess-ribbon-bow",
    "cloud-puff-scrunchie", "blossom-hair-claw", "fuzzy-heart-pen", "lavender-bunny-pen", "flower-pen",
    "pink-love-frame", "pink-ombre-bottle", "bunny-mug", "lavender-haze-candle", "mint-glow-candle",
    "rainbow-snuggle-bunny", "princess-craft-kit", "pink-umbrella",
  ],
  "for-him": [
    "rakhi-special-hamper", "rakhi-purple-hamper", "oh-buddy-mug", "nice-all-day-mug", "sculpted-glass-mug",
    "pulse-blue-bottle", "coastal-sketch-bottle", "ship-shadow-box", "ship-in-a-bottle", "rocket-launcher",
    "catapult-basketball", "architect-toy-set", "happy-monkey-kit", "bear-buddies-kit",
    "pendulum-clock", "sunburst-clock", "red-alarm-clock", "the-hourglass",
  ],
  "premium-gifts": [
    "rakhi-celebration-box", "rakhi-classic-hamper", "crystal-silver-set", "beaded-gold-necklace",
    "bunny-mug", "sweet-time-bottle", "pink-love-frame", "pulse-blue-bottle", "oh-buddy-mug",
    "nice-all-day-mug", "sculpted-glass-mug", "gallery-frame", "aqua-bear-frame", "coastal-sketch-bottle",
    "eiffel-in-a-frame", "red-alarm-clock", "royal-glow-pillar", "mint-glow-candle", "lavender-haze-candle",
    "pocket-penguin", "rainbow-snuggle-bunny", "catapult-basketball",
  ],
  "budget-gifts": [
    "rakhi-mini-hamper", "rakhi-sweet-treat", "rakhi-red-hamper", "rakhi-yellow-joy", "rakhi-green-delight",
    "rakhi-purple-hamper", "rakhi-special-hamper", "fuzzy-heart-pen", "gemstone-pen", "lavender-bunny-pen",
    "ice-cream-pen", "flower-pen", "tiny-turtle-keychain", "sunflower-keychain", "sunny-bloom-bow",
    "princess-ribbon-bow", "moonglow-keychain", "watermelon-charm", "everbloom-rose-keychain",
    "evil-eye-charm", "cloud-puff-scrunchie", "cherry-bow-charm", "blossom-hair-claw",
  ],
  "unique-gifts": [
    "pendulum-clock", "sunburst-clock", "red-alarm-clock", "green-rimmed-clock", "elegance-alarm-clock",
    "sweet-time-bottle", "coastal-sketch-bottle", "ship-shadow-box", "ship-in-a-bottle", "eiffel-in-a-frame",
    "the-hourglass", "dream-carriage", "royal-glow-pillar", "mint-glow-candle", "lavender-haze-candle",
    "aroma-bliss-trio", "pink-love-frame", "gallery-frame", "aqua-bear-frame", "crystal-silver-set",
    "beaded-gold-necklace",
    // "All custom/made-to-order products" — no live MTO product exists in
    // the catalogue today (confirmed separately), so nothing to add here.
  ],
  kidzone: [
    "rocket-launcher", "princess-craft-kit", "pink-umbrella", "mini-cottage-kit", "catapult-basketball",
    "architect-toy-set", "happy-monkey-kit", "dino-paint-kit", "bear-buddies-kit", "pocket-penguin",
    "rainbow-snuggle-bunny", "aqua-bear-frame", "bunny-mug", "lavender-bunny-pen", "ice-cream-pen",
    "princess-ribbon-bow", "sunny-bloom-bow", "fuzzy-heart-pen", "gemstone-pen", "flower-pen",
  ],
};

await connectDB();

let totalTagged = 0;
for (const [tag, slugs] of Object.entries(OCCASION_TAGS)) {
  const found = await Product.find({ slug: { $in: slugs } }, { slug: 1 });
  const foundSlugs = new Set(found.map((p) => p.slug));
  const missing = slugs.filter((s) => !foundSlugs.has(s));
  if (missing.length) {
    console.warn(`  ! ${tag}: ${missing.length} slug(s) not found — ${missing.join(", ")}`);
  }
  const result = await Product.updateMany({ slug: { $in: slugs } }, { $addToSet: { tags: tag } });
  console.log(`${tag}: ${result.modifiedCount} newly tagged, ${found.length}/${slugs.length} slugs matched`);
  totalTagged += result.modifiedCount;
}

console.log(`\ndone — ${totalTagged} tag addition(s) applied across ${Object.keys(OCCASION_TAGS).length} occasions.`);
await mongoose.connection.close();
process.exit(0);
