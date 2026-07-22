


// middleware/authMiddleware.js (Enhanced version)
import jwt from "jsonwebtoken";
import Admin from "../models/adminModel.js";
import User from "../models/userModel.js";
import Editor from "../models/editorModel.js";

const auth = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized, no token provided",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if it's an Admin first
    let admin = await Admin.findById(decoded.id).select("-password");
    if (admin) {
      req.admin = admin;
      req.userType = "admin";
      next();
      return;
    }

    // Check if it's an Editor second
    let editor = await Editor.findById(decoded.id).select("-password");
    if (editor) {
      if (!editor.isActive) {
        return res.status(401).json({
          success: false,
          message: "Account is deactivated",
        });
      }

      req.editor = editor;
      req.userType = "editor";
      next();
      return;
    }

    // Check if it's a regular User third
    const user = await User.findById(decoded.id).select("-password");
    if (user) {
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: "Account is deactivated",
        });
      }

      req.user = user;
      req.userType = "user";
      next();
      return;
    }

    // If no user found
    return res.status(401).json({
      success: false,
      message: "Not authorized, user not found",
    });

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Not authorized, token failed",
    });
  }
};

const optionalAuth = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    // No token provided, but that's OK - continue as guest
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check Admin first
    let admin = await Admin.findById(decoded.id).select("-password");
    if (admin) {
      req.admin = admin;
      req.userType = "admin";
      next();
      return;
    }

    // Check Editor second
    let editor = await Editor.findById(decoded.id).select("-password");
    if (editor) {
      if (editor.isActive) {
        req.editor = editor;
        req.userType = "editor";
      }
      next();
      return;
    }

    // Check User third
    const user = await User.findById(decoded.id).select("-password");
    if (user) {
      if (user.isActive) {
        req.user = user;
        req.userType = "user";
      }
    }
  } catch (error) {
    // Invalid token, but that's OK - continue as guest
  }

  // Always continue to the next middleware
  next();
};

export { auth, optionalAuth };