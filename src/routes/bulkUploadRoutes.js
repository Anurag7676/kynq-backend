



// routes/bulkUploadRoutes.js - UPDATED WITH BULK PUBLISH ROUTES
import express from "express";
import {
  getPresignedUrl,
  processBulkUpload,
  getBulkUploadHistory,
  getBulkUploadStatus,
  downloadTemplate,
  validateCSVStructure,
  retryFailedProducts,
  cancelBulkUpload,
  getBulkUploadStats,
  // 🆕 NEW BULK PUBLISH IMPORTS
  getDraftProducts,
  bulkPublishProducts,
  bulkUnpublishProducts,
  getBulkPublishStats
} from "../controllers/bulkUploadController.js";
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
// BULK PUBLISH/DRAFT MANAGEMENT ROUTES
// ========================================
router.get("/drafts", getDraftProducts);                    // Get all draft products
router.post("/publish", bulkPublishProducts);               // Bulk publish products
router.post("/unpublish", bulkUnpublishProducts);          // Bulk unpublish products  
router.get("/publish-stats", getBulkPublishStats);         // Get publish/draft statistics

// ========================================
// BULK UPLOAD ROUTES
// ========================================
router.get("/presigned-url", getPresignedUrl);             // Get presigned URL for S3 upload
router.post("/process", processBulkUpload);                // Process bulk upload from S3
router.post("/validate", validateCSVStructure);            // Validate CSV structure before processing
router.get("/history", getBulkUploadHistory);              // Get bulk upload history
router.get("/status/:jobId", getBulkUploadStatus);         // Get status of a specific bulk upload job
router.get("/template", downloadTemplate);                 // Download CSV template
router.post("/retry/:jobId", retryFailedProducts);         // Retry failed products from a previous upload
router.delete("/cancel/:jobId", cancelBulkUpload);         // Cancel ongoing bulk upload
router.get("/stats", getBulkUploadStats);                  // Get bulk upload statistics

export default router;