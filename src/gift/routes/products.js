import express from "express";
import { collection } from "../store.js";
import { ok, notFound, wrap } from "../http.js";

const router = express.Router();
const products = collection("products");

const VALID_CATEGORIES = ["plushies", "candles", "decor", "jewellery", "charms"];
const VALID_KINDS = ["ready", "mto", "bundle", "drop"];

// GET /api/products?category=candles&kind=ready&drop=golden-hour&q=search&limit=50
router.get("/", wrap(async (req, res) => {
  const categoryParam = req.query.category;
  const kindParam = req.query.kind;
  const dropParam = req.query.drop;
  const q = req.query.q?.toLowerCase().trim();
  const limit = Math.min(200, Number(req.query.limit ?? "100"));
  const category = VALID_CATEGORIES.find((c) => c === categoryParam);
  const kind = VALID_KINDS.includes(kindParam) ? kindParam : undefined;

  let list = await products.list();
  if (kind) list = list.filter((p) => p.kind === kind);
  if (category) list = list.filter((p) => p.category === category);
  if (dropParam) list = list.filter((p) => p.kind === "drop" && p.drop?.slug === dropParam);
  if (q) {
    list = list.filter((p) => {
      const haystack = [
        p.name,
        p.shortDescription,
        p.category ?? "",
        (p.materials || []).join(" "),
      ].join(" ").toLowerCase();
      return q.split(/\s+/).every((word) => haystack.includes(word));
    });
  }
  ok(res, { products: list.slice(0, limit), total: list.length });
}));

// GET /api/products/:slug
router.get("/:slug", wrap(async (req, res) => {
  const product = await products.get(req.params.slug);
  if (!product) return notFound(res, "product not found");
  ok(res, { product });
}));

export default router;
