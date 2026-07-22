

// import mongoose from "mongoose";

// const orderItemSchema = mongoose.Schema({
//   product: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: "Product",
//     required: true,
//   },
//   name: {
//     type: String,
//     required: true,
//   },
//   quantity: {
//     type: Number,
//     required: true,
//     min: [1, "Quantity can not be less than 1"],
//   },
//   image: String,
//   price: {
//     type: Number,
//     required: true,
//   },
//   selectedVariations: [
//     {
//       name: String,
//       value: String,
//       priceModifier: Number,
//     },
//   ],
//   // Variation tracking fields
//   variationCombinationId: {
//     type: String,
//     default: null,
//   },
//   variationSku: {
//     type: String,
//     default: null,
//   },
  
//   // Home decor specific
//   color: String,
//   size: String,
//   material: String,
  
//   // Additional services
//   installationService: {
//     type: Boolean,
//     default: false,
//   },
//   giftWrapping: {
//     type: Boolean,
//     default: false,
//   },
  
//   // NEW: Stripe Tax fields for order items
//   taxCode: {
//     type: String,
//     default: 'txcd_99999999', // General product tax code
//   },
//   itemTaxAmount: {
//     type: Number,
//     default: 0,
//   },
//   itemTaxRate: {
//     type: Number,
//     default: 0,
//   },
//   taxJurisdiction: {
//     type: String,
//     default: '',
//   },
// });

// const shippingAddressSchema = mongoose.Schema({
//   fullName: {
//     type: String,
//     required: true,
//   },
//   street: {
//     type: String,
//     required: true,
//   },
//   city: {
//     type: String,
//     required: true,
//   },
//   state: {
//     type: String,
//     required: true,
//   },
//   zipCode: {
//     type: String,
//     required: true,
//   },
//   country: {
//     type: String,
//     required: true,
//   },
//   phoneNumber: {
//     type: String,
//     required: true,
//   },
//   deliveryInstructions: String,
// });

// const paymentResultSchema = mongoose.Schema({
//   paymentId: String,
//   status: String,
//   updateTime: String,
//   email: String,
//   paymentMethod: {
//     type: String,
//     required: true,
//   },
//   transactionFee: Number,
// });

// // NEW: Stripe Tax data schema
// const stripeTaxDataSchema = mongoose.Schema({
//   calculationId: {
//     type: String,
//     required: true,
//   },
//   transactionId: {
//     type: String,
//     default: null, // Set after payment completion
//   },
//   totalTaxAmount: {
//     type: Number,
//     required: true,
//     default: 0,
//   },
//   taxBreakdown: [{
//     productId: String,
//     itemName: String,
//     taxAmount: Number,
//     taxRate: Number,
//     jurisdiction: String,
//     taxType: String, // e.g., 'sales_tax', 'vat'
//   }],
//   jurisdiction: {
//     type: String,
//     default: '',
//   },
//   taxCalculatedAt: {
//     type: Date,
//     default: Date.now,
//   },
//   isValid: {
//     type: Boolean,
//     default: true,
//   },
// });

// const orderSchema = mongoose.Schema(
//   {
//     user: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       required: true,
//     },
//     orderItems: [orderItemSchema],
//     shippingAddress: shippingAddressSchema,
//     billingAddress: shippingAddressSchema,
//     paymentMethod: {
//       type: String,
//       required: true,
//     },
    
//     paymentResult: paymentResultSchema,
    
//     // Order totals
//     subtotal: {
//       type: Number,
//       required: true,
//       default: 0.0,
//     },
    
//     // UPDATED: Replace manual tax with Stripe Tax
//     stripeTaxData: stripeTaxDataSchema,
    
//     // Shipping details
//     shippingMethod: {
//       type: String,
//       enum: ["standard", "express", "bulky", "white-glove", "free", "none"],
//       default: "standard",
//     },
//     shippingCost: {
//       type: Number,
//       required: true,
//       default: 0.0,
//     },
    
//     // Home decor specific shipping options
//     deliveryDate: Date,
//     deliveryTimeSlot: {
//       type: String,
//       enum: ["morning", "afternoon", "evening", "all-day"],
//       default: "all-day",
//     },
    
//     // Special services
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
    
//     // Discount
//     discountCode: String,
//     discountAmount: {
//       type: Number,
//       default: 0,
//     },
    
//     // Total price (includes tax calculated by Stripe)
//     totalPrice: {
//       type: Number,
//       required: true,
//       default: 0.0,
//     },
    
//     // Order status
//     orderStatus: {
//       type: String,
//       enum: [
//         "pending",
//         "processing",
//         "shipped",
//         "delivered",
//         "cancelled",
//         "refunded",
//         "on-hold",
//         "returned",
//         "partially-shipped",
//         "scheduled-delivery",
//       ],
//       default: "pending",
//     },
    
//     // Payment status
//     paymentStatus: {
//       type: String,
//       enum: [
//         "pending",
//         "completed",
//         "failed",
//         "refunded",
//         "partially-refunded",
//         "refund-pending",
//       ],
//       default: "pending",
//     },
    
//     isPaid: {
//       type: Boolean,
//       default: false,
//     },
//     paidAt: Date,
    
//     isDelivered: {
//       type: Boolean,
//       default: false,
//     },
//     deliveredAt: Date,
    
//     // Tracking information
//     trackingNumber: String,
//     trackingCompany: String,
//     estimatedDeliveryDate: Date,
    
//     // Notes
//     customerNotes: String,
//     adminNotes: String,
    
//     // Return/Refund
//     returnRequested: {
//       type: Boolean,
//       default: false,
//     },
//     returnStatus: {
//       type: String,
//       enum: [
//         "none",
//         "requested",
//         "approved",
//         "received",
//         "refunded",
//         "rejected",
//       ],
//       default: "none",
//     },
//     returnReason: String,
//     refundAmount: {
//       type: Number,
//       default: 0,
//     },
//     refundedAt: Date,
    
//     // Invoice
//     invoiceNumber: String,
//     invoiceGenerated: {
//       type: Boolean,
//       default: false,
//     },
//     invoiceUrl: String,
    
//     // Stock management tracking
//     stockUpdatedByWebhook: {
//       type: Boolean,
//       default: false,
//     },
//     stockUpdatedByManual: {
//       type: Boolean,
//       default: false,
//     },
//     stockUpdatedAt: {
//       type: Date,
//       default: null,
//     },
    
//     // NEW: Tax compliance tracking
//     taxCompliance: {
//       reportingRequired: {
//         type: Boolean,
//         default: false,
//       },
//       reportedToAuthorities: {
//         type: Boolean,
//         default: false,
//       },
//       reportedAt: Date,
//       complianceNotes: String,
//     },
//   },
//   {
//     timestamps: true,
//   }
// );

// // Generate order number
// orderSchema.pre("save", async function (next) {
//   if (this.isNew) {
//     const date = new Date();
//     const year = date.getFullYear().toString().substr(-2);
//     const month = (date.getMonth() + 1).toString().padStart(2, "0");
//     const day = date.getDate().toString().padStart(2, "0");

//     // Find the highest order number for today
//     const lastOrder = await this.constructor
//       .findOne({
//         createdAt: {
//           $gte: new Date(date.setHours(0, 0, 0, 0)),
//           $lt: new Date(date.setHours(23, 59, 59, 999)),
//         },
//       })
//       .sort({ createdAt: -1 });

//     let sequence = 1;
//     if (lastOrder && lastOrder.invoiceNumber) {
//       const lastSequence = parseInt(lastOrder.invoiceNumber.slice(-4));
//       if (!isNaN(lastSequence)) {
//         sequence = lastSequence + 1;
//       }
//     }

//     this.invoiceNumber = `HD${year}${month}${day}${sequence
//       .toString()
//       .padStart(4, "0")}`;
//   }
//   next();
// });

// // Virtual for time since order
// orderSchema.virtual("orderAge").get(function () {
//   return Math.round((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
// });

// // Virtual for whether order can be cancelled
// orderSchema.virtual("canBeCancelled").get(function () {
//   const nonCancellableStatuses = [
//     "shipped",
//     "delivered",
//     "returned",
//     "refunded",
//   ];
//   return !nonCancellableStatuses.includes(this.orderStatus);
// });

// // Virtual for total items count
// orderSchema.virtual("itemCount").get(function () {
//   return this.orderItems.reduce((total, item) => total + item.quantity, 0);
// });

// // NEW: Virtual for total tax amount (from Stripe Tax data)
// orderSchema.virtual("totalTaxAmount").get(function () {
//   return this.stripeTaxData?.totalTaxAmount || 0;
// });

// // NEW: Virtual for tax rate percentage
// orderSchema.virtual("effectiveTaxRate").get(function () {
//   if (!this.stripeTaxData?.totalTaxAmount || this.subtotal === 0) {
//     return 0;
//   }
//   return ((this.stripeTaxData.totalTaxAmount / this.subtotal) * 100).toFixed(2);
// });

// // Method to check if stock has been updated
// orderSchema.methods.hasStockBeenUpdated = function() {
//   return this.stockUpdatedByWebhook || this.stockUpdatedByManual;
// };

// // Method to mark stock as updated
// orderSchema.methods.markStockUpdated = function(source = 'manual') {
//   if (source === 'webhook') {
//     this.stockUpdatedByWebhook = true;
//   } else {
//     this.stockUpdatedByManual = true;
//   }
//   this.stockUpdatedAt = new Date();
// };

// // NEW: Method to update Stripe tax data
// orderSchema.methods.updateStripeTaxData = function(taxCalculationId, taxData) {
//   this.stripeTaxData = {
//     calculationId: taxCalculationId,
//     totalTaxAmount: taxData.totalTax,
//     taxBreakdown: taxData.taxBreakdown.map(item => ({
//       productId: item.productId,
//       itemName: item.itemName || '',
//       taxAmount: item.taxAmount,
//       taxRate: item.taxRate,
//       jurisdiction: item.jurisdiction,
//       taxType: 'sales_tax', // Default for US
//     })),
//     jurisdiction: taxData.taxBreakdown[0]?.jurisdiction || '',
//     taxCalculatedAt: new Date(),
//     isValid: true,
//   };
// };

// // NEW: Method to set tax transaction ID (after payment)
// orderSchema.methods.setTaxTransactionId = function(transactionId) {
//   if (this.stripeTaxData) {
//     this.stripeTaxData.transactionId = transactionId;
//   }
// };

// // NEW: Method to check if tax reporting is required
// orderSchema.methods.requiresTaxReporting = function() {
//   // For orders over $500 or with certain tax jurisdictions
//   const reportingThreshold = 500;
//   const reportingJurisdictions = ['CA', 'NY', 'TX']; // Example states
  
//   return (
//     this.totalPrice >= reportingThreshold ||
//     reportingJurisdictions.includes(this.shippingAddress?.state)
//   );
// };

// // NEW: Method to mark as reported for tax compliance
// orderSchema.methods.markTaxReported = function(notes = '') {
//   this.taxCompliance.reportingRequired = this.requiresTaxReporting();
//   this.taxCompliance.reportedToAuthorities = true;
//   this.taxCompliance.reportedAt = new Date();
//   this.taxCompliance.complianceNotes = notes;
// };

// // Enable virtuals in JSON
// orderSchema.set("toJSON", { virtuals: true });
// orderSchema.set("toObject", { virtuals: true });

// const Order = mongoose.model("Order", orderSchema);

// export default Order;


// models/orderModel.js
import mongoose from "mongoose";

const orderItemSchema = mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, "Quantity can not be less than 1"],
  },
  image: String,
  price: {
    type: Number,
    required: true,
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
  
  // Home decor specific
  color: String,
  size: String,
  material: String,
  
  // Additional services
  installationService: {
    type: Boolean,
    default: false,
  },
  giftWrapping: {
    type: Boolean,
    default: false,
  },
  
  // Stripe Tax fields for order items
  taxCode: {
    type: String,
    default: 'txcd_99999999', // General product tax code
  },
  itemTaxAmount: {
    type: Number,
    default: 0,
  },
  itemTaxRate: {
    type: Number,
    default: 0,
  },
  taxJurisdiction: {
    type: String,
    default: '',
  },
  // Agent code for MLM/commission tracking (optional, per item)
  agentCode: {
    type: String,
    default: null,
  },
});

const shippingAddressSchema = mongoose.Schema({
  fullName: {
    type: String,
    required: true,
  },
  street: {
    type: String,
    required: true,
  },
  city: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
  },
  zipCode: {
    type: String,
    required: true,
  },
  country: {
    type: String,
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
  },
  deliveryInstructions: String,
});

const paymentResultSchema = mongoose.Schema({
  paymentId: String,
  status: String,
  updateTime: String,
  email: String,
  paymentMethod: {
    type: String,
    required: true,
  },
  transactionFee: Number,
});

// Stripe Tax data schema
const stripeTaxDataSchema = mongoose.Schema({
  calculationId: {
    type: String,
    required: true,
  },
  transactionId: {
    type: String,
    default: null, // Set after payment completion
  },
  totalTaxAmount: {
    type: Number,
    required: true,
    default: 0,
  },
  taxBreakdown: [{
    productId: String,
    itemName: String,
    taxAmount: Number,
    taxRate: Number,
    jurisdiction: String,
    taxType: String, // e.g., 'sales_tax', 'vat'
  }],
  jurisdiction: {
    type: String,
    default: '',
  },
  taxCalculatedAt: {
    type: Date,
    default: Date.now,
  },
  isValid: {
    type: Boolean,
    default: true,
  },
});

// ShipRocket data schema
const shipRocketDataSchema = mongoose.Schema({
  shipmentId: {
    type: String,
    default: null,
  },
  orderId: {
    type: String,
    default: null,
  },
  awbCode: {
    type: String,
    default: null,
  },
  courierName: {
    type: String,
    default: null,
  },
  courierId: {
    type: Number,
    default: null,
  },
  status: {
    type: String,
    enum: ['created', 'assigned', 'picked', 'shipped', 'delivered', 'cancelled', 'returned'],
    default: 'created',
  },
  pickupScheduled: {
    type: Boolean,
    default: false,
  },
  pickupDate: {
    type: Date,
    default: null,
  },
  labelGenerated: {
    type: Boolean,
    default: false,
  },
  labelUrl: String,
  manifestGenerated: {
    type: Boolean,
    default: false,
  },
  manifestUrl: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  cancelledAt: {
    type: Date,
    default: null,
  },
});

// Return shipment data schema
const returnShipmentDataSchema = mongoose.Schema({
  shipmentId: {
    type: String,
    default: null,
  },
  orderId: {
    type: String,
    default: null,
  },
  awbCode: {
    type: String,
    default: null,
  },
  courierName: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ['created', 'assigned', 'picked', 'shipped', 'delivered', 'cancelled'],
    default: 'created',
  },
  reason: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const orderSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    orderItems: [orderItemSchema],
    shippingAddress: shippingAddressSchema,
    billingAddress: shippingAddressSchema,
    paymentMethod: {
      type: String,
      required: true,
    },
    
    paymentResult: paymentResultSchema,
    
    // Order totals
    subtotal: {
      type: Number,
      required: true,
      default: 0.0,
    },
    
    // Stripe Tax data
    stripeTaxData: stripeTaxDataSchema,
    
    // Shipping details
    shippingMethod: {
      type: String,
      enum: ["standard", "express", "bulky", "white-glove", "free", "none"],
      default: "standard",
    },
    shippingCost: {
      type: Number,
      required: true,
      default: 0.0,
    },
    
    // Home decor specific shipping options
    deliveryDate: Date,
    deliveryTimeSlot: {
      type: String,
      enum: ["morning", "afternoon", "evening", "all-day"],
      default: "all-day",
    },
    
    // Special services
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
    discountCode: String,
    discountAmount: {
      type: Number,
      default: 0,
    },
    
    // Agent code (optional - for MLM/commission tracking)
    agentCode: {
      type: String,
      trim: true,
      default: null,
    },
    
    // Total price (includes tax calculated by Stripe)
    totalPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    
    // Order status
    orderStatus: {
      type: String,
      enum: [
        "pending",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
        "on-hold",
        "returned",
        "partially-shipped",
        "scheduled-delivery",
      ],
      default: "pending",
    },
    
    // Payment status
    paymentStatus: {
      type: String,
      enum: [
        "pending",
        "completed",
        "failed",
        "refunded",
        "partially-refunded",
        "refund-pending",
      ],
      default: "pending",
    },
    
    isPaid: {
      type: Boolean,
      default: false,
    },
    paidAt: Date,
    
    isDelivered: {
      type: Boolean,
      default: false,
    },
    deliveredAt: Date,
    
    // Tracking information
    trackingNumber: String,
    trackingCompany: String,
    estimatedDeliveryDate: Date,
    
    // Enhanced tracking fields (ShipRocket specific)
    trackingUrl: String,
    estimatedDeliveryTime: String,
    courierInstructions: String,
    
    // Shipping preferences
    preferredCourier: String,
    deliveryPreferences: {
      timeSlot: {
        type: String,
        enum: ['morning', 'afternoon', 'evening', 'anytime'],
        default: 'anytime',
      },
      contactBeforeDelivery: {
        type: Boolean,
        default: false,
      },
      leaveAtDoor: {
        type: Boolean,
        default: false,
      },
    },
    
    // Notes
    customerNotes: String,
    adminNotes: String,
    
    // Return/Refund
    returnRequested: {
      type: Boolean,
      default: false,
    },
    returnStatus: {
      type: String,
      enum: [
        "none",
        "requested",
        "approved",
        "received",
        "refunded",
        "rejected",
      ],
      default: "none",
    },
    returnReason: String,
    refundAmount: {
      type: Number,
      default: 0,
    },
    refundedAt: Date,
    
    // Invoice
    invoiceNumber: String,
    invoiceGenerated: {
      type: Boolean,
      default: false,
    },
    invoiceUrl: String,
    
    // Stock management tracking
    stockUpdatedByWebhook: {
      type: Boolean,
      default: false,
    },
    stockUpdatedByManual: {
      type: Boolean,
      default: false,
    },
    stockUpdatedAt: {
      type: Date,
      default: null,
    },
    
    // Tax compliance tracking
    taxCompliance: {
      reportingRequired: {
        type: Boolean,
        default: false,
      },
      reportedToAuthorities: {
        type: Boolean,
        default: false,
      },
      reportedAt: Date,
      complianceNotes: String,
    },
    
    // ShipRocket integration data
    shipRocketData: shipRocketDataSchema,
    
    // Return shipment data
    returnShipmentData: returnShipmentDataSchema,
  },
  {
    timestamps: true,
  }
);

// Generate order number
orderSchema.pre("save", async function (next) {
  if (this.isNew) {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");

    // Find the highest order number for today
    const lastOrder = await this.constructor
      .findOne({
        createdAt: {
          $gte: new Date(date.setHours(0, 0, 0, 0)),
          $lt: new Date(date.setHours(23, 59, 59, 999)),
        },
      })
      .sort({ createdAt: -1 });

    let sequence = 1;
    if (lastOrder && lastOrder.invoiceNumber) {
      const lastSequence = parseInt(lastOrder.invoiceNumber.slice(-4));
      if (!isNaN(lastSequence)) {
        sequence = lastSequence + 1;
      }
    }

    this.invoiceNumber = `HD${year}${month}${day}${sequence
      .toString()
      .padStart(4, "0")}`;
  }
  next();
});

// Virtual for time since order
orderSchema.virtual("orderAge").get(function () {
  return Math.round((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
});

// Virtual for whether order can be cancelled
orderSchema.virtual("canBeCancelled").get(function () {
  const nonCancellableStatuses = [
    "shipped",
    "delivered",
    "returned",
    "refunded",
  ];
  return !nonCancellableStatuses.includes(this.orderStatus);
});

// Virtual for total items count
orderSchema.virtual("itemCount").get(function () {
  return this.orderItems.reduce((total, item) => total + item.quantity, 0);
});

// Virtual for total tax amount (from Stripe Tax data)
orderSchema.virtual("totalTaxAmount").get(function () {
  return this.stripeTaxData?.totalTaxAmount || 0;
});

// Virtual for tax rate percentage
orderSchema.virtual("effectiveTaxRate").get(function () {
  if (!this.stripeTaxData?.totalTaxAmount || this.subtotal === 0) {
    return 0;
  }
  return ((this.stripeTaxData.totalTaxAmount / this.subtotal) * 100).toFixed(2);
});

// Virtual for comprehensive tracking info
orderSchema.virtual('trackingInfo').get(function () {
  return {
    trackingNumber: this.trackingNumber,
    trackingCompany: this.trackingCompany,
    trackingUrl: this.getTrackingUrl(),
    shipmentStatus: this.shipRocketData?.status,
    estimatedDelivery: this.estimatedDeliveryDate,
    isDelivered: this.isDelivered,
    deliveredAt: this.deliveredAt,
  };
});

// Method to check if stock has been updated
orderSchema.methods.hasStockBeenUpdated = function() {
  return this.stockUpdatedByWebhook || this.stockUpdatedByManual;
};

// Method to mark stock as updated
orderSchema.methods.markStockUpdated = function(source = 'manual') {
  if (source === 'webhook') {
    this.stockUpdatedByWebhook = true;
  } else {
    this.stockUpdatedByManual = true;
  }
  this.stockUpdatedAt = new Date();
};

// Method to update Stripe tax data
orderSchema.methods.updateStripeTaxData = function(taxCalculationId, taxData) {
  this.stripeTaxData = {
    calculationId: taxCalculationId,
    totalTaxAmount: taxData.totalTax,
    taxBreakdown: taxData.taxBreakdown.map(item => ({
      productId: item.productId,
      itemName: item.itemName || '',
      taxAmount: item.taxAmount,
      taxRate: item.taxRate,
      jurisdiction: item.jurisdiction,
      taxType: 'sales_tax', // Default for US
    })),
    jurisdiction: taxData.taxBreakdown[0]?.jurisdiction || '',
    taxCalculatedAt: new Date(),
    isValid: true,
  };
};

// Method to set tax transaction ID (after payment)
orderSchema.methods.setTaxTransactionId = function(transactionId) {
  if (this.stripeTaxData) {
    this.stripeTaxData.transactionId = transactionId;
  }
};

// Method to check if tax reporting is required
orderSchema.methods.requiresTaxReporting = function() {
  // For orders over $500 or with certain tax jurisdictions
  const reportingThreshold = 500;
  const reportingJurisdictions = ['CA', 'NY', 'TX']; // Example states
  
  return (
    this.totalPrice >= reportingThreshold ||
    reportingJurisdictions.includes(this.shippingAddress?.state)
  );
};

// Method to mark as reported for tax compliance
orderSchema.methods.markTaxReported = function(notes = '') {
  this.taxCompliance.reportingRequired = this.requiresTaxReporting();
  this.taxCompliance.reportedToAuthorities = true;
  this.taxCompliance.reportedAt = new Date();
  this.taxCompliance.complianceNotes = notes;
};

// Method to check if shipment can be created
orderSchema.methods.canCreateShipment = function() {
  return this.isPaid && 
         this.orderStatus !== 'cancelled' && 
         this.orderStatus !== 'refunded' &&
         !this.shipRocketData?.shipmentId;
};

// Method to get tracking URL
orderSchema.methods.getTrackingUrl = function() {
  if (!this.trackingNumber) return null;
  
  // Customize based on courier
  if (this.trackingCompany?.toLowerCase().includes('delhivery')) {
    return `https://www.delhivery.com/track/package/${this.trackingNumber}`;
  } else if (this.trackingCompany?.toLowerCase().includes('bluedart')) {
    return `https://www.bluedart.com/tracking/${this.trackingNumber}`;
  } else if (this.trackingCompany?.toLowerCase().includes('dtdc')) {
    return `https://www.dtdc.in/tracking/${this.trackingNumber}`;
  } else {
    // Generic ShipRocket tracking
    return `https://shiprocket.co/tracking/${this.trackingNumber}`;
  }
};

// Method to update shipment status
orderSchema.methods.updateShipmentStatus = function(status, additionalData = {}) {
  if (this.shipRocketData) {
    this.shipRocketData.status = status;
    
    // Update order status based on shipment status
    switch (status) {
      case 'picked':
        this.orderStatus = 'processing';
        break;
      case 'shipped':
        this.orderStatus = 'shipped';
        break;
      case 'delivered':
        this.orderStatus = 'delivered';
        this.isDelivered = true;
        this.deliveredAt = new Date();
        break;
      case 'cancelled':
        this.orderStatus = 'cancelled';
        this.cancelledAt = new Date();
        break;
    }
    
    // Add any additional data
    Object.assign(this.shipRocketData, additionalData);
  }
};

// Enable virtuals in JSON
orderSchema.set("toJSON", { virtuals: true });
orderSchema.set("toObject", { virtuals: true });

const Order = mongoose.model("Order", orderSchema);

export default Order;