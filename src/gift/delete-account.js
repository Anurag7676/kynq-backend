// User-initiated account deletion (Google Play / privacy requirement).
//
// What happens, in order:
//   1. The person is signed out everywhere and kicked from any live call or queue.
//   2. Personal data is DELETED: profile, sessions, carts, wishlists, wallet balance, passes,
//      unlocks, friends, DMs, blocks, matches history, chats from their calls, challenges,
//      referral codes, nudge/game/ambassador activity, support messages.
//   3. Records we must keep are ANONYMISED (personal fields removed, the user id replaced by a
//      one-way "del_…" id): paid coin orders and shop orders (tax invoices, GST), the Koin
//      wallet ledger, gift purchases/sends, creator commissions, campus conversions, call
//      metadata, reports they filed, question-card answers.
//   4. Reports ABOUT them are kept as they are (safety: a bad actor can't erase their record
//      by deleting the account). This is stated in the privacy policy.
// A small tombstone (hashed email, counts, time) is kept so we can prove the deletion happened.
import crypto from "node:crypto";
import mongoose from "mongoose";
import { revokeSessionsForUser } from "./session.js";

const db = () => mongoose.connection;
const C = (name) => db().collection(name);
const anonIdFor = (userId) => `del_${crypto.createHash("sha256").update(`kynq-deleted:${userId}`).digest("hex").slice(0, 20)}`;
const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function del(name, filter) {
  try { return (await C(name).deleteMany(filter)).deletedCount; } catch (err) { console.error(`[delete-account] ${name}:`, err.message); return 0; }
}
async function upd(name, filter, update, options) {
  try { return (await C(name).updateMany(filter, update, options)).modifiedCount; } catch (err) { console.error(`[delete-account] ${name}:`, err.message); return 0; }
}

/**
 * Deletes the account of `user` (the signed-in user doc: { id, email, ... }).
 * Returns per-collection counts. Safe to re-run (everything is idempotent).
 */
export async function deleteAccount(user) {
  const userId = user.id, email = String(user.email || "").toLowerCase();
  const anon = anonIdFor(userId);
  const counts = {};

  // 1. Out of every session and live call first, so nothing new is written meanwhile.
  counts.sessionsRevoked = await revokeSessionsForUser(userId).catch(() => 0);
  try { const { kickUser } = await import("../kynqExtra/signaling.js"); await kickUser(userId); } catch (err) { console.error("[delete-account] kick:", err.message); }

  // Calls they were in (needed to delete those calls' chats and games before anonymising).
  const callIds = (await C("calls").find({ $or: [{ participantA: userId }, { participantB: userId }] }, { projection: { _key: 1, id: 1, callId: 1 } }).toArray().catch(() => []))
    .map((c) => c._key ?? c.id ?? c.callId).filter(Boolean);

  // 2. Delete personal data.
  const either = (a, b) => ({ $or: [{ [a]: userId }, { [b]: userId }] });
  counts.chats = callIds.length ? await del("chat_messages", { _key: { $in: callIds } }) : 0;
  counts.games = callIds.length ? await del("game_sessions", { $or: [{ callId: { $in: callIds } }, { _key: { $in: callIds } }] }) : 0;
  counts.authSessions = await del("auth-sessions", { userId });
  counts.pushTokens = await del("push_tokens", { userId }); // no more notifications to their phones
  counts.otps = email ? await del("otps", { _key: email }) : 0;
  counts.carts = await del("carts", { $or: [{ _key: userId }, { sessionId: userId }] });
  counts.wishlists = await del("wishlists", { $or: [{ _key: userId }, { sessionId: userId }] });
  counts.walletBalance = await del("wallet_balances", { $or: [{ _key: userId }, { userId }] });
  counts.genderPasses = await del("gender_passes", { $or: [{ _key: userId }, { userId }] });
  counts.filterUnlocks = await del("filter_unlocks", { _key: { $regex: `^${escape(userId)}:` } });
  counts.chatTime = await del("chat_time", { _key: userId });
  counts.chatPairDay = await del("chat_pair_day", { _key: { $regex: escape(userId) } });
  counts.friendRequests = await del("friend_requests", either("from", "to"));
  counts.friendships = await del("friendships", either("a", "b"));
  counts.dms = await del("dm_messages", either("from", "to"));
  counts.blocks = await del("blocks", either("blockerScopedId", "blockedScopedId"));
  counts.recentMatches = await del("recent_matches", either("participantA", "participantB"));
  counts.challenges = await del("challenges", either("participantA", "participantB"));
  counts.nudgeEvents = await del("nudge_events", { userId });
  counts.referralCodes = await del("referral_codes", { userId });
  counts.referralAsInvitee = await del("referrals", { _key: userId });
  counts.gameWins = await del("game_win_day", { userId });
  counts.giftInventory = await del("gift_inventory", { userId });
  counts.ambassadorDays = await del("ambassador_days", { userId });
  counts.ambassadorMonths = await del("ambassador_months", { userId });
  counts.demoSeen = await del("kynq_extra_demo_seen", { $or: [{ _key: userId }, { userId }] });
  counts.support = email ? await del("contact-messages", { $or: [{ emailLower: email }, { email }] }) : 0;
  counts.newsletter = email ? await del("newsletter", { $or: [{ _key: email }, { email }] }) : 0;

  // 3. Keep, but anonymise (tax invoices, ledgers, metrics, safety).
  const noCustomer = { name: "Deleted user", email: null, phone: null };
  counts.coinOrders = await upd("coin_orders", { userId }, { $set: { userId: anon, customer: { id: anon, ...noCustomer } } });
  // Shop orders: GST needs the place of supply (state), nothing else personal.
  // (In a pipeline, $set with an object MERGES into the old one, so build the trimmed address
  // separately and swap it in; otherwise the street address would survive.)
  counts.shopOrders = await upd("orders", { $or: [{ userId }, { sessionId: userId }] }, [
    { $set: { _keepAddr: { state: "$shippingAddress.state", country: "$shippingAddress.country" } } },
    { $unset: ["shippingAddress", "customer", "billingAddress"] },
    { $set: { userId: anon, sessionId: anon, customer: { $literal: noCustomer }, shippingAddress: "$_keepAddr" } },
    { $unset: "_keepAddr" },
  ]);
  counts.walletLedger = await upd("wallet_transactions", { userId }, { $set: { userId: anon } });
  counts.giftPurchases = await upd("gift_purchases", { userId }, { $set: { userId: anon } });
  counts.giftSendsFrom = await upd("gift_sends", { fromUserId: userId }, { $set: { fromUserId: anon } });
  counts.giftSendsTo = await upd("gift_sends", { toUserId: userId }, { $set: { toUserId: anon } });
  counts.creatorCommissions = await upd("creator_commissions", { userId }, { $set: { userId: anon } });
  counts.creatorSignups = await upd("creator_signups", { userId }, { $set: { userId: anon } });
  counts.campusConversions = await upd("campus_link_conversions", { userId }, { $set: { userId: anon } });
  counts.referralAsReferrer = await upd("referrals", { referrerId: userId }, { $set: { referrerId: anon } });
  counts.callsA = await upd("calls", { participantA: userId }, { $set: { participantA: anon } });
  counts.callsB = await upd("calls", { participantB: userId }, { $set: { participantB: anon } });
  counts.questionAnswers = await upd("pair_question_answers", { "picks.userId": userId }, { $set: { "picks.$[p].userId": anon } }, { arrayFilters: [{ "p.userId": userId }] });
  counts.reportsFiled = await upd("kynqextrareports", { reporterScopedId: userId }, { $set: { reporterScopedId: anon } });

  // 4. The account itself.
  counts.user = await del("users", { id: userId });

  await C("deleted_accounts").insertOne({
    anonId: anon,
    emailHash: email ? crypto.createHash("sha256").update(email).digest("hex") : null,
    deletedAt: Date.now(),
    counts,
  }).catch((err) => console.error("[delete-account] tombstone:", err.message));
  console.log(`[delete-account] deleted ${anon}`, JSON.stringify(counts));
  return { anonId: anon, counts };
}
