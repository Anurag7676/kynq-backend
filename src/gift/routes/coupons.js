import express from "express";
import { collection } from "../store.js";
import { getScopedId } from "../session.js";
import { evaluateCoupon } from "../coupons.js";
import { ok, badRequest, wrap } from "../http.js";

const router = express.Router();
const carts = collection("carts");

// POST /api/coupons/validate — { code }. Discount is computed against the
// caller's own cart, fetched server-side by session/auth cookie, never a
// client-supplied subtotal, so there's nothing to game here. Checkout
// re-validates the same coupon against the same cart again independently
// (see routes/checkout.js) — this endpoint only exists so the cart/checkout
// UI can show the discount before the customer commits to paying.
router.post("/validate", wrap(async (req, res) => {
  const code = req.body?.code;
  if (!code) return badRequest(res, "coupon code required");
  const { scopedId } = await getScopedId(req, res);
  const cart = await carts.get(scopedId);
  if (!cart || !cart.items?.length) return badRequest(res, "cart is empty");

  const result = await evaluateCoupon(code, cart.subtotal);
  if (!result.valid) return badRequest(res, result.reason);

  ok(res, {
    code: result.coupon.code,
    type: result.coupon.type,
    percentOff: result.coupon.percentOff,
    amountOff: result.coupon.amountOff,
    discount: result.discount,
    subtotal: cart.subtotal,
  });
}));

export default router;
