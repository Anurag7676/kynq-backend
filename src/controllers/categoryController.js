



// controllers/categoryController.js - ENHANCED VERSION
import Category from "../models/categoryModel.js";
import Product from "../models/productModel.js";
import slugify from "slugify";
import mongoose from "mongoose";

// Helper function to cascade category status to products
const cascadeCategoryStatusToProducts = async (categoryId, isActive, session = null) => {
  try {
    console.log(`[CATEGORY CASCADE] Processing category ${categoryId}, isActive: ${isActive}`);

    // Find all subcategories recursively
    const allAffectedCategories = await getAllSubcategoriesRecursively(categoryId);
    allAffectedCategories.push(categoryId);

    console.log(`[CATEGORY CASCADE] Affected categories: ${allAffectedCategories.length}`);

    if (!isActive) {
      const updateResult = await Product.updateMany(
        {
          $or: [
            { category: { $in: allAffectedCategories } },
            { subcategory: { $in: allAffectedCategories } }
          ]
        },
        {
          $set: {
            isPublished: false,
            updatedAt: new Date()
          }
        },
        { session }
      );

      console.log(`[CATEGORY CASCADE] Moved ${updateResult.modifiedCount} products to draft`);
      return {
        success: true,
        action: 'moved_to_draft',
        productsAffected: updateResult.modifiedCount,
        categoriesAffected: allAffectedCategories.length
      };
    } else {
      const draftProductsCount = await Product.countDocuments({
        $or: [
          { category: { $in: allAffectedCategories } },
          { subcategory: { $in: allAffectedCategories } }
        ],
        isPublished: false
      });

      return {
        success: true,
        action: 'category_activated',
        productsAffected: 0,
        draftProductsAvailable: draftProductsCount,
        message: `Category activated. ${draftProductsCount} draft products are available for manual publishing.`
      };
    }
  } catch (error) {
    console.error(`[CATEGORY CASCADE] Error:`, error);
    throw error;
  }
};

// Helper function to get all subcategories recursively
const getAllSubcategoriesRecursively = async (parentId) => {
  const subcategories = await Category.find({ parent: parentId }).select('_id');
  let allSubcategories = subcategories.map(sub => sub._id);

  for (const subcategory of subcategories) {
    const nestedSubcategories = await getAllSubcategoriesRecursively(subcategory._id);
    allSubcategories = allSubcategories.concat(nestedSubcategories);
  }

  return allSubcategories;
};



// Helper function to validate country data
const validateCountryData = (countryData) => {
  const errors = [];
  
  if (countryData && countryData.countryCode) {
    if (countryData.countryCode.length > 3) {
      errors.push("Country code must be 3 characters or less");
    }
  }
  
  return errors;
};

// @desc    Create a new category
// @route   POST /api/categories
// @access  Private/Admin
const createCategory = async (req, res) => {
  try {
    const {
      name,
      description,
      parentId,
      image,
      icon,
      displayOrder,
      metaTitle,
      metaDescription,
      uom, // NEW: UOM field
      countryOfOrigin,
      businessInfo,
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Please provide a category name",
      });
    }



    // Validate country data
    const countryErrors = validateCountryData(countryOfOrigin);
    if (countryErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Country validation failed",
        errors: countryErrors,
      });
    }

    // Check if category with same name already exists
    const existingCategory = await Category.findOne({ name });
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: "Category with this name already exists",
      });
    }



    // Check if parent category exists
    let parentCategory = null;
    if (parentId) {
      parentCategory = await Category.findById(parentId);
      if (!parentCategory) {
        return res.status(404).json({
          success: false,
          message: "Parent category not found",
        });
      }
    }

    // Create slug from name
    const slug = slugify(name, { lower: true });

    // Create category
    const category = await Category.create({
      name,
      slug,
      description,
      parent: parentId || null,
      image,
      icon,
      displayOrder: displayOrder || 0,
      metaTitle: metaTitle || name,
      metaDescription: metaDescription || description,
      uom, // NEW: Include UOM field
      countryOfOrigin: countryOfOrigin || {},
      businessInfo: businessInfo || {},
    });

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      category,
    });
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


// @desc    Get all categories with enhanced filtering
// @route   GET /api/categories
// @access  Public
const getCategories = async (req, res) => {
  try {
    const parentOnly = req.query.parentOnly === "true";
    const activeOnly = req.query.activeOnly === "true";

    // Build filter object
    const filter = {};

    if (parentOnly) {
      filter.parent = null;
    }

    // Enhanced status filtering
    if (req.query.status) {
      switch (req.query.status) {
        case 'active':
          filter.isActive = true;
          break;
        case 'inactive': 
          filter.isActive = false;
          break;
        case 'all':
          break;
        default:
          filter.isActive = true;
      }
    } else if (activeOnly) {
      filter.isActive = true;
    }

    // UPDATED: Enhanced search filtering with UOM
    if (req.query.search) {
      const searchTerm = req.query.search.trim();
      filter.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
        { uom: { $regex: searchTerm, $options: 'i' } }, // NEW: UOM search
        { "countryOfOrigin.country": { $regex: searchTerm, $options: 'i' } },
      ];
    }

    // NEW: UOM filtering
    if (req.query.uom) {
      filter.uom = { $regex: req.query.uom, $options: 'i' };
    }



    // Country filtering
    if (req.query.countryCode) {
      filter["countryOfOrigin.countryCode"] = req.query.countryCode.toUpperCase();
    }

    if (req.query.country) {
      filter["countryOfOrigin.country"] = { $regex: req.query.country, $options: 'i' };
    }

    // Business info filtering
    if (req.query.isEcoFriendly === "true") {
      filter["businessInfo.compliance.isEcoFriendly"] = true;
    }

    if (req.query.isHandmade === "true") {
      filter["businessInfo.compliance.isHandmade"] = true;
    }

    if (req.query.isOrganic === "true") {
      filter["businessInfo.compliance.isOrganic"] = true;
    }

    // For non-admin users, only show active categories
    if (!req.userType || req.userType !== "admin") {
      filter.isActive = true;
    }

    // UPDATED: Sorting with UOM options
    let sort = {};
    if (req.query.sortBy) {
      switch (req.query.sortBy) {
        case 'name-asc':
          sort.name = 1;
          break;
        case 'name-desc':
          sort.name = -1;
          break;

        case 'country':
          sort["countryOfOrigin.country"] = 1;
          break;
        case 'uom': // NEW: UOM sorting
          sort.uom = 1;
          break;
        case 'newest':
          sort.createdAt = -1;
          break;
        default:
          sort.displayOrder = 1;
          sort.name = 1;
      }
    } else {
      sort.displayOrder = 1;
      sort.name = 1;
    }

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Get categories
    let categories = await Category.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const totalCount = await Category.countDocuments(filter);

    // Optionally populate subcategories
    if (req.query.includeSubcategories === "true" && parentOnly) {
      categories = await Category.populate(categories, {
        path: "subcategories",
        options: { sort: { displayOrder: 1, name: 1 } },
      });
    }

    // Add product counts to each category
    const categoriesWithCounts = await Promise.all(
      categories.map(async (category) => {
        // Get subcategories for this category
        const subcategories = await Category.find({ parent: category._id }).select('_id');
        const allCategoryIds = [category._id, ...subcategories.map(sub => sub._id)];

        // Count published regular products (what frontend displays by default)
        const regularProductCount = await Product.countDocuments({
          $or: [
            { category: { $in: allCategoryIds } },
            { subcategory: { $in: allCategoryIds } }
          ],
          isPublished: true,
          isRequestQuote: false
        });

        // Also get total published count (regular + quote)
        const publishedProductCount = await Product.countDocuments({
          $or: [
            { category: { $in: allCategoryIds } },
            { subcategory: { $in: allCategoryIds } }
          ],
          isPublished: true
        });

        const categoryObj = category.toObject();
        return {
          ...categoryObj,
          productCount: publishedProductCount, // All published products count (regular + quote)
          regularProductCount, // Regular products only (without quote products)
          // If subcategories are populated, add counts to them too
          ...(categoryObj.subcategories && {
            subcategories: await Promise.all(
              categoryObj.subcategories.map(async (subcat) => {
                const subRegularCount = await Product.countDocuments({
                  $or: [
                    { category: subcat._id },
                    { subcategory: subcat._id }
                  ],
                  isPublished: true,
                  isRequestQuote: false
                });
                
                const subPublishedCount = await Product.countDocuments({
                  $or: [
                    { category: subcat._id },
                    { subcategory: subcat._id }
                  ],
                  isPublished: true
                });

                return {
                  ...subcat,
                  productCount: subPublishedCount, // All published products (regular + quote)
                  regularProductCount: subRegularCount // Regular products only
                };
              })
            )
          })
        };
      })
    );

    res.status(200).json({
      success: true,
      count: categoriesWithCounts.length,
      totalCount,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPrevPage: page > 1,
      },
      categories: categoriesWithCounts,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


// @desc    Get category by ID or slug
// @route   GET /api/categories/:idOrSlug
// @access  Public
const getCategory = async (req, res) => {
  try {
    const idOrSlug = req.params.idOrSlug;
    let category;

    // Check if parameter is a valid MongoDB ID
    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      category = await Category.findById(idOrSlug);
    } else {
      // If not an ID, treat as slug
      category = await Category.findOne({ slug: idOrSlug });
    }

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // For non-admin users, only show active categories
    if ((!req.userType || req.userType !== "admin") && !category.isActive) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Populate subcategories if requested
    if (req.query.includeSubcategories === "true") {
      await category.populate("subcategories");
    }

    // Get parent info if it's a subcategory
    if (category.parent) {
      const parentCategory = await Category.findById(category.parent);
      category = category.toObject();
      category.parentInfo = {
        _id: parentCategory._id,
        name: parentCategory.name,
        slug: parentCategory.slug,
      };
    }

    res.status(200).json({
      success: true,
      category,
    });
  } catch (error) {
    console.error("Error fetching category:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateCategory = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    await session.startTransaction();

    const {
      name,
      description,
      parentId,
      image,
      icon,
      isActive,
      displayOrder,
      metaTitle,
      metaDescription,
      uom, // NEW: UOM field

      countryOfOrigin,
      businessInfo,
    } = req.body;

    const category = await Category.findById(req.params.id).session(session);

    if (!category) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }




    // Validate country data
    const countryErrors = validateCountryData(countryOfOrigin);
    if (countryErrors.length > 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Country validation failed",
        errors: countryErrors,
      });
    }

    const oldIsActive = category.isActive;
    const newIsActive = isActive !== undefined ? isActive : category.isActive;

    // Check if trying to set itself as parent
    if (parentId && parentId === req.params.id) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Category cannot be its own parent",
      });
    }

    // Check if parent exists
    if (parentId) {
      const parentCategory = await Category.findById(parentId).session(session);
      if (!parentCategory) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Parent category not found",
        });
      }

      // Check for circular reference
      let currentParent = parentCategory;
      while (currentParent && currentParent.parent) {
        if (currentParent.parent.toString() === req.params.id) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Cannot set a child category as parent (circular reference)",
          });
        }
        currentParent = await Category.findById(currentParent.parent).session(session);
      }
    }




    // Update slug if name is changed
    let slug = category.slug;
    if (name && name !== category.name) {
      slug = slugify(name, { lower: true });

      const existingCategory = await Category.findOne({
        slug,
        _id: { $ne: category._id },
      }).session(session);

      if (existingCategory) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Category with this name already exists",
        });
      }
    }

    // Update category fields
    category.name = name || category.name;
    category.slug = slug;
    category.description = description !== undefined ? description : category.description;
    category.parent = parentId !== undefined ? parentId : category.parent;
    category.image = image !== undefined ? image : category.image;
    category.icon = icon !== undefined ? icon : category.icon;
    category.isActive = newIsActive;
    category.displayOrder = displayOrder !== undefined ? displayOrder : category.displayOrder;
    category.metaTitle = metaTitle !== undefined ? metaTitle : category.metaTitle;
    category.metaDescription = metaDescription !== undefined ? metaDescription : category.metaDescription;
    category.uom = uom !== undefined ? uom : category.uom; // NEW: Update UOM



    // Update country of origin
    if (countryOfOrigin !== undefined) {
      category.countryOfOrigin = {
        ...category.countryOfOrigin,
        ...countryOfOrigin,
      };
    }

    // Update business info
    if (businessInfo !== undefined) {
      category.businessInfo = {
        ...category.businessInfo,
        ...businessInfo,
      };
    }

    const updatedCategory = await category.save({ session });

    // CASCADE: Handle product status changes when category isActive changes
    let cascadeResult = null;
    if (oldIsActive !== newIsActive) {
      console.log(`[CATEGORY UPDATE] isActive changed from ${oldIsActive} to ${newIsActive}`);
      cascadeResult = await cascadeCategoryStatusToProducts(category._id, newIsActive, session);
    }

    await session.commitTransaction();

    // Build response
    const response = {
      success: true,
      message: "Category updated successfully",
      category: updatedCategory,
    };

    // Add cascade information if applicable
    if (cascadeResult) {
      response.cascadeResult = cascadeResult;
      
      if (cascadeResult.action === 'moved_to_draft') {
        response.message += ` and ${cascadeResult.productsAffected} products moved to draft`;
      } else if (cascadeResult.action === 'category_activated') {
        response.message += `. ${cascadeResult.draftProductsAvailable} draft products available for publishing`;
      }
    }

    res.status(200).json(response);

  } catch (error) {
    await session.abortTransaction();
    console.error("Error updating category:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};





// @desc    Get country statistics
// @route   GET /api/categories/admin/country-stats
// @access  Private/Admin
const getCountryStats = async (req, res) => {
  try {
    // Get country statistics using aggregation
    const countryStats = await Category.aggregate([
      {
        $match: {
          "countryOfOrigin.country": { $exists: true, $ne: null, $ne: "" }
        }
      },
      {
        $group: {
          _id: "$countryOfOrigin.countryCode",
          country: { $first: "$countryOfOrigin.country" },
          count: { $sum: 1 },
          activeCount: {
            $sum: { $cond: ["$isActive", 1, 0] }
          }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    res.status(200).json({
      success: true,
      stats: countryStats,
    });
  } catch (error) {
    console.error("Error fetching country stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch country statistics",
      error: error.message,
    });
  }
};


const getAdminCategories = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {};
    // Status filter
    if (req.query.status) {
      if (req.query.status === 'active') {
        filter.isActive = true;
      } else if (req.query.status === 'inactive') {
        filter.isActive = false;
      }
      // 'all' shows both
    }

    // Parent/child filter
    if (req.query.type) {
      if (req.query.type === 'parent') {
        filter.parent = null;
      } else if (req.query.type === 'child') {
        filter.parent = { $ne: null };
      }
    }

    // UPDATED: Enhanced search filter with UOM
    if (req.query.search) {
      const searchTerm = req.query.search.trim();
      filter.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
        { uom: { $regex: searchTerm, $options: 'i' } }, // NEW: UOM search

        { "countryOfOrigin.country": { $regex: searchTerm, $options: 'i' } },
        { "countryOfOrigin.countryCode": { $regex: searchTerm, $options: 'i' } },
      ];
    }

    // NEW: UOM filter
    if (req.query.uom) {
      filter.uom = { $regex: req.query.uom, $options: 'i' };
    }



    // Country filters
    if (req.query.countryCode) {
      filter["countryOfOrigin.countryCode"] = { $regex: req.query.countryCode, $options: 'i' };
    }

    if (req.query.country) {
      filter["countryOfOrigin.country"] = { $regex: req.query.country, $options: 'i' };
    }

    // Business compliance filters
    if (req.query.isEcoFriendly === "true") {
      filter["businessInfo.compliance.isEcoFriendly"] = true;
    }

    if (req.query.isHandmade === "true") {
      filter["businessInfo.compliance.isHandmade"] = true;
    }

    if (req.query.isOrganic === "true") {
      filter["businessInfo.compliance.isOrganic"] = true;
    }

    // UPDATED: Sort options with UOM
    let sort = {};
    switch (req.query.sort) {
      case 'name-asc':
        sort.name = 1;
        break;
      case 'name-desc':
        sort.name = -1;
        break;

      case 'country-asc':
        sort["countryOfOrigin.country"] = 1;
        break;
      case 'country-desc':
        sort["countryOfOrigin.country"] = -1;
        break;
      case 'uom-asc': // NEW: UOM sorting
        sort.uom = 1;
        break;
      case 'uom-desc': // NEW: UOM sorting
        sort.uom = -1;
        break;
      case 'newest':
        sort.createdAt = -1;
        break;
      case 'oldest':
        sort.createdAt = 1;
        break;
      case 'order':
        sort.displayOrder = 1;
        break;
      default:
        sort.displayOrder = 1;
        sort.name = 1;
    }

    const categories = await Category.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('parent', 'name')
      .select('-__v');

    const totalCount = await Category.countDocuments(filter);

    // Get product counts and subcategory counts for each category
    const categoriesWithCounts = await Promise.all(
      categories.map(async (category) => {
        // Get all product counts with breakdown
        const allProductsCount = await Product.countDocuments({
          $or: [{ category: category._id }, { subcategory: category._id }]
        });

        const publishedCount = await Product.countDocuments({
          $or: [{ category: category._id }, { subcategory: category._id }],
          isPublished: true
        });

        const regularCount = await Product.countDocuments({
          $or: [{ category: category._id }, { subcategory: category._id }],
          isPublished: true,
          isRequestQuote: false
        });

        const quoteCount = await Product.countDocuments({
          $or: [{ category: category._id }, { subcategory: category._id }],
          isPublished: true,
          isRequestQuote: true
        });

        const subcategoryCount = await Category.countDocuments({ parent: category._id });

        return {
          ...category.toObject(),
          productCount: publishedCount, // All published products (regular + quote)
          totalProductCount: allProductsCount, // Total all products (including drafts)
          regularProductCount: regularCount, // Published regular products only
          quoteProductCount: quoteCount, // Published quote products only
          subcategoryCount,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        categories: categoriesWithCounts,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
          count: categories.length,
          limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
          nextPage: page < Math.ceil(totalCount / limit) ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null
        },
        filters: {
          appliedFilters: {
            status: req.query.status || 'all',
            type: req.query.type || 'all',
            search: req.query.search || null,
            uom: req.query.uom || null, // NEW: UOM filter

            countryCode: req.query.countryCode || null,
            country: req.query.country || null,
            isEcoFriendly: req.query.isEcoFriendly || null,
            isHandmade: req.query.isHandmade || null,
            isOrganic: req.query.isOrganic || null,
          }
        }
      }
    });

  } catch (error) {
    console.error("Error fetching admin categories:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};




// @desc    Get subcategories for a category
// @route   GET /api/categories/:id/subcategories
// @access  Public
const getSubcategories = async (req, res) => {
  try {
    const parentId = req.params.id;

    // Verify parent category exists
    const parentCategory = await Category.findById(parentId);
    if (!parentCategory) {
      return res.status(404).json({
        success: false,
        message: "Parent category not found",
      });
    }

    // For non-admin users, only show if parent category is active
    if ((!req.userType || req.userType !== "admin") && !parentCategory.isActive) {
      return res.status(404).json({
        success: false,
        message: "Parent category not found",
      });
    }

    // Build filter for subcategories
    const filter = { parent: parentId };

    // For non-admin users, only show active subcategories
    if (!req.userType || req.userType !== "admin") {
      filter.isActive = true;
    }

    // Find subcategories
    const subcategories = await Category.find(filter).sort({
      displayOrder: 1,
      name: 1,
    });

    res.status(200).json({
      success: true,
      parentCategory: {
        _id: parentCategory._id,
        name: parentCategory.name,
        slug: parentCategory.slug,
        isActive: parentCategory.isActive,

      },
      count: subcategories.length,
      subcategories: subcategories.map(sub => ({
        ...sub.toObject(),
      })),
    });
  } catch (error) {
    console.error("Error fetching subcategories:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Delete category - ENHANCED WITH CASCADE PROTECTION
// @route   DELETE /api/categories/:id
// @access  Private/Admin
const deleteCategory = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    await session.startTransaction();

    const category = await Category.findById(req.params.id).session(session);

    if (!category) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Check if category has subcategories
    const hasSubcategories = await Category.exists({ parent: req.params.id }).session(session);
    if (hasSubcategories) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Cannot delete a category that has subcategories. Please delete or reassign subcategories first.",
      });
    }

    // Get all products associated with this category
    const associatedProducts = await Product.find({
      $or: [{ category: req.params.id }, { subcategory: req.params.id }],
    }).select('name sku isPublished').session(session);

    if (associatedProducts.length > 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Cannot delete category. ${associatedProducts.length} products are associated with this category.`,
        associatedProducts: associatedProducts.map(p => ({
          id: p._id,
          name: p.name,
          sku: p.sku,
          isPublished: p.isPublished
        })),
        suggestion: "Please reassign these products to another category first, or move them to draft and then delete."
      });
    }

    await category.deleteOne({ session });
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Error deleting category:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Get category tree (hierarchical) with country info
// @route   GET /api/categories/tree
// @access  Public
const getCategoryTree = async (req, res) => {
  try {
    // Build filter for parent categories
    const parentFilter = { parent: null };

    // For non-admin users, only show active categories
    if (!req.userType || req.userType !== "admin") {
      parentFilter.isActive = true;
    }

    // Get all parent categories
    const parentCategories = await Category.find(parentFilter).sort({
      displayOrder: 1,
      name: 1,
    });

    // Build tree structure
    const categoryTree = [];

    for (const parent of parentCategories) {
      // Build filter for subcategories
      const subFilter = { parent: parent._id };

      // For non-admin users, only show active subcategories
      if (!req.userType || req.userType !== "admin") {
        subFilter.isActive = true;
      }

      // Get subcategories
      const subcategories = await Category.find(subFilter).sort({
        displayOrder: 1,
        name: 1,
      });

      // Add to tree
      categoryTree.push({
        _id: parent._id,
        name: parent.name,
        slug: parent.slug,
        icon: parent.icon,
        image: parent.image,
        isActive: parent.isActive,


        children: subcategories.map((sub) => ({
          _id: sub._id,
          name: sub.name,
          slug: sub.slug,
          icon: sub.icon,
          image: sub.image,
          isActive: sub.isActive,
          parentId: parent._id,


        })),
      });
    }

    res.status(200).json({
      success: true,
      categoryTree,
    });
  } catch (error) {
    console.error("Error fetching category tree:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get products by category
// @route   GET /api/categories/:idOrSlug/products
// @access  Public
const getCategoryProducts = async (req, res) => {
  try {
    const idOrSlug = req.params.idOrSlug;
    let category;

    // Check if parameter is a valid MongoDB ID
    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      category = await Category.findById(idOrSlug);
    } else {
      // If not an ID, treat as slug
      category = await Category.findOne({ slug: idOrSlug });
    }

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // For non-admin users, only show products from active categories
    if ((!req.userType || req.userType !== "admin") && !category.isActive) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = { category: category._id };

    // Only show published products to public
    if (!req.userType || req.userType !== "admin") {
      filter.isPublished = true;
    }

    // Include subcategories if requested
    const includeSubcategories = req.query.includeSubcategories === "true";
    if (includeSubcategories) {
      // Build filter for subcategories
      const subFilter = { parent: category._id };

      // For non-admin users, only include active subcategories
      if (!req.userType || req.userType !== "admin") {
        subFilter.isActive = true;
      }

      const subcategories = await Category.find(subFilter).select("_id");
      const subcategoryIds = subcategories.map((subcat) => subcat._id);

      if (subcategoryIds.length > 0) {
        filter.$or = [
          { category: category._id },
          { subcategory: { $in: subcategoryIds } },
        ];
        delete filter.category; // Remove original category filter since it's now in $or
      }
    }

    // Add sorting
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
        case "name-asc":
          sort.name = 1;
          break;
        default:
          sort.createdAt = -1;
      }
    } else {
      sort.createdAt = -1; // Default sort
    }

    // Get products
    const products = await Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("category", "name slug")
      .populate("subcategory", "name slug");

    // Get total count
    const total = await Product.countDocuments(filter);

    res.status(200).json({
      success: true,
      category: {
        _id: category._id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        isActive: category.isActive,
      },
      count: products.length,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      products,
    });
  } catch (error) {
    console.error("Error fetching category products:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Bulk activate categories with optional product publishing
// @route   POST /api/categories/bulk/activate
// @access  Private/Admin
const bulkActivateCategories = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    await session.startTransaction();

    const { categoryIds, publishProducts = false } = req.body;

    if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Please provide category IDs to activate",
      });
    }

    console.log(`[BULK ACTIVATE] Processing ${categoryIds.length} categories`);

    // Activate categories
    const categoryUpdateResult = await Category.updateMany(
      { _id: { $in: categoryIds } },
      { $set: { isActive: true, updatedAt: new Date() } },
      { session }
    );

    let productUpdateResult = { modifiedCount: 0 };

    // Optionally publish products in these categories
    if (publishProducts) {
      console.log(`[BULK ACTIVATE] Also publishing products in activated categories`);
      
      productUpdateResult = await Product.updateMany(
        {
          $or: [
            { category: { $in: categoryIds } },
            { subcategory: { $in: categoryIds } }
          ],
          isPublished: false // Only update draft products
        },
        {
          $set: { isPublished: true, updatedAt: new Date() }
        },
        { session }
      );
    }

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: `Successfully activated ${categoryUpdateResult.modifiedCount} categories` + 
               (publishProducts ? ` and published ${productUpdateResult.modifiedCount} products` : ''),
      results: {
        categoriesActivated: categoryUpdateResult.modifiedCount,
        productsPublished: productUpdateResult.modifiedCount
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Error in bulk activate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to activate categories",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Bulk deactivate categories 
// @route   POST /api/categories/bulk/deactivate
// @access  Private/Admin
const bulkDeactivateCategories = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    await session.startTransaction();

    const { categoryIds } = req.body;

    if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Please provide category IDs to deactivate",
      });
    }

    console.log(`[BULK DEACTIVATE] Processing ${categoryIds.length} categories`);

    let totalProductsMovedToDraft = 0;

    // Process each category individually to handle cascading
    for (const categoryId of categoryIds) {
      const category = await Category.findById(categoryId).session(session);
      if (category && category.isActive) {
        // Deactivate category
        category.isActive = false;
        await category.save({ session });

        // Cascade to products
        const cascadeResult = await cascadeCategoryStatusToProducts(categoryId, false, session);
        totalProductsMovedToDraft += cascadeResult.productsAffected;
      }
    }

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: `Successfully deactivated ${categoryIds.length} categories and moved ${totalProductsMovedToDraft} products to draft`,
      results: {
        categoriesDeactivated: categoryIds.length,
        productsMovedToDraft: totalProductsMovedToDraft
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Error in bulk deactivate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to deactivate categories",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Get category impact analysis
// @route   GET /api/categories/:id/impact-analysis
// @access  Private/Admin
const getCategoryImpactAnalysis = async (req, res) => {
  try {
    const categoryId = req.params.id;

    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Get all affected categories (including subcategories)
    const allAffectedCategories = await getAllSubcategoriesRecursively(categoryId);
    allAffectedCategories.push(mongoose.Types.ObjectId(categoryId));

    // Get product impact analysis
    const productImpact = await Product.aggregate([
      {
        $match: {
          $or: [
            { category: { $in: allAffectedCategories } },
            { subcategory: { $in: allAffectedCategories } }
          ]
        }
      },
      {
        $group: {
          _id: "$isPublished",
          count: { $sum: 1 },
          products: {
            $push: {
              id: "$_id",
              name: "$name",
              sku: "$sku",
              price: "$price"
            }
          }
        }
      }
    ]);

    // Get subcategories with their status
    const subcategories = await Category.find({ parent: categoryId }).select('name isActive');

    const impact = {
      category: {
        id: category._id,
        name: category.name,
        isActive: category.isActive,
      },
      subcategories: subcategories.length,
      subcategoriesList: subcategories,
      productImpact: {
        total: productImpact.reduce((sum, group) => sum + group.count, 0),
        published: productImpact.find(group => group._id === true)?.count || 0,
        draft: productImpact.find(group => group._id === false)?.count || 0,
        breakdown: productImpact
      },
      warning: category.isActive ? 
        "Deactivating this category will move all associated products to draft status." :
        "Activating this category will make it available, but products will remain in their current state."
    };

    res.status(200).json({
      success: true,
      impact
    });

  } catch (error) {
    console.error("Error getting category impact:", error);
    res.status(500).json({
      success: false,
      message: "Failed to analyze category impact",
      error: error.message,
    });
  }
};

// @desc    Toggle category status (activate/deactivate)
// @route   PUT /api/categories/:id/toggle-status
// @access  Private/Admin
const toggleCategoryStatus = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    await session.startTransaction();

    const category = await Category.findById(req.params.id).session(session);

    if (!category) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const oldIsActive = category.isActive;
    const newIsActive = !category.isActive;

    // Update category status
    category.isActive = newIsActive;
    await category.save({ session });

    // Handle cascading to products
    const cascadeResult = await cascadeCategoryStatusToProducts(category._id, newIsActive, session);

    await session.commitTransaction();

    // Build response
    let message = `Category ${newIsActive ? 'activated' : 'deactivated'} successfully`;
    if (cascadeResult.action === 'moved_to_draft') {
      message += ` and ${cascadeResult.productsAffected} products moved to draft`;
    } else if (cascadeResult.action === 'category_activated') {
      message += `. ${cascadeResult.draftProductsAvailable} draft products available for publishing`;
    }

    res.status(200).json({
      success: true,
      message,
      category: {
        id: category._id,
        name: category.name,
        isActive: category.isActive,
      },
      cascadeResult
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Error toggling category status:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Get inactive/draft categories
// @route   GET /api/categories/admin/inactive
// @access  Private/Admin
const getInactiveCategories = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build filter for inactive categories
    const filter = { isActive: false };

    // Optional parent filter
    if (req.query.parentOnly === "true") {
      filter.parent = null;
    }

    // Search filter
    if (req.query.search) {
      const searchTerm = req.query.search.trim();
      filter.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
        { "countryOfOrigin.country": { $regex: searchTerm, $options: 'i' } },
      ];
    }

    const inactiveCategories = await Category.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('parent', 'name');

    const totalCount = await Category.countDocuments(filter);

    // Get product counts for each category
    const categoriesWithProductCounts = await Promise.all(
      inactiveCategories.map(async (category) => {
        const productCount = await Product.countDocuments({
          $or: [{ category: category._id }, { subcategory: category._id }]
        });

        const draftProductCount = await Product.countDocuments({
          $or: [{ category: category._id }, { subcategory: category._id }],
          isPublished: false
        });

        return {
          ...category.toObject(),
          productCount,
          draftProductCount,
        };
      })
    );

    res.status(200).json({
      success: true,
      categories: categoriesWithProductCounts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        limit
      }
    });

  } catch (error) {
    console.error("Error fetching inactive categories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch inactive categories",
      error: error.message,
    });
  }
};

// @desc    Get enhanced category statistics with country breakdown
// @route   GET /api/categories/admin/stats
// @access  Private/Admin
const getCategoryStats = async (req, res) => {
  try {
    // Basic counts
    const totalCategories = await Category.countDocuments();
    const activeCategories = await Category.countDocuments({ isActive: true });
    const inactiveCategories = await Category.countDocuments({ isActive: false });
    const parentCategories = await Category.countDocuments({ parent: null });
    const subcategories = await Category.countDocuments({ parent: { $ne: null } });



    // Country statistics
    const countryStats = await Category.aggregate([
      {
        $match: {
          "countryOfOrigin.country": { $exists: true, $ne: null, $ne: "" }
        }
      },
      {
        $group: {
          _id: "$countryOfOrigin.countryCode",
          country: { $first: "$countryOfOrigin.country" },
          count: { $sum: 1 },
          activeCount: {
            $sum: { $cond: ["$isActive", 1, 0] }
          }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Categories with product counts
    const categoriesWithProducts = await Category.aggregate([
      {
        $lookup: {
          from: 'products',
          let: { categoryId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                 $or: [
                    { $eq: ['$category', '$$categoryId'] },
                    { $eq: ['$subcategory', '$$categoryId'] }
                  ]
                }
              }
            }
          ],
          as: 'products'
        }
      },
      {
        $addFields: {
          productCount: { $size: '$products' }
        }
      },
      {
        $match: {
          productCount: { $gt: 0 }
        }
      },
      {
        $project: {
          name: 1,
          isActive: 1,
          productCount: 1,
          countryOfOrigin: 1
        }
      },
      {
        $sort: { productCount: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Empty categories (no products)
    const emptyCategories = await Category.aggregate([
      {
        $lookup: {
          from: 'products',
          let: { categoryId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$category', '$$categoryId'] },
                    { $eq: ['$subcategory', '$$categoryId'] }
                  ]
                }
              }
            }
          ],
          as: 'products'
        }
      },
      {
        $addFields: {
          productCount: { $size: '$products' }
        }
      },
      {
        $match: {
          productCount: 0
        }
      },
      {
        $project: {
          name: 1,
          isActive: 1,
          createdAt: 1,
          countryOfOrigin: 1
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $limit: 5
      }
    ]);

    // Recent activity
    const recentCategories = await Category.find()
      .sort({ updatedAt: -1 })
      .limit(5)
      .select('name isActive updatedAt parent countryOfOrigin')
      .populate('parent', 'name');

    // Business compliance stats
    const complianceStats = await Category.aggregate([
      {
        $group: {
          _id: null,
          ecoFriendlyCount: {
            $sum: { $cond: ["$businessInfo.compliance.isEcoFriendly", 1, 0] }
          },
          handmadeCount: {
            $sum: { $cond: ["$businessInfo.compliance.isHandmade", 1, 0] }
          },
          organicCount: {
            $sum: { $cond: ["$businessInfo.compliance.isOrganic", 1, 0] }
          }
        }
      }
    ]);

    const stats = {
      overview: {
        totalCategories,
        activeCategories,
        inactiveCategories,
        parentCategories,
        subcategories,
        activationRate: totalCategories > 0 ? ((activeCategories / totalCategories) * 100).toFixed(1) : 0,

        categoriesWithCountryInfo: countryStats.length
      },

      countryBreakdown: countryStats,
      complianceStats: complianceStats[0] || {
        ecoFriendlyCount: 0,
        handmadeCount: 0,
        organicCount: 0
      },
      topCategoriesByProducts: categoriesWithProducts,
      emptyCategories,
      recentActivity: recentCategories.map(cat => ({
        id: cat._id,
        name: cat.name,
        isActive: cat.isActive,
        parentName: cat.parent?.name || null,

        country: cat.countryOfOrigin?.country || null,
        updatedAt: cat.updatedAt
      }))
    };

    res.status(200).json({
      success: true,
      stats
    });

  } catch (error) {
    console.error("Error fetching category stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch category statistics",
      error: error.message,
    });
  }
};

// @desc    Export categories data with country info
// @route   GET /api/categories/admin/export
// @access  Private/Admin
const exportCategories = async (req, res) => {
  try {
    const { format = 'json', includeProducts = false } = req.query;

    // Build filter
    const filter = {};
    if (req.query.status) {
      if (req.query.status === 'active') {
        filter.isActive = true;
      } else if (req.query.status === 'inactive') {
        filter.isActive = false;
      }
    }



    if (req.query.countryCode) {
      filter["countryOfOrigin.countryCode"] = { $regex: req.query.countryCode, $options: 'i' };
    }

    let categories;
    
    if (includeProducts === 'true') {
      // Include product counts
      categories = await Category.aggregate([
        { $match: filter },
        {
          $lookup: {
            from: 'products',
            let: { categoryId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ['$category', '$$categoryId'] },
                      { $eq: ['$subcategory', '$$categoryId'] }
                    ]
                  }
                }
              }
            ],
            as: 'products'
          }
        },
        {
          $addFields: {
            productCount: { $size: '$products' },
            publishedProductCount: {
              $size: {
                $filter: {
                  input: '$products',
                  cond: { $eq: ['$$this.isPublished', true] }
                }
              }
            },
            draftProductCount: {
              $size: {
                $filter: {
                  input: '$products',
                  cond: { $eq: ['$$this.isPublished', false] }
                }
              }
            }
          }
        },
        {
          $project: {
            products: 0 // Remove the products array, keep only counts
          }
        },
        {
          $sort: { name: 1 }
        }
      ]);
    } else {
      categories = await Category.find(filter)
        .populate('parent', 'name')
        .sort({ name: 1 });
    }

    if (format === 'csv') {
      // Convert to CSV format
      let csv = '';
      if (categories.length > 0) {
        // Flatten the data for CSV
        const flatData = categories.map(category => ({
          id: category._id,
          name: category.name,
          slug: category.slug,
          description: category.description || '',
          isActive: category.isActive,
          parentName: category.parent?.name || '',
          displayOrder: category.displayOrder,
          

          
          // Country information
          country: category.countryOfOrigin?.country || '',
          countryCode: category.countryOfOrigin?.countryCode || '',
          region: category.countryOfOrigin?.region || '',
          
          // Business information
          taxCategory: category.businessInfo?.taxCategory || '',
          hsnCode: category.businessInfo?.hsnCode || '',
          isEcoFriendly: category.businessInfo?.compliance?.isEcoFriendly || false,
          isHandmade: category.businessInfo?.compliance?.isHandmade || false,
          isOrganic: category.businessInfo?.compliance?.isOrganic || false,
          
          createdAt: category.createdAt ? category.createdAt.toISOString() : '',
          updatedAt: category.updatedAt ? category.updatedAt.toISOString() : '',
          
          ...(includeProducts === 'true' && {
            productCount: category.productCount || 0,
            publishedProductCount: category.publishedProductCount || 0,
            draftProductCount: category.draftProductCount || 0
          })
        }));

        // Headers
        const headers = Object.keys(flatData[0]);
        csv += headers.join(',') + '\n';

        // Data rows
        flatData.forEach(row => {
          const values = headers.map(header => {
            let value = row[header];
            if (value === null || value === undefined) {
              return '';
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
      res.setHeader('Content-Disposition', `attachment; filename="categories-export-${Date.now()}.csv"`);
      res.send(csv);
    } else {
      // Default JSON format
      res.status(200).json({
        success: true,
        count: categories.length,
        exportDate: new Date().toISOString(),
        categories,
      });
    }
  } catch (error) {
    console.error("Error exporting categories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export categories",
      error: error.message,
    });
  }
};



// @desc    Get categories by country
// @route   GET /api/categories/country/:countryCode
// @access  Public
const getCategoriesByCountry = async (req, res) => {
  try {
    const countryCode = req.params.countryCode.toUpperCase();
    
    // Build filter
    const filter = { "countryOfOrigin.countryCode": countryCode };
    
    // For non-admin users, only show active categories
    if (!req.userType || req.userType !== "admin") {
      filter.isActive = true;
    }

    const categories = await Category.find(filter)
      .sort({ name: 1 })
      .populate('parent', 'name');

    if (categories.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No categories found for this country",
      });
    }



    res.status(200).json({
      success: true,
      countryInfo,
      count: categories.length,
      categories,
    });

  } catch (error) {
    console.error("Error fetching categories by country:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get categories by compliance filter
// @route   GET /api/categories/compliance/:type
// @access  Public
const getCategoriesByCompliance = async (req, res) => {
  try {
    const complianceType = req.params.type;
    
    // Validate compliance type
    const validTypes = ['eco-friendly', 'handmade', 'organic'];
    if (!validTypes.includes(complianceType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid compliance type. Valid types: eco-friendly, handmade, organic",
      });
    }

    // Build filter
    const filter = {};
    switch (complianceType) {
      case 'eco-friendly':
        filter["businessInfo.compliance.isEcoFriendly"] = true;
        break;
      case 'handmade':
        filter["businessInfo.compliance.isHandmade"] = true;
        break;
      case 'organic':
        filter["businessInfo.compliance.isOrganic"] = true;
        break;
    }
    
    // For non-admin users, only show active categories
    if (!req.userType || req.userType !== "admin") {
      filter.isActive = true;
    }

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const categories = await Category.find(filter)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .populate('parent', 'name');

    const totalCount = await Category.countDocuments(filter);

    res.status(200).json({
      success: true,
      complianceType,
      count: categories.length,
      totalCount,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPrevPage: page > 1,
      },
      categories: categories.map(cat => ({
        ...cat.toObject(),
      })),
    });

  } catch (error) {
    console.error("Error fetching categories by compliance:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Add this function to categoryController.js

// @desc    Get single category by ID for admin (bypasses active status)
// @route   GET /api/categories/admin/:id
// @access  Private/Admin
const getAdminCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;

    // Validate if it's a valid MongoDB ID
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID",
      });
    }

    // Admin can see any category regardless of active status
    const category = await Category.findById(categoryId)
      .populate("parent", "name slug isActive")
      .populate({
        path: "subcategories",
        options: { sort: { displayOrder: 1, name: 1 } },
      });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Get product statistics for this category
    const productStats = await Product.aggregate([
      {
        $match: {
          $or: [
            { category: category._id },
            { subcategory: category._id }
          ]
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          published: {
            $sum: { $cond: [{ $eq: ["$isPublished", true] }, 1, 0] }
          },
          draft: {
            $sum: { $cond: [{ $eq: ["$isPublished", false] }, 1, 0] }
          },
          featured: {
            $sum: { $cond: [{ $eq: ["$isFeatured", true] }, 1, 0] }
          },
          outOfStock: {
            $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] }
          }
        }
      }
    ]);

    // Get subcategory count
    const subcategoryCount = await Category.countDocuments({ parent: category._id });

    // Get recent products in this category
    const recentProducts = await Product.find({
      $or: [
        { category: category._id },
        { subcategory: category._id }
      ]
    })
      .sort({ updatedAt: -1 })
      .limit(5)
      .select("name sku isPublished isFeatured stock updatedAt");

    const stats = productStats[0] || {
      total: 0,
      published: 0,
      draft: 0,
      featured: 0,
      outOfStock: 0
    };

    res.status(200).json({
      success: true,
      category,
      meta: {
        isActive: category.isActive,
        hasParent: !!category.parent,
        subcategoryCount,
        lastModified: category.updatedAt,


      },
      productStats: stats,
      recentProducts: recentProducts.map(product => ({
        id: product._id,
        name: product.name,
        sku: product.sku,
        status: product.isPublished ? "Published" : "Draft",
        isFeatured: product.isFeatured,
        stockStatus: product.stock > 0 ? "In Stock" : "Out of Stock",
        lastModified: product.updatedAt
      }))
    });
  } catch (error) {
    console.error("Error fetching admin category:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Export all functions
export {
  createCategory,
  getCategories,
  getCategory,
  getSubcategories,
  updateCategory,
  deleteCategory,
  getCategoryTree,
  getCategoryProducts,
  bulkActivateCategories,
  bulkDeactivateCategories,
  getCategoryImpactAnalysis,
  getAdminCategory,
  toggleCategoryStatus,
  getInactiveCategories,
  getCategoryStats,
  exportCategories,
  getAdminCategories,
  getCountryStats,
  getCategoriesByCountry,
  getCategoriesByCompliance,
};