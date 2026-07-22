

// routes/userRoutes.js
import express from "express";
import {
  registerUser,
  verifyEmail,
  resendVerificationOTP,
  checkVerificationStatus,
  loginUser,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  getUserProfile,
  updateUserProfile,
  changePassword,
  addAddress,
  getUserAddresses,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  deactivateAccount,
  // Admin operations
  getAllUsers,
  getUserById,
  updateUserById,
  deleteUserById,
  activateUser,
  deactivateUser,
  resetUserPassword,
  getUserStats,
  exportUsers,
  bulkUpdateUsers,
} from "../controllers/userController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";

const router = express.Router();

// ========================================
// PUBLIC ROUTES (No authentication required)
// ========================================
router.post("/register", registerUser);
router.post("/verify-otp", verifyEmail);
router.post("/resend-otp", resendVerificationOTP);
router.post("/check-verification", checkVerificationStatus);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOTP);
router.post("/reset-password", resetPassword);

// ========================================
// PROTECTED USER ROUTES (Authentication required)
// ========================================
router.get("/profile", auth, getUserProfile);
router.put("/profile", auth, updateUserProfile);
router.put("/change-password", auth, changePassword);
router.put("/deactivate", auth, deactivateAccount);

// Address management routes
router.post("/addresses", auth, addAddress);
router.get("/addresses", auth, getUserAddresses);
router.put("/addresses/:id", auth, updateAddress);
router.delete("/addresses/:id", auth, deleteAddress);
router.put("/addresses/:id/set-default", auth, setDefaultAddress);

// ========================================
// ADMIN ROUTES (Admin authentication required)
// ========================================

// User management
router.get("/admin/all", auth, adminOnly, getAllUsers);
router.get("/admin/stats", auth, adminOnly, getUserStats);
router.get("/admin/export", auth, adminOnly, exportUsers);
router.put("/admin/bulk-update", auth, adminOnly, bulkUpdateUsers);

// Individual user operations
router.get("/admin/:id", auth, adminOnly, getUserById);
router.put("/admin/:id", auth, adminOnly, updateUserById);
router.delete("/admin/:id", auth, adminOnly, deleteUserById);

// User status management
router.put("/admin/:id/activate", auth, adminOnly, activateUser);
router.put("/admin/:id/deactivate", auth, adminOnly, deactivateUser);
router.put("/admin/:id/reset-password", auth, adminOnly, resetUserPassword);

export default router;