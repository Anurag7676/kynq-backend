// Campus ambassador auto-approval. Applications from people who say they're female
// are approved automatically one hour after they apply, and the applicant gets an
// email. Everyone else is still reviewed by hand in the admin inbox.
//
// Applications are contact-messages with reason "ambassador" (gift/routes/contact.js).
// Gender is self-declared on the form, so we also skip anyone whose kynq account says
// "male", anyone restricted, and anything an admin has already picked up in the inbox.
//
// Approval means users.isAmbassador = true. If the applicant has no kynq account yet,
// the application is marked approved and they're enrolled the first time they sign in
// with that email (activatePendingAmbassador, called from the Google sign-in route).
import mongoose from "mongoose";
import { sendEmail } from "../config/emailConfig.js";
import { logAudit } from "../adminConsole/audit.js";

const col = (name) => mongoose.connection.collection(name);
const DELAY_MS = 60 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;
const SITE = process.env.FRONTEND_URL || "https://kynq.in";
const IG_GROUP = "https://ig.me/j/Pc7Yp2s_zxN2jp2n/";

const lower = (e) => String(e ?? "").trim().toLowerCase();
const enroll = (userId) => col("users").updateOne({ id: userId, isAmbassador: { $ne: true } }, { $set: { isAmbassador: true, ambassadorSince: Date.now() } });

function approvalEmail(name, hasAccount) {
  const hi = name ? `Hi ${String(name).split(" ")[0]},` : "Hi,";
  const steps = [
    hasAccount ? null : `Sign in at ${SITE} with Google, using this email address. That switches on your ambassador account.`,
    `Join the ambassador group on Instagram: ${IG_GROUP}`,
    `Open your ambassador dashboard for your daily task and rewards: ${SITE}/ambassador/`,
  ].filter(Boolean);
  const text = [
    hi, "",
    "You're in. Your application to be a kynq campus ambassador has been approved.", "",
    "Next steps:",
    ...steps.map((s, i) => `${i + 1}. ${s}`), "",
    "Questions? Just reply to this email or write to hi@kynq.in.", "",
    "Team kynq",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#15143A;max-width:520px">
<p>${hi}</p>
<p><strong>You're in.</strong> Your application to be a kynq campus ambassador has been approved.</p>
<p>Next steps:</p>
<ol>${steps.map((s) => `<li style="margin-bottom:6px">${s.replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#6D35E8">$1</a>')}</li>`).join("")}</ol>
<p>Questions? Just reply to this email or write to <a href="mailto:hi@kynq.in" style="color:#6D35E8">hi@kynq.in</a>.</p>
<p>Team kynq</p></div>`;
  return { subject: "You're a kynq campus ambassador", text, html };
}

async function processOne(app) {
  const email = lower(app.email);
  const handled = await col("admin_inbox_status").findOne({ id: app.id });
  if (handled) return { status: "skipped", reason: "already_handled_by_admin" };
  const user = email ? await col("users").findOne({ email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }) : null;
  if (user?.gender === "male") return { status: "skipped", reason: "profile_says_male" };
  if (user?.kynqExtraRestricted) return { status: "skipped", reason: "account_restricted" };

  if (user) await enroll(user.id);
  const mail = approvalEmail(app.name, !!user);
  let emailed = false;
  try { await sendEmail({ to: app.email, ...mail }); emailed = true; }
  catch (err) { console.error("[ambassador] approval email failed for", app.id, ":", err?.message || err); }

  await col("admin_inbox_status").updateOne({ id: app.id }, { $set: { id: app.id, status: "done", updatedAt: Date.now(), updatedBy: "auto-approve" } }, { upsert: true });
  await logAudit("auto-approve", "ambassador.auto_approve", app.id, { userId: user?.id ?? null, emailed });
  return user ? { status: "approved", userId: user.id, emailed } : { status: "approved_pending_signup", emailed };
}

/** Approves every eligible application that's at least an hour old. Safe to run repeatedly. */
export async function runAmbassadorAutoApprovals(now = Date.now()) {
  const results = [];
  for (;;) {
    // Claim one at a time so two server processes can never approve (or email) twice.
    const claimed = await col("contact-messages").findOneAndUpdate(
      { reason: "ambassador", gender: "female", createdAt: { $lte: now - DELAY_MS }, autoApproval: { $exists: false } },
      { $set: { autoApproval: { status: "processing", at: now } } },
      { sort: { createdAt: 1 }, returnDocument: "after" },
    );
    const app = claimed; // driver 6: the document itself, or null
    if (!app) break;
    let outcome;
    try { outcome = await processOne(app); }
    catch (err) { console.error("[ambassador] auto-approve failed for", app.id, ":", err.message); outcome = { status: "error", reason: err.message.slice(0, 200) }; }
    await col("contact-messages").updateOne({ id: app.id }, { $set: { autoApproval: { ...outcome, at: Date.now() } } });
    results.push({ id: app.id, ...outcome });
  }
  return results;
}

/** First sign-in after an approval that happened before they had an account. */
export async function activatePendingAmbassador(user) {
  const email = lower(user?.email);
  if (!email || user.isAmbassador || user.gender === "male" || user.kynqExtraRestricted) return false;
  const app = await col("contact-messages").findOne({ reason: "ambassador", emailLower: email, "autoApproval.status": "approved_pending_signup" });
  if (!app) return false;
  await enroll(user.id);
  await col("contact-messages").updateOne({ id: app.id }, { $set: { "autoApproval.status": "approved", "autoApproval.userId": user.id, "autoApproval.activatedAt": Date.now() } });
  return true;
}

let timer = null;
export function startAmbassadorAutoApprovals() {
  if (timer || process.env.AMBASSADOR_AUTO_APPROVE === "off") return;
  const tick = () => runAmbassadorAutoApprovals()
    .then((r) => { if (r.length) console.log("[ambassador] auto-approve:", JSON.stringify(r)); })
    .catch((err) => console.error("[ambassador] auto-approve run failed:", err.message));
  setTimeout(tick, 30_000); // after the DB connects
  timer = setInterval(tick, TICK_MS);
}
