// Folds an anonymous session's cart/wishlist/orders into a just-authenticated
// user's account. Called once, right after sign-in (see routes/auth.js
// GET /verify) — the anon session id is still readable from the
// kynq_session cookie at that point even though getScopedId() will start
// returning the user's id from here on.
import { collection } from "./store.js";

const carts = collection("carts");
const wishlists = collection("wishlists");
const orders = collection("orders");

function clampQty(qty, max) {
  if (qty <= 0) return 0;
  if (max == null || max <= 0) return Math.max(1, qty);
  return Math.min(qty, max);
}

function recalcCart(items, sessionId) {
  const itemCount = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const currency = items[0]?.currency ?? "INR";
  return { sessionId, items, itemCount, subtotal, currency, updatedAt: Date.now() };
}

async function mergeCart(anonSessionId, userId) {
  const anon = await carts.get(anonSessionId);
  if (!anon?.items?.length) return;
  const mine = (await carts.get(userId)) ?? { items: [] };

  const items = [...mine.items];
  for (const line of anon.items) {
    const existing = items.find((i) => i.id === line.id);
    if (existing) {
      existing.qty = clampQty(existing.qty + line.qty, existing.inventoryAtAdd ?? line.inventoryAtAdd);
    } else {
      items.push(line);
    }
  }
  await carts.set(userId, recalcCart(items, userId));
  await carts.delete(anonSessionId);
}

async function mergeWishlist(anonSessionId, userId) {
  const anon = await wishlists.get(anonSessionId);
  if (!anon?.items?.length) return;
  const mine = (await wishlists.get(userId)) ?? { items: [] };

  const seen = new Set(mine.items.map((i) => i.slug));
  const merged = [...mine.items, ...anon.items.filter((i) => !seen.has(i.slug))];
  await wishlists.set(userId, { sessionId: userId, items: merged, updatedAt: Date.now() });
  await wishlists.delete(anonSessionId);
}

// Past guest orders aren't moved (no cart/wishlist-style merge target — they're
// looked up individually), but re-tagging them with userId lets them show up
// in the account's order history going forward.
async function relinkOrders(anonSessionId, userId) {
  const mine = await orders.find((o) => o.sessionId === anonSessionId && !o.userId);
  for (const order of mine) {
    await orders.set(order.id, { ...order, userId });
  }
}

export async function mergeAnonymousIntoUser(anonSessionId, userId) {
  if (!anonSessionId || anonSessionId === userId) return;
  await Promise.all([mergeCart(anonSessionId, userId), mergeWishlist(anonSessionId, userId), relinkOrders(anonSessionId, userId)]);
}
