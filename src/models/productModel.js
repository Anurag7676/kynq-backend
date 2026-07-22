


import mongoose from "mongoose";

const reviewSchema = mongoose.Schema(
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
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const variationSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  options: [
    {
      type: String,
      required: true,
    },
  ],
  priceModifier: {
    type: Number,
    default: 0,
  },
});

const imageSchema = mongoose.Schema({
  url: {
    type: String,
    required: true,
  },
  alt: {
    type: String,
    default: "Product Image",
  },
  isFeatured: {
    type: Boolean,
    default: false,
  },
});

const productSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please add a product name"],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      required: [true, "Please add a product description"],
    },
    shortDescription: {
      type: String,
      required: false,
    },
    // 🆕 NEW: Request Quote Option
    isRequestQuote: {
      type: Boolean,
      default: false,
    },
    price: {
      type: Number,
      required: function() {
        // Price is only required if this is NOT a request quote product
        return !this.isRequestQuote;
      },
      default: 0,
    },
    comparePrice: {
      type: Number,
      default: 0,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Category",
    },
    subcategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    },
    // 🆕 NEW: UOM field that inherits from category
    uom: {
      type: String,
      trim: true,
      default: null,
    },
    brand: {
      type: String,
      required: false,
    },
    sku: {
      type: String,
      required: true,
      unique: true,
    },
    stock: {
      type: Number,
      required: function() {
        // Stock is only required if this is NOT a request quote product
        return !this.isRequestQuote;
      },
      default: 0,
    },
    variations: [variationSchema],
    images: [imageSchema],
    tags: [String],
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
    reviews: [reviewSchema],
    rating: {
      type: Number,
      default: 0,
    },
    numReviews: {
      type: Number,
      default: 0,
    },
    shippingInfo: {
      weight: Number,
      dimensions: {
        length: Number,
        width: Number,
        height: Number,
      },
      freeShipping: {
        type: Boolean,
        default: false,
      },
    },
    shippingEstimatedTime: {
      type: String,
      default: null,
    },
    seo: {
      metaTitle: String,
      metaDescription: String,
      metaKeywords: [String],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    // VENDOR DETAILS
    vendorName: {
      type: String,
      trim: true,
    },
    vendorCode: {
      type: String,
      trim: true,
      uppercase: true,
    },
    vendorEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    vendorPhone: {
      type: String,
      trim: true,
    },
    vendorAddress: {
      type: String,
      trim: true,
    },
    // 🆕 NEW: Vendor SKU information (manual updates only)
    vendorSku: {
      type: String,
      trim: true,
    },
    // 🆕 NEW: Vendor Cost (price vendor sells to us)
    vendorCost: {
      type: Number,
      min: 0,
      default: null,
    },
    // COUNTRY OF ORIGIN
    countryOfOrigin: {
      country: {
        type: String,
        trim: true,
      },
      countryCode: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 3, // ISO country codes
      },
      region: {
        type: String,
        trim: true,
      },
    },
    // 🆕 HSN CODE (Indian Tax System)
    hsnCode: {
      type: String,
      trim: true,
      validate: {
        validator: function(v) {
          // HSN codes are typically 4, 6, or 8 digits
          return !v || /^\d{4,8}$/.test(v);
        },
        message: 'HSN code must be 4-8 digits'
      },
      index: true, // For filtering and reporting
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Add index for UOM field
productSchema.index({
  name: "text",
  description: "text",
  brand: "text",
  tags: "text",
  uom: "text", // Add UOM to text search
});

// Add separate index for UOM filtering
productSchema.index({ uom: 1 });

// Add index for country of origin
productSchema.index({ "countryOfOrigin.countryCode": 1 });

productSchema.methods.isInStock = function () {
  // Request quote products are always "available"
  if (this.isRequestQuote) return true;
  return this.stock > 0;
};

// 🆕 NEW: Method to get UOM info with fallback
productSchema.methods.getUomInfo = function () {
  return {
    uom: this.uom || null,
    hasUom: !!this.uom,
    displayText: this.uom ? `per ${this.uom}` : null
  };
};

productSchema.virtual("url").get(function () {
  return `/products/${this.slug}`;
});

// 🆕 UPDATED: Pre-save middleware to inherit UOM from category
productSchema.pre("save", async function (next) {
  try {
    // Handle reviews and ratings
    if (this.reviews && this.reviews.length > 0) {
      this.numReviews = this.reviews.length;
      const totalRating = this.reviews.reduce(
        (acc, review) => acc + review.rating,
        0
      );
      this.rating = (totalRating / this.reviews.length).toFixed(1);
    } else {
      this.numReviews = 0;
      this.rating = 0;
    }
    
    // If this is a request quote product, set price to 0 and stock to 999999
    if (this.isRequestQuote) {
      this.price = 0;
      this.comparePrice = 0;
      this.stock = 999999; // Large number to indicate unlimited availability
    }

    // 🆕 NEW: Inherit UOM from category if not explicitly set
    if (!this.uom && this.category) {
      // Only try to populate if category is modified or this is a new document
      if (this.isModified('category') || this.isNew) {
        const Category = this.model('Category');
        const category = await Category.findById(this.category);
        
        if (category && category.uom) {
          this.uom = category.uom;
        }
        
        // Also check subcategory if main category doesn't have UOM
        if (!this.uom && this.subcategory) {
          const subcategory = await Category.findById(this.subcategory);
          if (subcategory && subcategory.uom) {
            this.uom = subcategory.uom;
          }
        }
      }
    }
    
    // 🆕 NEW: Ensure country code is uppercase
    if (this.countryOfOrigin && this.countryOfOrigin.countryCode) {
      this.countryOfOrigin.countryCode = this.countryOfOrigin.countryCode.toUpperCase();
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// 🆕 NEW: Static method to sync UOM from categories for existing products
productSchema.statics.syncUomFromCategories = async function() {
  try {
    console.log('[UOM SYNC] Starting UOM synchronization for all products...');
    
    // Find all products that don't have UOM set
    const productsWithoutUom = await this.find({ 
      $or: [
        { uom: { $exists: false } },
        { uom: null },
        { uom: '' }
      ]
    }).populate('category subcategory');

    console.log(`[UOM SYNC] Found ${productsWithoutUom.length} products without UOM`);

    let updatedCount = 0;
    
    for (const product of productsWithoutUom) {
      let newUom = null;
      
      // Try to get UOM from main category first
      if (product.category && product.category.uom) {
        newUom = product.category.uom;
      }
      // If not found, try subcategory
      else if (product.subcategory && product.subcategory.uom) {
        newUom = product.subcategory.uom;
      }
      
      // Update product if UOM found
      if (newUom) {
        await this.updateOne(
          { _id: product._id },
          { $set: { uom: newUom } }
        );
        updatedCount++;
        console.log(`[UOM SYNC] Updated product "${product.name}" with UOM: ${newUom}`);
      }
    }
    
    console.log(`[UOM SYNC] Completed! Updated ${updatedCount} products with UOM.`);
    return { total: productsWithoutUom.length, updated: updatedCount };
    
  } catch (error) {
    console.error('[UOM SYNC] Error during UOM synchronization:', error);
    throw error;
  }
};

// 🆕 NEW: Static method to update product UOM when category UOM changes
productSchema.statics.updateUomFromCategory = async function(categoryId, newUom) {
  try {
    console.log(`[UOM UPDATE] Updating products for category ${categoryId} with UOM: ${newUom}`);
    
    const updateResult = await this.updateMany(
      {
        $or: [
          { category: categoryId },
          { subcategory: categoryId }
        ]
      },
      {
        $set: { uom: newUom }
      }
    );
    
    console.log(`[UOM UPDATE] Updated ${updateResult.modifiedCount} products with new UOM`);
    return updateResult.modifiedCount;
    
  } catch (error) {
    console.error('[UOM UPDATE] Error updating product UOMs:', error);
    throw error;
  }
};

// 🆕 NEW: Static method to get UOM statistics
productSchema.statics.getUomStats = async function() {
  return this.aggregate([
    {
      $match: {
        uom: { $exists: true, $ne: null, $ne: "" }
      }
    },
    {
      $group: {
        _id: "$uom",
        productCount: { $sum: 1 },
        products: {
          $push: {
            id: "$_id",
            name: "$name",
            sku: "$sku",
            isPublished: "$isPublished"
          }
        }
      }
    },
    {
      $sort: { productCount: -1 }
    }
  ]);
};

// 🆕 NEW: Vendor-related methods
productSchema.methods.getVendorSummary = function () {
  if (!this.vendorName && !this.vendorCode) {
    return null;
  }

  return {
    name: this.vendorName,
    code: this.vendorCode,
    email: this.vendorEmail,
    phone: this.vendorPhone,
    address: this.vendorAddress,
  };
};

  // 🆕 NEW: Static method to find products by vendor code
  productSchema.statics.findByVendorCode = function (vendorCode) {
    return this.find({ vendorCode: vendorCode });
  };

  // 🆕 NEW: Static method to get vendor statistics
  productSchema.statics.getVendorStats = async function () {
    return this.aggregate([
      {
        $match: {
          vendorName: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$vendorCode",
          vendorName: { $first: "$vendorName" },
          vendorEmail: { $first: "$vendorEmail" },
          vendorPhone: { $first: "$vendorPhone" },
          vendorAddress: { $first: "$vendorAddress" },
          productsCount: { $sum: 1 },
          products: {
            $push: {
              id: "$_id",
              name: "$name",
              sku: "$sku",
              isPublished: "$isPublished",
            },
          },
        },
      },
      {
        $sort: { productsCount: -1 },
      },
    ]);
  };

  // 🆕 NEW: Country of origin methods
  productSchema.methods.getOriginSummary = function () {
    if (!this.countryOfOrigin || !this.countryOfOrigin.country) {
      return null;
    }

    return {
      country: this.countryOfOrigin.country,
      code: this.countryOfOrigin.countryCode,
      region: this.countryOfOrigin.region,
    };
  };

  productSchema.statics.findByCountry = function (countryCode) {
    return this.find({ "countryOfOrigin.countryCode": countryCode.toUpperCase() });
  };

  productSchema.statics.getCountryStats = async function () {
    return this.aggregate([
      {
        $match: {
          "countryOfOrigin.country": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$countryOfOrigin.countryCode",
          country: { $first: "$countryOfOrigin.country" },
          region: { $first: "$countryOfOrigin.region" },
          productsCount: { $sum: 1 },
          products: {
            $push: {
              id: "$_id",
              name: "$name",
              sku: "$sku",
              isPublished: "$isPublished",
            },
          },
        },
      },
      {
        $sort: { productsCount: -1 },
      },
    ]);
  };

  // 🆕 HSN CODE METHODS
  productSchema.methods.getHsnInfo = function () {
    if (!this.hsnCode) {
      return null;
    }

    return {
      hsnCode: this.hsnCode,
    };
  };

  productSchema.statics.findByHsnCode = function (hsnCode) {
    return this.find({ hsnCode: hsnCode });
  };

  productSchema.statics.getHsnStats = async function () {
    return this.aggregate([
      {
        $match: {
          hsnCode: { $exists: true, $ne: null, $ne: "" },
        },
      },
      {
        $group: {
          _id: "$hsnCode",
          productsCount: { $sum: 1 },
          products: {
            $push: {
              id: "$_id",
              name: "$name",
              sku: "$sku",
              isPublished: "$isPublished",
              category: "$category",
            },
          },
        },
      },
      {
        $sort: { productsCount: -1 },
      },
    ]);
  };

const Product = mongoose.model("Product", productSchema);

export default Product;