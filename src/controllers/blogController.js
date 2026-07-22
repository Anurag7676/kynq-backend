import mongoose from "mongoose";
import Blog from "../models/blogModel.js";

// @desc    Create a new blog post
// @route   POST /api/blogs
// @access  Private/Admin
const createBlog = async (req, res) => {
  try {
    const {
      title,
      content,
      excerpt,
      featuredImage,
      category,
      tags,
      status,
      isFeatured,
      commentsEnabled,
      seo,
    } = req.body;

    // Validate required fields
    if (!title || !content || !excerpt || !category) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    // Add author info (from admin auth middleware)
    const authorId = req.admin._id;

    // Create blog
    const blog = await Blog.create({
      title,
      content,
      excerpt,
      featuredImage: featuredImage || { url: "default-blog.jpg", alt: title },
      author: authorId,
      category,
      tags: tags || [],
      status: status || "draft",
      isFeatured: isFeatured || false,
      commentsEnabled: commentsEnabled !== undefined ? commentsEnabled : true,
      seo: seo || {},
    });

    res.status(201).json({
      success: true,
      message: "Blog created successfully",
      blog,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get all published blog posts for public users
// @route   GET /api/blogs
// @access  Public
const getPublicBlogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object - always filter for published and active blogs
    let filter = {
      status: "published",
      isActive: true,
    };

    // Category filter
    if (req.query.category) {
      filter.category = req.query.category;
    }

    // Tag filter
    if (req.query.tag) {
      filter.tags = req.query.tag;
    }

    // Featured filter
    if (req.query.featured) {
      filter.isFeatured = req.query.featured === "true";
    }

    // Search term
    if (req.query.search) {
      filter.$text = { $search: req.query.search };
    }

    // Build sort object
    let sort = {};

    if (req.query.sort) {
      switch (req.query.sort) {
        case "newest":
          sort.publishedAt = -1; // Use publishedAt for public blogs
          break;
        case "oldest":
          sort.publishedAt = 1;
          break;
        case "views":
          sort.views = -1;
          break;
        case "title-asc":
          sort.title = 1;
          break;
        case "title-desc":
          sort.title = -1;
          break;
        default:
          sort.publishedAt = -1;
      }
    } else {
      // Default sort is newest first by publish date
      sort.publishedAt = -1;
    }

    // Select fields if specified
    let selectFields = "";
    if (req.query.select) {
      selectFields = req.query.select.split(",").join(" ");
    }

    // Execute query with pagination
    const blogs = await Blog.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select(selectFields)
      .populate({
        path: "author",
        select: "name email",
      });

    // Get total count for pagination
    const total = await Blog.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: blogs.length,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      blogs,
    });
  } catch (error) {
    console.error("Error in getPublicBlogs:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get all blog posts for admins (including drafts)
// @route   GET /api/blogs/admin/all
// @access  Private/Admin
const getAdminBlogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    let filter = {};

    // Category filter
    if (req.query.category) {
      filter.category = req.query.category;
    }

    // Status filter (admin can filter by status if needed)
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Tag filter
    if (req.query.tag) {
      filter.tags = req.query.tag;
    }

    // Featured filter
    if (req.query.featured) {
      filter.isFeatured = req.query.featured === "true";
    }

    // Search term
    if (req.query.search) {
      filter.$text = { $search: req.query.search };
    }

    // Build sort object
    let sort = {};

    if (req.query.sort) {
      switch (req.query.sort) {
        case "newest":
          sort.createdAt = -1;
          break;
        case "oldest":
          sort.createdAt = 1;
          break;
        case "views":
          sort.views = -1;
          break;
        case "title-asc":
          sort.title = 1;
          break;
        case "title-desc":
          sort.title = -1;
          break;
        default:
          sort.createdAt = -1;
      }
    } else {
      // Default sort is newest first
      sort.createdAt = -1;
    }

    // Select fields if specified
    let selectFields = "";
    if (req.query.select) {
      selectFields = req.query.select.split(",").join(" ");
    }

    // Execute query with pagination
    const blogs = await Blog.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select(selectFields)
      .populate({
        path: "author",
        select: "name email",
      });

    // Get total count for pagination
    const total = await Blog.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: blogs.length,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      blogs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get published blog post by ID for public users
// @route   GET /api/blogs/:id
// @access  Public
const getPublicBlogById = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id).populate({
      path: "author",
      select: "name email",
    });

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    // If blog is not published/active, return 404 for public users
    if (blog.status !== "published" || !blog.isActive) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    // Increment views
    await Blog.findByIdAndUpdate(req.params.id, {
      $inc: { views: 1 },
    });

    res.status(200).json({
      success: true,
      blog,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get any blog post by ID for admin users
// @route   GET /api/blogs/admin/:id
// @access  Private/Admin
const getAdminBlogById = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id).populate({
      path: "author",
      select: "name email",
    });

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    res.status(200).json({
      success: true,
      blog,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get blog post by slug
// @route   GET /api/blogs/slug/:slug
// @access  Public
const getBlogBySlug = async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug }).populate({
      path: "author",
      select: "name email",
    });

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    // If blog is not published/active, return 404 for public users
    if ((blog.status !== "published" || !blog.isActive) && !req.admin) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    // Increment views if not admin
    if (!req.admin) {
      await Blog.findByIdAndUpdate(blog._id, {
        $inc: { views: 1 },
      });
    }

    res.status(200).json({
      success: true,
      blog,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update blog post
// @route   PUT /api/blogs/:id
// @access  Private/Admin
const updateBlog = async (req, res) => {
  try {
    const {
      title,
      content,
      excerpt,
      featuredImage,
      category,
      tags,
      status,
      isFeatured,
      commentsEnabled,
      seo,
      isActive,
    } = req.body;

    let blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    // Set publishedAt if status is changing from draft to published
    let publishedAt = blog.publishedAt;
    if (
      blog.status === "draft" &&
      status === "published" &&
      !blog.publishedAt
    ) {
      publishedAt = Date.now();
    }

    // Prepare update object
    const updateData = {};
    if (title) updateData.title = title;
    if (content) updateData.content = content;
    if (excerpt) updateData.excerpt = excerpt;
    if (featuredImage) updateData.featuredImage = featuredImage;
    if (category) updateData.category = category;
    if (tags) updateData.tags = tags;
    if (status) updateData.status = status;
    if (isFeatured !== undefined) updateData.isFeatured = isFeatured;
    if (commentsEnabled !== undefined)
      updateData.commentsEnabled = commentsEnabled;
    if (seo) updateData.seo = seo;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (publishedAt) updateData.publishedAt = publishedAt;

    // Update blog
    blog = await Blog.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate({
      path: "author",
      select: "name email",
    });

    res.status(200).json({
      success: true,
      message: "Blog updated successfully",
      blog,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Delete blog post
// @route   DELETE /api/blogs/:id
// @access  Private/Admin
const deleteBlog = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    await blog.deleteOne();

    res.status(200).json({
      success: true,
      message: "Blog removed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get featured blog posts
// @route   GET /api/blogs/featured
// @access  Public
const getFeaturedBlogs = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 4;

    const blogs = await Blog.find({
      isFeatured: true,
      status: "published",
      isActive: true,
    })
      .sort({ publishedAt: -1 })
      .limit(limit)
      .populate({
        path: "author",
        select: "name",
      });

    res.status(200).json({
      success: true,
      count: blogs.length,
      blogs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get blog posts by category
// @route   GET /api/blogs/category/:category
// @access  Public
const getBlogsByCategory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const total = await Blog.countDocuments({
      category: req.params.category,
      status: "published",
      isActive: true,
    });

    const blogs = await Blog.find({
      category: req.params.category,
      status: "published",
      isActive: true,
    })
      .skip(skip)
      .limit(limit)
      .sort({ publishedAt: -1 })
      .populate({
        path: "author",
        select: "name",
      });

    res.status(200).json({
      success: true,
      count: blogs.length,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      blogs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Toggle blog's featured status
// @route   PUT /api/blogs/:id/toggle-feature
// @access  Private/Admin
const toggleBlogFeature = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    blog.isFeatured = !blog.isFeatured;
    await blog.save();

    res.status(200).json({
      success: true,
      message: blog.isFeatured
        ? "Blog featured successfully"
        : "Blog unfeatured successfully",
      isFeatured: blog.isFeatured,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Toggle blog's publish status
// @route   PUT /api/blogs/:id/toggle-publish
// @access  Private/Admin
const toggleBlogPublish = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    // Toggle status between draft and published
    blog.status = blog.status === "published" ? "draft" : "published";

    // Set publishedAt date if being published for the first time
    if (blog.status === "published" && !blog.publishedAt) {
      blog.publishedAt = Date.now();
    }

    await blog.save();

    res.status(200).json({
      success: true,
      message:
        blog.status === "published"
          ? "Blog published successfully"
          : "Blog unpublished successfully",
      status: blog.status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get blog statistics
// @route   GET /api/blogs/admin/stats
// @access  Private/Admin
const getBlogStats = async (req, res) => {
  try {
    const stats = {
      totalBlogs: await Blog.countDocuments(),
      publishedBlogs: await Blog.countDocuments({ status: "published" }),
      draftBlogs: await Blog.countDocuments({ status: "draft" }),
      featuredBlogs: await Blog.countDocuments({ isFeatured: true }),
      activeBlogs: await Blog.countDocuments({ isActive: true }),
      totalViews: await Blog.aggregate([
        { $group: { _id: null, totalViews: { $sum: "$views" } } },
      ]),
      categoryDistribution: await Blog.aggregate([
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      topViewedBlogs: await Blog.find()
        .sort("-views")
        .limit(5)
        .select("title slug views"),
    };

    // Clean up totalViews
    stats.totalViews =
      stats.totalViews.length > 0 ? stats.totalViews[0].totalViews : 0;

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

// @desc    Add comment to blog post
// @route   POST /api/blogs/:id/comments
// @access  Private/User
const addBlogComment = async (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: "Please provide comment content",
      });
    }

    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    // Check if comments are enabled
    if (!blog.commentsEnabled) {
      return res.status(400).json({
        success: false,
        message: "Comments are disabled for this blog post",
      });
    }

    // Get user info from authentication
    const userId = req.user._id;
    const userName = `${req.user.firstName} ${req.user.lastName}`;

    // Create comment object
    const comment = {
      user: userId,
      name: userName,
      content,
      isApproved: false, // Admin needs to approve the comment
    };

    // Add comment to blog
    blog.comments.push(comment);
    await blog.save();

    res.status(201).json({
      success: true,
      message: "Comment added successfully (pending approval)",
      comment: blog.comments[blog.comments.length - 1],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Approve/Disapprove blog comment
// @route   PUT /api/blogs/:id/comments/:commentId/toggle-approval
// @access  Private/Admin
const toggleCommentApproval = async (req, res) => {
  try {
    const { id, commentId } = req.params;

    const blog = await Blog.findById(id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    // Find the comment
    const comment = blog.comments.id(commentId);

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: "Comment not found",
      });
    }

    // Toggle approval status
    comment.isApproved = !comment.isApproved;
    await blog.save();

    res.status(200).json({
      success: true,
      message: `Comment ${
        comment.isApproved ? "approved" : "disapproved"
      } successfully`,
      isApproved: comment.isApproved,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Delete blog comment
// @route   DELETE /api/blogs/:id/comments/:commentId
// @access  Private/Admin or User (own comments)
const deleteBlogComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;

    const blog = await Blog.findById(id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Blog not found",
      });
    }

    // Find the comment
    const comment = blog.comments.id(commentId);

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: "Comment not found",
      });
    }

    // Check authorization (admin can delete any comment, user can delete own comments)
    let isAuthorized = false;

    if (req.userType === "admin") {
      isAuthorized = true;
    } else if (
      req.userType === "user" &&
      comment.user.toString() === req.user._id.toString()
    ) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this comment",
      });
    }

    // Remove comment
    blog.comments.pull(commentId);
    await blog.save();

    res.status(200).json({
      success: true,
      message: "Comment removed successfully",
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
  createBlog,
  getPublicBlogs,
  getAdminBlogs,
  getPublicBlogById,
  getAdminBlogById,
  getBlogBySlug,
  updateBlog,
  deleteBlog,
  getFeaturedBlogs,
  getBlogsByCategory,
  toggleBlogFeature,
  toggleBlogPublish,
  getBlogStats,
  addBlogComment,
  toggleCommentApproval,
  deleteBlogComment,
};
