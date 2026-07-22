// controllers/shipRocketController.js
import Order from "../models/orderModel.js";
import User from "../models/userModel.js";
import shipRocketService, { convertOrderToShipRocketFormat } from "../utils/shipRocketUtils.js";

// @desc    Create shipment for an order
// @route   POST /api/shipping/create-shipment
// @access  Private/Admin
const createShipment = async (req, res) => {
  try {
    const { orderId, courierId, pickupDate } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const order = await Order.findById(orderId).populate('user', 'firstName lastName email');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check if order is paid
    if (!order.isPaid) {
      return res.status(400).json({
        success: false,
        message: "Order must be paid before creating shipment",
      });
    }

    // Check if shipment already exists
    if (order.shipRocketData?.shipmentId) {
      return res.status(400).json({
        success: false,
        message: "Shipment already created for this order",
        shipmentId: order.shipRocketData.shipmentId,
      });
    }

    console.log(`[SHIPPING] Creating shipment for order ${orderId}`);

    // Convert order to ShipRocket format
    const shipRocketOrderData = convertOrderToShipRocketFormat(order, order.user);

    // Create order in ShipRocket
    const createResult = await shipRocketService.createOrder(shipRocketOrderData);

    if (!createResult.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to create shipment in ShipRocket",
        error: createResult.error,
      });
    }

    // Generate AWB if courier is selected
    let awbResult = null;
    if (courierId) {
      awbResult = await shipRocketService.generateAWB(
        createResult.shipmentId,
        courierId
      );

      if (!awbResult.success) {
        console.warn(`[SHIPPING] AWB generation failed for shipment ${createResult.shipmentId}:`, awbResult.error);
      }
    }

    // Schedule pickup if date is provided
    let pickupResult = null;
    if (pickupDate && awbResult?.success) {
      pickupResult = await shipRocketService.schedulePickup(
        createResult.shipmentId,
        pickupDate
      );
    }

    // Update order with shipping information
    order.shipRocketData = {
      shipmentId: createResult.shipmentId,
      orderId: createResult.orderId,
      awbCode: awbResult?.awbCode || null,
      courierName: awbResult?.courierName || null,
      status: 'created',
      createdAt: new Date(),
    };

    if (awbResult?.awbCode) {
      order.trackingNumber = awbResult.awbCode;
      order.trackingCompany = awbResult.courierName;
      order.orderStatus = 'processing';
    }

    await order.save();

    console.log(`[SHIPPING] Shipment created successfully for order ${orderId}:`, {
      shipmentId: createResult.shipmentId,
      awbCode: awbResult?.awbCode,
    });

    res.status(200).json({
      success: true,
      message: "Shipment created successfully",
      shipmentDetails: {
        shipmentId: createResult.shipmentId,
        orderId: createResult.orderId,
        awbCode: awbResult?.awbCode,
        courierName: awbResult?.courierName,
        pickupScheduled: !!pickupResult?.success,
      },
      order: {
        id: order._id,
        invoiceNumber: order.invoiceNumber,
        trackingNumber: order.trackingNumber,
        trackingCompany: order.trackingCompany,
        orderStatus: order.orderStatus,
      },
    });
  } catch (error) {
    console.error('[SHIPPING] Create shipment error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get shipping rates for an order
// @route   POST /api/shipping/get-rates
// @access  Private
const getShippingRates = async (req, res) => {
  try {
    const { 
      deliveryPincode, 
      weight, 
      dimensions, 
      declaredValue,
      pickupPincode 
    } = req.body;

    if (!deliveryPincode) {
      return res.status(400).json({
        success: false,
        message: "Delivery pincode is required",
      });
    }

    const rateData = {
      pickup_postcode: pickupPincode || process.env.SHIPROCKET_PICKUP_PINCODE || "110001",
      delivery_postcode: deliveryPincode,
      weight: weight || 0.5,
      length: dimensions?.length || 10,
      breadth: dimensions?.breadth || 10,
      height: dimensions?.height || 10,
      declared_value: declaredValue || 100,
    };

    console.log(`[SHIPPING] Getting rates for delivery to ${deliveryPincode}`);

    const result = await shipRocketService.getShippingRates(rateData);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to get shipping rates",
        error: result.error,
      });
    }

    res.status(200).json({
      success: true,
      serviceable: result.serviceable,
      rates: result.rates.map(courier => ({
        courierId: courier.id,
        courierName: courier.courier_name,
        rate: courier.rate,
        estimatedDeliveryDays: courier.estimated_delivery_days,
        codCharges: courier.cod_charges,
        freightCharge: courier.freight_charge,
        otherCharges: courier.other_charges,
        isRto: courier.is_rto,
        isCodAvailable: courier.cod,
        minWeight: courier.min_weight,
      })),
    });
  } catch (error) {
    console.error('[SHIPPING] Get rates error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Track shipment
// @route   GET /api/shipping/track/:identifier
// @access  Private
const trackShipment = async (req, res) => {
  try {
    const { identifier } = req.params;
    const { type = 'awb' } = req.query; // awb, orderId, or invoiceNumber

    let order;
    let awbCode;

    if (type === 'orderId') {
      order = await Order.findById(identifier).populate('user', 'firstName lastName email');
      awbCode = order?.trackingNumber;
    } else if (type === 'invoiceNumber') {
      order = await Order.findOne({ invoiceNumber: identifier }).populate('user', 'firstName lastName email');
      awbCode = order?.trackingNumber;
    } else {
      // Direct AWB tracking
      awbCode = identifier;
      order = await Order.findOne({ trackingNumber: awbCode }).populate('user', 'firstName lastName email');
    }

    if (!awbCode) {
      return res.status(404).json({
        success: false,
        message: "No tracking number found for this identifier",
      });
    }

    // Check authorization - user can only track their own orders
    if (order && req.userType !== "admin") {
      if (!order.user._id.equals(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to track this shipment",
        });
      }
    }

    console.log(`[SHIPPING] Tracking shipment with AWB: ${awbCode}`);

    const result = await shipRocketService.trackShipment(awbCode);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to track shipment",
        error: result.error,
      });
    }

    // Update order status based on tracking data if order exists
    if (order && result.trackingData) {
      const trackingStatus = result.trackingData.currentStatus?.toLowerCase();
      
      let newOrderStatus = order.orderStatus;
      
      if (trackingStatus?.includes('delivered')) {
        newOrderStatus = 'delivered';
        if (!order.isDelivered) {
          order.isDelivered = true;
          order.deliveredAt = new Date();
        }
      } else if (trackingStatus?.includes('shipped') || trackingStatus?.includes('transit')) {
        newOrderStatus = 'shipped';
      } else if (trackingStatus?.includes('picked')) {
        newOrderStatus = 'processing';
      }

      if (newOrderStatus !== order.orderStatus) {
        order.orderStatus = newOrderStatus;
        await order.save();
      }
    }

    res.status(200).json({
      success: true,
      trackingData: result.trackingData,
      orderInfo: order ? {
        orderId: order._id,
        invoiceNumber: order.invoiceNumber,
        orderStatus: order.orderStatus,
        isDelivered: order.isDelivered,
        deliveredAt: order.deliveredAt,
      } : null,
    });
  } catch (error) {
    console.error('[SHIPPING] Track shipment error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Schedule pickup for shipments
// @route   POST /api/shipping/schedule-pickup
// @access  Private/Admin
const schedulePickup = async (req, res) => {
  try {
    const { orderIds, pickupDate } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of order IDs",
      });
    }

    const orders = await Order.find({ 
      _id: { $in: orderIds },
      'shipRocketData.shipmentId': { $exists: true }
    });

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No orders found with shipments",
      });
    }

    const shipmentIds = orders.map(order => order.shipRocketData.shipmentId);

    console.log(`[SHIPPING] Scheduling pickup for shipments:`, shipmentIds);

    const result = await shipRocketService.schedulePickup(shipmentIds, pickupDate);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to schedule pickup",
        error: result.error,
      });
    }

    // Update orders with pickup information
    await Order.updateMany(
      { _id: { $in: orderIds } },
      { 
        $set: { 
          'shipRocketData.pickupScheduled': true,
          'shipRocketData.pickupDate': pickupDate || new Date(),
        }
      }
    );

    res.status(200).json({
      success: true,
      message: "Pickup scheduled successfully",
      pickupDetails: result.pickupDetails,
      affectedOrders: orders.length,
    });
  } catch (error) {
    console.error('[SHIPPING] Schedule pickup error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Cancel shipment
// @route   PUT /api/shipping/cancel/:orderId
// @access  Private/Admin
const cancelShipment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (!order.trackingNumber) {
      return res.status(400).json({
        success: false,
        message: "No shipment found for this order",
      });
    }

    console.log(`[SHIPPING] Cancelling shipment for order ${orderId}, AWB: ${order.trackingNumber}`);

    const result = await shipRocketService.cancelShipment(order.trackingNumber);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to cancel shipment",
        error: result.error,
      });
    }

    // Update order status
    order.orderStatus = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = reason || 'Shipment cancelled';
    order.shipRocketData = {
      ...order.shipRocketData,
      status: 'cancelled',
      cancelledAt: new Date(),
    };

    await order.save();

    res.status(200).json({
      success: true,
      message: "Shipment cancelled successfully",
      cancellationDetails: result.cancellationDetails,
      order: {
        id: order._id,
        invoiceNumber: order.invoiceNumber,
        orderStatus: order.orderStatus,
        cancelledAt: order.cancelledAt,
      },
    });
  } catch (error) {
    console.error('[SHIPPING] Cancel shipment error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Generate shipping label
// @route   POST /api/shipping/generate-label
// @access  Private/Admin
const generateShippingLabel = async (req, res) => {
  try {
    const { orderIds } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of order IDs",
      });
    }

    const orders = await Order.find({ 
      _id: { $in: orderIds },
      'shipRocketData.shipmentId': { $exists: true }
    });

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No orders found with shipments",
      });
    }

    const shipmentIds = orders.map(order => order.shipRocketData.shipmentId);

    console.log(`[SHIPPING] Generating labels for shipments:`, shipmentIds);

    const result = await shipRocketService.generateLabel(shipmentIds);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to generate shipping labels",
        error: result.error,
      });
    }

    res.status(200).json({
      success: true,
      message: "Shipping labels generated successfully",
      labelUrl: result.labelUrl,
      labelDetails: result.labelDetails,
      affectedOrders: orders.length,
    });
  } catch (error) {
    console.error('[SHIPPING] Generate label error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Generate shipping invoice/manifest
// @route   POST /api/shipping/generate-invoice
// @access  Private/Admin
const generateShippingInvoice = async (req, res) => {
  try {
    const { orderIds } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of order IDs",
      });
    }

    const orders = await Order.find({ 
      _id: { $in: orderIds },
      'shipRocketData.shipmentId': { $exists: true }
    });

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No orders found with shipments",
      });
    }

    const shipmentIds = orders.map(order => order.shipRocketData.shipmentId);

    console.log(`[SHIPPING] Generating invoices for shipments:`, shipmentIds);

    const result = await shipRocketService.generateInvoice(shipmentIds);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to generate shipping invoices",
        error: result.error,
      });
    }

    res.status(200).json({
      success: true,
      message: "Shipping invoices generated successfully",
      invoiceUrl: result.invoiceUrl,
      invoiceDetails: result.invoiceDetails,
      affectedOrders: orders.length,
    });
  } catch (error) {
    console.error('[SHIPPING] Generate invoice error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Create return shipment
// @route   POST /api/shipping/create-return
// @access  Private/Admin
const createReturnShipment = async (req, res) => {
  try {
    const { orderId, returnReason } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const order = await Order.findById(orderId).populate('user', 'firstName lastName email');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (!order.isDelivered) {
      return res.status(400).json({
        success: false,
        message: "Order must be delivered before creating return shipment",
      });
    }

    console.log(`[SHIPPING] Creating return shipment for order ${orderId}`);

    // Convert order to return shipment format
    const returnOrderData = {
      order_id: `RTN-${order.invoiceNumber}`,
      order_date: new Date().toISOString().split('T')[0],
      pickup_location: order.shippingAddress.city, // Customer's location becomes pickup
      comment: returnReason || "Return shipment",
      
      // Billing details (company's details for return)
      billing_customer_name: "Style N Homes",
      billing_last_name: "",
      billing_address: process.env.COMPANY_ADDRESS || "Your Company Address",
      billing_city: process.env.COMPANY_CITY || "Your City",
      billing_pincode: process.env.COMPANY_PINCODE || "110001",
      billing_state: process.env.COMPANY_STATE || "Delhi",
      billing_country: "India",
      billing_email: process.env.COMPANY_EMAIL || "info@stylenhomes.com",
      billing_phone: parseInt((process.env.COMPANY_PHONE || "9999999999").replace(/\D/g, '')) || 9999999999,
      
      // Shipping details (customer's address becomes pickup for return)
      shipping_customer_name: order.shippingAddress.fullName.split(' ')[0],
      shipping_last_name: order.shippingAddress.fullName.split(' ').slice(1).join(' '),
      shipping_address: order.shippingAddress.street,
      shipping_city: order.shippingAddress.city,
      shipping_pincode: order.shippingAddress.zipCode,
      shipping_state: (() => {
        // Simple state mapping for return orders
        const stateMapping = {
          'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
          'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
          'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
          'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
          'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
          'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
          'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
          'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
          'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
          'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
          'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
          'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
          'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
        };
        
        const state = order.shippingAddress.state;
        const mappedState = stateMapping[state] || state || 'Delhi';
        
        console.log(`[SHIPROCKET] Return order state mapping: "${state}" -> "${mappedState}"`);
        return mappedState;
      })(),
      shipping_country: (() => {
        // Simple country mapping for return orders
        const countryMapping = {
          'USA': 'United States',
          'US': 'United States',
          'United States of America': 'United States',
          'America': 'United States',
          'U.S.A.': 'United States',
          'U.S.': 'United States',
          'UK': 'United Kingdom',
          'England': 'United Kingdom',
          'Great Britain': 'United Kingdom',
          'GB': 'United Kingdom',
        };
        
        const country = order.shippingAddress.country;
        const mappedCountry = countryMapping[country] || country || 'India';
        
        console.log(`[SHIPROCKET] Return order country mapping: "${country}" -> "${mappedCountry}"`);
        return mappedCountry;
      })(),
      shipping_email: (() => {
        const email = order.user.email;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
          console.warn(`[SHIPROCKET] Invalid email format for return order: "${email}", using default`);
          return 'customer@example.com';
        }
        return email.toLowerCase().trim();
      })(),
      shipping_phone: parseInt(order.shippingAddress.phoneNumber.replace(/\D/g, '')) || 0,
      
      order_items: order.orderItems.map(item => {
        // Use 8-digit HSN code for home decor items as required by ShipRocket
        const hsnCode = 44112200; // Default for home decor items
        
        console.log(`[SHIPROCKET] Return order item HSN code:`, {
          itemName: item.name,
          hsnCode: hsnCode,
          hsnLength: hsnCode.toString().length
        });
        
        return {
          name: item.name,
          sku: item.variationSku || `PROD-${item.product}`,
          units: item.quantity,
          selling_price: item.price,
          discount: 0,
          tax: item.itemTaxAmount || 0,
          hsn: hsnCode,
        };
      }),
      
      payment_method: "Prepaid",
      sub_total: order.subtotal,
      length: 15,
      breadth: 10,
      height: 10,
      weight: 0.5,
    };

    const result = await shipRocketService.createReturnOrder(returnOrderData);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to create return shipment",
        error: result.error,
      });
    }

    // Update order with return shipment information
    order.returnShipmentData = {
      shipmentId: result.returnOrderDetails.shipment_id,
      orderId: result.returnOrderDetails.order_id,
      status: 'created',
      createdAt: new Date(),
      reason: returnReason,
    };

    order.returnRequested = true;
    order.returnStatus = 'approved';

    await order.save();

    res.status(200).json({
      success: true,
      message: "Return shipment created successfully",
      returnShipmentDetails: result.returnOrderDetails,
      order: {
        id: order._id,
        invoiceNumber: order.invoiceNumber,
        returnStatus: order.returnStatus,
      },
    });
  } catch (error) {
    console.error('[SHIPPING] Create return shipment error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// @desc    Get shipping analytics/dashboard
// @route   GET /api/shipping/analytics
// @access  Private/Admin
const getShippingAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Build date filter
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    } else {
      // Default to last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      dateFilter.createdAt = { $gte: thirtyDaysAgo };
    }

    // Get shipping statistics
    const totalShipments = await Order.countDocuments({
      ...dateFilter,
      'shipRocketData.shipmentId': { $exists: true }
    });

    const deliveredShipments = await Order.countDocuments({
      ...dateFilter,
      orderStatus: 'delivered'
    });

    const shippedShipments = await Order.countDocuments({
      ...dateFilter,
      orderStatus: 'shipped'
    });

    const cancelledShipments = await Order.countDocuments({
      ...dateFilter,
      orderStatus: 'cancelled',
      'shipRocketData.shipmentId': { $exists: true }
    });

    // Shipments by status
    const shipmentsByStatus = await Order.aggregate([
      { $match: { ...dateFilter, 'shipRocketData.shipmentId': { $exists: true } } },
      { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
    ]);

    // Shipments by courier
    const shipmentsByCourier = await Order.aggregate([
      { $match: { ...dateFilter, trackingCompany: { $exists: true, $ne: null } } },
      { $group: { _id: "$trackingCompany", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Average delivery time
    const avgDeliveryTime = await Order.aggregate([
      { 
        $match: { 
          ...dateFilter, 
          orderStatus: 'delivered',
          deliveredAt: { $exists: true },
          'shipRocketData.createdAt': { $exists: true }
        } 
      },
      {
        $project: {
          deliveryDays: {
            $divide: [
              { $subtract: ["$deliveredAt", "$shipRocketData.createdAt"] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgDeliveryDays: { $avg: "$deliveryDays" },
          minDeliveryDays: { $min: "$deliveryDays" },
          maxDeliveryDays: { $max: "$deliveryDays" }
        }
      }
    ]);

    const analytics = {
      totalShipments,
      deliveredShipments,
      shippedShipments,
      cancelledShipments,
      deliveryRate: totalShipments > 0 ? ((deliveredShipments / totalShipments) * 100).toFixed(1) : 0,
      cancellationRate: totalShipments > 0 ? ((cancelledShipments / totalShipments) * 100).toFixed(1) : 0,
      shipmentsByStatus,
      shipmentsByCourier,
      avgDeliveryTime: avgDeliveryTime.length > 0 ? {
        avg: Math.round(avgDeliveryTime[0].avgDeliveryDays * 10) / 10,
        min: Math.round(avgDeliveryTime[0].minDeliveryDays * 10) / 10,
        max: Math.round(avgDeliveryTime[0].maxDeliveryDays * 10) / 10,
      } : null,
    };

    res.status(200).json({
      success: true,
      analytics,
      dateRange: { startDate, endDate },
    });
  } catch (error) {
    console.error('[SHIPPING] Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export {
  createShipment,
  getShippingRates,
  trackShipment,
  schedulePickup,
  cancelShipment,
  generateShippingLabel,
  generateShippingInvoice,
  createReturnShipment,
  getShippingAnalytics,
};