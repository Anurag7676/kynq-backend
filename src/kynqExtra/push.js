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
export async function pushToUser(userId, { title, body, route, kind = "general", tag, image }) {
  try {
    if (!userId || !pushConfigured()) return { sent: 0 };
    const m = await fcm();
    if (!m) return { sent: 0 };
    const tokens = (await col().find({ userId }).project({ token: 1 }).toArray()).map((t) => t.token);
    if (!tokens.length) return { sent: 0 };
    const res = await m.sendEachForMulticast(message(tokens, { title, body, route, kind, tag, image }));
    const dead = res.responses.map((r, i) => (!r.success && GONE.has(r.error?.code) ? tokens[i] : null)).filter(Boolean);
    if (dead.length) await col().deleteMany({ token: { $in: dead } });
    return { sent: res.successCount, failed: res.failureCount, removed: dead.length };
  } catch (err) {
    console.error("[push] send failed:", err.message);
    return { sent: 0, error: err.message };
  }
}

/** One FCM multicast. `image` (https) shows as a big picture banner when expanded. */
function message(tokens, { title, body, route, kind, tag, image }) {
  const channelId = kind === "message" ? "messages" : kind === "promo" ? "promos" : "activity";
  const img = typeof image === "string" && image.startsWith("https://") ? image : undefined;
  return {
    tokens,
    notification: { title: String(title).slice(0, 80), body: String(body).slice(0, 180), ...(img ? { imageUrl: img } : {}) },
    data: { route: route ?? "/m/home/", kind },
    android: {
      priority: kind === "promo" ? "normal" : "high",
      collapseKey: tag ? `${kind}:${tag}` : kind,
      notification: { channelId, tag: tag ? `${kind}:${tag}` : kind, color: "#7C5CFF", icon: "ic_stat_kynq", ...(img ? { imageUrl: img } : {}) },
    },
  };
}

// ─── Marketing broadcasts (admin only): their own muteable "promos" channel, at most one per
// person per PROMO_GAP, sent in batches of 500. `testUserId` sends only to that person. ───
const PROMO_GAP_MS = 20 * 60 * 60 * 1000;
export async function broadcast({ title, body, image, route = "/m/home/", testUserId = null }) {
  if (!title || !body) throw new Error("title and body are required");
  if (!pushConfigured()) throw new Error("push isn't configured on this server");
  const m = await fcm();
  if (!m) throw new Error("push isn't available");
  await ensurePushIndexes();
  const now = Date.now();
  const filter = testUserId ? { userId: testUserId } : { $or: [{ lastPromoAt: { $exists: false } }, { lastPromoAt: { $lt: now - PROMO_GAP_MS } }] };
  const rows = await col().find(filter).project({ token: 1, userId: 1 }).toArray();
  let sent = 0, failed = 0, removed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const res = await m.sendEachForMulticast(message(batch.map((r) => r.token), { title, body, route, kind: "promo", tag: "promo", image }));
    sent += res.successCount; failed += res.failureCount;
    const dead = res.responses.map((r, j) => (!r.success && GONE.has(r.error?.code) ? batch[j].token : null)).filter(Boolean);
    if (dead.length) { removed += dead.length; await col().deleteMany({ token: { $in: dead } }); }
  }
  if (!testUserId && rows.length) await col().updateMany({ token: { $in: rows.map((r) => r.token) } }, { $set: { lastPromoAt: now } });
  return { targeted: rows.length, sent, failed, removed, test: !!testUserId };
}

// ─── What we notify about. Copy is playful (Zomato-style), short, and rotates between a few
// variants so it never reads like a robot. {n} = the other person's first name. ───
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const first = (name) => String(name || "").trim().split(/\s+/)[0] || "Someone";
const fill = (t, name) => t.replaceAll("{n}", first(name));
const COPY = {
  friendRequest: [
    ["Someone thinks you're fun 👀", "{n} wants to be friends. Don't leave them on 'seen' 🙈"],
    ["New fan unlocked ✨", "{n} sent you a friend request. Accept before they change their mind 😌"],
    ["Friendship incoming 🤝", "{n} wants to keep talking. Tap to say yes"],
  ],
  friendAccepted: [
    ["It's official 🤝", "{n} accepted. Say hi before it gets awkward 😅"],
    ["New friend, who dis? 😎", "{n} is your friend now. Your move 👋"],
    ["Friendship level: unlocked 🔓", "{n} said yes! Send the first message"],
  ],
  challengeInvite: [
    ["{n} dared you 🔥", "A 7-day challenge. Chicken or champion? 🐔🏆"],
    ["Challenge accepted? 👀", "{n} wants a 7-day streak with you. Ready?"],
  ],
  challengeAccepted: [
    ["Game on! 🎯", "{n} accepted your 7-day challenge. Don't break the streak 🔥"],
    ["Streak mode: ON 🔥", "{n} is in. Day 1 starts now"],
  ],
  challengeTurn: [
    ["Your move ⏳", "{n} is waiting for your answer. Keep the streak alive 🔥"],
    ["Psst… it's your turn 🫣", "{n} asked you something. Don't ghost the streak 👻"],
    ["Ding ding 🔔", "New question from {n}. Answer before the day ends ⏰"],
  ],
};
const say = (key, name) => { const [t, b] = pick(COPY[key]); return { title: fill(t, name), body: fill(b, name) }; };

export const notify = {
  // Messages stay plain: the sender's name and their actual words (like any chat app).
  message: (to, { fromId, fromName, text }) =>
    pushToUser(to, { kind: "message", tag: fromId, title: `${first(fromName)} 💬`, body: text || "Sent you a message", route: `/m/chat/?with=${encodeURIComponent(fromId)}` }),
  friendRequest: (to, { fromName }) => pushToUser(to, { kind: "friend", ...say("friendRequest", fromName), route: "/m/chats/" }),
  friendAccepted: (to, { fromId, fromName }) => pushToUser(to, { kind: "friend", tag: fromId, ...say("friendAccepted", fromName), route: `/m/chat/?with=${encodeURIComponent(fromId)}` }),
  challengeInvite: (to, { fromName }) => pushToUser(to, { kind: "challenge", ...say("challengeInvite", fromName), route: "/m/challenges/" }),
  challengeAccepted: (to, { fromName }) => pushToUser(to, { kind: "challenge", ...say("challengeAccepted", fromName), route: "/m/challenges/" }),
  challengeTurn: (to, { fromName }) => pushToUser(to, { kind: "challenge", ...say("challengeTurn", fromName), route: "/m/challenges/" }),
};

/** Ready-made marketing pushes (Zomato-style) the admin can send as-is or edit. */
export const PROMO_TEMPLATES = [
  { title: "Bored? Same 😮‍💨", body: "People are online right now. One tap and you're talking 👀", route: "/m/home/" },
  { title: "Your next best friend is online 👋", body: "They're waiting. Don't keep them waiting 😌", route: "/m/home/" },
  { title: "Netflix can wait 🍿", body: "Real people, real conversations. Start a call in seconds", route: "/m/home/" },
  { title: "Koins are calling 🪙", body: "Talk for 10 minutes, earn Koins. Easy money (almost) 😎", route: "/m/koins/" },
  { title: "Late night, good vibes 🌙", body: "The night crowd is chatty. Hop in 💜", route: "/m/home/" },
  { title: "Weekend plans? kynq 😎", body: "Meet someone new from anywhere in India", route: "/m/home/" },
];
