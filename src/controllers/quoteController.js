// controllers/quoteController.js
import QuoteRequest from "../models/quoteRequestModel.js";
import Product from "../models/productModel.js";
import mongoose from "mongoose";

// Import email service
import { sendEmail } from "../config/emailConfig.js";
import { 
  sendQuoteRequestConfirmationTemplate, 
  sendQuoteRequestNotificationTemplate 
} from "../templates/quoteTemplates.js";

// @desc    Create a new quote request
// @route   POST /api/quotes/request
// @access  Public
const createQuoteRequest = async (req, res) => {
  try {
    const {
      productId,
      firstName,
      lastName,
      email,
      phone,
      company,
      quantity,
      message,
      specifications,
      selectedVariations,
      preferredTimeline,
      budgetRange,
    } = req.body;

    // Validate required fields
    if (!productId || !firstName  || !email || !phone || !quantity || !message) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    // Check if product exists and is a request quote product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (!product.isRequestQuote) {
      return res.status(400).json({
        success: false,
        message: "This product is not available for quote requests",
      });
    }

    // Create quote request
    const quoteRequest = await QuoteRequest.create({
      product: productId,
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone,
      company,
      quantity,
      message,
      specifications,
      selectedVariations: selectedVariations || [],
      preferredTimeline: preferredTimeline || "flexible",
      budgetRange: budgetRange || {},
    });

    // Populate the created quote request
    await quoteRequest.populate("product", "name slug sku images");

    // Send confirmation email to user
    try {
      const { subject, text, html } = sendQuoteRequestConfirmationTemplate(
        `${firstName} ${lastName}`,
        product.name,
        quoteRequest._id
      );
      
      await sendEmail({
        to: email,
        subject,
        text,
        html,
      });
      
      console.log(`✅ Quote confirmation email sent to ${email}`);
    } catch (emailError) {
      console.error(`❌ Failed to send confirmation email to ${email}:`, emailError);
      // Don't fail the quote creation if email fails
    }

    // Send notification email to admin
    try {
      const { subject, text, html } = sendQuoteRequestNotificationTemplate(
        quoteRequest,
        product.name
      );
      
      const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USERNAME;
      
      await sendEmail({
        to: adminEmail,
        subject,
        text,
        html,
      });
      
      console.log(`✅ Quote notification email sent to admin: ${adminEmail}`);
    } catch (emailError) {
      console.error(`❌ Failed to send admin notification email:`, emailError);
      // Don't fail the quote creation if email fails
    }

    res.status(201).json({
      success: true,
      message: "Quote request submitted successfully. You'll receive a confirmation email shortly!",
      quoteRequest: {
        id: quoteRequest._id,
        product: quoteRequest.product,
        quantity: quoteRequest.quantity,
        status: quoteRequest.status,
        statusDisplay: quoteRequest.statusDisplay,
        createdAt: quoteRequest.createdAt,
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

// ====================================
// ADMIN ENDPOINTS
// ====================================

// @desc    Get all quote requests (Admin)
// @route   GET /api/quotes/admin/all
// @access  Private/Admin
// const getAdminQuoteRequests = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = Math.min(parseInt(req.query.limit) || 20, 100);
//     const skip = (page - 1) * limit;

//     // Build filter
//     let filter = {};

//     // Status filter
//     if (req.query.status && req.query.status !== "all") {
//       filter.status = req.query.status;
//     }

//     // Priority filter
//     if (req.query.priority && req.query.priority !== "all") {
//       filter.priority = req.query.priority;
//     }

//     // Product filter
//     if (req.query.productId) {
//       filter.product = req.query.productId;
//     }

//     // Date range filter
//     if (req.query.startDate || req.query.endDate) {
//       filter.createdAt = {};
//       if (req.query.startDate) {
//         filter.createdAt.$gte = new Date(req.query.startDate);
//       }
//       if (req.query.endDate) {
//         filter.createdAt.$lte = new Date(req.query.endDate);
//       }
//     }

//     // Search filter
//     if (req.query.search) {
//       filter.$or = [
//         { firstName: { $regex: req.query.search, $options: 'i' } },
//         { lastName: { $regex: req.query.search, $options: 'i' } },
//         { email: { $regex: req.query.search, $options: 'i' } },
//         { company: { $regex: req.query.search, $options: 'i' } },
//       ];
//     }

//     // Sort options
//     let sort = {};
//     switch (req.query.sort) {
//       case "newest":
//         sort.createdAt = -1;
//         break;
//       case "oldest":
//         sort.createdAt = 1;
//         break;
//       case "priority":
//         sort.priority = 1;
//         sort.createdAt = 1;
//         break;
//       case "status":
//         sort.status = 1;
//         sort.createdAt = -1;
//         break;
//       default:
//         sort.priority = 1;
//         sort.createdAt = 1; // High priority and oldest first
//     }

//     const quoteRequests = await QuoteRequest.find(filter)
//       .populate("product", "name slug sku images category")
//       .populate("product.category", "name")
//       .populate("lastUpdatedBy", "firstName lastName")
//       .sort(sort)
//       .skip(skip)
//       .limit(limit);

//     const totalCount = await QuoteRequest.countDocuments(filter);
//     const totalPages = Math.ceil(totalCount / limit);

//     // Get stats
//     const stats = await QuoteRequest.aggregate([
//       {
//         $group: {
//           _id: "$status",
//           count: { $sum: 1 },
//         },
//       },
//     ]);

//     const statusStats = {};
//     stats.forEach(stat => {
//       statusStats[stat._id] = stat.count;
//     });

//     res.status(200).json({
//       success: true,
//       data: {
//         quoteRequests: quoteRequests.map(quote => ({
//           id: quote._id,
//           customer: {
//             name: quote.fullName,
//             email: quote.email,
//             phone: quote.phone,
//             company: quote.company,
//           },
//           product: {
//             id: quote.product._id,
//             name: quote.product.name,
//             slug: quote.product.slug,
//             sku: quote.product.sku,
//             image: quote.product.images[0]?.url || null,
//             category: quote.product.category?.name || "Unknown",
//           },
//           quantity: quote.quantity,
//           message: quote.message,
//           status: quote.status,
//           statusDisplay: quote.statusDisplay,
//           priority: quote.priority,
//           priorityDisplay: quote.priorityDisplay,
//           preferredTimeline: quote.preferredTimeline,
//           budgetRange: quote.budgetRange,
//           createdAt: quote.createdAt,
//           updatedAt: quote.updatedAt,
//           lastUpdatedBy: quote.lastUpdatedBy ? {
//             name: `${quote.lastUpdatedBy.firstName} ${quote.lastUpdatedBy.lastName}`
//           } : null,
//         })),
//         pagination: {
//           currentPage: page,
//           totalPages,
//           totalCount,
//           count: quoteRequests.length,
//           limit,
//           hasNextPage: page < totalPages,
//           hasPrevPage: page > 1,
//         },
//         stats: {
//           total: totalCount,
//           pending: statusStats.pending || 0,
//           reviewed: statusStats.reviewed || 0,
//           contacted: statusStats.contacted || 0,
//           completed: statusStats.completed || 0,
//           cancelled: statusStats.cancelled || 0,
//         },
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// };


// @desc    Get all quote requests (Admin)
// @route   GET /api/quotes/admin/all
// @access  Private/Admin
const getAdminQuoteRequests = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Build filter
    let filter = {};

    // Status filter
    if (req.query.status && req.query.status !== "all") {
      filter.status = req.query.status;
    }

    // Priority filter
    if (req.query.priority && req.query.priority !== "all") {
      filter.priority = req.query.priority;
    }

    // Product filter
    if (req.query.productId) {
      filter.product = req.query.productId;
    }

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    // Search filter
    if (req.query.search) {
      filter.$or = [
        { firstName: { $regex: req.query.search, $options: 'i' } },
        { lastName: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } },
        { company: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    // Sort options
    let sort = {};
    switch (req.query.sort) {
      case "newest":
        sort.createdAt = -1;
        break;
      case "oldest":
        sort.createdAt = 1;
        break;
      case "priority":
        sort.priority = 1;
        sort.createdAt = 1;
        break;
      case "status":
        sort.status = 1;
        sort.createdAt = -1;
        break;
      default:
        sort.priority = 1;
        sort.createdAt = 1; // High priority and oldest first
    }

    const quoteRequests = await QuoteRequest.find(filter)
      .populate("product", "name slug sku images category")
      .populate("lastUpdatedBy", "firstName lastName")
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const totalCount = await QuoteRequest.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    // Get stats
    const stats = await QuoteRequest.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statusStats = {};
    stats.forEach(stat => {
      statusStats[stat._id] = stat.count;
    });

    res.status(200).json({
      success: true,
      data: {
        quoteRequests: quoteRequests.map(quote => ({
          id: quote._id,
          customer: {
            name: quote.fullName,
            email: quote.email,
            phone: quote.phone,
            company: quote.company,
          },
          product: quote.product ? {
            id: quote.product._id,
            name: quote.product.name,
            slug: quote.product.slug,
            sku: quote.product.sku,
            image: quote.product.images && quote.product.images[0] ? quote.product.images[0].url : null,
            category: quote.product.category?.name || "Unknown",
          } : {
            id: null,
            name: "Product Deleted",
            slug: null,
            sku: "N/A",
            image: null,
            category: "Unknown",
          },
          quantity: quote.quantity,
          message: quote.message,
          status: quote.status,
          statusDisplay: quote.statusDisplay,
          priority: quote.priority,
          priorityDisplay: quote.priorityDisplay,
          preferredTimeline: quote.preferredTimeline,
          budgetRange: quote.budgetRange,
          createdAt: quote.createdAt,
          updatedAt: quote.updatedAt,
          lastUpdatedBy: quote.lastUpdatedBy ? {
            name: `${quote.lastUpdatedBy.firstName} ${quote.lastUpdatedBy.lastName}`
          } : null,
        })),
        pagination: {
          currentPage: page,
          totalPages,
          totalPages,
          totalCount,
          count: quoteRequests.length,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        stats: {
          total: totalCount,
          pending: statusStats.pending || 0,
          reviewed: statusStats.reviewed || 0,
          contacted: statusStats.contacted || 0,
          completed: statusStats.completed || 0,
          cancelled: statusStats.cancelled || 0,
        },
      },
    });
  } catch (error) {
    console.error('Error in getAdminQuoteRequests:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get single quote request for admin
// @route   GET /api/quotes/admin/:id
// @access  Private/Admin
const getAdminQuoteRequestDetails = async (req, res) => {
  try {
    const quoteRequest = await QuoteRequest.findById(req.params.id)
      .populate("product", "name slug sku images description category variations")
      .populate("product.category", "name")
   .populate("lastUpdatedBy", "firstName lastName email");

    if (!quoteRequest) {
      return res.status(404).json({
        success: false,
        message: "Quote request not found",
      });
    }

    res.status(200).json({
      success: true,
      quoteRequest,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update quote request (Admin)
// @route   PUT /api/quotes/admin/:id
// @access  Private/Admin
const updateAdminQuoteRequest = async (req, res) => {
  try {
    const {
      status,
      priority,
      internalNotes,
    } = req.body;

    const quoteRequest = await QuoteRequest.findById(req.params.id);

    if (!quoteRequest) {
      return res.status(404).json({
        success: false,
        message: "Quote request not found",
      });
    }

    // Update basic fields
    if (status) quoteRequest.status = status;
    if (priority) quoteRequest.priority = priority;
    if (internalNotes !== undefined) quoteRequest.internalNotes = internalNotes;

    // Track who updated this quote
    quoteRequest.lastUpdatedBy = req.admin._id;

    await quoteRequest.save();

    // Populate for response
    await quoteRequest.populate("lastUpdatedBy", "firstName lastName");

    res.status(200).json({
      success: true,
      message: "Quote request updated successfully",
      quoteRequest,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Delete quote request (Admin)
// @route   DELETE /api/quotes/admin/:id
// @access  Private/Admin
const deleteQuoteRequest = async (req, res) => {
  try {
    const quoteRequest = await QuoteRequest.findById(req.params.id);

    if (!quoteRequest) {
      return res.status(404).json({
        success: false,
        message: "Quote request not found",
      });
    }

    await quoteRequest.deleteOne();

    res.status(200).json({
      success: true,
      message: "Quote request deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get quote request statistics (Admin)
// @route   GET /api/quotes/admin/stats
// @access  Private/Admin
const getQuoteRequestStats = async (req, res) => {
  try {
    const totalQuotes = await QuoteRequest.countDocuments();
    const pendingQuotes = await QuoteRequest.countDocuments({ status: "pending" });
    const reviewedQuotes = await QuoteRequest.countDocuments({ status: "reviewed" });
    const contactedQuotes = await QuoteRequest.countDocuments({ status: "contacted" });
    const completedQuotes = await QuoteRequest.countDocuments({ status: "completed" });
    const cancelledQuotes = await QuoteRequest.countDocuments({ status: "cancelled" });

    // Monthly stats for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyStats = await QuoteRequest.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          total: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
          },
          reviewed: {
            $sum: { $cond: [{ $eq: ["$status", "reviewed"] }, 1, 0] }
          },
          contacted: {
            $sum: { $cond: [{ $eq: ["$status", "contacted"] }, 1, 0] }
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
          }
        }
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 }
      }
    ]);

    // Top requested products
    const topProducts = await QuoteRequest.aggregate([
      {
        $group: {
          _id: "$product",
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "productInfo"
        }
      },
      {
        $unwind: "$productInfo"
      },
      {
        $project: {
          _id: 1,
          name: "$productInfo.name",
          sku: "$productInfo.sku",
          count: 1
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 5
      }
    ]);

    // Priority distribution
    const priorityStats = await QuoteRequest.aggregate([
      {
        $group: {
          _id: "$priority",
          count: { $sum: 1 }
        }
      }
    ]);

    const priorityDistribution = {};
    priorityStats.forEach(stat => {
      priorityDistribution[stat._id] = stat.count;
    });

    // Recent activity (last 10 quote requests)
    const recentActivity = await QuoteRequest.find()
      .populate("product", "name sku")
      .populate("lastUpdatedBy", "firstName lastName")
      .sort({ updatedAt: -1 })
      .limit(10)
      .select("firstName lastName email status priority updatedAt product lastUpdatedBy");

    res.status(200).json({
      success: true,
      stats: {
        overview: {
          totalQuotes,
          pendingQuotes,
          reviewedQuotes,
          contactedQuotes,
          completedQuotes,
          cancelledQuotes,
          completionRate: totalQuotes > 0 ? ((completedQuotes / totalQuotes) * 100).toFixed(1) : 0
        },
        priorityDistribution: {
          urgent: priorityDistribution.urgent || 0,
          high: priorityDistribution.high || 0,
          medium: priorityDistribution.medium || 0,
          low: priorityDistribution.low || 0
        },
        monthlyTrends: monthlyStats.map(stat => ({
          year: stat._id.year,
          month: stat._id.month,
          monthName: new Date(stat._id.year, stat._id.month - 1).toLocaleString('default', { month: 'long' }),
          total: stat.total,
          pending: stat.pending,
          reviewed: stat.reviewed,
          contacted: stat.contacted,
          completed: stat.completed
        })),
        topRequestedProducts: topProducts,
        recentActivity: recentActivity.map(quote => ({
          id: quote._id,
          customer: `${quote.firstName} ${quote.lastName}`,
          email: quote.email,
          product: quote.product?.name || "Unknown Product",
          sku: quote.product?.sku || "N/A",
          status: quote.status,
          priority: quote.priority,
          updatedAt: quote.updatedAt,
          lastUpdatedBy: quote.lastUpdatedBy ? 
            `${quote.lastUpdatedBy.firstName} ${quote.lastUpdatedBy.lastName}` : 
            "System"
        }))
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
  createQuoteRequest,
  getAdminQuoteRequests,
  getAdminQuoteRequestDetails,
  updateAdminQuoteRequest,
  deleteQuoteRequest,
  getQuoteRequestStats,
};