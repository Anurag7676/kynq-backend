// Seeds a handful of dummy accounts into the STAGING database for the
// developer's own testing — populated matching queue, friend lists,
// history, etc. to poke at. Not shown to real users as anything; these are
// just ordinary accounts sitting in the same `users` collection.
//
// Idempotent — safe to re-run. Upserts by email, so re-running just refreshes
// the same N accounts instead of creating duplicates.
// Every seeded account's email ends in @kynq.demo, so they're always easy to
// find and wipe later: `node scripts/remove-demo-users.mjs`.
import "dotenv/config";
import mongoose from "mongoose";
import { getOrCreateUser, saveUser } from "../src/gift/session.js";
import { setExtraProfile, INTEREST_TOPICS, GENDERS } from "../src/kynqExtra/profile.js";

const COUNT = Number(process.argv[2]) || 10;
const CITIES = [
  { city: "Mumbai", state: "Maharashtra" }, { city: "Delhi", state: "Delhi" }, { city: "Bangalore", state: "Karnataka" },
  { city: "Pune", state: "Maharashtra" }, { city: "Hyderabad", state: "Telangana" }, { city: "Chennai", state: "Tamil Nadu" },
  { city: "Jaipur", state: "Rajasthan" }, { city: "Kolkata", state: "West Bengal" },
];
const NAMES = ["Aarav", "Vihaan", "Ishaan", "Kabir", "Ananya", "Diya", "Myra", "Saanvi", "Arjun", "Riya", "Kavya", "Reyansh"];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomDob = () => { const age = 19 + Math.floor(Math.random() * 20); const y = new Date().getFullYear() - age; return `${y}-01-15`; };

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI not set — refusing to run without knowing which database this writes to.");
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to ${mongoose.connection.name} (${process.env.MONGO_URI.replace(/\/\/.*@/, "//<redacted>@")})`);
  console.log(`Seeding ${COUNT} demo accounts…\n`);

  const created = [];
  for (let i = 1; i <= COUNT; i += 1) {
    const name = `${rand(NAMES)} Demo ${i}`;
    const email = `demo${i}@kynq.demo`;
    // eslint-disable-next-line no-await-in-loop
    const user = await getOrCreateUser(email, name);
    // eslint-disable-next-line no-await-in-loop
    await saveUser({ ...user, isDemoSeed: true }); // tag for easy cleanup — harmless extra field
    const loc = rand(CITIES);
    try {
      // eslint-disable-next-line no-await-in-loop
      await setExtraProfile(user.id, {
        dob: randomDob(),
        interests: [rand(INTEREST_TOPICS), rand(INTEREST_TOPICS)],
        locationScope: "worldwide",
        city: loc.city,
        gender: rand(GENDERS),
      });
    } catch (err) {
      // dob already set from a previous run — fine, everything else still applies.
      if (!/date of birth/.test(err.message)) throw err;
    }
    created.push({ id: user.id, email, name });
    console.log(`  ${email.padEnd(20)} ${name.padEnd(20)} ${loc.city}`);
  }

  console.log(`\n${created.length} demo accounts ready in the staging DB.`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
