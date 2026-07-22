import mongoose from "mongoose";
import slugify from "slugify";

const commentSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    name: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const imageSchema = mongoose.Schema({
  url: {
    type: String,
    required: true,
  },
  alt: {
    type: String,
    default: "Blog Image",
  },
});

const blogSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please provide a blog title"],
      trim: true,
      maxlength: [200, "Blog title cannot exceed 200 characters"],
    },
    slug: {
      type: String,
      unique: true,
    },
    content: {
      type: String,
      required: [true, "Please provide blog content"],
    },
    excerpt: {
      type: String,
      required: [true, "Please provide a blog excerpt"],
      maxlength: [500, "Excerpt cannot exceed 500 characters"],
    },
    featuredImage: imageSchema, // Use the imageSchema directly
    images: [imageSchema], // Add array of additional images using imageSchema
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    category: {
      type: String,
      required: [true, "Please specify a blog category"],
      enum: ["News", "Product", "Tutorial", "Company", "Industry", "Other"],
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    views: {
      type: Number,
      default: 0,
    },
    comments: [commentSchema],
    commentsEnabled: {
      type: Boolean,
      default: true,
    },
    numComments: {
      type: Number,
      default: 0,
    },
    seo: {
      metaTitle: String,
      metaDescription: String,
      metaKeywords: [String],
      ogImage: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    publishedAt: {
      type: Date,
    },
    readTime: {
      type: Number, // Read time in minutes
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Create text index for search
blogSchema.index({
  title: "text",
  content: "text",
  excerpt: "text",
  tags: "text",
});

// Create slug from title before saving
blogSchema.pre("save", function (next) {
  if (this.isModified("title")) {
    this.slug = slugify(this.title, { lower: true, strict: true });
  }

  // Set published date when status changes to published
  if (
    this.isModified("status") &&
    this.status === "published" &&
    !this.publishedAt
  ) {
    this.publishedAt = Date.now();
  }

  // Calculate read time (approximate: 200 words per minute)
  if (this.isModified("content")) {
    const wordCount = this.content.split(/\s+/).length;
    this.readTime = Math.ceil(wordCount / 200);
  }

  // Update comments count
  if (this.comments) {
    this.numComments = this.comments.length;
  }

  // Set default featuredImage if not provided
  if (!this.featuredImage || !this.featuredImage.url) {
    this.featuredImage = {
      url: "default-blog.jpg",
      alt: this.title || "Featured Image",
    };
  }

  next();
});

// Virtual for blog URL
blogSchema.virtual("url").get(function () {
  return `/blog/${this.slug}`;
});

const Blog = mongoose.model("Blog", blogSchema);

export default Blog;
