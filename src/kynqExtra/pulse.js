// Live "pulse" for the landing page: how many people are connected right
// now, how many matches happened today, and a short anonymised feed of
// recent moments (city-level only — never a name, id or message).
//
// In-memory and single-process on purpose: it's a marketing signal, not a
// record. It resets on restart, which is fine.

const MAX_RECENT = 16;
let io = null;
let recent = [];
let matchesToday = 0;
let matchesDay = dayKey();

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function rollDay() {
  const k = dayKey();
  if (k !== matchesDay) { matchesDay = k; matchesToday = 0; }
}

export function attachPulse(server) {
  io = server;
}

function push(event) {
  recent.unshift({ ...event, at: Date.now() });
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
}

// Cities come from the matchmaker's best-effort location; missing → null.
export function recordMatch(cityA, cityB) {
  rollDay();
  matchesToday += 1;
  push({ type: "match", a: cityA || null, b: cityB || null });
}

export function recordGift(giftName, city) {
  push({ type: "gift", gift: giftName, a: city || null });
}

export function recordGameWin(gameType, city) {
  push({ type: "game_win", game: gameType, a: city || null });
}

export function getPulse() {
  rollDay();
  return {
    online: io ? io.engine.clientsCount : 0,
    matchesToday,
    recent,
  };
}
