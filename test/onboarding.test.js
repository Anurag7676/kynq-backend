// The one-time step before matching: confirming 18 or older plus a gender (the current screen),
// and the date-of-birth path older app builds still use. Both clear the same age gate.
// Run: MONGO_TEST_URI=mongodb://127.0.0.1:27099/kynq_test npm test
for (const k of ["EMAIL_USERNAME", "EMAIL_PASSWORD", "ADMIN_EMAIL"]) process.env[k] = "";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const URI = process.env.MONGO_TEST_URI;
const db = { skip: !URI && "set MONGO_TEST_URI to a throwaway database" };
if (URI && /mongodb\.net|prod/i.test(URI)) throw new Error("refusing to run against a non-local database");

let profile, getOrCreateUser;
before(async () => {
  if (!URI) return;
  await mongoose.connect(URI.replace(/\/[^/?]*(\?|$)/, "/kynq_test_onboarding$1"));
  await mongoose.connection.dropDatabase();
  profile = await import("../src/kynqExtra/profile.js");
  ({ getOrCreateUser } = await import("../src/gift/session.js"));
});
after(async () => { if (URI) await mongoose.disconnect(); });

test("confirming 18 or older with a gender clears the age gate", db, async () => {
  const { user } = await getOrCreateUser("adult@test.local", "Adult");
  assert.equal(await profile.isAgeGateCleared(user.id), false);
  const p = await profile.setExtraProfile(user.id, { adult: true, gender: "female" });
  assert.equal(p.ageVerified, true);
  assert.equal(p.gender, "female");
  assert.equal(p.dob, null, "no date of birth is asked for or stored");
  assert.equal(await profile.isAgeGateCleared(user.id), true);
});

test("not confirming is refused and leaves the gate closed", db, async () => {
  const { user } = await getOrCreateUser("unsure@test.local", "Unsure");
  await assert.rejects(profile.setExtraProfile(user.id, { adult: false, gender: "male" }), /18 or older/);
  assert.equal(await profile.isAgeGateCleared(user.id), false);
});

test("an unknown gender is refused", db, async () => {
  const { user } = await getOrCreateUser("g@test.local", "G");
  await assert.rejects(profile.setExtraProfile(user.id, { adult: true, gender: "robot" }), /invalid gender/);
});

test("older app builds that send a date of birth still work", db, async () => {
  const { user } = await getOrCreateUser("dob@test.local", "Dob");
  const p = await profile.setExtraProfile(user.id, { dob: "1995-04-12", interests: ["music"] });
  assert.equal(p.ageVerified, true);
  assert.equal(await profile.isAgeGateCleared(user.id), true);
  const { user: young } = await getOrCreateUser("young@test.local", "Young");
  const year = new Date().getFullYear() - 15;
  await assert.rejects(profile.setExtraProfile(young.id, { dob: `${year}-01-01` }), /18\+/);
});

test("saving preferences later doesn't need the confirmation again", db, async () => {
  const { user } = await getOrCreateUser("later@test.local", "Later");
  await profile.setExtraProfile(user.id, { adult: true, gender: "male" });
  const p = await profile.setExtraProfile(user.id, { interests: ["gaming"], gender: "other" });
  assert.deepEqual(p.interests, ["gaming"]);
  assert.equal(p.gender, "other");
  assert.equal(await profile.isAgeGateCleared(user.id), true);
});
