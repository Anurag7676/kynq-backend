// "Question for you two": a shared question card both people see at the same
// moment. Each person picks one of the choices privately; when both have
// picked, both picks are revealed to both screens and they talk about why. It starts light and gets deeper as the call goes
// on (or as they answer), so two strangers end up actually knowing each other.
//
// Server-timed, in memory, one entry per live call (same single-process
// assumption as the matchmaker). The deck comes from the pair's self-declared
// genders; neither client is ever told the other's gender — they only get the
// question. Answering `ECONOMY.questions.rewardAfter` together (both picked)
// pays both people once per call, capped per day. Every revealed answer is
// stored in `pair_question_answers` for the admin Nudges page.
import crypto from "crypto";
import mongoose from "mongoose";
import { findUserById } from "../gift/session.js";
import { pickPairQuestion } from "./pair-questions.js";
import { credit } from "./wallet.js";
import { ECONOMY } from "./economy.js";

const SCALE = Number(process.env.KYNQ_QUESTION_TIME_SCALE) || 1; // tests only: shrink every timer
const FIRST_MS = 20_000 * SCALE;        // the awkward first moments
const GAP_MS = 180_000 * SCALE;         // next question if nobody answers this one
const AFTER_ANSWER_MS = 90_000 * SCALE; // they're engaged: keep it going sooner
const LEVEL_EVERY_MS = 180_000 * SCALE; // time alone also deepens the questions (L2 at ~3 min, L3 at ~6)
const DAY_MS = 86_400_000;

const live = new Map(); // callId -> state
export const PAIR_ANSWERS = "pair_question_answers";
const answers = () => mongoose.connection.collection(PAIR_ANSWERS);

async function deckFor(a, b) {
  const [ua, ub] = await Promise.all([findUserById(a), findUserById(b)]);
  const g = [ua?.gender, ub?.gender].sort().join("+");
  if (g === "female+male") return "mixed";
  if (g === "male+male") return "boys";
  if (g === "female+female") return "girls";
  return "general"; // blank or "other" on either side
}

const levelOf = (st) => Math.min(3, Math.max(1 + st.answered, 1 + Math.floor((Date.now() - st.startedAt) / LEVEL_EVERY_MS)));

function schedule(io, callId, ms) {
  const st = live.get(callId);
  if (!st) return;
  clearTimeout(st.timer);
  st.timer = setTimeout(() => show(io, callId), ms);
}

function show(io, callId, level) {
  const st = live.get(callId);
  if (!st) return;
  if (!io.sockets.adapter.rooms.get(callId)) { stopPairQuestions(callId); return; } // call is gone
  const lvl = level ?? levelOf(st);
  const { q: text, options } = pickPairQuestion(st.deck, lvl, st.asked);
  st.asked.add(text);
  st.current = { qid: crypto.randomUUID().slice(0, 8), text, options, level: lvl, variant: `${st.deck}:${lvl}`, picks: new Map(), revealed: false };
  const { picks: _p, revealed: _r, ...pub } = st.current;
  io.to(callId).emit("question:show", {
    ...pub,
    answered: st.answered,
    rewardAfter: ECONOMY.questions.rewardAfter,
    reward: st.rewarded ? 0 : ECONOMY.questions.reward,
  });
  schedule(io, callId, GAP_MS);
}

/** Both clients call this once their call is actually connected; the first one starts the clock. */
export function startPairQuestions(io, callId, a, b) {
  if (!callId || !a || !b || live.has(callId)) return;
  live.set(callId, { deck: "general", startedAt: Date.now(), answered: 0, asked: new Set(), current: null, rewarded: false, timer: null, lastSkipAt: 0 });
  deckFor(a, b).then((deck) => { const st = live.get(callId); if (st) st.deck = deck; }).catch(() => {});
  schedule(io, callId, FIRST_MS);
}

export function stopPairQuestions(callId) {
  const st = live.get(callId);
  if (!st) return;
  clearTimeout(st.timer);
  live.delete(callId);
}

async function rewardedToday(userId) {
  return mongoose.connection.collection("wallet_transactions")
    .countDocuments({ userId, type: "question_bonus", createdAt: { $gte: Date.now() - DAY_MS } });
}

/**
 * One person's pick (index into the options). Picks are locked once made and
 * stay hidden until both have picked; then both screens get both picks.
 * `who` = { scopedId, userId } from the authenticated socket.
 * Resolves to { ok, paid: [{ userId, amount }] } — the caller notifies wallets.
 */
export async function pickPairAnswer(io, callId, qid, choice, who, participants) {
  const st = live.get(callId);
  const cur = st?.current;
  const i = Number(choice);
  if (!cur || cur.qid !== qid || cur.revealed || !Number.isInteger(i) || i < 0 || i >= cur.options.length) return { ok: false, paid: [] };
  if (cur.picks.has(who.scopedId)) return { ok: true, paid: [] };
  cur.picks.set(who.scopedId, { choice: i, userId: who.userId ?? null });

  // Tell each screen what it needs: its own pick, and only *whether* the other side has picked.
  const sockets = await io.in(callId).fetchSockets();
  if (cur.picks.size < 2) {
    for (const s of sockets) s.emit("question:progress", { qid, you: cur.picks.get(s.data.scopedId)?.choice ?? null, themPicked: [...cur.picks.keys()].some((k) => k !== s.data.scopedId) });
    return { ok: true, paid: [] };
  }

  cur.revealed = true;
  st.answered += 1;
  const [[aId, a], [bId, b]] = [...cur.picks.entries()];
  for (const s of sockets) {
    const mine = s.data.scopedId === aId ? a : b, theirs = s.data.scopedId === aId ? b : a;
    s.emit("question:reveal", { qid, you: mine.choice, them: theirs.choice, answered: st.answered });
  }
  schedule(io, callId, AFTER_ANSWER_MS);
  answers().insertOne({
    callId, qid, deck: st.deck, level: cur.level, text: cur.text, options: cur.options,
    picks: [{ userId: a.userId, choice: a.choice }, { userId: b.userId, choice: b.choice }],
    match: a.choice === b.choice, at: Date.now(),
  }).catch((err) => console.error("[questions] save answer failed:", err.message));

  const paid = [];
  if (!st.rewarded && st.answered >= ECONOMY.questions.rewardAfter) {
    st.rewarded = true;
    for (const userId of participants) {
      if ((await rewardedToday(userId).catch(() => Infinity)) >= ECONOMY.questions.maxRewardedPerDay) continue;
      const tx = await credit(userId, "question_bonus", { refId: callId }).catch(() => null);
      if (tx && !tx.duplicate) paid.push({ userId, amount: tx.amount });
    }
  }
  return { ok: true, paid };
}

/**
 * Skip (before both picked): a different question at the same depth. Next
 * (after the reveal): the next question, deeper if they've earned it.
 * Throttled so two fast tappers don't race.
 */
export function skipPairQuestion(io, callId, qid) {
  const st = live.get(callId);
  if (!st?.current || st.current.qid !== qid || Date.now() - st.lastSkipAt < 1500) return false;
  st.lastSkipAt = Date.now();
  show(io, callId, st.current.revealed ? undefined : st.current.level);
  return true;
}

export async function ensurePairAnswerIndexes() {
  await Promise.all([answers().createIndex({ at: -1 }), answers().createIndex({ "picks.userId": 1, at: -1 })]);
}
