// "Right now": who is connected to the app this second. Reads in-memory counters only (no database), so it is cheap.
import { getLiveCounts } from "../kynqExtra/pulse.js";
import { queueDepth } from "../kynqExtra/matchmaker.js";

export function liveNow() {
  const { online, inCall, connections } = getLiveCounts();
  return { generatedAt: Date.now(), online, searching: queueDepth(), inCall, connections };
}
