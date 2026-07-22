

// adminRoutes.js
import express from "express";
import {
  loginAdmin,
  getAdminProfile,
  createAdmin,
  getAllAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
  // Import editor functions from adminController (not editorController)
  createEditor,
  getAllEditors,
  getEditorById,
  updateEditor,
  deleteEditor,
  toggleEditorStatus,
  resetEditorPassword,
} from "../controllers/adminController.js"; // ← All from adminController.js
import { auth } from "../middleware/authMiddleware.js";
import {
  checkRole,
  adminOnly,
  adminOrEditor,
} from "../middleware/roleMiddleware.js";

const router = express.Router();

// ========================================
// ADMIN AUTHENTICATION ROUTES
// ========================================
router.post("/login", loginAdmin);
router.get("/profile", auth, getAdminProfile);

// ========================================
// EDITOR MANAGEMENT ROUTES (Admin Only)
// ========================================
// ⚠️ IMPORTANT: Put these BEFORE the general admin routes to avoid conflicts

// Create new editor
router.post("/editors", auth, adminOnly, createEditor);

// Get all editors with filtering and pagination
router.get("/editors", auth, adminOnly, getAllEditors);

// Get editor by ID
router.get("/editors/:id", auth, adminOnly, getEditorById);

// Update editor details and permissions
router.put("/editors/:id", auth, adminOnly, updateEditor);

// Delete editor
router.delete("/editors/:id", auth, adminOnly, deleteEditor);

// Toggle editor active status
router.put("/editors/:id/toggle-status", auth, adminOnly, toggleEditorStatus);

// Reset editor password
router.put("/editors/:id/reset-password", auth, adminOnly, resetEditorPassword);

// ========================================
// ADMIN MANAGEMENT ROUTES
// ========================================
// ⚠️ IMPORTANT: Put these AFTER the specific editor routes

router.post("/", auth, adminOnly, createAdmin);
router.get("/", auth, adminOrEditor, getAllAdmins);
router.get("/:id", auth, adminOrEditor, getAdminById);  // ← This now comes AFTER /editors routes
router.put("/:id", auth, adminOnly, updateAdmin);
router.delete("/:id", auth, adminOnly, deleteAdmin);

export default router;