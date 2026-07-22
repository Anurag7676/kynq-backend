import Agent from "../models/agentModel.js";

const REQUIRED_FIELDS = ["agentCode"];

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : value;

export const handleAgentRegistration = async (req, res) => {
  try {
    const missingField = REQUIRED_FIELDS.find((field) => !req.body[field]);
    if (missingField) {
      return res.status(400).json({
        success: false,
        message: `${missingField} is required`,
      });
    }

    const agentPayload = {
      agentCode: normalizeString(req.body.agentCode),
      mlmAgentId: normalizeString(req.body.mlmAgentId),
      firstName: normalizeString(req.body.firstName),
      lastName: normalizeString(req.body.lastName),
      displayName: normalizeString(
        req.body.displayName ||
          [req.body.firstName, req.body.lastName].filter(Boolean).join(" ")
      ),
      email: normalizeString(req.body.email),
      phone: normalizeString(req.body.phone),
      status: normalizeString(req.body.status) || "active",
      parentAgentCode: normalizeString(req.body.parentAgentCode),
      registeredAt: req.body.registeredAt
        ? new Date(req.body.registeredAt)
        : undefined,
      lastSyncedAt: new Date(),
      lastEventId: normalizeString(req.body.eventId),
      metadata: req.body.metadata ?? undefined,
      sourcePayload: req.body,
    };

    Object.keys(agentPayload).forEach((key) => {
      if (agentPayload[key] === undefined || agentPayload[key] === null) {
        delete agentPayload[key];
      }
    });

    const result = await Agent.findOneAndUpdate(
      { agentCode: agentPayload.agentCode },
      { $set: agentPayload },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    const statusCode = result.createdAt && result.createdAt === result.updatedAt ? 201 : 200;

    return res.status(statusCode).json({
      success: true,
      data: result,
      message:
        statusCode === 201
          ? "Agent created from MLM webhook"
          : "Agent updated from MLM webhook",
    });
  } catch (error) {
    console.error("MLM webhook error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process agent webhook",
    });
  }
};

