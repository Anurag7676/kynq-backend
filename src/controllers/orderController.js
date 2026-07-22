import Order from "../models/orderModel.js";
import Cart from "../models/cartModel.js";
import Product from "../models/productModel.js";
import User from "../models/userModel.js";
import PageContent from "../models/pageContentModel.js";
import { retrievePaymentIntent, validateTaxCalculation, createTaxTransaction, calculateTax } from "../utils/stripeUtils.js";
import shipRocketService, { convertOrderToShipRocketFormat } from "../utils/shipRocketUtils.js";
import {
  sendPaymentConfirmationEmail,
  sendOrderStatusUpdateEmail,
  sendNewOrderNotificationEmail,
  sendOrderCancellationEmail,
  sendOrderCancellationNotificationEmail,
  sendVendorOrderNotificationEmail // 🆕 NEW: Vendor notification email
} from "../config/emailConfig.js";
import syncOrderToEcommerce from "../utils/ecommerceOrderSync.js";

// Helper function to automatically create shipment after payment confirmation
const createShipmentAfterPayment = async (order, user) => {
  try {
    // Check if auto-shipment is enabled and order is eligible
    if (!process.env.SHIPROCKET_AUTO_CREATE || order.shippingMethod === 'none') {
      return { success: false, message: 'Auto-shipment not enabled or not applicable' };
    }

    if (!order.canCreateShipment()) {
      return { success: false, message: 'Order not eligible for shipment creation' };
    }

    console.log(`[AUTO-SHIPMENT] Creating shipment for order ${order._id}`);

    // Convert order to ShipRocket format
    const shipRocketOrderData = convertOrderToShipRocketFormat(order, user);
    
    console.log(`[AUTO-SHIPMENT] Order data converted to ShipRocket format:`, {
      orderId: shipRocketOrderData.order_id,
      itemsCount: shipRocketOrderData.order_items.length,
      totalAmount: shipRocketOrderData.sub_total,
      shippingAddress: shipRocketOrderData.shipping_city
    });

    // Create order in ShipRocket
    const createResult = await shipRocketService.createOrder(shipRocketOrderData);

    if (!createResult.success) {
      console.error(`[AUTO-SHIPMENT] Failed to create shipment for order ${order._id}:`, createResult.error);
      return createResult;
    }

    // Update order with shipping information
    order.shipRocketData = {
      shipmentId: createResult.shipmentId,
      orderId: createResult.orderId,
      status: 'created',
      createdAt: new Date(),
    };

    // Update order status to processing
    order.orderStatus = 'processing';

    await order.save();

    console.log(`[AUTO-SHIPMENT] Shipment created successfully for order ${order._id}:`, {
      shipmentId: createResult.shipmentId,
    });

    return {
      success: true,
      shipmentId: createResult.shipmentId,
      orderId: createResult.orderId,
    };

  } catch (error) {
    console.error(`[AUTO-SHIPMENT] Error creating shipment for order ${order._id}:`, error);
    return { success: false, error: error.message };
  }
};

// Helper function to find variation combination in PageContent
const findVariationCombination = (pageContent, selectedVariations) => {
  if (!pageContent || !pageContent.content || !pageContent.content.variationCombinations) {
    return null;
  }

  const combinations = pageContent.content.variationCombinations;
  
  return combinations.find(combo => {
    if (!(combo.isActive || combo.isEnabled)) return false;
    
    const combKeys = Object.keys(combo.combination);
    const selectedKeys = Object.keys(selectedVariations);
    
    // Check if all keys match
    if (combKeys.length !== selectedKeys.length) return false;
    
    // Check if all values match
    return combKeys.every(key => 
      combo.combination[key] === selectedVariations[key]
    );
  });
};

// Helper function to convert cart variations to object format
const convertVariationsToObject = (selectedVariations) => {
  if (!selectedVariations || selectedVariations.length === 0) {
    return {};
  }
  
  const result = {};
  selectedVariations.forEach(variation => {
    if (variation.name && variation.value) {
      result[variation.name] = variation.value;
    }
  });
  
  return result;
};

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const createOrder = async (req, res) => {
  try {
    const {
      cartId,
      shippingAddress,
      billingAddress,
      paymentMethod,
      customerNotes,
      // Note: agentCode is no longer accepted in request body
      // It should be set in cart when adding products
    } = req.body;

    console.log("[ORDER CREATE] Incoming request", {
      userId: req.user?._id,
      cartId,
      paymentMethod,
      shippingSummary: shippingAddress
        ? {
            state: shippingAddress.state,
            zipCode: shippingAddress.zipCode,
            country: shippingAddress.country,
          }
        : null,
    });

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User authentication required to create an order",
      });
    }

    if (!cartId || !shippingAddress || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    // Get the cart
    const cart = await Cart.findById(cartId).populate({
      path: "items.product",
      select: "name images stock price",
    });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    // Check if cart belongs to user
    if (cart.user && !cart.user.equals(req.user._id)) {
      return res.status(401).json({
        success: false,
        message: "Not authorized to use this cart",
      });
    }

    // Validate agent codes from cart items (if present)
    // Agent codes are stored per cart item, so we need to validate all of them
    const Agent = (await import("../models/agentModel.js")).default;
    const uniqueAgentCodes = [...new Set(
      cart.items
        .map(item => item.agentCode)
        .filter(code => code != null && code.trim() !== '')
    )];
    
    // Validate all unique agent codes
    const validatedAgentCodes = {};
    for (const agentCode of uniqueAgentCodes) {
      const agent = await Agent.findOne({ agentCode: agentCode.trim() });
      
      if (!agent) {
        return res.status(400).json({
          success: false,
          message: `Invalid agent code in cart: ${agentCode}. Agent not found in the system.`,
        });
      }
      
      validatedAgentCodes[agentCode] = agent.agentCode;
      console.log("[ORDER CREATE] Agent code validated:", {
        agentCode: agent.agentCode,
        agentName: agent.displayName || `${agent.firstName} ${agent.lastName}`,
      });
    }
    
    // Use the first agent code found for order-level agentCode (for backward compatibility)
    // Individual items will have their own agent codes
    const firstAgentCode = uniqueAgentCodes.length > 0 ? validatedAgentCodes[uniqueAgentCodes[0]] : null;

    // Validate Stripe Tax calculation from cart
    if (!cart.stripeTaxCalculationId || !cart.stripeTaxData?.isValid) {
      console.warn("[ORDER CREATE] Missing valid tax calculation", {
        cartId: cart._id,
        stripeTaxCalculationId: cart.stripeTaxCalculationId,
        hasTaxData: !!cart.stripeTaxData,
      });
      return res.status(400).json({
        success: false,
        message: "Tax calculation required. Please calculate tax for your cart before creating an order.",
      });
    }

    // Validate that shipping address matches tax calculation
    if (!cart.tempShippingAddress || !cart.tempShippingAddress.zipCode) {
      return res.status(400).json({
        success: false,
        message: "Shipping address required for tax calculation. Please update your cart with shipping address.",
      });
    }

    // Verify tax calculation is still valid (not expired)
    try {
      console.log("[ORDER CREATE] Validating tax calculation:", {
        cartId: cart._id,
        taxCalculationId: cart.stripeTaxCalculationId,
      });
      
      const taxValidation = await validateTaxCalculation(cart.stripeTaxCalculationId);
      
      console.log("[ORDER CREATE] Tax validation result:", {
        success: taxValidation.success,
        isValid: taxValidation.isValid,
        status: taxValidation.status,
        error: taxValidation.error,
        errorType: taxValidation.errorType,
        errorCode: taxValidation.errorCode,
      });
      
      if (!taxValidation.success || !taxValidation.isValid) {
        console.error("[ORDER CREATE] Tax validation failed", {
          cartId: cart._id,
          taxCalculationId: cart.stripeTaxCalculationId,
          success: taxValidation.success,
          isValid: taxValidation.isValid,
          error: taxValidation.error,
          errorType: taxValidation.errorType,
          errorCode: taxValidation.errorCode,
          stripeStatus: taxValidation.calculation?.status,
          rawError: taxValidation.rawError,
        });
        return res.status(400).json({
          success: false,
          message: "Tax calculation expired or invalid. Please recalculate tax for your cart.",
          error: taxValidation.error || "Tax calculation validation failed",
          errorType: taxValidation.errorType,
          errorCode: taxValidation.errorCode,
        });
      }
      
      console.log("[ORDER CREATE] Tax validation passed:", {
        calculationId: cart.stripeTaxCalculationId,
        status: taxValidation.status,
      });
    } catch (taxValidationError) {
      console.error("[ORDER CREATE] Exception during tax validation:", {
        error: taxValidationError.message,
        stack: taxValidationError.stack,
        cartId: cart._id,
        taxCalculationId: cart.stripeTaxCalculationId,
      });
      return res.status(400).json({
        success: false,
        message: "Failed to validate tax calculation. Please recalculate tax for your cart.",
        error: taxValidationError.message,
      });
    }

    console.log("[ORDER CREATE] Tax validation passed", {
      cartId: cart._id,
      items: cart.items.length,
      taxCalculationId: cart.stripeTaxCalculationId,
      totalTax: cart.stripeTaxData.totalTax,
    });

    // Validate stock and pricing for each item with PageContent validation
    const validatedItems = [];
    
    for (const item of cart.items) {
      const product = item.product;
      let validatedPrice = item.price;
      let availableStock = product.stock;
      let variationInfo = null;

      console.log(`[ORDER CREATE] Processing item:`, {
        productId: product._id,
        cartCombinationId: item.variationCombinationId,
        cartVariationSku: item.variationSku,
        cartPrice: item.price
      });

      // Check if item has variations
      let selectedVariationsObj = {};
      let hasVariations = false;

      // First check if cart has variationCombinationId (new format)
      if (item.variationCombinationId) {
        hasVariations = true;
        // Convert variationsObject from Map to regular object
        if (item.variationsObject) {
          selectedVariationsObj = item.variationsObject.toObject ? item.variationsObject.toObject() : item.variationsObject;
        } else {
          // Fallback to converting selectedVariations array
          selectedVariationsObj = convertVariationsToObject(item.selectedVariations);
        }
        
        console.log(`[ORDER CREATE] Item has variationCombinationId:`, {
          combinationId: item.variationCombinationId,
          variationsObject: selectedVariationsObj
        });
      } else {
        // Fallback to old format
        selectedVariationsObj = convertVariationsToObject(item.selectedVariations);
        hasVariations = Object.keys(selectedVariationsObj).length > 0;
        
        console.log(`[ORDER CREATE] Item using legacy variations:`, {
          selectedVariationsObj,
          hasVariations
        });
      }

      if (hasVariations) {
        // Fetch PageContent for this product
        const pageContentId = `product-${product._id}`;
        const pageContent = await PageContent.findOne({
          pageId: pageContentId,
          pageType: "product"
        });

        if (!pageContent) {
          return res.status(400).json({
            success: false,
            message: `Product "${product.name}" has variations but no page content found. Please contact support.`,
          });
        }

        let combination = null;

        // If cart has combinationId, use direct lookup
        if (item.variationCombinationId) {
          combination = pageContent.content.variationCombinations.find(
            combo => combo.id === item.variationCombinationId && (combo.isActive || combo.isEnabled)
          );
          
          console.log(`[ORDER CREATE] Direct combination lookup:`, {
            combinationId: item.variationCombinationId,
            found: !!combination
          });
        } else {
          // Fallback to variation matching
          combination = findVariationCombination(pageContent, selectedVariationsObj);
          
          console.log(`[ORDER CREATE] Variation matching lookup:`, {
            selectedVariationsObj,
            found: !!combination
          });
        }

        if (!combination) {
          return res.status(400).json({
            success: false,
            message: `Invalid variation combination selected for "${product.name}". Please update your cart.`,
          });
        }

        if (!(combination.isActive || combination.isEnabled)) {
          return res.status(400).json({
            success: false,
            message: `Selected variation for "${product.name}" is not available. Please update your cart.`,
          });
        }

        // Use combination's price and stock
        validatedPrice = combination.price;
        availableStock = combination.stockQuantity;
        variationInfo = {
          combinationId: combination.id,
          sku: combination.sku,
          selectedVariationsObj: selectedVariationsObj
        };

        console.log(`[ORDER CREATE] Variation validation successful:`, {
          combinationId: combination.id,
          validatedPrice,
          availableStock,
          sku: combination.sku
        });

        // Validate pricing matches
        if (item.price !== validatedPrice) {
          return res.status(400).json({
            success: false,
            message: `Price mismatch for "${product.name}". Please refresh your cart to get updated pricing.`,
          });
        }
      } else {
        console.log(`[ORDER CREATE] Simple product without variations:`, {
          productId: product._id,
          stock: product.stock
        });
      }

      // Check stock availability
      if (availableStock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `${product.name} is out of stock. Only ${availableStock} available.`,
        });
      }

      validatedItems.push({
        ...item.toObject(),
        validatedPrice,
        availableStock,
        variationInfo,
        hasVariations
      });
    }

    console.log(`[ORDER CREATE] All items validated. Creating order items...`);

    // Create order items from validated cart items
    const orderItems = validatedItems.map((item) => {
      // Find corresponding cart item by product ID and variations to get agent code
      const cartItem = cart.items.find(ci => {
        const productMatch = ci.product.toString() === item.product._id.toString();
        const variationMatch = ci.variationCombinationId === item.variationInfo?.combinationId ||
          (!ci.variationCombinationId && !item.variationInfo?.combinationId);
        return productMatch && variationMatch;
      });
      const itemAgentCode = cartItem?.agentCode ? validatedAgentCodes[cartItem.agentCode] : null;
      
      const orderItem = {
        product: item.product._id,
        name: item.product.name,
        quantity: item.quantity,
        image:
          item.product.images && item.product.images.length > 0
            ? item.product.images[0].url
            : "default-product.jpg",
        price: item.validatedPrice,
        selectedVariations: item.selectedVariations,
        color: item.color,
        size: item.size,
        material: item.material,
        installationService: item.installationService,
        giftWrapping: item.giftWrapping,
        // Stripe Tax fields for order items
        taxCode: item.taxCode || 'txcd_99999999',
        // Agent code per item
        agentCode: itemAgentCode,
      };

      // Add variation data if it exists
      if (item.variationInfo) {
        orderItem.variationCombinationId = item.variationInfo.combinationId;
        orderItem.variationSku = item.variationInfo.sku;
        
        console.log(`[ORDER CREATE] Added variation data to order item:`, {
          productId: item.product._id,
          combinationId: item.variationInfo.combinationId,
          sku: item.variationInfo.sku
        });
      }

      return orderItem;
    });

    console.log(`[ORDER CREATE] Created ${orderItems.length} order items with tax calculation`);

    // Prepare tax breakdown with item names for order
    const taxBreakdownWithNames = cart.stripeTaxData.taxBreakdown.map(taxItem => {
      // Find the corresponding order item to get the name
      const orderItem = orderItems.find(item => 
        item.product.toString() === taxItem.productId
      );
      return {
        productId: taxItem.productId,
        itemName: orderItem?.name || 'Product',
        taxAmount: taxItem.taxAmount,
        taxRate: taxItem.taxRate,
        jurisdiction: taxItem.jurisdiction,
        taxType: 'sales_tax', // Default for US
      };
    });

    // Create the order with Stripe Tax data
    const order = new Order({
      user: req.user._id,
      orderItems,
      shippingAddress,
      billingAddress: billingAddress || shippingAddress,
      paymentMethod,
      subtotal: cart.subtotal,
      // Stripe Tax data
      stripeTaxData: {
        calculationId: cart.stripeTaxCalculationId,
        totalTaxAmount: cart.stripeTaxData.totalTax,
        taxBreakdown: taxBreakdownWithNames,
        jurisdiction: cart.stripeTaxData.taxBreakdown[0]?.jurisdiction || '',
        taxCalculatedAt: cart.stripeTaxData.calculatedAt || new Date(),
        isValid: true,
      },
      shippingMethod: cart.shippingMethod,
      shippingCost: cart.shippingCost,
      deliveryDate: cart.deliveryDate,
      deliveryTimeSlot: cart.deliveryTimeSlot,
      installationFee: cart.installationFee,
      assemblyFee: cart.assemblyFee,
      giftWrappingFee: cart.giftWrappingFee,
      discountCode: cart.discountCode,
      discountAmount: cart.discountAmount,
      agentCode: firstAgentCode, // Store first agent code found (for backward compatibility)
      totalPrice: cart.total, // Cart total includes tax
      customerNotes: customerNotes || "",
      // Initialize payment fields
      isPaid: false,
      paymentStatus: "pending",
      orderStatus: "pending",
      // Initialize tax compliance tracking
      taxCompliance: {
        reportingRequired: false, // Will be set based on order amount/jurisdiction
        reportedToAuthorities: false,
      },
    });

    // Save the order
    const createdOrder = await order.save();

    console.log(`[ORDER CREATE] Order created successfully with tax calculation:`, {
      orderId: createdOrder._id,
      itemsWithVariations: createdOrder.orderItems.filter(item => item.variationCombinationId).length,
      totalItems: createdOrder.orderItems.length,
      taxCalculationId: createdOrder.stripeTaxData?.calculationId,
      totalTax: createdOrder.stripeTaxData?.totalTaxAmount,
    });

    // Stock is reserved but not deducted until payment confirmation

    res.status(201).json({
      success: true,
      message: "Order created successfully. Proceed to payment.",
      order: createdOrder,
      paymentRequired: true,
      taxDetails: {
        totalTax: createdOrder.stripeTaxData?.totalTaxAmount || 0,
        taxCalculationId: createdOrder.stripeTaxData?.calculationId,
        jurisdiction: createdOrder.stripeTaxData?.jurisdiction || '',
      },
    });
  } catch (error) {
    console.error("[ORDER CREATE] Error creating order:", {
      error: error.message,
      stack: error.stack,
      payload: {
        cartId: req.body?.cartId,
        userId: req.user?._id,
      },
    });
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check if order belongs to current user or user is admin
    if (!order.user.equals(req.user._id) && req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this order",
      });
    }

    res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get logged in user orders
// @route   GET /api/orders/my-orders
// @access  Private
const getMyOrders = async (req, res) => {
  try {
    const pageSize = 10;
    const page = Number(req.query.page) || 1;

    const count = await Order.countDocuments({ user: req.user._id });

    const orders = await Order.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(pageSize)
      .skip(pageSize * (page - 1));

    res.status(200).json({
      success: true,
      count,
      pages: Math.ceil(count / pageSize),
      page,
      orders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update order to paid
// @route   PUT /api/orders/:id/pay
// @access  Private
const updateOrderToPaid = async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({
        success: false,
        message: "Payment intent ID is required",
      });
    }

    const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Ensure user owns this order or is admin
    if (!order.user._id.equals(req.user._id) && req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this order",
      });
    }

    // Check if order is already paid
    if (order.isPaid) {
      return res.status(400).json({
        success: false,
        message: "Order is already paid",
      });
    }

    // Verify payment with Stripe
    const result = await retrievePaymentIntent(paymentIntentId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to verify payment",
        error: result.error,
      });
    }

    const paymentIntent = result.paymentIntent;

    // Verify payment is successful
    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({
        success: false,
        message: "Payment has not been completed",
        paymentStatus: paymentIntent.status,
      });
    }

    // Verify this payment is for this order (from metadata)
    const metadata = paymentIntent.metadata || {};
    if (metadata.orderId && metadata.orderId !== order._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Payment is not for this order",
      });
    }

    // REMOVED: Tax transaction creation for testing

    // Update order with payment information
    order.isPaid = true;
    order.paidAt = Date.now();
    order.paymentStatus = "completed";
    order.orderStatus = "processing";
    order.paymentResult = {
      paymentId: paymentIntent.id,
      status: paymentIntent.status,
      updateTime: new Date().toISOString(),
      email: paymentIntent.receipt_email || req.user.email,
      paymentMethod: "stripe",
    };

    // REMOVED: Tax transaction and compliance setup for testing

    const updatedOrder = await order.save();

    // Now that payment is confirmed, update stock
    for (const item of order.orderItems) {
      if (item.variationCombinationId) {
        // Update PageContent variation stock
        const pageContentId = `product-${item.product}`;
        const pageContent = await PageContent.findOne({
          pageId: pageContentId,
          pageType: "product"
        });

        if (pageContent && pageContent.content && pageContent.content.variationCombinations) {
          const combinations = pageContent.content.variationCombinations;
          const combinationIndex = combinations.findIndex(
            combo => combo.id === item.variationCombinationId
          );

          if (combinationIndex > -1) {
            combinations[combinationIndex].stockQuantity -= item.quantity;
            
            // Mark the path as modified for mixed content
            pageContent.markModified('content.variationCombinations');
            await pageContent.save();
            
            console.log(`Updated variation stock for combination ${item.variationCombinationId}: -${item.quantity}`);
          }
        }
      } else {
        // Update regular product stock for items without variations
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stock: -item.quantity },
        });
        
        console.log(`Updated product stock for ${item.product}: -${item.quantity}`);
      }
    }

    // UPDATED: Auto-create shipment if enabled
    if (process.env.SHIPROCKET_AUTO_CREATE === 'true') {
      try {
        const shipmentResult = await createShipmentAfterPayment(updatedOrder, order.user);
        if (shipmentResult.success) {
          console.log(`[ORDER PAID] Auto-shipment created for order ${updatedOrder._id}`);
        } else {
          console.log(`[ORDER PAID] Auto-shipment skipped for order ${updatedOrder._id}:`, shipmentResult.message);
        }
      } catch (shipmentError) {
        console.error(`[ORDER PAID] Auto-shipment error for order ${updatedOrder._id}:`, shipmentError);
        // Don't fail the payment process if shipment creation fails
      }
    }

    // Clear the cart after successful payment
    const cart = await Cart.findOne({ user: req.user._id });
    if (cart) {
      cart.clearCart();
      await cart.save();
    }

    // Send payment confirmation email to customer
    try {
      // Calculate estimated delivery from products' shippingEstimatedTime
      let estimatedDelivery = null;
      try {
        const productIds = updatedOrder.orderItems.map(item => item.product);
        const products = await Product.find({ _id: { $in: productIds } }).select('shippingEstimatedTime');
        
        // Get all unique delivery times from products
        const deliveryTimes = products
          .map(p => p.shippingEstimatedTime)
          .filter(Boolean)
          .filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates
        
        if (deliveryTimes.length > 0) {
          // Use the longest delivery time if multiple products have different times
          // Or use the single delivery time if all products have the same
          estimatedDelivery = deliveryTimes.length === 1 
            ? deliveryTimes[0] 
            : deliveryTimes.sort((a, b) => {
                // Simple comparison - if both contain numbers, compare them
                const aNum = parseInt(a.match(/\d+/)?.[0] || '0');
                const bNum = parseInt(b.match(/\d+/)?.[0] || '0');
                return bNum - aNum; // Sort descending
              })[0];
        }
      } catch (error) {
        console.error(`[ORDER PAID] Error calculating estimated delivery:`, error);
      }

      const orderDetails = {
        orderId: updatedOrder._id.toString(),
        invoiceNumber: updatedOrder.invoiceNumber,
        totalAmount: updatedOrder.totalPrice.toFixed(2),
        // REMOVED: Tax details for testing
        orderItems: updatedOrder.orderItems,
        shippingAddress: updatedOrder.shippingAddress,
        paymentMethod: updatedOrder.paymentMethod,
        paidAt: updatedOrder.paidAt,
        estimatedDelivery: estimatedDelivery || updatedOrder.estimatedDeliveryDate || 'Within 7-10 business days'
      };

      await sendPaymentConfirmationEmail(
        order.user.email,
        `${order.user.firstName} ${order.user.lastName}`,
        orderDetails
      );

      // Send notification to admin
      const adminOrderDetails = {
        orderId: updatedOrder._id.toString(),
        invoiceNumber: updatedOrder.invoiceNumber,
        userName: `${order.user.firstName} ${order.user.lastName}`,
        userEmail: order.user.email,
        totalAmount: updatedOrder.totalPrice.toFixed(2),
        // REMOVED: Tax details for testing
        orderItems: updatedOrder.orderItems,
        shippingAddress: updatedOrder.shippingAddress,
        paymentMethod: updatedOrder.paymentMethod,
        paidAt: updatedOrder.paidAt
      };

      await sendNewOrderNotificationEmail(adminOrderDetails);

      console.log(`[ORDER PAID] Email notifications sent for order ${updatedOrder._id}`);
    } catch (emailError) {
      console.error("Error sending payment confirmation emails:", emailError);
      // Don't fail the payment process if email fails
    }

    // Sync order to external e-commerce system
    // Refresh order from database to ensure all fields are up-to-date
    try {
      const refreshedOrder = await Order.findById(updatedOrder._id);
      if (!refreshedOrder) {
        console.error(`[ORDER PAID] Order ${updatedOrder._id} not found when trying to sync`);
      } else {
        // Ensure payment status is completed before syncing
        if (refreshedOrder.paymentStatus !== 'completed' || !refreshedOrder.isPaid) {
          console.warn(`[ORDER PAID] Order ${updatedOrder._id} payment status is not completed, skipping sync:`, {
            paymentStatus: refreshedOrder.paymentStatus,
            isPaid: refreshedOrder.isPaid,
          });
        } else {
          // Fetch user if not already populated
          let user = order.user;
          if (typeof user === 'string' || !user) {
            const User = (await import("../models/userModel.js")).default;
            user = await User.findById(refreshedOrder.user);
          }
          
          if (!user) {
            console.error(`[ORDER PAID] User not found for order ${updatedOrder._id}`);
          } else {
            console.log(`[ORDER PAID] Syncing order ${updatedOrder._id} with agent code: ${refreshedOrder.agentCode || 'none'}`);
            const syncResult = await syncOrderToEcommerce(refreshedOrder, user);
            if (syncResult.success) {
              console.log(`[ORDER PAID] Order synced to e-commerce system for order ${updatedOrder._id}:`, {
                orderId: syncResult.orderId,
                responseData: syncResult.data,
                agentCode: refreshedOrder.agentCode || 'none',
              });
            } else {
              console.warn(`[ORDER PAID] Failed to sync order to e-commerce system for order ${updatedOrder._id}:`, {
                error: syncResult.error,
                status: syncResult.status,
                response: syncResult.response,
              });
              // Don't fail the payment process if sync fails
            }
          }
        }
      }
    } catch (syncError) {
      console.error(`[ORDER PAID] Error syncing order to e-commerce system for order ${updatedOrder._id}:`, syncError);
      // Don't fail the payment process if sync fails
    }

    // 🆕 NEW: Send vendor notifications for products with vendor emails
    try {
      // Get all products in this order to check for vendor emails
      const productIds = updatedOrder.orderItems.map(item => item.product);
      const products = await Product.find({ _id: { $in: productIds } }).select('vendorEmail vendorName name');
      
      // Group products by vendor to avoid duplicate emails
      const vendorNotifications = new Map();
      
      for (const product of products) {
        if (product.vendorEmail && product.vendorEmail.trim()) {
          const vendorKey = product.vendorEmail.toLowerCase().trim();
          
          if (!vendorNotifications.has(vendorKey)) {
            vendorNotifications.set(vendorKey, {
              vendorEmail: product.vendorEmail.trim(),
              vendorName: product.vendorName || 'Vendor',
              products: []
            });
          }
          
          // Add this product to the vendor's notification
          const vendorNotification = vendorNotifications.get(vendorKey);
          vendorNotification.products.push({
            name: product.name,
            quantity: updatedOrder.orderItems.find(item => item.product.toString() === product._id.toString())?.quantity || 0
          });
        }
      }
      
      // Send notifications to each vendor
      for (const [vendorKey, vendorData] of vendorNotifications) {
        try {
          const vendorOrderDetails = {
            orderId: updatedOrder._id.toString(),
            invoiceNumber: updatedOrder.invoiceNumber,
            totalAmount: updatedOrder.totalPrice.toFixed(2),
            orderItems: vendorData.products.map(product => ({
              name: product.name,
              quantity: product.quantity,
              price: updatedOrder.orderItems.find(item => 
                item.name === product.name
              )?.price || 0
            })),
            shippingAddress: updatedOrder.shippingAddress,
            customerName: `${order.user.firstName} ${order.user.lastName}`,
            customerEmail: order.user.email,
            paidAt: updatedOrder.paidAt
          };

          await sendVendorOrderNotificationEmail(
            vendorData.vendorEmail,
            vendorData.vendorName,
            vendorOrderDetails
          );

          console.log(`[ORDER PAID] Vendor notification sent to ${vendorData.vendorEmail} for order ${updatedOrder._id}`);
        } catch (vendorEmailError) {
          console.error(`[ORDER PAID] Error sending vendor notification to ${vendorData.vendorEmail}:`, vendorEmailError);
          // Don't fail the payment process if vendor email fails
        }
      }
      
      if (vendorNotifications.size > 0) {
        console.log(`[ORDER PAID] Vendor notifications sent to ${vendorNotifications.size} vendors for order ${updatedOrder._id}`);
      }
    } catch (vendorNotificationError) {
      console.error("Error processing vendor notifications:", vendorNotificationError);
      // Don't fail the payment process if vendor notifications fail
    }

    res.status(200).json({
      success: true,
      message: "Order marked as paid",
      order: updatedOrder,
      // REMOVED: Tax transaction details for testing
    });
  } catch (error) {
    console.error("Error updating order to paid:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update order to delivered
// @route   PUT /api/orders/:id/deliver
// @access  Private/Admin
const updateOrderToDelivered = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Only admin can mark as delivered
    if (req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized, admin only",
      });
    }

    order.isDelivered = true;
    order.deliveredAt = Date.now();
    order.orderStatus = "delivered";

    // Update ShipRocket data if exists
    if (order.shipRocketData) {
      order.shipRocketData.status = "delivered";
    }

    const updatedOrder = await order.save();

    // Send status update email to customer
    try {
      const orderDetails = {
        orderId: updatedOrder._id.toString(),
        invoiceNumber: updatedOrder.invoiceNumber,
        totalAmount: updatedOrder.totalPrice.toFixed(2),
        orderItems: updatedOrder.orderItems,
        estimatedDelivery: updatedOrder.estimatedDeliveryDate
      };

      await sendOrderStatusUpdateEmail(
        order.user.email,
        `${order.user.firstName} ${order.user.lastName}`,
        orderDetails,
        'delivered'
      );

      console.log(`[ORDER DELIVERED] Email notification sent for order ${updatedOrder._id}`);
    } catch (emailError) {
      console.error("Error sending delivery notification email:", emailError);
    }

    res.status(200).json({
      success: true,
      message: "Order marked as delivered",
      order: updatedOrder,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
const updateOrderStatus = async (req, res) => {
  try {
    const {
      orderStatus,
      trackingNumber,
      trackingCompany,
      adminNotes,
      estimatedDeliveryDate,
    } = req.body;

    const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Only admin can update order status
    if (req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized, admin only",
      });
    }

    const previousStatus = order.orderStatus;

    if (orderStatus) {
      order.orderStatus = orderStatus;

      // Update delivery status based on order status
      if (orderStatus === "delivered") {
        order.isDelivered = true;
        order.deliveredAt = Date.now();
      }

      // If order is cancelled and already paid, mark for refund
      if (orderStatus === "cancelled" && order.isPaid) {
        order.paymentStatus = "refund-pending";
      }

      // Update ShipRocket data status if exists
      if (order.shipRocketData) {
        order.updateShipmentStatus(orderStatus);
      }
    }

    if (trackingNumber) order.trackingNumber = trackingNumber;
    if (trackingCompany) order.trackingCompany = trackingCompany;
    if (adminNotes) order.adminNotes = adminNotes;
    if (estimatedDeliveryDate)
      order.estimatedDeliveryDate = estimatedDeliveryDate;

    const updatedOrder = await order.save();

    // Send status update email to customer (only if status actually changed)
    if (orderStatus && orderStatus !== previousStatus) {
      try {
        const orderDetails = {
          orderId: updatedOrder._id.toString(),
          invoiceNumber: updatedOrder.invoiceNumber,
          totalAmount: updatedOrder.totalPrice.toFixed(2),
          orderItems: updatedOrder.orderItems,
          estimatedDelivery: updatedOrder.estimatedDeliveryDate
        };

        const trackingInfo = trackingNumber && trackingCompany ? {
          trackingNumber,
          carrier: trackingCompany,
          trackingUrl: updatedOrder.getTrackingUrl()
        } : null;

        await sendOrderStatusUpdateEmail(
          order.user.email,
          `${order.user.firstName} ${order.user.lastName}`,
          orderDetails,
          orderStatus,
          trackingInfo
        );

        console.log(`[ORDER STATUS] Email notification sent for order ${updatedOrder._id}, status: ${orderStatus}`);
      } catch (emailError) {
        console.error("Error sending status update email:", emailError);
      }
    }

    res.status(200).json({
      success: true,
      message: "Order status updated",
      order: updatedOrder,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private
const cancelOrder = async (req, res) => {
  try {
    const { cancellationReason } = req.body;

    const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check if order belongs to current user or user is admin
    if (!order.user._id.equals(req.user._id) && req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this order",
      });
    }

    // Check if order can be cancelled
    const nonCancellableStatuses = [
      "shipped",
      "delivered",
      "returned",
      "refunded",
    ];
    if (nonCancellableStatuses.includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Order cannot be cancelled in ${order.orderStatus} status`,
      });
    }

    const previousStatus = order.orderStatus;
    order.orderStatus = "cancelled";
    order.cancellationReason = cancellationReason || "Cancelled by customer";
    order.cancelledAt = Date.now();

    // UPDATED: Cancel ShipRocket shipment if exists
    if (order.shipRocketData?.shipmentId && order.trackingNumber) {
      try {
        console.log(`[ORDER CANCEL] Cancelling ShipRocket shipment for order ${order._id}`);
        
        const cancelResult = await shipRocketService.cancelShipment(order.trackingNumber);
        
        if (cancelResult.success) {
          order.shipRocketData.status = 'cancelled';
          order.shipRocketData.cancelledAt = new Date();
          console.log(`[ORDER CANCEL] ShipRocket shipment cancelled successfully`);
        } else {
          console.error(`[ORDER CANCEL] Failed to cancel ShipRocket shipment:`, cancelResult.error);
          // Continue with order cancellation even if shipment cancellation fails
        }
      } catch (shipmentError) {
        console.error(`[ORDER CANCEL] Error cancelling ShipRocket shipment:`, shipmentError);
        // Continue with order cancellation
      }
    }

    // If order was paid, mark for refund
    if (order.isPaid && order.paymentResult && order.paymentResult.paymentId) {
      order.paymentStatus = "refund-pending";

      // Note for admin to process refund
      order.adminNotes = order.adminNotes
        ? `${order.adminNotes}\nCancellation requested. Refund needed for payment ${order.paymentResult.paymentId}.`
        : `Cancellation requested. Refund needed for payment ${order.paymentResult.paymentId}.`;
    } else {
      // For unpaid orders, restore stock
      for (const item of order.orderItems) {
        if (item.variationCombinationId) {
          // Restore PageContent variation stock
          const pageContentId = `product-${item.product}`;
          const pageContent = await PageContent.findOne({
            pageId: pageContentId,
            pageType: "product"
          });

          if (pageContent && pageContent.content && pageContent.content.variationCombinations) {
            const combinations = pageContent.content.variationCombinations;
            const combinationIndex = combinations.findIndex(
              combo => combo.id === item.variationCombinationId
            );

            if (combinationIndex > -1) {
              combinations[combinationIndex].stockQuantity += item.quantity;
              
              // Mark the path as modified for mixed content
              pageContent.markModified('content.variationCombinations');
              await pageContent.save();
            }
          }
        } else {
          // Restore regular product stock
          await Product.findByIdAndUpdate(item.product, {
            $inc: { stock: item.quantity },
          });
        }
      }
    }

    const updatedOrder = await order.save();

    // Send cancellation email to customer
    try {
      const orderDetails = {
        orderId: updatedOrder._id.toString(),
        invoiceNumber: updatedOrder.invoiceNumber,
        totalAmount: updatedOrder.totalPrice.toFixed(2),
        // REMOVED: Tax details for testing
        orderItems: updatedOrder.orderItems,
        cancellationReason: updatedOrder.cancellationReason,
        cancelledAt: updatedOrder.cancelledAt,
        isPaid: updatedOrder.isPaid,
        refundStatus: updatedOrder.isPaid ? 'pending' : 'not_applicable',
        shipmentCancelled: updatedOrder.shipRocketData?.status === 'cancelled'
      };

      await sendOrderCancellationEmail(
        order.user.email,
        `${order.user.firstName} ${order.user.lastName}`,
        orderDetails
      );

      // Send notification to admin about the cancellation
      const adminNotificationDetails = {
        orderId: updatedOrder._id.toString(),
        invoiceNumber: updatedOrder.invoiceNumber,
        userName: `${order.user.firstName} ${order.user.lastName}`,
        userEmail: order.user.email,
        totalAmount: updatedOrder.totalPrice.toFixed(2),
        // REMOVED: Tax details for testing
        cancellationReason: updatedOrder.cancellationReason,
        cancelledAt: updatedOrder.cancelledAt,
        isPaid: updatedOrder.isPaid,
        needsRefund: updatedOrder.isPaid && updatedOrder.paymentResult && updatedOrder.paymentResult.paymentId,
        // REMOVED: stripeTaxTransactionId for testing
        shipmentDetails: updatedOrder.shipRocketData || null
      };

      await sendOrderCancellationNotificationEmail(adminNotificationDetails);

      console.log(`[ORDER CANCELLED] Email notifications sent for order ${updatedOrder._id}`);
    } catch (emailError) {
      console.error("Error sending cancellation emails:", emailError);
    }

    res.status(200).json({
      success: true,
      message: order.isPaid
        ? "Order cancelled. Refund will be processed by our team."
        : "Order cancelled successfully",
      order: updatedOrder,
      // REMOVED: Tax info for testing
      shipmentInfo: {
        cancelled: updatedOrder.shipRocketData?.status === 'cancelled',
        shipmentId: updatedOrder.shipRocketData?.shipmentId || null,
        awbCode: updatedOrder.trackingNumber || null,
      },
    });
  } catch (error) {
    console.error("Error cancelling order:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Request return
// @route   PUT /api/orders/:id/return
// @access  Private
const requestReturn = async (req, res) => {
  try {
    const { returnReason } = req.body;

    if (!returnReason) {
      return res.status(400).json({
        success: false,
        message: "Please provide a reason for return",
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check if order belongs to current user
    if (!order.user.equals(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to return this order",
      });
    }

    // Check if order is delivered
    if (order.orderStatus !== "delivered") {
      return res.status(400).json({
        success: false,
        message: "Only delivered orders can be returned",
      });
    }

    // Check if return already requested
    if (order.returnRequested) {
      return res.status(400).json({
        success: false,
        message: "Return already requested for this order",
      });
    }

    order.returnRequested = true;
    order.returnStatus = "requested";
    order.returnReason = returnReason;

    const updatedOrder = await order.save();

    res.status(200).json({
      success: true,
      message: "Return requested successfully",
      order: updatedOrder,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Process return request (admin)
// @route   PUT /api/orders/:id/process-return
// @access  Private/Admin
const processReturn = async (req, res) => {
  try {
    const { returnStatus, refundAmount } = req.body;

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Only admin can process returns
    if (req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized, admin only",
      });
    }

    // Check if return was requested
    if (!order.returnRequested) {
      return res.status(400).json({
        success: false,
        message: "No return requested for this order",
      });
    }

    order.returnStatus = returnStatus;

    // If return is approved, update stock and handle refund
    if (returnStatus === "approved" || returnStatus === "received") {
      // Mark for refund, but don't process yet
      order.paymentStatus = "refund-pending";
    }

    // If return is refunded, update payment status and restore stock
    if (returnStatus === "refunded") {
      order.paymentStatus = "refunded";
      order.refundAmount = refundAmount || order.totalPrice;
      order.refundedAt = Date.now();
      order.orderStatus = "returned";

      // Restore stock for all items
      for (const item of order.orderItems) {
        if (item.variationCombinationId) {
          // Restore PageContent variation stock
          const pageContentId = `product-${item.product}`;
          const pageContent = await PageContent.findOne({
            pageId: pageContentId,
            pageType: "product"
          });

          if (pageContent && pageContent.content && pageContent.content.variationCombinations) {
            const combinations = pageContent.content.variationCombinations;
            const combinationIndex = combinations.findIndex(
              combo => combo.id === item.variationCombinationId
            );

            if (combinationIndex > -1) {
              combinations[combinationIndex].stockQuantity += item.quantity;
              
              // Mark the path as modified for mixed content
              pageContent.markModified('content.variationCombinations');
              await pageContent.save();
            }
          }
        } else {
          // Restore regular product stock
          await Product.findByIdAndUpdate(item.product, {
            $inc: { stock: item.quantity },
          });
        }
      }
    }

    const updatedOrder = await order.save();

    res.status(200).json({
      success: true,
      message: `Return ${returnStatus} successfully`,
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Error processing return:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Process admin-initiated refund
// @route   PUT /api/orders/:id/process-refund
// @access  Private/Admin
const processOrderRefund = async (req, res) => {
  try {
    const { refundAmount, refundReason } = req.body;

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Only admin can process refunds
    if (req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized, admin only",
      });
    }

    // Verify order has been paid
    if (
      !order.isPaid ||
      !order.paymentResult ||
      !order.paymentResult.paymentId
    ) {
      return res.status(400).json({
        success: false,
        message: "Cannot refund an unpaid order",
      });
    }

    order.paymentStatus = "refunded";
    order.refundAmount = refundAmount || order.totalPrice;
    order.refundedAt = Date.now();
    order.adminNotes = order.adminNotes
      ? `${order.adminNotes}\nRefund processed: ${
          refundReason || "No reason provided"
        }`
      : `Refund processed: ${refundReason || "No reason provided"}`;

    // Update order status if it was cancelled
    if (order.orderStatus === "cancelled") {
      // Already cancelled, just update refund status
    } else {
      order.orderStatus = "refunded";
    }

    // Restore stock for all items
    for (const item of order.orderItems) {
      if (item.variationCombinationId) {
        // Restore PageContent variation stock
        const pageContentId = `product-${item.product}`;
        const pageContent = await PageContent.findOne({
          pageId: pageContentId,
          pageType: "product"
        });

        if (pageContent && pageContent.content && pageContent.content.variationCombinations) {
          const combinations = pageContent.content.variationCombinations;
          const combinationIndex = combinations.findIndex(
            combo => combo.id === item.variationCombinationId
          );

          if (combinationIndex > -1) {
            combinations[combinationIndex].stockQuantity += item.quantity;
            
            // Mark the path as modified for mixed content
            pageContent.markModified('content.variationCombinations');
            await pageContent.save();
            
            console.log(`[REFUND] Restored PageContent variation stock for combination ${item.variationCombinationId}: +${item.quantity}`);
          } else {
            console.warn(`[REFUND] Variation combination ${item.variationCombinationId} not found in PageContent`);
          }
        } else {
          console.warn(`[REFUND] PageContent not found for product ${item.product} with variations`);
        }
      } else {
        // Restore regular product stock
        const result = await Product.findByIdAndUpdate(
          item.product, 
          { $inc: { stock: item.quantity } },
          { new: true }
        );
        
        if (result) {
          console.log(`[REFUND] Restored product stock for ${item.product}: +${item.quantity}, new stock: ${result.stock}`);
        } else {
          console.warn(`[REFUND] Product ${item.product} not found for stock restoration`);
        }
      }
    }

    const updatedOrder = await order.save();

    console.log(`[REFUND] Order ${order._id} refund processed successfully`);

    res.status(200).json({
      success: true,
      message:
        "Order marked for refund. Process the actual refund in Stripe dashboard or using the Payment API.",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Error processing refund:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Generate invoice
// @route   POST /api/orders/:id/invoice
// @access  Private
const generateInvoice = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Only admin or the order owner can generate invoice
    if (!order.user.equals(req.user._id) && req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to generate invoice for this order",
      });
    }

    // Invoice generation logic will be implemented in frontend or separate service

    order.invoiceGenerated = true;
    order.invoiceUrl = `/invoices/${order.invoiceNumber}.pdf`;

    const updatedOrder = await order.save();

    res.status(200).json({
      success: true,
      message: "Invoice generated successfully",
      invoiceUrl: updatedOrder.invoiceUrl,
      order: updatedOrder,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get all orders (admin)
// @route   GET /api/orders
// @access  Private/Admin
const getOrders = async (req, res) => {
  try {
    const pageSize = 20;
    const page = Number(req.query.page) || 1;

    // Build filter
    const filter = {};

    // Filter by status if provided
    if (req.query.status) {
      filter.orderStatus = req.query.status;
    }

    // Filter by payment status if provided
    if (req.query.paymentStatus) {
      filter.paymentStatus = req.query.paymentStatus;
    }

    // UPDATED: Filter by shipment status if provided
    if (req.query.shipmentStatus) {
      filter['shipRocketData.status'] = req.query.shipmentStatus;
    }

    // Filter by date range if provided
    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate),
      };
    }

    // Search by order number or customer
    if (req.query.search) {
      // Check if search is for invoice number
      if (req.query.search.startsWith("HD")) {
        filter.invoiceNumber = req.query.search;
      } else if (req.query.search.length > 10) {
        // Could be tracking number
        filter.trackingNumber = { $regex: req.query.search, $options: "i" };
      } else {
        // Otherwise search in user's name info
        const userIds = await User.find({
          $or: [
            { firstName: { $regex: req.query.search, $options: "i" } },
            { lastName: { $regex: req.query.search, $options: "i" } },
            { email: { $regex: req.query.search, $options: "i" } },
          ],
        }).select("_id");

        filter.user = { $in: userIds.map((u) => u._id) };
      }
    }

    const count = await Order.countDocuments(filter);

    // Determine sort order
    let sort = { createdAt: -1 }; // Default sort by newest

    if (req.query.sort) {
      switch (req.query.sort) {
        case "oldest":
          sort = { createdAt: 1 };
          break;
        case "price-high":
          sort = { totalPrice: -1 };
          break;
        case "price-low":
          sort = { totalPrice: 1 };
          break;
        // Keep default for newest
      }
    }

    const orders = await Order.find(filter)
      .populate("user", "id firstName lastName email")
      .sort(sort)
      .limit(pageSize)
      .skip(pageSize * (page - 1));

    res.status(200).json({
      success: true,
      count,
      pages: Math.ceil(count / pageSize),
      page,
      orders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get order statistics (admin)
// @route   GET /api/orders/stats
// @access  Private/Admin
const getOrderStats = async (req, res) => {
  try {
    // Get statistics for today, this week, this month, and all time
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thisWeekStart = new Date();
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
    thisWeekStart.setHours(0, 0, 0, 0);

    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Total orders
    const totalOrders = await Order.countDocuments();
    const totalRevenue = await Order.aggregate([
      { $match: { isPaid: true } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } },
    ]);

    // REMOVED: Tax collection statistics for testing

    // UPDATED: ShipRocket statistics
    const totalShipments = await Order.countDocuments({
      'shipRocketData.shipmentId': { $exists: true }
    });

    const shipmentsByStatus = await Order.aggregate([
      { $match: { 'shipRocketData.shipmentId': { $exists: true } } },
      { $group: { _id: "$shipRocketData.status", count: { $sum: 1 } } },
    ]);

    const deliveredShipments = await Order.countDocuments({
      orderStatus: 'delivered',
      'shipRocketData.shipmentId': { $exists: true }
    });

    // Orders by status
    const ordersByStatus = await Order.aggregate([
      { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
    ]);

    // Orders by payment status
    const ordersByPaymentStatus = await Order.aggregate([
      { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
    ]);

    // Today's orders and revenue
    const todayOrders = await Order.countDocuments({
      createdAt: { $gte: today },
    });

    const todayRevenue = await Order.aggregate([
      { $match: { createdAt: { $gte: today }, isPaid: true } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } },
    ]);

    // This week's orders and revenue
    const thisWeekOrders = await Order.countDocuments({
      createdAt: { $gte: thisWeekStart },
    });

    const thisWeekRevenue = await Order.aggregate([
      { $match: { createdAt: { $gte: thisWeekStart }, isPaid: true } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } },
    ]);

    // This month's orders and revenue
    const thisMonthOrders = await Order.countDocuments({
      createdAt: { $gte: thisMonthStart },
    });

    const thisMonthRevenue = await Order.aggregate([
      { $match: { createdAt: { $gte: thisMonthStart }, isPaid: true } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } },
    ]);

    // Get sales by day for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailySales = await Order.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo }, isPaid: true } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orders: { $sum: 1 },
          revenue: { $sum: "$totalPrice" },
          // REMOVED: Tax data for testing
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Top selling products
    const topProducts = await Order.aggregate([
      { $match: { isPaid: true } },
      { $unwind: "$orderItems" },
      {
        $group: {
          _id: "$orderItems.product",
          productName: { $first: "$orderItems.name" },
          totalQuantity: { $sum: "$orderItems.quantity" },
          totalRevenue: {
            $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] },
          },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 },
    ]);

    // REMOVED: Tax compliance statistics for testing

    // Compile statistics
    const stats = {
      totalOrders,
      totalRevenue: totalRevenue.length > 0 ? totalRevenue[0].total : 0,
      // REMOVED: Tax statistics for testing
      todayOrders,
      todayRevenue: todayRevenue.length > 0 ? todayRevenue[0].total : 0,
      // REMOVED: Tax statistics for testing
      thisWeekOrders,
      thisWeekRevenue: thisWeekRevenue.length > 0 ? thisWeekRevenue[0].total : 0,
      thisMonthOrders,
      thisMonthRevenue: thisMonthRevenue.length > 0 ? thisMonthRevenue[0].total : 0,
      ordersByStatus,
      ordersByPaymentStatus,
      dailySales,
      topProducts,
      // UPDATED: ShipRocket statistics
      shipping: {
        totalShipments,
        deliveredShipments,
        deliveryRate: totalShipments > 0 ? ((deliveredShipments / totalShipments) * 100).toFixed(1) : 0,
        shipmentsByStatus,
      },
      // REMOVED: Tax compliance information for testing
    };

    res.status(200).json({
      success: true,
      stats,
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
  createOrder,
  getOrderById,
  getMyOrders,
  updateOrderToPaid,
  updateOrderToDelivered,
  updateOrderStatus,
  cancelOrder,
  requestReturn,
  processReturn,
  processOrderRefund,
  generateInvoice,
  getOrders,
  getOrderStats,
};