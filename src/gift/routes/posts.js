import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { collection, makeId } from "../store.js";
import { ok, created, badRequest, notFound, wrap } from "../http.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, "../../../public/media/posts");
const router = express.Router();
const posts = collection("posts");

const POST_KINDS = ["plush", "bag", "throw", "coasters", "print", "beanie", "scarf", "candle", "other"];

// GET /api/posts?kind=plush&limit=50
router.get("/", wrap(async (req, res) => {
  const kindParam = req.query.kind;
  const limit = Math.min(200, Number(req.query.limit ?? "100"));
  const kind = POST_KINDS.find((k) => k === kindParam);
  let list = (await posts.list()).filter((p) => !p.hidden);
  if (kind) list = list.filter((p) => p.kind === kind);
  list.sort((a, b) => b.postedAt - a.postedAt);
  ok(res, { posts: list.slice(0, limit), total: list.length });
}));

// POST /api/posts — create a wall post
router.post("/", wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.place || !b.piece || !b.story) return badRequest(res, "missing fields");
  const kind = POST_KINDS.includes(b.kind) ? b.kind : "other";
  const record = {
    id: makeId("post"),
    name: String(b.name).slice(0, 40),
    place: String(b.place).slice(0, 40),
    piece: String(b.piece).slice(0, 60),
    kind,
    story: String(b.story).slice(0, 280),
    photoId: b.photoId ?? null,
    seedArt: Number.isInteger(b.seedArt) ? b.seedArt : 0,
    postedAt: Date.now(),
    hearts: 0,
  };
  await posts.set(record.id, record);
  created(res, { post: record });
}));

// POST /api/posts/:id/heart
router.post("/:id/heart", wrap(async (req, res) => {
  const post = await posts.get(req.params.id);
  if (!post) return notFound(res, "post not found");
  const updated = { ...post, hearts: (post.hearts || 0) + 1 };
  await posts.set(post.id, updated);
  ok(res, { post: updated });
}));

// POST /api/posts/media — accept a data-URL image, store it, return an id
router.post("/media", wrap(async (req, res) => {
  const dataUrl = req.body?.dataUrl || req.body?.image;
  if (!dataUrl || !/^data:image\//.test(dataUrl)) return badRequest(res, "expected image dataUrl");
  const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!m) return badRequest(res, "invalid dataUrl");
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const id = makeId("media");
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  fs.writeFileSync(path.join(MEDIA_DIR, `${id}.${ext}`), Buffer.from(m[2], "base64"));
  created(res, { id, url: `/media/posts/${id}.${ext}` });
}));

// GET /api/posts/media/:id — redirect to the static file
router.get("/media/:id", wrap(async (req, res) => {
  const dir = MEDIA_DIR;
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(req.params.id)) : null;
  if (!file) return notFound(res, "media not found");
  res.redirect(`/media/posts/${file}`);
}));

export default router;
