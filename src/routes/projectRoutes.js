// routes/projectRoutes.js
import express from "express";
import {
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getAdminProjects,
  getAdminProjectById,
} from "../controllers/projectController.js";
import { auth } from "../middleware/authMiddleware.js";
import { cmsAccess } from "../middleware/sectionPermissionMiddleware.js";


const router = express.Router();

// Public routes (no authentication required)
router.get("/", getAllProjects);
router.get("/:id", getProjectById);

// Protected routes (authentication required)
router.use(auth);

// Admin and authorized user routes (with section permission check)
router.get("/admin/all", cmsAccess, getAdminProjects);
router.get("/admin/:id", cmsAccess, getAdminProjectById);
router.post("/", cmsAccess, createProject);
router.put("/:id", cmsAccess, updateProject);
router.delete("/:id", cmsAccess, deleteProject);

export default router; 