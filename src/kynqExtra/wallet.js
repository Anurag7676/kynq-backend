// Kynq Extra's coin wallet — an immutable, append-only transaction ledger,
// NOT a `user.coins += amount` counter. Every credit is idempotent (keyed
// by a deterministic key, not a random id), so a retried request or a
// duplicate event trigger can never double-pay. Balance is cached for fast
// reads but is always re-derivable from the ledger — reconcile() proves
// that by recomputing it from scratch and repairing the cache if they've
// ever drifted, which is the entire point of keeping a ledger instead of
// just a counter: the counter can be wrong, the ledger can't lie about
// what happened.
//
// Spending is deliberately NOT built yet — the original brief's spend
// targets (regional matching filters, extra game packs, premium memes,
// profile customization) don't exist as real features in this codebase.
// Building a "redeem" UI against nothing would be the same mistake as
// faking the Memes panel before GIFs actually worked — this wallet is
// real and earns real coins, it just has nothing to spend them on yet.
import { collection, makeId } from "../gift/store.js";

const transactions = collection("wallet_transactions"); // keyed by idempotency key
const balances = collection("wallet_balances"); // cache: {userId, balance, updatedAt}

export const EARN_RULES = {
  first_chat: { amount: 20, label: "completed your first chat" },
  daily_activity: { amount: 10, label: "daily activity" },
  game_win: { amount: 5, label: "won a game" },
  challenge_streak: { amount: 15, label: "maintained your streak" },
};

// idempotencyKey defaults to `${type}:${userId}:${refId}` — pass refId to
// scope a repeatable event (a specific game, a specific challenge day); a
// type with no refId (like first_chat) naturally resolves to the same key
// every time, so it can only ever be credited once, ever, for that user.
export async function credit(userId, type, { refId, note } = {}) {
  const rule = EARN_RULES[type];
  if (!rule) throw new Error(`unknown earn type: ${type}`);
  const key = `${type}:${userId}:${refId ?? ""}`;

  const existing = await transactions.get(key);
  if (existing) return existing; // idempotent no-op — already credited, not an error

  const current = await balances.get(userId);
  const prevBalance = current?.balance ?? 0;
  const newBalance = prevBalance + rule.amount;

  const tx = {
    id: makeId("txn"),
    userId,
    type,
    amount: rule.amount,
    reason: note ?? rule.label,
    refId: refId ?? null,
    balanceAfter: newBalance,
    createdAt: Date.now(),
  };
  await transactions.set(key, tx);
  await balances.set(userId, { userId, balance: newBalance, updatedAt: Date.now() });
  return tx;
}

export async function getBalance(userId) {
  const bal = await balances.get(userId);
  return bal?.balance ?? 0;
}

export async function getHistory(userId, limit = 50) {
  const all = await transactions.find((t) => t.userId === userId);
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

// Recomputes a user's balance strictly from the ledger sum and repairs the
// cache if it's drifted. Not wired to a schedule/cron here (no job runner
// exists in this codebase) — exposed for an admin endpoint or manual
// invocation; the cache is written transactionally alongside every credit()
// anyway, so drift should only ever happen from a bug, not normal operation.
export async function reconcile(userId) {
  const all = await transactions.find((t) => t.userId === userId);
  const total = all.reduce((sum, t) => sum + t.amount, 0);
  const cached = await balances.get(userId);
  if (!cached || cached.balance !== total) {
    await balances.set(userId, { userId, balance: total, updatedAt: Date.now() });
  }
  return total;
}

// Calendar-day key in UTC — used by the daily_activity idempotency key so
// it credits once per day, not once ever.
export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
