import express from "express";
import { collection } from "../store.js";
import { getScopedId } from "../session.js";
import { ok, created, badRequest, wrap } from "../http.js";

const router = express.Router();
const wishlists = collection("wishlists");
const carts = collection("carts");

const EMPTY = (sessionId) => ({ sessionId, items: [], updatedAt: 0 });
async function getWishlist(sessionId) {
  return (await wishlists.get(sessionId)) ?? EMPTY(sessionId);
}

function recalc(items, sessionId) {
  const itemCount = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const currency = items[0]?.currency ?? "INR";
  return { sessionId, items, itemCount, subtotal, currency, updatedAt: Date.now() };
}
function clampQty(qty, max) {
  if (qty <= 0) return 0;
  if (max == null || max <= 0) return Math.max(1, qty);
  return Math.min(qty, max);
}
async function getCart(sessionId) {
  return (await carts.get(sessionId)) ?? ({ sessionId, items: [], itemCount: 0, subtotal: 0, currency: "INR", updatedAt: 0 });
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}
function lineIdFor(slug, variant) {
  if (!variant) return slug;
  const parts = [
    slug, variant.colorId ?? "", variant.sizeId ?? "", variant.wrapId ?? "",
    variant.giftMessage ? `gm:${hash(variant.giftMessage)}` : "",
    variant.isDeposit ? "deposit" : "",
  ].filter(Boolean);
  return parts.join("|");
}

// GET /api/wishlist
router.get("/", wrap(async (req, res) => {
  const { scopedId } = await getScopedId(req, res);
  ok(res, { wishlist: await getWishlist(scopedId) });
}));

// POST /api/wishlist/items — idempotent add
router.post("/items", wrap(async (req, res) => {
  const d = req.body || {};
  if (!d.slug || !d.name || !d.kind) return badRequest(res, "missing fields");
  const { scopedId } = await getScopedId(req, res);
  const current = await getWishlist(scopedId);
  if (current.items.some((i) => i.slug === d.slug)) return created(res, { wishlist: current });
  const item = { slug: d.slug, name: d.name, kind: d.kind, image: d.image, priceAtAdd: d.priceAtAdd ?? null, currency: d.currency ?? "INR", href: d.href, savedAt: Date.now() };
  const next = { sessionId: scopedId, items: [item, ...current.items], updatedAt: Date.now() };
  await wishlists.set(scopedId, next);
  created(res, { wishlist: next });
}));

// POST /api/wishlist/items/:slug/move-to-cart — move wishlist item into cart
router.post("/items/:slug/move-to-cart", wrap(async (req, res) => {
  const { scopedId } = await getScopedId(req, res);
  const current = await getWishlist(scopedId);
  const item = current.items.find((i) => i.slug === req.params.slug);
  if (!item) {
    const cart = await getCart(scopedId);
    return ok(res, { cart });
  }

  const cartItem = {
    id: lineIdFor(item.slug),
    slug: item.slug, name: item.name, kind: item.kind, image: item.image,
    unitPrice: item.priceAtAdd ?? 0, currency: item.currency, qty: 1,
    href: item.href,
  };

  const cart = await getCart(scopedId);
  const existing = cart.items.find((i) => i.id === cartItem.id);
  const cartItems = existing
    ? cart.items.map((i) => (i.id === cartItem.id ? { ...i, qty: clampQty(i.qty + 1, i.inventoryAtAdd) } : i))
    : [...cart.items, { ...cartItem, qty: 1 }];
  const nextCart = recalc(cartItems, scopedId);
  await carts.set(scopedId, nextCart);

  const nextWishlist = { sessionId: scopedId, items: current.items.filter((i) => i.slug !== req.params.slug), updatedAt: Date.now() };
  await wishlists.set(scopedId, nextWishlist);

  ok(res, { cart: nextCart });
}));

// DELETE /api/wishlist/items/:slug
router.delete("/items/:slug", wrap(async (req, res) => {
  const { scopedId } = await getScopedId(req, res);
  const current = await getWishlist(scopedId);
  const next = { sessionId: scopedId, items: current.items.filter((i) => i.slug !== req.params.slug), updatedAt: Date.now() };
  await wishlists.set(scopedId, next);
  ok(res, { wishlist: next });
}));

export default router;
