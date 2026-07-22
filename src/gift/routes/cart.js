import express from "express";
import { collection } from "../store.js";
import { getScopedId } from "../session.js";
import { ok, created, badRequest, wrap } from "../http.js";

const router = express.Router();
const carts = collection("carts");

const EMPTY = (sessionId) => ({ sessionId, items: [], itemCount: 0, subtotal: 0, currency: "INR", updatedAt: 0 });

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
  return (await carts.get(sessionId)) ?? EMPTY(sessionId);
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

// GET /api/cart
router.get("/", wrap(async (req, res) => {
  const { scopedId } = await getScopedId(req, res);
  ok(res, { cart: await getCart(scopedId) });
}));

// POST /api/cart/items
router.post("/items", wrap(async (req, res) => {
  const d = req.body || {};
  if (!d.slug || !d.name || !d.kind || d.unitPrice == null || !d.qty) return badRequest(res, "missing cart fields");
  const { scopedId } = await getScopedId(req, res);
  const line = {
    slug: d.slug, name: d.name, kind: d.kind, image: d.image,
    unitPrice: d.unitPrice, currency: d.currency ?? "INR", qty: d.qty,
    href: d.href, inventoryAtAdd: d.inventoryAtAdd, leadTimeLabel: d.leadTimeLabel,
    variant: d.variant, id: lineIdFor(d.slug, d.variant),
  };
  const current = await getCart(scopedId);
  const existing = current.items.find((i) => i.id === line.id);
  const items = existing
    ? current.items.map((i) => (i.id === line.id ? { ...i, qty: clampQty(i.qty + line.qty, line.inventoryAtAdd) } : i))
    : [...current.items, { ...line, qty: clampQty(line.qty, line.inventoryAtAdd) }];
  const next = recalc(items, scopedId);
  await carts.set(scopedId, next);
  created(res, { cart: next });
}));

// PATCH /api/cart/items/:lineId
router.patch("/items/:lineId", wrap(async (req, res) => {
  const qty = Number(req.body?.qty);
  if (!Number.isInteger(qty) || qty < 0 || qty > 99) return badRequest(res, "qty 0-99");
  const { scopedId } = await getScopedId(req, res);
  const current = await getCart(scopedId);
  const items = current.items
    .map((i) => (i.id === req.params.lineId ? { ...i, qty: clampQty(qty, i.inventoryAtAdd) } : i))
    .filter((i) => i.qty > 0);
  const next = recalc(items, scopedId);
  await carts.set(scopedId, next);
  ok(res, { cart: next });
}));

// DELETE /api/cart/items/:lineId
router.delete("/items/:lineId", wrap(async (req, res) => {
  const { scopedId } = await getScopedId(req, res);
  const current = await getCart(scopedId);
  const items = current.items.filter((i) => i.id !== req.params.lineId);
  const next = recalc(items, scopedId);
  await carts.set(scopedId, next);
  ok(res, { cart: next });
}));

// POST /api/cart/clear
router.post("/clear", wrap(async (req, res) => {
  const { scopedId } = await getScopedId(req, res);
  const next = recalc([], scopedId);
  await carts.set(scopedId, next);
  ok(res, { cart: next });
}));

export { lineIdFor, getCart, recalc };
export default router;
