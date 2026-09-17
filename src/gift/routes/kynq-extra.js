import express from "express";
import { getScopedId } from "../session.js";
import { ok, created, badRequest, unauthorized, forbidden, wrap } from "../http.js";
import { getExtraProfile, setExtraProfile, getPublicName, INTEREST_TOPICS, LOCATION_SCOPES, INDIAN_CITIES } from "../../kynqExtra/profile.js";
import { mintTurnCredentials, turnConfigured } from "../../kynqExtra/turnCredentials.js";
import { listOpenReports, reviewReport, setRestricted } from "../../kynqExtra/reports.js";
import { searchGifs, trendingGifs, giphyConfigured } from "../../kynqExtra/giphy.js";
import { PROMPT_CATEGORIES } from "../../kynqExtra/prompts.js";
import { listCallsForUser } from "../../kynqExtra/calls-store.js";
import {
  proposeChallenge, respondToChallenge, listMyChallenges, getChallenge,
  getQuestionOptions, askQuestion, answerQuestion, answerDayGame, shareMoment,
} from "../../kynqExtra/challenges.js";
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

// GET /api/kynq-extra/users/:id/public — just {id, name}, nothing else,
// so the challenge UI can show who you're dealing with.
router.get("/users/:id/public", wrap(async (req, res) => {
  const { userId } = await getScopedId(req, res);
  if (!userId) return unauthorized(res, "sign in to use kynq extra");
  const profile = await getPublicName(req.params.id);
  if (!profile) return badRequest(res, "user not found");
  ok(res, { user: profile });
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

// GET /api/kynq-extra/calls — past 1-to-1 calls, most recent first.
router.get("/calls", wrap(async (req, res) => {
  const { userId } = await getScopedId(req, res);
  if (!userId) return unauthorized(res, "sign in to use kynq extra");
  ok(res, { calls: await listCallsForUser(userId, Number(req.query.limit) || 50) });
}));

// GET /api/kynq-extra/turn-credentials — short-lived coturn creds, minted
// from the caller's own session identity (see turnCredentials.js).
router.get("/turn-credentials", wrap(async (req, res) => {
  const { userId } = await getScopedId(req, res);
  if (!userId) return unauthorized(res, "sign in to use kynq extra");
  if (!turnConfigured) return ok(res, { configured: false });
  ok(res, { configured: true, ...mintTurnCredentials(userId) });
}));

// ─── 7-Day Challenge — plain REST, deliberately NOT socket/call-bound
// (see challenges.js header). requireChallengeUser resolves scopedId once
// per route instead of repeating the getScopedId dance in every handler. ───
async function requireChallengeUser(req, res) {
  const { userId } = await getScopedId(req, res);
  if (!userId) { unauthorized(res, "sign in to use kynq extra"); return null; }
  return userId;
}

router.get("/challenges", wrap(async (req, res) => {
  const scopedId = await requireChallengeUser(req, res);
  if (!scopedId) return;
  ok(res, { challenges: await listMyChallenges(scopedId) });
}));

router.post("/challenges", wrap(async (req, res) => {
  const scopedId = await requireChallengeUser(req, res);
  if (!scopedId) return;
  const { peerScopedId } = req.body || {};
  if (!peerScopedId) return badRequest(res, "peerScopedId required");
  try {
    created(res, { challenge: await proposeChallenge(scopedId, peerScopedId) });
  } catch (err) {
    badRequest(res, err.message);
  }
}));

router.get("/challenges/:id", wrap(async (req, res) => {
  const scopedId = await requireChallengeUser(req, res);
  if (!scopedId) return;
  const challenge = await getChallenge(req.params.id, scopedId);
  if (!challenge) return badRequest(res, "challenge not found");
  ok(res, { challenge });
}));

router.post("/challenges/:id/respond", wrap(async (req, res) => {
  const scopedId = await requireChallengeUser(req, res);
  if (!scopedId) return;
  try {
    const challenge = await respondToChallenge(req.params.id, scopedId, !!req.body?.accept);
    ok(res, { challenge });
  } catch (err) {
    badRequest(res, err.message);
  }
}));

router.get("/challenges/:id/question-options", wrap(async (req, res) => {
  const scopedId = await requireChallengeUser(req, res);
  if (!scopedId) return;
  try {
    ok(res, { options: await getQuestionOptions(req.params.id, scopedId) });
  } catch (err) {
    badRequest(res, err.message);
  }
}));

router.post("/challenges/:id/ask", wrap(async (req, res) => {
  const scopedId = await requireChallengeUser(req, res);
  if (!scopedId) return;
  try {
    ok(res, { challenge: await askQuestion(req.params.id, scopedId, req.body?.question) });
  } catch (err) {
    badRequest(res, err.message);
  }
}));

router.post("/challenges/:id/answer", wrap(async (req, res) => {
  const scopedId = await requireChallengeUser(req, res);
  if (!scopedId) return;
  try {
    ok(res, { challenge: await answerQuestion(req.params.id, scopedId, req.body?.answer) });
  } catch (err) {
    badRequest(res, err.message);
  }
}));

router.post("/challenges/:id/game", wrap(async (req, res) => {
  const scopedId = await requireChallengeUser(req, res);
  if (!scopedId) return;
  try {
    ok(res, { challenge: await answerDayGame(req.params.id, scopedId, req.body?.choice) });
  } catch (err) {
    badRequest(res, err.message);
  }
}));

router.post("/challenges/:id/moment", wrap(async (req, res) => {
  const scopedId = await requireChallengeUser(req, res);
  if (!scopedId) return;
  try {
    ok(res, { challenge: await shareMoment(req.params.id, scopedId, req.body || {}) });
  } catch (err) {
    badRequest(res, err.message);
  }
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
