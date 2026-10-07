// Creator referral program — the write path and data model. Read-side
// aggregation for the admin console lives in adminConsole/creators.js.
//
//   1. Admin creates a creator with a short readable code → link kynq.in/?creator=<code>.
//   2. A visit through the link is logged and sets a 30-day cookie (last click wins).
//   3. A NEW account created while that cookie is present is attributed to the creator
//      (Backend/src/gift/routes/auth.js). Existing accounts are never attributed.
//   4. Every paid Koin order by an attributed user earns the creator `commissionRate`
//      (default 10%) of the rupee amount — once per order (unique on orderId).
//      A refund reverses that order's commission.
//   5. Admin records payouts; due = earned − reversed − paid.
//
// Same pattern as campus links (campusLinks.js): raw append-only collections for
// clicks/signups/commissions, a key-value doc per creator.
import mongoose from "mongoose";
import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";
import { collection, makeId } from "../gift/store.js";

const col = (name) => mongoose.connection.collection(name);
export const CREATORS = "creators";
export const CREATOR_CLICKS = "creator_clicks";
export const CREATOR_SIGNUPS = "creator_signups";
export const CREATOR_COMMISSIONS = "creator_commissions";
export const CREATOR_PAYOUTS = "creator_payouts";
const creators = collection(CREATORS); // _key: id → { id, code, name, handle, email, commissionRate, active, createdBy, createdAt, updatedAt }

export const CREATOR_COOKIE = "kynq_creator";
export const CREATOR_COOKIE_DAYS = 30;
export const DEFAULT_COMMISSION_RATE = 0.1;
const CODE_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

let indexesReady = null;
export function ensureCreatorIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([
      col(CREATORS).createIndex({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: "string" } } }),
      col(CREATOR_CLICKS).createIndex({ creatorId: 1, createdAt: -1 }),
      col(CREATOR_CLICKS).createIndex({ createdAt: -1 }),
      col(CREATOR_SIGNUPS).createIndex({ userId: 1 }, { unique: true }),
      col(CREATOR_SIGNUPS).createIndex({ creatorId: 1, createdAt: -1 }),
      col(CREATOR_COMMISSIONS).createIndex({ orderId: 1 }, { unique: true }),
      col(CREATOR_COMMISSIONS).createIndex({ creatorId: 1, createdAt: -1 }),
      col(CREATOR_COMMISSIONS).createIndex({ createdAt: -1 }),
      col(CREATOR_PAYOUTS).createIndex({ creatorId: 1, createdAt: -1 }),
    ]).catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}

export const normalizeCode = (raw) => String(raw ?? "").trim().toLowerCase().replace(/^@/, "");
const round2 = (n) => Math.round(n * 100) / 100;

export async function findCreatorByCode(code) {
  const c = normalizeCode(code);
  if (!CODE_RE.test(c)) return null;
  const doc = await col(CREATORS).findOne({ code: c });
  if (!doc) return null;
  const { _id, _key, ...rest } = doc;
  return rest;
}
export const getCreator = (id) => creators.get(String(id || ""));

export async function createCreator({ name, code, handle, email, commissionRate }, adminEmail) {
  const cleanName = String(name ?? "").trim();
  const cleanCode = normalizeCode(code);
  if (!cleanName) throw new Error("creator name is required");
  if (!CODE_RE.test(cleanCode)) throw new Error("code must be 3–32 characters: lowercase letters, numbers, - or _");
  const rate = commissionRate == null || commissionRate === "" ? DEFAULT_COMMISSION_RATE : Number(commissionRate);
  if (!(rate >= 0 && rate <= 0.5)) throw new Error("commission rate must be between 0% and 50%");
  await ensureCreatorIndexes();
  if (await findCreatorByCode(cleanCode)) throw new Error("that code is already taken");

  const id = makeId("crt");
  const now = Date.now();
  const doc = {
    id, code: cleanCode, name: cleanName.slice(0, 80),
    handle: String(handle ?? "").trim().replace(/^@/, "").slice(0, 60) || null,
    email: String(email ?? "").trim().toLowerCase().slice(0, 120) || null,
    commissionRate: rate, active: true, createdBy: adminEmail ?? null, createdAt: now, updatedAt: now,
  };
  await creators.set(id, doc);
  return doc;
}

/** Pausing a creator stops new clicks/signups/commissions being credited; history stays. */
export async function updateCreator(id, patch) {
  const cur = await getCreator(id);
  if (!cur) return null;
  const next = { ...cur, updatedAt: Date.now() };
  if (patch.active !== undefined) next.active = !!patch.active;
  if (patch.commissionRate !== undefined) {
    const rate = Number(patch.commissionRate);
    if (!(rate >= 0 && rate <= 0.5)) throw new Error("commission rate must be between 0% and 50%");
    next.commissionRate = rate; // applies to future orders only; past commissions keep their rate
  }
  if (patch.name !== undefined && String(patch.name).trim()) next.name = String(patch.name).trim().slice(0, 80);
  if (patch.handle !== undefined) next.handle = String(patch.handle ?? "").trim().replace(/^@/, "").slice(0, 60) || null;
  if (patch.email !== undefined) next.email = String(patch.email ?? "").trim().toLowerCase().slice(0, 120) || null;
  await creators.set(id, next);
  return next;
}

/** Logs a click through a creator link. Returns the creator (so the route can set the cookie), or null. */
export async function recordCreatorClick(code, req, { referrer } = {}) {
  const creator = await findCreatorByCode(code);
  if (!creator || !creator.active) return null;
  await ensureCreatorIndexes();
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
  const geo = ip ? geoip.lookup(ip) : null;
  const ua = new UAParser(String(req.headers["user-agent"] || "")).getResult();
  await col(CREATOR_CLICKS).insertOne({
    creatorId: creator.id, createdAt: Date.now(), ip: ip || null,
    country: geo?.country ?? null, region: geo?.region ?? null, city: geo?.city ?? null,
    device: ua.device?.type || "desktop", os: ua.os?.name ?? null, browser: ua.browser?.name ?? null,
    referrer: referrer ? String(referrer).slice(0, 300) : null,
  });
  return creator;
}

/** New account + creator cookie → attribution. One creator per user, ever (unique index). */
export async function attributeCreatorSignup(userId, creatorId) {
  const creator = await getCreator(creatorId);
  if (!userId || !creator || !creator.active) return false;
  await ensureCreatorIndexes();
  try {
    await col(CREATOR_SIGNUPS).insertOne({ userId, creatorId: creator.id, createdAt: Date.now() });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

/**
 * Called when a Koin order is marked paid. If the buyer signed up through an active
 * creator, records `rate × amount` once for this order. Never throws into the payment path.
 */
export async function recordCreatorCommission(order) {
  try {
    if (!order?.id || !order.userId || !(order.amount > 0)) return null;
    await ensureCreatorIndexes();
    const signup = await col(CREATOR_SIGNUPS).findOne({ userId: order.userId });
    if (!signup) return null;
    const creator = await getCreator(signup.creatorId);
    if (!creator || !creator.active) return null;
    const rate = Number(creator.commissionRate ?? DEFAULT_COMMISSION_RATE);
    const doc = {
      orderId: order.id, creatorId: creator.id, userId: order.userId,
      orderAmount: Number(order.amount), currency: order.currency || "INR", coins: order.coins ?? null,
      rate, commission: round2(Number(order.amount) * rate), status: "earned",
      createdAt: order.paidAt ?? Date.now(), reversedAt: null,
    };
    await col(CREATOR_COMMISSIONS).insertOne(doc);
    return doc;
  } catch (err) {
    if (err?.code !== 11000) console.error("[creators] commission failed for order", order?.id, ":", err.message);
    return null;
  }
}

/** A refunded order loses its commission (kept as a row, marked reversed). */
export async function reverseCreatorCommission(orderId) {
  try {
    await col(CREATOR_COMMISSIONS).updateOne({ orderId, status: "earned" }, { $set: { status: "reversed", reversedAt: Date.now() } });
  } catch (err) {
    console.error("[creators] reverse failed for order", orderId, ":", err.message);
  }
}

export async function addCreatorPayout(creatorId, { amount, note, reference }, adminEmail) {
  const creator = await getCreator(creatorId);
  if (!creator) return null;
  const value = round2(Number(amount));
  if (!(value > 0)) throw new Error("payout amount must be more than 0");
  await ensureCreatorIndexes();
  const doc = {
    id: makeId("cpay"), creatorId, amount: value,
    note: String(note ?? "").trim().slice(0, 200) || null,
    reference: String(reference ?? "").trim().slice(0, 80) || null,
    createdBy: adminEmail ?? null, createdAt: Date.now(),
  };
  await col(CREATOR_PAYOUTS).insertOne(doc);
  return doc;
}
