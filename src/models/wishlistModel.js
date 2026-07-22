import mongoose from "mongoose";

const wishlistItemSchema = mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
  // Additional fields specific to home decor items
  roomType: {
    type: String,
    default: "other",
  },
  notes: {
    type: String,
    maxlength: [200, "Notes cannot exceed 200 characters"],
  },
});

const wishlistSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    items: [wishlistItemSchema],
    name: {
      type: String,
      default: "My Wishlist",
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    // For home decor projects/rooms organization
    projectName: {
      type: String,
    },
    projectDescription: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Method to add item to wishlist
wishlistSchema.methods.addItem = function (productId, roomType, notes) {
  const existingItemIndex = this.items.findIndex(
    (item) => item.product.toString() === productId.toString()
  );

  if (existingItemIndex === -1) {
    // Only add if item doesn't already exist
    this.items.push({
      product: productId,
      roomType: roomType || "other",
      notes: notes || "",
    });
  }

  return this;
};

// Method to remove item from wishlist
wishlistSchema.methods.removeItem = function (itemId) {
  this.items = this.items.filter(
    (item) => item._id.toString() !== itemId.toString()
  );
  return this;
};

// Method to update item notes or room type
wishlistSchema.methods.updateItem = function (itemId, roomType, notes) {
  const itemIndex = this.items.findIndex(
    (item) => item._id.toString() === itemId.toString()
  );

  if (itemIndex > -1) {
    if (roomType) {
      this.items[itemIndex].roomType = roomType;
    }
    if (notes !== undefined) {
      this.items[itemIndex].notes = notes;
    }
  }

  return this;
};

// Method to move item to cart
wishlistSchema.methods.moveItemToCart = async function (itemId, Cart) {
  const itemIndex = this.items.findIndex(
    (item) => item._id.toString() === itemId.toString()
  );

  if (itemIndex > -1) {
    const wishlistItem = this.items[itemIndex];

    // Find or create user's cart
    let cart = await Cart.findOne({ user: this.user });
    if (!cart) {
      cart = new Cart({
        user: this.user,
        items: [],
      });
    }

    // Get product details to add to cart
    // This requires populating the product
    await this.populate({
      path: `items.${itemIndex}.product`,
      select: "price name stock",
    });

    const product = wishlistItem.product;

    // Add to cart only if product is in stock
    if (product.stock > 0) {
      cart.addItem(
        product._id,
        1, // Default quantity
        [], // No variations selected by default
        product.price
      );

      await cart.save();

      // Remove from wishlist after adding to cart
      this.items.splice(itemIndex, 1);
      await this.save();

      return {
        success: true,
        cart,
        message: "Item moved to cart successfully",
      };
    } else {
      return { success: false, message: "Product is out of stock" };
    }
  }

  return { success: false, message: "Item not found in wishlist" };
};

// Method to clear the wishlist
wishlistSchema.methods.clearWishlist = function () {
  this.items = [];
  return this;
};

// Virtual for item count
wishlistSchema.virtual("itemCount").get(function () {
  return this.items.length;
});

// Enable virtuals in JSON
wishlistSchema.set("toJSON", { virtuals: true });
wishlistSchema.set("toObject", { virtuals: true });

const Wishlist = mongoose.model("Wishlist", wishlistSchema);

export default Wishlist;
