// Seeds Mongo from the extracted catalogue JSON on first boot (when empty).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { collection } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "seed-data");

function load(name) {
  const p = path.join(DIR, `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function seedCollection(name, rows, keyOf) {
  const col = collection(name);
  const count = await col.count();
  if (count > 0) return { name, skipped: count };
  for (const row of rows) await col.set(keyOf(row), row);
  return { name, seeded: rows.length };
}

export async function seedIfEmpty() {
  const results = [];
  results.push(await seedCollection("products", load("products"), (p) => p.slug));
  results.push(await seedCollection("drops", load("drops"), (d) => d.slug));
  results.push(await seedCollection("bundles", load("bundles"), (b) => b.slug));
  results.push(await seedCollection("journal", load("journal"), (a) => a.slug));
  results.push(await seedCollection("posts", load("posts"), (p) => p.id));
  console.log("[seed]", JSON.stringify(results));
}
