import dotenv from "dotenv";
import app from "./app.js";
import connectDB from "./config/dbconnection.js";
import { initSignaling } from "./kynqExtra/signaling.js";
import { startRenewalReminders } from "./accounting/core.js";
import { startAmbassadorAutoApprovals } from "./kynqExtra/ambassadorAutoApprove.js";
import { stopMatchmaker } from "./kynqExtra/matchmaker.js";

dotenv.config();

connectDB();

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Kynq Extra's Socket.io server mounts on the same persistent HTTP server —
// see the plan's realtime-signaling decision (no separate process/service).
initSignaling(server);
startRenewalReminders(); // hourly: subscription renewal emails to admins
startAmbassadorAutoApprovals(); // every 5 min: female applicants approved 1 hour after applying

const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully…`);
  stopMatchmaker();
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forced shutdown — timed out waiting for connections.");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (err) => {
  console.error(`Unhandled rejection: ${err.message}`);
  shutdown("unhandledRejection");
});

process.on("uncaughtException", (err) => {
  console.error(`Uncaught exception: ${err.message}`);
  shutdown("uncaughtException");
});
