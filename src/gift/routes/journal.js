import express from "express";
import { collection } from "../store.js";
import { ok, notFound, wrap } from "../http.js";

const router = express.Router();
const journal = collection("journal");

router.get("/", wrap(async (req, res) => {
  const tag = req.query.tag;
  const limit = Math.min(200, Number(req.query.limit ?? "100"));
  let list = await journal.list();
  if (tag) list = list.filter((a) => a.tag.toLowerCase() === String(tag).toLowerCase());
  list.sort((a, b) => b.date.localeCompare(a.date));
  ok(res, { articles: list.slice(0, limit), total: list.length });
}));

router.get("/:slug", wrap(async (req, res) => {
  const article = await journal.get(req.params.slug);
  if (!article) return notFound(res, "article not found");
  ok(res, { article });
}));

export default router;
