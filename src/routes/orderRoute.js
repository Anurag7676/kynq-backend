

import express from "express";
import {
  createOrder,
  getOrderById,
  getMyOrders,
  updateOrderToPaid,
  updateOrderToDelivered,
  updateOrderStatus,
  cancelOrder,
  requestReturn,
  processReturn,
  processOrderRefund,
  generateInvoice,
  getOrders,
  getOrderStats,
} from "../controllers/orderController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { ecommerceAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// ========================================
// ADMIN ROUTES (Ecommerce Permission Required)
// ========================================
// KEEP ORIGINAL PATHS - just change middleware

// Order statistics (ORIGINAL PATH MAINTAINED)
router.get("/stats", auth, ecommerceAccess, getOrderStats);

// Order management (ORIGINAL PATH MAINTAINED) 
router.get("/", auth, ecommerceAccess, getOrders);

// Order processing (ecommerce access required)
router.put("/:id/deliver", auth, ecommerceAccess, updateOrderToDelivered);
router.put("/:id/status", auth, ecommerceAccess, updateOrderStatus);
router.put("/:id/process-return", auth, ecommerceAccess, processReturn);
router.put("/:id/process-refund", auth, ecommerceAccess, processOrderRefund);

// ========================================
// USER ROUTES (Authentication Required)
// ========================================

// Order creation and management
router.post("/", auth, createOrder);
router.get("/my-orders", auth, getMyOrders);

// Order actions
router.put("/:id/pay", auth, updateOrderToPaid);
router.put("/:id/cancel", auth, cancelOrder);
router.put("/:id/return", auth, requestReturn);
router.post("/:id/invoice", auth, generateInvoice);

// ========================================
// SHARED ROUTES (Authentication Required)
// ========================================
// Get individual order (users can see their own, admins can see all)
router.get("/:id", auth, getOrderById);

export default router;