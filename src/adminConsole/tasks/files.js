// Ticket attachments in S3 (same bucket as accounting, under tasks/). The raw request body is
// streamed up; downloads are 5-minute signed URLs, only for people who can see the ticket.
// Small files only (10 MB): screenshots, PDFs, docs.
import crypto from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { col } from "../util.js";
import { TaskError, bad, forbid } from "./team.js";
import { visibleTicket, canEdit, getTicket } from "./tickets.js";
import { TICKETS } from "./store.js";

const BUCKET = process.env.ACCOUNTING_BUCKET || process.env.DEMO_VIDEO_BUCKET || "kynq-extra-media";
const TYPES = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "text/plain": "txt", "text/csv": "csv" };
const MAX = 10 * 1024 * 1024, MAX_PER_TICKET = 20;
let s3client;
const s3 = () => (s3client ??= new S3Client({ region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "ap-south-1" }));

export async function uploadTicketFile(idOrKey, req, admin) {
  const t = await visibleTicket(idOrKey, admin);
  if (!canEdit(t, admin)) forbid("You can only attach files to tickets you're assigned to or created.");
  if ((t.attachments ?? []).length >= MAX_PER_TICKET) bad(`max ${MAX_PER_TICKET} files per ticket`);
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!TYPES[type]) bad("Attach a PDF, image, TXT or CSV file");
  const size = Number(req.headers["content-length"]);
  if (!Number.isFinite(size) || size <= 0) bad("The upload is missing its size");
  if (size > MAX) bad("Files can be up to 10 MB");
  const name = String(req.query.name || `file.${TYPES[type]}`).slice(0, 120).replace(/[^\w.\- ()]/g, "_");
  const key = `tasks/${t.key}/${crypto.randomBytes(6).toString("hex")}-${name}`;
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: req, ContentLength: size, ContentType: type }));
  const att = { key, name, type, size, by: admin.email, at: Date.now() };
  await col(TICKETS).updateOne({ id: t.id }, { $push: { attachments: att, history: { at: att.at, by: admin.email, type: "attachment", text: name } }, $set: { updatedAt: att.at }, $inc: { version: 1 } });
  return getTicket(t.id, admin);
}
export async function ticketFileUrl(idOrKey, key, admin) {
  const t = await visibleTicket(idOrKey, admin);
  if (!(t.attachments ?? []).some((a) => a.key === key)) throw new TaskError("file not found", "not_found");
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 300 });
}
