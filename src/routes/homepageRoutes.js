

// routes/homepageRoutes.js
import express from "express";
import {
  getHomepage,
  createHomepage,
  updateHomepage,
  deleteHomepage,
  getHomepageSection,
  updateHomepageSection,
  toggleSectionStatus,
  getHomepageStats,
} from "../controllers/homepageController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { cmsAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// ========================================
// PUBLIC ROUTES (No authentication required)
// ========================================

// Get complete homepage content
router.get("/", getHomepage);

// Get specific section content (for optimized loading)
router.get("/section/:sectionName", getHomepageSection);

// ========================================
// ADMIN ROUTES (CMS Permission Required)
// ========================================

// Get homepage stats for admin dashboard (cms access required)
router.get("/admin/stats", auth, cmsAccess, getHomepageStats);

// Create homepage content (can only be created once) (cms access required)
router.post("/", auth, cmsAccess, createHomepage);

// Update complete homepage content (cms access required)
router.put("/", auth, cmsAccess, updateHomepage);

// Update specific section only (cms access required)
router.put("/section/:sectionName", auth, cmsAccess, updateHomepageSection);

// Toggle section enable/disable status (cms access required)
router.put("/section/:sectionName/toggle", auth, cmsAccess, toggleSectionStatus);

// Delete homepage content (cms access required)
router.delete("/", auth, cmsAccess, deleteHomepage);

export default router;