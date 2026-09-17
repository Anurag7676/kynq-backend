// Kynq Extra's Socket.io wiring — one room per call, shared by WebRTC
// signaling relay, text chat, and game-move relay (see the plan's
// realtime-signaling and game-state-sync decisions).
import { Server as SocketIOServer } from "socket.io";
import { ALLOWED_ORIGINS } from "../app.js";
import { resolveSocketIdentity } from "./socketAuth.js";
import { isAgeGateCleared } from "./profile.js";
import { isRestricted } from "./reports.js";
import * as matchmaker from "./matchmaker.js";
import { getCall, endCall, createGameSession, getGameSession, updateGameSession } from "./calls-store.js";
import { GAME_TYPES, createInitialState, applyMove } from "./games.js";
import { submitReport } from "./reports.js";
import { blockUser } from "./blocks.js";

const MAX_CHAT_MESSAGE_LENGTH = 1000;

async function leaveActiveCall(io, socket, reason) {
  const callId = socket.data.currentCallId;
  if (!callId) return;
  const peerScopedId = socket.data.peerScopedId;

  socket.to(callId).emit("call:ended", { reason });
  await endCall(callId, reason).catch((err) => console.error("[kynqExtra] endCall failed:", err));

  socket.leave(callId);
  socket.data.currentCallId = null;
  socket.data.peerScopedId = null;

  // The peer's own socket.data still points at the now-ended call —
  // clear it via a broadcast the peer's handler listens for below.
  io.to(callId).emit("call:_clear_state", {});
  void peerScopedId;
}

export function initSignaling(server) {
  const io = new SocketIOServer(server, {
    path: "/kynq-extra/socket.io",
    cors: { origin: ALLOWED_ORIGINS, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const identity = await resolveSocketIdentity(socket.handshake);
      if (!identity) return next(new Error("no session — load kynq.in first"));
      if (!identity.isAuthenticated) return next(new Error("sign in to use kynq extra"));
      if (await isRestricted(identity.userId)) return next(new Error("account restricted"));
      socket.data.scopedId = identity.scopedId;
      socket.data.userId = identity.userId;
      next();
    } catch (err) {
      next(new Error("auth failed"));
    }
  });

  io.on("connection", (socket) => {
    const { scopedId } = socket.data;

    socket.on("queue:join", async (payload = {}, ack) => {
      try {
        if (!(await isAgeGateCleared(socket.data.userId))) {
          return ack?.({ ok: false, reason: "complete the age check first" });
        }
        if (socket.data.currentCallId) return ack?.({ ok: false, reason: "already in a call" });

        matchmaker.joinQueue({
          scopedId,
          socketId: socket.id,
          topics: Array.isArray(payload.topics) ? payload.topics.slice(0, 3) : [],
          locationScope: payload.locationScope,
          location: payload.location,
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, reason: err.message });
      }
    });

    socket.on("queue:leave", (payload, ack) => {
      matchmaker.leaveQueue(scopedId);
      ack?.({ ok: true });
    });

    // ─── WebRTC signaling relay — server never inspects SDP/ICE content,
    // just forwards it to the other participant in the call's room. ───
    socket.on("webrtc:signal", ({ callId, type, payload } = {}) => {
      if (!callId || callId !== socket.data.currentCallId) return;
      socket.to(callId).emit("webrtc:signal", { type, payload, from: scopedId });
    });

    socket.on("chat:message", ({ callId, text } = {}, ack) => {
      if (!callId || callId !== socket.data.currentCallId) return ack?.({ ok: false });
      const clean = String(text ?? "").slice(0, MAX_CHAT_MESSAGE_LENGTH).trim();
      if (!clean) return ack?.({ ok: false, reason: "empty message" });
      io.to(callId).emit("chat:message", { from: scopedId, text: clean, at: Date.now() });
      ack?.({ ok: true });
    });

    // ─── Games — server-authoritative, see games.js ───
    socket.on("game:start", async ({ callId, gameType } = {}, ack) => {
      try {
        if (!callId || callId !== socket.data.currentCallId) return ack?.({ ok: false, reason: "not in this call" });
        if (!GAME_TYPES.includes(gameType)) return ack?.({ ok: false, reason: "unknown game" });

        const call = await getCall(callId);
        if (!call || call.status !== "active") return ack?.({ ok: false, reason: "call not active" });

        const initialState = createInitialState(gameType, call.participantA, call.participantB);
        const firstTurn = ["tic-tac-toe"].includes(gameType) ? call.participantA : null;
        const session = await createGameSession(callId, gameType, initialState, firstTurn);

        io.to(callId).emit("game:started", {
          gameId: session.id,
          gameType,
          state: session.state,
          turnOf: session.turnOf,
        });
        ack?.({ ok: true, gameId: session.id });
      } catch (err) {
        ack?.({ ok: false, reason: err.message });
      }
    });

    socket.on("game:move", async ({ callId, gameId, move } = {}, ack) => {
      try {
        if (!callId || callId !== socket.data.currentCallId) return ack?.({ ok: false, reason: "not in this call" });
        const session = await getGameSession(gameId);
        if (!session || session.callId !== callId) return ack?.({ ok: false, reason: "game not found" });

        const result = applyMove(session.gameType, session, scopedId, move);
        if (!result.ok) return ack?.({ ok: false, reason: result.reason });

        const updated = await updateGameSession(gameId, {
          state: result.state,
          turnOf: result.turnOf,
          status: result.status,
        });

        io.to(callId).emit("game:state", {
          gameId,
          state: updated.state,
          turnOf: updated.turnOf,
          status: updated.status,
          winner: result.winner ?? null,
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, reason: err.message });
      }
    });

    // ─── Call lifecycle ───
    socket.on("call:next", async () => {
      await leaveActiveCall(io, socket, "next");
    });

    socket.on("call:end", async () => {
      await leaveActiveCall(io, socket, "ended_by_user");
    });

    // Server clears its own state once it's re-broadcast the clear signal
    // (see leaveActiveCall) — this listener fires on BOTH participants'
    // sockets, including the one that triggered it, which is fine since
    // leaveActiveCall already cleared the triggering socket directly.
    socket.on("call:_clear_state", () => {
      socket.data.currentCallId = null;
      socket.data.peerScopedId = null;
    });

    socket.on("report:submit", async ({ callId, reason, note } = {}, ack) => {
      try {
        const call = await getCall(callId);
        if (!call) return ack?.({ ok: false, reason: "call not found" });
        const reportedScopedId = [call.participantA, call.participantB].find((id) => id !== scopedId);
        await submitReport({ reporterScopedId: scopedId, reportedScopedId, callId, reason, note });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, reason: err.message });
      }
    });

    socket.on("block:user", async ({ blockedScopedId } = {}, ack) => {
      try {
        await blockUser(scopedId, blockedScopedId);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, reason: err.message });
      }
    });

    socket.on("disconnect", async () => {
      matchmaker.leaveQueue(scopedId);
      await leaveActiveCall(io, socket, "disconnected");
    });
  });

  matchmaker.startMatchmaker(io);
  return io;
}
