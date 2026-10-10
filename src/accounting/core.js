// Accounting for the admin console: bookkeeping, not a statutory ledger. The CA files from
// the exports. Covers:
//   • expenses (with vendor bills attached), other income
//   • subscriptions with renewal reminders (email + dashboard); "renew" books the expense
//   • invoices we send to clients (numbered, PDF), and invoice numbers for every paid Koin order
//   • a month-by-month overview (revenue, expenses, profit, burn, runway) and CSV exports
// Money is stored in rupees (2 decimals). GST stays off until settings.gstRegistered is true.
import crypto from "crypto";
import mongoose from "mongoose";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sendEmail } from "../config/emailConfig.js";

const col = (n) => mongoose.connection.collection(n);
export const C = {
  settings: "acct_settings", expenses: "acct_expenses", income: "acct_income", subs: "acct_subscriptions",
  clientInvoices: "acct_client_invoices", counters: "acct_counters", coinOrders: "coin_orders",
};
const id = (prefix) => `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const IST = 5.5 * 3600 * 1000;
export const todayIst = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class UserError extends Error {}
const bad = (m) => new UserError(m);

export const EXPENSE_CATEGORIES = ["Servers and hosting", "Software and tools", "Marketing and ads", "Salaries and contractors", "Merchandise", "Payment fees", "Legal and accounting", "Office and admin", "Travel", "Other"];
export const INCOME_CATEGORIES = ["Client work", "Sponsorship", "Grant", "Interest", "Other"];
export const PAYMENT_METHODS = ["card", "upi", "bank", "cash", "other"];
export const CYCLES = { monthly: 1, quarterly: 3, yearly: 12 };

let indexesReady = null;
export function ensureAccountingIndexes() {
  indexesReady ??= Promise.all([
    col(C.expenses).createIndex({ date: -1 }), col(C.expenses).createIndex({ category: 1, date: -1 }),
    col(C.income).createIndex({ date: -1 }), col(C.income).createIndex({ invoiceId: 1 }),
    col(C.subs).createIndex({ status: 1, nextRenewal: 1 }),
    col(C.clientInvoices).createIndex({ issueDate: -1 }), col(C.clientInvoices).createIndex({ number: 1 }, { unique: true }),
    col(C.coinOrders).createIndex({ invoiceNo: 1 }, { unique: true, partialFilterExpression: { invoiceNo: { $type: "string" } } }),
  ]).catch((err) => { indexesReady = null; throw err; });
  return indexesReady;
}
const strip = (d) => { if (!d) return d; const { _id, _key, ...rest } = d; return rest; };

// ─── validation helpers ───
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const optStr = (v, max = 200) => str(v, max) || null;
const date = (v, label) => { const s = str(v, 10); if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) throw bad(`${label} must be a date (YYYY-MM-DD)`); return s; };
const money = (v, label, { allowZero = false } = {}) => {
  const n = r2(v);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw bad(`${label} must be ${allowZero ? "0 or more" : "more than 0"}`);
  return n;
};
const oneOf = (v, list, label) => { if (!list.includes(v)) throw bad(`${label} must be one of: ${list.join(", ")}`); return v; };
const attachments = (list) => (Array.isArray(list) ? list : []).slice(0, 10).map((a) => {
  const key = str(a?.key, 300);
  if (!key.startsWith(ATTACH_PREFIX)) throw bad("attachment is invalid");
  return { key, name: str(a?.name, 120) || "file", type: str(a?.type, 60), size: Number(a?.size) || 0 };
});

// ─── settings ───
const DEFAULT_SETTINGS = {
  legalName: "", tradeName: "kynq", address: "", city: "", state: "", pincode: "", email: "hi@kynq.in", phone: "", pan: "",
  gstRegistered: false, gstin: "", gstRate: 18, sacCode: "998439",
  invoiceFooter: "Not registered under GST. This is a computer-generated invoice.",
  cashBalance: null, cashBalanceAsOf: null, reminderEmails: [],
};
export async function getSettings() {
  const doc = await col(C.settings).findOne({ _id: "settings" });
  return { ...DEFAULT_SETTINGS, ...(doc ? strip(doc) : {}) };
}
export async function saveSettings(body, adminEmail) {
  const cur = await getSettings();
  const next = { ...cur };
  for (const k of ["legalName", "tradeName", "address", "city", "state", "pincode", "email", "phone", "pan", "gstin", "sacCode", "invoiceFooter"]) {
    if (body[k] !== undefined) next[k] = str(body[k], k === "address" || k === "invoiceFooter" ? 400 : 120);
  }
  if (body.gstRegistered !== undefined) next.gstRegistered = !!body.gstRegistered;
  if (next.gstRegistered && !/^[0-9A-Z]{15}$/.test(next.gstin)) throw bad("GSTIN must be 15 letters/numbers when GST is on");
  if (body.gstRate !== undefined) next.gstRate = oneOf(Number(body.gstRate), [0, 5, 12, 18, 28], "GST rate");
  if (body.cashBalance !== undefined) next.cashBalance = body.cashBalance === null || body.cashBalance === "" ? null : r2(body.cashBalance);
  if (body.cashBalanceAsOf !== undefined) next.cashBalanceAsOf = body.cashBalanceAsOf ? date(body.cashBalanceAsOf, "Cash balance date") : null;
  if (body.reminderEmails !== undefined) {
    const list = (Array.isArray(body.reminderEmails) ? body.reminderEmails : String(body.reminderEmails).split(",")).map((e) => str(e, 120).toLowerCase()).filter(Boolean);
    if (list.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) throw bad("reminder emails must be valid addresses");
    next.reminderEmails = list.slice(0, 10);
  }
  next.updatedAt = Date.now(); next.updatedBy = adminEmail ?? null;
  await col(C.settings).updateOne({ _id: "settings" }, { $set: next }, { upsert: true });
  return next;
}

// ─── numbering (Indian financial year, April–March) ───
export const financialYear = (isoDate) => { const [y, m] = isoDate.split("-").map(Number); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };
async function nextSeq(series, fy) {
  const r = await col(C.counters).findOneAndUpdate({ _id: `${series}:${fy}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return (r?.value ?? r)?.seq;
}

/** Gives a paid Koin order its invoice number (KQ/2026-27/00001), once. Never throws into the payment path. */
export async function assignKoinInvoiceNumber(orderId) {
  try {
    await ensureAccountingIndexes();
    const o = await col(C.coinOrders).findOne({ id: orderId });
    if (!o || o.invoiceNo || !["paid", "refunded"].includes(o.status)) return o?.invoiceNo ?? null;
    const day = istDate(o.paidAt ?? o.updatedAt ?? Date.now());
    const fy = financialYear(day);
    const no = `KQ/${fy}/${String(await nextSeq("KQ", fy)).padStart(5, "0")}`;
    const r = await col(C.coinOrders).updateOne({ id: orderId, invoiceNo: { $exists: false } }, { $set: { invoiceNo: no, invoiceDate: day } });
    return r.modifiedCount ? no : (await col(C.coinOrders).findOne({ id: orderId }))?.invoiceNo ?? null;
  } catch (err) {
    console.error("[accounting] invoice number failed for", orderId, ":", err.message);
    return null;
  }
}
/** Numbers every past paid order that doesn't have one yet, oldest first. */
export async function backfillKoinInvoiceNumbers() {
  const rows = await col(C.coinOrders).find({ status: { $in: ["paid", "refunded"] }, invoiceNo: { $exists: false } }, { projection: { id: 1 } }).sort({ paidAt: 1 }).toArray();
  let n = 0;
  for (const r of rows) if (await assignKoinInvoiceNumber(r.id)) n += 1;
  return { numbered: n };
}

// ─── expenses and income ───
function cleanEntry(body, kind) {
  const cats = kind === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const out = {
    date: date(body.date, "Date"),
    category: oneOf(str(body.category, 60), cats, "Category"),
    description: optStr(body.description, 300),
    amountInr: money(body.amountInr, "Amount"),
    attachments: attachments(body.attachments),
  };
  if (kind === "expense") {
    out.vendor = str(body.vendor, 120); if (!out.vendor) throw bad("Vendor is required");
    out.gstInr = body.gstInr ? money(body.gstInr, "GST", { allowZero: true }) : 0;
    out.paymentMethod = oneOf(str(body.paymentMethod || "other", 20), PAYMENT_METHODS, "Payment method");
    out.paidBy = optStr(body.paidBy, 80);
    out.currency = str(body.currency || "INR", 3).toUpperCase();
    out.amountOriginal = body.amountOriginal ? money(body.amountOriginal, "Original amount") : null;
  } else {
    out.source = str(body.source, 120); if (!out.source) throw bad("Source is required");
  }
  return out;
}
const coll = (kind) => col(kind === "expense" ? C.expenses : C.income);

export async function createEntry(kind, body, adminEmail, extra = {}) {
  await ensureAccountingIndexes();
  const doc = { id: id(kind === "expense" ? "exp" : "inc"), ...cleanEntry(body, kind), ...extra, deleted: false, createdBy: adminEmail ?? null, createdAt: Date.now(), updatedAt: Date.now() };
  await coll(kind).insertOne(doc);
  return strip(doc);
}
export async function updateEntry(kind, entryId, body, adminEmail) {
  const cur = await coll(kind).findOne({ id: entryId, deleted: { $ne: true } });
  if (!cur) return null;
  if (cur.invoiceId) throw bad("This income comes from a client invoice. Change the invoice instead.");
  const next = { ...cleanEntry({ ...strip(cur), ...body }, kind), updatedAt: Date.now(), updatedBy: adminEmail ?? null };
  await coll(kind).updateOne({ id: entryId }, { $set: next });
  return strip(await coll(kind).findOne({ id: entryId }));
}
/** Soft delete: hidden everywhere, kept in the database (and in the audit log). */
export async function deleteEntry(kind, entryId, adminEmail) {
  const cur = await coll(kind).findOne({ id: entryId, deleted: { $ne: true } });
  if (!cur) return null;
  if (cur.invoiceId) throw bad("This income comes from a client invoice. Mark the invoice unpaid or void instead.");
  await coll(kind).updateOne({ id: entryId }, { $set: { deleted: true, deletedAt: Date.now(), deletedBy: adminEmail ?? null } });
  return { id: entryId, deleted: true };
}
export async function listEntries(kind, q = {}) {
  const match = { deleted: { $ne: true } };
  if (q.from || q.to) match.date = { ...(q.from ? { $gte: date(q.from, "From") } : {}), ...(q.to ? { $lte: date(q.to, "To") } : {}) };
  if (q.category) match.category = String(q.category);
  if (q.q) { const re = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 60), "i"); match.$or = [{ vendor: re }, { source: re }, { description: re }]; }
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50)), page = Math.max(1, Number(q.page) || 1);
  const [rows, total, sum] = await Promise.all([
    coll(kind).find(match).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    coll(kind).countDocuments(match),
    coll(kind).aggregate([{ $match: match }, { $group: { _id: null, amount: { $sum: "$amountInr" }, gst: { $sum: { $ifNull: ["$gstInr", 0] } } } }]).toArray(),
  ]);
  return { rows: rows.map(strip), total, page, limit, sumInr: r2(sum[0]?.amount), gstInr: r2(sum[0]?.gst), categories: kind === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES };
}

// ─── subscriptions ───
const addMonths = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
};
export const daysUntil = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayIst()}T00:00:00Z`)) / 86_400_000);

function cleanSub(body) {
  const out = {
    name: str(body.name, 100), vendor: str(body.vendor || body.name, 100),
    category: oneOf(str(body.category || "Software and tools", 60), EXPENSE_CATEGORIES, "Category"),
    amountInr: money(body.amountInr, "Amount (INR)"),
    currency: str(body.currency || "INR", 3).toUpperCase(),
    amountOriginal: body.amountOriginal ? money(body.amountOriginal, "Original amount") : null,
    cycle: oneOf(str(body.cycle || "monthly", 12), Object.keys(CYCLES), "Billing cycle"),
    nextRenewal: date(body.nextRenewal, "Next renewal"),
    autoRenew: body.autoRenew === undefined ? true : !!body.autoRenew,
    paymentMethod: oneOf(str(body.paymentMethod || "card", 20), PAYMENT_METHODS, "Payment method"),
    url: optStr(body.url, 300), notes: optStr(body.notes, 300),
    reminderDays: (Array.isArray(body.reminderDays) ? body.reminderDays : [7, 3, 1]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 60).slice(0, 5),
  };
  if (!out.name) throw bad("Name is required");
  return out;
}
export async function createSubscription(body, adminEmail) {
  await ensureAccountingIndexes();
  const doc = { id: id("sub"), ...cleanSub(body), status: "active", remindersSent: {}, createdBy: adminEmail ?? null, createdAt: Date.now(), updatedAt: Date.now() };
  await col(C.subs).insertOne(doc);
  return strip(doc);
}
export async function updateSubscription(subId, body) {
  const cur = await col(C.subs).findOne({ id: subId });
  if (!cur) return null;
  const next = { ...cleanSub({ ...strip(cur), ...body }), updatedAt: Date.now() };
  if (body.status !== undefined) next.status = oneOf(body.status, ["active", "cancelled"], "Status");
  await col(C.subs).updateOne({ id: subId }, { $set: next });
  return strip(await col(C.subs).findOne({ id: subId }));
}
/** Paid this renewal: books it as an expense and moves the renewal date on by one cycle. */
export async function renewSubscription(subId, body, adminEmail) {
  const s = await col(C.subs).findOne({ id: subId });
  if (!s) return null;
  if (s.status !== "active") throw bad("This subscription is cancelled");
  const amountInr = body.amountInr !== undefined && body.amountInr !== "" ? money(body.amountInr, "Amount") : s.amountInr;
  const expense = await createEntry("expense", {
    date: body.date || todayIst(), vendor: s.vendor, category: s.category, description: `${s.name} (${s.cycle} renewal due ${s.nextRenewal})`,
    amountInr, paymentMethod: body.paymentMethod || s.paymentMethod, currency: s.currency, amountOriginal: s.amountOriginal, attachments: body.attachments,
  }, adminEmail, { subscriptionId: s.id });
  const nextRenewal = addMonths(s.nextRenewal, CYCLES[s.cycle]);
  await col(C.subs).updateOne({ id: subId }, { $set: { nextRenewal, lastPaidAt: Date.now(), updatedAt: Date.now() } });
  return { subscription: strip(await col(C.subs).findOne({ id: subId })), expense };
}
export async function listSubscriptions() {
  const rows = (await col(C.subs).find({}).sort({ status: 1, nextRenewal: 1 }).toArray()).map(strip)
    .map((s) => ({ ...s, daysUntil: s.status === "active" ? daysUntil(s.nextRenewal) : null }));
  const active = rows.filter((s) => s.status === "active");
  const monthly = active.reduce((n, s) => n + s.amountInr / CYCLES[s.cycle], 0);
  return { rows, monthlyInr: r2(monthly), yearlyInr: r2(monthly * 12), dueSoon: active.filter((s) => s.daysUntil <= 7).length, overdue: active.filter((s) => s.daysUntil < 0).length };
}

// ─── client invoices ───
function cleanInvoice(body, settings) {
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 30).map((it) => ({
    description: str(it?.description, 200), qty: Number(it?.qty) > 0 ? r2(it.qty) : 1, rate: money(it?.rate, "Item rate", { allowZero: true }),
  })).filter((it) => it.description);
  if (!items.length) throw bad("Add at least one item");
  const client = { name: str(body.client?.name, 120), email: optStr(body.client?.email, 120), address: optStr(body.client?.address, 400), gstin: optStr(body.client?.gstin, 15) };
  if (!client.name) throw bad("Client name is required");
  const subtotal = r2(items.reduce((n, it) => n + it.qty * it.rate, 0));
  const gstRate = settings.gstRegistered ? Number(settings.gstRate) || 0 : 0;
  const gst = r2(subtotal * gstRate / 100);
  const issueDate = date(body.issueDate || todayIst(), "Issue date");
  const dueDate = body.dueDate ? date(body.dueDate, "Due date") : null;
  if (dueDate && dueDate < issueDate) throw bad("Due date can't be before the issue date");
  return { client, items, notes: optStr(body.notes, 500), issueDate, dueDate, subtotal, gstRate, gst, total: r2(subtotal + gst) };
}
export async function createClientInvoice(body, adminEmail) {
  await ensureAccountingIndexes();
  const settings = await getSettings();
  const clean = cleanInvoice(body, settings);
  const fy = financialYear(clean.issueDate);
  const number = `KQB/${fy}/${String(await nextSeq("KQB", fy)).padStart(4, "0")}`;
  const doc = { id: id("cinv"), number, status: "sent", ...clean, paidAt: null, paidDate: null, createdBy: adminEmail ?? null, createdAt: Date.now(), updatedAt: Date.now() };
  await col(C.clientInvoices).insertOne(doc);
  return strip(doc);
}
export async function updateClientInvoice(invId, body) {
  const cur = await col(C.clientInvoices).findOne({ id: invId });
  if (!cur) return null;
  if (cur.status !== "sent") throw bad("Only unpaid invoices can be edited");
  const settings = await getSettings();
  const next = { ...cleanInvoice({ ...strip(cur), ...body, client: { ...cur.client, ...(body.client || {}) } }, settings), updatedAt: Date.now() };
  if (financialYear(next.issueDate) !== financialYear(cur.issueDate)) throw bad("Issue date can't move to another financial year (it would break numbering)");
  await col(C.clientInvoices).updateOne({ id: invId }, { $set: next });
  return strip(await col(C.clientInvoices).findOne({ id: invId }));
}
/** sent ⇄ paid, or void. Paid books the money as income; unpaid/void removes that entry. */
export async function setClientInvoiceStatus(invId, body, adminEmail) {
  const cur = await col(C.clientInvoices).findOne({ id: invId });
  if (!cur) return null;
  const status = oneOf(body.status, ["sent", "paid", "void"], "Status");
  if (cur.status === "void") throw bad("A void invoice can't be changed");
  const set = { status, updatedAt: Date.now() };
  if (status === "paid") {
    set.paidDate = date(body.paidDate || todayIst(), "Paid date"); set.paidAt = Date.now();
    await col(C.income).updateMany({ invoiceId: invId, deleted: { $ne: true } }, { $set: { deleted: true, deletedAt: Date.now() } });
    await createEntry("income", { date: set.paidDate, source: cur.client.name, category: "Client work", description: `Invoice ${cur.number}`, amountInr: cur.total }, adminEmail, { invoiceId: invId });
  } else {
    set.paidDate = null; set.paidAt = null;
    await col(C.income).updateMany({ invoiceId: invId, deleted: { $ne: true } }, { $set: { deleted: true, deletedAt: Date.now(), deletedBy: adminEmail ?? null } });
  }
  await col(C.clientInvoices).updateOne({ id: invId }, { $set: set });
  return strip(await col(C.clientInvoices).findOne({ id: invId }));
}
export async function listClientInvoices(q = {}) {
  const rows = (await col(C.clientInvoices).find(q.status ? { status: q.status } : {}).sort({ issueDate: -1, createdAt: -1 }).limit(300).toArray()).map(strip);
  const today = todayIst();
  const withState = rows.map((r) => ({ ...r, overdue: r.status === "sent" && !!r.dueDate && r.dueDate < today }));
  const sum = (f) => r2(withState.filter(f).reduce((n, r) => n + r.total, 0));
  return { rows: withState, outstandingInr: sum((r) => r.status === "sent"), overdueInr: sum((r) => r.overdue), paidInr: sum((r) => r.status === "paid") };
}
export const getClientInvoice = async (invId) => strip(await col(C.clientInvoices).findOne({ id: invId }));

// ─── Koin invoices (one per paid order) ───
export async function listKoinInvoices(q = {}) {
  const match = { status: { $in: ["paid", "refunded"] }, invoiceNo: { $exists: true } };
  if (q.from || q.to) match.invoiceDate = { ...(q.from ? { $gte: date(q.from, "From") } : {}), ...(q.to ? { $lte: date(q.to, "To") } : {}) };
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50)), page = Math.max(1, Number(q.page) || 1);
  const [rows, total, unnumbered, sum] = await Promise.all([
    col(C.coinOrders).find(match).sort({ invoiceNo: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col(C.coinOrders).countDocuments(match),
    col(C.coinOrders).countDocuments({ status: { $in: ["paid", "refunded"] }, invoiceNo: { $exists: false } }),
    col(C.coinOrders).aggregate([{ $match: match }, { $group: { _id: null, amount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } } } }]).toArray(),
  ]);
  const users = new Map((await col("users").find({ id: { $in: rows.map((r) => r.userId) } }, { projection: { id: 1, name: 1, email: 1 } }).toArray()).map((u) => [u.id, u]));
  return {
    rows: rows.map((o) => ({ orderId: o.id, invoiceNo: o.invoiceNo, invoiceDate: o.invoiceDate, user: { id: o.userId, name: users.get(o.userId)?.name || users.get(o.userId)?.email?.split("@")[0] || "Unknown" }, coins: o.coins, amountInr: o.amount, status: o.status })),
    total, page, limit, unnumbered, sumInr: r2(sum[0]?.amount),
  };
}
export async function getKoinInvoiceData(orderId, { userId } = {}) {
  const o = await col(C.coinOrders).findOne({ id: orderId });
  if (!o || !["paid", "refunded"].includes(o.status) || (userId && o.userId !== userId)) return null;
  const invoiceNo = o.invoiceNo || (await assignKoinInvoiceNumber(o.id));
  const fresh = invoiceNo === o.invoiceNo ? o : await col(C.coinOrders).findOne({ id: orderId });
  const u = await col("users").findOne({ id: o.userId }, { projection: { name: 1, email: 1 } });
  return { order: strip(fresh), buyer: { name: u?.name || "", email: u?.email || "", phone: o.phone || null }, settings: await getSettings() };
}

// ─── attachments (vendor bills, receipts) in S3 ───
const BUCKET = process.env.ACCOUNTING_BUCKET || process.env.DEMO_VIDEO_BUCKET || "kynq-extra-media";
export const ATTACH_PREFIX = "accounting/";
const ATTACH_TYPES = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_ATTACH = 10 * 1024 * 1024;
let s3client;
const s3 = () => (s3client ??= new S3Client({ region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "ap-south-1" }));

/** Streams the raw request body (a PDF or image) to S3 under accounting/. */
export async function uploadAttachment(req) {
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!ATTACH_TYPES[type]) throw bad("Upload a PDF, PNG, JPG or WebP file");
  const size = Number(req.headers["content-length"]);
  if (!Number.isFinite(size) || size <= 0) throw bad("The upload is missing its size");
  if (size > MAX_ATTACH) throw bad("Files can be up to 10 MB");
  const name = str(req.query.name, 120).replace(/[^\w.\- ()]/g, "_") || `file.${ATTACH_TYPES[type]}`;
  const key = `${ATTACH_PREFIX}${istDate(Date.now()).slice(0, 7)}/${crypto.randomBytes(8).toString("hex")}-${name}`;
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: req, ContentLength: size, ContentType: type }));
  return { key, name, type, size };
}
export async function attachmentUrl(key) {
  const k = str(key, 300);
  if (!k.startsWith(ATTACH_PREFIX) || k.includes("..")) throw bad("That file isn't an accounting attachment");
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: k }), { expiresIn: 300 });
}

// ─── overview ───
const monthOf = (iso) => iso.slice(0, 7);
function lastMonths(n) {
  const out = []; const t = todayIst(); let [y, m] = t.split("-").map(Number);
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, "0")}`); m -= 1; if (m === 0) { m = 12; y -= 1; } }
  return out;
}
export async function overview({ months = 12, excludedUserIds = [] } = {}) {
  await ensureAccountingIndexes();
  const keys = lastMonths(Math.min(24, Math.max(3, Number(months) || 12)));
  const fromIso = `${keys[0]}-01`;
  const fromMs = Date.parse(`${fromIso}T00:00:00+05:30`);
  const real = { userId: { $nin: excludedUserIds } };
  const monthExpr = (f) => ({ $dateToString: { format: "%Y-%m", date: { $toDate: f }, timezone: "Asia/Kolkata" } });
  const [koin, refunds, income, expenses, byCat, topVendors, settings, subs, invoices] = await Promise.all([
    col(C.coinOrders).aggregate([{ $match: { ...real, status: { $in: ["paid", "refunded"] }, paidAt: { $gte: fromMs } } }, { $group: { _id: monthExpr("$paidAt"), inr: { $sum: "$amount" }, orders: { $sum: 1 } } }]).toArray(),
    col(C.coinOrders).aggregate([{ $match: { ...real, status: "refunded", refundedAt: { $gte: fromMs } } }, { $group: { _id: monthExpr("$refundedAt"), inr: { $sum: "$amount" } } }]).toArray(),
    col(C.income).aggregate([{ $match: { deleted: { $ne: true }, date: { $gte: fromIso } } }, { $group: { _id: { $substrBytes: ["$date", 0, 7] }, inr: { $sum: "$amountInr" } } }]).toArray(),
    col(C.expenses).aggregate([{ $match: { deleted: { $ne: true }, date: { $gte: fromIso } } }, { $group: { _id: { $substrBytes: ["$date", 0, 7] }, inr: { $sum: "$amountInr" }, gst: { $sum: { $ifNull: ["$gstInr", 0] } } } }]).toArray(),
    col(C.expenses).aggregate([{ $match: { deleted: { $ne: true }, date: { $gte: fromIso } } }, { $group: { _id: "$category", inr: { $sum: "$amountInr" } } }, { $sort: { inr: -1 } }]).toArray(),
    col(C.expenses).aggregate([{ $match: { deleted: { $ne: true }, date: { $gte: fromIso } } }, { $group: { _id: "$vendor", inr: { $sum: "$amountInr" }, n: { $sum: 1 } } }, { $sort: { inr: -1 } }, { $limit: 8 }]).toArray(),
    getSettings(), listSubscriptions(), listClientInvoices(),
  ]);
  const by = (rows) => new Map(rows.map((r) => [r._id, r]));
  const K = by(koin), R = by(refunds), I = by(income), E = by(expenses);
  const series = keys.map((m) => {
    const koinRevenue = r2(K.get(m)?.inr), refundsInr = r2(R.get(m)?.inr), otherIncome = r2(I.get(m)?.inr), exp = r2(E.get(m)?.inr);
    return { month: m, koinRevenue, refunds: refundsInr, otherIncome, income: r2(koinRevenue - refundsInr + otherIncome), expenses: exp, profit: r2(koinRevenue - refundsInr + otherIncome - exp) };
  });
  const cur = series[series.length - 1], prev = series[series.length - 2];
  // Burn = average net loss over the last 3 complete months (0 if profitable).
  const complete = series.slice(-4, -1);
  const burn = r2(Math.max(0, -complete.reduce((n, s) => n + s.profit, 0) / Math.max(1, complete.length)));
  let cash = null;
  if (settings.cashBalance != null && settings.cashBalanceAsOf) {
    const asOf = settings.cashBalanceAsOf, asOfMs = Date.parse(`${asOf}T23:59:59+05:30`);
    const [k, rf, inc, ex] = await Promise.all([
      col(C.coinOrders).aggregate([{ $match: { ...real, status: { $in: ["paid", "refunded"] }, paidAt: { $gt: asOfMs } } }, { $group: { _id: null, s: { $sum: "$amount" } } }]).toArray(),
      col(C.coinOrders).aggregate([{ $match: { ...real, status: "refunded", refundedAt: { $gt: asOfMs } } }, { $group: { _id: null, s: { $sum: "$amount" } } }]).toArray(),
      col(C.income).aggregate([{ $match: { deleted: { $ne: true }, date: { $gt: asOf } } }, { $group: { _id: null, s: { $sum: "$amountInr" } } }]).toArray(),
      col(C.expenses).aggregate([{ $match: { deleted: { $ne: true }, date: { $gt: asOf } } }, { $group: { _id: null, s: { $sum: "$amountInr" } } }]).toArray(),
    ]);
    cash = r2(settings.cashBalance + (k[0]?.s ?? 0) - (rf[0]?.s ?? 0) + (inc[0]?.s ?? 0) - (ex[0]?.s ?? 0));
  }
  const fy = financialYear(todayIst()), fyStart = `${fy.slice(0, 4)}-04`;
  const fyRows = series.filter((s) => s.month >= fyStart);
  const fySum = (f) => r2(fyRows.reduce((n, s) => n + s[f], 0));
  return {
    months: series,
    thisMonth: cur, lastMonth: prev,
    financialYear: { label: `FY ${fy}`, income: fySum("income"), expenses: fySum("expenses"), profit: fySum("profit"), complete: fyRows.length === 0 || fyRows[0].month === fyStart },
    burnInr: burn, cashInr: cash, cashAsOf: settings.cashBalanceAsOf, runwayMonths: cash != null && burn > 0 ? Math.round((cash / burn) * 10) / 10 : null,
    expensesByCategory: byCat.map((r) => ({ category: r._id, inr: r2(r.inr) })),
    topVendors: topVendors.map((r) => ({ vendor: r._id, inr: r2(r.inr), count: r.n })),
    subscriptions: { monthlyInr: subs.monthlyInr, yearlyInr: subs.yearlyInr, upcoming: subs.rows.filter((s) => s.status === "active" && s.daysUntil <= 30).slice(0, 8), overdue: subs.overdue },
    invoices: { outstandingInr: invoices.outstandingInr, overdueInr: invoices.overdueInr, overdue: invoices.rows.filter((r) => r.overdue).slice(0, 8) },
    gst: settings.gstRegistered ? { inputInr: r2(expenses.reduce((n, r) => n + (r.gst || 0), 0)) } : null,
    notes: [
      "Koin revenue is paid Koin orders from real users (test and demo accounts excluded); refunds are subtracted in the month they happened.",
      "Burn is your average monthly loss over the last 3 complete months. Runway needs a cash balance in Settings.",
      "This is bookkeeping for running the business. Your CA files returns from the exports.",
    ],
  };
}

// ─── CSV exports for the CA ───
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (head, rows) => "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
export async function exportCsv(type, q = {}, { excludedUserIds = [] } = {}) {
  const from = q.from ? date(q.from, "From") : "2000-01-01", to = q.to ? date(q.to, "To") : "2999-12-31";
  const fromMs = Date.parse(`${from}T00:00:00+05:30`), toMs = Date.parse(`${to}T23:59:59+05:30`);
  if (type === "expenses") {
    const rows = await col(C.expenses).find({ deleted: { $ne: true }, date: { $gte: from, $lte: to } }).sort({ date: 1 }).toArray();
    return csv(["Date", "Vendor", "Category", "Description", "Amount (INR)", "GST (INR)", "Original amount", "Currency", "Payment method", "Paid by", "Bills attached"],
      rows.map((r) => [r.date, r.vendor, r.category, r.description, r.amountInr, r.gstInr ?? 0, r.amountOriginal ?? "", r.currency, r.paymentMethod, r.paidBy, (r.attachments || []).length]));
  }
  if (type === "income") {
    const rows = await col(C.income).find({ deleted: { $ne: true }, date: { $gte: from, $lte: to } }).sort({ date: 1 }).toArray();
    return csv(["Date", "Source", "Category", "Description", "Amount (INR)"], rows.map((r) => [r.date, r.source, r.category, r.description, r.amountInr]));
  }
  if (type === "koin-invoices") {
    const rows = await col(C.coinOrders).find({ status: { $in: ["paid", "refunded"] }, invoiceNo: { $exists: true }, invoiceDate: { $gte: from, $lte: to } }).sort({ invoiceNo: 1 }).toArray();
    return csv(["Invoice no", "Date", "Order id", "Koins", "Amount (INR)", "Status", "Test/demo account"], rows.map((o) => [o.invoiceNo, o.invoiceDate, o.id, o.coins, o.amount, o.status, excludedUserIds.includes(o.userId) ? "yes" : ""]));
  }
  if (type === "client-invoices") {
    const rows = await col(C.clientInvoices).find({ issueDate: { $gte: from, $lte: to } }).sort({ number: 1 }).toArray();
    return csv(["Invoice no", "Issue date", "Due date", "Client", "Client GSTIN", "Subtotal (INR)", "GST (INR)", "Total (INR)", "Status", "Paid date"], rows.map((r) => [r.number, r.issueDate, r.dueDate, r.client?.name, r.client?.gstin, r.subtotal, r.gst, r.total, r.status, r.paidDate]));
  }
  if (type === "ledger") {
    const [koin, refunds, income, expenses] = await Promise.all([
      col(C.coinOrders).find({ userId: { $nin: excludedUserIds }, status: { $in: ["paid", "refunded"] }, paidAt: { $gte: fromMs, $lte: toMs } }).toArray(),
      col(C.coinOrders).find({ userId: { $nin: excludedUserIds }, status: "refunded", refundedAt: { $gte: fromMs, $lte: toMs } }).toArray(),
      col(C.income).find({ deleted: { $ne: true }, date: { $gte: from, $lte: to } }).toArray(),
      col(C.expenses).find({ deleted: { $ne: true }, date: { $gte: from, $lte: to } }).toArray(),
    ]);
    const lines = [
      ...koin.map((o) => [istDate(o.paidAt), "Income", "Koin sale", "Koin purchases", `${o.coins} Koins`, o.amount, "", o.invoiceNo || o.id]),
      ...refunds.map((o) => [istDate(o.refundedAt), "Refund", "Koin sale", "Koin purchases", `Refund of ${o.coins} Koins`, "", o.amount, o.invoiceNo || o.id]),
      ...income.map((r) => [r.date, "Income", r.category, r.source, r.description, r.amountInr, "", ""]),
      ...expenses.map((r) => [r.date, "Expense", r.category, r.vendor, r.description, "", r.amountInr, (r.attachments || []).length ? "bill attached" : ""]),
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return csv(["Date", "Type", "Category", "Party", "Description", "Money in (INR)", "Money out (INR)", "Document"], lines);
  }
  throw bad("Unknown export type");
}

// ─── renewal reminders (email + dashboard) ───
const inr = (n) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)}`;
async function reminderRecipients() {
  const s = await getSettings();
  if (s.reminderEmails?.length) return s.reminderEmails;
  return String(process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
}
/** One pass: emails each subscription reminder once per (renewal date, day mark), plus a daily nudge when overdue. */
export async function runRenewalReminders({ send = sendEmail } = {}) {
  await ensureAccountingIndexes();
  const to = await reminderRecipients();
  if (!to.length) return { sent: 0, reason: "no recipients" };
  const today = todayIst();
  const subs = await col(C.subs).find({ status: "active" }).toArray();
  let sent = 0;
  for (const s of subs) {
    const d = daysUntil(s.nextRenewal);
    const mark = d < 0 ? `${s.nextRenewal}:overdue:${today}` : (s.reminderDays || [7, 3, 1]).includes(d) || d === 0 ? `${s.nextRenewal}:${d}` : null;
    if (!mark || s.remindersSent?.[mark]) continue;
    const when = d < 0 ? `was due ${-d} day${d === -1 ? "" : "s"} ago (${s.nextRenewal})` : d === 0 ? "renews today" : `renews in ${d} day${d === 1 ? "" : "s"} (${s.nextRenewal})`;
    const subject = `${s.name} ${d < 0 ? "renewal overdue" : when.split(" (")[0]} · ${inr(s.amountInr)}`;
    const text = `${s.name} ${when}.\nAmount: ${inr(s.amountInr)}${s.currency !== "INR" && s.amountOriginal ? ` (${s.currency} ${s.amountOriginal})` : ""} · ${s.cycle}\nPaid by: ${s.paymentMethod}${s.autoRenew ? " (auto-renews)" : " (does NOT auto-renew; pay it manually)"}\n${s.url ? `Billing page: ${s.url}\n` : ""}\nWhen it's paid, open Admin → Accounts → Subscriptions and press "Mark paid" so it's recorded as an expense.`;
    try {
      await send({ to: to.join(","), subject, text, html: `<p><b>${s.name}</b> ${when}.</p><p>Amount: <b>${inr(s.amountInr)}</b> · ${s.cycle}${s.autoRenew ? " · auto-renews" : " · <b>does not auto-renew</b>"}</p>${s.url ? `<p><a href="${s.url}">Billing page</a></p>` : ""}<p>When it's paid, open Admin → Accounts → Subscriptions and press <b>Mark paid</b>.</p>` });
      await col(C.subs).updateOne({ id: s.id }, { $set: { [`remindersSent.${mark}`]: Date.now() } });
      sent += 1;
    } catch (err) {
      console.error("[accounting] reminder email failed for", s.name, ":", err.message);
    }
  }
  return { sent };
}
let reminderTimer = null;
export function startRenewalReminders() {
  if (reminderTimer || process.env.ACCOUNTING_REMINDERS === "off") return;
  const tick = () => runRenewalReminders().then((r) => r.sent && console.log(`[accounting] sent ${r.sent} renewal reminder(s)`)).catch((err) => console.error("[accounting] reminders failed:", err.message));
  setTimeout(tick, 60_000);
  reminderTimer = setInterval(tick, 60 * 60 * 1000);
  reminderTimer.unref?.();
}
