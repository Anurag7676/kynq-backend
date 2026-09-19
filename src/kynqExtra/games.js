// Server-authoritative game engines for Kynq Extra's in-call mini-games.
// Every move is validated here, server-side, before the state is persisted
// and broadcast — a forged socket event claiming an out-of-turn move or an
// invalid choice is rejected, not trusted. This is the whole point of
// routing moves through the signaling server instead of a WebRTC data
// channel (see the plan's game-state-sync decision).
//
// Some games have per-player hidden information (a quiz's correct answer
// before both have answered; Guess the Word's secret, visible only to the
// describer) — the full, unredacted state is what's persisted and used for
// server-side validation; redactState() strips what a given viewer isn't
// allowed to see before signaling.js broadcasts it. Never redact before
// persisting, only before sending.

export const GAME_TYPES = [
  "tic-tac-toe", "rock-paper-scissors", "would-you-rather",
  "truth-or-dare", "quick-quiz", "guess-the-word", "this-or-that",
];

// Games where the FIRST move belongs to a specific player (participantA)
// rather than being simultaneous/free-for-all — signaling.js uses this to
// seed the initial turnOf when a game starts.
export const TURN_BASED_GAMES = ["tic-tac-toe", "truth-or-dare"];

const WOULD_YOU_RATHER_PROMPTS = [
  { a: "travel back in time", b: "travel to the future" },
  { a: "be able to fly", b: "be invisible" },
  { a: "always be 10 minutes late", b: "always be 20 minutes early" },
  { a: "know how you'll die", b: "know when you'll die" },
  { a: "lose all your memories", b: "never make a new one again" },
];
function randomWouldYouRather() {
  return WOULD_YOU_RATHER_PROMPTS[Math.floor(Math.random() * WOULD_YOU_RATHER_PROMPTS.length)];
}
// Exported for challenge-game.js — the 7-Day Challenge's daily "game" step
// reuses this same prompt content (it's naturally async: pick an answer,
// no live-connection requirement), rather than duplicating the list.
export { randomWouldYouRather };

const THIS_OR_THAT_PROMPTS = [
  { a: "coffee", b: "tea" }, { a: "beach", b: "mountains" },
  { a: "morning person", b: "night owl" }, { a: "sweet", b: "savory" },
  { a: "books", b: "movies" }, { a: "call", b: "text" },
  { a: "city life", b: "countryside" }, { a: "dogs", b: "cats" },
  { a: "winter", b: "summer" }, { a: "planned", b: "spontaneous" },
];
export function randomThisOrThat() {
  return THIS_OR_THAT_PROMPTS[Math.floor(Math.random() * THIS_OR_THAT_PROMPTS.length)];
}

const TRUTH_PROMPTS = [
  "what's a habit you're trying to break?",
  "what's the most spontaneous thing you've ever done?",
  "what's something you're secretly proud of?",
  "what's a lie you've told that you still feel bad about?",
  "what's your biggest fear about the future?",
  "what's the last thing that made you cry?",
  "what's something about you most people get wrong?",
  "if you could redo one decision, what would it be?",
];
// CURATION RULE (Master Spec v3 §4) — every dare must be:
//   • about the person doing it, never the OTHER person (no impressions of,
//     nicknames for, or judgements about a stranger → that's humiliation);
//   • free of requests for personal information or private content (no camera
//     roll, messages, socials, address, surroundings);
//   • not dangerous, not sexual, not humiliating;
//   • skippable at no cost — nothing here is ever "forced".
// User-submitted dares are not supported in the MVP; this list is the only source.
const DARE_PROMPTS = [
  "talk in an accent for the next 2 minutes",
  "tell a joke — bonus points if it's actually funny",
  "sing the chorus of your most-played song",
  "describe your day using only questions",
  "do 10 jumping jacks on camera",
  "do your best movie-trailer voice for 10 seconds",
  "give yourself a superhero name and explain your power",
  "invent a 10-second jingle for your favourite snack",
];

const QUIZ_QUESTIONS = [
  { q: "What's the capital of Japan?", options: ["Seoul", "Tokyo", "Beijing", "Bangkok"], correct: 1 },
  { q: "How many continents are there?", options: ["5", "6", "7", "8"], correct: 2 },
  { q: "What's the largest planet in our solar system?", options: ["Earth", "Saturn", "Jupiter", "Neptune"], correct: 2 },
  { q: "Which language has the most native speakers?", options: ["English", "Hindi", "Spanish", "Mandarin"], correct: 3 },
  { q: "What's the fastest land animal?", options: ["Lion", "Cheetah", "Horse", "Ostrich"], correct: 1 },
  { q: "Which ocean is the largest?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correct: 3 },
  { q: "How many strings does a standard guitar have?", options: ["4", "5", "6", "7"], correct: 2 },
  { q: "What's the currency of Japan?", options: ["Yuan", "Won", "Yen", "Ringgit"], correct: 2 },
  { q: "Which planet is known as the Red Planet?", options: ["Venus", "Mars", "Mercury", "Jupiter"], correct: 1 },
  { q: "What's the tallest mountain in the world?", options: ["K2", "Kangchenjunga", "Everest", "Makalu"], correct: 2 },
];
function randomQuizQuestion() {
  return QUIZ_QUESTIONS[Math.floor(Math.random() * QUIZ_QUESTIONS.length)];
}

const WORD_LIST = [
  "pizza", "umbrella", "dragon", "laptop", "guitar", "ocean", "rocket", "coffee",
  "bicycle", "volcano", "penguin", "castle", "camera", "jungle", "diamond",
  "sandwich", "compass", "lantern", "hurricane", "telescope",
];
function randomWord() {
  return WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
}

// ─── Tic Tac Toe ───────────────────────────────────────────
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function ticTacToeInitial(participantA, participantB) {
  return { board: Array(9).fill(null), symbols: { [participantA]: "X", [participantB]: "O" } };
}

function ticTacToeWinner(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every((cell) => cell) ? "draw" : null;
}

function ticTacToeMove(session, scopedId, move) {
  const idx = move?.index;
  if (!Number.isInteger(idx) || idx < 0 || idx > 8) return { ok: false, reason: "invalid cell" };
  if (session.state.board[idx] != null) return { ok: false, reason: "cell already taken" };

  const board = [...session.state.board];
  board[idx] = session.state.symbols[scopedId];
  const winnerSymbol = ticTacToeWinner(board);

  let status = "active";
  let winner = null;
  if (winnerSymbol === "draw") {
    status = "ended";
  } else if (winnerSymbol) {
    status = "ended";
    winner = Object.entries(session.state.symbols).find(([, sym]) => sym === winnerSymbol)?.[0] ?? null;
  }

  const otherPlayer = Object.keys(session.state.symbols).find((id) => id !== scopedId);
  return {
    ok: true,
    state: { ...session.state, board },
    turnOf: status === "active" ? otherPlayer : null,
    status,
    winner,
  };
}

// ─── Rock Paper Scissors ───────────────────────────────────
// Not strictly turn-based — both players submit simultaneously, then the
// round reveals. `turnOf` is unused (null); validity is "have you already
// submitted this round" instead of "is it your turn."
function rpsInitial() {
  return { choices: {}, round: 1, winner: null };
}

function rpsBeats(a, b) {
  return (a === "rock" && b === "scissors") || (a === "paper" && b === "rock") || (a === "scissors" && b === "paper");
}

function rpsMove(session, scopedId, move) {
  const choice = move?.choice;
  if (!["rock", "paper", "scissors"].includes(choice)) return { ok: false, reason: "invalid choice" };
  if (session.state.choices[scopedId]) return { ok: false, reason: "already chose this round" };

  const choices = { ...session.state.choices, [scopedId]: choice };
  const submitted = Object.keys(choices);
  if (submitted.length < 2) {
    return { ok: true, state: { ...session.state, choices }, turnOf: null, status: "active", winner: null };
  }

  const [p1, p2] = submitted;
  let roundWinner = null;
  if (choices[p1] !== choices[p2]) roundWinner = rpsBeats(choices[p1], choices[p2]) ? p1 : p2;

  return {
    ok: true,
    state: { choices: {}, round: session.state.round + 1, lastRound: { choices, winner: roundWinner } },
    turnOf: null,
    status: "active", // RPS continues indefinitely until players end the call/game
    winner: roundWinner,
  };
}

// ─── Would You Rather ──────────────────────────────────────
function wouldYouRatherInitial() {
  return { prompt: randomWouldYouRather(), answers: {} };
}

function wouldYouRatherMove(session, scopedId, move) {
  const choice = move?.choice;
  if (!["a", "b"].includes(choice)) return { ok: false, reason: "invalid choice" };
  if (session.state.answers[scopedId]) return { ok: false, reason: "already answered" };

  const answers = { ...session.state.answers, [scopedId]: choice };
  if (Object.keys(answers).length < 2) {
    return { ok: true, state: { ...session.state, answers }, turnOf: null, status: "active", winner: null };
  }

  return {
    ok: true,
    state: { prompt: randomWouldYouRather(), answers: {}, lastRound: { prompt: session.state.prompt, answers } },
    turnOf: null,
    status: "active",
    winner: null,
  };
}

// ─── This or That ──────────────────────────────────────────
// Same shape as Would You Rather — simultaneous, no "right" answer, just
// see-what-they-picked.
function thisOrThatInitial() {
  return { prompt: randomThisOrThat(), answers: {} };
}

function thisOrThatMove(session, scopedId, move) {
  const choice = move?.choice;
  if (!["a", "b"].includes(choice)) return { ok: false, reason: "invalid choice" };
  if (session.state.answers[scopedId]) return { ok: false, reason: "already answered" };

  const answers = { ...session.state.answers, [scopedId]: choice };
  if (Object.keys(answers).length < 2) {
    return { ok: true, state: { ...session.state, answers }, turnOf: null, status: "active", winner: null };
  }
  return {
    ok: true,
    state: { prompt: randomThisOrThat(), answers: {}, lastRound: { prompt: session.state.prompt, answers } },
    turnOf: null,
    status: "active",
    winner: null,
  };
}

// ─── Truth or Dare ─────────────────────────────────────────
// Turn-based, two phases per turn: "choose" (truth/dare), then "prompt"
// (mark done once they've answered/performed it out loud — the actual
// content of a truth/dare can't be server-validated, same limitation as
// any voice/video content per the plan's moderation section).
function truthOrDareInitial(participantA, participantB) {
  return { players: [participantA, participantB], turnPlayer: participantA, phase: "choose", prompt: null, choice: null, round: 1 };
}

function truthOrDareMove(session, scopedId, move) {
  const { turnPlayer, phase, players } = session.state;
  if (scopedId !== turnPlayer) return { ok: false, reason: "not your turn" };

  if (phase === "choose") {
    const choice = move?.choice;
    if (!["truth", "dare"].includes(choice)) return { ok: false, reason: "invalid choice" };
    const list = choice === "truth" ? TRUTH_PROMPTS : DARE_PROMPTS;
    const prompt = list[Math.floor(Math.random() * list.length)];
    return {
      ok: true,
      state: { ...session.state, phase: "prompt", prompt, choice },
      turnOf: turnPlayer,
      status: "active",
      winner: null,
    };
  }

  if (move?.action !== "done") return { ok: false, reason: "invalid action" };
  const nextPlayer = players.find((p) => p !== turnPlayer);
  return {
    ok: true,
    state: { ...session.state, phase: "choose", prompt: null, choice: null, turnPlayer: nextPlayer, round: session.state.round + 1 },
    turnOf: nextPlayer,
    status: "active",
    winner: null,
  };
}

// ─── Quick Quiz ─────────────────────────────────────────────
// Simultaneous answers, like RPS. The correct answer index (_correct) is
// part of the authoritative state (needed to score a move) but stripped
// by redactState() before any client ever sees it, until both have
// answered and it's revealed as part of lastRound.
function quickQuizInitial() {
  const q = randomQuizQuestion();
  return { question: q.q, options: q.options, _correct: q.correct, answers: {}, score: {}, round: 1 };
}

function quickQuizMove(session, scopedId, move) {
  const idx = move?.choice;
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return { ok: false, reason: "invalid choice" };
  if (session.state.answers[scopedId] != null) return { ok: false, reason: "already answered" };

  const answers = { ...session.state.answers, [scopedId]: idx };
  if (Object.keys(answers).length < 2) {
    return { ok: true, state: { ...session.state, answers }, turnOf: null, status: "active", winner: null };
  }

  const correct = session.state._correct;
  const score = { ...session.state.score };
  let roundWinner = null;
  const entries = Object.entries(answers);
  const winners = entries.filter(([, a]) => a === correct).map(([id]) => id);
  if (winners.length === 1) {
    roundWinner = winners[0];
    score[roundWinner] = (score[roundWinner] || 0) + 1;
  }

  const next = randomQuizQuestion();
  return {
    ok: true,
    state: {
      question: next.q, options: next.options, _correct: next.correct, answers: {}, score,
      round: session.state.round + 1,
      lastRound: { question: session.state.question, options: session.state.options, correct, answers, winner: roundWinner },
    },
    turnOf: null,
    status: "active",
    winner: roundWinner,
  };
}

// ─── Guess the Word ─────────────────────────────────────────
// One player (describerScopedId) sees the secret word and describes it out
// loud (voice, not server-mediated); the other guesses via text moves.
// The word is authoritative state but redacted per-viewer — the describer
// sees it, the guesser doesn't (see redactState()).
function guessWordInitial(participantA, participantB) {
  return {
    players: [participantA, participantB],
    describerScopedId: participantA,
    word: randomWord(),
    score: { [participantA]: 0, [participantB]: 0 },
    round: 1,
    lastGuess: null,
  };
}

function guessWordMove(session, scopedId, move) {
  const { describerScopedId, players, word, score } = session.state;
  if (scopedId === describerScopedId) return { ok: false, reason: "you're describing — wait for a guess" };
  const guess = String(move?.guess ?? "").trim().toLowerCase();
  if (!guess) return { ok: false, reason: "enter a guess" };

  if (guess === word.toLowerCase()) {
    const nextDescriber = players.find((p) => p !== describerScopedId);
    const newScore = { ...score, [scopedId]: (score[scopedId] || 0) + 1 };
    return {
      ok: true,
      state: { ...session.state, describerScopedId: nextDescriber, word: randomWord(), score: newScore, round: session.state.round + 1, lastGuess: { correct: true, guess, by: scopedId } },
      turnOf: null,
      status: "active",
      winner: scopedId,
    };
  }

  return {
    ok: true,
    state: { ...session.state, lastGuess: { correct: false, guess, by: scopedId } },
    turnOf: null,
    status: "active",
    winner: null,
  };
}

const ENGINES = {
  "tic-tac-toe": { initial: ticTacToeInitial, move: ticTacToeMove },
  "rock-paper-scissors": { initial: rpsInitial, move: rpsMove },
  "would-you-rather": { initial: wouldYouRatherInitial, move: wouldYouRatherMove },
  "this-or-that": { initial: thisOrThatInitial, move: thisOrThatMove },
  "truth-or-dare": { initial: truthOrDareInitial, move: truthOrDareMove },
  "quick-quiz": { initial: quickQuizInitial, move: quickQuizMove },
  "guess-the-word": { initial: guessWordInitial, move: guessWordMove },
};

export function createInitialState(gameType, participantA, participantB) {
  const engine = ENGINES[gameType];
  if (!engine) throw new Error(`unknown game type: ${gameType}`);
  return engine.initial(participantA, participantB);
}

// Never throws — returns { ok: false, reason } for any invalid move so the
// caller can relay a clean rejection back over the socket.
export function applyMove(gameType, session, scopedId, move) {
  const engine = ENGINES[gameType];
  if (!engine) return { ok: false, reason: "unknown game type" };
  if (session.status !== "active") return { ok: false, reason: "game already ended" };
  // Turn-based games (tic-tac-toe, truth-or-dare) enforce turnOf;
  // simultaneous/free-for-all games pass turnOf: null and rely on their
  // own per-player checks instead (already-answered, not-the-describer, etc).
  if (session.turnOf != null && session.turnOf !== scopedId) {
    return { ok: false, reason: "not your turn" };
  }
  return engine.move(session, scopedId, move);
}

// Strips information a specific viewer shouldn't see yet. Called by
// signaling.js right before emitting — never before persisting, since the
// full state is what move-validation needs on the next turn.
export function redactState(gameType, state, viewerScopedId) {
  if (gameType === "quick-quiz") {
    const { _correct, ...rest } = state;
    void _correct;
    return rest;
  }
  if (gameType === "guess-the-word") {
    const { word, describerScopedId, ...rest } = state;
    return { ...rest, describerScopedId, word: viewerScopedId === describerScopedId ? word : null };
  }
  return state;
}
