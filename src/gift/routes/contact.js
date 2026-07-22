import express from "express";
import { collection, makeId } from "../store.js";
import { created, badRequest, wrap } from "../http.js";

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
  created(res, { ok: true, id: record.id });
}));

export default router;
