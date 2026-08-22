// Email OTP — kynq login. Deliberately NOT modeled on the legacy
// StylenHomes OTP flow (src/utils/otpUtils.js): that one uses Math.random()
// (not a CSPRNG), has no resend cooldown, and no max-attempt lockout, which
// makes a 6-digit code brute-forceable. This version fixes all three.
import crypto from "crypto";
import { collection } from "./store.js";
import { sendEmail } from "../config/emailConfig.js";
import { renderEmailLayout, eyebrow, heading, paragraph, COLORS, MONO_FONT } from "./email-layout.js";

const otps = collection("otps");

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function otpEmail(code) {
  const text = `your kynq sign-in code: ${code}\n\nexpires in 10 minutes. if you didn't request this, ignore this email.`;

  const codeBlock = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="background:${COLORS.estate};border:1px solid ${COLORS.estateEdge};border-radius:14px;padding:18px 24px;">
          <span style="font-family:${MONO_FONT};font-size:32px;font-weight:600;letter-spacing:10px;color:${COLORS.ink};">${code}</span>
        </td>
      </tr>
    </table>`;

  const bodyHtml = `
    ${eyebrow("sign in")}
    ${heading("your code is ready.")}
    ${paragraph("enter this in the tab where you started signing in:")}
    ${codeBlock}
    ${paragraph("expires in 10 minutes. if you didn't request this, ignore this email — no action needed.")}
  `;

  return { subject: "your kynq sign-in code", text, html: renderEmailLayout({ preheader: `Your sign-in code: ${code}`, bodyHtml }) };
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
