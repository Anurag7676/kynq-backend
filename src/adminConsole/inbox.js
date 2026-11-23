// Inbox: contact-form messages, campus ambassador and "work with kynq" applications, with a working status.
import { col, pageParams, maskEmail } from "./util.js";
import { logAudit } from "./audit.js";

const STATUSES = ["new", "in_progress", "done"];
const kindOf = (m) => (m.reason === "ambassador" ? "ambassador" : m.reason === "work" ? "work" : "contact");
const LABELS = {
  ambassador: ["Name", "Email", "College", "City", "Course and year", "Instagram", "Hoodie size (if accepted)", "Quiz result", "Why"],
  // Matches the lines components/work/work-form.tsx writes on the site.
  work: ["Phone", "City", "Wants to do", "Work / portfolio", "Confirmed 18 or older", "About"],
};
const KIND_FILTERS = {
  ambassador: { reason: "ambassador" },
  work: { reason: "work" },
  contact: { reason: { $nin: ["ambassador", "work"] } },
};

function parseFields(message, labels) {
  const fields = {};
  for (const line of String(message || "").split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const label = line.slice(0, i).trim();
    if (labels.includes(label)) fields[label] = line.slice(i + 1).trim();
  }
  return fields;
}

// The work form sits on a stranger-chat site, so a share of applications are sexual or abusive.
// Flag them so they sort out at a glance; nothing is hidden or deleted.
const JUNK = /\b(sex|sexy|nude|nudes|porn|pornstar|pussy|boobs?|dick|stripper|fuck|chut|lund)\b/i;

function rowPreview(m, kind) {
  if (kind !== "work") return String(m.message || "").replace(/\s+/g, " ").slice(0, 120);
  const f = parseFields(m.message, LABELS.work);
  return [f["Wants to do"], f.City, f.About].filter(Boolean).join(" · ").replace(/\s+/g, " ").slice(0, 140);
}

const statusIds = async (status) => (await col("admin_inbox_status").find({ status }).project({ id: 1 }).toArray()).map((d) => d.id);

export async function listInbox(query) {
  const { page, limit, skip } = pageParams(query);
  const kindFilter = KIND_FILTERS[query?.kind] ?? {};
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
    items: rows.map((m) => {
      const kind = kindOf(m);
      return {
        id: m.id, kind, reason: m.reason ?? null, name: m.name ?? null, emailMasked: maskEmail(m.email),
        preview: rowPreview(m, kind), createdAt: m.createdAt, status: statuses.get(m.id) ?? "new",
        ...(kind === "work" ? { junk: JUNK.test(String(m.message || "")) } : {}),
      };
    }),
  };
}

export async function getInboxItem(id, admin) {
  const m = await col("contact-messages").findOne({ id });
  if (!m) return null;
  const status = (await col("admin_inbox_status").findOne({ id }))?.status ?? "new";
  await logAudit(admin.email, "inbox.open", id);
  const kind = kindOf(m);
  const extra = LABELS[kind] ? { fields: parseFields(m.message, LABELS[kind]) } : {};
  if (kind === "work") extra.junk = JUNK.test(String(m.message || ""));
  return { item: { id: m.id, kind, reason: m.reason ?? null, name: m.name ?? null, email: m.email, message: m.message, createdAt: m.createdAt, status, ...extra } };
}

export async function setInboxStatus(id, status, admin) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error("invalid status"), { code: "bad_request" });
  const m = await col("contact-messages").findOne({ id }, { projection: { id: 1 } });
  if (!m) return null;
  await col("admin_inbox_status").updateOne({ id }, { $set: { id, status, updatedAt: Date.now(), updatedBy: admin.email } }, { upsert: true });
  await logAudit(admin.email, "inbox.status", id, { status });
  return { id, status };
}
