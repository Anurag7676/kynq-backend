
// import mongoose from "mongoose";

// const cartItemSchema = mongoose.Schema({
//   product: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: "Product",
//     required: true,
//   },
//   quantity: {
//     type: Number,
//     required: true,
//     default: 1,
//     min: [1, "Quantity can not be less than 1"],
//   },
//   selectedVariations: [
//     {
//       name: String,
//       value: String,
//       priceModifier: Number,
//     },
//   ],
//   // ADD THESE NEW FIELDS for variation tracking
//   variationCombinationId: {
//     type: String,
//     default: null,
//   },
//   variationSku: {
//     type: String,
//     default: null,
//   },
//   variationsObject: {
//     type: Map,
//     of: String,
//     default: new Map(),
//   },
//   // Home decor specific
//   color: {
//     type: String,
//   },
//   size: {
//     type: String,
//   },
//   material: {
//     type: String,
//   },
//   price: {
//     type: Number,
//     required: true,
//   },
//   totalPrice: {
//     type: Number,
//     required: true,
//   },
//   // For home decor common addons
//   giftWrapping: {
//     type: Boolean,
//     default: false,
//   },
//   installationService: {
//     type: Boolean,
//     default: false,
//   },
// });

// const cartSchema = mongoose.Schema(
//   {
//     user: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//     },
//     sessionId: {
//       type: String,
//       required: function () {
//         return !this.user;
//       },
//     },
//     items: [cartItemSchema],
//     subtotal: {
//       type: Number,
//       default: 0,
//     },
//     taxRate: {
//       type: Number,
//       default: 0,
//     },
//     taxAmount: {
//       type: Number,
//       default: 0,
//     },
//     shippingMethod: {
//       type: String,
//       enum: ["standard", "express", "bulky", "white-glove", "free", "none"],
//       default: "standard",
//     },
//     shippingCost: {
//       type: Number,
//       default: 0,
//     },
//     // Home decor specific shipping options
//     deliveryDate: {
//       type: Date,
//     },
//     deliveryTimeSlot: {
//       type: String,
//       enum: ["morning", "afternoon", "evening", "all-day"],
//       default: "all-day",
//     },
//     // Special services for home decor
//     installationFee: {
//       type: Number,
//       default: 0,
//     },
//     assemblyFee: {
//       type: Number,
//       default: 0,
//     },
//     giftWrappingFee: {
//       type: Number,
//       default: 0,
//     },
//     discountCode: {
//       type: String,
//     },
//     discountAmount: {
//       type: Number,
//       default: 0,
//     },
//     total: {
//       type: Number,
//       default: 0,
//     },
//     active: {
//       type: Boolean,
//       default: true,
//     },
//   },
//   {
//     timestamps: true,
//   }
// );

// // Pre-save middleware to calculate totals
// cartSchema.pre("save", function (next) {
//   // Calculate item total prices
//   let subtotal = 0;

//   this.items.forEach((item) => {
//     // Calculate base price
//     let itemPrice = item.price;

//     // Add installation fee if selected
//     if (item.installationService) {
//       // Installation fee could be a percentage of item price for home decor
//       itemPrice += item.price * 0.1; // 10% installation fee example
//     }

//     // Add gift wrapping fee if selected
//     if (item.giftWrapping) {
//       itemPrice += 5; // Fixed $5 gift wrapping fee example
//     }

//     item.totalPrice = itemPrice * item.quantity;
//     subtotal += item.totalPrice;
//   });

//   this.subtotal = subtotal;
//   this.taxAmount = this.subtotal * (this.taxRate / 100);

//   // Calculate total with all fees
//   this.total =
//     this.subtotal +
//     this.taxAmount +
//     this.shippingCost +
//     this.installationFee +
//     this.assemblyFee +
//     this.giftWrappingFee -
//     this.discountAmount;

//   next();
// });

// // Method to add item to cart
// cartSchema.methods.addItem = function (
//   productId,
//   quantity,
//   variations,
//   productPrice,
//   options = {}
// ) {
//   const {
//     color,
//     size,
//     material,
//     giftWrapping = false,
//     installationService = false,
//     variationCombinationId = null,    // ADD THIS
//     variationSku = null,              // ADD THIS
//     variationsObject = {}             // ADD THIS
//   } = options;

//   console.log("Cart addItem - received options:", {
//     variationCombinationId,
//     variationSku,
//     variationsObject
//   });

//   // Create unique key to check for existing products with same attributes
//   const variationsKey = JSON.stringify(variations);
  
//   // UPDATED: Include variationCombinationId in the comparison for better matching
//   const existingItemIndex = this.items.findIndex(
//     (item) =>
//       item.product.toString() === productId.toString() &&
//       JSON.stringify(item.selectedVariations) === variationsKey &&
//       item.color === color &&
//       item.size === size &&
//       item.material === material &&
//       item.variationCombinationId === variationCombinationId // ADD THIS for exact matching
//   );

//   if (existingItemIndex > -1) {
//     // Product with same variations exists, update quantity
//     this.items[existingItemIndex].quantity += quantity;

//     // Update services if provided
//     if (giftWrapping !== undefined) {
//       this.items[existingItemIndex].giftWrapping = giftWrapping;
//     }

//     if (installationService !== undefined) {
//       this.items[existingItemIndex].installationService = installationService;
//     }

//     // Will be recalculated in pre-save hook
//     this.items[existingItemIndex].totalPrice =
//       this.items[existingItemIndex].price *
//       this.items[existingItemIndex].quantity;

//     console.log("Cart addItem - updated existing item quantity");
//   } else {
//     // Add new item with ALL the variation data
//     const newItem = {
//       product: productId,
//       quantity: quantity,
//       selectedVariations: variations || [],
//       variationCombinationId: variationCombinationId,  // ADD THIS
//       variationSku: variationSku,                      // ADD THIS
//       variationsObject: new Map(Object.entries(variationsObject)), // ADD THIS
//       color: color,
//       size: size,
//       material: material,
//       giftWrapping: giftWrapping,
//       installationService: installationService,
//       price: productPrice,
//       totalPrice: productPrice * quantity,
//     };

//     this.items.push(newItem);

//     console.log("Cart addItem - added new item:", {
//       productId,
//       variationCombinationId,
//       variationSku,
//       price: productPrice
//     });
//   }

//   return this;
// };

// // Method to remove item from cart
// cartSchema.methods.removeItem = function (itemId) {
//   this.items = this.items.filter(
//     (item) => item._id.toString() !== itemId.toString()
//   );
//   return this;
// };

// // Method to update item quantity
// cartSchema.methods.updateItemQuantity = function (itemId, quantity) {
//   const itemIndex = this.items.findIndex(
//     (item) => item._id.toString() === itemId.toString()
//   );

//   if (itemIndex > -1) {
//     this.items[itemIndex].quantity = quantity;
//     this.items[itemIndex].totalPrice = this.items[itemIndex].price * quantity;
//   }

//   return this;
// };

// // Method to clear the cart
// cartSchema.methods.clearCart = function () {
//   this.items = [];
//   this.subtotal = 0;
//   this.taxAmount = 0;
//   this.discountCode = null;
//   this.discountAmount = 0;
//   this.installationFee = 0;
//   this.assemblyFee = 0;
//   this.giftWrappingFee = 0;
//   this.deliveryDate = null;
//   this.deliveryTimeSlot = "all-day";
//   this.total = 0;

//   return this;
// };

// // Method to set shipping and delivery details
// cartSchema.methods.setDeliveryDetails = function (
//   shippingMethod,
//   deliveryDate,
//   timeSlot
// ) {
//   if (shippingMethod) {
//     this.shippingMethod = shippingMethod;

//     // Set standard shipping costs based on method for home decor
//     switch (shippingMethod) {
//       case "standard":
//         this.shippingCost = 9.99;
//         break;
//       case "express":
//         this.shippingCost = 19.99;
//         break;
//       case "bulky":
//         this.shippingCost = 29.99;
//         break;
//       case "white-glove":
//         this.shippingCost = 49.99;
//         break;
//       case "free":
//         this.shippingCost = 0;
//         break;
//       default:
//         this.shippingCost = 9.99;
//     }
//   }

//   if (deliveryDate) {
//     this.deliveryDate = deliveryDate;
//   }

//   if (timeSlot) {
//     this.deliveryTimeSlot = timeSlot;
//   }

//   return this;
// };

// // Method to add additional services
// cartSchema.methods.addServices = function (options) {
//   const {
//     installation = false,
//     assembly = false,
//     giftWrapping = false,
//   } = options;

//   // Reset all fees first
//   this.installationFee = 0;
//   this.assemblyFee = 0;
//   this.giftWrappingFee = 0;

//   // Add installation service if requested
//   if (installation) {
//     // For home decor, calculate based on cart value
//     this.installationFee = Math.max(39.99, this.subtotal * 0.1); // $39.99 minimum or 10% of subtotal
//   }

//   // Add assembly service if requested
//   if (assembly) {
//     // For home decor, calculate based on number of items
//     this.assemblyFee = this.items.length * 15; // $15 per item
//   }

//   // Add gift wrapping service if requested
//   if (giftWrapping) {
//     // Per item gift wrapping fee
//     const itemsToWrap = this.items.filter((item) => item.giftWrapping).length;
//     this.giftWrappingFee = itemsToWrap * 5; // $5 per wrapped item
//   }

//   return this;
// };

// // UPDATED: Method to merge guest cart with user cart - now handles variation data
// cartSchema.statics.mergeGuestCart = async function (guestCartId, userId) {
//   const guestCart = await this.findOne({ sessionId: guestCartId });
//   let userCart = await this.findOne({ user: userId });

//   if (!guestCart) return userCart;

//   if (!userCart) {
//     // If user doesn't have a cart, convert guest cart to user cart
//     guestCart.user = userId;
//     guestCart.sessionId = undefined;
//     return await guestCart.save();
//   }

//   // Merge guest cart items into user cart - UPDATED to include variation data
//   guestCart.items.forEach((item) => {
//     userCart.addItem(
//       item.product,
//       item.quantity,
//       item.selectedVariations,
//       item.price,
//       {
//         color: item.color,
//         size: item.size,
//         material: item.material,
//         giftWrapping: item.giftWrapping,
//         installationService: item.installationService,
//         variationCombinationId: item.variationCombinationId,  // ADD THIS
//         variationSku: item.variationSku,                      // ADD THIS
//         variationsObject: item.variationsObject ? item.variationsObject.toObject() : {} // ADD THIS
//       }
//     );
//   });

//   await userCart.save();
//   await guestCart.remove();

//   return userCart;
// };

// const Cart = mongoose.model("Cart", cartSchema);

// export default Cart;



import mongoose from "mongoose";

const cartItemSchema = mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    default: 1,
    min: [1, "Quantity can not be less than 1"],
  },
  selectedVariations: [
    {
      name: String,
      value: String,
      priceModifier: Number,
    },
  ],
  // Variation tracking fields
  variationCombinationId: {
    type: String,
    default: null,
  },
  variationSku: {
    type: String,
    default: null,
  },
  variationsObject: {
    type: Map,
    of: String,
    default: new Map(),
  },
  variationImages: [
    {
      id: String,
      src: String,
      alt: String,
      isFeatured: Boolean,
      order: Number,
    },
  ],
  // Home decor specific
  color: {
    type: String,
  },
  size: {
    type: String,
  },
  material: {
    type: String,
  },
  price: {
    type: Number,
    required: true,
  },
  totalPrice: {
    type: Number,
    required: true,
  },
  // For home decor common addons
  giftWrapping: {
    type: Boolean,
    default: false,
  },
  installationService: {
    type: Boolean,
    default: false,
  },
  // Tax code for Stripe Tax (optional, defaults to general product)
  taxCode: {
    type: String,
    default: 'txcd_99999999', // General product tax code
  },
  // Agent code for MLM/commission tracking (optional, per item)
  agentCode: {
    type: String,
    default: null,
  },
});

const cartSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    sessionId: {
      type: String,
      required: function () {
        return !this.user;
      },
    },
    items: [cartItemSchema],
    subtotal: {
      type: Number,
      default: 0,
    },
    
    // STRIPE TAX FIELDS (replacing manual tax calculation)
    stripeTaxCalculationId: {
      type: String,
      default: null,
    },
    stripeTaxData: {
      totalTax: { type: Number, default: 0 },
      taxBreakdown: [{
        productId: String,
        taxAmount: Number,
        taxRate: Number,
        jurisdiction: String,
      }],
      calculatedAt: { type: Date, default: null },
      isValid: { type: Boolean, default: false },
    },
    
    // Temporary shipping address for tax calculation
    tempShippingAddress: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: { type: String, default: 'US' },
    },
    
    // Shipping details
    shippingMethod: {
      type: String,
      enum: ["standard", "express", "bulky", "white-glove", "free", "none"],
      default: "standard",
    },
    shippingCost: {
      type: Number,
      default: 0,
    },
    
    // Home decor specific shipping options
    deliveryDate: {
      type: Date,
    },
    deliveryTimeSlot: {
      type: String,
      enum: ["morning", "afternoon", "evening", "all-day"],
      default: "all-day",
    },
    
    // Special services for home decor
    installationFee: {
      type: Number,
      default: 0,
    },
    assemblyFee: {
      type: Number,
      default: 0,
    },
    giftWrappingFee: {
      type: Number,
      default: 0,
    },
    
    // Discount
    discountCode: {
      type: String,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    
    // Totals
    total: {
      type: Number,
      default: 0,
    },
    
    // Status
    active: {
      type: Boolean,
      default: true,
    },
    
    // Tax calculation metadata
    needsTaxRecalculation: {
      type: Boolean,
      default: true,
    },
    lastTaxCalculationAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save middleware to calculate totals (WITHOUT automatic tax calculation)
cartSchema.pre("save", function (next) {
  // Calculate item total prices
  let subtotal = 0;

  this.items.forEach((item) => {
    // Calculate base price
    let itemPrice = item.price;

    // Add installation fee if selected
    if (item.installationService) {
      // Installation fee could be a percentage of item price for home decor
      itemPrice += item.price * 0.1; // 10% installation fee example
    }

    // Add gift wrapping fee if selected
    if (item.giftWrapping) {
      itemPrice += 5; // Fixed $5 gift wrapping fee example
    }

    item.totalPrice = itemPrice * item.quantity;
    subtotal += item.totalPrice;
  });

  this.subtotal = subtotal;

  // Calculate total with Stripe tax (if available) and other fees
  const taxAmount = this.stripeTaxData?.totalTax || 0;
  
  this.total =
    this.subtotal +
    taxAmount +
    this.shippingCost +
    this.installationFee +
    this.assemblyFee +
    this.giftWrappingFee -
    this.discountAmount;

  // Mark that tax recalculation might be needed if items changed
  if (this.isModified('items') || this.isModified('tempShippingAddress')) {
    this.needsTaxRecalculation = true;
  }

  next();
});

// Method to add item to cart
cartSchema.methods.addItem = function (
  productId,
  quantity,
  variations,
  productPrice,
  options = {}
) {
  const {
    color,
    size,
    material,
    giftWrapping = false,
    installationService = false,
    variationCombinationId = null,
    variationSku = null,
    variationsObject = {},
    variationImages = [],
    taxCode = 'txcd_99999999', // Default tax code
    agentCode = null, // Agent code per item
  } = options;

  console.log("Cart addItem - received options:", {
    variationCombinationId,
    variationSku,
    variationsObject
  });

  // Create unique key to check for existing products with same attributes
  const variationsKey = JSON.stringify(variations);
  
  // Include variationCombinationId in the comparison for better matching
  const existingItemIndex = this.items.findIndex(
    (item) =>
      item.product.toString() === productId.toString() &&
      JSON.stringify(item.selectedVariations) === variationsKey &&
      item.color === color &&
      item.size === size &&
      item.material === material &&
      item.variationCombinationId === variationCombinationId
  );

  if (existingItemIndex > -1) {
    // Product with same variations exists, update quantity
    this.items[existingItemIndex].quantity += quantity;

    // Update services if provided
    if (giftWrapping !== undefined) {
      this.items[existingItemIndex].giftWrapping = giftWrapping;
    }

    if (installationService !== undefined) {
      this.items[existingItemIndex].installationService = installationService;
    }

    // Will be recalculated in pre-save hook
    this.items[existingItemIndex].totalPrice =
      this.items[existingItemIndex].price *
      this.items[existingItemIndex].quantity;

    console.log("Cart addItem - updated existing item quantity");
  } else {
    // Add new item with ALL the variation data
    const newItem = {
      product: productId,
      quantity: quantity,
      selectedVariations: variations || [],
      variationCombinationId: variationCombinationId,
      variationSku: variationSku,
      variationsObject: new Map(Object.entries(variationsObject)),
      variationImages: (variationImages || []).map((img) => ({
        id: img.id || undefined,
        src: img.src || img.url || null,
        alt: img.alt || '',
        isFeatured: img.isFeatured ?? false,
        order: typeof img.order === 'number' ? img.order : 0,
      })),
      color: color,
      size: size,
      material: material,
      giftWrapping: giftWrapping,
      installationService: installationService,
      price: productPrice,
      totalPrice: productPrice * quantity,
      taxCode: taxCode, // Add tax code for Stripe Tax
      agentCode: agentCode, // Add agent code per item
    };

    this.items.push(newItem);

    console.log("Cart addItem - added new item:", {
      productId,
      variationCombinationId,
      variationSku,
      price: productPrice,
      taxCode
    });
  }

  // Mark that tax needs recalculation
  this.needsTaxRecalculation = true;
  this.stripeTaxData.isValid = false;

  return this;
};

// Method to remove item from cart
cartSchema.methods.removeItem = function (itemId) {
  this.items = this.items.filter(
    (item) => item._id.toString() !== itemId.toString()
  );
  
  // Mark that tax needs recalculation
  this.needsTaxRecalculation = true;
  this.stripeTaxData.isValid = false;
  
  return this;
};

// Method to update item quantity
cartSchema.methods.updateItemQuantity = function (itemId, quantity) {
  const itemIndex = this.items.findIndex(
    (item) => item._id.toString() === itemId.toString()
  );

  if (itemIndex > -1) {
    this.items[itemIndex].quantity = quantity;
    this.items[itemIndex].totalPrice = this.items[itemIndex].price * quantity;
    
    // Mark that tax needs recalculation
    this.needsTaxRecalculation = true;
    this.stripeTaxData.isValid = false;
  }

  return this;
};

// Method to clear the cart
cartSchema.methods.clearCart = function () {
  this.items = [];
  this.subtotal = 0;
  this.stripeTaxData = {
    totalTax: 0,
    taxBreakdown: [],
    calculatedAt: null,
    isValid: false,
  };
  this.stripeTaxCalculationId = null;
  this.discountCode = null;
  this.discountAmount = 0;
  this.installationFee = 0;
  this.assemblyFee = 0;
  this.giftWrappingFee = 0;
  this.deliveryDate = null;
  this.deliveryTimeSlot = "all-day";
  this.total = 0;
  this.needsTaxRecalculation = false;

  return this;
};

// Method to set shipping and delivery details
cartSchema.methods.setDeliveryDetails = function (
  shippingMethod,
  deliveryDate,
  timeSlot
) {
  if (shippingMethod) {
    this.shippingMethod = shippingMethod;

    // Set standard shipping costs based on method for home decor
    switch (shippingMethod) {
      case "standard":
        this.shippingCost = 9.99;
        break;
      case "express":
        this.shippingCost = 19.99;
        break;
      case "bulky":
        this.shippingCost = 29.99;
        break;
      case "white-glove":
        this.shippingCost = 49.99;
        break;
      case "free":
        this.shippingCost = 0;
        break;
      default:
        this.shippingCost = 9.99;
    }
  }

  if (deliveryDate) {
    this.deliveryDate = deliveryDate;
  }

  if (timeSlot) {
    this.deliveryTimeSlot = timeSlot;
  }

  return this;
};

// Method to set shipping address for tax calculation
cartSchema.methods.setShippingAddress = function (address) {
  this.tempShippingAddress = {
    street: address.street,
    city: address.city,
    state: address.state,
    zipCode: address.zipCode,
    country: address.country || 'US',
  };
  
  // Mark that tax needs recalculation when address changes
  this.needsTaxRecalculation = true;
  this.stripeTaxData.isValid = false;
  
  return this;
};

// Method to update Stripe tax data
cartSchema.methods.updateStripeTaxData = function (taxResult) {
  this.stripeTaxCalculationId = taxResult.calculationId;
  this.stripeTaxData = {
    totalTax: taxResult.totalTax,
    taxBreakdown: taxResult.taxBreakdown,
    calculatedAt: new Date(),
    isValid: true,
  };
  this.needsTaxRecalculation = false;
  this.lastTaxCalculationAt = new Date();
  
  return this;
};

// Method to check if tax calculation is needed
cartSchema.methods.needsTaxCalculation = function () {
  return (
    this.needsTaxRecalculation || 
    !this.stripeTaxData.isValid || 
    !this.tempShippingAddress.zipCode ||
    this.items.length === 0
  );
};

// Method to add additional services
cartSchema.methods.addServices = function (options) {
  const {
    installation = false,
    assembly = false,
    giftWrapping = false,
  } = options;

  // Reset all fees first
  this.installationFee = 0;
  this.assemblyFee = 0;
  this.giftWrappingFee = 0;

  // Add installation service if requested
  if (installation) {
    // For home decor, calculate based on cart value
    this.installationFee = Math.max(39.99, this.subtotal * 0.1); // $39.99 minimum or 10% of subtotal
  }

  // Add assembly service if requested
  if (assembly) {
    // For home decor, calculate based on number of items
    this.assemblyFee = this.items.length * 15; // $15 per item
  }

  // Add gift wrapping service if requested
  if (giftWrapping) {
    // Per item gift wrapping fee
    const itemsToWrap = this.items.filter((item) => item.giftWrapping).length;
    this.giftWrappingFee = itemsToWrap * 5; // $5 per wrapped item
  }

  return this;
};

// UPDATED: Method to merge guest cart with user cart - now handles variation data
cartSchema.statics.mergeGuestCart = async function (guestCartId, userId) {
  const guestCart = await this.findOne({ sessionId: guestCartId });
  let userCart = await this.findOne({ user: userId });

  if (!guestCart) return userCart;

  if (!userCart) {
    // If user doesn't have a cart, convert guest cart to user cart
    guestCart.user = userId;
    guestCart.sessionId = undefined;
    return await guestCart.save();
  }

  // Merge guest cart items into user cart - UPDATED to include variation data
  guestCart.items.forEach((item) => {
    userCart.addItem(
      item.product,
      item.quantity,
      item.selectedVariations,
      item.price,
      {
        color: item.color,
        size: item.size,
        material: item.material,
        giftWrapping: item.giftWrapping,
        installationService: item.installationService,
        variationCombinationId: item.variationCombinationId,
        variationSku: item.variationSku,
        variationsObject: item.variationsObject ? item.variationsObject.toObject() : {},
        variationImages: item.variationImages || [],
        taxCode: item.taxCode,
        agentCode: item.agentCode, // Preserve agent code per item
      }
    );
  });

  // Agent codes are stored per item, so no need to merge at cart level

  await userCart.save();
  await guestCart.remove();

  return userCart;
};

const Cart = mongoose.model("Cart", cartSchema);

export default Cart;