// routes/editorRoutes.js
import express from "express";
import {
  createEditor,
  getAllEditors,
  getEditorById,
  updateEditor,
  deleteEditor,
  toggleEditorStatus,
  resetEditorPassword,
} from "../controllers/editorController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";

const router = express.Router();

// ========================================
// EDITOR MANAGEMENT ROUTES (Admin Only)
// ========================================

// Create new editor
router.post("/", auth, adminOnly, createEditor);

// Get all editors with filtering and pagination
router.get("/", auth, adminOnly, getAllEditors);

// Get editor by ID
router.get("/:id", auth, adminOnly, getEditorById);

// Update editor details and permissions
router.put("/:id", auth, adminOnly, updateEditor);

// Delete editor
router.delete("/:id", auth, adminOnly, deleteEditor);

// Toggle editor active status
router.put("/:id/toggle-status", auth, adminOnly, toggleEditorStatus);

// Reset editor password
router.put("/:id/reset-password", auth, adminOnly, resetEditorPassword);

export default router;