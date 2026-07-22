import express from "express";
import { handleAgentRegistration } from "../controllers/mlmController.js";
import { verifyMlmApiKey } from "../middleware/apiKeyMiddleware.js";

const router = express.Router();

router.post("/agents/webhook", verifyMlmApiKey, handleAgentRegistration);

export default router;

