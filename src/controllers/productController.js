




// controllers/productController.js - COMPLETE UPDATED VERSION WITH REQUEST QUOTE SUPPORT
import Product from "../models/productModel.js";
import Category from "../models/categoryModel.js";
import slugify from "slugify";
import mongoose from "mongoose";
import AWS from 'aws-sdk';

// S3 Configuration for image uploads - Using environment variables for security
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'ap-south-1'
});

// Validate AWS credentials
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.warn("⚠️  WARNING: AWS credentials not found in environment variables!");
  console.warn("Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your .env file");
}

const S3_BUCKET = 'styleandhomes';

// Helper function to create a unique SKU
const generateSKU = async (name, category) => {
  // Generate a base SKU from the first 3 letters of the product name and category
  const basePrefix = name.substring(0, 3).toUpperCase();
  const catPrefix = category.name.substring(0, 2).toUpperCase();
  const baseSkuPrefix = `${catPrefix}-${basePrefix}`;

  // Find how many products have this prefix already
  const count = await Product.countDocuments({
    sku: { $regex: `^${baseSkuPrefix}` },
  });

  // Add a random number and the count to make it unique
  const randomNum = Math.floor(Math.random() * 100);
  return `${baseSkuPrefix}-${count + 1}${randomNum}`;
};

// Helper function to validate vendor data
const validateVendorData = (vendorData) => {
  const errors = [];

  if (!vendorData) {
    return errors; // Vendor is optional
  }

  // Validate vendor name if provided
  if (vendorData.vendorName && vendorData.vendorName.trim().length < 2) {
    errors.push("Vendor name must be at least 2 characters long");
  }

  // Validate vendor code if provided
  if (vendorData.vendorCode) {
    if (vendorData.vendorCode.trim().length < 1) {
      errors.push("Vendor code cannot be empty");
    }
  }

  // Validate vendor email if provided
  if (vendorData.vendorEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(vendorData.vendorEmail)) {
      errors.push("Invalid vendor email format");
    }
  }

  // Validate vendor phone if provided
  if (vendorData.vendorPhone) {
    if (vendorData.vendorPhone.trim().length < 10) {
      errors.push("Vendor phone must be at least 10 characters long");
    }
  }

  // Validate vendor cost if provided
  if (vendorData.vendorCost !== undefined && vendorData.vendorCost !== null) {
    const cost = parseFloat(vendorData.vendorCost);
    if (isNaN(cost) || cost < 0) {
      errors.push("Vendor cost must be a valid positive number");
    }
  }

  return errors;
};

// Helper function to validate country of origin data
const validateCountryOfOriginData = (countryData) => {
  const errors = [];

  if (!countryData) {
    return errors; // Country of origin is optional
  }

  // Validate country if provided
  if (countryData.country && countryData.country.trim().length < 2) {
    errors.push("Country name must be at least 2 characters long");
  }

  // Validate country code if provided
  if (countryData.countryCode) {
    if (countryData.countryCode.trim().length !== 2 && countryData.countryCode.trim().length !== 3) {
      errors.push("Country code must be 2 or 3 characters long");
    }
    if (!/^[A-Z]+$/.test(countryData.countryCode.toUpperCase())) {
      errors.push("Country code must contain only letters");
    }
  }

  return errors;
};

// @desc    Create a new product
// @route   POST /api/products
// @access  Private/Admin
const createProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      shortDescription,
      price,
      comparePrice,
      categoryId,
      subcategoryId,
      brand,
      stock,
      variations,
      images,
      tags,
      isFeatured,
      isPublished,
      isRequestQuote, // 🆕 NEW: Request Quote Option
      uom, // 🆕 NEW: UOM field for products
      vendor, // 🆕 NEW: Vendor details
      vendorSku, // 🆕 NEW: Vendor SKU information
      vendorCost, // 🆕 NEW: Vendor cost information
      countryOfOrigin, // 🆕 NEW: Country of origin details
      hsnCode, // 🆕 NEW: HSN Code for Indian tax compliance
      shippingInfo,
      shippingEstimatedTime,
      seo,
    } = req.body;

    // Validate required fields
    if (!name || !description || !categoryId) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields (name, description, category)",
      });
    }

    // 🆕 NEW: Conditional validation based on isRequestQuote
    if (!isRequestQuote && !price) {
      return res.status(400).json({
        success: false,
        message: "Price is required for regular products",
      });
    }

    // 🆕 NEW: Validate vendor data
    const vendorErrors = validateVendorData(vendor);
    if (vendorErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Vendor validation failed",
        errors: vendorErrors,
      });
    }

    // Check if category exists
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Check subcategory if provided
    let subcategory = null;
    if (subcategoryId) {
      subcategory = await Category.findById(subcategoryId);
      if (!subcategory || !subcategory.parent.equals(category._id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid subcategory",
        });
      }
    }

    // Generate slug from name
    const slug = slugify(name, { lower: true });

    // Check if slug already exists
    const existingProduct = await Product.findOne({ slug });
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: "Product with this name already exists",
      });
    }

    // Generate SKU
    const sku = req.body.sku || (await generateSKU(name, category));

    // Note: Vendor code can be shared across multiple products from the same vendor
    // No uniqueness validation needed for vendorCode

    // 🆕 NEW: Handle price and stock based on isRequestQuote
    let productPrice = 0;
    let productComparePrice = 0;
    let productStock = 0;

    if (isRequestQuote) {
      // For request quote products, set price to 0 and stock to unlimited
      productPrice = 0;
      productComparePrice = 0;
      productStock = 999999; // Large number to indicate unlimited availability
    } else {
      // For regular products, use provided values
      productPrice = price || 0;
      productComparePrice = comparePrice || productPrice;
      productStock = stock || 0;
    }

    // 🆕 NEW: Process vendor data
    let processedVendor = null;
    if (vendor) {
      processedVendor = {
        vendorName: vendor.vendorName ? vendor.vendorName.trim() : null,
        vendorCode: vendor.vendorCode ? vendor.vendorCode.trim() : null,
        vendorEmail: vendor.vendorEmail ? vendor.vendorEmail.toLowerCase().trim() : null,
        vendorPhone: vendor.vendorPhone ? vendor.vendorPhone.trim() : null,
        vendorAddress: vendor.vendorAddress ? vendor.vendorAddress.trim() : null,
      };
    }

    // 🆕 NEW: Process country of origin data
    let processedCountryOfOrigin = null;
    if (countryOfOrigin) {
      processedCountryOfOrigin = {
        country: countryOfOrigin.country ? countryOfOrigin.country.trim() : null,
        countryCode: countryOfOrigin.countryCode ? countryOfOrigin.countryCode.toUpperCase().trim() : null,
        region: countryOfOrigin.region ? countryOfOrigin.region.trim() : null,
      };
    }

    // Create product
    const product = await Product.create({
      name,
      slug,
      description,
      shortDescription,
      price: productPrice,
      comparePrice: productComparePrice,
      category: categoryId,
      subcategory: subcategoryId,
      brand,
      sku,
      stock: productStock,
      uom: uom || null, // 🆕 NEW: UOM field for products
      vendorSku: vendorSku || null, // 🆕 NEW: Vendor SKU information
      vendorCost: vendorCost || null, // 🆕 NEW: Vendor cost information
      ...processedVendor, // 🆕 NEW: Vendor details (simple fields)
      ...processedCountryOfOrigin, // 🆕 NEW: Country of origin details
      hsnCode: hsnCode || null, // 🆕 NEW: HSN Code for Indian tax compliance
      variations: variations || [],
      images: images || [],
      tags: tags || [],
      isFeatured: isFeatured || false,
      isPublished: isPublished !== undefined ? isPublished : true,
      isRequestQuote: isRequestQuote || false, // 🆕 NEW: Request Quote Option
      shippingInfo: shippingInfo || {},
      shippingEstimatedTime: shippingEstimatedTime || null,
      seo: seo || {},
      createdBy: req.userType === "admin" ? req.admin._id : null,
    });

    res.status(201).json({
      success: true,
      message: `${isRequestQuote ? 'Request quote product' : 'Product'} created successfully`,
      product,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get all products with filtering, sorting, and pagination
// @route   GET /api/products
// @access  Public
const getProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 1000); // Cap at 1000 items to prevent abuse
    const skip = (page - 1) * limit;

    // Build filter object
    let filter = {};

    // Only show published products to public
    if (!req.userType || req.userType !== "admin") {
      filter.isPublished = true;
    }

    // Add query parameter to see drafts for admin
    if (req.userType === "admin" && req.query.status) {
      if (req.query.status === "draft") {
        filter.isPublished = false;
      } else if (req.query.status === "published") {
        filter.isPublished = true;
      }
      // If status is "all", don't add isPublished filter
    }

    // 🆕 NEW: Filter by product type (regular or quote request)
    if (req.query.productType) {
      if (req.query.productType === "quote") {
        filter.isRequestQuote = true;
      } else if (req.query.productType === "regular") {
        filter.isRequestQuote = false;
      }
      // If productType is "all", don't add filter
    }

    // Category filter with parent/subcategory logic
    // 🆕 NEW: Supports both single category and multiple categories (comma-separated)
    // If parent category ID is provided: show products from parent AND all its subcategories
    // If subcategory ID is provided: show only products from that specific subcategory
    if (req.query.category || req.query.categories) {
      // Support both single 'category' and multiple 'categories' parameters
      const categoryParam = req.query.categories || req.query.category;
      const categoryIds = categoryParam.includes(',') 
        ? categoryParam.split(',').map(id => id.trim())
        : [categoryParam];
      
      // If single category, use simple logic
      if (categoryIds.length === 1) {
        const categoryId = categoryIds[0];
        
        // Check if this is a parent category (has subcategories)
        const category = await Category.findById(categoryId);
        if (category) {
          // Check if this category has subcategories
          const subcategories = await Category.find({ parent: categoryId });
          
          if (subcategories.length > 0) {
            // This is a parent category - include products from parent AND all subcategories
            const allCategoryIds = [categoryId, ...subcategories.map(sub => sub._id)];
            filter.$or = [
              { category: { $in: allCategoryIds } },
              { subcategory: { $in: allCategoryIds } }
            ];
          } else {
            // This is a subcategory or category without children - filter by exact category
            filter.category = categoryId;
          }
        } else {
          // Category not found, return empty results
          filter.category = categoryId;
        }
      } else {
        // Multiple categories - expand each to include subcategories
        const allCategoryIds = [];
        
        for (const categoryId of categoryIds) {
          const category = await Category.findById(categoryId);
          if (category) {
            // Check if this category has subcategories
            const subcategories = await Category.find({ parent: categoryId });
            
            if (subcategories.length > 0) {
              // This is a parent category - include parent and all subcategories
              allCategoryIds.push(categoryId, ...subcategories.map(sub => sub._id));
            } else {
              // This is a subcategory or category without children
              allCategoryIds.push(categoryId);
            }
          } else {
            // Category not found, still include the ID
            allCategoryIds.push(categoryId);
          }
        }
        
        // Remove duplicates
        const uniqueCategoryIds = [...new Set(allCategoryIds)];
        filter.$or = [
          { category: { $in: uniqueCategoryIds } },
          { subcategory: { $in: uniqueCategoryIds } }
        ];
      }
    }

    // Subcategory filter (for specific subcategory filtering)
    if (req.query.subcategory) {
      filter.subcategory = req.query.subcategory;
    }

    // Brand filter
    if (req.query.brand) {
      filter.brand = req.query.brand;
    }

    // Price range filter (only for non-quote products)
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice)
        filter.price.$gte = parseFloat(req.query.minPrice);
      if (req.query.maxPrice)
        filter.price.$lte = parseFloat(req.query.maxPrice);
      
      // Exclude quote request products from price filtering
      filter.isRequestQuote = false;
    }

    // Tag filter
    if (req.query.tag) {
      filter.tags = req.query.tag;
    }

    // Featured filter
    if (req.query.featured) {
      filter.isFeatured = req.query.featured === "true";
    }

    // Search term - Improved fuzzy matching with better scoring
    if (req.query.search) {
      const searchTerm = req.query.search.trim();
      if (searchTerm.length > 0) {
        // For very short searches (1-2 characters), be more restrictive to avoid too many results
        if (searchTerm.length >= 3) {
          filter.$or = [
            { name: { $regex: searchTerm, $options: 'i' } },
            { description: { $regex: searchTerm, $options: 'i' } },
            { shortDescription: { $regex: searchTerm, $options: 'i' } },
            { sku: { $regex: searchTerm, $options: 'i' } },
            { brand: { $regex: searchTerm, $options: 'i' } },
            { tags: { $in: [new RegExp(searchTerm, 'i')] } },
            { uom: { $regex: searchTerm, $options: 'i' } }
          ];
        } else {
          // For short searches, prioritize name and sku matches
          filter.$or = [
            { name: { $regex: searchTerm, $options: 'i' } },
            { sku: { $regex: searchTerm, $options: 'i' } },
            { brand: { $regex: searchTerm, $options: 'i' } }
          ];
        }
      }
    }

    // Stock status filter (only for regular products, quote products are always available)
    if (req.query.stockStatus) {
      // Only apply stock filters to regular products
      filter.isRequestQuote = false;
      
      switch (req.query.stockStatus) {
        case "inStock":
          filter.stock = { $gt: 0 };
          break;
        case "outOfStock":
          filter.stock = { $eq: 0 };
          break;
        case "lowStock":
          filter.stock = { $lte: 10, $gt: 0 };
          break;
        case "available":
          // Include both regular products with stock > 0 and all quote products
          filter.$or = [
            { stock: { $gt: 0 }, isRequestQuote: false },
            { isRequestQuote: true }
          ];
          break;
        default:
          // If invalid stockStatus, don't apply stock filter
          delete filter.isRequestQuote;
      }
    } else if (req.query.inStock) {
      // Backward compatibility with existing inStock parameter
      filter.stock = { $gt: 0 };
      filter.isRequestQuote = false; // Quote products always show as available
    }

    // Build sort object
    let sort = {};

    if (req.query.sort) {
      switch (req.query.sort) {
        case "price-asc":
          sort.price = 1;
          break;
        case "price-desc":
          sort.price = -1;
          break;
        case "newest":
          sort.createdAt = -1;
          break;
        case "oldest":
          sort.createdAt = 1;
          break;
        case "rating":
          sort.rating = -1;
          break;
        case "name-asc":
          sort.name = 1;
          break;
        case "name-desc":
          sort.name = -1;
          break;
        case "stock-asc":
          sort.stock = 1;
          break;
        case "stock-desc":
          sort.stock = -1;
          break;
        case "relevance":
          // For search results, prioritize name matches, then rating, then newest
          if (req.query.search) {
            sort.rating = -1;
            sort.createdAt = -1;
          } else {
            sort.createdAt = -1;
          }
          break;
        default:
          sort.createdAt = -1;
      }
    } else {
      // Default sort: if searching, use relevance, otherwise newest first
      if (req.query.search) {
        sort.rating = -1;
        sort.createdAt = -1;
      } else {
        sort.createdAt = -1;
      }
    }

    // Execute query with pagination
    const products = await Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("category", "name slug")
      .populate("subcategory", "name slug")
      .populate({
        path: "reviews.user",
        select: "firstName lastName",
      });

    // Get total count for pagination
    const totalCount = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    // Enhanced response structure
    res.status(200).json({
      success: true,
      products: products.map(product => ({
        ...product.toObject(),
        productType: product.isRequestQuote ? 'quote' : 'regular', // Add product type indicator
      })),
      count: products.length,
      totalPages,
      currentPage: page,
      totalCount,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get products for admin dashboard with advanced filtering
// @route   GET /api/products/admin/list
// @access  Private/Admin
const getAdminProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Build admin-specific filter
    let filter = {};

    // Status filter (published, draft, all)
    if (req.query.status) {
      if (req.query.status === "draft") {
        filter.isPublished = false;
      } else if (req.query.status === "published") {
        filter.isPublished = true;
      }
      // "all" shows both published and draft
    }

    // 🆕 NEW: Product type filter (regular, quote, all)
    if (req.query.productType) {
      if (req.query.productType === "quote") {
        filter.isRequestQuote = true;
      } else if (req.query.productType === "regular") {
        filter.isRequestQuote = false;
      }
      // "all" shows both types
    }

    // Category filter with parent/subcategory logic
    // If parent category ID is provided: show products from parent AND all its subcategories
    // If subcategory ID is provided: show only products from that specific subcategory
    if (req.query.category) {
      const categoryId = req.query.category;
      
      // Check if this is a parent category (has subcategories)
      const category = await Category.findById(categoryId);
      if (category) {
        // Check if this category has subcategories
        const subcategories = await Category.find({ parent: categoryId });
        
        if (subcategories.length > 0) {
          // This is a parent category - include products from parent AND all subcategories
          const allCategoryIds = [categoryId, ...subcategories.map(sub => sub._id)];
          filter.$or = [
            { category: { $in: allCategoryIds } },
            { subcategory: { $in: allCategoryIds } }
          ];
        } else {
          // This is a subcategory or category without children - filter by exact category
          filter.category = categoryId;
        }
      } else {
        // Category not found, return empty results
        filter.category = categoryId;
      }
    }

    // Brand filter
    if (req.query.brand) {
      filter.brand = req.query.brand;
    }

    // Featured filter
    if (req.query.featured !== undefined) {
      filter.isFeatured = req.query.featured === "true";
    }

    // Stock status filter (only for regular products, quote products are always available)
    if (req.query.stockStatus) {
      // Only apply stock filters to regular products
      filter.isRequestQuote = false;
      
      switch (req.query.stockStatus) {
        case "inStock":
          filter.stock = { $gt: 0 };
          break;
        case "outOfStock":
          filter.stock = { $eq: 0 };
          break;
        case "lowStock":
          filter.stock = { $lte: 10, $gt: 0 };
          break;
        case "available":
          // Include both regular products with stock > 0 and all quote products
          filter.$or = [
            { stock: { $gt: 0 }, isRequestQuote: false },
            { isRequestQuote: true }
          ];
          break;
        default:
          // If invalid stockStatus, don't apply stock filter
          delete filter.isRequestQuote;
      }
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

    // Search term
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { sku: { $regex: req.query.search, $options: 'i' } },
        { description: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    // Sort options
    let sort = {};
    if (req.query.sort) {
      switch (req.query.sort) {
        case "name-asc":
          sort.name = 1;
          break;
        case "name-desc":
          sort.name = -1;
          break;
        case "price-asc":
          sort.price = 1;
          break;
        case "price-desc":
          sort.price = -1;
          break;
        case "stock-asc":
          sort.stock = 1;
          break;
        case "stock-desc":
          sort.stock = -1;
          break;
        case "newest":
          sort.createdAt = -1;
          break;
        case "oldest":
          sort.createdAt = 1;
          break;
        default:
          sort.createdAt = -1;
      }
    } else {
      sort.createdAt = -1;
    }

    // Execute query
    const products = await Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("category", "name slug")
      .populate("subcategory", "name slug")
      .select("-reviews"); // Exclude reviews for admin list view

    const totalCount = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    // Enhanced admin response
    res.status(200).json({
      success: true,
      data: {
        products: products.map(product => ({
          id: product._id,
          name: product.name,
          slug: product.slug,
          sku: product.sku,
          price: product.price,
          stock: product.stock,
          category: product.category,
          subcategory: product.subcategory,
          brand: product.brand,
          isFeatured: product.isFeatured,
          isPublished: product.isPublished,
          isRequestQuote: product.isRequestQuote, // 🆕 NEW: Include request quote flag
          productType: product.isRequestQuote ? 'quote' : 'regular', // 🆕 NEW: Product type indicator
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          featuredImage: product.images.find(img => img.isFeatured)?.url || product.images[0]?.url || null
        })),
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          count: products.length,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          nextPage: page < totalPages ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null
        },
        filters: {
          appliedFilters: {
            status: req.query.status || "all",
            productType: req.query.productType || "all", // 🆕 NEW: Product type filter
            category: req.query.category || null,
            brand: req.query.brand || null,
            featured: req.query.featured || null,
            stockStatus: req.query.stockStatus || null,
            search: req.query.search || null
          }
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get single product by ID or slug
// @route   GET /api/products/:idOrSlug
// @access  Public
const getProduct = async (req, res) => {
  try {
    const idOrSlug = req.params.idOrSlug;
    let product;

    // Check if parameter is a valid MongoDB ID
    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      product = await Product.findById(idOrSlug);
    } else {
      // If not an ID, treat as slug
      product = await Product.findOne({ slug: idOrSlug });
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // If product is not published and requester is not admin, return 404
    if (!product.isPublished && (!req.userType || req.userType !== "admin")) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Populate references
    await product.populate("category", "name slug");
    await product.populate("subcategory", "name slug");
    await product.populate({
      path: "reviews.user",
      select: "firstName lastName profilePicture",
    });

    // 🆕 NEW: Add product type indicator to response
    const productResponse = {
      ...product.toObject(),
      productType: product.isRequestQuote ? 'quote' : 'regular',
    };

    res.status(200).json({
      success: true,
      product: productResponse,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private/Admin
const updateProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      shortDescription,
      price,
      comparePrice,
      categoryId,
      category, // Support both 'category' and 'categoryId' field names
      subcategoryId,
      brand,
      stock,
      variations,
      images,
      tags,
      isFeatured,
      isPublished,
      isRequestQuote, // 🆕 NEW: Request Quote Option
      uom, // 🆕 NEW: UOM field for products
      vendor, // 🆕 NEW: Vendor details
      vendorSku, // 🆕 NEW: Vendor SKU information
      vendorCost, // 🆕 NEW: Vendor cost information
      countryOfOrigin, // 🆕 NEW: Country of origin details
      hsnCode, // 🆕 NEW: HSN Code for Indian tax compliance
      shippingInfo,
      shippingEstimatedTime,
      seo,
    } = req.body;

    // Support both 'category' and 'categoryId' field names
    const finalCategoryId = category || categoryId;

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Store original values to track changes
    const originalValues = {
      name: product.name,
      description: product.description,
      shortDescription: product.shortDescription,
      price: product.price,
      sku: product.sku,
      uom: product.uom, // 🆕 NEW: Track UOM changes
      images: product.images,
      shippingEstimatedTime: product.shippingEstimatedTime,
      isRequestQuote: product.isRequestQuote, // 🆕 NEW: Track quote type changes
      seo: product.seo
    };

    // 🆕 NEW: Validate based on product type change
    const newIsRequestQuote = isRequestQuote !== undefined ? isRequestQuote : product.isRequestQuote;
    
    if (!newIsRequestQuote && !price && !product.price) {
      return res.status(400).json({
        success: false,
        message: "Price is required when converting to regular product",
      });
    }

    // 🆕 NEW: Validate vendor data
    const vendorErrors = validateVendorData(vendor);
    if (vendorErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Vendor validation failed",
        errors: vendorErrors,
      });
    }

    // 🆕 NEW: Validate country of origin data
    const countryErrors = validateCountryOfOriginData(countryOfOrigin);
    if (countryErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Country of origin validation failed",
        errors: countryErrors,
      });
    }

    // Update slug if name is changed
    let slug = product.slug;
    if (name && name !== product.name) {
      slug = slugify(name, { lower: true });

      // Check if new slug already exists on another product
      const existingProduct = await Product.findOne({
        slug,
        _id: { $ne: product._id },
      });

      if (existingProduct) {
        return res.status(400).json({
          success: false,
          message: "Product with this name already exists",
        });
      }
    }

    // Category validation
    if (finalCategoryId) {
      // Convert to ObjectId if it's a string
      const categoryObjectId = typeof finalCategoryId === 'string' 
        ? new mongoose.Types.ObjectId(finalCategoryId) 
        : finalCategoryId;
      
      if (!product.category.equals(categoryObjectId)) {
        const categoryDoc = await Category.findById(categoryObjectId);
        if (!categoryDoc) {
          return res.status(404).json({
            success: false,
            message: "Category not found",
          });
        }
      }
    }

    // Note: Vendor code can be shared across multiple products from the same vendor
    // No uniqueness validation needed for vendorCode

    // Subcategory validation
    if (subcategoryId) {
      const subcategory = await Category.findById(subcategoryId);
      if (!subcategory) {
        return res.status(404).json({
          success: false,
          message: "Subcategory not found",
        });
      }

      const parentCategory = finalCategoryId || product.category;
      if (!subcategory.parent.equals(parentCategory)) {
        return res.status(400).json({
          success: false,
          message: "Subcategory does not belong to the selected category",
        });
      }
    }

    // Update basic product fields
    product.name = name || product.name;
    product.slug = slug;
    product.description = description || product.description;
    product.shortDescription = shortDescription !== undefined ? shortDescription : product.shortDescription;
    product.category = finalCategoryId || product.category;
    product.subcategory = subcategoryId !== undefined ? subcategoryId : product.subcategory;
    product.brand = brand !== undefined ? brand : product.brand;
    product.uom = uom !== undefined ? uom : product.uom; // 🆕 NEW: UOM field for products
    product.vendorSku = vendorSku !== undefined ? vendorSku : product.vendorSku; // 🆕 NEW: Vendor SKU information
    product.vendorCost = vendorCost !== undefined ? vendorCost : product.vendorCost; // 🆕 NEW: Vendor cost information
    product.hsnCode = hsnCode !== undefined ? hsnCode : product.hsnCode; // 🆕 NEW: HSN Code for Indian tax compliance

    // 🆕 NEW: Process vendor data
    if (vendor !== undefined) {
      if (vendor === null) {
        // Clear all vendor fields
        product.vendorName = null;
        product.vendorCode = null;
        product.vendorEmail = null;
        product.vendorPhone = null;
        product.vendorAddress = null;
      } else {
        // Update vendor fields
        product.vendorName = vendor.vendorName ? vendor.vendorName.trim() : product.vendorName;
        product.vendorCode = vendor.vendorCode ? vendor.vendorCode.trim() : product.vendorCode;
        product.vendorEmail = vendor.vendorEmail ? vendor.vendorEmail.toLowerCase().trim() : product.vendorEmail;
        product.vendorPhone = vendor.vendorPhone ? vendor.vendorPhone.trim() : product.vendorPhone;
        product.vendorAddress = vendor.vendorAddress ? vendor.vendorAddress.trim() : product.vendorAddress;
      }
    }

    // 🆕 NEW: Process country of origin data
    if (countryOfOrigin !== undefined) {
      if (countryOfOrigin === null) {
        // Clear all country of origin fields
        product.countryOfOrigin = null;
      } else {
        // Update country of origin fields
        if (!product.countryOfOrigin) {
          product.countryOfOrigin = {};
        }
        product.countryOfOrigin.country = countryOfOrigin.country ? countryOfOrigin.country.trim() : product.countryOfOrigin?.country;
        product.countryOfOrigin.countryCode = countryOfOrigin.countryCode ? countryOfOrigin.countryCode.toUpperCase().trim() : product.countryOfOrigin?.countryCode;
        product.countryOfOrigin.region = countryOfOrigin.region ? countryOfOrigin.region.trim() : product.countryOfOrigin?.region;
      }
    }

    if (variations) product.variations = variations;
    if (images) product.images = images;
    if (tags) product.tags = tags;

    product.isFeatured = isFeatured !== undefined ? isFeatured : product.isFeatured;
    product.isPublished = isPublished !== undefined ? isPublished : product.isPublished;

    // 🆕 NEW: Handle isRequestQuote changes
    if (isRequestQuote !== undefined) {
      product.isRequestQuote = isRequestQuote;
      
      if (isRequestQuote) {
        // Converting to quote request product
        product.price = 0;
        product.comparePrice = 0;
        product.stock = 999999; // Large number for unlimited availability
      } else {
        // Converting to regular product
        product.price = price || product.price || 0;
        product.comparePrice = comparePrice !== undefined ? comparePrice : (product.comparePrice || product.price);
        product.stock = stock !== undefined ? stock : (product.stock === 999999 ? 0 : product.stock);
      }
    } else {
      // Not changing product type, update price and stock normally
      if (!product.isRequestQuote) {
        product.price = price !== undefined ? price : product.price;
        product.comparePrice = comparePrice !== undefined ? comparePrice : product.comparePrice;
        product.stock = stock !== undefined ? stock : product.stock;
      }
    }

    if (shippingInfo) product.shippingInfo = shippingInfo;
    product.shippingEstimatedTime = shippingEstimatedTime !== undefined ? shippingEstimatedTime : product.shippingEstimatedTime;
    
    if (seo) product.seo = seo;

    // Save the updated product
    const updatedProduct = await product.save();

    // Track changes and sync to PageContent
    const changedFields = {};
    
    // Check each field for changes
    if (name && name !== originalValues.name) {
      changedFields.name = name;
    }
    
    if (description && description !== originalValues.description) {
      changedFields.description = description;
    }
    
    if (shortDescription !== undefined && shortDescription !== originalValues.shortDescription) {
      changedFields.shortDescription = shortDescription;
    }
    
    if (updatedProduct.price !== originalValues.price) {
      changedFields.price = updatedProduct.price;
    }

    if (uom !== undefined && uom !== originalValues.uom) {
      changedFields.uom = uom;
    }

    if (shippingEstimatedTime !== undefined && shippingEstimatedTime !== originalValues.shippingEstimatedTime) {
      changedFields.shippingEstimatedTime = shippingEstimatedTime;
    }

    // 🆕 NEW: Track product type changes
    if (updatedProduct.isRequestQuote !== originalValues.isRequestQuote) {
      changedFields.isRequestQuote = updatedProduct.isRequestQuote;
    }
    
    if (images && JSON.stringify(images) !== JSON.stringify(originalValues.images)) {
      changedFields.images = images;
    }
    
    // Check SEO fields
    if (seo) {
      if (seo.metaTitle !== originalValues.seo?.metaTitle) {
        changedFields['seo.metaTitle'] = seo.metaTitle;
      }
      if (seo.metaDescription !== originalValues.seo?.metaDescription) {
        changedFields['seo.metaDescription'] = seo.metaDescription;
      }
      if (seo.metaKeywords && JSON.stringify(seo.metaKeywords) !== JSON.stringify(originalValues.seo?.metaKeywords)) {
        changedFields['seo.metaKeywords'] = seo.metaKeywords;
      }
    }

    // Sync to PageContent if there are changes
    if (Object.keys(changedFields).length > 0) {
      console.log(`[PRODUCT UPDATE] Syncing ${Object.keys(changedFields).length} changed fields to PageContent`);
      
      try {
        const { syncProductToPageContent } = await import("../utils/productToPageContentSync.js");
        const syncResult = await syncProductToPageContent(req.params.id, changedFields);
        console.log(`[PRODUCT UPDATE] Sync result:`, syncResult);
        
        // Add sync info to response
        return res.status(200).json({
          success: true,
          message: `${updatedProduct.isRequestQuote ? 'Request quote product' : 'Product'} updated successfully`,
          product: {
            ...updatedProduct.toObject(),
            productType: updatedProduct.isRequestQuote ? 'quote' : 'regular',
          },
          sync: syncResult
        });
      } catch (syncError) {
        console.error(`[PRODUCT UPDATE] Sync failed but product was updated:`, syncError);
        // Product update succeeded, but sync failed - still return success
        return res.status(200).json({
          success: true,
          message: `${updatedProduct.isRequestQuote ? 'Request quote product' : 'Product'} updated successfully (sync failed)`,
          product: {
            ...updatedProduct.toObject(),
            productType: updatedProduct.isRequestQuote ? 'quote' : 'regular',
          },
          syncError: syncError.message
        });
      }
    }

    // No changes to sync
    res.status(200).json({
      success: true,
      message: `${updatedProduct.isRequestQuote ? 'Request quote product' : 'Product'} updated successfully`,
      product: {
        ...updatedProduct.toObject(),
        productType: updatedProduct.isRequestQuote ? 'quote' : 'regular',
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

// @desc    Manually sync product to page content
// @route   POST /api/products/:id/sync-to-page-content
// @access  Private/Admin
const manualSyncToPageContent = async (req, res) => {
  try {
    const productId = req.params.id;
    
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Sync all product fields
    const allFields = {
      name: product.name,
      description: product.description,
      shortDescription: product.shortDescription,
      price: product.price,
      sku: product.sku,
      images: product.images,
      isRequestQuote: product.isRequestQuote, // 🆕 NEW: Include quote type
    };

    // Add SEO fields if they exist
    if (product.seo?.metaTitle) allFields['seo.metaTitle'] = product.seo.metaTitle;
    if (product.seo?.metaDescription) allFields['seo.metaDescription'] = product.seo.metaDescription;
    if (product.seo?.metaKeywords) allFields['seo.metaKeywords'] = product.seo.metaKeywords;

    const { syncProductToPageContent } = await import("../utils/productToPageContentSync.js");
    const syncResult = await syncProductToPageContent(productId, allFields);
    
    res.status(200).json({
      success: true,
      message: "Product synced to PageContent successfully",
      syncResult
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private/Admin
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    await product.deleteOne();

    res.status(200).json({
      success: true,
      message: "Product removed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Add product review
// @route   POST /api/products/:id/reviews
// @access  Private/User
const addProductReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;

    if (!rating || !comment) {
      return res.status(400).json({
        success: false,
        message: "Please provide rating and comment",
      });
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // 🆕
    // 🆕 NEW: Check if this is a request quote product
    if (product.isRequestQuote) {
      return res.status(400).json({
        success: false,
        message: "Reviews are not allowed for request quote products",
      });
    }

    // Get user info from authorization
    let userId, userName;

    if (req.userType === "user") {
      userId = req.user._id;
      userName = `${req.user.firstName} ${req.user.lastName}`;
    } else {
      return res.status(403).json({
        success: false,
        message: "Only customers can review products",
      });
    }

    // Check if user already reviewed this product
    const alreadyReviewed = product.reviews.find(
      (review) => review.user.toString() === userId.toString()
    );

    if (alreadyReviewed) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this product",
      });
    }

    // Create review object
    const review = {
      user: userId,
      name: userName,
      rating: Number(rating),
      comment,
      isVerified: false, // Admin needs to verify
    };

    // Add review to product
    product.reviews.push(review);

    // Save product (pre-save hook handles rating calculation)
    await product.save();

    res.status(201).json({
      success: true,
      message: "Review added successfully",
      review: product.reviews[product.reviews.length - 1],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update product review
// @route   PUT /api/products/:id/reviews/:reviewId
// @access  Private/User
const updateProductReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const { id, reviewId } = req.params;

    if (!rating && !comment) {
      return res.status(400).json({
        success: false,
        message: "Please provide rating or comment to update",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Find the review
    const review = product.reviews.id(reviewId);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    // Check if the review belongs to the user
    let userId;

    if (req.userType === "user") {
      userId = req.user._id;
    } else if (req.userType === "admin") {
      // Admins can update reviews for moderation
      userId = null;
    } else {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    if (userId && !review.user.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own reviews",
      });
    }

    // Update review
    if (rating) review.rating = Number(rating);
    if (comment) review.comment = comment;

    // If regular user is updating, reset verification
    if (userId) {
      review.isVerified = false;
    }

    await product.save();

    res.status(200).json({
      success: true,
      message: "Review updated successfully",
      review,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Delete product review
// @route   DELETE /api/products/:id/reviews/:reviewId
// @access  Private/User or Admin
const deleteProductReview = async (req, res) => {
  try {
    const { id, reviewId } = req.params;

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Find the review
    const review = product.reviews.id(reviewId);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    // Check authorization
    let isAuthorized = false;

    if (req.userType === "admin") {
      isAuthorized = true; // Admins can delete any review
    } else if (req.userType === "user" && review.user.equals(req.user._id)) {
      isAuthorized = true; // Users can delete their own reviews
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this review",
      });
    }

    // Remove review
    product.reviews.pull(reviewId);
    await product.save();

    res.status(200).json({
      success: true,
      message: "Review removed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get featured products
// @route   GET /api/products/featured
// @access  Public
const getFeaturedProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;

    // 🆕 NEW: Option to filter by product type
    let filter = { 
      isFeatured: true, 
      isPublished: true 
    };

    if (req.query.productType) {
      if (req.query.productType === "quote") {
        filter.isRequestQuote = true;
      } else if (req.query.productType === "regular") {
        filter.isRequestQuote = false;
      }
    }

    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("category", "name slug");

    res.status(200).json({
      success: true,
      count: products.length,
      products: products.map(product => ({
        ...product.toObject(),
        productType: product.isRequestQuote ? 'quote' : 'regular',
      })),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get related products
// @route   GET /api/products/:id/related
// @access  Public
const getRelatedProducts = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const limit = parseInt(req.query.limit) || 4;

    // 🆕 NEW: Find products in the same category with same type (regular/quote)
    const relatedProducts = await Product.find({
      _id: { $ne: product._id },
      category: product.category,
      isPublished: true,
      isRequestQuote: product.isRequestQuote, // Same product type
    })
      .limit(limit)
      .populate("category", "name slug");

    res.status(200).json({
      success: true,
      count: relatedProducts.length,
      products: relatedProducts.map(relatedProduct => ({
        ...relatedProduct.toObject(),
        productType: relatedProduct.isRequestQuote ? 'quote' : 'regular',
      })),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get product reviews
// @route   GET /api/products/:id/reviews
// @access  Public
const getProductReviews = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .select("reviews rating numReviews isRequestQuote")
      .populate({
        path: "reviews.user",
        select: "firstName lastName profilePicture",
      });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // 🆕 NEW: Check if this is a request quote product
    if (product.isRequestQuote) {
      return res.status(200).json({
        success: true,
        message: "Reviews are not available for request quote products",
        rating: 0,
        numReviews: 0,
        reviews: [],
        isRequestQuote: true,
      });
    }

    res.status(200).json({
      success: true,
      rating: product.rating,
      numReviews: product.numReviews,
      reviews: product.reviews,
      isRequestQuote: false,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Verify product review (admin only)
// @route   PUT /api/products/:id/reviews/:reviewId/verify
// @access  Private/Admin
const verifyProductReview = async (req, res) => {
  try {
    const { id, reviewId } = req.params;

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Find the review
    const review = product.reviews.id(reviewId);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    // Only admin can verify reviews
    if (req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to verify reviews",
      });
    }

    // Toggle verification status
    review.isVerified = !review.isVerified;
    await product.save();

    res.status(200).json({
      success: true,
      message: `Review ${
        review.isVerified ? "verified" : "unverified"
      } successfully`,
      review,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update product stock
// @route   PUT /api/products/:id/stock
// @access  Private/Admin
const updateProductStock = async (req, res) => {
  try {
    const { stock } = req.body;

    if (stock === undefined) {
      return res.status(400).json({
        success: false,
        message: "Please provide stock quantity",
      });
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // 🆕 NEW: Check if this is a request quote product
    if (product.isRequestQuote) {
      return res.status(400).json({
        success: false,
        message: "Stock management is not applicable for request quote products",
      });
    }

    product.stock = stock;
    await product.save();

    res.status(200).json({
      success: true,
      message: "Product stock updated successfully",
      stock: product.stock,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
    }
};

// @desc    Toggle product feature status
// @route   PUT /api/products/:id/toggle-feature
// @access  Private/Admin
const toggleProductFeature = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    product.isFeatured = !product.isFeatured;
    await product.save();

    res.status(200).json({
      success: true,
      message: `${product.isRequestQuote ? 'Request quote product' : 'Product'} ${
        product.isFeatured ? "featured" : "unfeatured"
      } successfully`,
      isFeatured: product.isFeatured,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Toggle product publish status
// @route   PUT /api/products/:id/toggle-publish
// @access  Private/Admin
const toggleProductPublish = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    product.isPublished = !product.isPublished;
    await product.save();

    res.status(200).json({
      success: true,
      message: `${product.isRequestQuote ? 'Request quote product' : 'Product'} ${
        product.isPublished ? "published" : "unpublished"
      } successfully`,
      isPublished: product.isPublished,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get product statistics
// @route   GET /api/products/admin/stats
// @access  Private/Admin
const getProductStats = async (req, res) => {
  try {
    const totalProducts = await Product.countDocuments();
    const publishedProducts = await Product.countDocuments({
      isPublished: true,
    });
    const draftProducts = await Product.countDocuments({
      isPublished: false,
    });
    const featuredProducts = await Product.countDocuments({ isFeatured: true });
    const outOfStockProducts = await Product.countDocuments({ 
      stock: 0,
      isRequestQuote: false // Only count regular products for stock
    });
    const lowStockProducts = await Product.countDocuments({ 
      stock: { $lte: 10, $gt: 0 },
      isRequestQuote: false // Only count regular products for stock
    });

    // 🆕 NEW: Product type statistics
    const regularProducts = await Product.countDocuments({ isRequestQuote: false });
    const quoteProducts = await Product.countDocuments({ isRequestQuote: true });

    // 🆕 NEW: UOM statistics
    const uomStats = await Product.aggregate([
      {
        $match: {
          uom: { $exists: true, $ne: null, $ne: "" }
        }
      },
      {
        $group: {
          _id: "$uom",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Group by category
    const categoryStats = await Product.aggregate([
      {
        $group: {
          _id: "$category",
          total: { $sum: 1 },
          published: {
            $sum: { $cond: [{ $eq: ["$isPublished", true] }, 1, 0] }
          },
          draft: {
            $sum: { $cond: [{ $eq: ["$isPublished", false] }, 1, 0] }
          },
          regular: {
            $sum: { $cond: [{ $eq: ["$isRequestQuote", false] }, 1, 0] }
          },
          quote: {
            $sum: { $cond: [{ $eq: ["$isRequestQuote", true] }, 1, 0] }
          }
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "_id",
          as: "categoryInfo",
        },
      },
      {
        $unwind: "$categoryInfo",
      },
      {
        $project: {
          _id: 1,
          name: "$categoryInfo.name",
          total: 1,
          published: 1,
          draft: 1,
          regular: 1,
          quote: 1
        },
      },
      {
        $sort: { total: -1 },
      },
    ]);

    // Get top rated products (only regular products)
    const topRatedProducts = await Product.find({
      rating: { $gt: 0 },
      numReviews: { $gt: 0 },
      isPublished: true,
      isRequestQuote: false // Only regular products have ratings
    })
      .sort({ rating: -1 })
      .limit(5)
      .select("name slug rating numReviews");

    // Recent activity
    const recentProducts = await Product.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("category", "name")
      .select("name sku isPublished isRequestQuote createdAt category");

    // Monthly stats for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyStats = await Product.aggregate([
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
          published: {
            $sum: { $cond: [{ $eq: ["$isPublished", true] }, 1, 0] }
          },
          draft: {
            $sum: { $cond: [{ $eq: ["$isPublished", false] }, 1, 0] }
          },
          regular: {
            $sum: { $cond: [{ $eq: ["$isRequestQuote", false] }, 1, 0] }
          },
          quote: {
            $sum: { $cond: [{ $eq: ["$isRequestQuote", true] }, 1, 0] }
          }
        }
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 }
      }
    ]);

    res.status(200).json({
      success: true,
      stats: {
        overview: {
          totalProducts,
          publishedProducts,
          draftProducts,
          featuredProducts,
          outOfStockProducts,
          lowStockProducts,
          regularProducts, // 🆕 NEW
          quoteProducts, // 🆕 NEW
          publishRate: totalProducts > 0 ? ((publishedProducts / totalProducts) * 100).toFixed(1) : 0
        },
        categoryDistribution: categoryStats,
        uomStats, // 🆕 NEW: UOM statistics
        topRatedProducts,
        recentActivity: recentProducts.map(product => ({
          id: product._id,
          name: product.name,
          sku: product.sku,
          status: product.isPublished ? "Published" : "Draft",
          type: product.isRequestQuote ? "Quote" : "Regular", // 🆕 NEW
          category: product.category?.name || "Unknown",
          createdAt: product.createdAt
        })),
        monthlyTrends: monthlyStats.map(stat => ({
          year: stat._id.year,
          month: stat._id.month,
          monthName: new Date(stat._id.year, stat._id.month - 1).toLocaleString('default', { month: 'long' }),
          total: stat.total,
          published: stat.published,
          draft: stat.draft,
          regular: stat.regular, // 🆕 NEW
          quote: stat.quote // 🆕 NEW
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

// @desc    Bulk update products
// @route   PUT /api/products/admin/bulk-update
// @access  Private/Admin
const bulkUpdateProducts = async (req, res) => {
  try {
    const { productIds, updates } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide product IDs",
      });
    }

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide updates",
      });
    }

    // Only allow certain fields to be bulk updated
    const allowedFields = ['isPublished', 'isFeatured', 'category', 'stock', 'isRequestQuote', 'uom', 'vendorSku']; // 🆕 NEW: Add UOM and vendorSku support
    const filteredUpdates = {};
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        filteredUpdates[key] = value;
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    // 🆕 NEW: Handle bulk conversion to/from request quote
    if (filteredUpdates.isRequestQuote !== undefined) {
      const products = await Product.find({ _id: { $in: productIds } });
      
      for (const product of products) {
        if (filteredUpdates.isRequestQuote) {
          // Converting to quote request product
          product.isRequestQuote = true;
          product.price = 0;
          product.comparePrice = 0;
          product.stock = 999999;
        } else {
          // Converting to regular product - keep existing values or set defaults
          product.isRequestQuote = false;
          if (product.stock === 999999) {
            product.stock = 0; // Reset stock if it was set to unlimited
          }
        }
        
        // Apply other updates
        Object.keys(filteredUpdates).forEach(key => {
          if (key !== 'isRequestQuote') {
            product[key] = filteredUpdates[key];
          }
        });
        
        await product.save();
      }
      
      res.status(200).json({
        success: true,
        message: `Successfully updated ${products.length} products`,
        modifiedCount: products.length,
      });
    } else {
      // Regular bulk update without type conversion
      const result = await Product.updateMany(
        { _id: { $in: productIds } },
        { $set: filteredUpdates }
      );

      res.status(200).json({
        success: true,
        message: `Successfully updated ${result.modifiedCount} products`,
        modifiedCount: result.modifiedCount,
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

// @desc    Bulk delete products
// @route   DELETE /api/products/admin/bulk-delete
// @access  Private/Admin
const bulkDeleteProducts = async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide product IDs",
      });
    }

    const result = await Product.deleteMany({ _id: { $in: productIds } });

    res.status(200).json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} products`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get products by category with pagination
// @route   GET /api/products/category/:categoryId
// @access  Public
const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 12, 1000); // Cap at 1000 items to prevent abuse
    const skip = (page - 1) * limit;

    // Check if category exists
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Build filter with parent/subcategory logic
    let filter = {
      isPublished: true
    };

    // Check if this category has subcategories
    const subcategories = await Category.find({ parent: categoryId });
    
    if (subcategories.length > 0) {
      // This is a parent category - include products from parent AND all subcategories
      const allCategoryIds = [categoryId, ...subcategories.map(sub => sub._id)];
      filter.$or = [
        { category: { $in: allCategoryIds } },
        { subcategory: { $in: allCategoryIds } }
      ];
    } else {
      // This is a subcategory or category without children - filter by exact category
      filter.category = categoryId;
    }

    // 🆕 NEW: Product type filter
    if (req.query.productType) {
      if (req.query.productType === "quote") {
        filter.isRequestQuote = true;
      } else if (req.query.productType === "regular") {
        filter.isRequestQuote = false;
      }
    }

    // Additional filters (only for regular products)
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice) filter.price.$gte = parseFloat(req.query.minPrice);
      if (req.query.maxPrice) filter.price.$lte = parseFloat(req.query.maxPrice);
      filter.isRequestQuote = false; // Price filters only apply to regular products
    }

    if (req.query.brand) {
      filter.brand = req.query.brand;
    }

    // Stock status filter (only for regular products, quote products are always available)
    if (req.query.stockStatus) {
      // Only apply stock filters to regular products
      filter.isRequestQuote = false;
      
      switch (req.query.stockStatus) {
        case "inStock":
          filter.stock = { $gt: 0 };
          break;
        case "outOfStock":
          filter.stock = { $eq: 0 };
          break;
        case "lowStock":
          filter.stock = { $lte: 10, $gt: 0 };
          break;
        case "available":
          // Include both regular products with stock > 0 and all quote products
          filter.$or = [
            { stock: { $gt: 0 }, isRequestQuote: false },
            { isRequestQuote: true }
          ];
          break;
        default:
          // If invalid stockStatus, don't apply stock filter
          delete filter.isRequestQuote;
      }
    } else if (req.query.inStock === 'true') {
      // Backward compatibility with existing inStock parameter
      filter.stock = { $gt: 0 };
      filter.isRequestQuote = false; // Stock filters only apply to regular products
    }

    // Sort options
    let sort = {};
    switch (req.query.sort) {
      case "price-asc":
        sort.price = 1;
        break;
      case "price-desc":
        sort.price = -1;
        break;
      case "newest":
        sort.createdAt = -1;
        break;
      case "rating":
        sort.rating = -1;
        break;
      case "name-asc":
        sort.name = 1;
        break;
      default:
        sort.createdAt = -1;
    }

    const products = await Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("category", "name slug")
      .select("-reviews");

    const totalCount = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      data: {
        category: {
          id: category._id,
          name: category.name,
          slug: category.slug,
          description: category.description
        },
        products: products.map(product => ({
          ...product.toObject(),
          productType: product.isRequestQuote ? 'quote' : 'regular',
        })),
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          count: products.length,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          nextPage: page < totalPages ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Advanced product search
// @route   GET /api/products/search
// @access  Public
const advancedProductSearch = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 12, 1000); // Cap at 1000 items to prevent abuse
    const skip = (page - 1) * limit;

    let filter = { isPublished: true };

    // Text search
    if (req.query.q) {
      filter.$or = [
        { name: { $regex: req.query.q, $options: 'i' } },
        { description: { $regex: req.query.q, $options: 'i' } },
        { tags: { $in: [new RegExp(req.query.q, 'i')] } }
      ];
    }

    // 🆕 NEW: Product type filter
    if (req.query.productType) {
      if (req.query.productType === "quote") {
        filter.isRequestQuote = true;
      } else if (req.query.productType === "regular") {
        filter.isRequestQuote = false;
      }
    }

    // Category filter with parent/subcategory logic
    if (req.query.categories) {
      const categoryIds = req.query.categories.split(',');
      
      // For each category, check if it's a parent and include its subcategories
      const allCategoryIds = [];
      
      for (const categoryId of categoryIds) {
        const category = await Category.findById(categoryId);
        if (category) {
          // Check if this category has subcategories
          const subcategories = await Category.find({ parent: categoryId });
          
          if (subcategories.length > 0) {
            // This is a parent category - include parent and all subcategories
            allCategoryIds.push(categoryId, ...subcategories.map(sub => sub._id));
          } else {
            // This is a subcategory or category without children
            allCategoryIds.push(categoryId);
          }
        } else {
          // Category not found, still include the ID
          allCategoryIds.push(categoryId);
        }
      }
      
      // Remove duplicates
      const uniqueCategoryIds = [...new Set(allCategoryIds)];
      filter.$or = [
        { category: { $in: uniqueCategoryIds } },
        { subcategory: { $in: uniqueCategoryIds } }
      ];
    }

    // Price range (only for regular products)
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice) filter.price.$gte = parseFloat(req.query.minPrice);
      if (req.query.maxPrice) filter.price.$lte = parseFloat(req.query.maxPrice);
      filter.isRequestQuote = false;
    }

    // Brands
    if (req.query.brands) {
      const brands = req.query.brands.split(',');
      filter.brand = { $in: brands };
    }

    // Rating filter (only for regular products)
    if (req.query.minRating) {
      filter.rating = { $gte: parseFloat(req.query.minRating) };
      filter.isRequestQuote = false;
    }

    // Stock status filter (only for regular products, quote products are always available)
    if (req.query.stockStatus) {
      // Only apply stock filters to regular products
      filter.isRequestQuote = false;
      
      switch (req.query.stockStatus) {
        case "inStock":
          filter.stock = { $gt: 0 };
          break;
        case "outOfStock":
          filter.stock = { $eq: 0 };
          break;
        case "lowStock":
          filter.stock = { $lte: 10, $gt: 0 };
          break;
        case "available":
          // Include both regular products with stock > 0 and all quote products
          filter.$or = [
            { stock: { $gt: 0 }, isRequestQuote: false },
            { isRequestQuote: true }
          ];
          break;
        default:
          // If invalid stockStatus, don't apply stock filter
          delete filter.isRequestQuote;
      }
    } else if (req.query.inStock === 'true') {
      // Backward compatibility with existing inStock parameter
      filter.stock = { $gt: 0 };
      filter.isRequestQuote = false;
    }

    // Featured filter
    if (req.query.featured === 'true') {
      filter.isFeatured = true;
    }

    // Sort
    let sort = {};
    switch (req.query.sort) {
      case "price-asc":
        sort.price = 1;
        break;
      case "price-desc":
        sort.price = -1;
        break;
      case "rating":
        sort.rating = -1;
        break;
      case "newest":
        sort.createdAt = -1;
        break;
      case "popular":
        sort.numReviews = -1;
        break;
      default:
        sort.createdAt = -1;
    }

    const products = await Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("category", "name slug")
      .select("-reviews");

    const totalCount = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    // Get available filters for frontend
    const availableFilters = await Product.aggregate([
      { $match: { isPublished: true } },
      {
        $group: {
          _id: null,
          categories: { $addToSet: "$category" },
          brands: { $addToSet: "$brand" },
          minPrice: { $min: "$price" },
          maxPrice: { $max: "$price" },
          hasRegularProducts: { $sum: { $cond: [{ $eq: ["$isRequestQuote", false] }, 1, 0] } },
          hasQuoteProducts: { $sum: { $cond: [{ $eq: ["$isRequestQuote", true] }, 1, 0] } }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        products: products.map(product => ({
          ...product.toObject(),
          productType: product.isRequestQuote ? 'quote' : 'regular',
        })),
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          count: products.length,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          nextPage: page < totalPages ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null
        },
        filters: availableFilters[0] || {
          categories: [],
          brands: [],
          minPrice: 0,
          maxPrice: 0,
          hasRegularProducts: 0,
          hasQuoteProducts: 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get single product by ID for admin (bypasses published status)
// @route   GET /api/products/admin/edit/:id
// @access  Private/Admin
const getAdminProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    // Validate if it's a valid MongoDB ID
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    // Admin can see any product regardless of published status
    const product = await Product.findById(productId)
      .populate("category", "name slug description")
      .populate("subcategory", "name slug description")
      .populate({
        path: "reviews.user",
        select: "firstName lastName profilePicture",
      });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      product: {
        ...product.toObject(),
        productType: product.isRequestQuote ? 'quote' : 'regular',
      },
      meta: {
        isPublished: product.isPublished,
        isFeatured: product.isFeatured,
        isRequestQuote: product.isRequestQuote, // 🆕 NEW: Include quote type
        stockStatus: product.isRequestQuote ? 'Quote Product' : (product.stock > 0 ? 'In Stock' : 'Out of Stock'),
        lastModified: product.updatedAt,
        totalReviews: product.numReviews,
        averageRating: product.rating
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get field mappings for sync
// @route   GET /api/products/admin/field-mappings
// @access  Private/Admin
const getFieldMappings = async (req, res) => {
  try {
    const { getFieldMappings } = await import("../utils/productToPageContentSync.js");
    const mappings = getFieldMappings();
    
    res.status(200).json({
      success: true,
      mappings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// 🆕 NEW: Get products by type (regular or quote)
// @desc    Get products by type
// @route   GET /api/products/type/:type
// @access  Public
const getProductsByType = async (req, res) => {
  try {
    const { type } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 12, 1000); // Cap at 1000 items to prevent abuse
    const skip = (page - 1) * limit;

    // Validate type parameter
    if (!['regular', 'quote'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product type. Use 'regular' or 'quote'",
      });
    }

    // Build filter
    let filter = {
      isPublished: true,
      isRequestQuote: type === 'quote'
    };

    // Additional filters
    if (req.query.category) {
      filter.category = req.query.category;
    }

    if (req.query.brand) {
      filter.brand = req.query.brand;
    }

    if (req.query.featured === 'true') {
      filter.isFeatured = true;
    }

    // Price filters only for regular products
    if (type === 'regular' && (req.query.minPrice || req.query.maxPrice)) {
      filter.price = {};
      if (req.query.minPrice) filter.price.$gte = parseFloat(req.query.minPrice);
      if (req.query.maxPrice) filter.price.$lte = parseFloat(req.query.maxPrice);
    }

    // Stock status filter (only for regular products, quote products are always available)
    if (req.query.stockStatus) {
      if (type === 'regular') {
        // Only apply stock filters to regular products
        switch (req.query.stockStatus) {
          case "inStock":
            filter.stock = { $gt: 0 };
            break;
          case "outOfStock":
            filter.stock = { $eq: 0 };
            break;
          case "lowStock":
            filter.stock = { $lte: 10, $gt: 0 };
            break;
          case "available":
            // For regular products, available means stock > 0
            filter.stock = { $gt: 0 };
            break;
          default:
            // If invalid stockStatus, don't apply stock filter
            break;
        }
      }
      // For quote products, stock status doesn't apply as they're always available
    } else if (type === 'regular' && req.query.inStock === 'true') {
      // Backward compatibility with existing inStock parameter
      filter.stock = { $gt: 0 };
    }

    // Search
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { description: { $regex: req.query.search, $options: 'i' } },
        { tags: { $in: [new RegExp(req.query.search, 'i')] } }
      ];
    }

    // Sort
    let sort = {};
    switch (req.query.sort) {
      case "price-asc":
        sort.price = 1;
        break;
      case "price-desc":
        sort.price = -1;
        break;
      case "newest":
        sort.createdAt = -1;
        break;
      case "rating":
        sort.rating = -1;
        break;
      case "name-asc":
        sort.name = 1;
        break;
      default:
        sort.createdAt = -1;
    }

    const products = await Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("category", "name slug")
      .select("-reviews");

    const totalCount = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      data: {
        productType: type,
        products: products.map(product => ({
          ...product.toObject(),
          productType: type,
        })),
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          count: products.length,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          nextPage: page < totalPages ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// 🆕 NEW: Toggle product type (regular <-> quote)
// @desc    Toggle product type between regular and quote
// @route   PUT /api/products/admin/:id/toggle-type
// @access  Private/Admin
const toggleProductType = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const wasQuoteProduct = product.isRequestQuote;
    
    // Toggle the type
    product.isRequestQuote = !product.isRequestQuote;

    if (product.isRequestQuote) {
      // Converting to quote request product
      product.price = 0;
      product.comparePrice = 0;
      product.stock = 999999; // Unlimited availability
    } else {
      // Converting to regular product
      // Keep existing values but reset stock if it was unlimited
      if (product.stock === 999999) {
        product.stock = 0;
      }
      // Price needs to be set by admin later if it's 0
    }

    await product.save();

    res.status(200).json({
      success: true,
      message: `Product converted from ${wasQuoteProduct ? 'quote request' : 'regular'} to ${product.isRequestQuote ? 'quote request' : 'regular'} successfully`,
      product: {
        ...product.toObject(),
        productType: product.isRequestQuote ? 'quote' : 'regular',
      },
      conversionInfo: {
        from: wasQuoteProduct ? 'quote' : 'regular',
        to: product.isRequestQuote ? 'quote' : 'regular',
        notice: product.isRequestQuote 
          ? "Product converted to quote request. Price set to 0 and stock set to unlimited."
          : "Product converted to regular. Please update price if needed."
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// 🆕 NEW: Get products by vendor
// @desc    Get products by vendor code
// @route   GET /api/products/vendor/:vendorCode
// @access  Public
const getProductsByVendor = async (req, res) => {
  try {
    const vendorCode = req.params.vendorCode.toUpperCase();
    
    // Build filter
    const filter = { "vendor.vendorCode": vendorCode };
    
    // For non-admin users, only show published products
    if (!req.userType || req.userType !== "admin") {
      filter.isPublished = true;
    }

    const products = await Product.find(filter)
      .populate('category', 'name')
      .populate('subcategory', 'name')
      .sort({ name: 1 });

    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No products found for this vendor",
      });
    }

    // Get vendor info from first product
    const vendorInfo = products[0].getVendorSummary();

    res.status(200).json({
      success: true,
      vendorInfo,
      count: products.length,
      products,
    });

  } catch (error) {
    console.error("Error fetching products by vendor:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// 🆕 NEW: Get vendor statistics
// @desc    Get vendor statistics
// @route   GET /api/products/admin/vendor-stats
// @access  Private/Admin
const getVendorStats = async (req, res) => {
  try {
    const stats = await Product.getVendorStats();

    res.status(200).json({
      success: true,
      count: stats.length,
      stats,
    });
  } catch (error) {
    console.error("Error fetching vendor stats:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// 🆕 NEW: Generate presigned URL for image upload
// @desc    Generate presigned URL for image upload
// @route   GET /api/products/admin/image-upload-url
// @access  Private/Admin
const getImageUploadUrl = async (req, res) => {
  try {
    const { fileName, fileType } = req.query;
    
    if (!fileName || !fileType) {
      return res.status(400).json({
        success: false,
        message: "fileName and fileType are required"
      });
    }

    // Validate that it's an image file
    const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!validImageTypes.includes(fileType.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Only image files are allowed"
      });
    }

    // Clean filename - remove special characters
    const cleanName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    const key = `uploads/${timestamp}-${cleanName}`;
    
    const signedUrl = s3.getSignedUrl('putObject', {
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: fileType,
      Expires: 300, // 5 minutes
    });

    // Return the URL that will be accessible after upload
    const publicUrl = `https://${S3_BUCKET}.s3.ap-south-1.amazonaws.com/${key}`;

    res.status(200).json({
      success: true,
      signedUrl,
      key,
      url: publicUrl, // The final URL after upload
      expiresIn: 300
    });
  } catch (error) {
    console.error("Error generating image upload URL:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate upload URL",
      error: error.message
    });
  }
};

export {
  createProduct,
  getProducts,
  getAdminProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  addProductReview,
  updateProductReview,
  deleteProductReview,
  getFeaturedProducts,
  getRelatedProducts,
  getProductReviews,
  verifyProductReview,
  updateProductStock,
  toggleProductFeature,
  toggleProductPublish,
  getProductStats,
  bulkUpdateProducts,
  bulkDeleteProducts,
  getProductsByCategory,
  advancedProductSearch,
  getAdminProduct,
  manualSyncToPageContent,
  getFieldMappings,
  getProductsByType, // 🆕 NEW
  toggleProductType, // 🆕 NEW
  getProductsByVendor, // 🆕 NEW: Vendor-related endpoints
  getVendorStats, // 🆕 NEW: Vendor-related endpoints
  getImageUploadUrl, // 🆕 NEW: Image upload presigned URL
};