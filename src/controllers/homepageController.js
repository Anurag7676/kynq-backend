// controllers/homepageController.js
import Homepage from "../models/homepageModel.js";
import Product from "../models/productModel.js";
import Category from "../models/categoryModel.js";
import Blog from "../models/blogModel.js";
import PageContent from "../models/pageContentModel.js";

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

// Helper function to populate page content for entities
async function populatePageContent(entities, entityType) {
  if (!entities || entities.length === 0) return entities;

  // Extract entity IDs
  const entityIds = entities.map((entity) => entity._id.toString());

  // Create page content IDs
  const pageContentIds = entityIds.map((id) => `${entityType}-${id}`);

  // Fetch page content for these entities
  const pageContents = await PageContent.find({
    pageId: { $in: pageContentIds },
    pageType: entityType,
    isActive: true,
  }).lean();

  // Create a map for quick lookup
  const pageContentMap = {};
  pageContents.forEach((content) => {
    const entityId = content.pageId.split("-")[1]; // Extract entity ID from pageId
    pageContentMap[entityId] = content;
  });

  // Resolve references in page content
  const referenceCollector = {
    products: new Set(),
    categories: new Set(),
  };

  // Collect all references from page contents
  pageContents.forEach((pageContent) => {
    if (pageContent.content) {
      traverseAndCollect(pageContent.content, referenceCollector);
    }
  });

  // Fetch referenced entities for page content
  const resolvedEntities = {};

  // Resolve product references
  if (referenceCollector.products.size > 0) {
    const productIds = Array.from(referenceCollector.products);
    const products = await Product.find({
      _id: { $in: productIds },
      isPublished: true,
    }).select("_id name slug price images discountPrice stock isRequestQuote");

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
        productType: product.isRequestQuote ? 'quote' : 'regular',
      };
      return map;
    }, {});
  }

  // Resolve category references
  if (referenceCollector.categories.size > 0) {
    const categoryIds = Array.from(referenceCollector.categories);
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

  // Attach resolved page content to entities
  return entities.map((entity) => {
    const entityData = entity.toObject ? entity.toObject() : entity;
    const pageContent = pageContentMap[entityData._id.toString()];

    if (pageContent) {
      // Resolve references in page content
      const resolvedContent = resolveReferences(
        pageContent.content,
        resolvedEntities
      );
      entityData.pageContent = {
        ...pageContent,
        content: resolvedContent,
      };
    }

    return entityData;
  });
}

// @desc    Get homepage content
// @route   GET /api/homepage
// @access  Public
const getHomepage = async (req, res) => {
  try {
    let homepage = await Homepage.findOne({ isActive: true });

    if (!homepage) {
      return res.status(404).json({
        success: false,
        message: "Homepage content not found",
      });
    }

    // Populate all references based on query parameters
    const populate = req.query.populate?.split(",") || [];
    const includePageContent = req.query.includePageContent === "true";

    // Always populate basic references
    const populateArray = [];

    // Populate products for different sections
    if (populate.includes("products") || populate.includes("all")) {
      populateArray.push(
        {
          path: "advancedProductShowcase.products.productId",
          model: "Product",
          select:
            "name slug price images category subcategory brand stock rating numReviews isPublished isRequestQuote variations",
          populate: [
            { path: "category", select: "name slug" },
            { path: "subcategory", select: "name slug" },
          ],
        },
        {
          path: "fallbackProductView.products.productId",
          model: "Product",
          select:
            "name slug price images category subcategory brand stock rating numReviews isPublished isRequestQuote",
          populate: [
            { path: "category", select: "name slug" },
            { path: "subcategory", select: "name slug" },
          ],
        },
        {
          path: "luxuryShowcase.products.productId",
          model: "Product",
          select:
            "name slug price images category subcategory brand stock rating numReviews isPublished isRequestQuote description features",
          populate: [
            { path: "category", select: "name slug" },
            { path: "subcategory", select: "name slug" },
          ],
        },
        {
          path: "featuredProducts.products.productId",
          model: "Product",
          select:
            "name slug price images category subcategory brand stock rating numReviews isPublished isRequestQuote isFeatured",
          populate: [
            { path: "category", select: "name slug" },
            { path: "subcategory", select: "name slug" },
          ],
        },
        {
          path: "productSpotlight.products.productId",
          model: "Product",
          select:
            "name slug price images category subcategory brand stock rating numReviews isPublished isRequestQuote features",
          populate: [
            { path: "category", select: "name slug" },
            { path: "subcategory", select: "name slug" },
          ],
        }
      );
    }

    // Populate categories
    if (populate.includes("categories") || populate.includes("all")) {
      populateArray.push({
        path: "categoryShowcase.categories.categoryId",
        model: "Category",
        select: "name slug description image icon isActive displayOrder",
        populate: {
          path: "subcategories",
          select: "name slug isActive displayOrder",
        },
      });
    }

    // Populate blogs
    if (populate.includes("blogs") || populate.includes("all")) {
      populateArray.push({
        path: "featuredBlogs.blogs.blogId",
        model: "Blog",
        select:
          "title slug excerpt featuredImage category publishedAt readTime views isFeatured status isActive",
        populate: {
          path: "author",
          select: "name email",
        },
      });
    }

    // Apply population
    if (populateArray.length > 0) {
      homepage = await Homepage.populate(homepage, populateArray);
    }

    // Handle dynamic category fetching if enabled
    if (homepage.categoryShowcase?.settings?.fetchAllCategories) {
      const categories = await Category.find({
        isActive: true,
        parent: null,
      })
        .sort({ displayOrder: 1, name: 1 })
        .limit(homepage.categoryShowcase.settings.displayLimit || 12)
        .populate("subcategories", "name slug isActive displayOrder");

      homepage.categoryShowcase.categoriesData = categories;
    }

    // Handle dynamic blog fetching if enabled
    if (homepage.featuredBlogs?.settings?.fetchFromAPI) {
      const blogQuery = {
        status: "published",
        isActive: true,
      };

      if (homepage.featuredBlogs.settings.showFeaturedOnly) {
        blogQuery.isFeatured = true;
      }

      const blogs = await Blog.find(blogQuery)
        .sort({ publishedAt: -1 })
        .limit(homepage.featuredBlogs.settings.maxBlogs || 3)
        .select(
          "title slug excerpt featuredImage category publishedAt readTime views"
        )
        .populate("author", "name");

      homepage.featuredBlogs.blogsData = blogs;
    }

    // Convert to plain object for manipulation
    const homepageData = homepage.toObject();

    // Populate page content if requested
    if (includePageContent) {
      console.log("Populating page content for homepage entities");

      // Collect all products from different sections
      const allProducts = [];
      const productSections = [
        "advancedProductShowcase",
        "fallbackProductView",
        "luxuryShowcase",
        "featuredProducts",
        "productSpotlight",
      ];

      productSections.forEach((section) => {
        if (homepageData[section]?.products) {
          homepageData[section].products.forEach((productItem) => {
            if (productItem.productId) {
              allProducts.push(productItem.productId);
            }
          });
        }
      });

      // Collect all categories
      const allCategories = [];

      // From category showcase
      if (homepageData.categoryShowcase?.categories) {
        homepageData.categoryShowcase.categories.forEach((categoryItem) => {
          if (categoryItem.categoryId) {
            allCategories.push(categoryItem.categoryId);
          }
        });
      }

      // From dynamic categories data
      if (homepageData.categoryShowcase?.categoriesData) {
        allCategories.push(...homepageData.categoryShowcase.categoriesData);
      }

      // Populate page content for products
      if (allProducts.length > 0) {
        console.log(
          `Populating page content for ${allProducts.length} products`
        );

        // Remove duplicates
        const uniqueProducts = allProducts.filter(
          (product, index, self) =>
            index ===
            self.findIndex((p) => p._id.toString() === product._id.toString())
        );

        const productsWithPageContent = await populatePageContent(
          uniqueProducts,
          "product"
        );

        // Create a map for quick lookup
        const productPageContentMap = {};
        productsWithPageContent.forEach((product) => {
          productPageContentMap[product._id.toString()] = product.pageContent;
        });

        // Attach page content and productType to products in different sections
        productSections.forEach((section) => {
          if (homepageData[section]?.products) {
            homepageData[section].products.forEach((productItem) => {
              if (productItem.productId && productItem.productId._id) {
                const pageContent =
                  productPageContentMap[productItem.productId._id.toString()];
                if (pageContent) {
                  productItem.productId.pageContent = pageContent;
                }
                // Add productType derived from isRequestQuote
                if (typeof productItem.productId.isRequestQuote === 'boolean') {
                  productItem.productId.productType = productItem.productId.isRequestQuote ? 'quote' : 'regular';
                }
              }
            });
          }
        });
      }

      // Populate page content for categories
      if (allCategories.length > 0) {
        console.log(
          `Populating page content for ${allCategories.length} categories`
        );

        // Remove duplicates
        const uniqueCategories = allCategories.filter(
          (category, index, self) =>
            index ===
            self.findIndex((c) => c._id.toString() === category._id.toString())
        );

        const categoriesWithPageContent = await populatePageContent(
          uniqueCategories,
          "category"
        );

        // Create a map for quick lookup
        const categoryPageContentMap = {};
        categoriesWithPageContent.forEach((category) => {
          categoryPageContentMap[category._id.toString()] =
            category.pageContent;
        });

        // Attach page content to categories in category showcase
        if (homepageData.categoryShowcase?.categories) {
          homepageData.categoryShowcase.categories.forEach((categoryItem) => {
            if (categoryItem.categoryId && categoryItem.categoryId._id) {
              const pageContent =
                categoryPageContentMap[categoryItem.categoryId._id.toString()];
              if (pageContent) {
                categoryItem.categoryId.pageContent = pageContent;
              }
            }
          });
        }

        // Attach page content to dynamic categories data
        if (homepageData.categoryShowcase?.categoriesData) {
          homepageData.categoryShowcase.categoriesData.forEach((category) => {
            if (category._id) {
              const pageContent =
                categoryPageContentMap[category._id.toString()];
              if (pageContent) {
                category.pageContent = pageContent;
              }
            }
          });
        }
      }

      // Also enrich each populated product with productType across sections
      const enrichSectionsWithProductType = () => {
        const sections = [
          "advancedProductShowcase",
          "fallbackProductView",
          "luxuryShowcase",
          "featuredProducts",
          "productSpotlight",
        ];
        sections.forEach((section) => {
          if (homepageData[section]?.products) {
            homepageData[section].products.forEach((productItem) => {
              const p = productItem.productId;
              if (p && typeof p.isRequestQuote === 'boolean' && !p.productType) {
                p.productType = p.isRequestQuote ? 'quote' : 'regular';
              }
            });
          }
        });
      };
      enrichSectionsWithProductType();

      // Special handling for luxuryShowcase to remove custom title/description when product data exists
      if (homepageData.luxuryShowcase?.products) {
        homepageData.luxuryShowcase.products.forEach((productItem) => {
          if (productItem.productId && productItem.productId._id) {
            // Remove custom title and description in favor of product data
            if (productItem.customTitle) {
              delete productItem.customTitle;
            }
            if (productItem.customDescription) {
              delete productItem.customDescription;
            }

            // Ensure we use product's name and description
            productItem.title = productItem.productId.name;
            productItem.description = productItem.productId.description || "";
          }
        });
      }
    }

    res.status(200).json({
      success: true,
      data: homepageData,
    });
  } catch (error) {
    console.error("Error in getHomepage:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get specific homepage section
// @route   GET /api/homepage/section/:sectionName
// @access  Public
const getHomepageSection = async (req, res) => {
  try {
    const { sectionName } = req.params;
    const includePageContent = req.query.includePageContent === "true";

    const homepage = await Homepage.findOne({ isActive: true });

    if (!homepage) {
      return res.status(404).json({
        success: false,
        message: "Homepage content not found",
      });
    }

    // Check if section exists
    if (!homepage[sectionName]) {
      return res.status(404).json({
        success: false,
        message: "Section not found",
      });
    }

    // Check if section is enabled
    if (homepage[sectionName].isEnabled === false) {
      return res.status(404).json({
        success: false,
        message: "Section is disabled",
      });
    }

    let sectionData = homepage[sectionName];

    // Populate specific section data based on section type
    switch (sectionName) {
      case "advancedProductShowcase":
      case "fallbackProductView":
      case "featuredProducts":
      case "productSpotlight":
        const productField = `${sectionName}.products.productId`;
        await homepage.populate({
          path: productField,
          model: "Product",
          select:
            "name slug price images category subcategory brand stock rating numReviews isPublished isRequestQuote",
          populate: [
            { path: "category", select: "name slug" },
            { path: "subcategory", select: "name slug" },
          ],
        });
        sectionData = homepage[sectionName];
        break;

      case "luxuryShowcase":
        const luxuryProductField = `${sectionName}.products.productId`;
        await homepage.populate({
          path: luxuryProductField,
          model: "Product",
          select:
            "name slug price images category subcategory brand stock rating numReviews isPublished isRequestQuote description features",
          populate: [
            { path: "category", select: "name slug" },
            { path: "subcategory", select: "name slug" },
          ],
        });
        sectionData = homepage[sectionName];
        break;

      case "categoryShowcase":
        if (homepage.categoryShowcase.settings?.fetchAllCategories) {
          const categories = await Category.find({
            isActive: true,
            parent: null,
          })
            .sort({ displayOrder: 1, name: 1 })
            .limit(homepage.categoryShowcase.settings.displayLimit || 12)
            .populate("subcategories", "name slug isActive displayOrder");

          sectionData.categoriesData = categories;
        } else {
          await homepage.populate({
            path: "categoryShowcase.categories.categoryId",
            model: "Category",
            select: "name slug description image icon isActive displayOrder",
            populate: {
              path: "subcategories",
              select: "name slug isActive displayOrder",
            },
          });
          sectionData = homepage.categoryShowcase;
        }
        break;

      case "featuredBlogs":
        if (homepage.featuredBlogs.settings?.fetchFromAPI) {
          const blogQuery = {
            status: "published",
            isActive: true,
          };

          if (homepage.featuredBlogs.settings.showFeaturedOnly) {
            blogQuery.isFeatured = true;
          }

          const blogs = await Blog.find(blogQuery)
            .sort({ publishedAt: -1 })
            .limit(homepage.featuredBlogs.settings.maxBlogs || 3)
            .select(
              "title slug excerpt featuredImage category publishedAt readTime views"
            )
            .populate("author", "name");

          sectionData.blogsData = blogs;
        } else {
          await homepage.populate({
            path: "featuredBlogs.blogs.blogId",
            model: "Blog",
            select:
              "title slug excerpt featuredImage category publishedAt readTime views isFeatured status isActive",
            populate: {
              path: "author",
              select: "name email",
            },
          });
          sectionData = homepage.featuredBlogs;
        }
        break;
    }

    // Convert to plain object for manipulation
    const sectionDataObj = JSON.parse(JSON.stringify(sectionData));

    // Populate page content if requested
    if (includePageContent) {
      console.log(`Populating page content for section: ${sectionName}`);

      // Handle product sections
      if (
        [
          "advancedProductShowcase",
          "fallbackProductView",
          "luxuryShowcase",
          "featuredProducts",
          "productSpotlight",
        ].includes(sectionName)
      ) {
        if (sectionDataObj.products) {
          const products = sectionDataObj.products
            .map((item) => item.productId)
            .filter((product) => product && product._id);

          if (products.length > 0) {
            const productsWithPageContent = await populatePageContent(
              products,
              "product"
            );

            const productPageContentMap = {};
            productsWithPageContent.forEach((product) => {
              productPageContentMap[product._id.toString()] =
                product.pageContent;
            });

            sectionDataObj.products.forEach((productItem) => {
              if (productItem.productId && productItem.productId._id) {
                const pageContent =
                  productPageContentMap[productItem.productId._id.toString()];
                if (pageContent) {
                  productItem.productId.pageContent = pageContent;
                }
              }
            });
          }
        }

        // Special handling for luxuryShowcase
        if (sectionName === "luxuryShowcase" && sectionDataObj.products) {
          sectionDataObj.products.forEach((productItem) => {
            if (productItem.productId && productItem.productId._id) {
              // Remove custom title and description in favor of product data
              if (productItem.customTitle) {
                delete productItem.customTitle;
              }
              if (productItem.customDescription) {
                delete productItem.customDescription;
              }

              // Ensure we use product's name and description
              productItem.title = productItem.productId.name;
              productItem.description = productItem.productId.description || "";
            }
          });
        }
      }

      // Handle category section
      if (sectionName === "categoryShowcase") {
        const allCategories = [];

        // From categories array
        if (sectionDataObj.categories) {
          sectionDataObj.categories.forEach((categoryItem) => {
            if (categoryItem.categoryId) {
              allCategories.push(categoryItem.categoryId);
            }
          });
        }

        // From dynamic categories data
        if (sectionDataObj.categoriesData) {
          allCategories.push(...sectionDataObj.categoriesData);
        }

        if (allCategories.length > 0) {
          const categoriesWithPageContent = await populatePageContent(
            allCategories,
            "category"
          );

          const categoryPageContentMap = {};
          categoriesWithPageContent.forEach((category) => {
            categoryPageContentMap[category._id.toString()] =
              category.pageContent;
          });

          // Attach to categories array
          if (sectionDataObj.categories) {
            sectionDataObj.categories.forEach((categoryItem) => {
              if (categoryItem.categoryId && categoryItem.categoryId._id) {
                const pageContent =
                  categoryPageContentMap[
                    categoryItem.categoryId._id.toString()
                  ];
                if (pageContent) {
                  categoryItem.categoryId.pageContent = pageContent;
                }
              }
            });
          }

          // Attach to dynamic categories data
          if (sectionDataObj.categoriesData) {
            sectionDataObj.categoriesData.forEach((category) => {
              if (category._id) {
                const pageContent =
                  categoryPageContentMap[category._id.toString()];
                if (pageContent) {
                  category.pageContent = pageContent;
                }
              }
            });
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      section: sectionName,
      data: sectionDataObj,
    });
  } catch (error) {
    console.error("Error in getHomepageSection:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Create homepage content (can only be created once)
// @route   POST /api/homepage
// @access  Private/Admin
const createHomepage = async (req, res) => {
  try {
    // Check if homepage already exists
    const existingHomepage = await Homepage.findOne();

    if (existingHomepage) {
      return res.status(400).json({
        success: false,
        message: "Homepage content already exists. Use update instead.",
      });
    }

    // Set the admin who created this
    const homepageData = {
      ...req.body,
      updatedBy: req.admin._id,
    };

    const homepage = await Homepage.create(homepageData);

    res.status(201).json({
      success: true,
      message: "Homepage created successfully",
      data: homepage,
    });
  } catch (error) {
    console.error("Error in createHomepage:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update homepage content
// @route   PUT /api/homepage
// @access  Private/Admin
const updateHomepage = async (req, res) => {
  try {
    let homepage = await Homepage.findOne();

    if (!homepage) {
      return res.status(404).json({
        success: false,
        message: "Homepage content not found. Create one first.",
      });
    }

    // Update the homepage with new data
    const updateData = {
      ...req.body,
      updatedBy: req.admin._id,
      lastUpdated: new Date(),
    };

    homepage = await Homepage.findByIdAndUpdate(homepage._id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "Homepage updated successfully",
      data: homepage,
    });
  } catch (error) {
    console.error("Error in updateHomepage:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update specific homepage section
// @route   PUT /api/homepage/section/:sectionName
// @access  Private/Admin
const updateHomepageSection = async (req, res) => {
  try {
    const { sectionName } = req.params;

    const homepage = await Homepage.findOne();

    if (!homepage) {
      return res.status(404).json({
        success: false,
        message: "Homepage content not found",
      });
    }

    // Check if section exists
    if (!homepage[sectionName] && homepage[sectionName] !== null) {
      return res.status(404).json({
        success: false,
        message: "Section not found",
      });
    }

    // Update specific section
    const updateObj = {
      [`${sectionName}`]: req.body,
      updatedBy: req.admin._id,
      lastUpdated: new Date(),
    };

    const updatedHomepage = await Homepage.findByIdAndUpdate(
      homepage._id,
      updateObj,
      {
        new: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      success: true,
      message: `${sectionName} section updated successfully`,
      section: sectionName,
      data: updatedHomepage[sectionName],
    });
  } catch (error) {
    console.error("Error in updateHomepageSection:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Toggle section enable/disable status
// @route   PUT /api/homepage/section/:sectionName/toggle
// @access  Private/Admin
const toggleSectionStatus = async (req, res) => {
  try {
    const { sectionName } = req.params;

    const homepage = await Homepage.findOne();

    if (!homepage) {
      return res.status(404).json({
        success: false,
        message: "Homepage content not found",
      });
    }

    // Check if section exists and has isEnabled property
    if (
      !homepage[sectionName] ||
      homepage[sectionName].isEnabled === undefined
    ) {
      return res.status(404).json({
        success: false,
        message: "Section not found or doesn't support enable/disable",
      });
    }

    // Toggle the section status
    const currentStatus = homepage[sectionName].isEnabled;
    const updateObj = {
      [`${sectionName}.isEnabled`]: !currentStatus,
      updatedBy: req.admin._id,
      lastUpdated: new Date(),
    };

    await Homepage.findByIdAndUpdate(homepage._id, updateObj);

    res.status(200).json({
      success: true,
      message: `${sectionName} section ${
        !currentStatus ? "enabled" : "disabled"
      } successfully`,
      section: sectionName,
      isEnabled: !currentStatus,
    });
  } catch (error) {
    console.error("Error in toggleSectionStatus:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Delete homepage content
// @route   DELETE /api/homepage
// @access  Private/Admin
const deleteHomepage = async (req, res) => {
  try {
    const homepage = await Homepage.findOne();

    if (!homepage) {
      return res.status(404).json({
        success: false,
        message: "Homepage content not found",
      });
    }

    await homepage.deleteOne();

    res.status(200).json({
      success: true,
      message: "Homepage content deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteHomepage:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get homepage statistics
// @route   GET /api/homepage/admin/stats
// @access  Private/Admin
const getHomepageStats = async (req, res) => {
  try {
    const homepage = await Homepage.findOne();

    if (!homepage) {
      return res.status(404).json({
        success: false,
        message: "Homepage content not found",
      });
    }

    // Count enabled/disabled sections
    const sections = [
      "heroBanner",
      "parallaxTextSection",
      "categoryShowcase",
      "advancedProductShowcase",
      "fallbackProductView",
      "luxuryShowcase",
      "featuredProducts",
      "immersiveGallery",
      "parallaxGallery",
      "productSpotlight",
      "designPhilosophy",
      "projectsShowcase",
      "companyStory",
      "featuredBlogs",
      "contactSection",
    ];

    const sectionStats = {
      total: sections.length,
      enabled: 0,
      disabled: 0,
    };

    sections.forEach((section) => {
      if (homepage[section] && homepage[section].isEnabled !== false) {
        sectionStats.enabled++;
      } else {
        sectionStats.disabled++;
      }
    });

    // Count content items
    const contentStats = {
      heroSlides: homepage.heroBanner?.slides?.length || 0,
      selectedCategories: homepage.categoryShowcase?.categories?.length || 0,
      advancedProducts: homepage.advancedProductShowcase?.products?.length || 0,
      fallbackProducts: homepage.fallbackProductView?.products?.length || 0,
      luxuryProducts: homepage.luxuryShowcase?.products?.length || 0,
      featuredProducts: homepage.featuredProducts?.products?.length || 0,
      spotlightProducts: homepage.productSpotlight?.products?.length || 0,
      galleryProjects: homepage.immersiveGallery?.projects?.length || 0,
      parallaxGalleries: homepage.parallaxGallery?.galleries?.length || 0,
      showcaseProjects: homepage.projectsShowcase?.projects?.length || 0,
      timelineItems: homepage.companyStory?.timeline?.length || 0,
      selectedBlogs: homepage.featuredBlogs?.blogs?.length || 0,
    };

    const stats = {
      lastUpdated: homepage.lastUpdated,
      updatedBy: homepage.updatedBy,
      isActive: homepage.isActive,
      sections: sectionStats,
      content: contentStats,
      seo: {
        title: homepage.seo?.title || "Not set",
        description: homepage.seo?.description || "Not set",
        hasOgImage: !!homepage.seo?.ogImage?.url,
      },
    };

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("Error in getHomepageStats:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export {
  getHomepage,
  createHomepage,
  updateHomepage,
  deleteHomepage,
  getHomepageSection,
  updateHomepageSection,
  toggleSectionStatus,
  getHomepageStats,
};
