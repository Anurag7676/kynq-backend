// // routes/quoteRoutes.js
// import express from "express";
// import {
//   createQuoteRequest,
//   getAdminQuoteRequests,
//   getAdminQuoteRequestDetails,
//   updateAdminQuoteRequest,
//   deleteQuoteRequest,
//   getQuoteRequestStats,
// } from "../controllers/quoteController.js";
// import { auth } from "../middleware/authMiddleware.js";
// import { adminOnly } from "../middleware/roleMiddleware.js";

// const router = express.Router();

// // =======================================
// // PUBLIC ROUTES
// // =======================================

// // Create quote request (Public - no auth required)
// router.post("/request", createQuoteRequest);

// // =======================================
// // ADMIN ROUTES
// // =======================================

// // Admin stats
// router.get("/admin/stats", auth, adminOnly, getQuoteRequestStats);

// // Admin quote management
// router.get("/admin/all", auth, adminOnly, getAdminQuoteRequests);
// router.get("/admin/:id", auth, adminOnly, getAdminQuoteRequestDetails);
// router.put("/admin/:id", auth, adminOnly, updateAdminQuoteRequest);
// router.delete("/admin/:id", auth, adminOnly, deleteQuoteRequest);

// export default router;


// routes/quoteRoutes.js
import express from "express";
import {
  createQuoteRequest,
  getAdminQuoteRequests,
  getAdminQuoteRequestDetails,
  updateAdminQuoteRequest,
  deleteQuoteRequest,
  getQuoteRequestStats,
} from "../controllers/quoteController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { ecommerceAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// =======================================
// PUBLIC ROUTES
// =======================================

// Create quote request (Public - no auth required)
router.post("/request", createQuoteRequest);

// =======================================
// ADMIN ROUTES (Ecommerce Permission Required)
// =======================================

// Quote statistics (ecommerce access required)
router.get("/admin/stats", auth, ecommerceAccess, getQuoteRequestStats);

// Quote management (ecommerce access required)
router.get("/admin/all", auth, ecommerceAccess, getAdminQuoteRequests);
router.get("/admin/:id", auth, ecommerceAccess, getAdminQuoteRequestDetails);
router.put("/admin/:id", auth, ecommerceAccess, updateAdminQuoteRequest);
router.delete("/admin/:id", auth, ecommerceAccess, deleteQuoteRequest);

export default router;