import express from "express";
import { collection } from "../store.js";
import { created, badRequest, wrap } from "../http.js";

const router = express.Router();
const subs = collection("newsletter");

// POST /api/newsletter
router.post("/", wrap(async (req, res) => {
  const email = req.body?.email;
  const source = req.body?.source || null;
  if (!email || !/.+@.+\..+/.test(email)) return badRequest(res, "valid email required");
  const key = String(email).toLowerCase().trim();
  const existing = await subs.get(key);
  if (existing) return created(res, { ok: true, subscribed: false, alreadySubscribed: true });
  await subs.set(key, { email: key, source, subscribedAt: Date.now() });
  created(res, { ok: true, subscribed: true, alreadySubscribed: false });
}));

export default router;
