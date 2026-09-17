// Server-authoritative game engines for Kynq Extra's in-call mini-games.
// Every move is validated here, server-side, before the state is persisted
// and broadcast — a forged socket event claiming an out-of-turn move or an
// invalid choice is rejected, not trusted. This is the whole point of
// routing moves through the signaling server instead of a WebRTC data
// channel (see the plan's game-state-sync decision).

export const GAME_TYPES = ["tic-tac-toe", "rock-paper-scissors", "would-you-rather"];

const WOULD_YOU_RATHER_PROMPTS = [
  { a: "travel back in time", b: "travel to the future" },
  { a: "be able to fly", b: "be invisible" },
  { a: "always be 10 minutes late", b: "always be 20 minutes early" },
  { a: "know how you'll die", b: "know when you'll die" },
  { a: "lose all your memories", b: "never make a new one again" },
];

function randomPrompt() {
  return WOULD_YOU_RATHER_PROMPTS[Math.floor(Math.random() * WOULD_YOU_RATHER_PROMPTS.length)];
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
  const players = Object.keys(session.state.choices).length === 0
    ? null // first move of the round, other player unknown until they submit too
    : null;

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
  return { prompt: randomPrompt(), answers: {} };
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
    state: { prompt: randomPrompt(), answers: {}, lastRound: { prompt: session.state.prompt, answers } },
    turnOf: null,
    status: "active",
    winner: null,
  };
}

const ENGINES = {
  "tic-tac-toe": { initial: ticTacToeInitial, move: ticTacToeMove },
  "rock-paper-scissors": { initial: rpsInitial, move: rpsMove },
  "would-you-rather": { initial: wouldYouRatherInitial, move: wouldYouRatherMove },
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
  // Turn-based games (tic-tac-toe) enforce turnOf; simultaneous games
  // (rps, would-you-rather) pass turnOf: null and rely on their own
  // per-player "already submitted" check instead.
  if (session.turnOf != null && session.turnOf !== scopedId) {
    return { ok: false, reason: "not your turn" };
  }
  return engine.move(session, scopedId, move);
}
