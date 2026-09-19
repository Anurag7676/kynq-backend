// Kynq Extra's Socket.io wiring — one room per call, shared by WebRTC
// signaling relay, text chat, and game-move relay (see the plan's
// realtime-signaling and game-state-sync decisions).
import { Server as SocketIOServer } from "socket.io";
import { ALLOWED_ORIGINS } from "../app.js";
import { resolveSocketIdentity } from "./socketAuth.js";
import { isAgeGateCleared } from "./profile.js";
import { isRestricted } from "./reports.js";
import * as matchmaker from "./matchmaker.js";
import { getCall, endCall, findActiveCallForUser, createGameSession, getGameSession, updateGameSession } from "./calls-store.js";
import { GAME_TYPES, TURN_BASED_GAMES, createInitialState, applyMove, redactState } from "./games.js";
import { addChatMessage, markMessageStatus, setReaction } from "./chat-store.js";
import { getRandomPrompt } from "./prompts.js";
import { submitReport } from "./reports.js";
import { blockUser } from "./blocks.js";
import { sendGift as sendGiftToPeer, GiftError } from "./gifts.js";
import { attachPulse, recordGift, recordGameWin } from "./pulse.js";
import { dropOnBlock } from "./friends.js";
import crypto from "crypto";
import { debit, credit, getBalance, InsufficientBalanceError } from "./wallet.js";
import { ECONOMY, gamePrice } from "./economy.js";
import { getExtraProfile } from "./profile.js";
import { startMeter, markConnected, pauseMeter, endMeter, onReward, ensureChatMeterIndexes } from "./chat-meter.js";

// scopedId -> Set<socketId>, so REST routes (friend requests, DMs) can push
// realtime events to a user wherever they are in the app.
const userSockets = new Map();
let ioRef = null;
export function emitToUser(scopedId, event, payload) {
  const set = userSockets.get(scopedId);
  if (!ioRef || !set) return;
  for (const sid of set) ioRef.to(sid).emit(event, payload);
}

// Emits a game event to every socket in the call's room, but with the
// state redacted per-viewer (a quiz's correct answer, Guess the Word's
// secret) — plain io.to(callId).emit() would leak hidden info to both
// players identically, defeating the point of having hidden info at all.
function emitGameEvent(io, callId, gameType, eventName, basePayload) {
  const roomSockets = io.sockets.adapter.rooms.get(callId);
  if (!roomSockets) return;
  for (const socketId of roomSockets) {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    sock.emit(eventName, { ...basePayload, state: redactState(gameType, basePayload.state, sock.data.scopedId) });
  }
}

// Paid-game invitations, one pending per call. callId -> { id, from, to,
// gameType, price, timer }. In memory: an invitation is worthless after a
// restart anyway, and no Koins move until it is accepted AND the game starts.
const invites = new Map();
function closeInvite(io, callId, reason) {
  const inv = invites.get(callId);
  if (!inv) return;
  clearTimeout(inv.timer);
  invites.delete(callId);
  if (reason) io.to(callId).emit("game:invite:closed", { inviteId: inv.id, reason });
}

// Clears currentCallId/peerScopedId on every socket in the room — used
// whenever a call ends, so a still-connected peer isn't left thinking
// they're "already in a call" forever (there's no client round-trip that
// would tell the server to clear the peer's own state otherwise).
function clearCallState(io, callId) {
  const roomSockets = io.sockets.adapter.rooms.get(callId);
  if (!roomSockets) return;
  for (const socketId of roomSockets) {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    sock.leave(callId);
    sock.data.currentCallId = null;
    sock.data.peerScopedId = null;
  }
}

async function leaveActiveCall(io, socket, reason) {
  const callId = socket.data.currentCallId;
  if (!callId) return;

  await endMeter(callId); // bank the eligible chat time before the call closes
  closeInvite(io, callId, null); // an unanswered game invitation dies with the call (it cost nothing)
  await endCall(callId, reason).catch((err) => console.error("[kynqExtra] endCall failed:", err));
  socket.to(callId).emit("call:ended", { reason });
  clearCallState(io, callId);
}

// ─── Reconnection grace period ──────────────────────────────
// A dropped socket (wifi blip, backgrounded tab, brief network hiccup)
// used to end the call INSTANTLY, which is far too harsh — most real-world
// disconnects are transient. Instead: the peer is told the connection is
// shaky, and the disconnected side gets RECONNECT_GRACE_MS to reconnect
// before the call actually ends. scopedId -> { callId, peerScopedId, timer }
const RECONNECT_GRACE_MS = Number(process.env.KYNQ_RECONNECT_GRACE_MS) || 20_000;
const pendingDisconnects = new Map();

function scheduleGraceEnd(io, scopedId, callId, peerScopedId) {
  const timer = setTimeout(async () => {
    pendingDisconnects.delete(scopedId);
    await endMeter(callId);
    closeInvite(io, callId, null);
    await endCall(callId, "peer_disconnected").catch((err) => console.error("[kynqExtra] endCall failed:", err));
    io.to(callId).emit("call:ended", { reason: "peer_disconnected" });
    clearCallState(io, callId);
  }, RECONNECT_GRACE_MS);
  pendingDisconnects.set(scopedId, { callId, peerScopedId, timer });
}

// Called right after a fresh socket authenticates — if this scopedId was
// mid-grace-period from a very recent disconnect, resume them into the
// same call instead of leaving them stranded on the matching screen.
async function tryResumeCall(io, socket) {
  const scopedId = socket.data.scopedId;
  const pending = pendingDisconnects.get(scopedId);
  let callId, peerScopedId;

  if (pending) {
    clearTimeout(pending.timer);
    pendingDisconnects.delete(scopedId);
    ({ callId, peerScopedId } = pending);
  } else {
    // No in-memory record — either this socket never dropped (nothing to
    // resume, the common case) or the server process itself restarted
    // mid-call (e.g. a deploy, or --watch reloading in dev) and lost the
    // grace-period map entirely. The DB-backed active-call record survives
    // that, so fall back to it rather than stranding a genuinely-still-
    // in-a-call user with no way back in.
    const call = await findActiveCallForUser(scopedId).catch(() => null);
    if (!call) return;
    callId = call.id;
    peerScopedId = call.participantA === scopedId ? call.participantB : call.participantA;
  }

  socket.join(callId);
  socket.data.currentCallId = callId;
  socket.data.peerScopedId = peerScopedId;
  startMeter(callId, scopedId, peerScopedId); // no-op if it survived; recreated after a restart

  // Tell the reconnecting client which call/peer to resume, and tell
  // whoever's still in the room that the peer is back — both sides then
  // redo the WebRTC offer/answer from scratch (see the plan's game-state
  // pattern of never trusting stale client state — same principle here:
  // a fresh ICE/SDP exchange is the only reliable way to recover a media
  // connection after a signaling drop, rather than assuming the old
  // RTCPeerConnection is still usable).
  socket.emit("call:resumed", { callId, peerScopedId, initiator: true });
  socket.to(callId).emit("call:peer-reconnected", {});
}

export function initSignaling(server) {
  const io = new SocketIOServer(server, {
    path: "/kynq-extra/socket.io",
    cors: { origin: ALLOWED_ORIGINS, credentials: true },
  });
  attachPulse(io);
  ioRef = io;
  ensureChatMeterIndexes().catch(() => {}); // warm-up only; writes await it themselves
  onReward((userId, payload) => emitToUser(userId, "wallet:updated", payload));

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
    if (!userSockets.has(scopedId)) userSockets.set(scopedId, new Set());
    userSockets.get(scopedId).add(socket.id);
    tryResumeCall(io, socket);

    socket.on("queue:join", async (payload = {}, ack) => {
      try {
        if (!(await isAgeGateCleared(socket.data.userId))) {
          return ack?.({ ok: false, reason: "complete the age check first" });
        }
        if (socket.data.currentCallId) return ack?.({ ok: false, reason: "already in a call" });

        socket.data.city = typeof payload.location?.city === "string" ? payload.location.city.slice(0, 40) : null;
        // Gender preference (Master Spec v3 §5) is a paid extra. The seeker's
        // OWN gender always comes from their saved profile, never the payload.
        const wanted = ["male", "female", "other"].includes(payload.genderPreference) ? payload.genderPreference : null;
        if (wanted) {
          const price = ECONOMY.genderPreference.pricePerMatch;
          const balance = await getBalance(scopedId);
          if (balance < price) return ack?.({ ok: false, reason: "not enough Koins for a gender preference", code: "insufficient", balance, price });
        }
        const myProfile = await getExtraProfile(socket.data.userId).catch(() => null);

        matchmaker.joinQueue({
          scopedId,
          socketId: socket.id,
          topics: Array.isArray(payload.topics) ? payload.topics.slice(0, 3) : [],
          locationScope: payload.locationScope,
          location: payload.location,
          gender: myProfile?.gender ?? null,
          genderPref: wanted,
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

    // ─── Chat — persisted, with delivery/read receipts and reactions ───
    socket.on("chat:message", async ({ callId, text, gifUrl } = {}, ack) => {
      if (!callId || callId !== socket.data.currentCallId) return ack?.({ ok: false });
      const message = await addChatMessage(callId, { from: scopedId, text, gifUrl });
      if (!message) return ack?.({ ok: false, reason: "empty message" });
      io.to(callId).emit("chat:message", message);
      ack?.({ ok: true, id: message.id });
    });

    // Drops a conversation-starter prompt into the shared chat thread —
    // same message stream as text/gif, just a different `type` so the
    // client can render it distinctly. Either participant can trigger one;
    // there's no turn/ownership concept, it's a shared conversation aid.
    socket.on("prompt:send", async ({ callId, category } = {}, ack) => {
      if (!callId || callId !== socket.data.currentCallId) return ack?.({ ok: false });
      const prompt = getRandomPrompt(category);
      const message = await addChatMessage(callId, { from: scopedId, prompt });
      io.to(callId).emit("chat:message", message);
      ack?.({ ok: true, id: message.id });
    });

    // Recipient's client calls this once the message event has actually
    // arrived (delivered) and again once it's been shown on screen (read) —
    // markMessageStatus rejects the sender marking their own message,
    // so a client can't fake receipts for itself.
    socket.on("chat:ack", async ({ callId, messageId, status } = {}) => {
      if (!callId || callId !== socket.data.currentCallId) return;
      if (!["delivered", "read"].includes(status)) return;
      const updated = await markMessageStatus(callId, messageId, status, scopedId);
      if (updated) io.to(callId).emit("chat:status", { messageId, status: updated.status });
    });

    socket.on("chat:react", async ({ callId, messageId, emoji } = {}, ack) => {
      if (!callId || callId !== socket.data.currentCallId) return ack?.({ ok: false });
      const updated = await setReaction(callId, messageId, scopedId, emoji || null);
      if (!updated) return ack?.({ ok: false, reason: "message not found" });
      io.to(callId).emit("chat:reaction", { messageId, reactions: updated.reactions });
      ack?.({ ok: true });
    });

    // ─── Games — server-authoritative, see games.js ───
    socket.on("game:start", async ({ callId, gameType } = {}, ack) => {
      try {
        if (!callId || callId !== socket.data.currentCallId) return ack?.({ ok: false, reason: "not in this call" });
        if (!GAME_TYPES.includes(gameType)) return ack?.({ ok: false, reason: "unknown game" });
        if (gamePrice(gameType) > 0) return ack?.({ ok: false, reason: "this game needs an invitation", code: "paid", price: gamePrice(gameType) });

        const call = await getCall(callId);
        if (!call || call.status !== "active") return ack?.({ ok: false, reason: "call not active" });

        const initialState = createInitialState(gameType, call.participantA, call.participantB);
        const firstTurn = TURN_BASED_GAMES.includes(gameType) ? call.participantA : null;
        const session = await createGameSession(callId, gameType, initialState, firstTurn);

        emitGameEvent(io, callId, gameType, "game:started", {
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

        emitGameEvent(io, callId, session.gameType, "game:state", {
          gameId,
          state: updated.state,
          turnOf: updated.turnOf,
          status: updated.status,
          winner: result.winner ?? null,
        });

        // Winning no longer pays Koins (Master Spec v3 §2: "No +5 Koins
        // game-win reward in the MVP") — it only feeds the public pulse.
        if (result.winner) recordGameWin(session.gameType, socket.data.city);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, reason: err.message });
      }
    });

    // ─── Call lifecycle ───
    // Acks only once the call is actually left — a client that re-queues
    // before this completes would be rejected with "already in a call".
    // ─── Paid games (Master Spec v3 §4) ───
    // The starter pays; the other player accepts or declines and plays free.
    // Order matters, and is the whole safety story:
    //   invite (0 Koins) → accept → INITIALISE the game → only then DEBIT,
    //   keyed by the game id (exactly-once) → announce. If initialising fails
    //   nothing was ever charged; if announcing fails the fee is refunded.
    socket.on("game:invite", async ({ callId, gameType } = {}, ack) => {
      try {
        if (!callId || callId !== socket.data.currentCallId) return ack?.({ ok: false, reason: "not in this call" });
        if (!GAME_TYPES.includes(gameType)) return ack?.({ ok: false, reason: "unknown game" });
        const price = gamePrice(gameType);
        if (price <= 0) return ack?.({ ok: false, reason: "that game is free — just start it" });
        if (invites.has(callId)) return ack?.({ ok: false, reason: "an invitation is already waiting" });
        const balance = await getBalance(scopedId);
        if (balance < price) return ack?.({ ok: false, reason: "not enough Koins", code: "insufficient", balance, price });

        const inv = { id: crypto.randomUUID(), from: scopedId, to: socket.data.peerScopedId, gameType, price };
        inv.timer = setTimeout(() => closeInvite(io, callId, "expired"), ECONOMY.games.inviteTtlMs);
        invites.set(callId, inv);
        // The invited player is told it costs THEM nothing.
        socket.to(callId).emit("game:invited", { inviteId: inv.id, gameType, from: scopedId, price: 0, expiresInMs: ECONOMY.games.inviteTtlMs });
        ack?.({ ok: true, inviteId: inv.id, price });
      } catch (err) {
        ack?.({ ok: false, reason: err.message });
      }
    });

    socket.on("game:invite:cancel", ({ inviteId } = {}, ack) => {
      const callId = socket.data.currentCallId;
      const inv = invites.get(callId);
      if (!inv || inv.id !== inviteId || inv.from !== scopedId) return ack?.({ ok: false });
      closeInvite(io, callId, "cancelled");
      ack?.({ ok: true });
    });

    socket.on("game:invite:respond", async ({ inviteId, accept } = {}, ack) => {
      const callId = socket.data.currentCallId;
      const inv = invites.get(callId);
      if (!inv || inv.id !== inviteId) return ack?.({ ok: false, reason: "that invitation has expired" });
      if (inv.to !== scopedId) return ack?.({ ok: false, reason: "only the invited player can answer" });
      clearTimeout(inv.timer);
      invites.delete(callId); // consumed — a second 'accept' can't start (or charge for) a second game

      if (!accept) { // declining costs nobody anything
        io.to(callId).emit("game:invite:closed", { inviteId, reason: "declined" });
        return ack?.({ ok: true });
      }

      let session;
      try {
        const call = await getCall(callId);
        if (!call || call.status !== "active") throw new Error("call not active");
        const initialState = createInitialState(inv.gameType, call.participantA, call.participantB);
        const firstTurn = TURN_BASED_GAMES.includes(inv.gameType) ? inv.from : null;
        session = await createGameSession(callId, inv.gameType, initialState, firstTurn);
      } catch (err) {
        io.to(callId).emit("game:invite:closed", { inviteId, reason: "failed" }); // nothing was charged
        return ack?.({ ok: false, reason: "the game couldn't start — no Koins were taken" });
      }

      try {
        await debit(inv.from, "game_fee", inv.price, { refId: session.id, note: `started ${inv.gameType.replace(/-/g, " ")}` });
      } catch (err) {
        await updateGameSession(session.id, { status: "cancelled" }).catch(() => {});
        const insufficient = err instanceof InsufficientBalanceError;
        io.to(callId).emit("game:invite:closed", { inviteId, reason: insufficient ? "insufficient" : "failed" });
        return ack?.({ ok: false, reason: insufficient ? "the starter no longer has enough Koins" : "the game couldn't start — no Koins were taken" });
      }

      try {
        emitGameEvent(io, callId, inv.gameType, "game:started", { gameId: session.id, gameType: inv.gameType, state: session.state, turnOf: session.turnOf, paidBy: inv.from, price: inv.price });
        emitToUser(inv.from, "wallet:updated", { spent: inv.price, reason: "game" });
        ack?.({ ok: true, gameId: session.id });
      } catch (err) {
        // Charged, but the game never reached the players → full refund, once.
        await credit(inv.from, "game_refund", { refId: session.id, amount: inv.price, note: "game failed to start — refunded" }).catch((e) => console.error("[kynqExtra] game refund failed:", e));
        await updateGameSession(session.id, { status: "cancelled" }).catch(() => {});
        emitToUser(inv.from, "wallet:updated", { earned: inv.price, reason: "refund" });
        io.to(callId).emit("game:invite:closed", { inviteId, reason: "failed" });
        ack?.({ ok: false, reason: "the game couldn't start — your Koins were refunded" });
      }
    });

    // Sent every few seconds by a client whose RTCPeerConnection is
    // "connected". Eligible chat time only runs while BOTH sides are beating.
    socket.on("call:connected", () => {
      if (socket.data.currentCallId) markConnected(socket.data.currentCallId, scopedId);
    });

    socket.on("call:next", async (payload, ack) => {
      await leaveActiveCall(io, socket, "next");
      ack?.({ ok: true });
    });

    socket.on("call:end", async () => {
      await leaveActiveCall(io, socket, "ended_by_user");
    });

    // ─── Gifts — the recipient is whoever the server knows you're in a
    // call with; the client only names the gift and a requestId. ───
    socket.on("gift:send", async ({ giftId, requestId } = {}, ack) => {
      const callId = socket.data.currentCallId;
      const toUserId = socket.data.peerScopedId;
      if (!callId || !toUserId) return ack?.({ ok: false, reason: "not in a call" });
      try {
        const send = await sendGiftToPeer({ callId, fromUserId: scopedId, toUserId, giftId, requestId });
        const event = { id: send.id, giftId: send.giftId, name: send.name, from: scopedId, to: toUserId, at: send.createdAt };
        io.to(callId).emit("gift:received", event);
        recordGift(send.name, socket.data.city);
        ack?.({ ok: true, send: event, remaining: send.remaining ?? null });
      } catch (err) {
        if (err instanceof GiftError) return ack?.({ ok: false, reason: err.message, code: err.code });
        console.error("[kynqExtra] gift:send failed:", err);
        ack?.({ ok: false, reason: "couldn't send that gift" });
      }
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
        await dropOnBlock(scopedId, blockedScopedId).catch(() => {});
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, reason: err.message });
      }
    });

    socket.on("disconnect", () => {
      const set = userSockets.get(scopedId);
      if (set) { set.delete(socket.id); if (!set.size) userSockets.delete(scopedId); }
      matchmaker.leaveQueue(scopedId);
      const callId = socket.data.currentCallId;
      const peerScopedId = socket.data.peerScopedId;
      if (!callId) return;

      // Grace period, not an instant hangup — a dropped wifi connection or
      // a backgrounded tab shouldn't end the call. The peer is told the
      // connection is shaky; if this scopedId doesn't reconnect within
      // RECONNECT_GRACE_MS, THEN the call actually ends (see
      // scheduleGraceEnd). socket.data itself is gone once this handler
      // returns (the socket object is being destroyed), so state that
      // needs to survive to the timeout lives in pendingDisconnects, not
      // on the socket.
      pauseMeter(callId).catch(() => {});
      socket.to(callId).emit("call:peer-disconnected", {});
      scheduleGraceEnd(io, scopedId, callId, peerScopedId);
    });
  });

  matchmaker.startMatchmaker(io);
  return io;
}
