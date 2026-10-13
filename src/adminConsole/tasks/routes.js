// /api/console/tasks/* — every signed-in console admin (owner or any subadmin) can use Tasks;
// what each person can see and change is decided per ticket in tickets.js. Errors carry a code
// (forbidden / not_found / conflict / rate_limited / bad_request) mapped to HTTP here.
import express from "express";
import { roster, rateLimit, isOwner } from "./team.js";
import * as tk from "./tickets.js";
import * as nt from "./notify.js";
import { uploadTicketFile, ticketFileUrl } from "./files.js";

const STATUS = { forbidden: 403, not_found: 404, conflict: 409, rate_limited: 429, bad_request: 400 };
const fail = (res, status, code, message) => res.set("Cache-Control", "no-store").status(status).json({ error: code, message });
const handle = (fn) => async (req, res) => {
  try { res.set("Cache-Control", "no-store").json(await fn(req, res)); }
  catch (err) {
    const status = STATUS[err.code];
    if (!status) console.error("[tasks]", req.method, req.path, err);
    fail(res, status ?? 500, status ? err.code : "server_error", status ? err.message : "Something went wrong");
  }
};
// Writes: 90 a minute per person (a bulk edit counts once); imports: 20 an hour.
const limit = (prefix, max, ms) => (req, res, next) => { try { rateLimit(`${prefix}:${req.admin.email}`, max, ms); next(); } catch (e) { fail(res, 429, "rate_limited", e.message); } };
const writes = limit("w", 90, 60_000);
const imports = limit("i", 20, 3_600_000);

export const tasksRouter = express.Router();
tasksRouter.get("/me", handle(async (req) => ({ email: req.admin.email, isOwner: isOwner(req.admin), unread: await nt.unreadCount(req.admin) })));
tasksRouter.get("/team", handle(async () => ({ members: await roster() })));
tasksRouter.get("/overview", handle((req) => tk.overview(req.admin)));

tasksRouter.get("/tickets", handle((req) => tk.listTickets(req.query, req.admin)));
tasksRouter.post("/tickets", writes, handle(async (req) => ({ ticket: await tk.createTicket(req.body, req.admin) })));
tasksRouter.post("/tickets/bulk", writes, handle((req) => tk.bulkUpdate(req.body, req.admin)));
tasksRouter.post("/tickets/bulk-delete", writes, handle((req) => tk.bulkDelete(req.body, req.admin)));
tasksRouter.get("/tickets/import/template", handle(() => ({ example: tk.IMPORT_EXAMPLE, limits: tk.IMPORT_LIMITS })));
tasksRouter.post("/tickets/import/preview", imports, handle((req) => tk.previewImport(req.body, req.admin)));
tasksRouter.post("/tickets/import", imports, handle((req) => tk.commitImport(req.body, req.admin)));
tasksRouter.get("/tickets/:id", handle(async (req) => ({ ticket: await tk.getTicket(req.params.id, req.admin) })));
tasksRouter.post("/tickets/:id", writes, handle(async (req) => ({ ticket: await tk.updateTicket(req.params.id, req.body, req.admin) })));
tasksRouter.post("/tickets/:id/delete", writes, handle((req) => tk.deleteTicket(req.params.id, req.admin)));
tasksRouter.post("/tickets/:id/comments", writes, handle(async (req) => ({ comment: await tk.addComment(req.params.id, req.body, req.admin) })));
tasksRouter.post("/tickets/:id/attachments", writes, handle(async (req) => ({ ticket: await uploadTicketFile(req.params.id, req, req.admin) })));
tasksRouter.get("/tickets/:id/attachments/url", handle(async (req) => ({ url: await ticketFileUrl(req.params.id, String(req.query.key ?? ""), req.admin) })));
tasksRouter.post("/comments/:id", writes, handle(async (req) => ({ comment: await tk.editComment(req.params.id, req.body, req.admin) })));
tasksRouter.post("/comments/:id/delete", writes, handle((req) => tk.deleteComment(req.params.id, req.admin)));

tasksRouter.get("/notifications", handle((req) => nt.listNotifications(req.admin, { limit: req.query.limit, before: req.query.before, unread: req.query.unread === "1" })));
tasksRouter.post("/notifications/read", handle((req) => nt.markRead(req.admin, req.body?.ids === "all" ? "all" : req.body?.ids)));
