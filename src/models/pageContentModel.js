// models/pageContentModel.js
import mongoose from "mongoose";

const pageContentSchema = mongoose.Schema(
  {
    pageId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      // Format will be pageType-entityId (e.g., category-123, product-456, homepage-homepage)
    },
    pageType: {
      type: String,
      required: true,
      enum: ["category", "product", "homepage", "custom"],
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Update lastUpdated timestamp before saving
pageContentSchema.pre("save", function (next) {
  this.lastUpdated = Date.now();
  next();
});

const PageContent = mongoose.model("PageContent", pageContentSchema);

export default PageContent;
