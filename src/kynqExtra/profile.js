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

// kynq operates in India (INR-only throughout the rest of the site), so
// Kynq Extra's location matching is scoped to Indian cities for V1 rather
// than a general geocoder — a fixed, curated list, same pattern as
// INTEREST_TOPICS. State is looked up FROM the city (never trusted as a
// separate client-supplied field) so "city" and "state" can never disagree.
export const INDIAN_CITIES = [
  { city: "Mumbai", state: "Maharashtra" }, { city: "Delhi", state: "Delhi" },
  { city: "Bangalore", state: "Karnataka" }, { city: "Hyderabad", state: "Telangana" },
  { city: "Ahmedabad", state: "Gujarat" }, { city: "Chennai", state: "Tamil Nadu" },
  { city: "Kolkata", state: "West Bengal" }, { city: "Surat", state: "Gujarat" },
  { city: "Pune", state: "Maharashtra" }, { city: "Jaipur", state: "Rajasthan" },
  { city: "Lucknow", state: "Uttar Pradesh" }, { city: "Kanpur", state: "Uttar Pradesh" },
  { city: "Nagpur", state: "Maharashtra" }, { city: "Indore", state: "Madhya Pradesh" },
  { city: "Thane", state: "Maharashtra" }, { city: "Bhopal", state: "Madhya Pradesh" },
  { city: "Visakhapatnam", state: "Andhra Pradesh" }, { city: "Patna", state: "Bihar" },
  { city: "Vadodara", state: "Gujarat" }, { city: "Ghaziabad", state: "Uttar Pradesh" },
  { city: "Ludhiana", state: "Punjab" }, { city: "Agra", state: "Uttar Pradesh" },
  { city: "Nashik", state: "Maharashtra" }, { city: "Faridabad", state: "Haryana" },
  { city: "Meerut", state: "Uttar Pradesh" }, { city: "Rajkot", state: "Gujarat" },
  { city: "Varanasi", state: "Uttar Pradesh" }, { city: "Srinagar", state: "Jammu and Kashmir" },
  { city: "Aurangabad", state: "Maharashtra" }, { city: "Dhanbad", state: "Jharkhand" },
  { city: "Amritsar", state: "Punjab" }, { city: "Navi Mumbai", state: "Maharashtra" },
  { city: "Prayagraj", state: "Uttar Pradesh" }, { city: "Ranchi", state: "Jharkhand" },
  { city: "Howrah", state: "West Bengal" }, { city: "Coimbatore", state: "Tamil Nadu" },
  { city: "Jabalpur", state: "Madhya Pradesh" }, { city: "Gwalior", state: "Madhya Pradesh" },
  { city: "Vijayawada", state: "Andhra Pradesh" }, { city: "Jodhpur", state: "Rajasthan" },
  { city: "Madurai", state: "Tamil Nadu" }, { city: "Raipur", state: "Chhattisgarh" },
  { city: "Kota", state: "Rajasthan" }, { city: "Guwahati", state: "Assam" },
  { city: "Chandigarh", state: "Chandigarh" }, { city: "Thiruvananthapuram", state: "Kerala" },
  { city: "Kochi", state: "Kerala" }, { city: "Mysore", state: "Karnataka" },
  { city: "Noida", state: "Uttar Pradesh" }, { city: "Gurugram", state: "Haryana" },
];
const CITY_BY_NAME = new Map(INDIAN_CITIES.map((c) => [c.city, c]));

export async function getExtraProfile(userId) {
  const user = await findUserById(userId);
  if (!user) return null;
  return {
    dob: user.dob ?? null,
    ageVerified: !!user.ageVerified,
    interests: user.interests ?? [],
    locationScope: user.locationScope ?? "same-country",
    city: user.city ?? null,
    state: user.state ?? null,
    country: user.city ? "India" : null,
    bio: user.bio ?? "",
  };
}

// Set once at Kynq Extra onboarding. dob is immutable after the first
// successful set — resubmitting a different DOB to game the age gate is
// rejected, not silently overwritten.
export async function setExtraProfile(userId, { dob, interests, locationScope, city, bio }) {
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
  if (city) {
    const match = CITY_BY_NAME.get(city);
    if (!match) throw new Error("unsupported city — pick one from the list");
    patch.city = match.city;
    patch.state = match.state;
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

// Minimal, safe-to-expose info about ANOTHER user — just enough for the
// 7-Day Challenge UI to show who you're challenging instead of a raw id.
// Deliberately excludes email, dob, and everything else in the account.
export async function getPublicName(userId) {
  const user = await findUserById(userId);
  if (!user) return null;
  return { id: user.id, name: user.name || "someone" };
}
