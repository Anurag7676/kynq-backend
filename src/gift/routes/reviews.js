import express from "express";
import { collection } from "../store.js";
import { ok, created, wrap } from "../http.js";

const router = express.Router();
const reviews = collection("reviews");

// GET /api/products/:slug/reviews — list reviews for a product
router.get("/:slug/reviews", wrap(async (req, res) => {
  const all = await reviews.list();
  const productReviews = all
    .filter((r) => r.productSlug === req.params.slug)
    .sort((a, b) => b.createdAt - a.createdAt);
  const avg = productReviews.length > 0
    ? productReviews.reduce((sum, r) => sum + r.rating, 0) / productReviews.length
    : 0;
  ok(res, {
    reviews: productReviews,
    count: productReviews.length,
    averageRating: Math.round(avg * 10) / 10,
  });
}));

// POST /api/products/:slug/reviews — add a review
router.post("/:slug/reviews", wrap(async (req, res) => {
  const d = req.body || {};
  if (!d.author || !d.rating || !d.title || !d.body) {
    return res.status(400).json({ error: "bad_request", message: "author, rating, title, body required" });
  }
  const review = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    productSlug: req.params.slug,
    author: String(d.author).slice(0, 60),
    rating: Math.min(5, Math.max(1, Number(d.rating))),
    title: String(d.title).slice(0, 100),
    body: String(d.body).slice(0, 1000),
    createdAt: Date.now(),
  };
  await reviews.set(review.id, review);
  created(res, { review });
}));

export default router;
