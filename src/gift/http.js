// Express response helpers — mirror the frontend's lib/server/http envelope.

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

function send(res, status, body) {
  res.set(NO_STORE);
  if (body === undefined || body === null) return res.status(status).end();
  return res.status(status).json(body);
}

export const ok = (res, body) => send(res, 200, body);
// For a GET whose body is the same for everyone (no user data, no auth check on the response) and
// changes rarely, e.g. a hardcoded topics/cities list: cache it at the edge and in the browser
// instead of forcing a fresh round trip on every page load. `ok()` stays no-store by default since
// most responses ARE per-user; this is opt-in per route.
export const okCacheable = (res, body, maxAgeS = 3600) => {
  res.set("Cache-Control", `public, max-age=${maxAgeS}, stale-while-revalidate=${maxAgeS * 24}`);
  return res.status(200).json(body);
};
export const created = (res, body) => send(res, 201, body);
export const noContent = (res) => send(res, 204, null);
export const badRequest = (res, message, details) =>
  send(res, 400, { error: "bad_request", message, ...(details ? { details } : {}) });
export const unauthorized = (res, message = "unauthorized") =>
  send(res, 401, { error: "unauthorized", message });
export const forbidden = (res, message = "forbidden") =>
  send(res, 403, { error: "forbidden", message });
export const notFound = (res, message = "not found") =>
  send(res, 404, { error: "not_found", message });
export const conflict = (res, message) =>
  send(res, 409, { error: "conflict", message });
export const tooMany = (res, message, details) =>
  send(res, 429, { error: "too_many_requests", message, ...(details ? { details } : {}) });
export const serverError = (res, err) => {
  console.error("[api]", err);
  send(res, 500, {
    error: "server_error",
    message: err instanceof Error ? err.message : "unknown",
  });
};

// Wrap an async handler so thrown errors become 500s (and UNAUTHORIZED → 401).
export const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err && err.message === "UNAUTHORIZED") return unauthorized(res);
    serverError(res, err);
  }
};
