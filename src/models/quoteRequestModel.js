// models/quoteRequestModel.js
import mongoose from "mongoose";

const quoteRequestSchema = mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Product",
    },
    
    // User Information
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },
    company: {
      type: String,
      trim: true,
    },
    
    // Quote Details
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
      maxlength: [1000, "Message cannot exceed 1000 characters"],
    },
    specifications: {
      type: String,
      trim: true,
      maxlength: [2000, "Specifications cannot exceed 2000 characters"],
    },
    
    // Selected Variations (if any)
    selectedVariations: [{
      variationName: String,
      selectedOption: String,
    }],
    
    // Preferred Timeline
    preferredTimeline: {
      type: String,
      enum: ["urgent", "1-2weeks", "1month", "flexible"],
      default: "flexible",
    },
    
    // Budget Range (optional)
    budgetRange: {
      min: {
        type: Number,
        min: 0,
      },
      max: {
        type: Number,
        min: 0,
      },
    },
    
    // Status Management
    status: {
      type: String,
      enum: ["pending", "reviewed", "contacted", "completed", "cancelled"],
      default: "pending",
    },
    
    // Internal Notes (Admin Only)
    internalNotes: {
      type: String,
      trim: true,
    },
    
    // Priority Level
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    
    // Admin who last updated this quote
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
quoteRequestSchema.index({ email: 1 });
quoteRequestSchema.index({ product: 1 });
quoteRequestSchema.index({ status: 1 });
quoteRequestSchema.index({ createdAt: -1 });
quoteRequestSchema.index({ priority: 1, status: 1 });

// Virtual for full name
quoteRequestSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for status display
quoteRequestSchema.virtual("statusDisplay").get(function () {
  const statusMap = {
    pending: "Pending Review",
    reviewed: "Under Review",
    contacted: "Customer Contacted",
    completed: "Completed",
    cancelled: "Cancelled"
  };
  return statusMap[this.status] || this.status;
});

// Virtual for priority display
quoteRequestSchema.virtual("priorityDisplay").get(function () {
  const priorityMap = {
    low: "Low Priority",
    medium: "Medium Priority", 
    high: "High Priority",
    urgent: "Urgent"
  };
  return priorityMap[this.priority] || this.priority;
});

const QuoteRequest = mongoose.model("QuoteRequest", quoteRequestSchema);

export default QuoteRequest;