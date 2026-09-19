// Coin wallet — an append-only ledger plus a cached balance. Never a bare
// `user.coins += n`.
//
// Every movement is a `wallet_transactions` document keyed by a
// deterministic idempotency key (`${type}:${userId}:${refId}`) under a
// UNIQUE index, so a duplicate webhook, a retried request or a reconcile
// pass can never apply the same credit or debit twice. Balances live in
// `wallet_balances` and move only via atomic $inc; debits are guarded by
// `balance >= amount` in the same update, so concurrent sends can't
// overspend. reconcile() recomputes a balance strictly from the ledger.
//
// Document shapes are unchanged from the original store-backed version
// ({ _key, ...fields }), so existing data keeps working.
import mongoose from "mongoose";
import { makeId } from "../gift/store.js";
import { ECONOMY } from "./economy.js";

const TX = "wallet_transactions";
const BAL = "wallet_balances";
const coll = (name) => mongoose.connection.collection(name);

// Master Spec v3 §2 — Koins are earned through eligible chat time and
// referrals ONLY. The old daily-activity, game-win and challenge-streak
// rewards are gone; their past ledger rows remain as history (each row stores
// its own `reason`, so they still read correctly). Amounts come from
// economy.js so there is one place to change them.
export const EARN_RULES = {
  chat_minutes: { amount: ECONOMY.chat.rewardPerBlock, label: `every ${ECONOMY.chat.blockSeconds / 60} minutes of chat` },
  first_chat: { amount: ECONOMY.chat.firstChatBonus, label: `first ${ECONOMY.chat.blockSeconds / 60} minutes of chat (one time)` },
  referral: { amount: ECONOMY.referral.reward, label: `a friend you invited chats for ${ECONOMY.chat.blockSeconds / 60} minutes` },
};

export class InsufficientBalanceError extends Error {
  constructor(balance, amount) {
    super("insufficient balance");
    this.code = "INSUFFICIENT_BALANCE";
    this.balance = balance;
    this.amount = amount;
  }
}

let indexesReady = null;
export function ensureWalletIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([
      coll(TX).createIndex({ _key: 1 }, { unique: true }),
      coll(TX).createIndex({ userId: 1, createdAt: -1 }),
      coll(BAL).createIndex({ _key: 1 }, { unique: true }),
    ]).catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}

function strip(doc) {
  if (!doc) return null;
  const { _id, _key, ...rest } = doc;
  return rest;
}

function keyFor(type, userId, refId) {
  return `${type}:${userId}:${refId ?? ""}`;
}

async function bumpBalance(userId, delta, filter = {}) {
  const r = await coll(BAL).findOneAndUpdate(
    { _key: userId, ...filter },
    { $inc: { balance: delta }, $set: { userId, updatedAt: Date.now() } },
    { upsert: Object.keys(filter).length === 0, returnDocument: "after" }
  );
  return r && ("value" in r ? r.value : r);
}

/**
 * Credit coins. Idempotent per (type, userId, refId). `amount` defaults to
 * the earn rule for `type`; purchases pass it explicitly.
 */
export async function credit(userId, type, { refId, note, amount } = {}) {
  await ensureWalletIndexes();
  const rule = EARN_RULES[type];
  const value = amount ?? rule?.amount;
  if (!value || value <= 0) throw new Error(`no amount for credit type: ${type}`);
  const key = keyFor(type, userId, refId);

  const tx = {
    _key: key, id: makeId("txn"), userId, type, amount: value,
    reason: note ?? rule?.label ?? type, refId: refId ?? null, createdAt: Date.now(),
  };
  try {
    await coll(TX).insertOne(tx);
  } catch (err) {
    // Already applied: return the original row, flagged, so a caller can tell
    // "paid just now" from "was paid before" without guessing.
    if (err?.code === 11000) return { ...strip(await coll(TX).findOne({ _key: key })), duplicate: true };
    throw err;
  }
  const bal = await bumpBalance(userId, value);
  await coll(TX).updateOne({ _key: key }, { $set: { balanceAfter: bal?.balance ?? null } });
  return { ...strip(tx), balanceAfter: bal?.balance ?? null, duplicate: false };
}

/**
 * Debit coins atomically. `refId` is REQUIRED — it is the idempotency key,
 * so a retried request debits once. Throws InsufficientBalanceError unless
 * `allowNegative` (used only to reverse a refunded purchase).
 */
export async function debit(userId, type, amount, { refId, note, allowNegative = false } = {}) {
  await ensureWalletIndexes();
  if (!refId) throw new Error("debit requires a refId");
  if (!amount || amount <= 0) throw new Error("debit amount must be positive");
  const key = keyFor(type, userId, refId);

  const existing = await coll(TX).findOne({ _key: key });
  if (existing) return strip(existing); // duplicate request — already debited

  const guard = allowNegative ? {} : { balance: { $gte: amount } };
  if (!allowNegative) {
    // Make sure a balance doc exists so the guarded update can match.
    await coll(BAL).updateOne({ _key: userId }, { $setOnInsert: { userId, balance: 0, updatedAt: Date.now() } }, { upsert: true });
  }
  const bal = await bumpBalance(userId, -amount, guard);
  if (!bal) {
    const current = await coll(BAL).findOne({ _key: userId });
    throw new InsufficientBalanceError(current?.balance ?? 0, amount);
  }

  const tx = {
    _key: key, id: makeId("txn"), userId, type, amount: -amount,
    reason: note ?? type, refId, balanceAfter: bal.balance, createdAt: Date.now(),
  };
  try {
    await coll(TX).insertOne(tx);
  } catch (err) {
    if (err?.code === 11000) {
      // A concurrent identical request won the insert; give this decrement back.
      await bumpBalance(userId, amount);
      return strip(await coll(TX).findOne({ _key: key }));
    }
    throw err;
  }
  return strip(tx);
}

export async function getBalance(userId) {
  const bal = await coll(BAL).findOne({ _key: userId });
  return bal?.balance ?? 0;
}

export async function getHistory(userId, limit = 50) {
  const docs = await coll(TX).find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
  return docs.map(strip);
}

/** Recompute strictly from the ledger and repair the cache if it drifted. */
export async function reconcile(userId) {
  const [agg] = await coll(TX).aggregate([{ $match: { userId } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray();
  const total = agg?.total ?? 0;
  const cached = await coll(BAL).findOne({ _key: userId });
  if (!cached || cached.balance !== total) {
    await coll(BAL).updateOne({ _key: userId }, { $set: { userId, balance: total, updatedAt: Date.now() } }, { upsert: true });
  }
  return total;
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
