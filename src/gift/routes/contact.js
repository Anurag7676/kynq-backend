import express from "express";
import { collection, makeId } from "../store.js";
import { created, badRequest, wrap } from "../http.js";
import { sendEmail } from "../../config/emailConfig.js";

const router = express.Router();
const messages = collection("contact-messages");

// Each accepted message emails the team, so a script could flood the inbox. Two cheap guards:
// a hidden "website" field that real people never fill in, and at most a handful of messages
// per address per hour (in memory: it resets on restart, which is fine for this purpose).
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return false;
}

// POST /api/contact
router.post("/", wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return created(res, { ok: true }); // trap field filled in: pretend success, save and send nothing
  if (!b.email || !b.message) return badRequest(res, "email and message are required");
  if (tooMany(req.ip || "unknown")) return res.status(429).json({ message: "Too many messages from this connection. Please try again later, or email hi@kynq.in." });
  const record = {
    id: makeId("msg"),
    name: b.name ? String(b.name).slice(0, 80) : null,
    email: String(b.email).slice(0, 120),
    reason: b.reason ? String(b.reason).slice(0, 40) : null,
    subject: b.reason ? String(b.reason).slice(0, 40) : (b.subject ? String(b.subject).slice(0, 120) : null),
    message: String(b.message).slice(0, 4000),
    createdAt: Date.now(),
  };
  await messages.set(record.id, record);

  // Tell the team. Saving to the database alone meant nobody was ever notified, so
  // "we read every message" wasn't true. Best effort: a mail failure never fails
  // the visitor's request (the message is already saved above).
  const to = process.env.ADMIN_EMAIL || process.env.EMAIL_USERNAME;
  if (to) {
    const label = record.reason ? `[${record.reason}] ` : "";
    sendEmail({
      to,
      subject: `${label}${record.name || record.email}`.slice(0, 150),
      text: `From: ${record.name || "(no name)"} <${record.email}>\nType: ${record.reason || "general"}\nReceived: ${new Date(record.createdAt).toISOString()}\nMessage id: ${record.id}\n\n${record.message}\n\n(Reply directly to ${record.email}.)`,
    }).catch((err) => console.error("[contact] notification email failed:", err?.message || err));
  }

  created(res, { ok: true, id: record.id });
}));

export default router;
