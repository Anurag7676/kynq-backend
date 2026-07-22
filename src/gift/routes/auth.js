import express from "express";
import { collection } from "../store.js";
import {
  createMagicLink, consumeMagicLink, getOrCreateUser, saveUser,
  signIn, signOut, getCurrentUser,
} from "../session.js";
import { ok, badRequest, unauthorized, wrap } from "../http.js";

const router = express.Router();
const users = collection("users");
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// POST /api/auth/request-link — mint a magic link, "send" it (logged in dev)
router.post("/request-link", wrap(async (req, res) => {
  const email = req.body?.email;
  const name = req.body?.name;
  if (!email || !/.+@.+\..+/.test(email)) return badRequest(res, "valid email required");
  const link = await createMagicLink(email);
  if (name) {
    const user = await getOrCreateUser(email, name);
  }
  const url = `${req.protocol}://${req.get("host")}/api/auth/verify?token=${encodeURIComponent(link.token)}`;
  if (process.env.RESEND_API_KEY) {
    // real send would go here
  } else {
    console.log(`\n──────── MAGIC LINK (demo mode) ────────\nto:  ${link.email}\nurl: ${url}\n────────────────────────────────────────\n`);
  }
  ok(res, { ok: true, message: "if that email exists, a link is on its way." });
}));

// GET /api/auth/verify?token=&next=/account — consume, sign in, redirect to frontend
router.get("/verify", wrap(async (req, res) => {
  const token = req.query.token;
  const next = req.query.next || "/account";
  if (!token) return res.redirect(`${CLIENT_URL}/login?error=missing-token`);
  const link = await consumeMagicLink(String(token));
  if (!link) return res.redirect(`${CLIENT_URL}/login?error=expired`);
  const user = await getOrCreateUser(link.email);
  await signIn(res, user.id);
  res.redirect(`${CLIENT_URL}${next}`);
}));

// GET /api/auth/me
router.get("/me", wrap(async (req, res) => {
  ok(res, { user: await getCurrentUser(req) });
}));

// PATCH /api/auth/me — update name
router.patch("/me", wrap(async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me) return unauthorized(res);
  const name = req.body?.name;
  if (!name) return badRequest(res, "name required");
  const next = { ...me, name: String(name).slice(0, 120) };
  await saveUser(next);
  ok(res, { user: next });
}));

// POST /api/auth/signout
router.post("/signout", wrap(async (req, res) => {
  await signOut(req, res);
  ok(res, { ok: true });
}));

// ─── Addresses (GET/POST /api/auth/me/addresses, PATCH/DELETE /:addressId) ───
function newAddrId() { return "addr_" + Math.random().toString(36).slice(2, 11); }

router.get("/me/addresses", wrap(async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me) return unauthorized(res);
  ok(res, { addresses: me.addresses || [] });
}));

router.post("/me/addresses", wrap(async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me) return unauthorized(res);
  const a = req.body || {};
  if (!a.line1 || !a.city || !a.postalCode) return badRequest(res, "line1, city, postalCode required");
  const addr = { id: newAddrId(), label: a.label, line1: a.line1, line2: a.line2, city: a.city, state: a.state, postalCode: a.postalCode, country: a.country || "India", isDefault: !!a.isDefault };
  const addresses = [...(me.addresses || []), addr];
  await saveUser({ ...me, addresses });
  ok(res, { addresses });
}));

router.patch("/me/addresses/:addressId", wrap(async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me) return unauthorized(res);
  const addresses = (me.addresses || []).map((a) => (a.id === req.params.addressId ? { ...a, ...req.body, id: a.id } : a));
  await saveUser({ ...me, addresses });
  ok(res, { addresses });
}));

router.delete("/me/addresses/:addressId", wrap(async (req, res) => {
  const me = await getCurrentUser(req);
  if (!me) return unauthorized(res);
  const addresses = (me.addresses || []).filter((a) => a.id !== req.params.addressId);
  await saveUser({ ...me, addresses });
  ok(res, { addresses });
}));

export default router;
