// Public creator-link tracking. The link is just kynq.in/?creator=<code> — a normal
// page load; the frontend (CreatorTracker) reports the click once, and this sets the
// 30-day attribution cookie read at sign-up (gift/routes/auth.js). Last click wins.
import express from "express";
import { recordCreatorClick, CREATOR_COOKIE, CREATOR_COOKIE_DAYS } from "../../kynqExtra/creators.js";
import { ok, badRequest, wrap } from "../http.js";

const router = express.Router();

router.post("/track", wrap(async (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!code) return badRequest(res, "code is required");
  const creator = await recordCreatorClick(code, req, { referrer: req.body?.referrer });
  if (creator) {
    res.cookie(CREATOR_COOKIE, creator.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CREATOR_COOKIE_DAYS * 24 * 60 * 60 * 1000,
    });
  }
  ok(res, { tracked: !!creator });
}));

export default router;
