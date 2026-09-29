// Campus tracking links — admin types a campus name, gets one shareable
// link (kynq.in/?campus=<id>). Every click is logged with location/device/
// browser info; a signup that follows within COOKIE_DAYS is attributed
// back to that campus. Read-side aggregation lives in
// adminConsole/campusLinks.js — this file owns the write path + the
// data model.
//
// Keyed by an opaque id (camp_xxxx), not the campus name/slug — renaming a
// campus later must not break links already handed out and pasted onto
// posters. `slug` is kept only as a human-readable label for the admin UI.
import mongoose from "mongoose";
import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";
import { collection, makeId } from "../gift/store.js";

const col = (name) => mongoose.connection.collection(name);
const links = collection("campus_links"); // _key: id → { id, slug, name, createdBy, createdAt }
const HITS = "campus_link_hits";
const CONVERSIONS = "campus_link_conversions";

export const CAMPUS_COOKIE = "kynq_campus";
export const CAMPUS_COOKIE_DAYS = 30;

// Repeated clicks of the SAME link from the SAME ip inside this window past
// this count get flagged `suspicious` — doesn't block or drop the hit (a
// classroom on one campus NAT genuinely produces bursts), just marks it so
// the dashboard can discount it. Tuned loose on purpose: false positives are
// worse than missing real spam here, since nothing is auto-blocked.
const SUSPICIOUS_WINDOW_MS = 10 * 60 * 1000;
const SUSPICIOUS_THRESHOLD = 8;

let indexesReady = null;
export function ensureCampusIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([
      col(HITS).createIndex({ campusId: 1, createdAt: -1 }),
      col(HITS).createIndex({ createdAt: -1 }),
      col(HITS).createIndex({ campusId: 1, ip: 1, createdAt: -1 }),
      col(CONVERSIONS).createIndex({ userId: 1 }, { unique: true }),
      col(CONVERSIONS).createIndex({ campusId: 1, createdAt: -1 }),
    ]).catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}

function slugify(name) {
  return String(name).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "campus";
}

export async function createCampusLink(name, adminEmail) {
  const clean = String(name ?? "").trim();
  if (!clean) throw new Error("campus name is required");
  await ensureCampusIndexes();

  const id = makeId("camp");
  const doc = { id, slug: slugify(clean), name: clean, createdBy: adminEmail ?? null, createdAt: Date.now() };
  await links.set(id, doc);
  return doc;
}

export async function listCampusLinkDocs() {
  return links.list();
}

export async function getCampusLinkDoc(id) {
  return links.get(id);
}

const BOT_UA = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|slackbot|headless/i;

function deviceType(parsed) {
  const t = parsed.device.type;
  if (t === "mobile" || t === "tablet") return t;
  return "desktop";
}

// req.ip already reflects the real client (app.set("trust proxy", 1) in app.js).
// `referrer`: the frontend passes document.referrer explicitly — the request's
// own Referer header would just be kynq.in itself (this is a same-app fetch
// call, not a top-level navigation from the external site).
export async function recordHit(campusId, req, { referrer } = {}) {
  await ensureCampusIndexes();
  const link = await links.get(campusId);
  if (!link) return null;

  const ip = req.ip || "";
  const geo = ip ? geoip.lookup(ip) : null;
  const ua = req.get("user-agent") || "";
  const parsed = UAParser(ua);
  const isBot = BOT_UA.test(ua);

  const since = Date.now() - SUSPICIOUS_WINDOW_MS;
  const recentFromIp = ip ? await col(HITS).countDocuments({ campusId, ip, createdAt: { $gt: since } }) : 0;
  const suspicious = recentFromIp >= SUSPICIOUS_THRESHOLD;

  const hit = {
    id: makeId("hit"),
    campusId,
    createdAt: Date.now(),
    ip,
    country: geo?.country ?? null,
    region: geo?.region ?? null,
    city: geo?.city || null,
    browser: parsed.browser.name ?? null,
    browserVersion: parsed.browser.version ?? null,
    os: parsed.os.name ?? null,
    osVersion: parsed.os.version ?? null,
    device: deviceType(parsed),
    referrer: (referrer && String(referrer).slice(0, 500)) || null,
    isBot,
    suspicious,
  };
  await col(HITS).insertOne(hit);
  return hit;
}

// Called from the sign-up path (getOrCreateUser) when a fresh account is
// created and the campus cookie is present. One conversion per user, ever —
// the unique index on userId is the actual guarantee; this check just skips
// the write in the common case.
export async function attributeCampusSignup(userId, campusId) {
  if (!userId || !campusId) return null;
  await ensureCampusIndexes();
  const link = await links.get(campusId);
  if (!link) return null;
  try {
    const doc = { userId, campusId, createdAt: Date.now() };
    await col(CONVERSIONS).insertOne(doc);
    return doc;
  } catch (err) {
    if (err?.code === 11000) return null; // already attributed — not an error
    throw err;
  }
}
