// Force re-seed: wipes catalogue collections and re-inserts from seed-data JSON.
import dotenv from "dotenv"; dotenv.config();
import mongoose from "mongoose";
import connectDB from "./db.js";
import { collection } from "./store.js";
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed-data");
const load = (n) => JSON.parse(fs.readFileSync(path.join(DIR, `${n}.json`), "utf8"));

await connectDB();
const specs = [
  ["products", load("products"), (p) => p.slug],
  ["drops", load("drops"), (d) => d.slug],
  ["bundles", load("bundles"), (b) => b.slug],
  ["journal", load("journal"), (a) => a.slug],
  ["posts", load("posts"), (p) => p.id],
];
for (const [name, rows, keyOf] of specs) {
  try { await mongoose.connection.collection(name).drop(); } catch {}
  const col = collection(name);
  for (const row of rows) await col.set(keyOf(row), row);
  console.log(`re-seeded ${name}: ${rows.length}`);
}
await mongoose.connection.close();
console.log("done.");
process.exit(0);
