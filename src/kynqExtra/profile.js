// Kynq Extra profile fields — layered onto the EXISTING kynq `users`
// collection (Backend/src/gift/session.js), not a parallel user system.
// Matchmaking requires a real, verified date of birth before a user is
// ever allowed into the queue — this is a hard gate, not a checkbox.
import { collection } from "../gift/store.js";
import { findUserById } from "../gift/session.js";

const users = collection("users");
const MIN_AGE = 18;

function ageFromDob(dobIso) {
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

// Returns { ok, reason? } — never throws, safe to call from a route.
export function validateDob(dobIso) {
  const age = ageFromDob(dobIso);
  if (age == null) return { ok: false, reason: "enter a valid date of birth" };
  if (age < MIN_AGE) return { ok: false, reason: `you must be ${MIN_AGE}+ to use kynq extra` };
  if (age > 120) return { ok: false, reason: "enter a valid date of birth" };
  return { ok: true, age };
}

// Interests are a fixed vocabulary, capped at 3 — matches the matchmaker's
// topic-overlap scoring, which only makes sense against a known, finite set.
export const INTEREST_TOPICS = [
  "music", "gaming", "movies", "anime", "relationships", "study", "career",
  "memes", "deep-talks", "travel", "food", "sports", "art", "technology",
  "fitness", "random",
];
export const LOCATION_SCOPES = ["same-city", "same-state", "same-country", "worldwide"];

export async function getExtraProfile(userId) {
  const user = await findUserById(userId);
  if (!user) return null;
  return {
    dob: user.dob ?? null,
    ageVerified: !!user.ageVerified,
    interests: user.interests ?? [],
    locationScope: user.locationScope ?? "same-country",
    bio: user.bio ?? "",
  };
}

// Set once at Kynq Extra onboarding. dob is immutable after the first
// successful set — resubmitting a different DOB to game the age gate is
// rejected, not silently overwritten.
export async function setExtraProfile(userId, { dob, interests, locationScope, bio }) {
  const user = await findUserById(userId);
  if (!user) throw new Error("user not found");

  const patch = {};
  if (dob && !user.dob) {
    const result = validateDob(dob);
    if (!result.ok) throw new Error(result.reason);
    patch.dob = dob;
    patch.ageVerified = true;
  } else if (dob && user.dob) {
    throw new Error("date of birth can't be changed once set");
  }
  if (interests) {
    const cleaned = [...new Set(interests)].filter((t) => INTEREST_TOPICS.includes(t)).slice(0, 3);
    patch.interests = cleaned;
  }
  if (locationScope) {
    if (!LOCATION_SCOPES.includes(locationScope)) throw new Error("invalid location scope");
    patch.locationScope = locationScope;
  }
  if (bio != null) patch.bio = String(bio).slice(0, 200);

  const next = { ...user, ...patch };
  await users.set(user.email.toLowerCase().trim(), next);
  return getExtraProfile(userId);
}

export async function isAgeGateCleared(userId) {
  const user = await findUserById(userId);
  return !!(user?.ageVerified && user?.dob);
}
