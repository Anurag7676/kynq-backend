import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { collection, makeToken, makeId } from "../store.js";
import { ok, created, badRequest, notFound, wrap } from "../http.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, "../../../public/media/wishes");
const router = express.Router();
const wishes = collection("wishes");

// POST /api/wishes — create an animated greeting, returns a shareable token
router.post("/", wrap(async (req, res) => {
  const d = req.body || {};
  if (!d.occasion && !d.message && !(d.media && d.media.length)) return badRequest(res, "a wish needs some content");
  const token = makeToken();
  const record = { ...d, token, createdAt: Date.now() };
  await wishes.set(token, record);
  created(res, { token, wish: record });
}));

// POST /api/wishes/media — store a data-URL image/video, return id + url
router.post("/media", wrap(async (req, res) => {
  const dataUrl = req.body?.dataUrl || req.body?.media;
  if (!dataUrl || !/^data:(image|video)\//.test(dataUrl)) return badRequest(res, "expected media dataUrl");
  const m = dataUrl.match(/^data:(image|video)\/(\w+);base64,(.+)$/);
  if (!m) return badRequest(res, "invalid dataUrl");
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const id = makeId("wmedia");
  const ext = m[2] === "jpeg" ? "jpg" : m[2];
  fs.writeFileSync(path.join(MEDIA_DIR, `${id}.${ext}`), Buffer.from(m[3], "base64"));
  created(res, { id, url: `/media/wishes/${id}.${ext}` });
}));

// GET /api/wishes/media/:id
router.get("/media/:id", wrap(async (req, res) => {
  const file = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR).find((f) => f.startsWith(req.params.id)) : null;
  if (!file) return notFound(res, "media not found");
  res.redirect(`/media/wishes/${file}`);
}));

// GET /api/wishes/:token
router.get("/:token", wrap(async (req, res) => {
  const wish = await wishes.get(req.params.token);
  if (!wish) return notFound(res, "wish not found");
  ok(res, { wish });
}));

export default router;
