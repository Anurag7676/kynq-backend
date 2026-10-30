// Push notifications (Android app) through Firebase Cloud Messaging.
//
// The app registers its FCM token after sign-in (POST /api/kynq-extra/push/register) and drops it
// on sign-out. We notify for things that need you when you're not in the app: a new message, a
// friend request, a friend accepting, a challenge invite or your turn in one. Each notification
// carries a `route` the app opens when tapped.
//
// Configuration: FIREBASE_SERVICE_ACCOUNT_B64 = base64 of the Firebase Admin service-account JSON
// (project kynq2026). Without it nothing is sent and nothing fails: pushes are best-effort and
// never block the request that caused them.
import mongoose from "mongoose";

const col = () => mongoose.connection.collection("push_tokens");
const MAX_TOKENS_PER_USER = 5;

let messaging = null;
let initTried = false;
async function fcm() {
  if (messaging || initTried) return messaging;
  initTried = true;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) { console.log("[push] FIREBASE_SERVICE_ACCOUNT_B64 not set: push notifications are off"); return null; }
  try {
    const { default: admin } = await import("firebase-admin");
    const credentials = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const app = admin.apps.find((a) => a?.name === "kynq-push") ?? admin.initializeApp({ credential: admin.credential.cert(credentials) }, "kynq-push");
    messaging = admin.messaging(app);
  } catch (err) {
    console.error("[push] Firebase init failed:", err.message);
  }
  return messaging;
}
export const pushConfigured = () => !!process.env.FIREBASE_SERVICE_ACCOUNT_B64;

let indexesReady = null;
export function ensurePushIndexes() {
  indexesReady ??= Promise.all([
    col().createIndex({ token: 1 }, { unique: true }),
    col().createIndex({ userId: 1, updatedAt: -1 }),
  ]).catch((err) => { indexesReady = null; console.error("[push] index creation failed:", err.message); });
  return indexesReady;
}

/** Save this device's token for the user (a token moves to whoever signed in on it last). */
export async function registerToken(userId, token, platform = "android") {
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) throw new Error("invalid token");
  await ensurePushIndexes();
  const now = Date.now();
  await col().updateOne({ token }, { $set: { token, userId, platform, updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
  // Keep the newest few devices per person.
  const extra = await col().find({ userId }).sort({ updatedAt: -1 }).skip(MAX_TOKENS_PER_USER).project({ _id: 1 }).toArray();
  if (extra.length) await col().deleteMany({ _id: { $in: extra.map((x) => x._id) } });
}

export async function unregisterToken(token) {
  if (typeof token === "string" && token) await col().deleteOne({ token });
}
export async function deleteTokensForUser(userId) {
  await col().deleteMany({ userId });
}

const GONE = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

/**
 * Notify every device of `userId`. `kind` groups notifications (one per kind+tag on the phone,
 * newer replaces older). Never throws.
 */
export async function pushToUser(userId, { title, body, route, kind = "general", tag }) {
  try {
    if (!userId || !pushConfigured()) return { sent: 0 };
    const m = await fcm();
    if (!m) return { sent: 0 };
    const tokens = (await col().find({ userId }).project({ token: 1 }).toArray()).map((t) => t.token);
    if (!tokens.length) return { sent: 0 };
    const res = await m.sendEachForMulticast({
      tokens,
      notification: { title: String(title).slice(0, 80), body: String(body).slice(0, 180) },
      data: { route: route ?? "/m/home/", kind },
      android: {
        priority: "high",
        collapseKey: tag ? `${kind}:${tag}` : kind,
        notification: { channelId: kind === "message" ? "messages" : "activity", tag: tag ? `${kind}:${tag}` : kind, color: "#7C5CFF", icon: "ic_stat_kynq" },
      },
    });
    const dead = res.responses.map((r, i) => (!r.success && GONE.has(r.error?.code) ? tokens[i] : null)).filter(Boolean);
    if (dead.length) await col().deleteMany({ token: { $in: dead } });
    return { sent: res.successCount, failed: res.failureCount, removed: dead.length };
  } catch (err) {
    console.error("[push] send failed:", err.message);
    return { sent: 0, error: err.message };
  }
}

// ─── What we notify about (copy lives here so every trigger reads the same) ───
export const notify = {
  message: (to, { fromId, fromName, text }) =>
    pushToUser(to, { kind: "message", tag: fromId, title: fromName || "New message", body: text || "Sent you a message", route: `/m/chat/?with=${encodeURIComponent(fromId)}` }),
  friendRequest: (to, { fromName }) =>
    pushToUser(to, { kind: "friend", title: "New friend request", body: `${fromName || "Someone you met"} wants to be friends`, route: "/m/chats/" }),
  friendAccepted: (to, { fromId, fromName }) =>
    pushToUser(to, { kind: "friend", tag: fromId, title: "You're friends now", body: `${fromName || "They"} accepted. Say hi!`, route: `/m/chat/?with=${encodeURIComponent(fromId)}` }),
  challengeInvite: (to, { fromName }) =>
    pushToUser(to, { kind: "challenge", title: "7-day challenge invite", body: `${fromName || "Someone"} invited you to a challenge`, route: "/m/challenges/" }),
  challengeAccepted: (to, { fromName }) =>
    pushToUser(to, { kind: "challenge", title: "Challenge on!", body: `${fromName || "They"} accepted your 7-day challenge`, route: "/m/challenges/" }),
  challengeTurn: (to, { fromName }) =>
    pushToUser(to, { kind: "challenge", title: "Your turn", body: `It's your turn in your challenge with ${fromName || "your friend"}`, route: "/m/challenges/" }),
};
