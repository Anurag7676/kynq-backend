// Removes every account seed-demo-users.mjs created (isDemoSeed: true,
// @kynq.demo emails). Run this before real users ever share the staging DB
// with these, or whenever you want a clean slate.
import "dotenv/config";
import mongoose from "mongoose";

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI not set.");
  await mongoose.connect(process.env.MONGO_URI);
  const users = mongoose.connection.collection("users");
  const match = { $or: [{ isDemoSeed: true }, { email: /@kynq\.demo$/ }] };
  const ids = (await users.find(match).project({ id: 1, email: 1 }).toArray());
  if (ids.length === 0) { console.log("No demo accounts found."); await mongoose.disconnect(); return; }
  console.log(`Removing ${ids.length} demo accounts:`);
  ids.forEach((u) => console.log(`  ${u.email}`));
  const r = await users.deleteMany(match);
  console.log(`\nDeleted ${r.deletedCount} users.`);
  await mongoose.disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
