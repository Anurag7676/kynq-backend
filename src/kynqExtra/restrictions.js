// What happens the moment an account is restricted (by an admin, or automatically
// after repeated reports): they're signed out everywhere, taken out of the matching
// queue, and any live call is ended. Nothing waits for their next request.
import { revokeSessionsForUser } from "../gift/session.js";

export async function enforceRestriction(userId) {
  const sessions = await revokeSessionsForUser(userId).catch((err) => { console.error("[restrict] couldn't revoke sessions for", userId, ":", err.message); return 0; });
  // Loaded lazily: signaling.js imports the route layer, which imports this file's callers.
  const { kickUser } = await import("./signaling.js");
  const kicked = await kickUser(userId).catch((err) => { console.error("[restrict] couldn't kick", userId, ":", err.message); return { sockets: 0 }; });
  console.log(`[restrict] enforced userId=${userId} sessionsRevoked=${sessions} liveSockets=${kicked.sockets}`);
  return { sessions, ...kicked };
}
