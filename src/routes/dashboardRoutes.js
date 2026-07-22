
// // routes/dashboardRoutes.js
// import express from "express";
// import {
//   getDashboardAnalytics,
//   getDashboardWidgets,
//   getRevenueChartData,
//   getFilterOptions,
//   getStockAlerts,      // 🆕 NEW
//   getStockSummary      // 🆕 NEW
// } from "../controllers/dashboardController.js";
// import { auth } from "../middleware/authMiddleware.js";
// import { adminOnly } from "../middleware/roleMiddleware.js";

// const router = express.Router();

// // Admin dashboard routes
// router.get("/analytics", auth, adminOnly, getDashboardAnalytics);
// router.get("/widgets", auth, adminOnly, getDashboardWidgets);
// router.get("/revenue-chart", auth, adminOnly, getRevenueChartData);
// router.get("/filter-options", auth, adminOnly, getFilterOptions);

// // 🆕 NEW: Stock management routes
// router.get("/stock-alerts", auth, adminOnly, getStockAlerts);
// router.get("/stock-summary", auth, adminOnly, getStockSummary);

// export default router;


// routes/dashboardRoutes.js
import express from "express";
import {
  getDashboardAnalytics,
  getDashboardWidgets,
  getRevenueChartData,
  getFilterOptions,
  getStockAlerts,
  getStockSummary
} from "../controllers/dashboardController.js";
import { auth } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { dashboardAccess, adminPanelAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// ========================================
// ADMIN DASHBOARD ROUTES (Admin Panel Access Required)
// ========================================
// Dashboard is accessible to all admin panel users (admins and editors)
// The controller should filter data based on user's section permissions

// General dashboard analytics (admin panel access required)
router.get("/analytics", auth, adminPanelAccess, getDashboardAnalytics);
router.get("/widgets", auth, adminPanelAccess, getDashboardWidgets);
router.get("/filter-options", auth, adminPanelAccess, getFilterOptions);

// Revenue chart data (admin panel access required)
// Controller should check if user has financial or ecommerce access for full data
router.get("/revenue-chart", auth, adminPanelAccess, getRevenueChartData);

// ========================================
// STOCK MANAGEMENT ROUTES (Admin Panel Access Required)
// ========================================
// Stock data is ecommerce-related but useful for dashboard overview
// Controller should check if user has ecommerce access for detailed data

router.get("/stock-alerts", auth, adminPanelAccess, getStockAlerts);
router.get("/stock-summary", auth, adminPanelAccess, getStockSummary);

export default router;