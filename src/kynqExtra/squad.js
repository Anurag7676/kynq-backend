// Duo mode: two friends match together, with one stranger (3 in the call) or another duo (4).
// Kept apart from the 1:1 call path on purpose: 1:1 calls, their chat meter, games, gifts and
// admin stats are untouched. A group call is a "room" of units (a duo or a solo person); every
// device connects directly to every other one (a WebRTC mesh, fine for up to 4 people), and the
// server only relays signaling, chat and media state, like the 1:1 path.
//
// Lifecycle:
//   duo:create  → a duo with one member, in its own lobby room, and an invite code
//   duo:join    → the friend joins with the code; both see each other in the lobby
//   duo:queue   → the duo waits; the matcher pairs it with another duo, or a solo person
//                 searching on the web who allows duos (queue:join { squadOk: true })
//   sq:next     → the call ends; each duo goes back to its lobby and searches again by itself,
//                 a solo person goes back to 1:1 matching
// State is in memory (one server process, like the matchmaker). A restart drops duos; both
// friends simply make a new one.
import crypto from "crypto";
import mongoose from "mongoose";
import { blockedPairsAmong, pairKey } from "./blocks.js";
import { getPublicName } from "./profile.js";
import * as matchmaker from "./matchmaker.js";

const MAX_DUO = 2;
const DUO_TICK_MS = 1000;
// A queued duo first looks for another duo; after this long it also takes a solo person.
// Solo people are plentiful and duos are rare, so the wait for a duo is kept short.
const DUO_ONLY_MS = 3000;
const LEAVE_GRACE_MS = 10_000; // a dropped connection keeps its seat this long
// Two duos that just pressed Next aren't put straight back together, unless both have waited
// this long and there's nobody else (a small pool shouldn't strand them).
const DUO_REMATCH_MS = 20_000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

const duos = new Map();        // duoId -> { id, code, members: [scopedId], createdAt }
const duoByCode = new Map();   // code -> duoId
const duoOf = new Map();       // scopedId -> duoId
const rooms = new Map();       // roomId -> { id, kind: "lobby"|"call", units: [{ type, duoId?, scopedId? }], startedAt }
const roomOf = new Map();      // scopedId -> roomId
const people = new Map();      // scopedId -> { scopedId, userId, name, socketId }
const duoQueue = new Map();    // duoId -> joinedAt
const leaving = new Map();     // scopedId -> timer (grace after a disconnect)
const lastMet = new Map();     // "duoA|duoB" -> when their call ended

let ioRef = null;
const sqRoom = (roomId) => `sq:${roomId}`;
const socketOf = (scopedId) => { const p = people.get(scopedId); return p && ioRef?.sockets.sockets.get(p.socketId); };

function newCode() {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    if (!duoByCode.has(code)) return code;
  }
}

const unitMembers = (u) => (u.type === "duo" ? duos.get(u.duoId)?.members ?? [] : [u.scopedId]);
const roomMembers = (room) => room.units.flatMap(unitMembers);

// ─── Snapshots (one event, sq:state, carries everything a client draws) ───
function stateFor(scopedId) {
  const duo = duos.get(duoOf.get(scopedId));
  const room = rooms.get(roomOf.get(scopedId));
  const person = (id, unit) => ({ id, name: people.get(id)?.name ?? "Someone", unit });
  return {
    you: scopedId,
    duo: duo ? { id: duo.id, code: duo.code, members: duo.members.map((id) => person(id, duo.id)), queued: duoQueue.has(duo.id), full: duo.members.length >= MAX_DUO } : null,
    room: room ? {
      id: room.id,
      kind: room.kind,
      startedAt: room.startedAt,
      members: room.units.flatMap((u) => unitMembers(u).map((id) => person(id, u.type === "duo" ? u.duoId : `solo:${id}`))),
    } : null,
  };
}
function pushState(ids) {
  for (const id of new Set(ids)) socketOf(id)?.emit("sq:state", stateFor(id));
}

// ─── Rooms ───
function bindSocket(scopedId, roomId) {
  const s = socketOf(scopedId);
  const prev = roomOf.get(scopedId);
  if (s && prev && prev !== roomId) s.leave(sqRoom(prev));
  if (roomId) { roomOf.set(scopedId, roomId); s?.join(sqRoom(roomId)); if (s) s.data.squadRoomId = roomId; }
  else { roomOf.delete(scopedId); if (s) s.data.squadRoomId = null; }
}
function openRoom(kind, units) {
  const room = { id: makeRoomId(kind), kind, units, startedAt: Date.now() };
  rooms.set(room.id, room);
  for (const id of roomMembers(room)) bindSocket(id, room.id);
  return room;
}
const makeRoomId = (kind) => `${kind === "call" ? "sqc" : "sql"}_${crypto.randomBytes(9).toString("base64url")}`;

function lobbyFor(duoId) {
  return openRoom("lobby", [{ type: "duo", duoId }]);
}

// Ends a group call: duos go back to a lobby (and search again if asked), solo people are told
// the call ended and their own client returns them to 1:1 matching.
async function closeCall(roomId, { reason, requeueDuos = true } = {}) {
  const room = rooms.get(roomId);
  if (!room || room.kind !== "call") return;
  rooms.delete(roomId);
  const all = roomMembers(room);
  const duoUnits = room.units.filter((u) => u.type === "duo").map((u) => u.duoId).sort();
  if (duoUnits.length === 2) lastMet.set(duoUnits.join("|"), Date.now());
  ioRef?.to(sqRoom(roomId)).emit("sq:ended", { roomId, reason });
  for (const id of all) bindSocket(id, null);
  for (const u of room.units) {
    if (u.type === "duo" && duos.has(u.duoId)) {
      lobbyFor(u.duoId);
      if (requeueDuos && duos.get(u.duoId).members.length === MAX_DUO) duoQueue.set(u.duoId, Date.now());
    }
  }
  pushState(all);
  void persistEnd(roomId, reason);
  scheduleTick();
}

// ─── Persistence: one record per group call, separate from the 1:1 `calls` collection ───
const squadCalls = () => mongoose.connection.collection("squad_calls");
function persistStart(room) {
  if (mongoose.connection.readyState !== 1) return;
  squadCalls().insertOne({ id: room.id, members: roomMembers(room), units: room.units.map((u) => (u.type === "duo" ? { duo: duos.get(u.duoId)?.members ?? [] } : { solo: u.scopedId })), startedAt: room.startedAt, endedAt: null, endReason: null })
    .catch((err) => console.error("[squad] persist start failed:", err.message));
}
async function persistEnd(roomId, reason) {
  if (mongoose.connection.readyState !== 1) return;
  await squadCalls().updateOne({ id: roomId }, { $set: { endedAt: Date.now(), endReason: reason ?? null } }).catch((err) => console.error("[squad] persist end failed:", err.message));
}

// ─── Leaving ───
// Takes a person out of whatever they're in. A duo with one person left stays as a lobby
// (they can invite someone else); an empty duo is deleted.
async function leaveEverything(scopedId, reason = "left") {
  const roomId = roomOf.get(scopedId);
  const room = rooms.get(roomId);
  const duoId = duoOf.get(scopedId);
  const affected = new Set([scopedId]);

  if (room?.kind === "call") {
    // Everyone else in the call is affected; the call itself ends (the others move on).
    for (const id of roomMembers(room)) affected.add(id);
    await closeCall(room.id, { reason });
  }
  if (duoId) {
    const duo = duos.get(duoId);
    duoQueue.delete(duoId);
    if (duo) {
      duo.members = duo.members.filter((id) => id !== scopedId);
      for (const id of duo.members) affected.add(id);
      if (!duo.members.length) {
        duos.delete(duoId);
        duoByCode.delete(duo.code);
        const lobby = [...rooms.values()].find((r) => r.kind === "lobby" && r.units.some((u) => u.duoId === duoId));
        if (lobby) rooms.delete(lobby.id);
      }
    }
    duoOf.delete(scopedId);
  }
  bindSocket(scopedId, null);
  // Clean up a lobby room the person was in (their duo's lobby keeps existing for the friend).
  for (const r of rooms.values()) if (r.kind === "lobby" && !roomMembers(r).length) rooms.delete(r.id);
  pushState([...affected]);
  socketOf(scopedId)?.emit("sq:state", stateFor(scopedId));
}

// ─── Matching ───
function scheduleTick() { setImmediate(() => void runSquadTick()); }
let ticking = false;
export async function runSquadTick() {
  if (ticking || !ioRef || !duoQueue.size) return;
  ticking = true;
  try {
    const waiting = [...duoQueue.entries()].filter(([id]) => duos.get(id)?.members.length === MAX_DUO).sort((a, b) => a[1] - b[1]);
    const solos = matchmaker.squadCandidates();
    const ids = [...new Set([...waiting.flatMap(([id]) => duos.get(id).members), ...solos.map((s) => s.scopedId)])];
    const blocked = ids.length > 1 ? await blockedPairsAmong(ids) : new Set();
    const clash = (a, b) => a.some((x) => b.some((y) => blocked.has(pairKey(x, y))));
    const used = new Set();

    for (const [duoId, joinedAt] of waiting) {
      if (used.has(duoId) || !duoQueue.has(duoId)) continue;
      const mine = duos.get(duoId).members;
      // 1) another duo
      const now = Date.now();
      const fresh = ([id, at]) => {
        const met = lastMet.get([duoId, id].sort().join("|"));
        return !met || now - met > DUO_REMATCH_MS || (now - joinedAt > DUO_REMATCH_MS && now - at > DUO_REMATCH_MS);
      };
      const other = waiting.find((w) => w[0] !== duoId && !used.has(w[0]) && duoQueue.has(w[0]) && fresh(w) && !clash(mine, duos.get(w[0]).members));
      if (other) {
        used.add(duoId); used.add(other[0]);
        startCall([{ type: "duo", duoId }, { type: "duo", duoId: other[0] }]);
        continue;
      }
      // 2) a solo person, once the duo has waited a moment for another duo
      if (Date.now() - joinedAt < DUO_ONLY_MS) continue;
      const solo = solos.find((s) => !used.has(s.scopedId) && !mine.includes(s.scopedId) && !clash(mine, [s.scopedId]));
      if (!solo || !matchmaker.takeForSquad(solo.scopedId)) continue;
      used.add(duoId); used.add(solo.scopedId);
      people.set(solo.scopedId, { scopedId: solo.scopedId, userId: solo.scopedId, name: await nameOf(solo.scopedId), socketId: solo.socketId });
      startCall([{ type: "duo", duoId }, { type: "solo", scopedId: solo.scopedId }]);
    }
  } catch (err) {
    console.error("[squad] tick failed:", err.message);
  } finally {
    ticking = false;
  }
}

function startCall(units) {
  for (const u of units) if (u.type === "duo") {
    duoQueue.delete(u.duoId);
    // The duo leaves its lobby room for the call.
    for (const [rid, r] of rooms) if (r.kind === "lobby" && r.units.some((x) => x.duoId === u.duoId)) rooms.delete(rid);
  }
  const room = openRoom("call", units);
  const members = roomMembers(room);
  for (const u of units) if (u.type === "solo") socketOf(u.scopedId)?.emit("squad:matched", { roomId: room.id });
  pushState(members);
  persistStart(room);
  console.log(`[squad] call:started roomId=${room.id} units=${units.map((u) => (u.type === "duo" ? "duo" : "solo")).join("+")} members=${members.length}`);
}

async function nameOf(scopedId) {
  const pub = await getPublicName(scopedId).catch(() => null);
  return String(pub?.name || "Someone").trim().split(/\s+/)[0].slice(0, 24) || "Someone";
}

// ─── Wiring ───
/** Called from signaling's io.on("connection"). */
export function attachSquad(io, socket) {
  ioRef = io;
  const { scopedId } = socket.data;
  const me = async () => {
    const p = people.get(scopedId);
    if (p) { p.socketId = socket.id; return p; }
    const fresh = { scopedId, userId: socket.data.userId, name: await nameOf(socket.data.userId ?? scopedId), socketId: socket.id };
    people.set(scopedId, fresh);
    return fresh;
  };
  // A reconnecting device takes its seat back (and its socket joins the room again).
  const resume = () => {
    const t = leaving.get(scopedId);
    if (t) { clearTimeout(t); leaving.delete(scopedId); }
    if (people.has(scopedId)) people.get(scopedId).socketId = socket.id;
    const roomId = roomOf.get(scopedId);
    if (roomId) { socket.join(sqRoom(roomId)); socket.data.squadRoomId = roomId; }
  };

  socket.on("sq:sync", async (_p, ack) => {
    if (people.has(scopedId) || roomOf.has(scopedId) || duoOf.has(scopedId)) { await me(); resume(); }
    const state = stateFor(scopedId);
    if (state.room) io.to(sqRoom(state.room.id)).except(socket.id).emit("sq:peer-back", { id: scopedId });
    ack?.(state);
  });

  socket.on("duo:create", async (_p, ack) => {
    if (socket.data.currentCallId) return ack?.({ ok: false, reason: "you're in a call" });
    matchmaker.leaveQueue(scopedId);
    if (duoOf.has(scopedId) || roomOf.has(scopedId)) await leaveEverything(scopedId, "left");
    await me();
    const duo = { id: `duo_${crypto.randomBytes(6).toString("base64url")}`, code: newCode(), members: [scopedId], createdAt: Date.now() };
    duos.set(duo.id, duo);
    duoByCode.set(duo.code, duo.id);
    duoOf.set(scopedId, duo.id);
    lobbyFor(duo.id);
    console.log(`[squad] duo:create duoId=${duo.id} by=${scopedId}`);
    ack?.({ ok: true, state: stateFor(scopedId) });
  });

  socket.on("duo:join", async ({ code } = {}, ack) => {
    const duoId = duoByCode.get(String(code ?? "").trim().toUpperCase());
    const duo = duos.get(duoId);
    if (!duo) return ack?.({ ok: false, reason: "That code didn't work. Ask your friend for a new link." });
    if (duo.members.includes(scopedId)) return ack?.({ ok: true, state: stateFor(scopedId) });
    if (duo.members.length >= MAX_DUO) return ack?.({ ok: false, reason: "That duo is already full." });
    const blocked = await blockedPairsAmong([...duo.members, scopedId]);
    if (duo.members.some((m) => blocked.has(pairKey(m, scopedId)))) return ack?.({ ok: false, reason: "That code didn't work. Ask your friend for a new link." });
    if (socket.data.currentCallId) return ack?.({ ok: false, reason: "you're in a call" });
    matchmaker.leaveQueue(scopedId);
    if (duoOf.has(scopedId) || roomOf.has(scopedId)) await leaveEverything(scopedId, "left");
    await me();
    duo.members.push(scopedId);
    duoOf.set(scopedId, duo.id);
    const lobby = [...rooms.values()].find((r) => r.kind === "lobby" && r.units.some((u) => u.duoId === duo.id));
    if (lobby) bindSocket(scopedId, lobby.id);
    else lobbyFor(duo.id);
    console.log(`[squad] duo:join duoId=${duo.id} by=${scopedId}`);
    pushState(duo.members);
    ack?.({ ok: true, state: stateFor(scopedId) });
  });

  socket.on("duo:queue", (_p, ack) => {
    const duo = duos.get(duoOf.get(scopedId));
    if (!duo) return ack?.({ ok: false, reason: "make a duo first" });
    if (duo.members.length < MAX_DUO) return ack?.({ ok: false, reason: "wait for your friend to join" });
    if (rooms.get(roomOf.get(scopedId))?.kind === "call") return ack?.({ ok: false, reason: "already in a call" });
    if (!duoQueue.has(duo.id)) duoQueue.set(duo.id, Date.now());
    pushState(duo.members);
    ack?.({ ok: true });
    scheduleTick();
  });

  socket.on("duo:unqueue", (_p, ack) => {
    const duo = duos.get(duoOf.get(scopedId));
    if (duo) { duoQueue.delete(duo.id); pushState(duo.members); }
    ack?.({ ok: true });
  });

  socket.on("duo:leave", async (_p, ack) => {
    await leaveEverything(scopedId, "left");
    people.delete(scopedId);
    ack?.({ ok: true });
  });

  // Next: the whole call ends. Duos search again by themselves; a solo person who pressed it
  // goes back to 1:1 matching (their client does that).
  socket.on("sq:next", async (_p, ack) => {
    const room = rooms.get(roomOf.get(scopedId));
    if (!room || room.kind !== "call") return ack?.({ ok: false });
    await closeCall(room.id, { reason: "next" });
    ack?.({ ok: true });
  });

  // ─── Relays, only between people in the same room ───
  const sameRoom = (to) => { const r = roomOf.get(scopedId); return r && r === roomOf.get(to); };
  socket.on("sq:signal", ({ to, type, payload } = {}) => {
    if (typeof to !== "string" || !sameRoom(to)) return;
    socketOf(to)?.emit("sq:signal", { from: scopedId, type, payload });
  });
  socket.on("sq:media", ({ mic, cam } = {}) => {
    const r = roomOf.get(scopedId);
    if (r) socket.to(sqRoom(r)).emit("sq:media", { id: scopedId, mic: mic !== false, cam: cam !== false });
  });
  socket.on("sq:chat", ({ text } = {}, ack) => {
    const r = roomOf.get(scopedId);
    const t = typeof text === "string" ? text.trim().slice(0, 500) : "";
    if (!r || !t) return ack?.({ ok: false });
    io.to(sqRoom(r)).emit("sq:chat", { id: crypto.randomUUID(), from: scopedId, text: t, at: Date.now() });
    ack?.({ ok: true });
  });

  socket.on("disconnect", () => {
    if (!people.has(scopedId) || people.get(scopedId).socketId !== socket.id) return;
    const r = roomOf.get(scopedId);
    if (r) socket.to(sqRoom(r)).emit("sq:peer-away", { id: scopedId });
    if (duoOf.has(scopedId)) { const d = duoOf.get(scopedId); if (duoQueue.has(d)) { duoQueue.delete(d); pushState(duos.get(d)?.members ?? []); } }
    leaving.set(scopedId, setTimeout(() => {
      leaving.delete(scopedId);
      void leaveEverything(scopedId, "disconnected").then(() => people.delete(scopedId));
    }, LEAVE_GRACE_MS));
  });
}

/** In a duo or a group call right now (a 1:1 search takes them out of it first). */
export const isInSquad = (scopedId) => duoOf.has(scopedId) || roomOf.has(scopedId);

/** For moderation: is this person in this group call, and is `subject` in it too? */
export function inSquadCall(scopedId, roomId, subject) {
  const room = rooms.get(roomId);
  if (!room || room.kind !== "call") return false;
  const members = roomMembers(room);
  return members.includes(scopedId) && (!subject || members.includes(subject));
}

/** Moderation confirmed nudity: the group call ends for everyone, like a 1:1 call. */
export async function endSquadForModeration(roomId, offenderId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const id of roomMembers(room)) socketOf(id)?.emit("mod:action", { type: "ended", you: id === offenderId });
  await closeCall(roomId, { reason: "moderation" });
  // The offender's own duo doesn't search again.
  const d = duoOf.get(offenderId);
  if (d) { duoQueue.delete(d); pushState(duos.get(d)?.members ?? []); }
}

/** A restricted account is removed from any duo or group call at once (see kickUser). */
export async function removeFromSquad(scopedId) {
  const t = leaving.get(scopedId);
  if (t) { clearTimeout(t); leaving.delete(scopedId); }
  if (duoOf.has(scopedId) || roomOf.has(scopedId)) await leaveEverything(scopedId, "removed");
  people.delete(scopedId);
}

let tick = null;
export function startSquad(io) {
  ioRef = io;
  matchmaker.setBeforeTick(runSquadTick);
  if (!tick) tick = setInterval(() => void runSquadTick(), DUO_TICK_MS);
  tick.unref?.();
}

/** Tests only. */
export function _resetSquad() {
  lastMet.clear(); duos.clear(); duoByCode.clear(); duoOf.clear(); rooms.clear(); roomOf.clear(); people.clear(); duoQueue.clear();
  for (const t of leaving.values()) clearTimeout(t);
  leaving.clear();
}
