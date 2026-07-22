// // routes/productExportRoutes.js
// import express from "express";
// import {
//   exportProductsCSV,
//   exportProductsJSON,
//   getExportStats,
//   getTemplateHeaders
// } from "../controllers/productExportController.js";
// import { auth } from "../middleware/authMiddleware.js";
// import { adminOnly } from "../middleware/roleMiddleware.js";
// // Import section permission middleware
// import { ecommerceAccess } from "../middleware/sectionPermissionMiddleware.js";

// const router = express.Router();

// // ========================================
// // ALL ROUTES REQUIRE ECOMMERCE PERMISSION
// // ========================================
// // All routes require authentication and ecommerce access
// // router.use(auth);
// // router.use(ecommerceAccess);

// // ========================================
// // PRODUCT EXPORT ROUTES
// // ========================================

// // @desc    Export products as CSV file
// // @route   GET /api/products/export/csv
// // @access  Private/Admin
// // @params  ?published=true/false&category=Rugs&brand=Style&requestQuote=true/false&hasVariations=true/false&limit=1000&includeVariations=true/false
// router.get("/csv", exportProductsCSV);

// // @desc    Export products as JSON (flat structure matching CSV)
// // @route   GET /api/products/export/json  
// // @access  Private/Admin
// // @params  ?published=true/false&category=Rugs&brand=Style&requestQuote=true/false&hasVariations=true/false&limit=1000&includeVariations=true/false
// router.get("/json", exportProductsJSON);

// // @desc    Get export statistics and analytics
// // @route   GET /api/products/export/stats
// // @access  Private/Admin
// router.get("/stats", getExportStats);

// // @desc    Get CSV template headers (35 columns)
// // @route   GET /api/products/export/template-headers
// // @access  Private/Admin
// router.get("/template-headers", getTemplateHeaders);

// export default router;


// routes/productExportRoutes.js
import express from "express";
import {
  exportProductsCSV,
  exportProductsJSON,
  getExportStats,
  getTemplateHeaders
} from "../controllers/productExportController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { ecommerceAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// ========================================
// ALL ROUTES REQUIRE ECOMMERCE PERMISSION
// ========================================
// All routes require authentication and ecommerce access
router.use(auth);
router.use(ecommerceAccess);

// ========================================
// PRODUCT EXPORT ROUTES
// ========================================

// @desc    Export products as CSV file
// @route   GET /api/products/export/csv
// @access  Private/Admin
// @params  ?published=true/false&category=Rugs&brand=Style&requestQuote=true/false&hasVariations=true/false&limit=1000&includeVariations=true/false
router.get("/csv", exportProductsCSV);

// @desc    Export products as JSON (flat structure matching CSV)
// @route   GET /api/products/export/json  
// @access  Private/Admin
// @params  ?published=true/false&category=Rugs&brand=Style&requestQuote=true/false&hasVariations=true/false&limit=1000&includeVariations=true/false
router.get("/json", exportProductsJSON);

// @desc    Get export statistics and analytics
// @route   GET /api/products/export/stats
// @access  Private/Admin
router.get("/stats", getExportStats);

// @desc    Get CSV template headers (35 columns)
// @route   GET /api/products/export/template-headers
// @access  Private/Admin
router.get("/template-headers", getTemplateHeaders);

export default router;