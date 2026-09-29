// Sub-admins: accounts an owner (ADMIN_EMAILS) creates with access to only
// some sidebar sections — e.g. someone who should only see Campus links.
// Owners themselves stay env-driven (see auth.js) and are never stored here,
// so a bug in this collection can't lock an owner out of their own console.
import { collection } from "../gift/store.js";
import { SECTIONS } from "./sections.js";

const subadmins = collection("admin_subadmins"); // _key: email → { email, name, allowedSections, active, createdBy, createdAt, updatedAt }

const SECTION_KEYS = new Set(SECTIONS.map((s) => s.key));

export async function listSubadmins() {
  const all = await subadmins.list();
  return all.filter((s) => s.active !== false).sort((a, b) => b.createdAt - a.createdAt);
}

/** Active subadmin doc for this email, or null. Used by auth.js on every request. */
export async function getActiveSubadmin(email) {
  const doc = await subadmins.get(String(email).toLowerCase().trim());
  return doc && doc.active !== false ? doc : null;
}

export async function upsertSubadmin(email, name, allowedSections, admin) {
  const key = String(email || "").toLowerCase().trim();
  if (!key || !key.includes("@")) throw new Error("a valid email is required");
  const clean = [...new Set((allowedSections ?? []).filter((s) => SECTION_KEYS.has(s)))];
  if (clean.length === 0) throw new Error("pick at least one section");

  const existing = await subadmins.get(key);
  const now = Date.now();
  const doc = {
    email: key,
    name: String(name || existing?.name || "").slice(0, 120) || null,
    allowedSections: clean,
    active: true,
    createdBy: existing?.createdBy ?? admin.email,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    updatedBy: admin.email,
  };
  await subadmins.set(key, doc);
  return doc;
}

/** Soft-revoke: kept for the audit trail, but getActiveSubadmin stops returning it —
 * so access is cut on this subadmin's very next request, not just at their next sign-in. */
export async function revokeSubadmin(email, admin) {
  const key = String(email || "").toLowerCase().trim();
  const existing = await subadmins.get(key);
  if (!existing) return null;
  const doc = { ...existing, active: false, updatedAt: Date.now(), updatedBy: admin.email };
  await subadmins.set(key, doc);
  return doc;
}
