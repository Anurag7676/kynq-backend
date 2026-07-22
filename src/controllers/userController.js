
// controllers/userController.js
import jwt from "jsonwebtoken";
import User from "../models/userModel.js";
import {
  generateOTP,
  calculateOTPExpiry,
  verifyOTP,
} from "../utils/otpUtils.js";
import { sendOTPEmail, sendPasswordResetOTP } from "../config/emailConfig.js";

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "30d", // Long-lived token (30 days)
  });
};

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    // Check if user already exists
    const userExists = await User.findOne({ email });

    if (userExists) {
      // If user exists and is already verified, return error
      if (userExists.isVerified) {
        return res.status(400).json({
          success: false,
          message: "User with this email already exists. Please login instead.",
          code: "USER_EXISTS_VERIFIED",
        });
      }

      // If user exists but is NOT verified, update their info and resend OTP
      // This handles the case where user refreshed page after registration
      const otp = generateOTP();
      const otpExpiry = calculateOTPExpiry();

      // Update user info (in case they want to change password or other details)
      userExists.firstName = firstName;
      userExists.lastName = lastName;
      userExists.password = password; // Will be hashed by pre-save hook
      if (phone) userExists.phone = phone;
      userExists.otpCode = otp;
      userExists.otpExpiry = otpExpiry;
      await userExists.save();

      // Send verification email
      await sendOTPEmail(email, firstName, otp);

      return res.status(200).json({
        success: true,
        message:
          "Account found but email not verified. A new verification OTP has been sent to your email address.",
        user: {
          id: userExists._id,
          firstName: userExists.firstName,
          lastName: userExists.lastName,
          email: userExists.email,
          isVerified: userExists.isVerified,
        },
        code: "RESENT_OTP",
      });
    }

    // Generate OTP for email verification
    const otp = generateOTP();
    const otpExpiry = calculateOTPExpiry();

    // Create user
    const user = await User.create({
      firstName,
      lastName,
      email,
      password,
      phone,
      otpCode: otp,
      otpExpiry,
    });

    // Send verification email
    await sendOTPEmail(email, firstName, otp);

    // Return success response (without sending JWT since unverified)
    res.status(201).json({
      success: true,
      message:
        "User registered successfully. Please verify your email with the OTP sent to your email address.",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isVerified: user.isVerified,
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

// @desc    Verify user email with OTP
// @route   POST /api/users/verify-otp
// @access  Public
const verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and OTP",
      });
    }

    // Find user with email and include OTP fields
    const user = await User.findOne({ email }).select("+otpCode +otpExpiry");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if already verified
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    // Verify OTP
    if (!verifyOTP(user.otpCode, user.otpExpiry, otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    // Update user verification status
    user.isVerified = true;
    user.otpCode = undefined;
    user.otpExpiry = undefined;
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Return verified status and token
    res.status(200).json({
      success: true,
      message: "Email verified successfully",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isVerified: user.isVerified,
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

// @desc    Resend verification OTP
// @route   POST /api/users/resend-otp
// @access  Public
const resendVerificationOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide email",
      });
    }

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if already verified
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = calculateOTPExpiry();

    // Update user OTP
    user.otpCode = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Send verification email
    await sendOTPEmail(email, user.firstName, otp);

    res.status(200).json({
      success: true,
      message: "Verification OTP has been sent to your email",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Check user verification status
// @route   POST /api/users/check-verification
// @access  Public
const checkVerificationStatus = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide email",
      });
    }

    const user = await User.findOne({ email }).select("email isVerified isActive");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      isVerified: user.isVerified,
      isActive: user.isActive,
      message: user.isVerified
        ? "Email is verified. You can login."
        : "Email is not verified. Please verify your email to login.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password",
      });
    }

    // Find user by email
    const user = await User.findOne({ email }).select("+password");

    // Check if user exists
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Check if user is verified
    if (!user.isVerified) {
      return res.status(401).json({
        success: false,
        message: "Email not verified. Please verify your email first. You can request a new OTP by calling the resend-otp endpoint.",
        code: "EMAIL_NOT_VERIFIED",
        canResendOTP: true,
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Account is deactivated. Please contact support.",
      });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Update last login time
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Return response
    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        lastLogin: user.lastLogin,
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

// @desc    Forgot password - send OTP
// @route   POST /api/users/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please provide email",
      });
    }

    // Find user
    const user = await User.findOne({ email });

    // Check if user exists
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User does not exist",
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: "Account is deactivated. Please contact support.",
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = calculateOTPExpiry();

    // Save OTP to user
    user.otpCode = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Send password reset email
    await sendPasswordResetOTP(email, user.firstName, otp);

    res.status(200).json({
      success: true,
      message: "Password reset OTP has been sent to your email",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Verify reset password OTP
// @route   POST /api/users/verify-reset-otp
// @access  Public
const verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and OTP",
      });
    }

    // Find user
    const user = await User.findOne({ email }).select("+otpCode +otpExpiry");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User does not exist",
      });
    }

    // Verify OTP
    if (!verifyOTP(user.otpCode, user.otpExpiry, otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    res.status(200).json({
      success: true,
      message: "OTP verified successfully. You can now reset your password.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Reset password
// @route   POST /api/users/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body;

    if (!email || !otp || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email, OTP, and new password",
      });
    }

    // Find user
    const user = await User.findOne({ email }).select("+otpCode +otpExpiry");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User does not exist",
      });
    }

    // Verify OTP
    if (!verifyOTP(user.otpCode, user.otpExpiry, otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    // Update password
    user.password = password;
    user.otpCode = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message:
        "Password reset successfully. You can now login with your new password.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    // Get the correct user based on userType
    let user;
    if (req.userType === "user") {
      user = await User.findById(req.user._id);
    } else if (req.userType === "admin") {
      user = await User.findById(req.admin._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        profilePicture: user.profilePicture,
        addresses: user.addresses,
        role: user.role,
        isVerified: user.isVerified,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
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

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const { firstName, lastName, phone, profilePicture } = req.body;

    // Get the correct user based on userType
    let user;
    if (req.userType === "user") {
      user = await User.findById(req.user._id);
    } else if (req.userType === "admin") {
      user = await User.findById(req.admin._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update fields if provided
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;
    if (profilePicture) user.profilePicture = profilePicture;

    // Save updated user
    await user.save();

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        profilePicture: user.profilePicture,
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

// @desc    Change password
// @route   PUT /api/users/change-password
// @access  Private
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide current and new password",
      });
    }

    // Get the correct user based on userType
    let user;
    if (req.userType === "user") {
      user = await User.findById(req.user._id).select("+password");
    } else if (req.userType === "admin") {
      user = await User.findById(req.admin._id).select("+password");
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if current password matches
    const isMatch = await user.matchPassword(currentPassword);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Add user address
// @route   POST /api/users/addresses
const addAddress = async (req, res) => {
  try {
    const { 
      fullName, 
      street, 
      city, 
      state, 
      zipCode, 
      country, 
      phoneNumber, 
      isDefault, 
      addressType 
    } = req.body;

    // Validate required fields
    if (!fullName || !street || !city || !state || !zipCode || !country || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Please provide all address fields including full name and phone number",
      });
    }

    // Get the correct user based on userType
    let user;
    if (req.userType === "user") {
      user = await User.findById(req.user._id);
    } else if (req.userType === "admin") {
      user = await User.findById(req.admin._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Create new address
    const newAddress = {
      fullName,
      street,
      city,
      state,
      zipCode,
      country,
      phoneNumber,
      addressType: addressType || "both",
      isDefault: isDefault || false,
    };

    // If this address is set as default, unset any existing default addresses
    if (newAddress.isDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    // Add address to user
    user.addresses.push(newAddress);
    await user.save();

    res.status(201).json({
      success: true,
      message: "Address added successfully",
      address: user.addresses[user.addresses.length - 1],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get all user addresses
// @route   GET /api/users/addresses
// @access  Private
const getUserAddresses = async (req, res) => {
  try {
    // Get the correct user based on userType
    let user;
    if (req.userType === "user") {
      user = await User.findById(req.user._id);
    } else if (req.userType === "admin") {
      user = await User.findById(req.admin._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      count: user.addresses.length,
      addresses: user.addresses,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update address
// @route   PUT /api/users/addresses/:id
// @access  Private
const updateAddress = async (req, res) => {
  try {
    const addressId = req.params.id;
    const { 
      fullName, 
      street, 
      city, 
      state, 
      zipCode, 
      country, 
      phoneNumber, 
      isDefault, 
      addressType 
    } = req.body;

    // Get the correct user based on userType
    let user;
    if (req.userType === "user") {
      user = await User.findById(req.user._id);
    } else if (req.userType === "admin") {
      user = await User.findById(req.admin._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find the address in the user's addresses array
    const address = user.addresses.id(addressId);

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    // Update address fields
    if (fullName) address.fullName = fullName;
    if (street) address.street = street;
    if (city) address.city = city;
    if (state) address.state = state;
    if (zipCode) address.zipCode = zipCode;
    if (country) address.country = country;
    if (phoneNumber) address.phoneNumber = phoneNumber;
    if (addressType) address.addressType = addressType;

    // Handle default address setting
    if (isDefault && !address.isDefault) {
      // Unset other default addresses first
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
      address.isDefault = true;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      address,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Delete address
// @route   DELETE /api/users/addresses/:id
// @access  Private
const deleteAddress = async (req, res) => {
  try {
    const addressId = req.params.id;

    // Get the correct user based on userType
    let user;
    if (req.userType === "user") {
      user = await User.findById(req.user._id);
    } else if (req.userType === "admin") {
      user = await User.findById(req.admin._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find the address index
    const addressIndex = user.addresses.findIndex(
      (addr) => addr._id.toString() === addressId
    );

    if (addressIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    // Remove the address using splice
    user.addresses.splice(addressIndex, 1);
    await user.save();

    res.status(200).json({
      success: true,
      message: "Address removed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Set default address
// @route   PUT /api/users/addresses/:id/set-default
// @access  Private
const setDefaultAddress = async (req, res) => {
  try {
    const addressId = req.params.id;

    // Get the correct user based on userType
    let user;
    if (req.userType === "user") {
      user = await User.findById(req.user._id);
    } else if (req.userType === "admin") {
      user = await User.findById(req.admin._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find the address
    const address = user.addresses.id(addressId);

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    // Unset current default address
    user.addresses.forEach((addr) => {
      addr.isDefault = false;
    });

    // Set new default address
    address.isDefault = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Default address updated successfully",
      address,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Deactivate user account
// @route   PUT /api/users/deactivate
// @access  Private
const deactivateAccount = async (req, res) => {
  try {
    // Get the correct user based on userType
    let user;
    if (req.userType === "user") {
      user = await User.findById(req.user._id);
    } else if (req.userType === "admin") {
      user = await User.findById(req.admin._id);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    user.isActive = false;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Account deactivated successfully",
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
// ADMIN OPERATIONS ON USERS
// ========================================

// @desc    Get all users (admin only)
// @route   GET /api/users/admin/all
// @access  Private/Admin
const getAllUsers = async (req, res) => {
  try {
    const pageSize = Number(req.query.pageSize) || 20;
    const page = Number(req.query.page) || 1;

    // Build filter
    const filter = {};

    // Filter by role
    if (req.query.role) {
      filter.role = req.query.role;
    }

    // Filter by verification status
    if (req.query.isVerified !== undefined) {
      filter.isVerified = req.query.isVerified === 'true';
    }

    // Filter by active status
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    // Search by name or email
    if (req.query.search) {
      const searchRegex = { $regex: req.query.search, $options: 'i' };
      filter.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
      ];
    }

    // Date range filter
    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate),
      };
    }

    const count = await User.countDocuments(filter);

    // Determine sort order
    let sort = { createdAt: -1 }; // Default: newest first

    if (req.query.sort) {
      switch (req.query.sort) {
        case 'oldest':
          sort = { createdAt: 1 };
          break;
        case 'name':
          sort = { firstName: 1, lastName: 1 };
          break;
        case 'email':
          sort = { email: 1 };
          break;
        case 'lastLogin':
          sort = { lastLogin: -1 };
          break;
      }
    }

    const users = await User.find(filter)
      .select('-password -otpCode -otpExpiry')
      .sort(sort)
      .limit(pageSize)
      .skip(pageSize * (page - 1));

    res.status(200).json({
      success: true,
      count,
      pages: Math.ceil(count / pageSize),
      page,
      users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get user by ID (admin only)
// @route   GET /api/users/admin/:id
// @access  Private/Admin
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -otpCode -otpExpiry');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update user details (admin only)
// @route   PUT /api/users/admin/:id
// @access  Private/Admin
const updateUserById = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      role,
      isVerified,
      isActive,
      profilePicture,
    } = req.body;

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if email is being changed and if it already exists
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: "Email already exists",
        });
      }
      user.email = email;
      // If email is changed, mark as unverified
      user.isVerified = false;
    }

    // Update fields if provided
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;
    if (role) user.role = role;
    if (isVerified !== undefined) user.isVerified = isVerified;
    if (isActive !== undefined) user.isActive = isActive;
    if (profilePicture) user.profilePicture = profilePicture;

    await user.save();

    // Return updated user without sensitive fields
    const updatedUser = await User.findById(user._id).select('-password -otpCode -otpExpiry');

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Delete user (admin only)
// @route   DELETE /api/users/admin/:id
// @access  Private/Admin
const deleteUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Prevent admin from deleting themselves
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete your own account",
      });
    }

    // Prevent deleting other admins (optional safety check)
    if (user.role === 'admin' && req.user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: "Cannot delete another admin account",
      });
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Activate user (admin only)
// @route   PUT /api/users/admin/:id/activate
// @access  Private/Admin
const activateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.isActive) {
      return res.status(400).json({
        success: false,
        message: "User is already active",
      });
    }

    user.isActive = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: "User activated successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isActive: user.isActive,
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

// @desc    Deactivate user (admin only)
// @route   PUT /api/users/admin/:id/deactivate
// @access  Private/Admin
const deactivateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Prevent admin from deactivating themselves
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot deactivate your own account",
      });
    }

    // Prevent deactivating other admins (optional safety check)
    if (user.role === 'admin' && req.user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: "Cannot deactivate another admin account",
      });
    }

    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: "User is already inactive",
      });
    }

    user.isActive = false;
    await user.save();

    res.status(200).json({
      success: true,
      message: "User deactivated successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isActive: user.isActive,
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

// @desc    Reset user password (admin only)
// @route   PUT /api/users/admin/:id/reset-password
// @access  Private/Admin
const resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide new password",
      });
    }

    // Validate password length (you can add more validation as needed)
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    const user = await User.findById(req.params.id).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update password (the pre-save hook will hash it)
    user.password = newPassword;
    user.otpCode = undefined; // Clear any existing OTP
    user.otpExpiry = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: "User password reset successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
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

// @desc    Get user statistics (admin only)
// @route   GET /api/users/admin/stats
// @access  Private/Admin
const getUserStats = async (req, res) => {
  try {
    // Get current date ranges
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thisWeekStart = new Date();
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
    thisWeekStart.setHours(0, 0, 0, 0);

    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

    // Total users
    const totalUsers = await User.countDocuments();

    // Active vs Inactive users
    const activeUsers = await User.countDocuments({ isActive: true });
    const inactiveUsers = await User.countDocuments({ isActive: false });

    // Verified vs Unverified users
    const verifiedUsers = await User.countDocuments({ isVerified: true });
    const unverifiedUsers = await User.countDocuments({ isVerified: false });

    // Users by role
    const usersByRole = await User.aggregate([
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ]);

    // New users today
    const newUsersToday = await User.countDocuments({
      createdAt: { $gte: today },
    });

    // New users this week
    const newUsersThisWeek = await User.countDocuments({
      createdAt: { $gte: thisWeekStart },
    });

    // New users this month
    const newUsersThisMonth = await User.countDocuments({
      createdAt: { $gte: thisMonthStart },
    });

    // New users last month
    const newUsersLastMonth = await User.countDocuments({
      createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd },
    });

    // Calculate growth percentage
    const monthlyGrowth = newUsersLastMonth > 0 
      ? ((newUsersThisMonth - newUsersLastMonth) / newUsersLastMonth * 100).toFixed(1)
      : newUsersThisMonth > 0 ? 100 : 0;

    // Users registration by day for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyRegistrations = await User.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Recent logins (users who logged in within last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentActiveUsers = await User.countDocuments({
      lastLogin: { $gte: sevenDaysAgo },
    });

    // Compile statistics
    const stats = {
      totalUsers,
      activeUsers,
      inactiveUsers,
      verifiedUsers,
      unverifiedUsers,
      usersByRole,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      newUsersLastMonth,
      monthlyGrowth: parseFloat(monthlyGrowth),
      recentActiveUsers,
      dailyRegistrations,
      // Additional metrics
      verificationRate: totalUsers > 0 ? ((verifiedUsers / totalUsers) * 100).toFixed(1) : 0,
      activeRate: totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : 0,
    };

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Export users data (admin only)
// @route   GET /api/users/admin/export
// @access  Private/Admin
const exportUsers = async (req, res) => {
  try {
    const { format = 'json', fields } = req.query;

    // Build filter from query params (same as getAllUsers)
    const filter = {};

    if (req.query.role) {
      filter.role = req.query.role;
    }

    if (req.query.isVerified !== undefined) {
      filter.isVerified = req.query.isVerified === 'true';
    }

    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    if (req.query.search) {
      const searchRegex = { $regex: req.query.search, $options: 'i' };
      filter.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
      ];
    }

    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate),
      };
    }

    // Determine which fields to export
    let selectFields = '-password -otpCode -otpExpiry';
    if (fields) {
      selectFields = fields.split(',').join(' ');
    }

    const users = await User.find(filter)
      .select(selectFields)
      .sort({ createdAt: -1 });

    if (format === 'csv') {
      // Convert to CSV format
      let csv = '';
      if (users.length > 0) {
        // Headers
        const headers = Object.keys(users[0].toObject());
        csv += headers.join(',') + '\n';

        // Data rows
        users.forEach(user => {
          const values = headers.map(header => {
            let value = user[header];
            if (value === null || value === undefined) {
              return '';
            }
            if (typeof value === 'object') {
              value = JSON.stringify(value);
            }
            // Escape quotes and wrap in quotes if contains comma
            value = String(value).replace(/"/g, '""');
            if (value.includes(',') || value.includes('\n') || value.includes('"')) {
              value = `"${value}"`;
            }
            return value;
          });
          csv += values.join(',') + '\n';
        });
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="users-export-${Date.now()}.csv"`);
      res.send(csv);
    } else {
      // Default JSON format
      res.status(200).json({
        success: true,
        count: users.length,
        exportDate: new Date().toISOString(),
        users,
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

// @desc    Bulk update users (admin only)
// @route   PUT /api/users/admin/bulk-update
// @access  Private/Admin
const bulkUpdateUsers = async (req, res) => {
  try {
    const { userIds, updates } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of user IDs",
      });
    }

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide updates to apply",
      });
    }

    // Validate allowed update fields
    const allowedFields = ['isActive', 'isVerified', 'role'];
    const updateFields = Object.keys(updates);
    const invalidFields = updateFields.filter(field => !allowedFields.includes(field));

    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid update fields: ${invalidFields.join(', ')}. Allowed fields: ${allowedFields.join(', ')}`,
      });
    }

    // Prevent updating own account in bulk operations
    if (userIds.includes(req.user._id.toString())) {
      return res.status(400).json({
        success: false,
        message: "Cannot include your own account in bulk operations",
      });
    }

    // Perform bulk update
    const result = await User.updateMany(
      { _id: { $in: userIds } },
      { $set: updates }
    );

    res.status(200).json({
      success: true,
      message: `Successfully updated ${result.modifiedCount} users`,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
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
};