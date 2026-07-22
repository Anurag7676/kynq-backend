

// import express from "express";
// import {
//   createIntent,
//   getPaymentStatus,
//   processRefund,
//   savePaymentMethod,
//   getPaymentMethods,
//   handleWebhook,
//   // Admin operations
//   getAllPayments,
//   getPaymentById,
//   getPaymentStats,
//   exportPayments,
//   bulkRefundPayments,
//   updatePaymentStatus,
//   searchPayments,
//   getPaymentsByDateRange,
//   getPaymentMethodStats,
//   reconcilePayments,
//   getTaxComplianceReport, // NEW
//   markOrdersAsTaxReported, // NEW
// } from "../controllers/paymentController.js";
// import { auth } from "../middleware/authMiddleware.js";
// import { adminOnly } from "../middleware/roleMiddleware.js";

// const router = express.Router();

// // Special middleware to get the raw body for Stripe webhooks
// const rawBodyMiddleware = (req, res, next) => {
//   let data = "";
//   req.setEncoding("utf8");

//   req.on("data", (chunk) => {
//     data += chunk;
//   });

//   req.on("end", () => {
//     req.rawBody = data;
//     next();
//   });
// };

// // ========================================
// // PUBLIC ROUTES
// // ========================================

// // Webhook route - no authentication, but needs raw body
// router.post("/webhook", rawBodyMiddleware, handleWebhook);

// // ========================================
// // PROTECTED USER ROUTES (Authentication required)
// // ========================================

// // Payment intent creation (with Stripe Tax support)
// router.post("/create-payment-intent", auth, createIntent);

// // Payment status checking
// router.get("/status/:paymentIntentId", auth, getPaymentStatus);

// // Payment method management
// router.post("/save-payment-method", auth, savePaymentMethod);
// router.get("/payment-methods", auth, getPaymentMethods);

// // ========================================
// // ADMIN ROUTES (Admin authentication required)
// // ========================================

// // Payment management
// router.get("/admin/all", auth, adminOnly, getAllPayments);
// router.get("/admin/stats", auth, adminOnly, getPaymentStats);
// router.get("/admin/export", auth, adminOnly, exportPayments);
// router.get("/admin/search", auth, adminOnly, searchPayments);
// router.get("/admin/date-range", auth, adminOnly, getPaymentsByDateRange);

// // Individual payment operations
// router.get("/admin/:id", auth, adminOnly, getPaymentById);
// router.put("/admin/:id/status", auth, adminOnly, updatePaymentStatus);

// // Bulk operations
// router.post("/admin/bulk-refund", auth, adminOnly, bulkRefundPayments);
// router.post("/admin/reconcile", auth, adminOnly, reconcilePayments);

// // Analytics and reporting
// router.get("/admin/payment-method-stats", auth, adminOnly, getPaymentMethodStats);

// // Refund operations
// router.post("/admin/refund", auth, adminOnly, processRefund);

// // ========================================
// // NEW: STRIPE TAX COMPLIANCE ROUTES (Admin only)
// // ========================================

// // Tax compliance reporting
// router.get("/admin/tax-compliance", auth, adminOnly, getTaxComplianceReport);

// // Tax reporting management
// router.put("/admin/mark-tax-reported", auth, adminOnly, markOrdersAsTaxReported);

// export default router;


// import express from "express";
// import {
//   createIntent,
//   getPaymentStatus,
//   processRefund,
//   savePaymentMethod,
//   getPaymentMethods,
//   handleWebhook,
//   // Admin operations
//   getAllPayments,
//   getPaymentById,
//   getPaymentStats,
//   exportPayments,
//   bulkRefundPayments,
//   updatePaymentStatus,
//   searchPayments,
//   getPaymentsByDateRange,
//   getPaymentMethodStats,
//   reconcilePayments,
//   getTaxComplianceReport,
//   markOrdersAsTaxReported,
// } from "../controllers/paymentController.js";
// import { auth } from "../middleware/authMiddleware.js";
// import { adminOnly } from "../middleware/roleMiddleware.js";
// // Import section permission middleware
// import { financialAccess } from "../middleware/sectionPermissionMiddleware.js";

// const router = express.Router();

// // Special middleware to get the raw body for Stripe webhooks
// const rawBodyMiddleware = (req, res, next) => {
//   let data = "";
//   req.setEncoding("utf8");

//   req.on("data", (chunk) => {
//     data += chunk;
//   });

//   req.on("end", () => {
//     req.rawBody = data;
//     next();
//   });
// };

// // ========================================
// // PUBLIC ROUTES
// // ========================================

// // Webhook route - no authentication, but needs raw body
// router.post("/webhook", rawBodyMiddleware, handleWebhook);

// // ========================================
// // PROTECTED USER ROUTES (Authentication required)
// // ========================================

// // Payment intent creation (with Stripe Tax support)
// router.post("/create-payment-intent", auth, createIntent);

// // Payment status checking
// router.get("/status/:paymentIntentId", auth, getPaymentStatus);

// // Payment method management
// router.post("/save-payment-method", auth, savePaymentMethod);
// router.get("/payment-methods", auth, getPaymentMethods);

// // ========================================
// // ADMIN ROUTES (Financial Permission Required)
// // ========================================

// // Payment management (financial access required)
// router.get("/admin/all", auth, financialAccess, getAllPayments);
// router.get("/admin/stats", auth, financialAccess, getPaymentStats);
// router.get("/admin/export", auth, financialAccess, exportPayments);
// router.get("/admin/search", auth, financialAccess, searchPayments);
// router.get("/admin/date-range", auth, financialAccess, getPaymentsByDateRange);

// // Individual payment operations (financial access required)
// router.get("/admin/:id", auth, financialAccess, getPaymentById);
// router.put("/admin/:id/status", auth, financialAccess, updatePaymentStatus);

// // Bulk operations (financial access required)
// router.post("/admin/bulk-refund", auth, financialAccess, bulkRefundPayments);
// router.post("/admin/reconcile", auth, financialAccess, reconcilePayments);

// // Analytics and reporting (financial access required)
// router.get("/admin/payment-method-stats", auth, financialAccess, getPaymentMethodStats);

// // Refund operations (financial access required)
// router.post("/admin/refund", auth, financialAccess, processRefund);

// // ========================================
// // STRIPE TAX COMPLIANCE ROUTES (Financial Permission Required)
// // ========================================

// // Tax compliance reporting (financial access required)
// router.get("/admin/tax-compliance", auth, financialAccess, getTaxComplianceReport);

// // Tax reporting management (financial access required)
// router.put("/admin/mark-tax-reported", auth, financialAccess, markOrdersAsTaxReported);

// export default router;


import express from "express";
import {
  createIntent,
  getPaymentStatus,
  processRefund,
  savePaymentMethod,
  getPaymentMethods,
  handleWebhook,
  // Admin operations
  getAllPayments,
  getPaymentById,
  getPaymentStats,
  exportPayments,
  bulkRefundPayments,
  updatePaymentStatus,
  searchPayments,
  getPaymentsByDateRange,
  getPaymentMethodStats,
  reconcilePayments,
  checkTaxConfig,
  // REMOVED: Tax compliance imports for testing
  // getTaxComplianceReport,
  // markOrdersAsTaxReported,
} from "../controllers/paymentController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { financialAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// Special middleware to get the raw body for Stripe webhooks
// Stripe requires the raw body (Buffer) for signature verification
const rawBodyMiddleware = (req, res, next) => {
  const chunks = [];

  req.on("data", (chunk) => {
    chunks.push(chunk);
  });

  req.on("end", () => {
    // Store as Buffer for Stripe signature verification
    req.rawBody = Buffer.concat(chunks);
    next();
  });

  req.on("error", (err) => {
    next(err);
  });
};

// ========================================
// PUBLIC ROUTES
// ========================================

// Webhook route - no authentication, but needs raw body
router.post("/webhook", rawBodyMiddleware, handleWebhook);

// ========================================
// PROTECTED USER ROUTES (Authentication required)
// ========================================

// Payment intent creation (supports orderId in URL or body)
router.post("/create-payment-intent/:orderId", auth, createIntent);
router.post("/create-payment-intent", auth, createIntent);

// Payment status checking
router.get("/status/:paymentIntentId", auth, getPaymentStatus);

// Payment method management
router.post("/save-payment-method", auth, savePaymentMethod);
router.get("/payment-methods", auth, getPaymentMethods);

// ========================================
// ADMIN ROUTES (Financial Permission Required)
// ========================================

// Payment management (financial access required)
router.get("/admin/all", auth, financialAccess, getAllPayments);
router.get("/admin/stats", auth, financialAccess, getPaymentStats);
router.get("/admin/export", auth, financialAccess, exportPayments);
router.get("/admin/search", auth, financialAccess, searchPayments);
router.get("/admin/date-range", auth, financialAccess, getPaymentsByDateRange);

// Individual payment operations (financial access required)
router.get("/admin/:id", auth, financialAccess, getPaymentById);
router.put("/admin/:id/status", auth, financialAccess, updatePaymentStatus);

// Bulk operations (financial access required)
router.post("/admin/bulk-refund", auth, financialAccess, bulkRefundPayments);
router.post("/admin/reconcile", auth, financialAccess, reconcilePayments);

// Analytics and reporting (financial access required)
router.get("/admin/payment-method-stats", auth, financialAccess, getPaymentMethodStats);

// Refund operations (financial access required)
router.post("/admin/refund", auth, financialAccess, processRefund);

// ========================================
// STRIPE TAX CONFIGURATION CHECK
// ========================================

// Check Stripe Tax configuration (financial access required)
router.get("/admin/check-tax-config", auth, financialAccess, checkTaxConfig);

// ========================================
// REMOVED: STRIPE TAX COMPLIANCE ROUTES (For Testing)
// ========================================

// REMOVED: Tax compliance reporting routes for testing
// router.get("/admin/tax-compliance", auth, financialAccess, getTaxComplianceReport);
// router.put("/admin/mark-tax-reported", auth, financialAccess, markOrdersAsTaxReported);

export default router;