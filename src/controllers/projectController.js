 

// controllers/projectController.js - MINIMAL FIX
import Project from "../models/projectModel.js";
import ProjectPage from "../models/projectPageModel.js";
import { sendResponse } from "../utils/responseUtils.js";

// Helper function to get user ID from request
const getUserId = (req) => {
  // Check different possible user object structures
  if (req.admin && req.admin._id) {
    return req.admin._id;
  }
  if (req.editor && req.editor._id) {
    return req.editor._id;
  }
  if (req.user && req.user._id) {
    return req.user._id;
  }
  return null;
};

// Get all projects (public API)
export const getAllProjects = async (req, res) => {
  try {
    const { expand, category, featured } = req.query;
    const query = { isActive: true };

    // Filter by category if provided
    if (category) {
      query.category = category;
    }

    // Filter by featured if provided
    if (featured === "true") {
      query.isFeatured = true;
    }

    let projects = await Project.find(query)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .sort({ createdAt: -1 });

    // If expand is true, populate projectPage data
    if (expand === "true") {
      projects = await Project.find(query)
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .populate("projectPage")
        .sort({ createdAt: -1 });
    }

    return sendResponse(res, 200, "Projects retrieved successfully", projects);
  } catch (error) {
    console.error("Error getting projects:", error);
    return sendResponse(res, 500, "Internal server error");
  }
};

// Get single project by ID (public API)
export const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const { expand } = req.query;

    let project = await Project.findOne({ _id: id, isActive: true })
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    if (!project) {
      return sendResponse(res, 404, "Project not found");
    }

    // If expand is true, populate projectPage data
    if (expand === "true") {
      project = await Project.findOne({ _id: id, isActive: true })
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .populate("projectPage");
    }

    return sendResponse(res, 200, "Project retrieved successfully", project);
  } catch (error) {
    console.error("Error getting project:", error);
    return sendResponse(res, 500, "Internal server error");
  }
};

// Create new project (admin/authorized roles)
export const createProject = async (req, res) => {
  try {
    const {
      title,
      category,
      locationShort,
      locationFull,
      year,
      description,
      imageUrl,
      isFeatured,
      content,
    } = req.body;

    // Get user ID from request - THIS IS THE KEY FIX
    const userId = getUserId(req);
    
    if (!userId) {
      return sendResponse(res, 401, "User authentication failed");
    }

    // Create ProjectPage first
    const projectPage = new ProjectPage({
      content: content || {},
      updatedBy: userId, // Fixed: was req.user._id
    });
    await projectPage.save();

    // Create Project with reference to ProjectPage
    const project = new Project({
      title,
      category,
      locationShort,
      locationFull,
      year,
      description,
      imageUrl,
      isFeatured: isFeatured || false,
      projectPage: projectPage._id,
      createdBy: userId, // Fixed: was req.user._id
      updatedBy: userId, // Fixed: was req.user._id
    });

    await project.save();

    // Populate the created project
    const populatedProject = await Project.findById(project._id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .populate("projectPage");

    return sendResponse(res, 201, "Project created successfully", populatedProject);
  } catch (error) {
    console.error("Error creating project:", error);
    return sendResponse(res, 500, "Internal server error");
  }
};

// Update project (admin/authorized roles)
export const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      category,
      locationShort,
      locationFull,
      year,
      description,
      imageUrl,
      isFeatured,
      isActive,
      content,
    } = req.body;

    // Get user ID from request - THIS IS THE KEY FIX
    const userId = getUserId(req);
    
    if (!userId) {
      return sendResponse(res, 401, "User authentication failed");
    }

    const project = await Project.findById(id);
    if (!project) {
      return sendResponse(res, 404, "Project not found");
    }

    // Update ProjectPage content if provided
    if (content) {
      await ProjectPage.findByIdAndUpdate(project.projectPage, {
        content,
        updatedBy: userId, // Fixed: was req.user._id
      });
    }

    // Update Project fields
    const updateData = {
      updatedBy: userId, // Fixed: was req.user._id
    };

    if (title) updateData.title = title;
    if (category) updateData.category = category;
    if (locationShort) updateData.locationShort = locationShort;
    if (locationFull) updateData.locationFull = locationFull;
    if (year) updateData.year = year;
    if (description) updateData.description = description;
    if (imageUrl) updateData.imageUrl = imageUrl;
    if (typeof isFeatured === "boolean") updateData.isFeatured = isFeatured;
    if (typeof isActive === "boolean") updateData.isActive = isActive;

    const updatedProject = await Project.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    )
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .populate("projectPage");

    return sendResponse(res, 200, "Project updated successfully", updatedProject);
  } catch (error) {
    console.error("Error updating project:", error);
    return sendResponse(res, 500, "Internal server error");
  }
};

// Delete project (admin/authorized roles)
export const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;

    const project = await Project.findById(id);
    if (!project) {
      return sendResponse(res, 404, "Project not found");
    }

    // Delete ProjectPage
    await ProjectPage.findByIdAndDelete(project.projectPage);

    // Delete Project
    await Project.findByIdAndDelete(id);

    return sendResponse(res, 200, "Project deleted successfully");
  } catch (error) {
    console.error("Error deleting project:", error);
    return sendResponse(res, 500, "Internal server error");
  }
};

// Get projects for admin (all projects including inactive)
export const getAdminProjects = async (req, res) => {
  try {
    const { expand, category, featured } = req.query;
    const query = {};

    // Filter by category if provided
    if (category) {
      query.category = category;
    }

    // Filter by featured if provided
    if (featured === "true") {
      query.isFeatured = true;
    }

    let projects = await Project.find(query)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .sort({ createdAt: -1 });

    // If expand is true, populate projectPage data
    if (expand === "true") {
      projects = await Project.find(query)
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .populate("projectPage")
        .sort({ createdAt: -1 });
    }

    return sendResponse(res, 200, "Projects retrieved successfully", projects);
  } catch (error) {
    console.error("Error getting admin projects:", error);
    return sendResponse(res, 500, "Internal server error");
  }
};

// Get single project for admin
export const getAdminProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const { expand } = req.query;

    let project = await Project.findById(id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    if (!project) {
      return sendResponse(res, 404, "Project not found");
    }

    // If expand is true, populate projectPage data
    if (expand === "true") {
      project = await Project.findById(id)
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .populate("projectPage");
    }

    return sendResponse(res, 200, "Project retrieved successfully", project);
  } catch (error) {
    console.error("Error getting admin project:", error);
    return sendResponse(res, 500, "Internal server error");
  }
};