// Inbox: contact-form messages and campus ambassador applications, with a working status.
import { col, pageParams, maskEmail } from "./util.js";
import { logAudit } from "./audit.js";

const STATUSES = ["new", "in_progress", "done"];
const kindOf = (m) => (m.reason === "ambassador" ? "ambassador" : "contact");
const AMBASSADOR_LABELS = ["Name", "Email", "College", "City", "Course and year", "Instagram", "Hoodie size (if accepted)", "Quiz result", "Why"];

function parseAmbassador(message) {
  const fields = {};
  for (const line of String(message || "").split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const label = line.slice(0, i).trim();
    if (AMBASSADOR_LABELS.includes(label)) fields[label] = line.slice(i + 1).trim();
  }
  return fields;
}

const statusIds = async (status) => (await col("admin_inbox_status").find({ status }).project({ id: 1 }).toArray()).map((d) => d.id);

export async function listInbox(query) {
  const { page, limit, skip } = pageParams(query);
  const kindFilter = query?.kind === "ambassador" ? { reason: "ambassador" } : query?.kind === "contact" ? { reason: { $ne: "ambassador" } } : {};
  const [inProgressIds, doneIds] = await Promise.all([statusIds("in_progress"), statusIds("done")]);
  const handled = [...inProgressIds, ...doneIds];

  const filter = { ...kindFilter };
  if (query?.status === "new") filter.id = { $nin: handled };
  else if (query?.status === "in_progress") filter.id = { $in: inProgressIds };
  else if (query?.status === "done") filter.id = { $in: doneIds };

  const [total, all, inProgress, done, rows] = await Promise.all([
    col("contact-messages").countDocuments(filter),
    col("contact-messages").countDocuments(kindFilter),
    col("contact-messages").countDocuments({ ...kindFilter, id: { $in: inProgressIds } }),
    col("contact-messages").countDocuments({ ...kindFilter, id: { $in: doneIds } }),
    col("contact-messages").find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
  ]);
  const statuses = new Map((await col("admin_inbox_status").find({ id: { $in: rows.map((r) => r.id) } }).toArray()).map((s) => [s.id, s.status]));
  return {
    total, page, limit, counts: { new: Math.max(0, all - inProgress - done), in_progress: inProgress, done },
    items: rows.map((m) => ({
      id: m.id, kind: kindOf(m), reason: m.reason ?? null, name: m.name ?? null, emailMasked: maskEmail(m.email),
      preview: String(m.message || "").replace(/\s+/g, " ").slice(0, 120), createdAt: m.createdAt, status: statuses.get(m.id) ?? "new",
    })),
  };
}

export async function getInboxItem(id, admin) {
  const m = await col("contact-messages").findOne({ id });
  if (!m) return null;
  const status = (await col("admin_inbox_status").findOne({ id }))?.status ?? "new";
  await logAudit(admin.email, "inbox.open", id);
  const kind = kindOf(m);
  return { item: { id: m.id, kind, reason: m.reason ?? null, name: m.name ?? null, email: m.email, message: m.message, createdAt: m.createdAt, status, ...(kind === "ambassador" ? { fields: parseAmbassador(m.message) } : {}) } };
}

export async function setInboxStatus(id, status, admin) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error("invalid status"), { code: "bad_request" });
  const m = await col("contact-messages").findOne({ id }, { projection: { id: 1 } });
  if (!m) return null;
  await col("admin_inbox_status").updateOne({ id }, { $set: { id, status, updatedAt: Date.now(), updatedBy: admin.email } }, { upsert: true });
  await logAudit(admin.email, "inbox.status", id, { status });
  return { id, status };
}
