// Referrals. (Master Spec v3 §2 "Referral Reward", §7 "Referral Link")
//
//  • The referrer gets +100 once their invited friend completes 10 eligible
//    chat minutes. Paid with ledger key referral:<referrer>:<invitee>, so it is
//    exactly-once per qualifying referral no matter how often it's evaluated.
//  • "Duplicate accounts and fake referrals must be prevented." With email-OTP
//    sign-in nobody can fully PREVENT a determined person making fake accounts
//    (disposable inboxes exist). What this does is remove every cheap path:
//      – no self-referral;
//      – one referral per invitee, ever, and it can't be changed afterwards;
//      – only NEW accounts that have never chatted can be referred, so an
//        existing user can't be retro-"invited";
//      – the same browser/device can't be both referrer and invitee, and one
//        device can't redeem more than one invite (the classic sign-out →
//        new-account loop);
//      – the invitee's qualifying 10 minutes must be with people OTHER than
//        the referrer, so two friends can't farm it off each other;
//      – a referrer is throttled per day.

import crypto from "crypto";
import { collection, makeId } from "../gift/store.js";
import { findUserById } from "../gift/session.js";
import { credit } from "./wallet.js";
import { ECONOMY } from "./economy.js";

const codes = collection("referral_codes");     // _key: code      → { userId, devices[] }
const referrals = collection("referrals");      // _key: inviteeId → { referrerId, status, … }
const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000;

export class ReferralError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// userId → false when we know there's nothing pending (skips a DB read on
// every 30s meter flush for the vast majority of users).
const nothingPending = new Set();

// Codes get read aloud and typed: fixed length, no look-alikes (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

async function codeDocFor(userId) {
  const mine = await codes.find((c) => c.userId === userId);
  return mine[0] ?? null;
}

export async function getOrCreateCode(userId, deviceId) {
  let doc = await codeDocFor(userId);
  if (!doc) {
    let code = newCode();
    while (await codes.get(code)) code = newCode(); // eslint-disable-line no-await-in-loop
    doc = { code, userId, devices: [], createdAt: Date.now() };
    await codes.set(code, doc);
  }
  if (deviceId && !doc.devices.includes(deviceId)) {
    doc = { ...doc, devices: [...doc.devices, deviceId].slice(-10) };
    await codes.set(doc.code, doc);
  }
  return doc.code;
}

export async function attachReferral(inviteeId, rawCode, { deviceId, eligibleSeconds = 0 } = {}) {
  const code = String(rawCode ?? "").trim().toUpperCase();
  if (!code) throw new ReferralError("Missing invite code");
  const owner = await codes.get(code);
  if (!owner) throw new ReferralError("That invite code isn't valid", 404);
  if (owner.userId === inviteeId) throw new ReferralError("You can't invite yourself");
  if (await referrals.get(inviteeId)) throw new ReferralError("An invite is already linked to your account", 409);

  const invitee = await findUserById(inviteeId);
  if (!invitee) throw new ReferralError("Account not found", 404);
  if (eligibleSeconds > 0 || Date.now() - (invitee.createdAt ?? 0) > NEW_ACCOUNT_MS) {
    throw new ReferralError("Invites only work for new accounts", 403);
  }
  if (deviceId) {
    if ((owner.devices ?? []).includes(deviceId)) throw new ReferralError("This invite can't be used on the inviter's own device", 403);
    const sameDevice = await referrals.find((r) => r.deviceId === deviceId);
    if (sameDevice.length) throw new ReferralError("An invite was already used on this device", 403);
  }
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await referrals.find((r) => r.referrerId === owner.userId && r.createdAt > dayAgo);
  if (recent.length >= ECONOMY.referral.maxAttachPerReferrerPerDay) throw new ReferralError("This invite link is temporarily paused", 429);

  const rec = { id: makeId("ref"), inviteeId, referrerId: owner.userId, code, deviceId: deviceId ?? null, status: "pending", withReferrerSeconds: 0, createdAt: Date.now(), qualifiedAt: null };
  await referrals.set(inviteeId, rec);
  nothingPending.delete(inviteeId);
  return rec;
}

// Called by the chat meter each time `inviteeId` banks eligible time.
export async function qualifyReferralIfDue(inviteeId, partnerId, secs, totalEligibleSeconds) {
  if (nothingPending.has(inviteeId)) return null;
  let rec = await referrals.get(inviteeId);
  if (!rec || rec.status !== "pending") { nothingPending.add(inviteeId); return null; }

  if (partnerId === rec.referrerId) {
    rec = { ...rec, withReferrerSeconds: (rec.withReferrerSeconds ?? 0) + secs };
    await referrals.set(inviteeId, rec);
  }
  const independent = totalEligibleSeconds - (rec.withReferrerSeconds ?? 0);
  if (independent < ECONOMY.chat.blockSeconds) return null;

  const tx = await credit(rec.referrerId, "referral", { refId: inviteeId, amount: ECONOMY.referral.reward, note: "a friend you invited started chatting" });
  await referrals.set(inviteeId, { ...rec, status: "qualified", qualifiedAt: Date.now() });
  nothingPending.add(inviteeId);
  return tx.duplicate ? null : { referrerId: rec.referrerId, amount: ECONOMY.referral.reward };
}

export async function referralSummary(userId) {
  const mine = await referrals.find((r) => r.referrerId === userId);
  const qualified = mine.filter((r) => r.status === "qualified").length;
  return { invited: mine.length, qualified, pending: mine.length - qualified, earned: qualified * ECONOMY.referral.reward, rewardPerFriend: ECONOMY.referral.reward };
}
