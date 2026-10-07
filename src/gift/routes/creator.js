// Public creator-link tracking. The link is just kynq.in/?creator=<code> — a normal
// page load; the frontend (CreatorTracker) reports the click once, and this sets the
// 30-day attribution cookie read at sign-up (gift/routes/auth.js). Last click wins.
import express from "express";
import { recordCreatorClick, findCreatorByEmail, CREATOR_COOKIE, CREATOR_COOKIE_DAYS } from "../../kynqExtra/creators.js";
import { creatorPortal } from "../../adminConsole/creators.js";
import { rangeFromQuery } from "../../adminConsole/util.js";
import { getCurrentUser } from "../session.js";
import { ok, badRequest, unauthorized, wrap } from "../http.js";

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

// The creator's own dashboard (kynq.in/creator). The signed-in kynq account is matched to a
// creator by email; anyone else gets { creator: null }. `?summary=1` only answers "is this a creator?"
// (used to show the Creator dashboard link on the account page).
router.get("/me", wrap(async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized(res, "sign in to see your creator dashboard");
  const creator = await findCreatorByEmail(user.email);
  if (!creator) return ok(res, { creator: null, email: user.email });
  if (req.query.summary) return ok(res, { creator: { name: creator.name, code: creator.code } });
  ok(res, await creatorPortal(creator.id, rangeFromQuery(req.query)));
}));

export default router;
