import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const addressSchema = mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
    },
    street: {
      type: String,
      required: [true, "Street address is required"],
    },
    city: {
      type: String,
      required: [true, "City is required"],
    },
    state: {
      type: String,
      required: [true, "State is required"],
    },
    zipCode: {
      type: String,
      required: [true, "Zip code is required"],
    },
    country: {
      type: String,
      required: [true, "Country is required"],
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      validate: {
        validator: function(v) {
          // Remove all non-digit characters and check if we have 10-15 digits
          const digitsOnly = v.replace(/\D/g, '');
          return digitsOnly.length >= 10 && digitsOnly.length <= 15;
        },
        message: 'Please enter a valid phone number'
      }
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    addressType: {
      type: String,
      enum: ["shipping", "billing", "both"],
      default: "both",
    },
  },
  { timestamps: true }
);

const userSchema = mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please add a valid email",
      ],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    phone: {
      type: String,
      match: [/^\+?[1-9]\d{9,14}$/, "Please enter a valid phone number"],
    },
    profilePicture: {
      type: String,
      default: "default-profile.jpg",
    },
    addresses: [addressSchema],
    role: {
      type: String,
      enum: ["user", "admin", "editor"],
      default: "user",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    otpCode: {
      type: String,
      select: false,
    },
    otpExpiry: {
      type: Date,
      select: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    // Added for Stripe integration
    stripeCustomerId: {
      type: String,
      default: null,
    },
    // Payment methods - just references to avoid storing sensitive data
    savedPaymentMethods: [
      {
        paymentMethodId: String,
        brand: String, // visa, mastercard, etc.
        last4: String,
        expMonth: Number,
        expYear: Number,
        isDefault: {
          type: Boolean,
          default: false,
        },
      },
    ],
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);

  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.isValidOTP = function (otp) {
  return this.otpCode === otp && this.otpExpiry > new Date();
};

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.methods.getDefaultAddress = function () {
  return this.addresses.find((address) => address.isDefault);
};

// Method to get default payment method
userSchema.methods.getDefaultPaymentMethod = function () {
  return this.savedPaymentMethods.find((method) => method.isDefault);
};

// Method to add a new payment method
userSchema.methods.addPaymentMethod = function (paymentMethod) {
  // Check if payment method already exists
  const existingIndex = this.savedPaymentMethods.findIndex(
    (method) => method.paymentMethodId === paymentMethod.paymentMethodId
  );

  if (existingIndex > -1) {
    // Update existing payment method
    this.savedPaymentMethods[existingIndex] = {
      ...this.savedPaymentMethods[existingIndex],
      ...paymentMethod,
    };
  } else {
    // Add new payment method
    // If this is first payment method, make it default
    if (this.savedPaymentMethods.length === 0) {
      paymentMethod.isDefault = true;
    }

    this.savedPaymentMethods.push(paymentMethod);
  }

  return this;
};

// Method to set a payment method as default
userSchema.methods.setDefaultPaymentMethod = function (paymentMethodId) {
  // Reset all payment methods to non-default
  this.savedPaymentMethods.forEach((method) => {
    method.isDefault = false;
  });

  // Set specified payment method as default
  const methodIndex = this.savedPaymentMethods.findIndex(
    (method) => method.paymentMethodId === paymentMethodId
  );

  if (methodIndex > -1) {
    this.savedPaymentMethods[methodIndex].isDefault = true;
    return true;
  }

  return false;
};

const User = mongoose.model("User", userSchema);

export default User;