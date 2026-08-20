// Additive seed: upserts the Rakhi hamper collection into the products store.
// Safe to re-run (keyed by slug). Does NOT drop or touch existing products.
//   node src/gift/seed-rakhi.mjs
// Prices are the confirmed selling prices (vendor costs stay out of product data).
import dotenv from "dotenv"; dotenv.config();
import mongoose from "mongoose";
import connectDB from "./db.js";
import { collection } from "./store.js";

const imgs = (slug, count, alt) =>
  Array.from({ length: count }, (_, i) => ({ url: `/products/${slug}/${i + 1}.png`, alt }));

const CARE = ["keep the box upright in transit", "store contents away from direct sun"];
const MATERIALS = ["curated gift box", "hand-tied ribbon", "rakhi thread"];

const HAMPERS = [
  {
    slug: "rakhi-classic-hamper", name: "the family favourite", price: 59900, inventory: 10, images: 3,
    short: "the classic rakhi box — thread, treats, and a note.",
    long: "our signature rakhi hamper, packed in a keepsake box. inside: kitkat, lay's chips, netflix popcorn, dark fantasy bourbon biscuits, real fruit juice, unibic butter cookies, oreo cookies, bombay banta jamun shikanji, and a dairy milk on top.",
  },
  {
    slug: "rakhi-celebration-box", name: "the big day box", price: 59900, inventory: 10, images: 3,
    short: "a full celebration in one rakhi box.",
    long: "the big day box goes big. inside: cadbury dairy milk, 5 star, kitkat, milkybar, veggie chips, pringles, paper boat aam panna, and a premium notepad to write the year down.",
  },
  {
    slug: "rakhi-special-hamper", name: "best brother box", price: 49900, inventory: 8, images: 2,
    short: "the rakhi hamper for the favourite sibling.",
    long: "for the best brother, says so on the card. inside: waffy orange wafer biscuits, britannia treat chocolate biscuits, oreo cookies, paper boat aamras, and a hand-tied rakhi.",
  },
  {
    slug: "rakhi-purple-hamper", name: "the purple bond", price: 49900, inventory: 6, images: 3,
    short: "the kynq purple hamper — rakhi edition of our house box.",
    long: "our house purple box, dressed for rakhi. inside: crax chips, cadbury dairy milk, hershey's kisses milk 'n' truffle, date bites choco nuts, a thums up can, good day biscuits, and a hand-tied rakhi.",
  },
  {
    slug: "rakhi-green-delight", name: "green crunch crate", price: 49900, inventory: 10, images: 3,
    short: "a fresh green rakhi hamper — calm, crisp, thoughtful.",
    long: "green from top to bottom. inside: 7up, kurkure playz puffcorn, unibic cookies, gobbles corn bites, pringles sour cream & onion, a paper boat drink, and a hand-tied rakhi.",
  },
  {
    slug: "rakhi-yellow-joy", name: "marigold morning", price: 49900, inventory: 10, images: 3,
    short: "sunshine in a rakhi box.",
    long: "marigold tones, impossible to open without smiling. inside: a hand-tied rakhi, greeting card, lay's chips, two nestlé milkybars, munch, chupa chups, and motinglo candy.",
  },
  {
    slug: "rakhi-red-hamper", name: "the scarlet tie", price: 49900, inventory: 10, images: 3,
    short: "the bold red rakhi box — festive and classic.",
    long: "deep red, the way rakhi looks in memory. inside: lay's chips, choki choki, cookie biskit, lotte choco pie, magic pops, a perk chocolate, and a hand-tied rakhi.",
  },
  {
    slug: "rakhi-sweet-treat", name: "the sugar rush", price: 49900, inventory: 12, images: 3,
    short: "a rakhi hamper for the sweet tooth — with a salty side.",
    long: "sweet with a salty streak. inside: cadbury 5 star (pack of six), a coca-cola can, pringles original, haldiram's moong dal, haldiram's bhujia, bingo chips, and a hand-tied rakhi.",
  },
  {
    slug: "rakhi-mini-hamper", name: "the little knot", price: 29900, inventory: 15, images: 3,
    short: "a small rakhi box that says plenty.",
    long: "the mini keeps it simple. inside: a hand-tied rakhi, greeting card, cadbury dairy milk, cadbury shots, 5 star, lotte choco pie, and a candy for the road.",
  },
];

await connectDB();
const products = collection("products");

let created = 0, updated = 0;
for (let i = 0; i < HAMPERS.length; i++) {
  const h = HAMPERS[i];
  const existing = await products.get(h.slug);
  const product = {
    kind: "ready",
    id: existing?.id ?? `r-${String(i + 1).padStart(3, "0")}`,
    slug: h.slug,
    name: h.name,
    shortDescription: h.short,
    longDescription: h.long,
    category: "decor",
    images: imgs(h.slug, h.images, h.name),
    price: { amount: h.price, currency: "INR" },
    inventory: h.inventory,
    leadTimeDays: 3,
    materials: MATERIALS,
    careNotes: CARE,
    makerNote: "packed and hand-tied in the kynq studio.",
  };
  await products.set(h.slug, product);
  existing ? updated++ : created++;
  console.log(`${existing ? "updated" : "created"} ${h.slug} — ₹${(h.price / 100).toLocaleString("en-IN")}`);
}
console.log(`done: ${created} created, ${updated} updated.`);
await mongoose.connection.close();
process.exit(0);
