// Virtual gifts: buy with coins into an inventory, send during a call.
//
//   catalog (server-owned prices)
//     → buyGift: wallet.debit (idempotent per requestId) → inventory $inc
//     → sendGift: inventory $inc -1 guarded by qty >= 1 → gift_sends record
//     → socket emits gift:received to both participants
//
// Every mutating call takes a client-generated requestId that becomes the
// idempotency key, so retries after a disconnect can't double-buy or
// double-send. Inventory only moves through atomic guarded updates, so
// concurrent sends can't spend a gift twice. Authorisation for sends comes
// from the socket's own call state (who you're actually in a call with),
// never from ids the client supplies.
import mongoose from "mongoose";
import { makeId } from "../gift/store.js";
import { debit, InsufficientBalanceError } from "./wallet.js";

const INV = "gift_inventory";
const PURCHASES = "gift_purchases";
const SENDS = "gift_sends";
const coll = (name) => mongoose.connection.collection(name);

// Coin prices are placeholders pending a business decision.
export const GIFT_CATALOG = [
  { id: "heart", name: "Heart", price: 50 },
  { id: "rose", name: "Rose", price: 120 },
  { id: "fire", name: "Fire", price: 200 },
  { id: "celebration", name: "Celebration", price: 350 },
  { id: "star", name: "Star", price: 600 },
  { id: "diamond", name: "Diamond", price: 1500 },
];
const byId = Object.fromEntries(GIFT_CATALOG.map((g) => [g.id, g]));

export class GiftError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export { InsufficientBalanceError };

let indexesReady = null;
function ensureIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([
      coll(INV).createIndex({ _key: 1 }, { unique: true }),
      coll(INV).createIndex({ userId: 1 }),
      coll(PURCHASES).createIndex({ _key: 1 }, { unique: true }),
      coll(SENDS).createIndex({ _key: 1 }, { unique: true }),
      coll(SENDS).createIndex({ fromUserId: 1, createdAt: -1 }),
      coll(SENDS).createIndex({ toUserId: 1, createdAt: -1 }),
    ]).catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}
const strip = (d) => { if (!d) return null; const { _id, _key, ...rest } = d; return rest; };
const invKey = (userId, giftId) => `${userId}:${giftId}`;
const validRequestId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);

export function listCatalog() {
  return GIFT_CATALOG.map((g) => ({ ...g }));
}

export async function getInventory(userId) {
  await ensureIndexes();
  const docs = await coll(INV).find({ userId, qty: { $gt: 0 } }).toArray();
  return Object.fromEntries(docs.map((d) => [d.giftId, d.qty]));
}

/** Buy `qty` of a gift. Idempotent per requestId. Throws InsufficientBalanceError / GiftError. */
export async function buyGift({ userId, giftId, qty = 1, requestId }) {
  await ensureIndexes();
  const gift = byId[giftId];
  if (!gift) throw new GiftError("BAD_GIFT", "unknown gift");
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new GiftError("BAD_QTY", "quantity must be 1–20");
  if (!validRequestId(requestId)) throw new GiftError("BAD_REQUEST_ID", "requestId required");

  const key = `${userId}:${requestId}`;
  const existing = await coll(PURCHASES).findOne({ _key: key });
  if (existing?.status === "done") return strip(existing);

  const total = gift.price * qty;
  // 1. Debit (idempotent on the same requestId).
  await debit(userId, "gift_purchase", total, { refId: requestId, note: `bought ${qty} × ${gift.name}` });
  // 2. Claim the purchase record, then apply inventory exactly once.
  if (!existing) {
    try {
      await coll(PURCHASES).insertOne({ _key: key, id: makeId("gpur"), userId, giftId, qty, coins: total, requestId, status: "pending", createdAt: Date.now() });
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }
  const claim = await coll(PURCHASES).findOneAndUpdate({ _key: key, status: "pending" }, { $set: { status: "applying" } });
  const claimed = claim && ("value" in claim ? claim.value : claim);
  if (claimed) {
    await coll(INV).updateOne({ _key: invKey(userId, giftId) }, { $inc: { qty }, $setOnInsert: { userId, giftId } }, { upsert: true });
    await coll(PURCHASES).updateOne({ _key: key }, { $set: { status: "done", appliedAt: Date.now() } });
  }
  return strip(await coll(PURCHASES).findOne({ _key: key }));
}

/**
 * Consume one gift from `fromUserId`'s inventory and record the send.
 * Idempotent per requestId; concurrent sends can't overspend inventory.
 */
export async function sendGift({ callId, fromUserId, toUserId, giftId, requestId }) {
  await ensureIndexes();
  const gift = byId[giftId];
  if (!gift) throw new GiftError("BAD_GIFT", "unknown gift");
  if (!validRequestId(requestId)) throw new GiftError("BAD_REQUEST_ID", "requestId required");

  const key = `${fromUserId}:${requestId}`;
  const existing = await coll(SENDS).findOne({ _key: key });
  if (existing) return strip(existing);

  const dec = await coll(INV).findOneAndUpdate(
    { _key: invKey(fromUserId, giftId), qty: { $gte: 1 } },
    { $inc: { qty: -1 } },
    { returnDocument: "after" }
  );
  const after = dec && ("value" in dec ? dec.value : dec);
  if (!after) throw new GiftError("NO_INVENTORY", "you don't have that gift");

  const send = { _key: key, id: makeId("gsend"), callId, fromUserId, toUserId, giftId, name: gift.name, requestId, createdAt: Date.now() };
  try {
    await coll(SENDS).insertOne(send);
  } catch (err) {
    if (err?.code === 11000) {
      await coll(INV).updateOne({ _key: invKey(fromUserId, giftId) }, { $inc: { qty: 1 } }); // a concurrent duplicate won; give this one back
      return strip(await coll(SENDS).findOne({ _key: key }));
    }
    throw err;
  }
  return { ...strip(send), remaining: after.qty };
}

export async function listGiftHistory(userId, limit = 50) {
  await ensureIndexes();
  const docs = await coll(SENDS)
    .find({ $or: [{ fromUserId: userId }, { toUserId: userId }] })
    .sort({ createdAt: -1 }).limit(limit).toArray();
  return docs.map(strip);
}
