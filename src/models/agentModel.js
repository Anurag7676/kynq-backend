import mongoose from "mongoose";

const agentSchema = new mongoose.Schema(
  {
    agentCode: {
      type: String,
      required: [true, "Agent code is required"],
      unique: true,
      trim: true,
    },
    mlmAgentId: {
      type: String,
      trim: true,
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    displayName: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      default: "active",
      trim: true,
    },
    parentAgentCode: {
      type: String,
      trim: true,
    },
    registeredAt: {
      type: Date,
    },
    lastSyncedAt: {
      type: Date,
      default: Date.now,
    },
    lastEventId: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    sourcePayload: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

agentSchema.index({ agentCode: 1 }, { unique: true });
agentSchema.index({ parentAgentCode: 1 });

const Agent = mongoose.model("Agent", agentSchema);

export default Agent;

