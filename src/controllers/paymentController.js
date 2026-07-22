import Order from "../models/orderModel.js";
import User from "../models/userModel.js";
import Product from "../models/productModel.js";
import PageContent from "../models/pageContentModel.js";
import Cart from "../models/cartModel.js";
import {
  createPaymentIntent,
  createPaymentIntentWithTax,
  retrievePaymentIntent,
  createRefund,
  createCustomer,
  attachPaymentMethod,
  listPaymentMethods,
  constructEvent,
  handlePaymentEvent,
  createTaxTransaction,
  validateTaxCalculation,
  checkStripeTaxConfiguration,
} from "../utils/stripeUtils.js";
import shipRocketService, { convertOrderToShipRocketFormat } from "../utils/shipRocketUtils.js";
import {
  sendPaymentConfirmationEmail,
  sendOrderStatusUpdateEmail,
  sendNewOrderNotificationEmail,
} from "../config/emailConfig.js";
import syncOrderToEcommerce from "../utils/ecommerceOrderSync.js";

// Helper function to update stock after successful payment
const updateOrderStock = async (order) => {
  try {
    console.log(`[STOCK UPDATE] Starting stock update for order ${order._id}`);

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
            const currentStock = combinations[combinationIndex].stockQuantity;
            combinations[combinationIndex].stockQuantity = Math.max(0, currentStock - item.quantity);
            
            // Mark the path as modified for mixed content
            pageContent.markModified('content.variationCombinations');
            await pageContent.save();
            
            console.log(`[STOCK UPDATE] Updated PageContent variation stock for combination ${item.variationCombinationId}: ${currentStock} -> ${combinations[combinationIndex].stockQuantity} (-${item.quantity})`);
          } else {
            console.warn(`[STOCK UPDATE] Variation combination ${item.variationCombinationId} not found in PageContent`);
          }
        } else {
          console.warn(`[STOCK UPDATE] PageContent not found for product ${item.product} with variations`);
        }
      } else {
        // Update regular product stock for items without variations
        const result = await Product.findByIdAndUpdate(
          item.product, 
          { $inc: { stock: -item.quantity } },
          { new: true }
        );
        
        if (result) {
          console.log(`[STOCK UPDATE] Updated product stock for ${item.product}: -${item.quantity}, new stock: ${result.stock}`);
        } else {
          console.warn(`[STOCK UPDATE] Product ${item.product} not found for stock update`);
        }
      }
    }

    console.log(`[STOCK UPDATE] Stock update completed for order ${order._id}`);
    return true;
  } catch (error) {
    console.error(`[STOCK UPDATE] Error updating stock for order ${order._id}:`, error);
    return false;
  }
};

// Helper function to clear user cart after successful payment
const clearUserCart = async (userId) => {
  try {
    const cart = await Cart.findOne({ user: userId });
    if (cart) {
      cart.clearCart();
      await cart.save();
      console.log(`[CART CLEAR] Cart cleared for user ${userId}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`[CART CLEAR] Error clearing cart for user ${userId}:`, error);
    return false;
  }
};

// Helper function to send payment confirmation and order notifications
const sendPaymentNotifications = async (order, user) => {
  try {
    // Validate user email
    if (!user || !user.email) {
      console.error(`[EMAIL] Cannot send email: user or user.email is missing`, {
        userId: user?._id,
        hasEmail: !!user?.email
      });
      return false;
    }

    console.log(`[EMAIL] Sending payment confirmation emails for order ${order._id} to ${user.email}`);

    // Calculate estimated delivery from products' shippingEstimatedTime
    let estimatedDelivery = null;
    try {
      const Product = (await import('../models/productModel.js')).default;
      const productIds = order.orderItems.map(item => item.product);
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
      console.error(`[EMAIL] Error calculating estimated delivery:`, error);
    }

    // Build user name safely
    const userName = (user.firstName && user.lastName) 
      ? `${user.firstName} ${user.lastName}` 
      : (user.firstName || user.name || 'Customer');

    // Prepare order details for email with tax data
    const orderDetails = {
      orderId: order._id.toString(),
      invoiceNumber: order.invoiceNumber,
      totalAmount: order.totalPrice.toFixed(2),
      subtotal: order.subtotal.toFixed(2),
      taxAmount: order.stripeTaxData?.totalTaxAmount?.toFixed(2) || '0.00',
      shippingCost: order.shippingCost?.toFixed(2) || '0.00',
      orderItems: order.orderItems,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentResult?.paymentMethod || 'stripe',
      paidAt: order.paidAt,
      estimatedDelivery: estimatedDelivery || order.estimatedDelivery || 'Within 7-10 business days',
      userName: userName,
      userEmail: user.email,
      stripeTaxData: order.stripeTaxData || null,
    };

    // Send payment confirmation email to customer
    console.log(`[EMAIL] Attempting to send payment confirmation to ${user.email}...`);
    await sendPaymentConfirmationEmail(
      user.email,
      userName,
      orderDetails
    );
    console.log(`[EMAIL] ✅ Payment confirmation sent successfully to ${user.email}`);

    // Send new order notification to admin
    console.log(`[EMAIL] Attempting to send admin notification...`);
    await sendNewOrderNotificationEmail(orderDetails);
    console.log(`[EMAIL] ✅ New order notification sent to admin`);

    return true;
  } catch (error) {
    console.error(`[EMAIL] ❌ Error sending payment confirmation emails:`, {
      error: error.message,
      stack: error.stack,
      orderId: order._id,
      userEmail: user?.email
    });
    return false;
  }
};

// Helper function to send order status update notification
const sendOrderStatusNotification = async (order, newStatus, trackingInfo = null) => {
  try {
    console.log(`[EMAIL] Sending order status update for order ${order._id}: ${newStatus}`);

    // Get user details
    const user = await User.findById(order.user);
    if (!user) {
      console.warn(`[EMAIL] User not found for order ${order._id}`);
      return false;
    }

    // Prepare order details for email with tax data
    const orderDetails = {
      orderId: order._id.toString(),
      invoiceNumber: order.invoiceNumber,
      totalAmount: order.totalPrice.toFixed(2),
      taxAmount: order.stripeTaxData?.totalTaxAmount?.toFixed(2) || '0.00',
      subtotal: order.subtotal.toFixed(2),
      orderItems: order.orderItems,
      estimatedDelivery: order.estimatedDelivery
    };

    const userName = user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.name;

    // Send order status update email
    await sendOrderStatusUpdateEmail(
      user.email,
      userName,
      orderDetails,
      newStatus,
      trackingInfo
    );
    console.log(`[EMAIL] Order status update sent to ${user.email}`);

    return true;
  } catch (error) {
    console.error(`[EMAIL] Error sending order status update:`, error);
    return false;
  }
};

// @desc    Create payment intent for an order
// @route   POST /api/payments/create-payment-intent
// @access  Private
const createIntent = async (req, res) => {
  try {
    // Support orderId from URL parameter or request body
    const orderId = req.params.orderId || req.body.orderId;

    console.log("[PAYMENT INTENT CREATE] Incoming request", {
      userId: req.user?._id,
      orderId: orderId,
      fromUrlParam: !!req.params.orderId,
      fromBody: !!req.body.orderId,
      body: req.body,
      params: req.params,
    });

    if (!orderId) {
      console.warn("[PAYMENT INTENT CREATE] Missing orderId in request");
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      console.warn("[PAYMENT INTENT CREATE] Order not found", { orderId });
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    console.log("[PAYMENT INTENT CREATE] Order found", {
      orderId: order._id,
      orderUser: order.user,
      requestUser: req.user._id,
      isPaid: order.isPaid,
      hasTaxData: !!order.stripeTaxData,
      taxCalculationId: order.stripeTaxData?.calculationId,
      totalPrice: order.totalPrice,
    });

    // Check if order belongs to current user
    if (!order.user.equals(req.user._id)) {
      console.warn("[PAYMENT INTENT CREATE] Unauthorized access attempt", {
        orderId: order._id,
        orderUser: order.user,
        requestUser: req.user._id,
      });
      return res.status(403).json({
        success: false,
        message: "Not authorized to make payment for this order",
      });
    }

    // Check if order is already paid
    if (order.isPaid) {
      console.warn("[PAYMENT INTENT CREATE] Order already paid", {
        orderId: order._id,
        paymentStatus: order.paymentStatus,
      });
      return res.status(400).json({
        success: false,
        message: "Order is already paid",
      });
    }

    // Validate Stripe Tax calculation
    if (!order.stripeTaxData || !order.stripeTaxData.calculationId) {
      console.warn("[PAYMENT INTENT CREATE] Order missing tax calculation", {
        orderId: order._id,
        hasStripeTaxData: !!order.stripeTaxData,
        hasCalculationId: !!order.stripeTaxData?.calculationId,
      });
      return res.status(400).json({
        success: false,
        message: "Order missing tax calculation. Please recreate the order.",
      });
    }

    // Verify tax calculation is still valid
    console.log("[PAYMENT INTENT CREATE] Validating tax calculation", {
      orderId: order._id,
      taxCalculationId: order.stripeTaxData.calculationId,
    });

    try {
      const taxValidation = await validateTaxCalculation(order.stripeTaxData.calculationId);
      
      console.log("[PAYMENT INTENT CREATE] Tax validation result", {
        orderId: order._id,
        taxCalculationId: order.stripeTaxData.calculationId,
        validationSuccess: taxValidation.success,
        isValid: taxValidation.isValid,
        status: taxValidation.status,
        error: taxValidation.error,
      });

      if (!taxValidation.success || !taxValidation.isValid) {
        console.error("[PAYMENT INTENT CREATE] Tax validation failed", {
          orderId: order._id,
          taxCalculationId: order.stripeTaxData.calculationId,
          validationResult: taxValidation,
        });
        return res.status(400).json({
          success: false,
          message: "Tax calculation expired or invalid. Please recreate the order.",
          error: taxValidation.error || "Tax calculation validation failed",
        });
      }
    } catch (taxValidationError) {
      console.error("[PAYMENT INTENT CREATE] Error validating tax calculation:", {
        orderId: order._id,
        taxCalculationId: order.stripeTaxData.calculationId,
        error: taxValidationError.message,
        stack: taxValidationError.stack,
      });
      return res.status(400).json({
        success: false,
        message: "Failed to validate tax calculation. Please recreate the order.",
        error: taxValidationError.message,
      });
    }

    // Create metadata for the payment
    const metadata = {
      orderId: order._id.toString(),
      userId: req.user._id.toString(),
      orderNumber: order.invoiceNumber || order._id.toString(),
      taxCalculationId: order.stripeTaxData.calculationId,
    };

    // Create payment intent with tax calculation
    console.log("[PAYMENT INTENT CREATE] Creating payment intent with Stripe", {
      orderId: order._id,
      amount: order.totalPrice,
      taxCalculationId: order.stripeTaxData.calculationId,
      currency: "usd",
      metadata,
    });

    const result = await createPaymentIntentWithTax(
      order.totalPrice,
      order.stripeTaxData.calculationId,
      "usd", // Default currency
      metadata
    );

    if (!result.success) {
      console.error("[PAYMENT INTENT CREATE] Failed to create payment intent", {
        orderId: order._id,
        error: result.error,
        errorDetails: result.errorDetails,
      });
      return res.status(400).json({
        success: false,
        message: "Failed to create payment intent",
        error: result.error,
      });
    }

    console.log("[PAYMENT INTENT CREATE] Payment intent created successfully", {
      orderId: order._id,
      paymentIntentId: result.paymentIntentId,
      amount: order.totalPrice,
      taxCalculationId: order.stripeTaxData.calculationId,
      totalTax: order.stripeTaxData.totalTaxAmount,
      clientSecret: result.clientSecret ? "***REDACTED***" : null,
    });

    res.status(200).json({
      success: true,
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      amount: order.totalPrice,
      taxDetails: {
        totalTax: order.stripeTaxData.totalTaxAmount,
        taxCalculationId: order.stripeTaxData.calculationId,
        jurisdiction: order.stripeTaxData.jurisdiction || '',
      },
    });
  } catch (error) {
    const orderId = req.params.orderId || req.body.orderId;
    console.error("[PAYMENT INTENT CREATE] Unexpected error creating payment intent:", {
      error: error.message,
      stack: error.stack,
      orderId: orderId,
      userId: req.user?._id,
    });
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get payment status
// @route   GET /api/payments/status/:paymentIntentId
// @access  Private
const getPaymentStatus = async (req, res) => {
  try {
    const { paymentIntentId } = req.params;

    if (!paymentIntentId) {
      return res.status(400).json({
        success: false,
        message: "Payment intent ID is required",
      });
    }

    const result = await retrievePaymentIntent(paymentIntentId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to retrieve payment intent",
        error: result.error,
      });
    }

    const { paymentIntent } = result;

    // Check if this payment belongs to the current user
    const metadata = paymentIntent.metadata || {};
    const userId = metadata.userId;

    if (userId && userId !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this payment",
      });
    }

    // Include tax information in response
    const response = {
      success: true,
      status: paymentIntent.status,
      paymentIntent,
      taxCalculationId: metadata.taxCalculationId || null,
    };

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Process a refund
// @route   POST /api/payments/refund
// @access  Private/Admin
const processRefund = async (req, res) => {
  try {
    const { orderId, amount } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    // Only admin can process refunds
    if (req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized, admin only",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check if order is paid
    if (
      !order.isPaid ||
      !order.paymentResult ||
      !order.paymentResult.paymentId
    ) {
      return res.status(400).json({
        success: false,
        message: "Order has not been paid",
      });
    }

    // Process refund
    const result = await createRefund(
      order.paymentResult.paymentId,
      amount || order.totalPrice
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to process refund",
        error: result.error,
      });
    }

    // Update order with refund information
    order.paymentStatus = "refunded";
    order.refundAmount = amount || order.totalPrice;
    order.refundedAt = Date.now();

    if (order.orderStatus !== "returned") {
      order.orderStatus = "refunded";
    }

    await order.save();

    // Send order status update notification
    await sendOrderStatusNotification(order, "refunded");

    console.log(`[REFUND] Processed refund for order ${orderId} (tax calculation skipped for testing):`, {
      refundAmount: result.refund.amount / 100,
      refundId: result.refund.id,
    });

    res.status(200).json({
      success: true,
      message: "Refund processed successfully",
      refund: result.refund,
      order,
      // REMOVED: Tax info for testing
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Save payment method for a user
// @route   POST /api/payments/save-payment-method
// @access  Private
const savePaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId } = req.body;

    if (!paymentMethodId) {
      return res.status(400).json({
        success: false,
        message: "Payment method ID is required",
      });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    let customerId = user.stripeCustomerId;

    // If user doesn't have a Stripe customer ID, create one
    if (!customerId) {
      const customerResult = await createCustomer(
        `${user.firstName} ${user.lastName}`,
        user.email,
        user.phone,
        { userId: user._id.toString() }
      );

      if (!customerResult.success) {
        return res.status(400).json({
          success: false,
          message: "Failed to create customer",
          error: customerResult.error,
        });
      }

      customerId = customerResult.customer.id;

      // Save the customer ID to the user
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // Attach payment method to customer
    const result = await attachPaymentMethod(customerId, paymentMethodId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to save payment method",
        error: result.error,
      });
    }

    res.status(200).json({
      success: true,
      message: "Payment method saved successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get user's saved payment methods
// @route   GET /api/payments/payment-methods
// @access  Private
const getPaymentMethods = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user has a Stripe customer ID
    if (!user.stripeCustomerId) {
      return res.status(200).json({
        success: true,
        paymentMethods: [],
      });
    }

    // Get payment methods
    const result = await listPaymentMethods(user.stripeCustomerId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to retrieve payment methods",
        error: result.error,
      });
    }

    res.status(200).json({
      success: true,
      paymentMethods: result.paymentMethods,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Update order status (for admin use)
// @route   PUT /api/payments/order-status
// @access  Private/Admin
const updateOrderStatus = async (req, res) => {
  try {
    const { orderId, status, trackingInfo } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({
        success: false,
        message: "Order ID and status are required",
      });
    }

    // Only admin can update order status
    if (req.userType !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized, admin only",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Update order status
    const oldStatus = order.orderStatus;
    order.orderStatus = status;

    // Add tracking information if provided
    if (trackingInfo) {
      order.trackingInfo = trackingInfo;
    }

    // Update specific fields based on status
    switch (status) {
      case 'shipped':
        order.shippedAt = Date.now();
        break;
      case 'delivered':
        order.deliveredAt = Date.now();
        break;
      case 'cancelled':
        order.cancelledAt = Date.now();
        break;
    }

    await order.save();

    // Send order status update notification to customer
    await sendOrderStatusNotification(order, status, trackingInfo);

    console.log(`[ORDER UPDATE] Order ${orderId} status updated from ${oldStatus} to ${status}`);

    res.status(200).json({
      success: true,
      message: "Order status updated successfully",
      order,
    });
  } catch (error) {
    console.error("[ORDER UPDATE] Error updating order status:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Handle Stripe webhook events
// @route   POST /api/payments/webhook
// @access  Public
const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).json({
        success: false,
        message: "Missing Stripe signature",
      });
    }

    // Debug: Check if rawBody exists and its type
    if (!req.rawBody) {
      console.error("[WEBHOOK ERROR] req.rawBody is missing. Body may have been parsed by middleware.");
      return res.status(400).json({
        success: false,
        message: "Raw body not available. Ensure webhook route skips body parsing middleware.",
      });
    }

    console.log(`[WEBHOOK DEBUG] Raw body type: ${typeof req.rawBody}, Is Buffer: ${Buffer.isBuffer(req.rawBody)}, Length: ${req.rawBody.length}`);

    const eventResult = constructEvent(
      req.rawBody, // Express raw body (should be Buffer)
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (!eventResult.success) {
      return res.status(400).json({
        success: false,
        message: "Webhook signature verification failed",
        error: eventResult.error,
      });
    }

    const event = eventResult.event;
    const result = handlePaymentEvent(event);

    console.log(`[WEBHOOK] Processing event: ${event.type}, Status: ${result.status}`);

    // Handle successful payments
    if (result.status === "succeeded") {
      const paymentIntent = result.paymentIntent;
      const metadata = paymentIntent.metadata || {};
      const orderId = metadata.orderId;
      const userId = metadata.userId;
      const taxCalculationId = metadata.taxCalculationId;

      console.log(`[WEBHOOK] Payment succeeded for order: ${orderId}, user: ${userId}, taxCalculationId: ${taxCalculationId}`);

      if (!orderId) {
        console.warn(`[WEBHOOK] No orderId in metadata — skipping order update and MLM sync. Metadata:`, JSON.stringify(metadata || {}));
      }

      if (orderId) {
        const order = await Order.findById(orderId);

        if (order && !order.isPaid) {
          console.log(`[WEBHOOK] Updating order ${orderId} to paid status`);

          // Get user details for email notifications
          const user = await User.findById(order.user);

          // Create tax transaction for compliance (after successful payment)
          if (order.stripeTaxData?.calculationId) {
            try {
              const taxTransactionResult = await createTaxTransaction(
                paymentIntent.id,
                order.stripeTaxData.calculationId
              );

              if (taxTransactionResult.success) {
                // Update order with tax transaction ID
                order.setTaxTransactionId(taxTransactionResult.transaction.id);
                console.log(`[WEBHOOK] Tax transaction created for order ${orderId}:`, {
                  transactionId: taxTransactionResult.transaction.id,
                });
              } else {
                console.error(`[WEBHOOK] Failed to create tax transaction for order ${orderId}:`, taxTransactionResult.error);
                // Don't fail the order update if tax transaction creation fails
                // Log it for manual review
              }
            } catch (taxError) {
              console.error(`[WEBHOOK] Error creating tax transaction for order ${orderId}:`, taxError);
              // Don't fail the order update if tax transaction creation fails
            }
          } else {
            console.warn(`[WEBHOOK] Order ${orderId} missing tax calculation ID, skipping tax transaction creation`);
          }

          // Update order payment information
          order.isPaid = true;
          order.paidAt = Date.now();
          order.paymentStatus = "completed";
          order.orderStatus = "processing";
          order.paymentResult = {
            paymentId: paymentIntent.id,
            status: paymentIntent.status,
            updateTime: new Date().toISOString(),
            email: paymentIntent.receipt_email,
            paymentMethod: "stripe",
            transactionFee: paymentIntent.application_fee_amount || 0,
          };

          // Tax transaction already created above
          // Tax compliance data is already in order.stripeTaxData

          // Add flag to prevent duplicate stock updates
          order.stockUpdatedByWebhook = true;

          await order.save();

          console.log(`[WEBHOOK] Order ${orderId} updated successfully with tax transaction:`, {
            taxTransactionId: order.stripeTaxData?.transactionId,
            totalTax: order.stripeTaxData?.totalTaxAmount,
          });

          // Update stock for all order items
          const stockUpdateSuccess = await updateOrderStock(order);
          
          if (stockUpdateSuccess) {
            console.log(`[WEBHOOK] Stock updated successfully for order ${orderId}`);
          } else {
            console.error(`[WEBHOOK] Failed to update stock for order ${orderId}`);
          }

          // Clear the user's cart
          if (userId) {
            const cartClearSuccess = await clearUserCart(userId);
            if (cartClearSuccess) {
              console.log(`[WEBHOOK] Cart cleared successfully for user ${userId}`);
            } else {
              console.log(`[WEBHOOK] No cart found or failed to clear cart for user ${userId}`);
            }
          }

          // Send payment confirmation and order notification emails
          if (user) {
            // Validate user has email before sending
            if (!user.email) {
              console.error(`[WEBHOOK] User ${user._id} does not have an email address, cannot send confirmation email`);
            } else {
              const emailSuccess = await sendPaymentNotifications(order, user);
              if (emailSuccess) {
                console.log(`[WEBHOOK] Payment confirmation emails sent for order ${orderId} to ${user.email}`);
              } else {
                console.error(`[WEBHOOK] Failed to send payment confirmation emails for order ${orderId} to ${user.email}`);
              }
            }
          } else {
            console.warn(`[WEBHOOK] User not found for order ${orderId}, skipping email notifications`);
          }

          // Sync order to external e-commerce system (MLM / admin.neha API)
          // Refresh order from database to ensure all fields are up-to-date
          try {
            console.log(`[WEBHOOK] Starting MLM/e-commerce sync for order ${order._id}`);
            const refreshedOrder = await Order.findById(order._id);
            if (!refreshedOrder) {
              console.error(`[WEBHOOK] Order ${order._id} not found when trying to sync`);
            } else {
              // Ensure payment status is completed before syncing
              if (refreshedOrder.paymentStatus !== 'completed' || !refreshedOrder.isPaid) {
                console.warn(`[WEBHOOK] Order ${order._id} payment status is not completed, skipping MLM sync:`, {
                  paymentStatus: refreshedOrder.paymentStatus,
                  isPaid: refreshedOrder.isPaid,
                });
              } else {
                console.log(`[WEBHOOK] Calling MLM API (admin.neha) for order ${order._id}, agent code: ${refreshedOrder.agentCode || 'none'}`);
                const syncResult = await syncOrderToEcommerce(refreshedOrder, user);
                if (syncResult.success) {
                  console.log(`[WEBHOOK] Order synced to e-commerce system for order ${order._id}:`, {
                    orderId: syncResult.orderId,
                    responseData: syncResult.data,
                    agentCode: refreshedOrder.agentCode || 'none',
                  });
                } else {
                  console.warn(`[WEBHOOK] Failed to sync order to e-commerce system for order ${order._id}:`, {
                    error: syncResult.error,
                    status: syncResult.status,
                    response: syncResult.response,
                  });
                  // Don't fail the payment process if sync fails
                }
              }
            }
          } catch (syncError) {
            console.error(`[WEBHOOK] Error syncing order to e-commerce system for order ${order._id}:`, syncError);
            // Don't fail the payment process if sync fails
          }

          // Automatically create shipment after payment confirmation
          try {
            const shipmentResult = await createShipmentAfterPayment(order, user);
            if (shipmentResult.success) {
              console.log(`[WEBHOOK] Shipment created successfully for order ${order._id}:`, {
                shipmentId: shipmentResult.shipmentId,
              });
            } else {
              console.warn(`[WEBHOOK] Auto-shipment skipped for order ${order._id}:`, shipmentResult.message);
              // Don't fail the payment process if shipment creation fails
            }
          } catch (shipmentError) {
            console.error(`[WEBHOOK] Auto-shipment error for order ${order._id}:`, shipmentError);
            // Don't fail the payment process if shipment creation fails
          }

        } else if (order && order.isPaid) {
          console.log(`[WEBHOOK] Order ${orderId} is already marked as paid, skipping update`);
        } else {
          console.error(`[WEBHOOK] Order ${orderId} not found`);
        }
      } else {
        console.warn(`[WEBHOOK] No orderId found in payment metadata`);
      }
    }

    // Handle failed payments
    if (result.status === "failed") {
      const paymentIntent = result.paymentIntent;
      const metadata = paymentIntent.metadata || {};
      const orderId = metadata.orderId;

      console.log(`[WEBHOOK] Payment failed for order: ${orderId}`);

      if (orderId) {
        const order = await Order.findById(orderId);

        if (order) {
          order.paymentStatus = "failed";
          order.paymentResult = {
            paymentId: paymentIntent.id,
            status: paymentIntent.status,
            updateTime: new Date().toISOString(),
            email: paymentIntent.receipt_email,
            paymentMethod: "stripe",
          };

          await order.save();
          console.log(`[WEBHOOK] Order ${orderId} marked as payment failed`);
        }
      }
    }

    // Handle refunds
    if (result.status === "refunded") {
      const charge = result.charge;
      const paymentIntentId = charge.payment_intent;

      console.log(`[WEBHOOK] Refund processed for payment intent: ${paymentIntentId}`);

      if (paymentIntentId) {
        const order = await Order.findOne({
          "paymentResult.paymentId": paymentIntentId,
        });

        if (order) {
          const refundAmount = charge.amount_refunded / 100; // Convert from cents

          order.paymentStatus = "refunded";
          order.refundAmount = refundAmount;
          order.refundedAt = Date.now();

          await order.save();

          // Send refund notification email
          await sendOrderStatusNotification(order, "refunded");

          console.log(`[WEBHOOK] Order ${order._id} marked as refunded with amount: $${refundAmount} (tax calculation skipped for testing)`);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("[WEBHOOK] Error processing webhook:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get all payments (admin only)
// @route   GET /api/payments/admin/all
// @access  Private/Admin
const getAllPayments = async (req, res) => {
  try {
    const pageSize = Number(req.query.pageSize) || 20;
    const page = Number(req.query.page) || 1;

    // Build filter
    const filter = {};

    // Filter by payment status
    if (req.query.paymentStatus) {
      filter.paymentStatus = req.query.paymentStatus;
    }

    // Filter by payment method
    if (req.query.paymentMethod) {
      filter['paymentResult.paymentMethod'] = req.query.paymentMethod;
    }

    // Filter by amount range
    if (req.query.minAmount || req.query.maxAmount) {
      filter.totalPrice = {};
      if (req.query.minAmount) filter.totalPrice.$gte = Number(req.query.minAmount);
      if (req.query.maxAmount) filter.totalPrice.$lte = Number(req.query.maxAmount);
    }

    // REMOVED: Tax amount filtering for testing

    // Filter by date range
    if (req.query.startDate && req.query.endDate) {
      filter.paidAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate),
      };
    }

    // Search by order ID or user email
    if (req.query.search) {
      const userIds = await User.find({
        email: { $regex: req.query.search, $options: 'i' }
      }).select('_id');

      filter.$or = [
        { invoiceNumber: { $regex: req.query.search, $options: 'i' } },
        { user: { $in: userIds.map(u => u._id) } },
        { 'paymentResult.paymentId': { $regex: req.query.search, $options: 'i' } }
      ];
    }

    const count = await Order.countDocuments({ ...filter, isPaid: true });

    // Determine sort order
    let sort = { paidAt: -1 }; // Default: newest first

    if (req.query.sort) {
      switch (req.query.sort) {
        case 'oldest':
          sort = { paidAt: 1 };
          break;
        case 'amount-high':
          sort = { totalPrice: -1 };
          break;
        case 'amount-low':
          sort = { totalPrice: 1 };
          break;
        // REMOVED: Tax sorting for testing
        case 'user':
          sort = { 'user.email': 1 };
          break;
      }
    }

    const payments = await Order.find({ ...filter, isPaid: true })
      .populate('user', 'firstName lastName email')
      .select('invoiceNumber totalPrice paymentStatus paymentResult paidAt refundAmount refundedAt user')
      .sort(sort)
      .limit(pageSize)
      .skip(pageSize * (page - 1));

    res.status(200).json({
      success: true,
      count,
      pages: Math.ceil(count / pageSize),
      page,
      payments: payments.map(payment => ({
        ...payment.toObject(),
        // REMOVED: Tax details for testing
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

// @desc    Get payment by ID (admin only)
// @route   GET /api/payments/admin/:id
// @access  Private/Admin
const getPaymentById = async (req, res) => {
  try {
    const payment = await Order.findById(req.params.id)
      .populate('user', 'firstName lastName email phone')
      .select('-__v');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    if (!payment.isPaid) {
      return res.status(400).json({
        success: false,
        message: "Order has not been paid",
      });
    }

    // REMOVED: Tax details from response (for testing)
    const response = {
      success: true,
      payment: {
        ...payment.toObject(),
        // REMOVED: Tax details for testing
      },
    };

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get payment statistics (admin only)
// @route   GET /api/payments/admin/stats
// @access  Private/Admin
const getPaymentStats = async (req, res) => {
  try {
    // Get current date ranges
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thisWeekStart = new Date();
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
    thisWeekStart.setHours(0, 0, 0, 0);

    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

    // Total payments and revenue
    const totalPayments = await Order.countDocuments({ isPaid: true });
    const totalRevenue = await Order.aggregate([
      { $match: { isPaid: true } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } },
    ]);

    // REMOVED: Tax collection statistics for testing

    // Payments by status
    const paymentsByStatus = await Order.aggregate([
      { $match: { isPaid: true } },
      { $group: { _id: "$paymentStatus", count: { $sum: 1 }, revenue: { $sum: "$totalPrice" } } },
    ]);

    // Payments by method
    const paymentsByMethod = await Order.aggregate([
      { $match: { isPaid: true } },
      { $group: { _id: "$paymentResult.paymentMethod", count: { $sum: 1 }, revenue: { $sum: "$totalPrice" } } },
    ]);

    // REMOVED: Tax by jurisdiction for testing
// Today's payments and revenue
const todayPayments = await Order.countDocuments({
  isPaid: true,
  paidAt: { $gte: today },
});

const todayRevenue = await Order.aggregate([
  { $match: { isPaid: true, paidAt: { $gte: today } } },
  { $group: { _id: null, total: { $sum: "$totalPrice" } } },
]);

// REMOVED: Today's tax collection for testing

// This week's payments and revenue
const thisWeekPayments = await Order.countDocuments({
  isPaid: true,
  paidAt: { $gte: thisWeekStart },
});

const thisWeekRevenue = await Order.aggregate([
  { $match: { isPaid: true, paidAt: { $gte: thisWeekStart } } },
  { $group: { _id: null, total: { $sum: "$totalPrice" } } },
]);

// This month's payments and revenue
const thisMonthPayments = await Order.countDocuments({
  isPaid: true,
  paidAt: { $gte: thisMonthStart },
});

const thisMonthRevenue = await Order.aggregate([
  { $match: { isPaid: true, paidAt: { $gte: thisMonthStart } } },
  { $group: { _id: null, total: { $sum: "$totalPrice" } } },
]);

// Last month's revenue for growth calculation
const lastMonthRevenue = await Order.aggregate([
  { $match: { isPaid: true, paidAt: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
  { $group: { _id: null, total: { $sum: "$totalPrice" } } },
]);

// Calculate growth percentage
const lastMonthTotal = lastMonthRevenue.length > 0 ? lastMonthRevenue[0].total : 0;
const thisMonthTotal = thisMonthRevenue.length > 0 ? thisMonthRevenue[0].total : 0;
const monthlyGrowth = lastMonthTotal > 0 
  ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal * 100).toFixed(1)
  : thisMonthTotal > 0 ? 100 : 0;

// Daily revenue for the last 30 days
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const dailyRevenue = await Order.aggregate([
  { $match: { isPaid: true, paidAt: { $gte: thirtyDaysAgo } } },
  {
    $group: {
      _id: { $dateToString: { format: "%Y-%m-%d", date: "$paidAt" } },
      payments: { $sum: 1 },
      revenue: { $sum: "$totalPrice" },
      // REMOVED: Tax data for testing
    },
  },
  { $sort: { _id: 1 } },
]);

// Average order value
const avgOrderValue = totalRevenue.length > 0 && totalPayments > 0
  ? (totalRevenue[0].total / totalPayments).toFixed(2)
  : 0;

// REMOVED: Average tax rate calculation for testing

// Refund statistics
const totalRefunds = await Order.countDocuments({ paymentStatus: "refunded" });
const totalRefundAmount = await Order.aggregate([
  { $match: { paymentStatus: "refunded" } },
  { $group: { _id: null, total: { $sum: "$refundAmount" } } },
]);

// Failed payments
const failedPayments = await Order.countDocuments({ paymentStatus: "failed" });

// REMOVED: Tax compliance statistics for testing

// Compile statistics
const stats = {
  totalPayments,
  totalRevenue: totalRevenue.length > 0 ? totalRevenue[0].total : 0,
  // REMOVED: Tax statistics for testing
  todayPayments,
  todayRevenue: todayRevenue.length > 0 ? todayRevenue[0].total : 0,
  // REMOVED: Tax statistics for testing
  thisWeekPayments,
  thisWeekRevenue: thisWeekRevenue.length > 0 ? thisWeekRevenue[0].total : 0,
  thisMonthPayments,
  thisMonthRevenue: thisMonthTotal,
  monthlyGrowth: parseFloat(monthlyGrowth),
  avgOrderValue: parseFloat(avgOrderValue),
  totalRefunds,
  totalRefundAmount: totalRefundAmount.length > 0 ? totalRefundAmount[0].total : 0,
  failedPayments,
  paymentsByStatus,
  paymentsByMethod,
  // REMOVED: Tax by jurisdiction for testing
  dailyRevenue,
  refundRate: totalPayments > 0 ? ((totalRefunds / totalPayments) * 100).toFixed(1) : 0,
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

// @desc    Export payments data (admin only)
// @route   GET /api/payments/admin/export
// @access  Private/Admin
const exportPayments = async (req, res) => {
try {
const { format = 'json', fields } = req.query;

// Build filter from query params (same as getAllPayments)
const filter = { isPaid: true };

if (req.query.paymentStatus) {
  filter.paymentStatus = req.query.paymentStatus;
}

if (req.query.paymentMethod) {
  filter['paymentResult.paymentMethod'] = req.query.paymentMethod;
}

if (req.query.minAmount || req.query.maxAmount) {
  filter.totalPrice = {};
  if (req.query.minAmount) filter.totalPrice.$gte = Number(req.query.minAmount);
  if (req.query.maxAmount) filter.totalPrice.$lte = Number(req.query.maxAmount);
}

if (req.query.startDate && req.query.endDate) {
  filter.paidAt = {
    $gte: new Date(req.query.startDate),
    $lte: new Date(req.query.endDate),
  };
}

// Determine which fields to export
let selectFields = 'invoiceNumber totalPrice paymentStatus paymentResult paidAt refundAmount refundedAt user';
if (fields) {
  selectFields = fields.split(',').join(' ');
}

const payments = await Order.find(filter)
  .populate('user', 'firstName lastName email')
  .select(selectFields)
  .sort({ paidAt: -1 });

if (format === 'csv') {
  // Convert to CSV format
  let csv = '';
  if (payments.length > 0) {
    // Flatten the data for CSV WITHOUT tax information (for testing)
    const flatData = payments.map(payment => ({
      invoiceNumber: payment.invoiceNumber,
      totalPrice: payment.totalPrice,
      // REMOVED: Tax fields for testing
      paymentStatus: payment.paymentStatus,
      paymentMethod: payment.paymentResult?.paymentMethod || '',
      paymentId: payment.paymentResult?.paymentId || '',
      paidAt: payment.paidAt ? payment.paidAt.toISOString() : '',
      refundAmount: payment.refundAmount || 0,
      refundedAt: payment.refundedAt ? payment.refundedAt.toISOString() : '',
      customerName: payment.user ? `${payment.user.firstName} ${payment.user.lastName}` : '',
      customerEmail: payment.user?.email || '',
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
  res.setHeader('Content-Disposition', `attachment; filename="payments-export-${Date.now()}.csv"`);
  res.send(csv);
} else {
  // Default JSON format WITHOUT tax details (for testing)
  res.status(200).json({
    success: true,
    count: payments.length,
    exportDate: new Date().toISOString(),
    payments: payments.map(payment => ({
      ...payment.toObject(),
      // REMOVED: Tax details for testing
    })),
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

// @desc    Search payments (admin only)
// @route   GET /api/payments/admin/search
// @access  Private/Admin
const searchPayments = async (req, res) => {
try {
const { query, type = 'all' } = req.query;

if (!query) {
  return res.status(400).json({
    success: false,
    message: "Search query is required",
  });
}

let searchFilter = { isPaid: true };

switch (type) {
  case 'email':
    const usersByEmail = await User.find({
      email: { $regex: query, $options: 'i' }
    }).select('_id');
    searchFilter.user = { $in: usersByEmail.map(u => u._id) };
    break;
  
  case 'invoice':
    searchFilter.invoiceNumber = { $regex: query, $options: 'i' };
    break;
  
  case 'payment':
    searchFilter['paymentResult.paymentId'] = { $regex: query, $options: 'i' };
    break;

  // REMOVED: Tax search for testing
  
  default:
    // Search all fields (without tax fields)
    const usersByName = await User.find({
      $or: [
        { firstName: { $regex: query, $options: 'i' } },
        { lastName: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ]
    }).select('_id');

    searchFilter.$or = [
      { invoiceNumber: { $regex: query, $options: 'i' } },
      { 'paymentResult.paymentId': { $regex: query, $options: 'i' } },
      // REMOVED: Tax search fields for testing
      { user: { $in: usersByName.map(u => u._id) } }
    ];
}

const payments = await Order.find(searchFilter)
  .populate('user', 'firstName lastName email')
  .select('invoiceNumber totalPrice paymentStatus paymentResult paidAt refundAmount user')
  .sort({ paidAt: -1 })
  .limit(50); // Limit search results

res.status(200).json({
  success: true,
  count: payments.length,
  payments: payments.map(payment => ({
    ...payment.toObject(),
    // REMOVED: Tax details for testing
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

// @desc    Get payments by date range (admin only)
// @route   GET /api/payments/admin/date-range
// @access  Private/Admin
const getPaymentsByDateRange = async (req, res) => {
try {
const { startDate, endDate, groupBy = 'day' } = req.query;

if (!startDate || !endDate) {
  return res.status(400).json({
    success: false,
    message: "Start date and end date are required",
  });
}

const start = new Date(startDate);
const end = new Date(endDate);

// Validate date range
if (start > end) {
  return res.status(400).json({
    success: false,
    message: "Start date must be before end date",
  });
}

let groupFormat;
switch (groupBy) {
  case 'hour':
    groupFormat = "%Y-%m-%d %H:00";
    break;
  case 'day':
    groupFormat = "%Y-%m-%d";
    break;
  case 'week':
    groupFormat = "%Y-%U";
    break;
  case 'month':
    groupFormat = "%Y-%m";
    break;
  default:
    groupFormat = "%Y-%m-%d";
}

const paymentsData = await Order.aggregate([
  {
    $match: {
      isPaid: true,
      paidAt: { $gte: start, $lte: end }
    }
  },
  {
    $group: {
      _id: { $dateToString: { format: groupFormat, date: "$paidAt" } },
      totalPayments: { $sum: 1 },
      totalRevenue: { $sum: "$totalPrice" },
      // REMOVED: Tax data for testing
      avgOrderValue: { $avg: "$totalPrice" },
      refunds: { $sum: { $cond: [{ $eq: ["$paymentStatus", "refunded"] }, 1, 0] } },
      refundAmount: { $sum: { $cond: [{ $eq: ["$paymentStatus", "refunded"] }, "$refundAmount", 0] } }
    }
  },
  { $sort: { _id: 1 } }
]);

res.status(200).json({
  success: true,
  dateRange: { startDate, endDate },
  groupBy,
  data: paymentsData,
});
} catch (error) {
res.status(500).json({
  success: false,
  message: "Server error",
  error: error.message,
});
}
};

// @desc    Update payment status (admin only)
// @route   PUT /api/payments/admin/:id/status
// @access  Private/Admin
const updatePaymentStatus = async (req, res) => {
try {
const { status, notes } = req.body;

if (!status) {
  return res.status(400).json({
    success: false,
    message: "Payment status is required",
  });
}

const validStatuses = ['pending', 'completed', 'failed', 'refunded', 'cancelled'];
if (!validStatuses.includes(status)) {
  return res.status(400).json({
    success: false,
    message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
  });
}

const payment = await Order.findById(req.params.id);

if (!payment) {
  return res.status(404).json({
    success: false,
    message: "Payment not found",
  });
}

if (!payment.isPaid) {
  return res.status(400).json({
    success: false,
    message: "Order has not been paid",
  });
}

const oldStatus = payment.paymentStatus;
payment.paymentStatus = status;

if (notes) {
  payment.adminNotes = payment.adminNotes 
    ? `${payment.adminNotes}\n${new Date().toISOString()}: ${notes}`
    : `${new Date().toISOString()}: ${notes}`;
}

await payment.save();

console.log(`[PAYMENT UPDATE] Payment ${payment._id} status updated from ${oldStatus} to ${status} by admin`);

res.status(200).json({
  success: true,
  message: "Payment status updated successfully",
  payment: {
    ...payment.toObject(),
    // REMOVED: Tax details for testing
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

// @desc    Bulk refund payments (admin only)
// @route   POST /api/payments/admin/bulk-refund
// @access  Private/Admin
const bulkRefundPayments = async (req, res) => {
try {
const { paymentIds, reason } = req.body;

if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
  return res.status(400).json({
    success: false,
    message: "Please provide an array of payment IDs",
  });
}

const results = {
  successful: [],
  failed: [],
  total: paymentIds.length
};

for (const paymentId of paymentIds) {
  try {
    const order = await Order.findById(paymentId);

    if (!order || !order.isPaid || !order.paymentResult?.paymentId) {
      results.failed.push({
        paymentId,
        error: "Payment not found or not eligible for refund"
      });
      continue;
    }

    if (order.paymentStatus === 'refunded') {
      results.failed.push({
        paymentId,
        error: "Payment already refunded"
      });
      continue;
    }

    // Process refund through Stripe
    const refundResult = await createRefund(
      order.paymentResult.paymentId,
      order.totalPrice
    );

    if (refundResult.success) {
      order.paymentStatus = "refunded";
      order.refundAmount = order.totalPrice;
      order.refundedAt = Date.now();
      
      if (reason) {
        order.adminNotes = order.adminNotes 
          ? `${order.adminNotes}\nBulk refund: ${reason}`
          : `Bulk refund: ${reason}`;
      }

      await order.save();

      results.successful.push({
        paymentId,
        refundAmount: order.totalPrice,
        // REMOVED: Tax refund details for testing
      });
    } else {
      results.failed.push({
        paymentId,
        error: refundResult.error
      });
    }
  } catch (error) {
    results.failed.push({
      paymentId,
      error: error.message
    });
  }
}

res.status(200).json({
  success: true,
  message: `Bulk refund completed. ${results.successful.length} successful, ${results.failed.length} failed.`,
  results,
});
} catch (error) {
res.status(500).json({
  success: false,
  message: "Server error",
  error: error.message,
});
}
};

// @desc    Get payment method statistics (admin only)
// @route   GET /api/payments/admin/payment-method-stats
// @access  Private/Admin
const getPaymentMethodStats = async (req, res) => {
try {
const { period = '30' } = req.query; // Default to last 30 days

const daysAgo = new Date();
daysAgo.setDate(daysAgo.getDate() - parseInt(period));

const stats = await Order.aggregate([
  {
    $match: {
      isPaid: true,
      paidAt: { $gte: daysAgo }
    }
  },
  {
    $group: {
      _id: "$paymentResult.paymentMethod",
      count: { $sum: 1 },
      totalRevenue: { $sum: "$totalPrice" },
      // REMOVED: Tax data for testing
      avgOrderValue: { $avg: "$totalPrice" },
      refunds: { $sum: { $cond: [{ $eq: ["$paymentStatus", "refunded"] }, 1, 0] } },
      refundAmount: { $sum: { $cond: [{ $eq: ["$paymentStatus", "refunded"] }, "$refundAmount", 0] } }
    }
  },
  {
    $addFields: {
      refundRate: { $multiply: [{ $divide: ["$refunds", "$count"] }, 100] },
      // REMOVED: Tax rate calculation for testing
    }
  },
  { $sort: { count: -1 } }
]);

res.status(200).json({
  success: true,
  period: `${period} days`,
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

// @desc    Reconcile payments with Stripe (admin only)
// @route   POST /api/payments/admin/reconcile
// @access  Private/Admin
const reconcilePayments = async (req, res) => {
try {
const { dateRange } = req.body;

if (!dateRange || !dateRange.startDate || !dateRange.endDate) {
  return res.status(400).json({
    success: false,
    message: "Date range with startDate and endDate is required",
  });
}

const startDate = new Date(dateRange.startDate);
const endDate = new Date(dateRange.endDate);

// Get all payments from database for the period
const dbPayments = await Order.find({
  isPaid: true,
  paidAt: { $gte: startDate, $lte: endDate }
}).select('paymentResult totalPrice paymentStatus paidAt');

const reconciliation = {
  totalDbPayments: dbPayments.length,
  totalDbRevenue: dbPayments.reduce((sum, p) => sum + p.totalPrice, 0),
  // REMOVED: Tax reconciliation for testing
  discrepancies: [],
  summary: {
    matched: 0,
    mismatched: 0,
    dbOnly: 0,
    stripeOnly: 0,
    // REMOVED: Tax discrepancies for testing
  }
};

// Note: In a real implementation, you would also fetch payments from Stripe
// and compare them with database records. This is a simplified version.

// For now, just validate database consistency WITHOUT tax data (for testing)
dbPayments.forEach(payment => {
  if (payment.paymentResult && payment.paymentResult.paymentId) {
    reconciliation.summary.matched++;
  } else {
    reconciliation.summary.dbOnly++;
    reconciliation.discrepancies.push({
      orderId: payment._id,
      type: 'missing_stripe_payment_id',
      message: 'Payment in database but missing Stripe payment ID',
      amount: payment.totalPrice,
      paidAt: payment.paidAt
    });
  }
});

res.status(200).json({
  success: true,
  message: "Payment reconciliation completed",
  dateRange: { startDate, endDate },
  reconciliation,
});
} catch (error) {
res.status(500).json({
  success: false,
  message: "Server error",
  error: error.message,
});
}
};

// REMOVED: Tax compliance functions for testing
// getTaxComplianceReport and markOrdersAsTaxReported functions removed

// Check Stripe Tax configuration status
const checkTaxConfig = async (req, res) => {
  try {
    console.log("[TAX CONFIG CHECK] Running Stripe Tax configuration check");

    const configStatus = await checkStripeTaxConfiguration();

    res.status(200).json({
      success: true,
      ...configStatus,
    });
  } catch (error) {
    console.error("[TAX CONFIG CHECK] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check Stripe Tax configuration",
      error: error.message,
    });
  }
};

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

// Export statement with all functions (tax compliance functions removed)
export {
createIntent,
getPaymentStatus,
processRefund,
savePaymentMethod,
getPaymentMethods,
updateOrderStatus,
handleWebhook,
// Admin operations
getAllPayments,
getPaymentById,
getPaymentStats,
exportPayments,
bulkRefundPayments,
updatePaymentStatus,
searchPayments,
getPaymentsByDateRange,
getPaymentMethodStats,
reconcilePayments,
checkTaxConfig,
// REMOVED: Tax compliance functions for testing
};