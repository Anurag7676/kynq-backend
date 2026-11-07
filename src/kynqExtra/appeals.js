// "I was wrongly blocked": appeals from people the nudity model (moderation.js) or an admin locked
// out. A locked-out person can't sign in, so the lockout response carries a one-time appeal token
// (appeal_tokens, 14 days) instead of relying on a session. One open appeal per person; a newer
// message replaces the older one. Reviewed in the admin console (Moderation → Model blocks), where
// "unblock" lifts the lockout and clears the strikes, like the existing unblock button.
import crypto from "node:crypto";
import mongoose from "mongoose";
import { logAudit } from "../adminConsole/audit.js";
import { unblockModel } from "../adminConsole/modelBlocks.js";

const col = (n) => mongoose.connection.collection(n);
const TOKEN_MS = 14 * 24 * 3_600_000;

let ready = null;
const ensureIndexes = () => (ready ??= Promise.all([
  col("appeal_tokens").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
  col("appeals").createIndex({ status: 1, at: -1 }),
  col("appeals").createIndex({ userId: 1, status: 1 }),
]).catch((err) => { ready = null; throw err; }));

/** A token the lockout message hands out, so a signed-out person can still appeal. */
export async function appealTokenFor(userId) {
  await ensureIndexes();
  const id = crypto.randomBytes(18).toString("base64url");
  await col("appeal_tokens").insertOne({ _id: id, userId, expireAt: new Date(Date.now() + TOKEN_MS) });
  return id;
}

export async function submitAppeal({ token, message }) {
  await ensureIndexes();
  const text = String(message ?? "").trim().slice(0, 1000);
  if (text.length < 10) throw Object.assign(new Error("Tell us a little more (at least a sentence)."), { code: "bad_request" });
  const tok = typeof token === "string" ? await col("appeal_tokens").findOne({ _id: token }) : null;
  if (!tok || tok.expireAt < new Date()) throw Object.assign(new Error("This appeal link has expired. Try signing in again to get a new one."), { code: "bad_request" });
  const now = Date.now();
  const open = await col("appeals").findOne({ userId: tok.userId, status: "open" });
  if (open) await col("appeals").updateOne({ _id: open._id }, { $set: { message: text, at: now } });
  else await col("appeals").insertOne({ _id: `apl_${crypto.randomBytes(8).toString("hex")}`, userId: tok.userId, message: text, status: "open", at: now });
  return { ok: true };
}

/** Appeals for the admin console, with who it is and what the model had on them. */
export async function listAppeals({ status = "open", limit = 100 } = {}) {
  await ensureIndexes();
  const rows = await col("appeals").find(status === "all" ? {} : { status }).sort({ at: -1 }).limit(Math.min(500, Number(limit) || 100)).toArray();
  const ids = [...new Set(rows.map((r) => r.userId))];
  const [users, strikes, events] = await Promise.all([
    col("users").find({ id: { $in: ids } }, { projection: { id: 1, name: 1, kynqExtraRestricted: 1, kynqExtraRestrictedUntil: 1, kynqExtraRestrictedReason: 1 } }).toArray(),
    col("moderation_strikes").aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: "$userId", n: { $sum: 1 } } }]).toArray(),
    col("moderation_events").aggregate([{ $match: { subject: { $in: ids }, confirmed: true } }, { $group: { _id: "$subject", n: { $sum: 1 } } }]).toArray(),
  ]);
  const u = new Map(users.map((x) => [x.id, x]));
  const s = new Map(strikes.map((x) => [x._id, x.n]));
  const e = new Map(events.map((x) => [x._id, x.n]));
  return rows.map((r) => ({
    id: r._id, userId: r.userId, message: r.message, status: r.status, at: r.at, decidedAt: r.decidedAt ?? null, decision: r.decision ?? null,
    name: u.get(r.userId)?.name ?? null,
    lockedUntil: Number(u.get(r.userId)?.kynqExtraRestrictedUntil) || 0,
    permanent: !!u.get(r.userId)?.kynqExtraRestricted,
    reason: u.get(r.userId)?.kynqExtraRestrictedReason ?? null,
    strikes: s.get(r.userId) ?? 0, evidenceFrames: e.get(r.userId) ?? 0,
  }));
}

/** "unblock" lifts the lockout and its strikes; "reject" keeps it. Both are audited. */
export async function resolveAppeal(id, decision, admin, note) {
  if (!["unblock", "reject"].includes(decision)) throw Object.assign(new Error("decision must be unblock or reject"), { code: "bad_request" });
  const appeal = await col("appeals").findOne({ _id: id });
  if (!appeal) throw Object.assign(new Error("appeal not found"), { code: "not_found" });
  if (decision === "unblock") await unblockModel(appeal.userId, { clearStrikes: true }, admin);
  await col("appeals").updateOne({ _id: id }, { $set: { status: "decided", decision, note: String(note ?? "").slice(0, 300) || null, decidedAt: Date.now(), decidedBy: admin.email } });
  await logAudit(admin.email, `moderation.appeal_${decision}`, appeal.userId, { appealId: id });
  return { ok: true };
}
