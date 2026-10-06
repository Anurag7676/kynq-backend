import KynqExtraReport from "../models/kynqExtraReportModel.js";
import { findUserById, saveUser } from "../gift/session.js";
import { enforceRestriction } from "./restrictions.js";

// Auto-restrict an account after this many OPEN reports against it — a
// cheap, automatic first line of defense while a human reviews. A restricted
// account is locked out entirely (no sign-in, live calls ended, no matching)
// until an admin unrestricts it. See restrictions.js.
const AUTO_RESTRICT_THRESHOLD = 3;

export async function submitReport({ reporterScopedId, reportedScopedId, callId, reason, note }) {
  if (reporterScopedId === reportedScopedId) throw new Error("can't report yourself");
  const report = await KynqExtraReport.create({ reporterScopedId, reportedScopedId, callId, reason, note });

  const openCount = await KynqExtraReport.countDocuments({ reportedScopedId, status: "open" });
  if (openCount >= AUTO_RESTRICT_THRESHOLD) {
    const user = await findUserById(reportedScopedId).catch(() => null);
    if (user && !user.kynqExtraRestricted) {
      await saveUser({ ...user, kynqExtraRestricted: true });
      enforceRestriction(user.id).catch((err) => console.error("[restrict] enforce failed:", err.message));
    }
  }
  return report;
}

export async function listOpenReports({ limit = 50 } = {}) {
  return KynqExtraReport.find({ status: "open" }).sort({ createdAt: -1 }).limit(limit).lean();
}

export async function reviewReport(reportId, { status, actionTaken, reviewedBy }) {
  return KynqExtraReport.findByIdAndUpdate(
    reportId,
    { status, actionTaken, reviewedBy, reviewedAt: new Date() },
    { new: true }
  );
}

export async function isRestricted(userId) {
  const user = await findUserById(userId).catch(() => null);
  return !!user?.kynqExtraRestricted;
}

export async function setRestricted(userId, restricted) {
  const user = await findUserById(userId);
  if (!user) throw new Error("user not found");
  await saveUser({ ...user, kynqExtraRestricted: restricted });
  if (restricted) await enforceRestriction(user.id).catch((err) => console.error("[restrict] enforce failed:", err.message));
}
