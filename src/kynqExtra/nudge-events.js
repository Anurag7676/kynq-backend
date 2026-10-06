// In-call nudge analytics: one row per thing that happened to a nudge, per user.
// Written from the socket (so userId/callId come from the authenticated
// connection, never the payload) and read by the admin console
// (adminConsole/nudges.js). Plain Mongo collection, not the _key store:
// it's an append-only log that's only ever queried by time/user/kind.
//
// Row: { userId, callId, nudgeId, kind, variant, event, action, at }
//   kind    — "premium" | "games" | "effects" | "question"
//   variant — game type ("tic-tac-toe"), lens id ("puppy"), "gender" for the
//             girls-only pitch, or "<deck>:<level>" for questions ("mixed:2"); may be null
//   event   — "shown" | "accepted" | "dismissed" | "timeout" | "busy"
//   action  — on accepted: "start" (game), "deck" (opened filters), "unlock"
//             (bought the lens in the card), "gender" (girls only), "answered" /
//             "skip" (question); otherwise null
//   at      — ms epoch
import mongoose from "mongoose";

export const NUDGE_EVENTS = "nudge_events";
export const NUDGE_KINDS = ["premium", "games", "effects", "question"];
export const NUDGE_OUTCOMES = ["shown", "accepted", "dismissed", "timeout", "busy"];
const ACTIONS = ["start", "deck", "unlock", "gender", "answered", "skip"];

const coll = () => mongoose.connection.collection(NUDGE_EVENTS);
const clean = (v, max = 48) => (typeof v === "string" && v ? v.slice(0, max) : null);

export async function ensureNudgeEventIndexes() {
  await Promise.all([
    coll().createIndex({ at: -1 }),
    coll().createIndex({ userId: 1, at: -1 }),
    coll().createIndex({ kind: 1, event: 1, at: -1 }),
  ]);
}

// Never throws — analytics must not break a call.
export async function recordNudgeEvent({ userId, callId, nudgeId, kind, variant, event, action }) {
  if (!userId || !NUDGE_KINDS.includes(kind) || !NUDGE_OUTCOMES.includes(event)) return;
  try {
    await coll().insertOne({
      userId,
      callId: clean(callId, 64),
      nudgeId: clean(String(nudgeId ?? ""), 64),
      kind,
      variant: clean(variant),
      event,
      action: event === "accepted" && ACTIONS.includes(action) ? action : null,
      at: Date.now(),
    });
  } catch (err) {
    console.error("[nudges] record failed:", err.message);
  }
}
