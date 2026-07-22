
// controllers/pageContentController.js
import PageContent from "../models/pageContentModel.js";
import Category from "../models/categoryModel.js";
import Product from "../models/productModel.js";
import mongoose from "mongoose";

// @desc    Get content for a page
// @route   GET /api/content/:pageType/:id
// @access  Public
const   getPageContent = async (req, res) => {
  try {
    const { pageType, id } = req.params;

    console.log(
      `[GET] Page content request - PageType: ${pageType}, ID: ${id}`
    );

    // Validate page type
    if (!["category", "product", "homepage", "custom"].includes(pageType)) {
      console.log(`[GET] Invalid page type: ${pageType}`);
      return res.status(400).json({
        success: false,
      message: "Invalid page type",
      });
    }

    let entityData = null;
    let pageId = id;

    // Special handling for homepage
    if (pageType === "homepage" && id === "homepage") {
      pageId = "homepage"; // Use a fixed pageId for homepage
      console.log("[GET] Homepage request detected");
    }
    // If it's a category page, validate the entity exists
    else if (pageType === "category") {
      console.log(`[GET] Looking for category with id: ${id}`);
      console.log(
        `[GET] Is valid ObjectId: ${mongoose.Types.ObjectId.isValid(id)}`
      );

      // Check if parameter is a valid MongoDB ID
      if (mongoose.Types.ObjectId.isValid(id)) {
        entityData = await Category.findById(id).select(
          "name slug description metaTitle metaDescription image"
        );
        console.log(
          `[GET] Found category by ID:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      } else {
        // If not an ID, treat as slug
        entityData = await Category.findOne({ slug: id }).select(
          "_id name slug description metaTitle metaDescription image"
        );
        console.log(
          `[GET] Found category by slug:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      }

      if (!entityData) {
        console.log(`[GET] Category not found: ${id}`);
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // Safety check for _id
      if (!entityData._id) {
        console.error(`[GET] EntityData exists but has no _id:`, entityData);
        return res.status(500).json({
          success: false,
          message: "Invalid entity data - missing ID",
        });
      }

      // Use _id for pageId if slug was provided
      pageId = entityData._id.toString();
      console.log(`[GET] Using pageId: ${pageId}`);
    }
    // If it's a product page, validate the entity exists
    else if (pageType === "product") {
      console.log(`[GET] Looking for product with id: ${id}`);
      console.log(
        `[GET] Is valid ObjectId: ${mongoose.Types.ObjectId.isValid(id)}`
      );

      // Check if parameter is a valid MongoDB ID
      if (mongoose.Types.ObjectId.isValid(id)) {
        entityData = await Product.findById(id).select(
          "name slug description price discountPrice images metaTitle metaDescription"
        );
        console.log(
          `[GET] Found product by ID:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      } else {
        // If not an ID, treat as slug
        entityData = await Product.findOne({ slug: id }).select(
          "_id name slug description price discountPrice images metaTitle metaDescription"
        );
        console.log(
          `[GET] Found product by slug:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      }

      if (!entityData) {
        console.log(`[GET] Product not found: ${id}`);
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      // Safety check for _id
      if (!entityData._id) {
        console.error(`[GET] EntityData exists but has no _id:`, entityData);
        return res.status(500).json({
          success: false,
          message: "Invalid entity data - missing ID",
        });
      }

      // Use _id for pageId if slug was provided
      pageId = entityData._id.toString();
      console.log(`[GET] Using pageId: ${pageId}`);
    }
    // Handle custom pages
    else if (pageType === "custom") {
      console.log(`[GET] Custom page request: ${id}`);
      // No entity lookup needed for custom pages
    }

    // Get the page content
    const pageContentId = `${pageType}-${pageId}`;
    console.log(`[GET] Looking for page content with ID: ${pageContentId}`);

    const pageContent = await PageContent.findOne({
      pageId: pageContentId,
      pageType,
    });

    console.log(`[GET] Page content found:`, pageContent ? "Yes" : "No");

    // Define default content based on page type
    let defaultContent = {};

    if (pageType === "category" && entityData) {
      defaultContent = {
        hero: {
          title: entityData.name,
          subtitle: entityData.description || "Explore our collection",
          image: entityData.image || null,
        },
        sections: [],
        seo: {
          metaTitle: entityData.metaTitle || entityData.name,
          metaDescription: entityData.metaDescription || entityData.description,
        },
      };
    } else if (pageType === "product" && entityData) {
      defaultContent = {
        hero: {
          title: entityData.name,
          subtitle: entityData.description || "Product details",
          image:
            entityData.images && entityData.images.length > 0
              ? entityData.images[0]
              : null,
        },
        sections: [],
        seo: {
          metaTitle: entityData.metaTitle || entityData.name,
          metaDescription: entityData.metaDescription || entityData.description,
        },
      };
    } else if (pageType === "homepage") {
      defaultContent = {
        hero: {
          title: "Welcome to Our Store",
          subtitle: "Discover our collection of premium products",
        },
        sections: [],
      };
    } else if (pageType === "custom") {
      defaultContent = {
        hero: {
          title: "Custom Page",
          subtitle: "Custom content",
        },
        sections: [],
      };
    }

    // If no specific content exists, return default structure
    if (!pageContent) {
      console.log("[GET] No custom content found, returning default");
      return res.status(200).json({
        success: true,
        entity: entityData,
        content: defaultContent,
      });
    }

    console.log("[GET] Processing custom content with reference resolution");

    // Clone the content to avoid modifying the original
    const content = JSON.parse(JSON.stringify(pageContent.content));

    // Collect all entity references that need resolution
    const referenceCollector = {
      products: new Set(),
      categories: new Set(),
    };

    // First pass: collect all references
    traverseAndCollect(content, referenceCollector);

    console.log(
      `[GET] Found references - Products: ${referenceCollector.products.size}, Categories: ${referenceCollector.categories.size}`
    );

    // Fetch all referenced entities in batch
    const resolvedEntities = {};

    // Resolve product references if any exist
    if (referenceCollector.products.size > 0) {
      const productIds = Array.from(referenceCollector.products);
      console.log(`[GET] Resolving product references:`, productIds);

      const products = await Product.find({
        _id: { $in: productIds },
        isPublished: true,
      }).select("_id name slug price images discountPrice stock");

      console.log(`[GET] Found ${products.length} products for resolution`);

      resolvedEntities.products = products.reduce((map, product) => {
        map[product._id.toString()] = {
          id: product._id,
          name: product.name,
          slug: product.slug,
          price: product.price,
          discountPrice: product.discountPrice,
          imageUrl:
            product.images && product.images.length > 0
              ? product.images[0]
              : null,
          stock: product.stock,
        };
        return map;
      }, {});
    }

    // Resolve category references if any exist
    if (referenceCollector.categories.size > 0) {
      const categoryIds = Array.from(referenceCollector.categories);
      console.log(`[GET] Resolving category references:`, categoryIds);

      const categories = await Category.find({
        _id: { $in: categoryIds },
      }).select("_id name slug image");

      console.log(`[GET] Found ${categories.length} categories for resolution`);

      resolvedEntities.categories = categories.reduce((map, category) => {
        map[category._id.toString()] = {
          id: category._id,
          name: category.name,
          slug: category.slug,
          image: category.image,
        };
        return map;
      }, {});
    }

    // Second pass: replace references with actual data
    const resolvedContent = resolveReferences(content, resolvedEntities);

    console.log("[GET] Reference resolution completed successfully");

    // Return the entity and its resolved content
    return res.status(200).json({
      success: true,
      entity: entityData,
      content: resolvedContent,
    });
  } catch (error) {
    console.error("Error fetching page content:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Create new content for a page
// @route   POST /api/content/:pageType/:id
// @access  Private/Admin
const createPageContent = async (req, res) => {
  try {
    const { pageType, id } = req.params;
    const { content } = req.body;

    console.log(
      `[CREATE] Page content request - PageType: ${pageType}, ID: ${id}`
    );
    console.log(`[CREATE] User ID: ${req.admin?._id || req.user?._id}`);
    console.log(`[CREATE] User Type: ${req.userType}`);
    console.log(
      `[CREATE] Content structure:`,
      JSON.stringify(content, null, 2)
    );

    // Validate page type
    if (!["category", "product", "homepage", "custom"].includes(pageType)) {
      console.log(`[CREATE] Invalid page type: ${pageType}`);
      return res.status(400).json({
        success: false,
        message: "Invalid page type",
      });
    }

    // Validate content
    if (!content) {
      console.log("[CREATE] No content provided");
      return res.status(400).json({
        success: false,
        message: "Content is required",
      });
    }

    // Validate user (admin or regular user)
    const currentUser = req.admin || req.user;
    if (!currentUser || !currentUser._id) {
      console.log("[CREATE] No user found in request");
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      });
    }

    console.log(
      `[CREATE] Authenticated as: ${req.userType} - ${
        currentUser.email || currentUser.name
      }`
    );

    let entityData = null;
    let pageId = id;

    // Special handling for homepage
    if (pageType === "homepage" && id === "homepage") {
      pageId = "homepage"; // Use a fixed pageId for homepage
      console.log("[CREATE] Homepage content creation");
    }
    // If it's a category page, validate the entity exists
    else if (pageType === "category") {
      console.log(`[CREATE] Looking for category with id: ${id}`);
      console.log(
        `[CREATE] Is valid ObjectId: ${mongoose.Types.ObjectId.isValid(id)}`
      );

      // Check if parameter is a valid MongoDB ID
      if (mongoose.Types.ObjectId.isValid(id)) {
        entityData = await Category.findById(id);
        console.log(
          `[CREATE] Found category by ID:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      } else {
        // If not an ID, treat as slug
        entityData = await Category.findOne({ slug: id });
        console.log(
          `[CREATE] Found category by slug:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      }

      if (!entityData) {
        console.log(`[CREATE] Category not found: ${id}`);
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // Safety check for _id
      if (!entityData._id) {
        console.error(`[CREATE] EntityData exists but has no _id:`, entityData);
        return res.status(500).json({
          success: false,
          message: "Invalid entity data - missing ID",
        });
      }

      // Use _id for pageId if slug was provided
      pageId = entityData._id.toString();
      console.log(`[CREATE] Using pageId: ${pageId}`);
    }
    // If it's a product page, validate the entity exists
    else if (pageType === "product") {
      console.log(`[CREATE] Looking for product with id: ${id}`);
      console.log(
        `[CREATE] Is valid ObjectId: ${mongoose.Types.ObjectId.isValid(id)}`
      );

      // Check if parameter is a valid MongoDB ID
      if (mongoose.Types.ObjectId.isValid(id)) {
        entityData = await Product.findById(id);
        console.log(
          `[CREATE] Found product by ID:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      } else {
        // If not an ID, treat as slug
        entityData = await Product.findOne({ slug: id });
        console.log(
          `[CREATE] Found product by slug:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      }

      if (!entityData) {
        console.log(`[CREATE] Product not found: ${id}`);
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      // Safety check for _id
      if (!entityData._id) {
        console.error(`[CREATE] EntityData exists but has no _id:`, entityData);
        return res.status(500).json({
          success: false,
          message: "Invalid entity data - missing ID",
        });
      }

      // Use _id for pageId if slug was provided
      pageId = entityData._id.toString();
      console.log(`[CREATE] Using pageId: ${pageId}`);
    }
    // Handle custom pages
    else if (pageType === "custom") {
      console.log(`[CREATE] Custom page content creation: ${id}`);
      // No entity lookup needed for custom pages
      pageId = id; // Use the provided ID as-is for custom pages
    }

    // Check if content already exists
    const pageContentId = `${pageType}-${pageId}`;
    console.log(
      `[CREATE] Checking for existing content with ID: ${pageContentId}`
    );

    const existingContent = await PageContent.findOne({
      pageId: pageContentId,
      pageType,
    });

    if (existingContent) {
      console.log("[CREATE] Page content already exists");
      return res.status(400).json({
        success: false,
        message: "Page content already exists. Use PUT to update.",
      });
    }

    console.log("[CREATE] Validating content references");

    // Validate references
    const referenceCollector = {
      products: new Set(),
      categories: new Set(),
    };

    traverseAndCollect(content, referenceCollector);

    console.log(
      `[CREATE] Found references - Products: ${referenceCollector.products.size}, Categories: ${referenceCollector.categories.size}`
    );

    // Validate product references
    if (referenceCollector.products.size > 0) {
      const productIds = Array.from(referenceCollector.products);
      console.log(`[CREATE] Validating product references:`, productIds);

      const productCount = await Product.countDocuments({
        _id: { $in: productIds },
      });

      console.log(
        `[CREATE] Found ${productCount} valid products out of ${productIds.length} references`
      );

      if (productCount !== productIds.length) {
        console.log("[CREATE] Some product references are invalid");
        return res.status(400).json({
          success: false,
          message: "One or more product references are invalid",
        });
      }
    }

    // Validate category references
    if (referenceCollector.categories.size > 0) {
      const categoryIds = Array.from(referenceCollector.categories);
      console.log(`[CREATE] Validating category references:`, categoryIds);

      const categoryCount = await Category.countDocuments({
        _id: { $in: categoryIds },
      });

      console.log(
        `[CREATE] Found ${categoryCount} valid categories out of ${categoryIds.length} references`
      );

      if (categoryCount !== categoryIds.length) {
        console.log("[CREATE] Some category references are invalid");
        return res.status(400).json({
          success: false,
          message: "One or more category references are invalid",
        });
      }
    }

    // Create title based on entity or page type
    let title = "Custom Page";
    if (entityData && entityData.name) {
      title = entityData.name;
    } else if (pageType === "homepage") {
      title = "Homepage";
    } else if (pageType === "custom") {
      title = `Custom Page - ${id}`;
    }

    console.log(`[CREATE] Creating page content with title: ${title}`);

    // Create the page content
    const pageContent = new PageContent({
      pageId: pageContentId,
      pageType,
      title,
      content,
      updatedBy: currentUser._id,
    });

    const savedContent = await pageContent.save();
    console.log(
      `[CREATE] Page content created successfully with ID: ${savedContent._id}`
    );

    res.status(201).json({
      success: true,
      message: "Page content created successfully",
      pageContent: savedContent,
    });
  } catch (error) {
    console.error("Error creating page content:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update content for a page
// @route   PUT /api/content/:pageType/:id
// @access  Private/Admin
const updatePageContent = async (req, res) => {
  try {
    const { pageType, id } = req.params;
    const { content } = req.body;

    console.log(
      `[UPDATE] Page content request - PageType: ${pageType}, ID: ${id}`
    );
    console.log(`[UPDATE] User ID: ${req.admin?._id || req.user?._id}`);
    console.log(`[UPDATE] User Type: ${req.userType}`);

    // Validate page type
    if (!["category", "product", "homepage", "custom"].includes(pageType)) {
      console.log(`[UPDATE] Invalid page type: ${pageType}`);
      return res.status(400).json({
        success: false,
        message: "Invalid page type",
      });
    }

    // Validate content
    if (!content) {
      console.log("[UPDATE] No content provided");
      return res.status(400).json({
        success: false,
        message: "Content is required",
      });
    }

    // Validate user (admin or regular user)
    const currentUser = req.admin || req.user;
    if (!currentUser || !currentUser._id) {
      console.log("[UPDATE] No user found in request");
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      });
    }

    console.log(
      `[UPDATE] Authenticated as: ${req.userType} - ${
        currentUser.email || currentUser.name
      }`
    );

    let entityData = null;
    let pageId = id;

    // Special handling for homepage
    if (pageType === "homepage" && id === "homepage") {
      pageId = "homepage"; // Use a fixed pageId for homepage
      console.log("[UPDATE] Homepage content update");
    }
    // If it's a category page, validate the entity exists
    else if (pageType === "category") {
      console.log(`[UPDATE] Looking for category with id: ${id}`);
      console.log(
        `[UPDATE] Is valid ObjectId: ${mongoose.Types.ObjectId.isValid(id)}`
      );

      // Check if parameter is a valid MongoDB ID
      if (mongoose.Types.ObjectId.isValid(id)) {
        entityData = await Category.findById(id);
        console.log(
          `[UPDATE] Found category by ID:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      } else {
        // If not an ID, treat as slug
        entityData = await Category.findOne({ slug: id });
        console.log(
          `[UPDATE] Found category by slug:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      }

      if (!entityData) {
        console.log(`[UPDATE] Category not found: ${id}`);
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // Safety check for _id
      if (!entityData._id) {
        console.error(`[UPDATE] EntityData exists but has no _id:`, entityData);
        return res.status(500).json({
          success: false,
          message: "Invalid entity data - missing ID",
        });
      }

      // Use _id for pageId if slug was provided
      pageId = entityData._id.toString();
      console.log(`[UPDATE] Using pageId: ${pageId}`);
    }
    // If it's a product page, validate the entity exists
    else if (pageType === "product") {
      console.log(`[UPDATE] Looking for product with id: ${id}`);
      console.log(
        `[UPDATE] Is valid ObjectId: ${mongoose.Types.ObjectId.isValid(id)}`
      );

      // Check if parameter is a valid MongoDB ID
      if (mongoose.Types.ObjectId.isValid(id)) {
        entityData = await Product.findById(id);
        console.log(
          `[UPDATE] Found product by ID:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      } else {
        // If not an ID, treat as slug
        entityData = await Product.findOne({ slug: id });
        console.log(
          `[UPDATE] Found product by slug:`,
          entityData ? `${entityData.name} (${entityData._id})` : "null"
        );
      }

      if (!entityData) {
        console.log(`[UPDATE] Product not found: ${id}`);
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      // Safety check for _id
      if (!entityData._id) {
        console.error(`[UPDATE] EntityData exists but has no _id:`, entityData);
        return res.status(500).json({
          success: false,
          message: "Invalid entity data - missing ID",
        });
      }

      // Use _id for pageId if slug was provided
      pageId = entityData._id.toString();
      console.log(`[UPDATE] Using pageId: ${pageId}`);
    }
    // Handle custom pages
    else if (pageType === "custom") {
      console.log(`[UPDATE] Custom page content update: ${id}`);
      // No entity lookup needed for custom pages
      pageId = id; // Use the provided ID as-is for custom pages
    }

    console.log("[UPDATE] Validating content references");

    // Validate references
    const referenceCollector = {
      products: new Set(),
      categories: new Set(),
    };

    traverseAndCollect(content, referenceCollector);

    console.log(
      `[UPDATE] Found references - Products: ${referenceCollector.products.size}, Categories: ${referenceCollector.categories.size}`
    );

    // Validate product references
    if (referenceCollector.products.size > 0) {
      const productIds = Array.from(referenceCollector.products);
      console.log(`[UPDATE] Validating product references:`, productIds);

      const productCount = await Product.countDocuments({
        _id: { $in: productIds },
      });

      console.log(
        `[UPDATE] Found ${productCount} valid products out of ${productIds.length} references`
      );

      if (productCount !== productIds.length) {
        console.log("[UPDATE] Some product references are invalid");
        return res.status(400).json({
          success: false,
          message: "One or more product references are invalid",
        });
      }
    }

    // Validate category references
    if (referenceCollector.categories.size > 0) {
      const categoryIds = Array.from(referenceCollector.categories);
      console.log(`[UPDATE] Validating category references:`, categoryIds);

      const categoryCount = await Category.countDocuments({
        _id: { $in: categoryIds },
      });

      console.log(
        `[UPDATE] Found ${categoryCount} valid categories out of ${categoryIds.length} references`
      );

      if (categoryCount !== categoryIds.length) {
        console.log("[UPDATE] Some category references are invalid");
        return res.status(400).json({
          success: false,
          message: "One or more category references are invalid",
        });
      }
    }

    // Update or create the page content
    const pageContentId = `${pageType}-${pageId}`;
    console.log(
      `[UPDATE] Looking for existing content with ID: ${pageContentId}`
    );

    let pageContent = await PageContent.findOne({
      pageId: pageContentId,
      pageType,
    });

    if (pageContent) {
      console.log(`[UPDATE] Updating existing content`);
      pageContent.content = content;
      pageContent.updatedBy = currentUser._id;
      pageContent.updatedAt = new Date();
    } else {
      console.log(`[UPDATE] Creating new content (upsert)`);
      let title = "Custom Page";
      if (entityData && entityData.name) {
        title = entityData.name;
      } else if (pageType === "homepage") {
        title = "Homepage";
      } else if (pageType === "custom") {
        title = `Custom Page - ${id}`;
      }

      pageContent = new PageContent({
        pageId: pageContentId,
        pageType,
        title,
        content,
        updatedBy: currentUser._id,
      });
    }

    const savedContent = await pageContent.save();
    console.log(
      `[UPDATE] Page content saved successfully with ID: ${savedContent._id}`
    );

    res.status(200).json({
      success: true,
      message: "Page content updated successfully",
      pageContent: savedContent,
    });
  } catch (error) {
    console.error("Error updating page content:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get list of all page content
// @route   GET /api/content
// @access  Private/Admin
const getAllPageContent = async (req, res) => {
  try {
    console.log("[GET_ALL] Fetching all page content");

    const pageContents = await PageContent.find()
      .sort({ pageType: 1, updatedAt: -1 })
      .select("pageId pageType title isActive updatedAt");

    console.log(`[GET_ALL] Found ${pageContents.length} page content entries`);

    res.status(200).json({
      success: true,
      count: pageContents.length,
      pageContents,
    });
  } catch (error) {
    console.error("Error fetching all page content:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Delete page content
// @route   DELETE /api/content/:pageType/:id
// @access  Private/Admin
const deletePageContent = async (req, res) => {
  try {
    const { pageType, id } = req.params;

    console.log(
      `[DELETE] Page content request - PageType: ${pageType}, ID: ${id}`
    );

    // Validate page type
    if (!["category", "product", "homepage", "custom"].includes(pageType)) {
      console.log(`[DELETE] Invalid page type: ${pageType}`);
      return res.status(400).json({
        success: false,
        message: "Invalid page type",
      });
    }

    let pageId = id;

    // Special handling for homepage
    if (pageType === "homepage" && id === "homepage") {
      pageId = "homepage"; // Use a fixed pageId for homepage
      console.log("[DELETE] Homepage content deletion");
    }
    // If it's a category page and using slug, get the ID
    else if (pageType === "category" && !mongoose.Types.ObjectId.isValid(id)) {
      console.log(`[DELETE] Looking for category by slug: ${id}`);
      const category = await Category.findOne({ slug: id });
      if (!category) {
        console.log(`[DELETE] Category not found by slug: ${id}`);
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }
      pageId = category._id.toString();
      console.log(`[DELETE] Found category, using pageId: ${pageId}`);
    }
    // If it's a product page and using slug, get the ID
    else if (pageType === "product" && !mongoose.Types.ObjectId.isValid(id)) {
      console.log(`[DELETE] Looking for product by slug: ${id}`);
      const product = await Product.findOne({ slug: id });
      if (!product) {
        console.log(`[DELETE] Product not found by slug: ${id}`);
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }
      pageId = product._id.toString();
      console.log(`[DELETE] Found product, using pageId: ${pageId}`);
    }
    // For custom pages, use the ID as-is
    else if (pageType === "custom") {
      console.log(`[DELETE] Custom page deletion: ${id}`);
      pageId = id;
    }

    const pageContentId = `${pageType}-${pageId}`;
    console.log(`[DELETE] Looking for page content with ID: ${pageContentId}`);

    const pageContent = await PageContent.findOne({
      pageId: pageContentId,
      pageType,
    });

    if (!pageContent) {
      console.log(`[DELETE] Page content not found: ${pageContentId}`);
      return res.status(404).json({
        success: false,
        message: "Page content not found",
      });
    }

    await pageContent.deleteOne();
    console.log(`[DELETE] Page content deleted successfully: ${pageContentId}`);

    res.status(200).json({
      success: true,
      message: "Page content deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting page content:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Helper function to traverse and collect all references
function traverseAndCollect(obj, collector) {
  if (!obj || typeof obj !== "object") return;

  // Arrays
  if (Array.isArray(obj)) {
    obj.forEach((item) => traverseAndCollect(item, collector));
    return;
  }

  // Check if this object is a reference
  if (obj.__type) {
    // Product reference
    if (obj.__type === "productRef" && obj.id) {
      collector.products.add(obj.id);
      return;
    }

    // Category reference
    if (obj.__type === "categoryRef" && obj.id) {
      collector.categories.add(obj.id);
      return;
    }
  }

  // Regular object - traverse all properties
  Object.values(obj).forEach((value) => {
    traverseAndCollect(value, collector);
  });
}

// Helper function to resolve all references in the content
function resolveReferences(obj, resolvedEntities) {
  if (!obj || typeof obj !== "object") return obj;

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveReferences(item, resolvedEntities));
  }

  // Resolve reference objects
  if (obj.__type) {
    // Product reference
    if (obj.__type === "productRef" && obj.id) {
      const productData = resolvedEntities.products?.[obj.id];
      if (productData) {
        return {
          __type: "product",
          ...productData,
        };
      }
      // Return a placeholder if product not found
      return { __type: "product", id: obj.id, notFound: true };
    }

    // Category reference
    if (obj.__type === "categoryRef" && obj.id) {
      const categoryData = resolvedEntities.categories?.[obj.id];
      if (categoryData) {
        return {
          __type: "category",
          ...categoryData,
        };
      }
      // Return a placeholder if category not found
      return { __type: "category", id: obj.id, notFound: true };
    }
  }

  // Clone the object to avoid mutation
  const result = { ...obj };

  // Process each property
  for (const key in result) {
    result[key] = resolveReferences(result[key], resolvedEntities);
  }

  return result;
}

// Add this new controller function to pageContentController.js

// @desc    Get all pages by page type
// @route   GET /api/content/:pageType
// @access  Public
const getPagesByType = async (req, res) => {
  try {
    const { pageType } = req.params;
    const { page = 1, limit = 10, includeContent = false } = req.query;

    console.log(`[GET_BY_TYPE] Fetching pages of type: ${pageType}`);
    console.log(
      `[GET_BY_TYPE] Page: ${page}, Limit: ${limit}, Include Content: ${includeContent}`
    );

    // Validate page type
    if (!["category", "product", "homepage", "custom"].includes(pageType)) {
      console.log(`[GET_BY_TYPE] Invalid page type: ${pageType}`);
      return res.status(400).json({
        success: false,
        message:
          "Invalid page type. Must be one of: category, product, homepage, custom",
      });
    }

    // Convert query params to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build the query
    const query = { pageType };

    // Select fields based on includeContent flag
    let selectFields = "pageId pageType title isActive updatedAt createdAt";
    if (includeContent === "true") {
      selectFields += " content";
    }

    // Execute query with pagination
    const [pageContents, totalCount] = await Promise.all([
      PageContent.find(query)
        .select(selectFields)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PageContent.countDocuments(query),
    ]);

    console.log(
      `[GET_BY_TYPE] Found ${pageContents.length} pages of type ${pageType}`
    );

    // If content is included and we have pages, resolve references
    let processedContent = pageContents;

    if (includeContent === "true" && pageContents.length > 0) {
      console.log(`[GET_BY_TYPE] Processing content with reference resolution`);

      // Collect all references from all pages
      const globalReferenceCollector = {
        products: new Set(),
        categories: new Set(),
      };

      // Collect references from all pages
      pageContents.forEach((pageContent) => {
        if (pageContent.content) {
          traverseAndCollect(pageContent.content, globalReferenceCollector);
        }
      });

      console.log(
        `[GET_BY_TYPE] Global references - Products: ${globalReferenceCollector.products.size}, Categories: ${globalReferenceCollector.categories.size}`
      );

      // Fetch all referenced entities in batch
      const resolvedEntities = {};

      // Resolve product references if any exist
      if (globalReferenceCollector.products.size > 0) {
        const productIds = Array.from(globalReferenceCollector.products);
        console.log(`[GET_BY_TYPE] Resolving product references:`, productIds);

        const products = await Product.find({
          _id: { $in: productIds },
          isPublished: true,
        }).select("_id name slug price images discountPrice stock");

        resolvedEntities.products = products.reduce((map, product) => {
          map[product._id.toString()] = {
            id: product._id,
            name: product.name,
            slug: product.slug,
            price: product.price,
            discountPrice: product.discountPrice,
            imageUrl:
              product.images && product.images.length > 0
                ? product.images[0]
                : null,
            stock: product.stock,
          };
          return map;
        }, {});
      }

      // Resolve category references if any exist
      if (globalReferenceCollector.categories.size > 0) {
        const categoryIds = Array.from(globalReferenceCollector.categories);
        console.log(
          `[GET_BY_TYPE] Resolving category references:`,
          categoryIds
        );

        const categories = await Category.find({
          _id: { $in: categoryIds },
        }).select("_id name slug image");

        resolvedEntities.categories = categories.reduce((map, category) => {
          map[category._id.toString()] = {
            id: category._id,
            name: category.name,
            slug: category.slug,
            image: category.image,
          };
          return map;
        }, {});
      }

      // Resolve references for each page
      processedContent = pageContents.map((pageContent) => {
        if (pageContent.content) {
          const resolvedContent = resolveReferences(
            pageContent.content,
            resolvedEntities
          );
          return {
            ...pageContent,
            content: resolvedContent,
          };
        }
        return pageContent;
      });

      console.log(`[GET_BY_TYPE] Reference resolution completed for all pages`);
    }

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    console.log(
      `[GET_BY_TYPE] Pagination - Total: ${totalCount}, Pages: ${totalPages}, Current: ${pageNum}`
    );

    res.status(200).json({
      success: true,
      pageType,
      data: processedContent,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        limit: limitNum,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error("Error fetching pages by type:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export {
  getPageContent,
  createPageContent,
  updatePageContent,
  getAllPageContent,
  deletePageContent,
  getPagesByType,
};
