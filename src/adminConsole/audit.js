// Every admin action that changes something (or reveals personal data) is recorded here.
import crypto from "node:crypto";
import { col, pageParams } from "./util.js";

export async function logAudit(admin, action, target, meta = {}) {
  try {
    await col("admin_audit").insertOne({ id: `aud_${crypto.randomBytes(8).toString("hex")}`, at: Date.now(), admin, action, target: target ?? null, meta });
  } catch (err) {
    console.error("[console] audit write failed:", err.message);
  }
}

export async function listAudit(query) {
  const { page, limit, skip } = pageParams(query);
  const [total, rows] = await Promise.all([
    col("admin_audit").countDocuments({}),
    col("admin_audit").find({}).sort({ at: -1 }).skip(skip).limit(limit).toArray(),
  ]);
  return { total, page, limit, entries: rows.map(({ id, at, admin, action, target, meta }) => ({ id, at, admin, action, target, meta })) };
}
