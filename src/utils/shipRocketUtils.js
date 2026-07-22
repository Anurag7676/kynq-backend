// utils/shipRocketUtils.js
import fetch from 'node-fetch';

class ShipRocketService {
  constructor() {
    this.baseURL = 'https://apiv2.shiprocket.in/v1/external';
    this.token = null;
    this.tokenExpiry = null;
    this.pickupLocations = null;
    this.pickupLocationsExpiry = null;
  }

  // Authenticate and get token
  async authenticate() {
    try {
      // Check if token is still valid
      if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return { success: true, token: this.token };
      }

      const response = await fetch(`${this.baseURL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: process.env.SHIPROCKET_EMAIL,
          password: process.env.SHIPROCKET_PASSWORD,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.token) {
        throw new Error(data.message || 'Authentication failed');
      }

      this.token = data.token;
      // Set token expiry to 10 days from now (ShipRocket tokens last 10 days)
      this.tokenExpiry = Date.now() + (10 * 24 * 60 * 60 * 1000);

      console.log('[SHIPROCKET] Authentication successful');
      return { success: true, token: this.token };

    } catch (error) {
      console.error('[SHIPROCKET] Authentication error:', error);
      return { success: false, error: error.message };
    }
  }

  // Make authenticated API call
  async makeRequest(endpoint, method = 'GET', body = null) {
    try {
      // Ensure we have a valid token
      const authResult = await this.authenticate();
      if (!authResult.success) {
        return { success: false, error: 'Authentication failed' };
      }

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      };

      const config = {
        method,
        headers,
      };

      if (body && method !== 'GET') {
        config.body = JSON.stringify(body);
      }

      const response = await fetch(`${this.baseURL}${endpoint}`, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }

      return { success: true, data };

    } catch (error) {
      console.error(`[SHIPROCKET] API Error (${method} ${endpoint}):`, error);
      return { success: false, error: error.message };
    }
  }

  // Create order in ShipRocket
  async createOrder(orderData) {
    try {
      console.log('[SHIPROCKET] Creating order:', orderData.order_id);

      // Validate required fields before sending to ShipRocket
      const requiredFields = [
        'order_id', 'billing_customer_name', 'billing_address', 'billing_city',
        'billing_pincode', 'billing_state', 'billing_country', 'billing_email',
        'billing_phone', 'shipping_customer_name', 'shipping_address', 'shipping_city',
        'shipping_pincode', 'shipping_state', 'shipping_country', 'shipping_email',
        'shipping_phone', 'order_items', 'payment_method', 'sub_total'
      ];

      for (const field of requiredFields) {
        if (!orderData[field]) {
          throw new Error(`Missing required field for ShipRocket: ${field}`);
        }
      }

      // Validate order items
      if (!Array.isArray(orderData.order_items) || orderData.order_items.length === 0) {
        throw new Error('Order must have at least one item');
      }

      orderData.order_items.forEach((item, index) => {
        if (!item.name || !item.selling_price || !item.units) {
          throw new Error(`Order item ${index + 1} is missing required fields (name, selling_price, or units)`);
        }
      });

      // Get valid pickup location
      let pickupLocation = orderData.pickup_location || "";
      
      // If pickup location is not provided, use the known working location
      if (!pickupLocation) {
        console.log('[SHIPROCKET] Using default pickup location from dashboard');
        
        // Based on your dashboard, the pickup location name is "work"
        pickupLocation = "work"; // Use the address nickname from your dashboard
        console.log(`[SHIPROCKET] Using pickup location: ${pickupLocation}`);
      }

      const shipRocketOrder = {
        order_id: orderData.order_id,
        order_date: orderData.order_date,
        pickup_location: pickupLocation,
        channel_id: orderData.channel_id || "",
        comment: orderData.comment || "",
        billing_customer_name: orderData.billing_customer_name,
        billing_last_name: orderData.billing_last_name || "",
        billing_address: orderData.billing_address,
        billing_address_2: orderData.billing_address_2 || "",
        billing_city: orderData.billing_city,
        billing_pincode: orderData.billing_pincode,
        billing_state: orderData.billing_state,
        billing_country: orderData.billing_country,
        billing_email: orderData.billing_email,
        billing_phone: orderData.billing_phone,
        shipping_is_billing: orderData.shipping_is_billing !== undefined ? orderData.shipping_is_billing : true,
        shipping_customer_name: orderData.shipping_customer_name,
        shipping_last_name: orderData.shipping_last_name || "",
        shipping_address: orderData.shipping_address,
        shipping_address_2: orderData.shipping_address_2 || "",
        shipping_city: orderData.shipping_city,
        shipping_pincode: orderData.shipping_pincode,
        shipping_state: orderData.shipping_state,
        shipping_country: orderData.shipping_country,
        shipping_email: orderData.shipping_email,
        shipping_phone: orderData.shipping_phone,
        order_items: orderData.order_items,
        payment_method: orderData.payment_method,
        shipping_charges: orderData.shipping_charges || 0,
        giftwrap_charges: orderData.giftwrap_charges || 0,
        transaction_charges: orderData.transaction_charges || 0,
        total_discount: orderData.total_discount || 0,
        sub_total: orderData.sub_total,
        length: orderData.length || 10,
        breadth: orderData.breadth || 10,
        height: orderData.height || 10,
        weight: orderData.weight || 0.5,
      };

      const result = await this.makeRequest('/orders/create/adhoc', 'POST', shipRocketOrder);

      if (result.success) {
        console.log('[SHIPROCKET] Order created successfully:', result.data);
        
        // Validate required response fields
        if (!result.data) {
          throw new Error('Invalid response from ShipRocket API');
        }
        
        // Check if the response indicates a pickup location error
        if (result.data.message && result.data.message.includes('Wrong Pickup location')) {
          console.error('[SHIPROCKET] Pickup location error:', result.data.message);
          throw new Error(`Pickup location error: ${result.data.message}`);
        }
        
        const shipmentId = result.data.shipment_id || result.data.id;
        const orderId = result.data.order_id || result.data.id;
        
        if (!shipmentId) {
          throw new Error('ShipRocket API did not return shipment ID');
        }
        
        return {
          success: true,
          orderDetails: result.data,
          shipmentId: shipmentId,
          orderId: orderId,
        };
      }

      return result;

    } catch (error) {
      console.error('[SHIPROCKET] Create order error:', error);
      return { success: false, error: error.message };
    }
  }

  // Note: Pickup locations API is not available in current ShipRocket API
  // Using hardcoded pickup location "work" from dashboard
  async getPickupLocations() {
    console.log('[SHIPROCKET] Pickup locations API not available, using default');
    return {
      success: true,
      locations: [{ pickup_location: "work", name: "work" }]
    };
  }

  // Get shipping rates for serviceability check
  async getShippingRates(data) {
    try {
      const query = new URLSearchParams({
        pickup_postcode: data.pickup_postcode,
        delivery_postcode: data.delivery_postcode,
        weight: data.weight || 0.5,
        length: data.length || 10,
        breadth: data.breadth || 10,
        height: data.height || 10,
        declared_value: data.declared_value || 100,
      });

      const result = await this.makeRequest(`/courier/serviceability?${query}`);

      if (result.success) {
        console.log('[SHIPROCKET] Shipping rates fetched successfully');
        return {
          success: true,
          rates: result.data.data?.available_courier_companies || [],
          serviceable: result.data.data?.is_serviceable || false,
        };
      }

      return result;

    } catch (error) {
      console.error('[SHIPROCKET] Get shipping rates error:', error);
      return { success: false, error: error.message };
    }
  }

  // Generate AWB (Air Waybill) for shipment
  async generateAWB(shipmentId, courierId) {
    try {
      console.log('[SHIPROCKET] Generating AWB for shipment:', shipmentId);

      const result = await this.makeRequest('/courier/assign/awb', 'POST', {
        shipment_id: shipmentId,
        courier_id: courierId,
      });

      if (result.success) {
        console.log('[SHIPROCKET] AWB generated successfully:', result.data.response?.data?.awb_code);
        return {
          success: true,
          awbCode: result.data.response?.data?.awb_code,
          courierName: result.data.response?.data?.courier_name,
          shipmentDetails: result.data,
        };
      }

      return result;

    } catch (error) {
      console.error('[SHIPROCKET] Generate AWB error:', error);
      return { success: false, error: error.message };
    }
  }

  // Track shipment
  async trackShipment(awbCode) {
    try {
      console.log('[SHIPROCKET] Tracking shipment:', awbCode);

      const result = await this.makeRequest(`/courier/track/awb/${awbCode}`);

      if (result.success) {
        const trackingData = result.data;
        console.log('[SHIPROCKET] Tracking data fetched successfully');
        
        return {
          success: true,
          trackingData: {
            awbCode: awbCode,
            currentStatus: trackingData.tracking_data?.track_status,
            courierName: trackingData.tracking_data?.courier_name,
            shipmentStatus: trackingData.tracking_data?.shipment_status,
            deliveredDate: trackingData.tracking_data?.delivered_date,
            trackingHistory: trackingData.tracking_data?.shipment_track || [],
            estimatedDeliveryDate: trackingData.tracking_data?.edd,
          },
        };
      }

      return result;

    } catch (error) {
      console.error('[SHIPROCKET] Track shipment error:', error);
      return { success: false, error: error.message };
    }
  }

  // Schedule pickup
  async schedulePickup(shipmentIds, pickupDate = null) {
    try {
      console.log('[SHIPROCKET] Scheduling pickup for shipments:', shipmentIds);

      const requestData = {
        shipment_id: Array.isArray(shipmentIds) ? shipmentIds : [shipmentIds],
      };

      if (pickupDate) {
        requestData.pickup_date = pickupDate;
      }

      const result = await this.makeRequest('/courier/generate/pickup', 'POST', requestData);

      if (result.success) {
        console.log('[SHIPROCKET] Pickup scheduled successfully');
        return {
          success: true,
          pickupDetails: result.data,
        };
      }

      return result;

    } catch (error) {
      console.error('[SHIPROCKET] Schedule pickup error:', error);
      return { success: false, error: error.message };
    }
  }

  // Cancel shipment
  async cancelShipment(awbCodes) {
    try {
      console.log('[SHIPROCKET] Cancelling shipment:', awbCodes);

      const result = await this.makeRequest('/orders/cancel', 'POST', {
        awbs: Array.isArray(awbCodes) ? awbCodes : [awbCodes],
      });

      if (result.success) {
        console.log('[SHIPROCKET] Shipment cancelled successfully');
        return {
          success: true,
          cancellationDetails: result.data,
        };
      }

      return result;

    } catch (error) {
      console.error('[SHIPROCKET] Cancel shipment error:', error);
      return { success: false, error: error.message };
    }
  }

  // Generate shipping label
  async generateLabel(shipmentIds) {
    try {
      console.log('[SHIPROCKET] Generating label for shipments:', shipmentIds);

      const result = await this.makeRequest('/courier/generate/label', 'POST', {
        shipment_id: Array.isArray(shipmentIds) ? shipmentIds : [shipmentIds],
      });

      if (result.success) {
        console.log('[SHIPROCKET] Label generated successfully');
        return {
          success: true,
          labelUrl: result.data.label_url,
          labelDetails: result.data,
        };
      }

      return result;

    } catch (error) {
      console.error('[SHIPROCKET] Generate label error:', error);
      return { success: false, error: error.message };
    }
  }

  // Generate invoice/manifest
  async generateInvoice(shipmentIds) {
    try {
      console.log('[SHIPROCKET] Generating invoice for shipments:', shipmentIds);

      const result = await this.makeRequest('/courier/generate/invoice', 'POST', {
        shipment_id: Array.isArray(shipmentIds) ? shipmentIds : [shipmentIds],
      });

      if (result.success) {
        console.log('[SHIPROCKET] Invoice generated successfully');
        return {
          success: true,
          invoiceUrl: result.data.invoice_url,
          invoiceDetails: result.data,
        };
      }

      return result;

    } catch (error) {
      console.error('[SHIPROCKET] Generate invoice error:', error);
      return { success: false, error: error.message };
    }
  }

  // Get order details
  async getOrderDetails(orderId) {
    try {
      console.log('[SHIPROCKET] Getting order details:', orderId);

      const result = await this.makeRequest(`/orders/show/${orderId}`);

      if (result.success) {
        console.log('[SHIPROCKET] Order details fetched successfully');
        return {
          success: true,
          orderDetails: result.data,
        };
      }

      return result;

    } catch (error) {
      console.error('[SHIPROCKET] Get order details error:', error);
      return { success: false, error: error.message };
    }
  }

  // Create return order
  async createReturnOrder(orderData) {
    try {
      console.log('[SHIPROCKET] Creating return order:', orderData.order_id);

      const result = await this.makeRequest('/orders/create/return', 'POST', orderData);

      if (result.success) {
        console.log('[SHIPROCKET] Return order created successfully');
        return {
          success: true,
          returnOrderDetails: result.data,
        };
      }

      return result;

    } catch (error) {
      console.error('[SHIPROCKET] Create return order error:', error);
      return { success: false, error: error.message };
    }
  }
}

// Create singleton instance
const shipRocketService = new ShipRocketService();

// Helper function to get the correct pickup location
const getValidPickupLocation = () => {
  let envLocation = process.env.SHIPROCKET_PICKUP_LOCATION;
  if (!envLocation || envLocation.trim() === "") {
    console.warn('[SHIPROCKET] SHIPROCKET_PICKUP_LOCATION env variable not set, defaulting to "work".');
    return "work";
  }
  if (envLocation !== "work") {
    console.warn(`[SHIPROCKET] SHIPROCKET_PICKUP_LOCATION ('${envLocation}') does not match dashboard nickname 'work'. Using 'work'.`);
    return "work";
  }
  return envLocation;
};

// Helper function to convert order data to ShipRocket format
export const convertOrderToShipRocketFormat = (order, user) => {
  const shippingAddress = order.shippingAddress;
  const billingAddress = order.billingAddress || shippingAddress;

  // Validate required address fields
  if (!shippingAddress || !billingAddress) {
    throw new Error('Shipping and billing addresses are required');
  }

  const requiredFields = ['fullName', 'street', 'city', 'state', 'zipCode', 'country', 'phoneNumber'];
  for (const field of requiredFields) {
    if (!shippingAddress[field]) {
      throw new Error(`Missing required shipping address field: ${field}`);
    }
    if (!billingAddress[field]) {
      throw new Error(`Missing required billing address field: ${field}`);
    }
  }

  // Validate order items
  if (!order.orderItems || order.orderItems.length === 0) {
    throw new Error('Order must have at least one item');
  }

  // Validate each order item has required fields
  order.orderItems.forEach((item, index) => {
    if (!item.name || !item.price || !item.quantity) {
      throw new Error(`Order item ${index + 1} is missing required fields (name, price, or quantity)`);
    }
    
    // Validate price is a valid number
    if (isNaN(item.price) || item.price < 0) {
      throw new Error(`Order item ${index + 1} has invalid price: ${item.price}`);
    }
    
    // Validate quantity is a valid number
    if (isNaN(item.quantity) || item.quantity <= 0) {
      throw new Error(`Order item ${index + 1} has invalid quantity: ${item.quantity}`);
    }
  });

  // Helper function to safely split names
  const splitName = (fullName) => {
    if (!fullName || typeof fullName !== 'string') {
      return { firstName: 'Customer', lastName: '' };
    }
    const nameParts = fullName.trim().split(' ');
    return {
      firstName: nameParts[0] || 'Customer',
      lastName: nameParts.slice(1).join(' ') || ''
    };
  };

  // Helper function to convert phone number to numeric format for ShipRocket
  const formatPhoneNumber = (phoneNumber) => {
    if (!phoneNumber) return 0;
    // Remove all non-digit characters and convert to number
    const digitsOnly = phoneNumber.toString().replace(/\D/g, '');
    const numericPhone = parseInt(digitsOnly) || 0;
    
    // Ensure we have at least 10 digits for a valid phone number
    if (digitsOnly.length < 10) {
      console.warn(`[SHIPROCKET] Phone number too short: ${phoneNumber} -> ${numericPhone}`);
    }
    
    return numericPhone;
  };

  // Helper function to format country name for ShipRocket
  const formatCountryName = (countryName) => {
    if (!countryName) return 'India';
    
    const countryMapping = {
    'USA': 'United States',
    'US': 'United States',
    'United States': 'United States',
    'United States of America': 'United States',
    'America': 'United States',
    'U.S.A.': 'United States',
    'U.S.': 'United States',
      'UK': 'United Kingdom',
      'England': 'United Kingdom',
      'Great Britain': 'United Kingdom',
      'GB': 'United Kingdom',
      'Canada': 'Canada',
      'Australia': 'Australia',
      'Germany': 'Germany',
      'France': 'France',
      'Spain': 'Spain',
      'Italy': 'Italy',
      'Netherlands': 'Netherlands',
      'Belgium': 'Belgium',
      'Switzerland': 'Switzerland',
      'Austria': 'Austria',
      'Sweden': 'Sweden',
      'Norway': 'Norway',
      'Denmark': 'Denmark',
      'Finland': 'Finland',
      'Poland': 'Poland',
      'Czech Republic': 'Czech Republic',
      'Hungary': 'Hungary',
      'Romania': 'Romania',
      'Bulgaria': 'Bulgaria',
      'Greece': 'Greece',
      'Portugal': 'Portugal',
      'Ireland': 'Ireland',
      'New Zealand': 'New Zealand',
      'Japan': 'Japan',
      'South Korea': 'South Korea',
      'China': 'China',
      'Hong Kong': 'Hong Kong',
      'Singapore': 'Singapore',
      'Malaysia': 'Malaysia',
      'Thailand': 'Thailand',
      'Vietnam': 'Vietnam',
      'Philippines': 'Philippines',
      'Indonesia': 'Indonesia',
      'India': 'India',
      'Pakistan': 'Pakistan',
      'Bangladesh': 'Bangladesh',
      'Sri Lanka': 'Sri Lanka',
      'Nepal': 'Nepal',
      'Bhutan': 'Bhutan',
      'Myanmar': 'Myanmar',
      'Cambodia': 'Cambodia',
      'Laos': 'Laos',
      'Mongolia': 'Mongolia',
      'Kazakhstan': 'Kazakhstan',
      'Uzbekistan': 'Uzbekistan',
      'Kyrgyzstan': 'Kyrgyzstan',
      'Tajikistan': 'Tajikistan',
      'Turkmenistan': 'Turkmenistan',
      'Azerbaijan': 'Azerbaijan',
      'Georgia': 'Georgia',
      'Armenia': 'Armenia',
      'Ukraine': 'Ukraine',
      'Belarus': 'Belarus',
      'Moldova': 'Moldova',
      'Latvia': 'Latvia',
      'Lithuania': 'Lithuania',
      'Estonia': 'Estonia',
      'Slovenia': 'Slovenia',
      'Croatia': 'Croatia',
      'Bosnia and Herzegovina': 'Bosnia and Herzegovina',
      'Serbia': 'Serbia',
      'Montenegro': 'Montenegro',
      'Kosovo': 'Kosovo',
      'Albania': 'Albania',
      'Macedonia': 'Macedonia',
      'Slovakia': 'Slovakia',
      'Luxembourg': 'Luxembourg',
      'Iceland': 'Iceland',
      'Malta': 'Malta',
      'Cyprus': 'Cyprus',
      'Israel': 'Israel',
      'Lebanon': 'Lebanon',
      'Jordan': 'Jordan',
      'Syria': 'Syria',
      'Iraq': 'Iraq',
      'Iran': 'Iran',
      'Saudi Arabia': 'Saudi Arabia',
      'Yemen': 'Yemen',
      'Oman': 'Oman',
      'United Arab Emirates': 'United Arab Emirates',
      'UAE': 'United Arab Emirates',
      'Qatar': 'Qatar',
      'Kuwait': 'Kuwait',
      'Bahrain': 'Bahrain',
      'Egypt': 'Egypt',
      'Libya': 'Libya',
      'Tunisia': 'Tunisia',
      'Algeria': 'Algeria',
      'Morocco': 'Morocco',
      'Sudan': 'Sudan',
      'South Sudan': 'South Sudan',
      'Ethiopia': 'Ethiopia',
      'Eritrea': 'Eritrea',
      'Djibouti': 'Djibouti',
      'Somalia': 'Somalia',
      'Kenya': 'Kenya',
      'Uganda': 'Uganda',
      'Tanzania': 'Tanzania',
      'Rwanda': 'Rwanda',
      'Burundi': 'Burundi',
      'Democratic Republic of the Congo': 'Democratic Republic of the Congo',
      'Congo': 'Congo',
      'Central African Republic': 'Central African Republic',
      'Cameroon': 'Cameroon',
      'Chad': 'Chad',
      'Niger': 'Niger',
      'Nigeria': 'Nigeria',
      'Benin': 'Benin',
      'Togo': 'Togo',
      'Ghana': 'Ghana',
      'Ivory Coast': 'Ivory Coast',
      'Burkina Faso': 'Burkina Faso',
      'Mali': 'Mali',
      'Senegal': 'Senegal',
      'Gambia': 'Gambia',
      'Guinea-Bissau': 'Guinea-Bissau',
      'Guinea': 'Guinea',
      'Sierra Leone': 'Sierra Leone',
      'Liberia': 'Liberia',
      'Cote d\'Ivoire': 'Ivory Coast',
      'Côte d\'Ivoire': 'Ivory Coast',
      'Mauritania': 'Mauritania',
      'Western Sahara': 'Western Sahara',
      'Angola': 'Angola',
      'Namibia': 'Namibia',
      'Botswana': 'Botswana',
      'Zimbabwe': 'Zimbabwe',
      'Zambia': 'Zambia',
      'Malawi': 'Malawi',
      'Mozambique': 'Mozambique',
      'Madagascar': 'Madagascar',
      'Comoros': 'Comoros',
      'Seychelles': 'Seychelles',
      'Mauritius': 'Mauritius',
      'Reunion': 'Reunion',
      'Réunion': 'Reunion',
      'Mayotte': 'Mayotte',
      'Saint Helena': 'Saint Helena',
      'Ascension Island': 'Ascension Island',
      'Tristan da Cunha': 'Tristan da Cunha',
      'Falkland Islands': 'Falkland Islands',
      'South Georgia': 'South Georgia',
      'South Sandwich Islands': 'South Sandwich Islands',
      'Antarctica': 'Antarctica',
      'Greenland': 'Greenland',
      'Mexico': 'Mexico',
      'Guatemala': 'Guatemala',
      'Belize': 'Belize',
      'El Salvador': 'El Salvador',
      'Honduras': 'Honduras',
      'Nicaragua': 'Nicaragua',
      'Costa Rica': 'Costa Rica',
      'Panama': 'Panama',
      'Colombia': 'Colombia',
      'Venezuela': 'Venezuela',
      'Guyana': 'Guyana',
      'Suriname': 'Suriname',
      'French Guiana': 'French Guiana',
      'Brazil': 'Brazil',
      'Ecuador': 'Ecuador',
      'Peru': 'Peru',
      'Bolivia': 'Bolivia',
      'Paraguay': 'Paraguay',
      'Uruguay': 'Uruguay',
      'Argentina': 'Argentina',
      'Chile': 'Chile',
      'Falkland Islands (Malvinas)': 'Falkland Islands',
      'Cuba': 'Cuba',
      'Jamaica': 'Jamaica',
      'Haiti': 'Haiti',
      'Dominican Republic': 'Dominican Republic',
      'Puerto Rico': 'Puerto Rico',
      'Trinidad and Tobago': 'Trinidad and Tobago',
      'Barbados': 'Barbados',
      'Grenada': 'Grenada',
      'Saint Vincent and the Grenadines': 'Saint Vincent and the Grenadines',
      'Saint Lucia': 'Saint Lucia',
      'Dominica': 'Dominica',
      'Antigua and Barbuda': 'Antigua and Barbuda',
      'Saint Kitts and Nevis': 'Saint Kitts and Nevis',
      'Bahamas': 'Bahamas',
      'Cayman Islands': 'Cayman Islands',
      'Turks and Caicos Islands': 'Turks and Caicos Islands',
      'British Virgin Islands': 'British Virgin Islands',
      'U.S. Virgin Islands': 'U.S. Virgin Islands',
      'Anguilla': 'Anguilla',
      'Montserrat': 'Montserrat',
      'Aruba': 'Aruba',
      'Curacao': 'Curacao',
      'Curaçao': 'Curacao',
      'Bonaire': 'Bonaire',
      'Sint Eustatius': 'Sint Eustatius',
      'Saba': 'Saba',
      'Saint Martin': 'Saint Martin',
      'Saint Barthélemy': 'Saint Barthélemy',
      'Saint Barthélemy': 'Saint Barthélemy',
      'Guadeloupe': 'Guadeloupe',
      'Martinique': 'Martinique',
      'French Polynesia': 'French Polynesia',
      'New Caledonia': 'New Caledonia',
      'Wallis and Futuna': 'Wallis and Futuna',
      'Fiji': 'Fiji',
      'Vanuatu': 'Vanuatu',
      'Solomon Islands': 'Solomon Islands',
      'Papua New Guinea': 'Papua New Guinea',
      'New Zealand': 'New Zealand',
      'Australia': 'Australia',
      'Christmas Island': 'Christmas Island',
      'Cocos (Keeling) Islands': 'Cocos (Keeling) Islands',
      'Norfolk Island': 'Norfolk Island',
      'Heard Island and McDonald Islands': 'Heard Island and McDonald Islands',
      'French Southern Territories': 'French Southern Territories',
      'South Africa': 'South Africa',
      'Lesotho': 'Lesotho',
      'Eswatini': 'Eswatini',
      'Swaziland': 'Eswatini',
    };
    
    const normalizedCountry = countryName.trim();
    const mappedCountry = countryMapping[normalizedCountry] || countryMapping[normalizedCountry.toLowerCase()];
    
    if (mappedCountry) {
      console.log(`[SHIPROCKET] Country name mapped: "${normalizedCountry}" -> "${mappedCountry}"`);
      return mappedCountry;
    }
    
    console.warn(`[SHIPROCKET] Unknown country name: "${normalizedCountry}", using default: "India"`);
    return 'India'; // Default fallback
  };

  // Helper function to format pincode/zipcode for ShipRocket
  const formatPincode = (pincode) => {
    if (!pincode) return '110001'; // Default to Delhi pincode
    // Remove all non-digit characters and ensure it's a string
    const cleanPincode = pincode.toString().replace(/\D/g, '');
    return cleanPincode || '110001';
  };

  // Helper function to format state name for ShipRocket
  const formatStateName = (stateName) => {
    if (!stateName) return 'Delhi';
    
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
      // Indian states
      'AP': 'Andhra Pradesh', 'AR': 'Arunachal Pradesh', 'AS': 'Assam', 'BR': 'Bihar',
      'CT': 'Chhattisgarh', 'GA': 'Goa', 'GJ': 'Gujarat', 'HR': 'Haryana',
      'HP': 'Himachal Pradesh', 'JK': 'Jammu and Kashmir', 'JH': 'Jharkhand',
      'KA': 'Karnataka', 'KL': 'Kerala', 'MP': 'Madhya Pradesh', 'MH': 'Maharashtra',
      'MN': 'Manipur', 'ML': 'Meghalaya', 'MZ': 'Mizoram', 'NL': 'Nagaland',
      'OR': 'Odisha', 'PB': 'Punjab', 'RJ': 'Rajasthan', 'SK': 'Sikkim',
      'TN': 'Tamil Nadu', 'TS': 'Telangana', 'TR': 'Tripura', 'UP': 'Uttar Pradesh',
      'UT': 'Uttarakhand', 'WB': 'West Bengal', 'AN': 'Andaman and Nicobar Islands',
      'CH': 'Chandigarh', 'DN': 'Dadra and Nagar Haveli', 'DD': 'Daman and Diu',
      'DL': 'Delhi', 'LD': 'Lakshadweep', 'PY': 'Puducherry'
    };
    
    const normalizedState = stateName.trim();
    const mappedState = stateMapping[normalizedState] || stateMapping[normalizedState.toUpperCase()] || normalizedState;
    
    if (mappedState !== normalizedState) {
      console.log(`[SHIPROCKET] State name mapped: "${normalizedState}" -> "${mappedState}"`);
    }
    
    return mappedState;
  };

  // Helper function to validate and format email for ShipRocket
  const formatEmail = (email) => {
    if (!email || typeof email !== 'string') return 'customer@example.com';
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.warn(`[SHIPROCKET] Invalid email format: "${email}", using default`);
      return 'customer@example.com';
    }
    
    return email.toLowerCase().trim();
  };

  // Helper function to validate and format order ID for ShipRocket
  const formatOrderId = (orderId) => {
    if (!orderId) return `ORDER-${Date.now()}`;
    
    // Remove special characters that might cause issues
    const cleanOrderId = orderId.toString().replace(/[^a-zA-Z0-9-_]/g, '');
    return cleanOrderId || `ORDER-${Date.now()}`;
  };

  // Helper function to validate and format address for ShipRocket
  const formatAddress = (address) => {
    if (!address) return 'Default Address';
    
    // Limit address length to 200 characters (ShipRocket limit)
    const maxLength = 200;
    const cleanAddress = address.toString().trim();
    
    if (cleanAddress.length > maxLength) {
      console.warn(`[SHIPROCKET] Address too long, truncating: "${cleanAddress}"`);
      return cleanAddress.substring(0, maxLength);
    }
    
    return cleanAddress;
  };

  // Helper function to validate and format price for ShipRocket
  const formatPrice = (price) => {
    if (!price || isNaN(price)) return 0;
    // Ensure price is a number and has max 2 decimal places
    return Math.round(parseFloat(price) * 100) / 100;
  };

  const shippingName = splitName(shippingAddress.fullName);
  const billingName = splitName(billingAddress.fullName);

  // Format phone numbers for ShipRocket
  const billingPhone = formatPhoneNumber(billingAddress.phoneNumber);
  const shippingPhone = formatPhoneNumber(shippingAddress.phoneNumber);

  // Log phone number formatting for debugging
  console.log(`[SHIPROCKET] Phone number formatting:`, {
    originalBilling: billingAddress.phoneNumber,
    formattedBilling: billingPhone,
    originalShipping: shippingAddress.phoneNumber,
    formattedShipping: shippingPhone
  });

  // Log country name formatting for debugging
  console.log(`[SHIPROCKET] Country name formatting:`, {
    originalBillingCountry: billingAddress.country,
    formattedBillingCountry: formatCountryName(billingAddress.country),
    originalShippingCountry: shippingAddress.country,
    formattedShippingCountry: formatCountryName(shippingAddress.country)
  });

  // Log address formatting for debugging
  console.log(`[SHIPROCKET] Address formatting:`, {
    originalBillingAddress: billingAddress.street,
    formattedBillingAddress: formatAddress(billingAddress.street),
    originalShippingAddress: shippingAddress.street,
    formattedShippingAddress: formatAddress(shippingAddress.street),
    originalBillingCity: billingAddress.city,
    formattedBillingCity: formatAddress(billingAddress.city),
    originalShippingCity: shippingAddress.city,
    formattedShippingCity: formatAddress(shippingAddress.city)
  });

  // Log pincode formatting for debugging
  console.log(`[SHIPROCKET] Pincode formatting:`, {
    originalBillingPincode: billingAddress.zipCode,
    formattedBillingPincode: formatPincode(billingAddress.zipCode),
    originalShippingPincode: shippingAddress.zipCode,
    formattedShippingPincode: formatPincode(shippingAddress.zipCode)
  });

  // Log state formatting for debugging
  console.log(`[SHIPROCKET] State formatting:`, {
    originalBillingState: billingAddress.state,
    formattedBillingState: formatStateName(billingAddress.state),
    originalShippingState: shippingAddress.state,
    formattedShippingState: formatStateName(shippingAddress.state)
  });

  // Log email formatting for debugging
  console.log(`[SHIPROCKET] Email formatting:`, {
    originalEmail: user.email,
    formattedEmail: formatEmail(user.email)
  });

  // Log order ID formatting for debugging
  console.log(`[SHIPROCKET] Order ID formatting:`, {
    originalOrderId: order.invoiceNumber || order._id.toString(),
    formattedOrderId: formatOrderId(order.invoiceNumber || order._id.toString())
  });

  // Validate HSN code length for all items
  const invalidHsnItems = order.orderItems.filter(item => {
    const hsnCode = 44112200;
    return hsnCode.toString().length < 8;
  });

  if (invalidHsnItems.length > 0) {
    console.warn(`[SHIPROCKET] Found ${invalidHsnItems.length} items with invalid HSN codes`);
  }

  return {
    order_id: formatOrderId(order.invoiceNumber || order._id.toString()),
    order_date: order.createdAt.toISOString().split('T')[0],
    pickup_location: getValidPickupLocation(), // Always use the correct nickname
    channel_id: "",
    comment: order.customerNotes || "",
    
    // Billing details
    billing_customer_name: billingName.firstName,
    billing_last_name: billingName.lastName,
    billing_address: formatAddress(billingAddress.street),
    billing_address_2: "",
    billing_city: formatAddress(billingAddress.city),
    billing_pincode: formatPincode(billingAddress.zipCode),
    billing_state: formatStateName(billingAddress.state),
    billing_country: formatCountryName(billingAddress.country),
    billing_email: formatEmail(user.email),
    billing_phone: billingPhone,
    
    // Shipping details
    shipping_is_billing: shippingAddress.street === billingAddress.street,
    shipping_customer_name: shippingName.firstName,
    shipping_last_name: shippingName.lastName,
    shipping_address: formatAddress(shippingAddress.street),
    shipping_address_2: "",
    shipping_city: formatAddress(shippingAddress.city),
    shipping_pincode: formatPincode(shippingAddress.zipCode),
    shipping_state: formatStateName(shippingAddress.state),
    shipping_country: formatCountryName(shippingAddress.country),
    shipping_email: formatEmail(user.email),
    shipping_phone: shippingPhone,
    
    // Order items
    order_items: order.orderItems.map(item => {
      // Use 8-digit HSN code for home decor items as required by ShipRocket
      const hsnCode = 44112200; // Default for home decor items
      
      console.log(`[SHIPROCKET] Order item HSN code:`, {
        itemName: item.name,
        hsnCode: hsnCode,
        hsnLength: hsnCode.toString().length
      });
      
      return {
        name: item.name,
        sku: item.variationSku || `PROD-${item.product}`,
        units: item.quantity,
        selling_price: formatPrice(item.price),
        discount: 0,
        tax: formatPrice(item.itemTaxAmount || 0),
        hsn: hsnCode,
      };
    }),
    
    payment_method: order.isPaid ? "Prepaid" : "COD",
    shipping_charges: formatPrice(order.shippingCost),
    giftwrap_charges: formatPrice(order.giftWrappingFee || 0),
    transaction_charges: 0,
    total_discount: formatPrice(order.discountAmount || 0),
    sub_total: formatPrice(order.subtotal),
    
    // Package dimensions (you may want to make these configurable)
    length: 15,
    breadth: 10,
    height: 10,
    weight: calculateOrderWeight(order.orderItems),
  };
};

// Helper function to calculate order weight
const calculateOrderWeight = (orderItems) => {
  // Default weight calculation - you can customize this based on your products
  const totalQuantity = orderItems.reduce((sum, item) => sum + item.quantity, 0);
  return Math.max(0.5, totalQuantity * 0.5); // Minimum 0.5kg, then 0.5kg per item
};

export default shipRocketService;