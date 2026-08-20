import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Inline schemas
const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  slug: { type: String, unique: true },
  description: String,
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
  image: { type: String, default: null },
  icon: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  displayOrder: { type: Number, default: 0 },
}, { timestamps: true });

categorySchema.pre("save", function (next) {
  if (this.isModified("name")) {
    this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }
  next();
});

const imageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  alt: { type: String, default: "Product Image" },
  isFeatured: { type: Boolean, default: false },
});

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  shortDescription: String,
  isRequestQuote: { type: Boolean, default: false },
  price: { type: Number, default: 0 },
  comparePrice: { type: Number, default: 0 },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
  uom: { type: String, trim: true, default: null },
  brand: String,
  sku: { type: String, required: true, unique: true },
  stock: { type: Number, default: 0 },
  images: [imageSchema],
  tags: [String],
  isFeatured: { type: Boolean, default: false },
  isPublished: { type: Boolean, default: true },
  rating: { type: Number, default: 0 },
  numReviews: { type: Number, default: 0 },
}, { timestamps: true });

const Category = mongoose.model("Category", categorySchema);
const Product = mongoose.model("Product", productSchema);

// Categories
const CATEGORIES = [
  { name: "Plushies", description: "Hug-sized companions and craft kits" },
  { name: "Candles", description: "Hand-poured mood lighting" },
  { name: "Decor", description: "Shelf main-characters and home accents" },
  { name: "Jewellery", description: "Looks-expensive accessories" },
  { name: "Charms", description: "Clip-on cute accessories and keychains" },
];

// Products: [slug, name, category, price, shortDesc, imageDir, imageCount, tags]
const PRODUCTS = [
  ["rainbow-snuggle-bunny", "rainbow snuggle bunny", "Plushies", 899, "a crochet bunny in rainbow pastels. soft enough to nap with.", "Rainbow Snuggle Bunny", 5, []],
  ["pocket-penguin", "pocket penguin buddy", "Plushies", 599, "a tiny crochet penguin that fits in your pocket. instant friend.", "CROCHET/Pocket Penguin Buddy", 4, []],
  ["bear-buddies-kit", "bear buddies study kit", "Plushies", 1299, "a crochet bear + desk accessories. for focused kids and anxious adults.", "Bear Buddies Study Kit", 5, []],
  ["dino-paint-kit", "dino paint adventure kit", "Plushies", 1199, "a tiny dinosaur that comes with its own paint set.", "Dino Paint Adventure Kit", 5, []],
  ["happy-monkey-kit", "happy monkey school kit", "Plushies", 1099, "a crochet monkey pencil topper + stationery set.", "Happy Monkey School Kit", 5, []],
  ["architect-toy-set", "little architect set", "Plushies", 1299, "a building set for tiny city planners.", "PRODUCT-IMAGE-NEW/Basic Architect Toy Set", 3, []],
  ["catapult-basketball", "catapult hoops", "Plushies", 999, "tabletop catapult basketball.", "PRODUCT-IMAGE-NEW/Catapult Basketball Tournament Game", 3, []],
  ["mini-cottage-kit", "mini cottage kit", "Plushies", 1499, "build a tiny cottage, keep it forever.", "PRODUCT-IMAGE-NEW/Mini Cottage Kit", 3, []],
  ["pink-umbrella", "little pink umbrella", "Plushies", 599, "a pink umbrella sized for small humans.", "PRODUCT-IMAGE-NEW/Pink children's umbrella", 3, []],
  ["princess-craft-kit", "princess craft kit", "Plushies", 1199, "a craft kit fit for royalty in training.", "PRODUCT-IMAGE-NEW/Princess Craft Kit", 3, []],
  ["rocket-launcher", "space mission launcher", "Plushies", 1399, "a rocket launcher kit for backyard space programs.", "PRODUCT-IMAGE-NEW/Rocket Launcher Space Mission", 3, []],

  ["aroma-bliss-trio", "aroma bliss candle trio", "Candles", 1499, "three hand-poured candles in complementary scents.", "Aroma Bliss Candle Trio", 5, []],
  ["lavender-haze-candle", "lavender haze candle", "Candles", 799, "a purple glass candle that smells like calm evenings.", "CANDLE PURPLE", 5, []],
  ["mint-glow-candle", "mint glow glass candle", "Candles", 699, "a fresh mint candle in a glowing glass vessel.", "Mint Glow Glass Candle", 4, []],
  ["royal-glow-pillar", "royal glow pillar candle", "Candles", 899, "a tall pillar candle that turns any shelf into a shrine.", "Royal Glow Pillar Candle", 5, []],

  ["dream-carriage", "dream carriage crystal decor", "Decor", 1599, "a crystal carriage that catches light like a memory.", "Dream Carriage Crystal Decor", 5, []],
  ["the-hourglass", "the hourglass", "Decor", 1199, "a sand timer that makes waiting beautiful.", "HOURGLASS", 5, []],
  ["eiffel-in-a-frame", "eiffel in a frame", "Decor", 999, "the eiffel tower, framed. paris without the flight.", "eiffel tower", 5, []],
  ["ship-in-a-bottle", "ship in a bottle", "Decor", 1399, "a hand-set miniature ship inside glass.", "ship-in-bottle", 5, []],
  ["ship-shadow-box", "ship shadow box", "Decor", 1299, "a layered ship silhouette inside a shadow frame.", "SHIP SQUARE UNIQUE", 4, []],
  ["coastal-sketch-bottle", "coastal sketch bottle", "Decor", 849, "an insulated bottle in hand-sketched coastal blues.", "PRODUCT-IMAGE-NEW/Coastal Sketch Insulated Bottle", 3, []],
  ["aqua-bear-frame", "aqua bear frame", "Decor", 649, "a photo frame with a little aqua bear on guard.", "PRODUCT-IMAGE-NEW/Cute Aqua Bear Frame", 3, []],
  ["elegance-alarm-clock", "the elegance clock", "Decor", 1199, "a quiet, classic alarm clock for good mornings.", "PRODUCT-IMAGE-NEW/Elegance Alarm Clock", 3, []],
  ["gallery-frame", "the gallery frame", "Decor", 799, "a clean frame that makes any photo look curated.", "PRODUCT-IMAGE-NEW/Gallery Frame", 3, []],
  ["sculpted-glass-mug", "sculpted glass mug", "Decor", 599, "a glass mug with a sculpted handle.", "PRODUCT-IMAGE-NEW/Glass Mug with Sculpted Handle", 3, []],
  ["nice-all-day-mug", "nice all day mason mug", "Decor", 549, "a green mason mug that says nice all day.", "PRODUCT-IMAGE-NEW/Green Nice All Day Mason Mug", 3, []],
  ["oh-buddy-mug", "oh buddy mug", "Decor", 649, "the kynq house mug. for your favourite buddy.", "PRODUCT-IMAGE-NEW/KYNQ Oh! Buddy Mug", 3, []],
  ["pulse-blue-bottle", "pulse bottle blue", "Decor", 799, "the kynq pulse bottle in deep blue.", "PRODUCT-IMAGE-NEW/KYNQ Pulse blue Bottle", 3, []],
  ["green-rimmed-clock", "green-rimmed clock", "Decor", 1099, "a niche wall clock with a fresh green rim.", "PRODUCT-IMAGE-NEW/Niche Green-Rimmed Clock", 3, []],
  ["pink-love-frame", "pink love frame", "Decor", 699, "a pink frame that spells it out: love.", "PRODUCT-IMAGE-NEW/Pink LOVE Frame", 3, []],
  ["pink-ombre-bottle", "pink ombre bottle", "Decor", 749, "a bottle in sunset pink ombre.", "PRODUCT-IMAGE-NEW/Pink Ombre Bottle", 3, []],
  ["red-alarm-clock", "the red alarm", "Decor", 999, "a bold red alarm clock.", "PRODUCT-IMAGE-NEW/Red Alarm Clock", 3, []],
  ["sunburst-clock", "sunburst clock", "Decor", 1599, "a sunburst wall clock that turns time into decor.", "PRODUCT-IMAGE-NEW/Sunburst Clock Lookbook", 3, []],
  ["sweet-time-bottle", "sweet time bottle", "Decor", 699, "a teal-capped bottle for sweet, slow days.", "PRODUCT-IMAGE-NEW/Teal-Capped Sweet Time Bottle", 3, []],
  ["pendulum-clock", "warm pendulum clock", "Decor", 1799, "a warm brown pendulum clock. ticks like home.", "PRODUCT-IMAGE-NEW/Warm Brown Pendulum Clock", 3, []],
  ["bunny-mug", "cute bunny mug", "Decor", 599, "a mug with bunny ears. mornings, softened.", "PRODUCT-IMAGE-NEW/cute bunny mug", 3, []],

  ["beaded-gold-necklace", "beaded gold necklace", "Jewellery", 699, "gold-toned chain with colourful bead accents.", "Elegant gold necklace with colorful beads", 5, []],
  ["crystal-silver-set", "crystal silver jewellery set", "Jewellery", 999, "a silver-toned set with crystal insets.", "Elegant silver jewelry set with crystals", 5, []],

  ["blossom-hair-claw", "blossom bloom hair claw", "Charms", 349, "a crochet flower hair claw.", "CROCHET/Blossom Bloom Hair Claw", 4, []],
  ["cherry-bow-charm", "cherry bow charm", "Charms", 299, "a tiny crochet cherry with a bow.", "CROCHET/Cherry Bow Charm", 5, []],
  ["cloud-puff-scrunchie", "cloud puff scrunchie", "Charms", 399, "a fluffy crochet scrunchie that looks like a cloud.", "CROCHET/Cloud Puff Scrunchie", 5, []],
  ["evil-eye-charm", "evil eye charm", "Charms", 249, "a crochet evil eye. protection, but make it cute.", "CROCHET/EvIL eyes", 5, []],
  ["everbloom-rose-keychain", "everbloom rose keychain", "Charms", 349, "a crochet rose that never wilts.", "CROCHET/EverBloom Rose Keychain", 4, []],
  ["watermelon-charm", "juicy watermelon charm", "Charms", 249, "a crochet watermelon slice.", "CROCHET/Juicy Slice Charm watermelon", 5, []],
  ["moonglow-keychain", "moonglow keychain", "Charms", 349, "a crochet crescent moon keychain.", "CROCHET/MoonGlow Charm Keychain", 5, []],
  ["princess-ribbon-bow", "princess ribbon hair bow", "Charms", 349, "a crochet bow with ribbon detail.", "CROCHET/Princess Ribbon Hair Bow", 4, []],
  ["sunny-bloom-bow", "sunny bloom hair bow", "Charms", 349, "a sunny crochet flower bow.", "CROCHET/Sunny Bloom Hair Bow", 4, []],
  ["sunflower-keychain", "sunflower keychain", "Charms", 349, "a crochet sunflower.", "CROCHET/Sunflower Keychain", 5, []],
  ["tiny-turtle-keychain", "tiny turtle keychain", "Charms", 399, "a crochet turtle slow enough to match your pace.", "CROCHET/Tiny Turtle Charm Keychain", 5, []],
  ["flower-pen", "flower pen", "Charms", 249, "a pen that blooms. writes like spring.", "PRODUCT-IMAGE-NEW/Flower Pen Still", 3, []],
  ["ice-cream-pen", "kawaii ice cream pen", "Charms", 299, "a soft-serve pen too cute to lend out.", "PRODUCT-IMAGE-NEW/Kawaii Ice Cream Pen", 3, []],
  ["lavender-bunny-pen", "lavender bunny pen", "Charms", 299, "a lavender bunny that happens to write.", "PRODUCT-IMAGE-NEW/Lavender Bunny Pen", 3, []],
  ["gemstone-pen", "rainbow gemstone pen", "Charms", 349, "a pen topped with a rainbow gemstone.", "PRODUCT-IMAGE-NEW/Rainbow Gemstone Pen", 3, []],
  ["fuzzy-heart-pen", "fuzzy heart pen", "Charms", 249, "a red fuzzy heart on a pen.", "PRODUCT-IMAGE-NEW/Red Fuzzy Heart Pen", 3, []],

  ["rakhi-classic-hamper", "the family favourite", "Decor", 599, "the classic rakhi box with thread, treats, and a note.", "RAKHI HAMPER/Classic Rakhi Hamper", 3, ["rakhi"]],
  ["rakhi-celebration-box", "the big day box", "Decor", 599, "a full celebration in one rakhi box.", "RAKHI HAMPER/Celebration Rakhi Box", 3, ["rakhi"]],
  ["rakhi-special-hamper", "best brother box", "Decor", 499, "the rakhi hamper for the favourite sibling.", "RAKHI HAMPER/special Rakhi Hamper", 2, ["rakhi"]],
  ["rakhi-purple-hamper", "the purple bond", "Decor", 499, "the kynq purple hamper, rakhi edition.", "RAKHI HAMPER/Purple Gift Hamper Collection", 3, ["rakhi"]],
  ["rakhi-green-delight", "green crunch crate", "Decor", 499, "a fresh green rakhi hamper.", "RAKHI HAMPER/Green Delight Rakhi Hamper", 3, ["rakhi"]],
  ["rakhi-yellow-joy", "marigold morning", "Decor", 499, "sunshine in a rakhi box.", "RAKHI HAMPER/Rakhi Yellow joy Hamper", 3, ["rakhi"]],
  ["rakhi-red-hamper", "the scarlet tie", "Decor", 499, "the bold red rakhi box.", "RAKHI HAMPER/Rakhi red Hamper", 3, ["rakhi"]],
  ["rakhi-sweet-treat", "the sugar rush", "Decor", 499, "a rakhi hamper for the sweet tooth.", "RAKHI HAMPER/Sweet Treat Hamper", 3, ["rakhi"]],
  ["rakhi-mini-hamper", "the little knot", "Decor", 299, "a small rakhi box that says plenty.", "RAKHI HAMPER/Mini Rakhi Hamper", 3, ["rakhi"]],
];

// Helpers
function copyImages(srcDirName, slug, count) {
  const srcDir = path.join(__dirname, "../Product-Images", srcDirName);
  const destDir = path.join(__dirname, "public/products", slug);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const copied = [];
  const files = fs.readdirSync(srcDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
  for (let i = 0; i < Math.min(count, files.length); i++) {
    const destName = `${i + 1}.png`;
    const destPath = path.join(destDir, destName);
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(path.join(srcDir, files[i]), destPath);
    }
    copied.push(`/products/${slug}/${destName}`);
  }
  return copied;
}

// Main
async function seed() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected.\n");

  // 1. Categories
  console.log("--- Seeding categories ---");
  const categoryMap = {};
  for (const cat of CATEGORIES) {
    let existing = await Category.findOne({ name: cat.name });
    if (!existing) {
      existing = await Category.create(cat);
      console.log("  created: " + cat.name);
    } else {
      console.log("  exists:  " + cat.name);
    }
    categoryMap[cat.name] = existing._id;
  }

  // 1b. Clean up gift-store products (have _key field, wrong schema)
  const rawCol = mongoose.connection.collection("products");
  const giftCount = await rawCol.countDocuments({ _key: { $exists: true } });
  if (giftCount > 0) {
    console.log("  Removing " + giftCount + " gift-store documents from products collection...");
    await rawCol.deleteMany({ _key: { $exists: true } });
  }

  // 2. Products
  console.log("\n--- Seeding products ---");
  let created = 0, skipped = 0, imgErrors = 0;

  for (const [slug, name, catName, price, shortDesc, imgDir, imgCount, tags] of PRODUCTS) {
    const existing = await Product.findOne({ slug });
    if (existing) { skipped++; continue; }

    let images = [];
    try {
      const urls = copyImages(imgDir, slug, imgCount);
      images = urls.map((url, i) => ({ url, alt: name, isFeatured: i === 0 }));
    } catch (err) {
      imgErrors++;
      console.log("  WARN images failed for " + slug + ": " + err.message);
    }

    const skuSlug = slug.toUpperCase().replace(/-/g, "").slice(0, 12);
    const skuSuffix = Math.random().toString(36).slice(2, 6);

    await Product.create({
      name,
      slug,
      description: shortDesc + " Picked for the kynq shelf, checked, wrapped, and shipped with care from our studio.",
      shortDescription: shortDesc,
      price,
      category: categoryMap[catName],
      sku: "KYNQ-" + skuSlug + "-" + skuSuffix,
      stock: 20,
      images,
      tags,
      isPublished: true,
    });
    created++;
    console.log("  OK " + slug + "  Rs." + price + "  [" + catName + "]  imgs:" + images.length);
  }

  console.log("\n--- Done ---");
  console.log("  Categories: " + CATEGORIES.length);
  console.log("  Products:   " + created + " created, " + skipped + " skipped, " + imgErrors + " image errors");
  console.log("  Total now:  " + await Product.countDocuments());

  await mongoose.connection.close();
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
