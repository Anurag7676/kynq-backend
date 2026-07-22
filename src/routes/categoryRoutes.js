
import express from "express";
import {
  createCategory,
  getCategories,
  getCategory,
  getAdminCategory,
  getSubcategories,
  updateCategory,
  deleteCategory,
  getCategoryTree,
  getCategoryProducts,
  bulkActivateCategories,
  bulkDeactivateCategories,
  getCategoryImpactAnalysis,
  toggleCategoryStatus,
  getInactiveCategories,
  getCategoryStats,
  exportCategories,
  getAdminCategories,
} from "../controllers/categoryController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { ecommerceAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// ========================================
// PUBLIC ROUTES
// ========================================

// Basic category routes
router.get("/", getCategories);
router.get("/tree", getCategoryTree);



// Individual category routes (keep these BEFORE the catch-all route)
router.get("/:id/subcategories", getSubcategories);
router.get("/:idOrSlug/products", getCategoryProducts);

// ========================================
// ADMIN ROUTES (Authentication + Ecommerce Permission Required)
// ========================================

// Basic CRUD operations (ecommerce access required)
router.post("/", auth, ecommerceAccess, createCategory);
router.put("/:id", auth, ecommerceAccess, updateCategory);
router.delete("/:id", auth, ecommerceAccess, deleteCategory);

// ========================================
// ADMIN MANAGEMENT ROUTES (Ecommerce Permission Required)
// ========================================

// Category management (ecommerce access required)
router.get("/admin/all", auth, ecommerceAccess, getAdminCategories);
router.get("/admin/stats", auth, ecommerceAccess, getCategoryStats);
router.get("/admin/inactive", auth, ecommerceAccess, getInactiveCategories);
router.get("/admin/export", auth, ecommerceAccess, exportCategories);
router.get("/admin/:id", auth, ecommerceAccess, getAdminCategory);



// Category analysis (ecommerce access required)
router.get("/:id/impact-analysis", auth, ecommerceAccess, getCategoryImpactAnalysis);

// Status management (ecommerce access required)
router.put("/:id/toggle-status", auth, ecommerceAccess, toggleCategoryStatus);

// Bulk operations (ecommerce access required)
router.post("/bulk/activate", auth, ecommerceAccess, bulkActivateCategories);
router.post("/bulk/deactivate", auth, ecommerceAccess, bulkDeactivateCategories);

// ========================================
// CATCH-ALL ROUTES (Must be LAST!)
// ========================================

// Single category by ID or slug (MUST BE LAST!)
router.get("/:idOrSlug", getCategory);

export default router;