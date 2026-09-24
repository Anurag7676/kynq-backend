import express from "express";
import { collection, makeId } from "../store.js";
import { created, badRequest, wrap } from "../http.js";
import { sendEmail } from "../../config/emailConfig.js";

const router = express.Router();
const messages = collection("contact-messages");

// POST /api/contact
router.post("/", wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.email || !b.message) return badRequest(res, "email and message are required");
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
