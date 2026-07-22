// // routes/contactRoutes.js
// import express from "express";
// import {
//   createContact,
//   getAllContacts,
//   getContactById,
//   updateContactStatus,
//   deleteContact,
//   getContactStats,
// } from "../controllers/contactController.js";
// import { auth } from "../middleware/authMiddleware.js";
// import { adminOnly } from "../middleware/roleMiddleware.js";

// const router = express.Router();

// // Public routes
// router.post("/", createContact);

// // Admin routes (protected)
// router.get("/", auth, adminOnly, getAllContacts);
// router.get("/stats", auth, adminOnly, getContactStats);
// router.get("/:id", auth, adminOnly, getContactById);
// router.put("/:id/status", auth, adminOnly, updateContactStatus);
// router.delete("/:id", auth, adminOnly, deleteContact);

// export default router;


// routes/contactRoutes.js
import express from "express";
import {
  createContact,
  getAllContacts,
  getContactById,
  updateContactStatus,
  deleteContact,
  getContactStats,
} from "../controllers/contactController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { customersAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// ========================================
// PUBLIC ROUTES (No authentication required)
// ========================================

// Create contact form submission
router.post("/", createContact);

// ========================================
// ADMIN ROUTES (Customers Permission Required)
// ========================================

// Contact management (customers access required)
router.get("/", auth, customersAccess, getAllContacts);
router.get("/stats", auth, customersAccess, getContactStats);

// Individual contact operations (customers access required)
router.get("/:id", auth, customersAccess, getContactById);
router.put("/:id/status", auth, customersAccess, updateContactStatus);
router.delete("/:id", auth, customersAccess, deleteContact);

export default router;