
import jwt from "jsonwebtoken";
import Admin from "../models/adminModel.js";
import Editor from "../models/editorModel.js";

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    // First check Admin model
    let admin = await Admin.findOne({ email }).select("+password");
    
    if (admin) {
      const isMatch = await admin.matchPassword(password);
      
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      admin.lastLogin = new Date();
      await admin.save();

      const token = generateToken(admin._id);

      // MAINTAIN ORIGINAL RESPONSE STRUCTURE FOR ADMINS
      return res.status(200).json({
        success: true,
        token,
        admin: {  // ← Keep original "admin" field
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          lastLogin: admin.lastLogin,
        },
      });
    }

    // If not found in Admin, check Editor model
    let editor = await Editor.findOne({ email }).select("+password");
    
    if (editor) {
      // Check if editor is active
      if (!editor.isActive) {
        return res.status(401).json({
          success: false,
          message: "Account is deactivated. Please contact admin.",
        });
      }

      const isMatch = await editor.matchPassword(password);
      
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      editor.lastLogin = new Date();
      await editor.save();

      const token = generateToken(editor._id);

      // NEW RESPONSE STRUCTURE FOR EDITORS (different from admins)
      return res.status(200).json({
        success: true,
        token,
        userType: "editor", // ← Identify this as editor login
        editor: {           // ← Use "editor" field for editors
          id: editor._id,
          name: editor.name,
          email: editor.email,
          role: "editor",
          permissions: editor.permissions,
          accessibleSections: editor.getAccessibleSections(),
          lastLogin: editor.lastLogin,
        },
      });
    }

    // If neither admin nor editor found
    return res.status(401).json({
      success: false,
      message: "Invalid credentials",
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getAdminProfile = async (req, res) => {
  try {
    // MAINTAIN ORIGINAL RESPONSE STRUCTURE
    if (req.userType === "admin") {
      res.status(200).json({
        success: true,
        admin: req.admin,  // ← Keep original "admin" field
      });
    } else if (req.userType === "editor") {
      res.status(200).json({
        success: true,
        editor: {  // ← Use "editor" field for editors
          ...req.editor.toObject(),
          accessibleSections: req.editor.getAccessibleSections(),
        },
      });
    } else {
      res.status(401).json({
        success: false,
        message: "Not authorized",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// KEEP ALL ORIGINAL ADMIN FUNCTIONS UNCHANGED
const createAdmin = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide name, email and password",
      });
    }

    const adminExists = await Admin.findOne({ email });

    if (adminExists) {
      return res.status(400).json({
        success: false,
        message: "Admin with this email already exists",
      });
    }

    const admin = await Admin.create({
      name,
      email,
      password,
      role: role || "editor",
    });

    res.status(201).json({
      success: true,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getAllAdmins = async (req, res) => {
  try {
    const admins = await Admin.find({});

    res.status(200).json({
      success: true,
      count: admins.length,
      admins,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getAdminById = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    res.status(200).json({
      success: true,
      admin,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateAdmin = async (req, res) => {
  try {
    const { name, email, role } = req.body;

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide fields to update",
      });
    }

    let admin = await Admin.findById(req.params.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    admin.name = name || admin.name;
    admin.email = email || admin.email;
    admin.role = role || admin.role;

    await admin.save();

    res.status(200).json({
      success: true,
      admin,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const deleteAdmin = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    await admin.deleteOne();

    res.status(200).json({
      success: true,
      message: "Admin removed",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ========================================
// EDITOR MANAGEMENT FUNCTIONS (Admin Only)
// ========================================

const createEditor = async (req, res) => {
  try {
    const { name, email, password, permissions } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide name, email and password",
      });
    }

    const editorExists = await Editor.findOne({ email });
    if (editorExists) {
      return res.status(400).json({
        success: false,
        message: "Editor with this email already exists",
      });
    }

    const adminExists = await Admin.findOne({ email });
    if (adminExists) {
      return res.status(400).json({
        success: false,
        message: "Admin with this email already exists",
      });
    }

    const editorPermissions = {
      dashboard: true,
      ecommerce: permissions?.ecommerce || false,
      cms: permissions?.cms || false,
      customers: permissions?.customers || false,
      financial: permissions?.financial || false,
      system: permissions?.system || false,
    };

    const editor = await Editor.create({
      name,
      email,
      password,
      permissions: editorPermissions,
      createdBy: req.admin._id,
    });

    res.status(201).json({
      success: true,
      message: "Editor created successfully",
      editor: {
        id: editor._id,
        name: editor.name,
        email: editor.email,
        permissions: editor.permissions,
        isActive: editor.isActive,
        createdAt: editor.createdAt,
        accessibleSections: editor.getAccessibleSections(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getAllEditors = async (req, res) => {
  try {
    const pageSize = Number(req.query.pageSize) || 20;
    const page = Number(req.query.page) || 1;

    const filter = {};

    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    if (req.query.search) {
      const searchRegex = { $regex: req.query.search, $options: 'i' };
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
      ];
    }

    if (req.query.section) {
      filter[`permissions.${req.query.section}`] = true;
    }

    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate),
      };
    }

    const count = await Editor.countDocuments(filter);

    let sort = { createdAt: -1 };
    if (req.query.sort) {
      switch (req.query.sort) {
        case 'oldest':
          sort = { createdAt: 1 };
          break;
        case 'name':
          sort = { name: 1 };
          break;
        case 'email':
          sort = { email: 1 };
          break;
        case 'lastLogin':
          sort = { lastLogin: -1 };
          break;
      }
    }

    const editors = await Editor.find(filter)
      .populate('createdBy', 'name email')
      .select('-password')
      .sort(sort)
      .limit(pageSize)
      .skip(pageSize * (page - 1));

    const editorsWithSections = editors.map(editor => ({
      ...editor.toObject(),
      accessibleSections: editor.getAccessibleSections(),
    }));

    res.status(200).json({
      success: true,
      count,
      pages: Math.ceil(count / pageSize),
      page,
      editors: editorsWithSections,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getEditorById = async (req, res) => {
  try {
    const editor = await Editor.findById(req.params.id)
      .populate('createdBy', 'name email')
      .select('-password');

    if (!editor) {
      return res.status(404).json({
        success: false,
        message: "Editor not found",
      });
    }

    res.status(200).json({
      success: true,
      editor: {
        ...editor.toObject(),
        accessibleSections: editor.getAccessibleSections(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateEditor = async (req, res) => {
  try {
    const { name, email, permissions, isActive } = req.body;

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide fields to update",
      });
    }

    let editor = await Editor.findById(req.params.id);

    if (!editor) {
      return res.status(404).json({
        success: false,
        message: "Editor not found",
      });
    }

    if (email && email !== editor.email) {
      const emailExistsInEditor = await Editor.findOne({ email });
      const emailExistsInAdmin = await Admin.findOne({ email });
      
      if (emailExistsInEditor || emailExistsInAdmin) {
        return res.status(400).json({
          success: false,
          message: "Email already exists",
        });
      }
      editor.email = email;
    }

    if (name) editor.name = name;
    if (isActive !== undefined) editor.isActive = isActive;

    if (permissions) {
      editor.permissions = {
        dashboard: true,
        ecommerce: permissions.ecommerce || false,
        cms: permissions.cms || false,
        customers: permissions.customers || false,
        financial: permissions.financial || false,
        system: permissions.system || false,
      };
    }

    await editor.save();

    const updatedEditor = await Editor.findById(editor._id)
      .populate('createdBy', 'name email')
      .select('-password');

    res.status(200).json({
      success: true,
      message: "Editor updated successfully",
      editor: {
        ...updatedEditor.toObject(),
        accessibleSections: updatedEditor.getAccessibleSections(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const deleteEditor = async (req, res) => {
  try {
    const editor = await Editor.findById(req.params.id);

    if (!editor) {
      return res.status(404).json({
        success: false,
        message: "Editor not found",
      });
    }

    await editor.deleteOne();

    res.status(200).json({
      success: true,
      message: "Editor deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const toggleEditorStatus = async (req, res) => {
  try {
    const editor = await Editor.findById(req.params.id);

    if (!editor) {
      return res.status(404).json({
        success: false,
        message: "Editor not found",
      });
    }

    editor.isActive = !editor.isActive;
    await editor.save();

    res.status(200).json({
      success: true,
      message: `Editor ${editor.isActive ? 'activated' : 'deactivated'} successfully`,
      editor: {
        id: editor._id,
        name: editor.name,
        email: editor.email,
        isActive: editor.isActive,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const resetEditorPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide new password",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    const editor = await Editor.findById(req.params.id).select("+password");

    if (!editor) {
      return res.status(404).json({
        success: false,
        message: "Editor not found",
      });
    }

    editor.password = newPassword;
    await editor.save();

    res.status(200).json({
      success: true,
      message: "Editor password reset successfully",
      editor: {
        id: editor._id,
        name: editor.name,
        email: editor.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export {
  loginAdmin,
  getAdminProfile,
  createAdmin,
  getAllAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
  // Editor management functions
  createEditor,
  getAllEditors,
  getEditorById,
  updateEditor,
  deleteEditor,
  toggleEditorStatus,
  resetEditorPassword,
};