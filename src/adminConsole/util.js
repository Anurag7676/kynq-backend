// Shared helpers for the admin console: India-time day maths, a tiny cache, masking.
import mongoose from "mongoose";

export const DAY = 86_400_000;
const IST_OFFSET = 19_800_000; // UTC+5:30, no daylight saving

export const col = (name) => mongoose.connection.collection(name);

/** Real users only: the seeded demo accounts are never counted. */
export const REAL_USER = { isDemoSeed: { $ne: true } };

const emailList = (v) => String(v || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
/**
 * Ids of accounts that must never count as real money or real customers: seeded demo accounts,
 * the admins themselves (ADMIN_EMAILS), anything in TEST_USER_EMAILS, and any @example.com address.
 */
export function excludedUserIds() {
  return cached("excluded-user-ids", 300_000, () => {
    const emails = [...emailList(process.env.ADMIN_EMAILS), ...emailList(process.env.TEST_USER_EMAILS)];
    return col("users").distinct("id", { $or: [{ isDemoSeed: true }, { email: { $in: emails } }, { email: /@example\.com$/i }] });
  });
}

export const istDay = (ts) => new Date(ts + IST_OFFSET).toISOString().slice(0, 10);
export const istHour = (ts) => new Date(ts + IST_OFFSET).getUTCHours();
export const startOfIstDay = (ts) => Math.floor((ts + IST_OFFSET) / DAY) * DAY - IST_OFFSET;

/** { days, from, to }: `from` is the start of the first India-time day in the range. */
export function rangeFromQuery(query) {
  const raw = Number(query?.days);
  const days = [7, 30, 90].includes(raw) ? raw : 30;
  const to = Date.now();
  const from = startOfIstDay(to) - (days - 1) * DAY;
  return { days, from, to };
}

export function dayKeys(from, to) {
  const keys = [];
  for (let t = startOfIstDay(from); t <= to; t += DAY) keys.push(istDay(t));
  return keys;
}

/** Fill a { date -> value } map into one entry per day (zero where missing). */
export function fillSeries(keys, byDate, make) {
  return keys.map((date) => make(date, byDate.get(date)));
}

// MongoDB expression that turns a numeric epoch-ms field into an India-time YYYY-MM-DD string.
export const dayExpr = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: { $toDate: field }, timezone: "Asia/Kolkata" } });

export function maskEmail(email) {
  if (!email || typeof email !== "string") return null;
  return email.replace(/^(.{1,2}).*(@.*)$/, "$1***$2");
}

/** 9876543210 -> +91 ******3210 (the list never shows the full number; the detail page does). */
export function maskPhone(phone) {
  if (!phone || typeof phone !== "string") return null;
  return `+91 ${"*".repeat(Math.max(phone.length - 4, 0))}${phone.slice(-4)}`;
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function pageParams(query, maxLimit = 100) {
  const page = Math.max(1, Math.floor(Number(query?.page)) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(Number(query?.limit)) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

// ─── Cache ───
// The server is small, so heavy numbers are computed at most once a minute per view, and
// concurrent requests share one computation. Nothing polls; this only smooths repeat opens.
const store = new Map();
export async function cached(key, ttlMs, compute) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value;
  if (hit?.pending) return hit.pending;
  const pending = Promise.resolve()
    .then(compute)
    .then((value) => { store.set(key, { value, expires: Date.now() + ttlMs }); return value; })
    .catch((err) => { store.delete(key); throw err; });
  store.set(key, { ...(hit || {}), pending });
  return pending;
}
export const dropCache = (prefix) => { for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k); };

/** Users by id, as a Map (id -> { id, name, email, ... }). */
export async function usersById(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const docs = await col("users").find({ id: { $in: unique } }).toArray();
  return new Map(docs.map((u) => [u.id, u]));
}

/** Restrict/unrestrict one user directly by id (same field the app reads), without loading every user. */
export async function setRestrictedById(id, restricted) {
  const r = await col("users").updateOne({ id }, { $set: { kynqExtraRestricted: !!restricted } });
  return r.matchedCount > 0;
}

export async function setAmbassadorById(id, enrolled) {
  const r = await col("users").updateOne({ id }, { $set: { isAmbassador: !!enrolled, ...(enrolled ? { ambassadorSince: Date.now() } : {}) } });
  return r.matchedCount > 0;
}

export const displayName = (u) => (u?.name || (u?.email ? u.email.split("@")[0] : null) || "Unknown");

// ─── Indexes (created once, on first use; safe to repeat) ───
let indexesReady = null;
export function ensureConsoleIndexes() {
  indexesReady ??= Promise.all([
    col("users").createIndex({ createdAt: -1 }),
    col("users").createIndex({ id: 1 }),
    col("calls").createIndex({ startedAt: -1 }),
    col("calls").createIndex({ participantA: 1 }),
    col("calls").createIndex({ participantB: 1 }),
    col("wallet_transactions").createIndex({ createdAt: -1 }),
    col("wallet_transactions").createIndex({ type: 1, createdAt: -1 }),
    col("coin_orders").createIndex({ status: 1, paidAt: -1 }),
    col("coin_orders").createIndex({ userId: 1 }),
    col("coin_orders").createIndex({ createdAt: -1 }),
    col("game_sessions").createIndex({ createdAt: -1 }),
    col("contact-messages").createIndex({ createdAt: -1 }),
    col("admin_audit").createIndex({ at: -1 }),
    col("admin_inbox_status").createIndex({ status: 1 }),
  ]).catch((err) => { indexesReady = null; console.error("[console] index creation failed:", err.message); });
  return indexesReady;
}
