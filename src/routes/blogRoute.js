// import express from "express";
// import {
//   createBlog,
//   getPublicBlogs,
//   getAdminBlogs,
//   getPublicBlogById,
//   getAdminBlogById,
//   getBlogBySlug,
//   updateBlog,
//   deleteBlog,
//   getFeaturedBlogs,
//   getBlogsByCategory,
//   toggleBlogFeature,
//   toggleBlogPublish,
//   getBlogStats,
//   addBlogComment,
//   toggleCommentApproval,
//   deleteBlogComment,
// } from "../controllers/blogController.js";
// import { auth, optionalAuth } from "../middleware/authMiddleware.js";
// import { adminOnly, checkRole } from "../middleware/roleMiddleware.js";

// const router = express.Router();

// // Admin routes
// // Note: These must be placed before more general routes to avoid conflicts
// router.get("/admin/all", auth, adminOnly, getAdminBlogs);
// router.get("/admin/stats", auth, adminOnly, getBlogStats);
// router.get("/admin/:id", auth, adminOnly, getAdminBlogById);

// // Public routes
// router.get("/", getPublicBlogs);
// router.get("/featured", getFeaturedBlogs);
// router.get("/category/:category", getBlogsByCategory);
// router.get("/slug/:slug", getBlogBySlug);
// router.get("/:id", getPublicBlogById);

// // User routes - require authentication
// router.post("/:id/comments", auth, checkRole(["user"]), addBlogComment);

// // Admin-only routes
// router.post("/", auth, adminOnly, createBlog);
// router.put("/:id", auth, adminOnly, updateBlog);
// router.delete("/:id", auth, adminOnly, deleteBlog);
// router.put("/:id/toggle-feature", auth, adminOnly, toggleBlogFeature);
// router.put("/:id/toggle-publish", auth, adminOnly, toggleBlogPublish);
// router.put(
//   "/:id/comments/:commentId/toggle-approval",
//   auth,
//   adminOnly,
//   toggleCommentApproval
// );

// // Routes that can be accessed by both admin and users with proper permissions
// router.delete("/:id/comments/:commentId", auth, deleteBlogComment); // Controller handles permission check

// export default router;


import express from "express";
import {
  createBlog,
  getPublicBlogs,
  getAdminBlogs,
  getPublicBlogById,
  getAdminBlogById,
  getBlogBySlug,
  updateBlog,
  deleteBlog,
  getFeaturedBlogs,
  getBlogsByCategory,
  toggleBlogFeature,
  toggleBlogPublish,
  getBlogStats,
  addBlogComment,
  toggleCommentApproval,
  deleteBlogComment,
} from "../controllers/blogController.js";
import { auth, optionalAuth } from "../middleware/authMiddleware.js";
import { adminOnly, checkRole } from "../middleware/roleMiddleware.js";
// Import section permission middleware
import { cmsAccess } from "../middleware/sectionPermissionMiddleware.js";

const router = express.Router();

// ========================================
// ADMIN ROUTES (CMS Permission Required)
// ========================================
// Note: These must be placed before more general routes to avoid conflicts

// Blog management (cms access required)
router.get("/admin/all", auth, cmsAccess, getAdminBlogs);
router.get("/admin/stats", auth, cmsAccess, getBlogStats);
router.get("/admin/:id", auth, cmsAccess, getAdminBlogById);

// ========================================
// PUBLIC ROUTES
// ========================================
router.get("/", getPublicBlogs);
router.get("/featured", getFeaturedBlogs);
router.get("/category/:category", getBlogsByCategory);
router.get("/slug/:slug", getBlogBySlug);
router.get("/:id", getPublicBlogById);

// ========================================
// USER ROUTES (Authentication Required)
// ========================================
router.post("/:id/comments", auth, checkRole(["user"]), addBlogComment);

// ========================================
// ADMIN-ONLY ROUTES (CMS Permission Required)
// ========================================

// Blog CRUD operations (cms access required)
router.post("/", auth, cmsAccess, createBlog);
router.put("/:id", auth, cmsAccess, updateBlog);
router.delete("/:id", auth, cmsAccess, deleteBlog);

// Blog management actions (cms access required)
router.put("/:id/toggle-feature", auth, cmsAccess, toggleBlogFeature);
router.put("/:id/toggle-publish", auth, cmsAccess, toggleBlogPublish);

// Comment management (cms access required)
router.put("/:id/comments/:commentId/toggle-approval", auth, cmsAccess, toggleCommentApproval);

// ========================================
// MIXED PERMISSION ROUTES
// ========================================
// Routes that can be accessed by both admin and users with proper permissions
router.delete("/:id/comments/:commentId", auth, deleteBlogComment); // Controller handles permission check

export default router;