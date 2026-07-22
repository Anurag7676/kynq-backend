// // routes/contentRoutes.js
// import express from "express";
// import {
//   getPageContent,
//   createPageContent,
//   updatePageContent,
//   getAllPageContent,
//   deletePageContent,
//   getPagesByType, // Add this new import
// } from "../controllers/pageContentController.js";
// import { auth } from "../middleware/authMiddleware.js";
// import { adminOnly } from "../middleware/roleMiddleware.js";

// const router = express.Router();

// // Public routes - available without authentication
// // Get all pages by page type (e.g., /api/content/product, /api/content/category)
// router.get("/:pageType", getPagesByType);

// // Get content for a specific page
// router.get("/:pageType/:id", getPageContent);

// // Admin routes - require authentication and admin role
// // Get list of all page content entries
// router.get("/", auth, adminOnly, getAllPageContent);

// // Create new page content
// router.post("/:pageType/:id", auth, adminOnly, createPageContent);

// // Update existing page content
// router.put("/:pageType/:id", auth, adminOnly, updatePageContent);

// // Delete page content
// router.delete("/:pageType/:id", auth, adminOnly, deletePageContent);

// export default router;


// routes/contentRoutes.js
import express from "express";
import {
  getPageContent,
  createPageContent,
  updatePageContent,
  getAllPageContent,
  deletePageContent,
  getPagesByType,
} from "../controllers/pageContentController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { cmsAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// ========================================
// PUBLIC ROUTES (No authentication required)
// ========================================

// Get all pages by page type (e.g., /api/content/product, /api/content/category)
router.get("/:pageType", getPagesByType);

// Get content for a specific page
router.get("/:pageType/:id", getPageContent);

// ========================================
// ADMIN ROUTES (CMS Permission Required)
// ========================================

// Get list of all page content entries (cms access required)
router.get("/", auth, cmsAccess, getAllPageContent);

// Create new page content (cms access required)
router.post("/:pageType/:id", auth, cmsAccess, createPageContent);

// Update existing page content (cms access required)
router.put("/:pageType/:id", auth, cmsAccess, updatePageContent);

// Delete page content (cms access required)
router.delete("/:pageType/:id", auth, cmsAccess, deletePageContent);

export default router;