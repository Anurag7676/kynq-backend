import express from "express";
import { collection, makeToken } from "../store.js";
import { ok, created, badRequest, notFound, wrap } from "../http.js";

const router = express.Router();
const pairings = collection("pairings");

async function update(token, fn) {
  const cur = await pairings.get(token);
  if (!cur) return null;
  const next = fn(cur);
  await pairings.set(token, next);
  return next;
}

// POST /api/pairings — create an invite
router.post("/", wrap(async (req, res) => {
  const d = req.body || {};
  if (!d.fromName || !d.toName) return badRequest(res, "fromName + toName required");
  const token = makeToken();
  const record = {
    token, accepted: false,
    invite: { fromName: d.fromName, toName: d.toName, occasion: d.occasion, revealAt: d.revealAt, note: d.note, createdAt: Date.now() },
  };
  await pairings.set(token, record);
  created(res, { token, pairing: record });
}));

// GET /api/pairings/:token
router.get("/:token", wrap(async (req, res) => {
  const rec = await pairings.get(req.params.token);
  if (!rec) return notFound(res, "pairing not found");
  ok(res, { pairing: rec });
}));

// POST /api/pairings/:token/pick — record a side's pick
router.post("/:token/pick", wrap(async (req, res) => {
  const d = req.body || {};
  if (d.side !== "A" && d.side !== "B") return badRequest(res, "side must be A or B");
  const pick = { ...d, submittedAt: Date.now() };
  const next = await update(req.params.token, (cur) => ({
    ...cur,
    accepted: cur.accepted || true,
    ...(pick.side === "A" ? { pickA: pick } : { pickB: pick }),
  }));
  if (!next) return notFound(res, "pairing not found");
  ok(res, { pairing: next });
}));

// DELETE /api/pairings/:token/pick?side=A
router.delete("/:token/pick", wrap(async (req, res) => {
  const side = req.query.side;
  if (side !== "A" && side !== "B") return badRequest(res, "missing or invalid ?side");
  const next = await update(req.params.token, (cur) => ({ ...cur, ...(side === "A" ? { pickA: undefined } : { pickB: undefined }) }));
  if (!next) return notFound(res, "pairing not found");
  ok(res, { pairing: next });
}));

// POST /api/pairings/:token/accept
router.post("/:token/accept", wrap(async (req, res) => {
  const next = await update(req.params.token, (cur) => ({ ...cur, accepted: true }));
  if (!next) return notFound(res, "pairing not found");
  ok(res, { pairing: next });
}));

export default router;
