// Coupon codes — either percentage-off or a flat rupee amount off. Ports
// the collection() pattern used everywhere else in the gift API —
// documents keyed by normalized code.
import { collection } from "./store.js";

const coupons = collection("coupons");

export function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

export async function getCoupon(code) {
  return coupons.get(normalizeCode(code));
}

// Exactly one of percentOff (1-100) / amountOff (rupees, > 0) must be set.
export async function createCoupon({ code, percentOff, amountOff, expiresAt, maxRedemptions, minSubtotal }) {
  const normalized = normalizeCode(code);
  if (!normalized) throw new Error("code required");
  if (percentOff != null && amountOff != null) throw new Error("pass percentOff or amountOff, not both");
  if (percentOff == null && amountOff == null) throw new Error("percentOff or amountOff required");
  if (percentOff != null && !(percentOff > 0 && percentOff <= 100)) {
    throw new Error("percentOff must be between 1 and 100");
  }
  if (amountOff != null && !(amountOff > 0)) throw new Error("amountOff must be greater than 0");
  const existing = await coupons.get(normalized);
  if (existing) throw new Error(`coupon ${normalized} already exists`);
  const coupon = {
    code: normalized,
    type: percentOff != null ? "percent" : "flat",
    percentOff: percentOff ?? null,
    amountOff: amountOff ?? null,
    active: true,
    expiresAt: expiresAt ?? null,
    maxRedemptions: maxRedemptions ?? null,
    minSubtotal: minSubtotal ?? null,
    redemptionsCount: 0,
    createdAt: Date.now(),
  };
  await coupons.set(normalized, coupon);
  return coupon;
}

// Never throws — safe to call directly from a route handler. subtotal is
// always the caller's own cart subtotal, computed server-side, never a
// client-supplied number, so there's nothing to game by lying about it.
export async function evaluateCoupon(code, subtotal) {
  const normalized = normalizeCode(code);
  if (!normalized) return { valid: false, reason: "enter a coupon code" };
  const coupon = await coupons.get(normalized);
  if (!coupon) return { valid: false, reason: "coupon not found" };
  if (!coupon.active) return { valid: false, reason: "this coupon is no longer active" };
  if (coupon.expiresAt && Date.now() > coupon.expiresAt) return { valid: false, reason: "this coupon has expired" };
  if (coupon.maxRedemptions != null && coupon.redemptionsCount >= coupon.maxRedemptions) {
    return { valid: false, reason: "this coupon has already been fully redeemed" };
  }
  if (coupon.minSubtotal && subtotal < coupon.minSubtotal) {
    return { valid: false, reason: `add ₹${coupon.minSubtotal - subtotal} more to use this coupon` };
  }
  // Flat discounts are capped at the subtotal — a ₹100-off code against a
  // ₹60 cart takes ₹60 off, not into negative territory.
  const discount = coupon.type === "flat"
    ? Math.min(coupon.amountOff, subtotal)
    : Math.round(subtotal * (coupon.percentOff / 100));
  return { valid: true, coupon, discount };
}

// Called once an order actually gets paid (not at checkout-session creation)
// so abandoned/failed payments don't burn a limited-redemption coupon.
export async function redeemCoupon(code) {
  const normalized = normalizeCode(code);
  const coupon = await coupons.get(normalized);
  if (!coupon) return;
  await coupons.set(normalized, { ...coupon, redemptionsCount: (coupon.redemptionsCount || 0) + 1 });
}
