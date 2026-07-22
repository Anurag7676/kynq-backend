import express from "express";
import {
  getWishlist,
  addToWishlist,
  updateWishlistItem,
  removeFromWishlist,
  moveToCart,
  clearWishlist,
  updateWishlistDetails,
  getPublicWishlist,
} from "../controllers/wishlistController.js";
import { auth, optionalAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

// All wishlist management routes require authentication
router.get("/", auth, getWishlist);
router.post("/", auth, addToWishlist);
router.put("/item", auth, updateWishlistItem);
router.delete("/item/:itemId", auth, removeFromWishlist);
router.post("/item/:itemId/move-to-cart", auth, moveToCart);
router.delete("/", auth, clearWishlist);
router.put("/", auth, updateWishlistDetails);

// Public wishlist access - uses optionalAuth to enhance response if user is logged in
router.get("/public/:userId", optionalAuth, getPublicWishlist);

export default router;
