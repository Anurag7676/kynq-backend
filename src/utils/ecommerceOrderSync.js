import crypto from 'crypto';
import axios from 'axios';

/**
 * Generate HMAC-SHA256 signature for API authentication
 * @param {string} timestamp - Unix timestamp
 * @param {string} payload - JSON string of the request body
 * @param {string} secretKey - Secret key for HMAC
 * @returns {string} Hex-encoded HMAC-SHA256 signature
 */
const generateSignature = (timestamp, payload, secretKey) => {
  const message = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('hex');
  return signature;
};

/**
 * Sync order to external e-commerce system
 * @param {Object} order - Order document from database
 * @param {Object} user - User document from database
 * @returns {Promise<Object>} Result object with success status and data/error
 */
const syncOrderToEcommerce = async (order, user) => {
  try {
    // Hardcoded API credentials
    const apiKey = 'SBX_KEY_c31ec1e0d4b9498d9a1e2a2e9b6c09ba';
    const secretKey = 'SBX_SECRET_5ee6b2fdb96849619bc9e9d4aa7c02d4c4b6a0f2f6c6be83530e7d65a4c8ff3d';
    const apiUrl = 'https://mlm-admin.stylenhomes.com/api/ecommerce/orders';

    // Get agent_id from order (agent code is stored in order when order is created)
    // Agent code is optional and validated during order creation
    let agentId = null;
    if (order.agentCode) {
      agentId = order.agentCode;
      console.log('[ECOMMERCE SYNC] Using agent code from order:', agentId);
    }

    // Build order items for meta field
    const orderItems = order.orderItems.map(item => ({
      product_id: item.product?.toString() || item.product,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.price,
      total: item.price * item.quantity,
    }));

    // Prepare payload
    const payload = {
      customer_name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer',
      customer_email: user.email,
      customer_id: user._id.toString(),
      order_id: order.invoiceNumber || order._id.toString(),
      order_amount: order.subtotal, // Use subtotal (order amount without tax) for MLM API
      currency: 'USD', // Default to USD, adjust if needed
      order_date: order.paidAt ? new Date(order.paidAt).toISOString() : new Date().toISOString(),
      payment_status: mapPaymentStatus(order.paymentStatus),
      meta: {
        items: orderItems,
      },
    };

    // Add agent_id if available
    if (agentId) {
      payload.agent_id = agentId;
    }

    // Convert payload to JSON string
    const payloadString = JSON.stringify(payload);

    // Generate timestamp and signature
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = generateSignature(timestamp, payloadString, secretKey);

    console.log('[ECOMMERCE SYNC] Syncing order:', {
      orderId: payload.order_id,
      customerEmail: payload.customer_email,
      orderAmount: payload.order_amount,
      agentId: payload.agent_id || 'none',
      paymentStatus: payload.payment_status,
      orderDate: payload.order_date,
      itemsCount: payload.meta.items.length,
    });
    
    // Log full payload for debugging (remove sensitive data in production)
    console.log('[ECOMMERCE SYNC] Full payload being sent:', JSON.stringify(payload, null, 2));

    // Make API request using axios
    const response = await axios.post(apiUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
      },
      timeout: 10000, // 10 second timeout
    });

    console.log('[ECOMMERCE SYNC] Order synced successfully:', {
      orderId: payload.order_id,
      responseStatus: response.status,
      responseData: response.data,
    });

    return {
      success: true,
      data: response.data,
      orderId: payload.order_id,
    };
  } catch (error) {
    // Handle axios errors
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('[ECOMMERCE SYNC] API returned error:', {
        orderId: order.invoiceNumber || order._id.toString(),
        status: error.response.status,
        data: error.response.data,
      });
      return {
        success: false,
        error: `API returned ${error.response.status}`,
        response: error.response.data,
        status: error.response.status,
      };
    } else if (error.request) {
      // The request was made but no response was received
      console.error('[ECOMMERCE SYNC] No response received:', {
        orderId: order.invoiceNumber || order._id.toString(),
        error: error.message,
      });
      return {
        success: false,
        error: 'No response from API',
        message: error.message,
      };
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('[ECOMMERCE SYNC] Error setting up request:', {
        orderId: order.invoiceNumber || order._id.toString(),
        error: error.message,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }
};

/**
 * Map internal payment status to external API payment status
 * @param {string} internalStatus - Internal payment status
 * @returns {string} External API payment status
 */
const mapPaymentStatus = (internalStatus) => {
  const statusMap = {
    completed: 'paid',
    pending: 'pending',
    failed: 'failed',
    refunded: 'refunded',
    'partially-refunded': 'refunded',
    'refund-pending': 'pending',
  };

  return statusMap[internalStatus] || 'pending';
};

export default syncOrderToEcommerce;
export { generateSignature, mapPaymentStatus };
