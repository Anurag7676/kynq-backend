// Collections, constants and date helpers shared by the Tasks module.
// Ticket collections keep their old Founder OS names so any existing tasks carry over.
export const TICKETS = "fos_tasks";
export const COMMENTS = "fos_comments";
export const COUNTERS = "fos_counters";
export const IMPORTS = "fos_imports";
export const NOTIFICATIONS = "task_notifications";
export const DIGESTS = "task_digests";

export const STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"];
export const OPEN_STATUSES = ["backlog", "todo", "in_progress", "in_review"];
export const PRIORITIES = ["urgent", "high", "medium", "low"];
export const KEY_PREFIX = "KYNQ";
export const DAY = 86_400_000;

// The team's timezone, as a fixed offset (India has no DST). TASKS_TZ_OFFSET_MIN overrides it.
const TZ = (Number(process.env.TASKS_TZ_OFFSET_MIN) || 330) * 60_000;
export const today = (ts = Date.now()) => new Date(ts + TZ).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const localHourMin = (ts = Date.now()) => new Date(ts + TZ).toISOString().slice(11, 16);
/** Monday of the current local week, as a timestamp. */
export function weekStartTs(ts = Date.now()) {
  const d = new Date(`${today(ts)}T00:00:00Z`);
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY - TZ;
}

export const strip = ({ _id, ...rest }) => rest;
export const adminUrl = () => (process.env.TASKS_ADMIN_URL || "https://admin.kynq.in").replace(/\/$/, "");
export const ticketUrl = (key) => `${adminUrl()}/tasks/all/?id=${encodeURIComponent(key)}`;
