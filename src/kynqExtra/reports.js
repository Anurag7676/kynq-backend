import KynqExtraReport from "../models/kynqExtraReportModel.js";
import { findUserById, saveUser } from "../gift/session.js";

// Auto-restrict an account after this many OPEN reports against it — a
// cheap, automatic first line of defense while a human reviews. This is
// NOT a ban; a restricted account can't join the matchmaking queue but
// keeps full access to the rest of kynq.
const AUTO_RESTRICT_THRESHOLD = 3;

export async function submitReport({ reporterScopedId, reportedScopedId, callId, reason, note }) {
  if (reporterScopedId === reportedScopedId) throw new Error("can't report yourself");
  const report = await KynqExtraReport.create({ reporterScopedId, reportedScopedId, callId, reason, note });

  const openCount = await KynqExtraReport.countDocuments({ reportedScopedId, status: "open" });
  if (openCount >= AUTO_RESTRICT_THRESHOLD) {
    const user = await findUserById(reportedScopedId).catch(() => null);
    if (user && !user.kynqExtraRestricted) {
      await saveUser({ ...user, kynqExtraRestricted: true });
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
}
