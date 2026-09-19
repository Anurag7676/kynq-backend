// 7-Day Challenge — the one feature in Kynq Extra that deliberately does
// NOT live inside a call room. A call is a single live session; this spans
// real calendar days, so participants need to be able to check in hours or
// days apart, independently of whether the other person is online right
// now. Everything here is plain REST (Backend/src/gift/routes/kynq-extra.js),
// not sockets — there's no "both must be connected" requirement.
//
// State machine per challenge:
//   pending_accept -> active -> completed
//                  \-> declined
// Per day (1-7), in order:
//   1. 5 questions, asker alternating each question starting with
//      whoever proposed the challenge. Each question: asker picks from
//      3 server-offered options, other player answers whenever they're
//      online.
//   2. One "day game" — reuses the Would You Rather / This or That
//      content (not the live-call game engine, which needs a socket
//      room) since both are naturally async: pick an answer, no timing
//      requirement.
//   3. One "moment" — a text caption (+ optional GIF url, reusing the
//      same GIF picker already built for chat). Real photo/voice upload
//      would need blob storage that doesn't exist yet in this codebase —
//      deliberately simplified for V1, not silently dropped.
// Day N completes once all three are done; day N+1 then unlocks.
import { collection, makeId } from "../gift/store.js";
import { pickQuestionOptions } from "./challenge-questions.js";
import { randomAsyncGamePrompt } from "./challenge-game.js";

const challenges = collection("challenges");
const QUESTIONS_PER_DAY = 5;
const TOTAL_DAYS = 7;
const STREAK_GRACE_MS = 48 * 60 * 60 * 1000; // a day counts toward the streak if the previous day completed within 48h

function emptyDay(dayNumber, firstAsker) {
  return {
    day: dayNumber,
    questions: [],
    askTurn: firstAsker,
    game: randomAsyncGamePrompt(),
    gameAnswers: {},
    moment: null,
    completedAt: null,
  };
}

function isDayComplete(day) {
  return day.questions.length >= QUESTIONS_PER_DAY
    && day.questions.every((q) => q.answer != null)
    && Object.keys(day.gameAnswers).length >= 2
    && !!day.moment;
}

function otherParticipant(challenge, scopedId) {
  return challenge.participantA === scopedId ? challenge.participantB : challenge.participantA;
}

export async function proposeChallenge(fromScopedId, toScopedId) {
  if (fromScopedId === toScopedId) throw new Error("can't challenge yourself");
  const all = await challenges.list();
  const existing = all.find((c) =>
    ["pending_accept", "active"].includes(c.status)
    && [c.participantA, c.participantB].includes(fromScopedId)
    && [c.participantA, c.participantB].includes(toScopedId)
  );
  if (existing) throw new Error("there's already an active or pending challenge with this person");

  const id = makeId("chl");
  const now = Date.now();
  const challenge = {
    id,
    participantA: fromScopedId,
    participantB: toScopedId,
    status: "pending_accept",
    currentDay: 1,
    streak: 0,
    createdBy: fromScopedId,
    createdAt: now,
    updatedAt: now,
    days: {}, // populated once accepted
  };
  await challenges.set(id, challenge);
  return challenge;
}

export async function respondToChallenge(challengeId, scopedId, accept) {
  const challenge = await challenges.get(challengeId);
  if (!challenge) throw new Error("challenge not found");
  if (challenge.participantB !== scopedId) throw new Error("only the invited person can respond");
  if (challenge.status !== "pending_accept") throw new Error("challenge already responded to");

  if (!accept) {
    const declined = { ...challenge, status: "declined", updatedAt: Date.now() };
    await challenges.set(challengeId, declined);
    return declined;
  }

  const next = {
    ...challenge,
    status: "active",
    days: { 1: emptyDay(1, challenge.createdBy) },
    updatedAt: Date.now(),
  };
  await challenges.set(challengeId, next);
  return next;
}

export async function listMyChallenges(scopedId) {
  const all = await challenges.list();
  return all.filter((c) => c.participantA === scopedId || c.participantB === scopedId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChallenge(challengeId, scopedId) {
  const challenge = await challenges.get(challengeId);
  if (!challenge) return null;
  if (challenge.participantA !== scopedId && challenge.participantB !== scopedId) return null;
  return challenge;
}

function requireActiveDay(challenge) {
  const day = challenge.days[challenge.currentDay];
  if (!day) throw new Error("day not started");
  if (day.completedAt) throw new Error("today's day is already complete");
  return day;
}

export async function getQuestionOptions(challengeId, scopedId) {
  const challenge = await getChallenge(challengeId, scopedId);
  if (!challenge || challenge.status !== "active") throw new Error("challenge not active");
  const day = requireActiveDay(challenge);
  if (day.askTurn !== scopedId) throw new Error("not your turn to ask");
  const used = day.questions.map((q) => q.question);
  return pickQuestionOptions(used);
}

export async function askQuestion(challengeId, scopedId, question) {
  const challenge = await getChallenge(challengeId, scopedId);
  if (!challenge || challenge.status !== "active") throw new Error("challenge not active");
  const day = requireActiveDay(challenge);
  if (day.askTurn !== scopedId) throw new Error("not your turn to ask");
  if (day.questions.length >= QUESTIONS_PER_DAY) throw new Error("today's questions are done");
  if (!question || typeof question !== "string") throw new Error("question required");

  day.questions.push({ index: day.questions.length, askedBy: scopedId, question: question.trim().slice(0, 300), answer: null, answeredAt: null });
  day.askTurn = null; // no one's "turn to ask" again until this one's answered
  return persistDayUpdate(challenge, day);
}

export async function answerQuestion(challengeId, scopedId, answer) {
  const challenge = await getChallenge(challengeId, scopedId);
  if (!challenge || challenge.status !== "active") throw new Error("challenge not active");
  const day = requireActiveDay(challenge);
  const pending = day.questions.find((q) => q.answer == null);
  if (!pending) throw new Error("nothing to answer right now");
  if (pending.askedBy === scopedId) throw new Error("wait for them to answer their own question");
  if (!answer || typeof answer !== "string") throw new Error("answer required");

  pending.answer = answer.trim().slice(0, 1000);
  pending.answeredAt = Date.now();
  // Alternate the asker: whoever just answered gets to ask next (unless
  // today's quota is already used up).
  day.askTurn = day.questions.length < QUESTIONS_PER_DAY ? scopedId : null;
  return persistDayUpdate(challenge, day);
}

export async function answerDayGame(challengeId, scopedId, choice) {
  const challenge = await getChallenge(challengeId, scopedId);
  if (!challenge || challenge.status !== "active") throw new Error("challenge not active");
  const day = requireActiveDay(challenge);
  if (!["a", "b"].includes(choice)) throw new Error("invalid choice");
  if (day.gameAnswers[scopedId]) throw new Error("already answered today's game");

  day.gameAnswers[scopedId] = choice;
  return persistDayUpdate(challenge, day);
}

export async function shareMoment(challengeId, scopedId, { caption, gifUrl }) {
  const challenge = await getChallenge(challengeId, scopedId);
  if (!challenge || challenge.status !== "active") throw new Error("challenge not active");
  const day = requireActiveDay(challenge);
  if (day.moment) throw new Error("today's moment is already shared");
  if (!caption && !gifUrl) throw new Error("add a caption or a gif");

  day.moment = { caption: caption ? String(caption).trim().slice(0, 300) : null, gifUrl: gifUrl || null, sharedBy: scopedId, sharedAt: Date.now() };
  return persistDayUpdate(challenge, day);
}

async function persistDayUpdate(challenge, day) {
  const now = Date.now();
  let next = { ...challenge, days: { ...challenge.days, [day.day]: day }, updatedAt: now };

  if (isDayComplete(day) && !day.completedAt) {
    day.completedAt = now;
    next.days[day.day] = day;

    const prevDay = challenge.days[day.day - 1];
    const withinGrace = day.day === 1 || (prevDay?.completedAt && now - prevDay.completedAt <= STREAK_GRACE_MS);
    next.streak = withinGrace ? (challenge.streak || 0) + 1 : 1;

    // Streaks no longer pay Koins: Master Spec v3 §2 makes eligible chat time
    // and referrals the ONLY ways to earn. The streak is still tracked and
    // shown — it just isn't a payout any more.

    if (day.day >= TOTAL_DAYS) {
      next.status = "completed";
    } else {
      const nextDayNumber = day.day + 1;
      const nextAsker = otherParticipant(challenge, day.questions[0]?.askedBy ?? challenge.createdBy);
      next.days[nextDayNumber] = emptyDay(nextDayNumber, nextAsker);
      next.currentDay = nextDayNumber;
    }
  }

  await challenges.set(challenge.id, next);
  return next;
}
