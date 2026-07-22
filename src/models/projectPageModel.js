// models/projectPageModel.js
import mongoose from "mongoose";

const projectPageSchema = mongoose.Schema(
  {
    pageId: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
      required: true,
      unique: true,
    },
    content: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      required: true,
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
projectPageSchema.pre("save", function (next) {
  this.lastUpdated = Date.now();
  next();
});

const ProjectPage = mongoose.model("ProjectPage", projectPageSchema);

export default ProjectPage; 