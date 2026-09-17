import express from "express";
import { getScopedId } from "../session.js";
import { ok, created, badRequest, unauthorized, forbidden, wrap } from "../http.js";
import { getExtraProfile, setExtraProfile, INTEREST_TOPICS, LOCATION_SCOPES, INDIAN_CITIES } from "../../kynqExtra/profile.js";
import { mintTurnCredentials, turnConfigured } from "../../kynqExtra/turnCredentials.js";
import { listOpenReports, reviewReport, setRestricted } from "../../kynqExtra/reports.js";
import { searchGifs, trendingGifs, giphyConfigured } from "../../kynqExtra/giphy.js";
import { PROMPT_CATEGORIES } from "../../kynqExtra/prompts.js";
import { auth } from "../../middleware/authMiddleware.js";

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.userType !== "admin") return forbidden(res, "admin only");
  next();
}

// GET /api/kynq-extra/topics — the fixed interest/location vocabulary the
// frontend renders as pickers, kept server-side as the single source of
// truth (matches what the matchmaker actually scores against).
router.get("/topics", wrap(async (req, res) => {
  ok(res, { topics: INTEREST_TOPICS, locationScopes: LOCATION_SCOPES });
}));

// GET /api/kynq-extra/cities — the fixed Indian-city list city/state
// pickers render, server-side source of truth (see profile.js).
router.get("/cities", wrap(async (req, res) => {
  ok(res, { cities: INDIAN_CITIES });
}));

// GET /api/kynq-extra/prompt-categories — for the Prompts picker.
router.get("/prompt-categories", wrap(async (req, res) => {
  ok(res, { categories: PROMPT_CATEGORIES });
}));

router.get("/profile", wrap(async (req, res) => {
  const { userId } = await getScopedId(req, res);
  if (!userId) return unauthorized(res, "sign in to use kynq extra");
  const profile = await getExtraProfile(userId);
  ok(res, { profile });
}));

router.post("/profile", wrap(async (req, res) => {
  const { userId } = await getScopedId(req, res);
  if (!userId) return unauthorized(res, "sign in to use kynq extra");
  try {
    const profile = await setExtraProfile(userId, req.body || {});
    created(res, { profile });
  } catch (err) {
    badRequest(res, err.message);
  }
}));

// GET /api/kynq-extra/gifs?q=... — search (query given) or trending
// (no query), backend-proxied so the GIPHY key stays server-side.
router.get("/gifs", wrap(async (req, res) => {
  const { userId } = await getScopedId(req, res);
  if (!userId) return unauthorized(res, "sign in to use kynq extra");
  if (!giphyConfigured) return ok(res, { configured: false, gifs: [] });
  const q = String(req.query.q || "").trim();
  try {
    const gifs = q ? await searchGifs(q) : await trendingGifs();
    ok(res, { configured: true, gifs });
  } catch (err) {
    badRequest(res, err.message);
  }
}));

// GET /api/kynq-extra/turn-credentials — short-lived coturn creds, minted
// from the caller's own session identity (see turnCredentials.js).
router.get("/turn-credentials", wrap(async (req, res) => {
  const { userId } = await getScopedId(req, res);
  if (!userId) return unauthorized(res, "sign in to use kynq extra");
  if (!turnConfigured) return ok(res, { configured: false });
  ok(res, { configured: true, ...mintTurnCredentials(userId) });
}));

// ─── Admin moderation — reuses the existing JWT-bearer admin auth
// (Backend/src/middleware/authMiddleware.js), same as the legacy admin
// dashboard's routes. ───
router.get("/admin/reports", auth, requireAdmin, wrap(async (req, res) => {
  const reports = await listOpenReports({ limit: Number(req.query.limit) || 50 });
  ok(res, { reports });
}));

router.post("/admin/reports/:id/review", auth, requireAdmin, wrap(async (req, res) => {
  const { status, actionTaken } = req.body || {};
  if (!["open", "reviewed", "actioned"].includes(status)) return badRequest(res, "invalid status");
  const report = await reviewReport(req.params.id, { status, actionTaken, reviewedBy: req.admin.id });
  if (!report) return badRequest(res, "report not found");

  if (actionTaken === "restricted" || actionTaken === "banned") {
    await setRestricted(report.reportedScopedId, true);
  }
  ok(res, { report });
}));

router.post("/admin/users/:userId/restrict", auth, requireAdmin, wrap(async (req, res) => {
  const restricted = req.body?.restricted !== false;
  await setRestricted(req.params.userId, restricted);
  ok(res, { userId: req.params.userId, restricted });
}));

export default router;
