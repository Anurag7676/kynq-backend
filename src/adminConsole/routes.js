// /api/console: the admin dashboard's API. Everything except sign-in needs an allowed admin;
// everything below the ─── Everything below needs an admin ─── line also needs the matching
// sidebar section (see sections.js) — owners always pass, subadmins need that section granted.
import express from "express";
import { ok, badRequest, notFound, forbidden, unauthorized, serverError } from "../gift/http.js";
import { requireAdmin, requireSection, requireOwner, sameOriginWrites, startSession, endSession, verifyGoogleAccessToken, resolveAdmin } from "./auth.js";
import { rangeFromQuery } from "./util.js";
import { SECTIONS } from "./sections.js";
import { listSubadmins, upsertSubadmin, revokeSubadmin } from "./subadmins.js";
import { overview, analytics, finance } from "./stats.js";
import { listReports, reviewReport } from "./moderation.js";
import { listUsers, getUser, restrictUser, revealEmail, setAmbassador } from "./users.js";
import { listAmbassadors, ambassadorDetail } from "./ambassadors.js";
import { createCampus, listCampusLinks, campusLinkDetail, campusOverview } from "./campusLinks.js";
import { listInbox, getInboxItem, setInboxStatus } from "./inbox.js";
import { listAudit, logAudit } from "./audit.js";
import { liveNow } from "./live.js";
import { traffic, realtime } from "./ga.js";
import { seo } from "./seo.js";
import { listVideos, uploadVideo, deleteVideo, rebalance } from "./videos.js";

const router = express.Router();
router.use(sameOriginWrites);

// Turns thrown errors into the standard error bodies; unknown errors become a 500.
const guard = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err?.code === "bad_request") return badRequest(res, err.message);
    if (err?.code === "not_found") return notFound(res, err.message);
    return serverError(res, err);
  }
};

// ─── Sign-in ───
router.post("/auth/google", guard(async (req, res) => {
  const accessToken = req.body?.accessToken;
  if (typeof accessToken !== "string" || !accessToken) return badRequest(res, "missing Google access token");
  let who;
  try { who = await verifyGoogleAccessToken(accessToken); } catch (err) { return unauthorized(res, err.message); }
  const admin = await resolveAdmin(who.email, who.name);
  if (!admin) return res.status(403).json({ error: "not_allowed", message: "This Google account isn't on the admin list." });
  startSession(res, who);
  await logAudit(who.email, "auth.login", null);
  ok(res, { admin });
}));

// Local development only (never in production, and only when explicitly switched on): sign in as an allowed admin email
// without Google, so the dashboard can be tried against a local backend.
if (process.env.NODE_ENV !== "production" && process.env.CONSOLE_DEV_LOGIN === "true") {
  router.post("/auth/dev-login", guard(async (req, res) => {
    const email = String(req.body?.email || "").toLowerCase();
    const admin = await resolveAdmin(email, "Local admin");
    if (!admin) return forbidden(res, "That email isn't allowed in (not an owner, and no active subadmin access).");
    startSession(res, { email, name: "Local admin" });
    ok(res, { admin });
  }));
}

router.post("/auth/logout", (req, res) => { endSession(res); ok(res, { ok: true }); });
router.get("/me", requireAdmin, (req, res) => ok(res, { admin: req.admin }));

// ─── Everything below needs an admin ───
router.use(requireAdmin);

router.get("/overview", requireSection("overview"), guard(async (req, res) => ok(res, await overview(rangeFromQuery(req.query)))));
router.get("/analytics", requireSection("analytics"), guard(async (req, res) => ok(res, await analytics(rangeFromQuery(req.query)))));
router.get("/finance", requireSection("finance"), guard(async (req, res) => ok(res, await finance(rangeFromQuery(req.query)))));

router.get("/live", requireSection("overview"), guard(async (req, res) => ok(res, liveNow())));
router.get("/traffic/realtime", requireSection("traffic"), guard(async (req, res) => ok(res, await realtime())));
router.get("/seo", requireSection("seo"), guard(async (req, res) => ok(res, await seo(rangeFromQuery(req.query)))));
router.get("/traffic", requireSection("traffic"), guard(async (req, res) => ok(res, await traffic(rangeFromQuery(req.query)))));

router.get("/reports", requireSection("moderation"), guard(async (req, res) => ok(res, await listReports(req.query))));
router.post("/reports/:id/review", requireSection("moderation"), guard(async (req, res) => ok(res, { report: await reviewReport(req.params.id, req.body || {}, req.admin) })));

router.get("/users", requireSection("users"), guard(async (req, res) => ok(res, await listUsers(req.query))));
router.get("/users/:id", requireSection("users"), guard(async (req, res) => { const d = await getUser(req.params.id); return d ? ok(res, d) : notFound(res, "user not found"); }));
router.post("/users/:id/restrict", requireSection("users"), guard(async (req, res) => {
  if (typeof req.body?.restricted !== "boolean") return badRequest(res, "restricted must be true or false");
  const r = await restrictUser(req.params.id, req.body.restricted, req.admin);
  return r ? ok(res, r) : notFound(res, "user not found");
}));
router.post("/users/:id/reveal-email", requireSection("users"), guard(async (req, res) => { const r = await revealEmail(req.params.id, req.admin); return r ? ok(res, r) : notFound(res, "user not found"); }));
router.post("/users/:id/ambassador", requireSection("users"), guard(async (req, res) => {
  if (typeof req.body?.enrolled !== "boolean") return badRequest(res, "enrolled must be true or false");
  const r = await setAmbassador(req.params.id, req.body.enrolled, req.admin);
  return r ? ok(res, r) : notFound(res, "user not found");
}));

router.get("/ambassadors", requireSection("ambassadors"), guard(async (req, res) => ok(res, await listAmbassadors(req.query))));
router.get("/ambassadors/:id", requireSection("ambassadors"), guard(async (req, res) => { const d = await ambassadorDetail(req.params.id); return d ? ok(res, d) : notFound(res, "not an ambassador"); }));

router.post("/campus-links", requireSection("campus-links"), guard(async (req, res) => {
  const name = req.body?.name;
  if (!name) return badRequest(res, "campus name is required");
  const link = await createCampus(name, req.admin);
  await logAudit(req.admin.email, "campus_link.create", link.id, { name: link.name });
  ok(res, { link });
}));
router.get("/campus-links", requireSection("campus-links"), guard(async (req, res) => ok(res, { links: await listCampusLinks() })));
router.get("/campus-links/overview", requireSection("campus-links"), guard(async (req, res) => ok(res, await campusOverview(req.query))));
router.get("/campus-links/:id", requireSection("campus-links"), guard(async (req, res) => {
  const d = await campusLinkDetail(req.params.id, req.query);
  return d ? ok(res, d) : notFound(res, "campus link not found");
}));

router.get("/inbox", requireSection("inbox"), guard(async (req, res) => ok(res, await listInbox(req.query))));
router.get("/inbox/:id", requireSection("inbox"), guard(async (req, res) => { const d = await getInboxItem(req.params.id, req.admin); return d ? ok(res, d) : notFound(res, "message not found"); }));
router.post("/inbox/:id/status", requireSection("inbox"), guard(async (req, res) => { const r = await setInboxStatus(req.params.id, req.body?.status, req.admin); return r ? ok(res, r) : notFound(res, "message not found"); }));

router.get("/videos", requireSection("videos"), guard(async (req, res) => ok(res, await listVideos())));
// Raw MP4 body, streamed straight to S3 (no JSON parsing happens for video/mp4).
router.post("/videos/upload", requireSection("videos"), guard(async (req, res) => ok(res, { video: await uploadVideo(req, req.admin) })));
router.post("/videos/delete", requireSection("videos"), guard(async (req, res) => ok(res, await deleteVideo(req.body?.key, req.admin))));
router.post("/videos/rebalance", requireSection("videos"), guard(async (req, res) => ok(res, await rebalance(req.admin))));

router.get("/audit", requireSection("audit"), guard(async (req, res) => ok(res, await listAudit(req.query))));

// ─── Team (owner-only): who gets in, and which sections they see ───
router.get("/team", requireOwner, guard(async (req, res) => ok(res, { sections: SECTIONS, subadmins: await listSubadmins() })));
router.post("/team", requireOwner, guard(async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();
  if (!email.includes("@")) return badRequest(res, "a valid email is required");
  if (!Array.isArray(req.body?.allowedSections) || req.body.allowedSections.length === 0) return badRequest(res, "pick at least one section");
  const doc = await upsertSubadmin(email, req.body?.name, req.body.allowedSections, req.admin);
  await logAudit(req.admin.email, "subadmin.upsert", doc.email, { allowedSections: doc.allowedSections });
  ok(res, { subadmin: doc });
}));
router.post("/team/:email/revoke", requireOwner, guard(async (req, res) => {
  const doc = await revokeSubadmin(req.params.email, req.admin);
  if (!doc) return notFound(res, "subadmin not found");
  await logAudit(req.admin.email, "subadmin.revoke", doc.email, {});
  ok(res, { subadmin: doc });
}));

export default router;
