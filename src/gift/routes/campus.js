// Public campus-link tracking. The link itself is just kynq.in/?campus=<id>
// — a normal page load, no redirect hop, no separate domain. The frontend
// calls this once on load (see CampusTracker) exactly like every other
// kynq-extra API call, so it gets the same cookie/CORS behavior as
// everything else already does — nothing special to wire up.
import express from "express";
import { recordHit, CAMPUS_COOKIE, CAMPUS_COOKIE_DAYS } from "../../kynqExtra/campusLinks.js";
import { ok, badRequest, wrap } from "../http.js";

const router = express.Router();

router.post("/track", wrap(async (req, res) => {
  // Ids are base64url (camp_xxxx) — case-sensitive, so no lowercasing here.
  const campusId = String(req.body?.campusId || "").trim();
  if (!campusId) return badRequest(res, "campusId is required");

  const hit = await recordHit(campusId, req, { referrer: req.body?.referrer });
  if (hit) {
    res.cookie(CAMPUS_COOKIE, campusId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CAMPUS_COOKIE_DAYS * 24 * 60 * 60 * 1000,
    });
  }
  ok(res, { tracked: !!hit });
}));

export default router;
