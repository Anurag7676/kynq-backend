


import express from "express";
import {
  createProduct,
  getProducts,
  getAdminProducts,
  getAdminProduct,
  getProduct,
  updateProduct,
  deleteProduct,
  addProductReview,
  updateProductReview,
  deleteProductReview,
  getFeaturedProducts,
  getRelatedProducts,
  getProductReviews,
  verifyProductReview,
  updateProductStock,
  toggleProductFeature,
  toggleProductPublish,
  getProductStats,
  bulkUpdateProducts,
  bulkDeleteProducts,
  getProductsByCategory,
  advancedProductSearch,
  manualSyncToPageContent,
  getFieldMappings,
  getProductsByType,
  toggleProductType,
  getProductsByVendor,
  getVendorStats,
  getImageUploadUrl,
} from "../controllers/productController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly, checkRole } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { ecommerceAccess, adminOrEditorWithSection } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// =======================================
// ADMIN ROUTES - Now accessible to admins and editors with ecommerce permission
// =======================================

// Admin stats and analytics (ecommerce access required)
router.get("/admin/stats", auth, ecommerceAccess, getProductStats);

// Admin vendor statistics (ecommerce access required)
router.get("/admin/vendor-stats", auth, ecommerceAccess, getVendorStats);

// Admin field mappings for sync (ecommerce access required)
router.get("/admin/field-mappings", auth, ecommerceAccess, getFieldMappings);

// Admin product listing (ecommerce access required)
router.get("/admin/list", auth, ecommerceAccess, getAdminProducts);

// Admin bulk operations (ecommerce access required)
router.put("/admin/bulk-update", auth, ecommerceAccess, bulkUpdateProducts);
router.delete("/admin/bulk-delete", auth, ecommerceAccess, bulkDeleteProducts);

// Admin single product operations (ecommerce access required)
router.get("/admin/edit/:id", auth, ecommerceAccess, getAdminProduct);
router.post("/admin/create", auth, ecommerceAccess, createProduct);
router.put("/admin/update/:id", auth, ecommerceAccess, updateProduct);
router.delete("/admin/delete/:id", auth, ecommerceAccess, deleteProduct);

// Admin product actions (ecommerce access required)
router.put("/admin/:id/stock", auth, ecommerceAccess, updateProductStock);
router.put("/admin/:id/toggle-feature", auth, ecommerceAccess, toggleProductFeature);
router.put("/admin/:id/toggle-publish", auth, ecommerceAccess, toggleProductPublish);
router.put("/admin/:id/toggle-type", auth, ecommerceAccess, toggleProductType);

// Admin sync operations (ecommerce access required)
router.post("/admin/:id/sync-to-page-content", auth, ecommerceAccess, manualSyncToPageContent);

// Admin review management (ecommerce access required)
router.put("/admin/:id/reviews/:reviewId/verify", auth, ecommerceAccess, verifyProductReview);

// Admin image upload (ecommerce access required)
router.get("/admin/image-upload-url", auth, ecommerceAccess, getImageUploadUrl);

// =======================================
// PUBLIC SPECIFIC ROUTES
// =======================================
router.get("/list", getProducts);

// Featured products
router.get("/featured", getFeaturedProducts);

// Advanced search
router.get("/search", advancedProductSearch);

// Products by type (regular/quote)
router.get("/type/:type", getProductsByType);

// Products by category
router.get("/category/:categoryId", getProductsByCategory);

// Products by vendor
router.get("/vendor/:vendorCode", getProductsByVendor);

// Public product listing
router.get("/", getProducts);

// =======================================
// PRODUCT-SPECIFIC ROUTES (with ID)
// =======================================

// Product reviews
router.get("/:id/reviews", getProductReviews);
router.post("/:id/reviews", auth, checkRole(["user"]), addProductReview);
router.put("/:id/reviews/:reviewId", auth, updateProductReview);
router.delete("/:id/reviews/:reviewId", auth, deleteProductReview);

// Related products
router.get("/:id/related", getRelatedProducts);

router.get("/:idOrSlug", getProduct);

export default router;