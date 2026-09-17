// In-call text chat, persisted per call — same collection() pattern as
// calls-store.js. One document per call (messages appended to an array);
// call-level chat volume is small (a single conversation), so this is
// simpler and cheaper than one document per message. Persistence matters
// for two real reasons beyond "nice to have": a report references a
// callId, so moderators reviewing a report need the actual chat log; and
// delivery/read status needs somewhere durable to live.
import { collection, makeId } from "../gift/store.js";

const chats = collection("chat_messages");
const MAX_MESSAGE_LENGTH = 1000;

async function getOrCreate(callId) {
  const existing = await chats.get(callId);
  if (existing) return existing;
  const fresh = { callId, messages: [] };
  await chats.set(callId, fresh);
  return fresh;
}

export async function addChatMessage(callId, { from, text, gifUrl }) {
  const clean = text ? String(text).slice(0, MAX_MESSAGE_LENGTH).trim() : "";
  if (!clean && !gifUrl) return null;
  const doc = await getOrCreate(callId);
  const message = {
    id: makeId("msg"),
    from,
    type: gifUrl ? "gif" : "text",
    text: clean || undefined,
    gifUrl: gifUrl || undefined,
    at: Date.now(),
    status: "sent",
    reactions: [],
  };
  doc.messages.push(message);
  await chats.set(callId, doc);
  return message;
}

// Status only ever moves forward (sent -> delivered -> read), and only the
// RECIPIENT (not the sender) can advance it — enforced by the caller
// passing the reader's own scopedId, checked against message.from.
const STATUS_RANK = { sent: 0, delivered: 1, read: 2 };

export async function markMessageStatus(callId, messageId, status, readerScopedId) {
  const doc = await chats.get(callId);
  if (!doc) return null;
  const message = doc.messages.find((m) => m.id === messageId);
  if (!message) return null;
  if (message.from === readerScopedId) return null; // can't mark your own message delivered/read
  if (STATUS_RANK[status] <= STATUS_RANK[message.status]) return message; // no regression, idempotent

  message.status = status;
  await chats.set(callId, doc);
  return message;
}

// One reaction per user per message — reacting again replaces the
// previous emoji rather than stacking duplicates.
export async function setReaction(callId, messageId, scopedId, emoji) {
  const doc = await chats.get(callId);
  if (!doc) return null;
  const message = doc.messages.find((m) => m.id === messageId);
  if (!message) return null;

  message.reactions = message.reactions.filter((r) => r.scopedId !== scopedId);
  if (emoji) message.reactions.push({ scopedId, emoji });
  await chats.set(callId, doc);
  return message;
}

export async function getChatHistory(callId) {
  const doc = await chats.get(callId);
  return doc?.messages ?? [];
}
