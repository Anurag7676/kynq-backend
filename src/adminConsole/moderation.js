// Reports queue: list, review, and (optionally) restrict the reported person.
import KynqExtraReport from "../models/kynqExtraReportModel.js";
import { pageParams, usersById, displayName, setRestrictedById } from "./util.js";
import { logAudit } from "./audit.js";

const STATUSES = ["open", "reviewed", "actioned"];

async function shape(reports) {
  const people = await usersById(reports.flatMap((r) => [r.reporterScopedId, r.reportedScopedId]));
  const reportedIds = [...new Set(reports.map((r) => r.reportedScopedId))];
  const counts = reportedIds.length
    ? await KynqExtraReport.aggregate([
        { $match: { reportedScopedId: { $in: reportedIds } } },
        { $group: { _id: "$reportedScopedId", total: { $sum: 1 }, open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } } } },
      ])
    : [];
  const byId = new Map(counts.map((c) => [c._id, c]));
  return reports.map((r) => {
    const reported = people.get(r.reportedScopedId);
    const c = byId.get(r.reportedScopedId);
    return {
      id: String(r._id), reason: r.reason, note: r.note || null, status: r.status,
      createdAt: new Date(r.createdAt).getTime(), callId: r.callId, actionTaken: r.actionTaken === "none" ? null : r.actionTaken,
      reviewedBy: r.reviewedBy || null, reviewedAt: r.reviewedAt ? new Date(r.reviewedAt).getTime() : null,
      reporter: { id: r.reporterScopedId, name: displayName(people.get(r.reporterScopedId)) },
      reported: { id: r.reportedScopedId, name: displayName(reported), restricted: !!reported?.kynqExtraRestricted, openReports: c?.open ?? 0, totalReports: c?.total ?? 0 },
    };
  });
}

export async function listReports(query) {
  const { page, limit, skip } = pageParams(query);
  const status = STATUSES.includes(query?.status) ? query.status : null;
  const filter = status ? { status } : {};
  const [total, rows, grouped] = await Promise.all([
    KynqExtraReport.countDocuments(filter),
    KynqExtraReport.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    KynqExtraReport.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  const counts = { open: 0, reviewed: 0, actioned: 0, ...Object.fromEntries(grouped.map((g) => [g._id, g.n])) };
  return { total, page, limit, counts, reports: await shape(rows) };
}

export async function reviewReport(id, { status, action }, admin) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error("invalid status"), { code: "bad_request" });
  if (!["none", "restrict", "unrestrict"].includes(action || "none")) throw Object.assign(new Error("invalid action"), { code: "bad_request" });
  const existing = await KynqExtraReport.findById(id).catch(() => null);
  if (!existing) throw Object.assign(new Error("report not found"), { code: "not_found" });

  const doRestrict = action === "restrict";
  const doUnrestrict = action === "unrestrict";
  const updated = await KynqExtraReport.findByIdAndUpdate(
    id,
    { status, actionTaken: doRestrict ? "restricted" : doUnrestrict ? "none" : existing.actionTaken, reviewedBy: admin.email, reviewedAt: new Date() },
    { new: true },
  ).lean();
  if (doRestrict) await setRestrictedById(existing.reportedScopedId, true);
  if (doUnrestrict) await setRestrictedById(existing.reportedScopedId, false);
  await logAudit(admin.email, "report.review", id, { status, action: action || "none", reported: existing.reportedScopedId });
  return (await shape([updated]))[0];
}

export const reportsForUser = async (userId) => {
  const [against, by] = await Promise.all([
    KynqExtraReport.find({ reportedScopedId: userId }).sort({ createdAt: -1 }).limit(20).lean(),
    KynqExtraReport.find({ reporterScopedId: userId }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  const short = (r) => ({ id: String(r._id), reason: r.reason, status: r.status, createdAt: new Date(r.createdAt).getTime() });
  return { against: against.map(short), by: by.map(short) };
};

