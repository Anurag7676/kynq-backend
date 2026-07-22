import mongoose from "mongoose";
import slugify from "slugify";

const categorySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please add a category name"],
      trim: true,
      unique: true,
    },
    slug: {
      type: String,
      unique: true,
    },
    description: {
      type: String,
    },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    image: {
      type: String,
      default: null,
    },
    icon: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    metaTitle: {
      type: String,
    },
    metaDescription: {
      type: String,
    },

    // ADDITIONAL BUSINESS FIELDS
    businessInfo: {
      taxCategory: {
        type: String,
        enum: ["standard", "reduced", "zero", "exempt"],
        default: "standard",
      },
      hsnCode: {
        type: String,
        trim: true,
      },
      certifications: [String], // ISO, CE, etc.
      compliance: {
        isEcoFriendly: {
          type: Boolean,
          default: false,
        },
        isHandmade: {
          type: Boolean,
          default: false,
        },
        isOrganic: {
          type: Boolean,
          default: false,
        },
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// INDEXES FOR BETTER PERFORMANCE
categorySchema.index({ name: 1 });
categorySchema.index({ slug: 1 });
categorySchema.index({ parent: 1 });
categorySchema.index({ isActive: 1 });
categorySchema.index({ displayOrder: 1 });


// VIRTUAL FOR SUBCATEGORIES
categorySchema.virtual("subcategories", {
  ref: "Category",
  localField: "_id",
  foreignField: "parent",
});

// PRE-SAVE MIDDLEWARE
categorySchema.pre("save", function (next) {
  // Generate slug from name
  if (this.isModified("name")) {
    this.slug = slugify(this.name, { lower: true });
  }

  next();
});

// INSTANCE METHODS
categorySchema.methods.isParent = async function () {
  const subcategories = await this.model("Category").find({ parent: this._id });
  return subcategories.length > 0;
};

categorySchema.methods.isChild = function () {
  return this.parent !== null;
};

categorySchema.methods.getPath = async function () {
  let path = [{ _id: this._id, name: this.name, slug: this.slug }];

  if (this.parent) {
    let currentParent = await this.model("Category").findById(this.parent);
    while (currentParent) {
      path.unshift({
        _id: currentParent._id,
        name: currentParent.name,
        slug: currentParent.slug,
      });
      if (currentParent.parent) {
        currentParent = await this.model("Category").findById(
          currentParent.parent
        );
      } else {
        currentParent = null;
      }
    }
  }

  return path;
};







// STATIC METHODS











const Category = mongoose.model("Category", categorySchema);

export default Category;