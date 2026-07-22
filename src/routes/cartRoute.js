// import express from "express";
// import {
//   getCart,
//   addToCart,
//   updateCartItem,
//   removeFromCart,
//   clearCart,
//   setShippingMethod,
//   addServices,
//   mergeGuestCart,
// } from "../controllers/cartController.js";
// import { auth, optionalAuth } from "../middleware/authMiddleware.js";

// const router = express.Router();

// // Routes that work with or without authentication
// router.get("/", optionalAuth, getCart);
// router.post("/", optionalAuth, addToCart);
// router.put("/item", optionalAuth, updateCartItem);
// router.delete("/item/:itemId", optionalAuth, removeFromCart);
// router.delete("/", optionalAuth, clearCart);
// router.post("/shipping", optionalAuth, setShippingMethod);
// router.post("/services", optionalAuth, addServices);

// // Routes that require authentication
// router.post("/merge", auth, mergeGuestCart);

// export default router;


import express from "express";
import {
  getCart,
  addToCart,
  calculateCartTax, // NEW
  getEstimatedTaxRate, // NEW
  updateCartItem,
  removeFromCart,
  clearCart,
  setShippingMethod,
  addServices,
  mergeGuestCart,
  setAgentCode,
} from "../controllers/cartController.js";
import { auth, optionalAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

// ========================================
// CART ROUTES (work with or without authentication)
// ========================================

// Get cart
router.get("/", optionalAuth, getCart);

// Add item to cart
router.post("/", optionalAuth, addToCart);

// Update cart item
router.put("/item", optionalAuth, updateCartItem);

// Remove item from cart
router.delete("/item/:itemId", optionalAuth, removeFromCart);

// Clear entire cart
router.delete("/", optionalAuth, clearCart);

// Set shipping method and delivery details
router.post("/shipping", optionalAuth, setShippingMethod);

// Add additional services (installation, assembly, gift wrapping)
router.post("/services", optionalAuth, addServices);

// Set/update agent code in cart
router.put("/agent-code", optionalAuth, setAgentCode);

// ========================================
// NEW: TAX CALCULATION ROUTES
// ========================================

// Calculate tax for cart with shipping address
router.post("/calculate-tax", optionalAuth, calculateCartTax);

// Get estimated tax rate for a location (no cart required)
router.get("/estimated-tax-rate", getEstimatedTaxRate);

// ========================================
// AUTHENTICATED ROUTES (require user login)
// ========================================

// Merge guest cart with user cart after login
router.post("/merge", auth, mergeGuestCart);

export default router;