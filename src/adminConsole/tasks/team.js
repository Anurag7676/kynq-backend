// Tasks team = everyone who can sign in to the admin console: owners (ADMIN_EMAILS) plus every
// active subadmin from Admin → Team. No second employee list — add someone on the Team page
// and they can be assigned tickets right away.
//
// Roles here:
//   owner  — founder: sees and manages every ticket, imports JSON, assigns, sets deadlines.
//   member — any subadmin: sees tickets assigned to them, created by them or shared with them.
// Ticket access never grants other admin sections; those still come from allowedSections.
import { adminEmails } from "../auth.js";
import { listSubadmins } from "../subadmins.js";
import { col } from "../util.js";

export class TaskError extends Error { constructor(message, code = "bad_request") { super(message); this.code = code; } }
export const forbid = (m) => { throw new TaskError(m, "forbidden"); };
export const bad = (m) => { throw new TaskError(m, "bad_request"); };
export const missing = (m) => { throw new TaskError(m, "not_found"); };
export const conflict = (m) => { throw new TaskError(m, "conflict"); };

export const isOwner = (admin) => admin?.role === "owner";

const nameFromEmail = (email) => email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Owners aren't stored anywhere (they come from ADMIN_EMAILS), so their display name is the
// Google profile name remembered at their last Google sign-in; until then, it's derived from
// the email address.
const PROFILES = "admin_profiles";
export async function rememberOwnerName(admin, name) {
  const clean = typeof name === "string" ? name.trim().slice(0, 80) : "";
  if (admin?.role !== "owner" || !clean) return;
  try {
    await col(PROFILES).updateOne({ email: admin.email }, { $set: { email: admin.email, name: clean, updatedAt: Date.now() } }, { upsert: true });
    clearRosterCache();
  } catch (err) { console.error("[tasks] remember owner name failed:", err.message); }
}

let cache = { at: 0, list: null };
/** [{ email, name, isOwner }] — owners first. Cached for 30s (it's read on most requests). */
export async function roster() {
  if (cache.list && Date.now() - cache.at < 30_000) return cache.list;
  const owners = adminEmails();
  const [subs, profiles] = await Promise.all([listSubadmins(), col(PROFILES).find({ email: { $in: owners } }).toArray().catch(() => [])]);
  const ownerName = new Map(profiles.map((p) => [p.email, p.name]));
  const list = [
    ...owners.map((email) => ({ email, name: ownerName.get(email) || nameFromEmail(email), isOwner: true })),
    ...subs.filter((s) => !owners.includes(s.email)).map((s) => ({ email: s.email, name: s.name?.trim() || nameFromEmail(s.email), isOwner: false })),
  ];
  cache = { at: Date.now(), list };
  return list;
}
export const clearRosterCache = () => { cache = { at: 0, list: null }; };

/** An email, an email's local part ("riya") or a full name → a team email. Throws if unknown. */
export async function resolveMember(ref, team) {
  if (ref == null || ref === "") return null;
  const r = String(ref).trim().toLowerCase();
  const list = team ?? (await roster());
  const hit = list.find((m) => m.email === r) ?? list.find((m) => m.email.split("@")[0] === r) ?? list.find((m) => m.name.toLowerCase() === r);
  if (!hit) bad(`"${ref}" isn't on the team. Add them under Admin → Team first.`);
  return hit.email;
}

// Small in-memory rate limiter (single backend process, like the rest of the console).
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) { buckets.set(key, { start: now, n: 1 }); return; }
  if (++b.n > max) throw new TaskError("Too many requests. Wait a moment and try again.", "rate_limited");
}
