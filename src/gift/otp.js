// Email OTP — kynq login. Deliberately NOT modeled on the legacy
// StylenHomes OTP flow (src/utils/otpUtils.js): that one uses Math.random()
// (not a CSPRNG), has no resend cooldown, and no max-attempt lockout, which
// makes a 6-digit code brute-forceable. This version fixes all three.
import crypto from "crypto";
import { collection } from "./store.js";
import { sendEmail } from "../config/emailConfig.js";

const otps = collection("otps");

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function otpEmail(code) {
  const text = `your kynq sign-in code: ${code}\n\nexpires in 10 minutes. if you didn't request this, ignore this email.`;
  const html = `<p>your kynq sign-in code:</p><p style="font-size:28px;font-weight:600;letter-spacing:4px;">${code}</p><p>expires in 10 minutes. if you didn't request this, ignore this email.</p>`;
  return { subject: "your kynq sign-in code", text, html };
}

export async function requestOtp(email) {
  const key = email.toLowerCase().trim();
  const now = Date.now();
  const existing = await otps.get(key);
  if (existing && existing.createdAt + RESEND_COOLDOWN_MS > now) {
    return { ok: false, reason: "cooldown", retryAfterMs: existing.createdAt + RESEND_COOLDOWN_MS - now };
  }

  const code = generateCode();
  await otps.set(key, { email: key, code, createdAt: now, expiresAt: now + CODE_TTL_MS, attempts: 0 });

  if (process.env.EMAIL_USERNAME && process.env.EMAIL_PASSWORD) {
    await sendEmail({ to: key, ...otpEmail(code) });
  } else {
    console.log(`\n──────── SIGN-IN CODE (demo mode) ────────\nto:   ${key}\ncode: ${code}\n────────────────────────────────────────\n`);
  }
  return { ok: true };
}

export async function verifyOtp(email, code) {
  const key = email.toLowerCase().trim();
  const rec = await otps.get(key);
  if (!rec) return { ok: false, reason: "no_code" };
  if (Date.now() > rec.expiresAt) {
    await otps.delete(key);
    return { ok: false, reason: "expired" };
  }
  if (rec.attempts >= MAX_ATTEMPTS) {
    await otps.delete(key);
    return { ok: false, reason: "too_many_attempts" };
  }
  if (rec.code !== String(code ?? "").trim()) {
    await otps.set(key, { ...rec, attempts: rec.attempts + 1 });
    return { ok: false, reason: "wrong_code" };
  }
  await otps.delete(key);
  return { ok: true };
}
