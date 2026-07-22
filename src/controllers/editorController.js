import Editor from "../models/editorModel.js";

// Create new editor
export const createEditor = async (req, res) => {
  try {
    const { name, email, password, permissions } = req.body;

    const existing = await Editor.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: "Editor with this email already exists" });
    }

    const editor = await Editor.create({
      name,
      email,
      password,
      permissions: permissions || {},
      createdBy: req.admin._id,
    });

    res.status(201).json({ success: true, data: editor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all editors
export const getAllEditors = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, isActive } = req.query;
    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }

    const total = await Editor.countDocuments(filter);
    const editors = await Editor.find(filter)
      .select("-password")
      .populate("createdBy", "firstName lastName")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      data: editors,
      pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get editor by ID
export const getEditorById = async (req, res) => {
  try {
    const editor = await Editor.findById(req.params.id).select("-password").populate("createdBy", "firstName lastName");
    if (!editor) {
      return res.status(404).json({ success: false, message: "Editor not found" });
    }
    res.status(200).json({ success: true, data: editor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update editor
export const updateEditor = async (req, res) => {
  try {
    const { name, email, permissions, isActive } = req.body;
    const update = {};
    if (name) update.name = name;
    if (email) update.email = email;
    if (permissions) update.permissions = permissions;
    if (isActive !== undefined) update.isActive = isActive;

    const editor = await Editor.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).select("-password");
    if (!editor) {
      return res.status(404).json({ success: false, message: "Editor not found" });
    }
    res.status(200).json({ success: true, data: editor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete editor
export const deleteEditor = async (req, res) => {
  try {
    const editor = await Editor.findByIdAndDelete(req.params.id);
    if (!editor) {
      return res.status(404).json({ success: false, message: "Editor not found" });
    }
    res.status(200).json({ success: true, message: "Editor deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Toggle editor active status
export const toggleEditorStatus = async (req, res) => {
  try {
    const editor = await Editor.findById(req.params.id);
    if (!editor) {
      return res.status(404).json({ success: false, message: "Editor not found" });
    }
    editor.isActive = !editor.isActive;
    await editor.save();
    res.status(200).json({ success: true, data: editor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Reset editor password
export const resetEditorPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }
    const editor = await Editor.findById(req.params.id);
    if (!editor) {
      return res.status(404).json({ success: false, message: "Editor not found" });
    }
    editor.password = password;
    await editor.save();
    res.status(200).json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
