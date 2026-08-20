// Additive seed: upserts the PRODUCT-IMAGE-NEW batch into the products store.
// Safe to re-run (keyed by slug). Does NOT drop or touch existing products.
//   node src/gift/seed-new-products.mjs
// NOTE: prices are placeholder guesses ("random for now") — adjust and re-run.
import dotenv from "dotenv"; dotenv.config();
import mongoose from "mongoose";
import connectDB from "./db.js";
import { collection } from "./store.js";

const imgs = (slug, alt) =>
  Array.from({ length: 3 }, (_, i) => ({ url: `/products/${slug}/${i + 1}.png`, alt }));

// [slug, name, category, price ₹, short description]
const ITEMS = [
  ["architect-toy-set",     "little architect set",     "plushies", 1299, "a building set for tiny city planners."],
  ["catapult-basketball",   "catapult hoops",           "plushies",  999, "tabletop catapult basketball. loud families, this one's yours."],
  ["coastal-sketch-bottle", "coastal sketch bottle",    "decor",     849, "an insulated bottle in hand-sketched coastal blues."],
  ["aqua-bear-frame",       "aqua bear frame",          "decor",     649, "a photo frame with a little aqua bear on guard."],
  ["elegance-alarm-clock",  "the elegance clock",       "decor",    1199, "a quiet, classic alarm clock for good mornings."],
  ["flower-pen",            "flower pen",               "charms",    249, "a pen that blooms. writes like spring."],
  ["gallery-frame",         "the gallery frame",        "decor",     799, "a clean frame that makes any photo look curated."],
  ["sculpted-glass-mug",    "sculpted glass mug",       "decor",     599, "a glass mug with a sculpted handle. dramatic, in a good way."],
  ["nice-all-day-mug",      "nice all day mason mug",   "decor",     549, "a green mason mug that says nice all day. it means it."],
  ["oh-buddy-mug",          "oh! buddy mug",            "decor",     649, "the kynq house mug. for your favourite buddy."],
  ["pulse-blue-bottle",     "pulse bottle, blue",       "decor",     799, "the kynq pulse bottle in deep blue. hydration, upgraded."],
  ["ice-cream-pen",         "kawaii ice cream pen",     "charms",    299, "a soft-serve pen too cute to lend out."],
  ["lavender-bunny-pen",    "lavender bunny pen",       "charms",    299, "a lavender bunny that happens to write."],
  ["mini-cottage-kit",      "mini cottage kit",         "plushies", 1499, "build a tiny cottage, keep it forever."],
  ["green-rimmed-clock",    "green-rimmed clock",       "decor",    1099, "a niche wall clock with a fresh green rim."],
  ["pink-love-frame",       "pink love frame",          "decor",     699, "a pink frame that spells it out: love."],
  ["pink-ombre-bottle",     "pink ombre bottle",        "decor",     749, "a bottle in sunset pink ombre."],
  ["pink-umbrella",         "little pink umbrella",     "plushies",  599, "a pink umbrella sized for small humans and big puddles."],
  ["princess-craft-kit",    "princess craft kit",       "plushies", 1199, "a craft kit fit for royalty in training."],
  ["gemstone-pen",          "rainbow gemstone pen",     "charms",    349, "a pen topped with a rainbow gemstone. for signing important things."],
  ["red-alarm-clock",       "the red alarm",            "decor",     999, "a bold red alarm clock. impossible to ignore, like a good friend."],
  ["fuzzy-heart-pen",       "fuzzy heart pen",          "charms",    249, "a red fuzzy heart on a pen. love notes, upgraded."],
  ["rocket-launcher",       "space mission launcher",   "plushies", 1399, "a rocket launcher kit for backyard space programs."],
  ["sunburst-clock",        "sunburst clock",           "decor",    1599, "a sunburst wall clock that turns time into decor."],
  ["sweet-time-bottle",     "sweet time bottle",        "decor",     699, "a teal-capped bottle for sweet, slow days."],
  ["pendulum-clock",        "warm pendulum clock",      "decor",    1799, "a warm brown pendulum clock. ticks like home."],
  ["bunny-mug",             "cute bunny mug",           "decor",     599, "a mug with bunny ears. mornings, softened."],
];

const CARE = ["wipe clean with a soft dry cloth", "keep out of direct sun"];

await connectDB();
const products = collection("products");

let created = 0, updated = 0;
for (let i = 0; i < ITEMS.length; i++) {
  const [slug, name, category, priceInr, short] = ITEMS[i];
  const existing = await products.get(slug);
  const product = {
    kind: "ready",
    id: existing?.id ?? `n-${String(i + 1).padStart(3, "0")}`,
    slug,
    name,
    shortDescription: short,
    longDescription: `${short} picked for the kynq shelf — checked, wrapped, and shipped with care from our studio.`,
    category,
    images: imgs(slug, name),
    price: { amount: priceInr * 100, currency: "INR" },
    inventory: 8 + ((i * 7) % 13),
    leadTimeDays: 2,
    materials: ["curated by kynq"],
    careNotes: CARE,
  };
  await products.set(slug, product);
  existing ? updated++ : created++;
}
console.log(`done: ${created} created, ${updated} updated.`);
await mongoose.connection.close();
process.exit(0);
