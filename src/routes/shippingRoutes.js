// routes/shippingRoutes.js
import express from "express";
import {
  createShipment,
  getShippingRates,
  trackShipment,
  schedulePickup,
  cancelShipment,
  generateShippingLabel,
  generateShippingInvoice,
  createReturnShipment,
  getShippingAnalytics,
} from "../controllers/shipRocketController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
import { ecommerceAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// ========================================
// PUBLIC/USER ROUTES (Authentication required)
// ========================================

// Get shipping rates (for checkout)
router.post("/get-rates", auth, getShippingRates);

// Track shipment (users can track their own orders)
router.get("/track/:identifier", auth, trackShipment);

// ========================================
// ADMIN ROUTES (Ecommerce Permission Required)
// ========================================

// Shipment management
router.post("/create-shipment", auth, ecommerceAccess, createShipment);
router.post("/schedule-pickup", auth, ecommerceAccess, schedulePickup);
router.put("/cancel/:orderId", auth, ecommerceAccess, cancelShipment);

// Label and invoice generation
router.post("/generate-label", auth, ecommerceAccess, generateShippingLabel);
router.post("/generate-invoice", auth, ecommerceAccess, generateShippingInvoice);

// Return shipment management
router.post("/create-return", auth, ecommerceAccess, createReturnShipment);

// Analytics and reporting
router.get("/analytics", auth, ecommerceAccess, getShippingAnalytics);

export default router;