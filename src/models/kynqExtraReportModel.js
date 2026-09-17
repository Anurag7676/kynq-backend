// Kynq Extra reports — a real Mongoose model, unlike the rest of Kynq
// Extra's data (calls/game_sessions/blocks use the lightweight
// collection() key-value store). Admin moderation needs indexed queries
// (by status, by reported user, by date) that a full-collection scan
// can't do efficiently once report volume grows — see the plan's
// data-model section.
import mongoose from "mongoose";

const kynqExtraReportSchema = new mongoose.Schema(
  {
    reporterScopedId: { type: String, required: true, index: true },
    reportedScopedId: { type: String, required: true, index: true },
    callId: { type: String, required: true },
    reason: {
      type: String,
      required: true,
      enum: ["nudity", "harassment", "minor", "spam", "hate_speech", "other"],
    },
    note: { type: String, maxlength: 500 },
    status: {
      type: String,
      enum: ["open", "reviewed", "actioned"],
      default: "open",
      index: true,
    },
    actionTaken: { type: String, enum: ["none", "warning", "restricted", "banned"], default: "none" },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

kynqExtraReportSchema.index({ reportedScopedId: 1, status: 1 });

const KynqExtraReport = mongoose.model("KynqExtraReport", kynqExtraReportSchema);
export default KynqExtraReport;
