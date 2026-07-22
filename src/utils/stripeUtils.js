import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Create a payment intent
export const createPaymentIntent = async (
  amount,
  currency = "usd",
  metadata = {}
) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    return {
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// Calculate tax for an order using Stripe Tax
export const calculateTax = async (orderData) => {
  try {
    // Log input data with detailed line items
    console.log("[STRIPE TAX] Input data for tax calculation:", {
      currency: orderData.currency || "usd",
      address: orderData.shippingAddress,
      shippingCost: orderData.shippingCost,
      lineItemsCount: orderData.lineItems?.length || 0,
      lineItems: orderData.lineItems.map(item => ({
        productId: item.productId,
        unitPrice: item.price,
        quantity: item.quantity,
        totalLineAmount: item.price * item.quantity,
        taxCode: item.taxCode,
      })),
      totalSubtotal: orderData.lineItems.reduce((sum, item) => 
        sum + (item.price * (item.quantity || 1)), 0
      ),
    });

    // Create a mapping from reference (cart item ID) to productId for response mapping
    const referenceToProductIdMap = new Map();
    
    // Prepare line items for Stripe
    const lineItemsForStripe = orderData.lineItems.map(item => {
      // Validate and ensure quantity is a number
      const quantity = typeof item.quantity === 'number' && item.quantity > 0 
        ? Math.floor(item.quantity) // Ensure it's an integer
        : 1;
      
      // Validate and ensure price is a number
      const price = typeof item.price === 'number' && item.price > 0 
        ? item.price 
        : 0;
      
      // Use item.id (cart item ID) as reference for uniqueness
      // This ensures each cart item (even same product with different variations) has unique reference
      // Fallback to productId if id is not available (shouldn't happen in normal flow)
      const reference = item.id || item.productId || `item_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store mapping: reference (cart item ID) -> productId
      if (item.productId) {
        referenceToProductIdMap.set(reference, item.productId);
      }
      
      const lineItem = {
        amount: Math.round(price * 100), // Unit price in cents
        quantity: quantity, // Quantity (validated)
        tax_code: item.taxCode || 'txcd_99999999',
        reference: reference, // Unique reference per cart item
      };
      
      // Log each line item being sent with validation info
      console.log("[STRIPE TAX] Line item to Stripe (VALIDATED):", {
        reference: lineItem.reference,
        inputQuantity: item.quantity,
        inputQuantityType: typeof item.quantity,
        validatedQuantity: lineItem.quantity,
        inputPrice: item.price,
        validatedPrice: price,
        amountCents: lineItem.amount,
        amountDollars: lineItem.amount / 100,
        totalAmountCents: lineItem.amount * lineItem.quantity,
        totalAmountDollars: (lineItem.amount * lineItem.quantity) / 100,
        taxCode: lineItem.tax_code,
        expectedTaxBase: (lineItem.amount * lineItem.quantity) / 100 * 0.0431, // ~4.31% for CA
      });
      
      return lineItem;
    });

    // Log the exact payload being sent to Stripe
    const stripePayload = {
      currency: orderData.currency || 'usd',
      customer_details: {
        address: {
          line1: orderData.shippingAddress.street,
          city: orderData.shippingAddress.city,
          state: orderData.shippingAddress.state,
          postal_code: orderData.shippingAddress.zipCode,
          country: orderData.shippingAddress.country || 'US',
        },
        address_source: 'shipping',
      },
      line_items: lineItemsForStripe,
      shipping_cost: {
        amount: Math.round((orderData.shippingCost || 0) * 100),
      },
      expand: ['line_items.data.tax_breakdown'],
    };

    console.log("[STRIPE TAX] EXACT PAYLOAD TO STRIPE API:", JSON.stringify(stripePayload, null, 2));
    console.log("[STRIPE TAX] Line items in payload:", stripePayload.line_items.map(item => ({
      amount: item.amount,
      amountDollars: item.amount / 100,
      quantity: item.quantity,
      quantityType: typeof item.quantity,
      totalAmount: item.amount * item.quantity,
      totalAmountDollars: (item.amount * item.quantity) / 100,
      tax_code: item.tax_code,
      reference: item.reference,
    })));

    const taxCalculation = await stripe.tax.calculations.create(stripePayload);

    // Log full Stripe response
    console.log("[STRIPE TAX] Full Stripe response:", {
      calculationId: taxCalculation.id,
      status: taxCalculation.status,
      tax_amount_exclusive: taxCalculation.tax_amount_exclusive,
      tax_amount_exclusive_dollars: (taxCalculation.tax_amount_exclusive || 0) / 100,
      amount_total: taxCalculation.amount_total,
      amount_total_dollars: (taxCalculation.amount_total || 0) / 100,
      shipping_cost_tax: taxCalculation.shipping_cost?.tax_amount || 0,
      lineItemsCount: taxCalculation.line_items?.data?.length || 0,
      lineItems: taxCalculation.line_items.data.map(item => {
        // Calculate tax from tax_breakdown
        const taxFromBreakdown = item.tax_breakdown && Array.isArray(item.tax_breakdown)
          ? item.tax_breakdown.reduce((sum, breakdown) => sum + (breakdown.amount || 0), 0) / 100
          : 0;
        
        // Log full breakdown structure
        console.log("[STRIPE TAX] Full tax_breakdown structure for item:", {
          reference: item.reference,
          quantity: item.quantity,
          amount: item.amount,
          tax_breakdown_full: JSON.stringify(item.tax_breakdown, null, 2),
        });
        
        return {
          reference: item.reference,
          amount: item.amount,
          amountDollars: item.amount / 100,
          quantity: item.quantity,
          totalAmountCents: item.amount * item.quantity,
          totalAmountDollars: (item.amount * item.quantity) / 100,
          tax_amount_property: item.tax_amount,
          tax_amountDollars: item.tax_amount ? item.tax_amount / 100 : 0,
          taxFromBreakdown: taxFromBreakdown,
          taxability: item.taxability,
          taxability_reason: item.taxability_reason,
          tax_breakdown: item.tax_breakdown?.map(breakdown => ({
            amount: breakdown.amount,
            amountDollars: breakdown.amount / 100,
            jurisdiction: breakdown.jurisdiction?.display_name,
            tax_rate: breakdown.tax_rate?.percentage,
            sourcing: breakdown.sourcing,
            // Add more details
            tax_rate_details: breakdown.tax_rate,
            jurisdiction_details: breakdown.jurisdiction,
          })) || [],
        };
      }),
    });

    // Calculate tax breakdown properly
    // NOTE: Stripe doesn't provide item.tax_amount directly, we need to sum tax_breakdown amounts
    const taxBreakdown = taxCalculation.line_items.data.map(item => {
      // Calculate tax from tax_breakdown array (sum all breakdown amounts)
      let lineItemTax = 0;
      if (item.tax_breakdown && Array.isArray(item.tax_breakdown)) {
        // Sum all breakdown amounts
        const breakdownTaxCents = item.tax_breakdown.reduce((sum, breakdown) => {
          return sum + (breakdown.amount || 0);
        }, 0);
        
        lineItemTax = breakdownTaxCents / 100; // Convert from cents to dollars
        
        // IMPORTANT: Stripe's tax_breakdown.taxable_amount shows the amount tax was calculated on
        // If it equals unit amount (not unit * quantity), then breakdown amounts are per-unit
        // and need to be multiplied by quantity to get total tax
        const firstBreakdown = item.tax_breakdown[0];
        const breakdownTaxableAmount = firstBreakdown?.taxable_amount || 0;
        const expectedTaxableAmount = item.amount * item.quantity;
        const isPerUnitBreakdown = breakdownTaxableAmount === item.amount && breakdownTaxableAmount !== expectedTaxableAmount;
        
        console.log("[STRIPE TAX] Tax breakdown analysis:", {
          reference: item.reference,
          quantity: item.quantity,
          unitAmount: item.amount,
          totalExpectedAmount: expectedTaxableAmount,
          breakdownTaxableAmount: breakdownTaxableAmount,
          breakdownTaxCents: breakdownTaxCents,
          breakdownTaxDollars: lineItemTax,
          breakdownMatchesUnitAmount: breakdownTaxableAmount === item.amount,
          breakdownMatchesTotalAmount: breakdownTaxableAmount === expectedTaxableAmount,
          isPerUnitBreakdown: isPerUnitBreakdown,
          // Calculate expected tax if breakdown is per-unit
          expectedTaxIfPerUnit: (breakdownTaxCents * item.quantity) / 100,
        });
        
        // CRITICAL FIX: If breakdown taxable_amount equals unit amount (not total),
        // then breakdown amounts are per-unit and MUST be multiplied by quantity
        // Only apply fix when quantity > 1 to avoid unnecessary multiplication for single items
        if (isPerUnitBreakdown && item.quantity > 1) {
          const originalTax = lineItemTax;
          lineItemTax = (breakdownTaxCents * item.quantity) / 100;
          
          console.log("[STRIPE TAX] FIX APPLIED: Breakdown is per-unit, multiplying by quantity:", {
            originalTax: originalTax,
            quantity: item.quantity,
            correctedTax: lineItemTax,
            breakdownTaxCents: breakdownTaxCents,
            calculation: `${breakdownTaxCents} cents × ${item.quantity} = ${breakdownTaxCents * item.quantity} cents = $${lineItemTax}`,
          });
        } else if (isPerUnitBreakdown && item.quantity === 1) {
          // For quantity 1, per-unit breakdown is already correct, no multiplication needed
          console.log("[STRIPE TAX] Breakdown is per-unit but quantity is 1, no multiplication needed");
        } else if (!isPerUnitBreakdown) {
          // Breakdown appears to be total (not per-unit), use as-is
          console.log("[STRIPE TAX] Breakdown appears to be total amount, using as-is");
        }
      } else if (item.tax_amount && typeof item.tax_amount === 'number') {
        // Fallback to tax_amount if available
        lineItemTax = item.tax_amount / 100;
      }
      
      // Get tax rate from first breakdown item
      const taxRate = item.tax_breakdown?.[0]?.tax_rate?.percentage || 0;
      const jurisdiction = item.tax_breakdown?.[0]?.jurisdiction?.display_name || '';
      
      console.log("[STRIPE TAX] Processing line item tax:", {
        reference: item.reference,
        quantity: item.quantity,
        amount: item.amount / 100,
        tax_amount_property: item.tax_amount,
        tax_breakdown_count: item.tax_breakdown?.length || 0,
        tax_breakdown_amounts: item.tax_breakdown?.map(b => b.amount / 100) || [],
        calculatedTaxAmount: lineItemTax,
        taxRate: taxRate,
        jurisdiction: jurisdiction,
        taxability: item.taxability,
        taxability_reason: item.taxability_reason,
      });
      
      // Map reference (cart item ID) back to productId for response
      const productId = referenceToProductIdMap.get(item.reference) || item.reference;
      
      return {
        productId: productId, // Use productId from map, fallback to reference if not found
        taxAmount: lineItemTax,
        taxRate: taxRate,
        jurisdiction: jurisdiction,
        quantity: item.quantity,
        unitPrice: item.amount / 100,
        totalLineAmount: (item.amount * item.quantity) / 100,
      };
    });

    // Check if shipping has tax
    const shippingTax = taxCalculation.shipping_cost?.tax_amount 
      ? taxCalculation.shipping_cost.tax_amount / 100 
      : 0;
    
    if (shippingTax > 0) {
      console.log("[STRIPE TAX] Shipping tax detected:", shippingTax);
    }

    // Calculate corrected total tax from line items (after quantity multiplication fix)
    const correctedLineItemsTax = taxBreakdown.reduce((sum, item) => sum + item.taxAmount, 0);
    const correctedTotalTax = correctedLineItemsTax + shippingTax;
    
    // Calculate corrected totals
    const lineItemsSubtotal = taxBreakdown.reduce((sum, item) => sum + item.totalLineAmount, 0);
    const correctedSubtotal = lineItemsSubtotal;
    const correctedTotal = correctedSubtotal + correctedTotalTax;

    // Validation: Compare Stripe's top-level tax with our calculated tax
    const stripeTotalTax = (taxCalculation.tax_amount_exclusive || 0) / 100;
    const taxDifference = Math.abs(correctedTotalTax - stripeTotalTax);
    const hasSignificantDifference = taxDifference > 0.01; // More than 1 cent difference

    if (hasSignificantDifference) {
      console.warn("[STRIPE TAX] WARNING: Tax calculation discrepancy detected:", {
        stripeTotalTax: stripeTotalTax,
        correctedTotalTax: correctedTotalTax,
        difference: taxDifference,
        reason: "Stripe's top-level tax_amount_exclusive doesn't match our calculated breakdown. Using corrected value.",
      });
    }

    console.log("[STRIPE TAX] Final tax calculation:", {
      stripeTotalTax: stripeTotalTax,
      correctedLineItemsTax: correctedLineItemsTax,
      shippingTax: shippingTax,
      correctedTotalTax: correctedTotalTax,
      taxDifference: taxDifference,
      hasDiscrepancy: hasSignificantDifference,
      taxBreakdown: taxBreakdown,
    });

    return {
      success: true,
      taxCalculation,
      calculationId: taxCalculation.id,
      totalTax: correctedTotalTax, // Use corrected tax instead of Stripe's incorrect total
      taxBreakdown: taxBreakdown,
      subtotal: correctedSubtotal,
      total: correctedTotal,
    };
  } catch (error) {
    console.error("[STRIPE TAX] Calculation error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

// Create payment intent with tax calculation
export const createPaymentIntentWithTax = async (
  amount,
  taxCalculationId,
  currency = "usd",
  metadata = {}
) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      metadata: {
        ...metadata,
        tax_calculation_id: taxCalculationId,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    return {
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// Validate tax calculation for consistency
export const validateTaxCalculation = async (calculationId) => {
  try {
    console.log("[STRIPE TAX VALIDATION] Retrieving calculation:", {
      calculationId,
      stripeKeyMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'LIVE' : 'TEST'
    });
    
    const calculation = await stripe.tax.calculations.retrieve(calculationId);
    
    // Log full calculation object to see all available fields
    console.log("[STRIPE TAX VALIDATION] Calculation retrieved successfully:", {
      calculationId: calculation.id,
      status: calculation.status,
      taxAmount: calculation.tax_amount_exclusive,
      amountTotal: calculation.amount_total,
      currency: calculation.currency,
      allFields: Object.keys(calculation), // Show all available fields
    });
    
    // Stripe Tax calculations don't always have a status field
    // If calculation exists and was retrieved successfully, it's valid
    // Status field might not exist for tax calculations (unlike payment intents)
    const isValid = calculation && calculation.id === calculationId;
    
    return {
      success: true,
      calculation,
      isValid,
      status: calculation.status,
    };
  } catch (error) {
    console.error("[STRIPE TAX VALIDATION] Error retrieving calculation:", {
      calculationId,
      errorType: error.type,
      errorCode: error.code,
      errorMessage: error.message,
      rawError: error.raw?.message || error.raw,
      stripeKeyMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'LIVE' : 'TEST'
    });
    
    return {
      success: false,
      error: error.message,
      errorType: error.type,
      errorCode: error.code,
      rawError: error.raw,
    };
  }
};

// Create tax transaction for record keeping (after successful payment)
export const createTaxTransaction = async (paymentIntentId, taxCalculationId) => {
  try {
    const transaction = await stripe.tax.transactions.createFromCalculation({
      calculation: taxCalculationId,
      reference: paymentIntentId,
    });

    return {
      success: true,
      transaction,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// Retrieve a payment intent
export const retrievePaymentIntent = async (paymentIntentId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    return {
      success: true,
      paymentIntent,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// Create a refund
export const createRefund = async (paymentIntentId, amount = null) => {
  try {
    const refundParams = {
      payment_intent: paymentIntentId,
    };

    // If amount is provided, add it to refund params
    if (amount) {
      refundParams.amount = Math.round(amount * 100); // Convert to cents
    }

    const refund = await stripe.refunds.create(refundParams);

    return {
      success: true,
      refund,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// Create a customer
export const createCustomer = async (name, email, phone, metadata = {}) => {
  try {
    const customer = await stripe.customers.create({
      name,
      email,
      phone,
      metadata,
    });

    return {
      success: true,
      customer,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// Add a payment method to a customer
export const attachPaymentMethod = async (customerId, paymentMethodId) => {
  try {
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    // Set as default payment method
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// Retrieve a customer's payment methods
export const listPaymentMethods = async (customerId) => {
  try {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });

    return {
      success: true,
      paymentMethods: paymentMethods.data,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// Create a webhook event
export const constructEvent = (payload, signature, endpointSecret) => {
  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      endpointSecret
    );

    return {
      success: true,
      event,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// Handle specific payment events
export const handlePaymentEvent = (event) => {
  switch (event.type) {
    case "payment_intent.succeeded":
      return {
        success: true,
        status: "succeeded",
        paymentIntent: event.data.object,
      };

    case "payment_intent.payment_failed":
      return {
        success: false,
        status: "failed",
        paymentIntent: event.data.object,
        error: event.data.object.last_payment_error?.message,
      };

    case "charge.refunded":
      return {
        success: true,
        status: "refunded",
        charge: event.data.object,
      };

    default:
      return {
        success: true,
        status: "unhandled",
        type: event.type,
      };
  }
};

// Check Stripe Tax configuration and return status
export const checkStripeTaxConfiguration = async () => {
  const results = {
    stripeConnected: false,
    taxApiAccessible: false,
    testCalculation: null,
    configurationIssues: [],
    recommendations: [],
    status: 'unknown',
  };

  try {
    // 1. Check if Stripe is connected
    try {
      const account = await stripe.accounts.retrieve();
      results.stripeConnected = true;
      results.accountId = account.id;
      results.country = account.country;
    } catch (error) {
      results.configurationIssues.push({
        type: 'stripe_connection',
        message: 'Cannot connect to Stripe API',
        error: error.message,
      });
      results.status = 'error';
      return results;
    }

    // 2. Test tax calculation with a known address (NYC - should have tax)
    try {
      const testCalculation = await stripe.tax.calculations.create({
        currency: 'usd',
        customer_details: {
          address: {
            line1: '123 Broadway',
            city: 'New York',
            state: 'NY',
            postal_code: '10001',
            country: 'US',
          },
          address_source: 'shipping',
        },
        line_items: [
          {
            amount: 600, // $6.00 in cents
            quantity: 1,
            tax_code: 'txcd_99999999', // General product tax code
            reference: 'test_product',
          },
        ],
        shipping_cost: {
          amount: 0,
        },
        expand: ['line_items.data.tax_breakdown'],
      });

      results.taxApiAccessible = true;
      results.testCalculation = {
        calculationId: testCalculation.id,
        taxAmount: testCalculation.tax_amount_exclusive / 100,
        taxAmountExclusive: testCalculation.tax_amount_exclusive,
        amountTotal: testCalculation.amount_total / 100,
        lineItems: testCalculation.line_items.data.map((item) => ({
          reference: item.reference,
          taxAmount: item.tax_amount ? item.tax_amount / 100 : 0,
          taxability: item.taxability,
          taxabilityReason: item.taxability_reason,
          taxBreakdown: item.tax_breakdown?.map((breakdown) => ({
            amount: breakdown.amount / 100,
            jurisdiction: breakdown.jurisdiction?.display_name,
            taxRate: breakdown.tax_rate?.percentage,
            taxRateDetails: breakdown.tax_rate?.display_name,
            sourcing: breakdown.sourcing,
          })) || [],
        })),
      };

      // Analyze the test calculation
      if (testCalculation.tax_amount_exclusive === 0) {
        results.configurationIssues.push({
          type: 'zero_tax',
          message: 'Tax calculation returned $0 for NYC address (expected ~$0.51 for $6 product)',
          severity: 'high',
          details: {
            taxabilityReason: testCalculation.line_items.data[0]?.taxability_reason,
            recommendation: 'Check Stripe Dashboard → Tax → Registrations for New York State',
          },
        });
        results.status = 'warning';
      } else {
        results.status = 'success';
        const expectedTax = 0.51; // ~8.5% of $6
        const actualTax = testCalculation.tax_amount_exclusive / 100;
        if (Math.abs(actualTax - expectedTax) > 0.1) {
          results.recommendations.push({
            type: 'tax_rate_verification',
            message: `Tax amount ($${actualTax.toFixed(2)}) differs from expected (~$${expectedTax.toFixed(2)})`,
            severity: 'low',
          });
        }
      }

      // Check for taxability reasons
      testCalculation.line_items.data.forEach((item) => {
        if (item.taxability_reason) {
          results.testCalculation.taxabilityReasons = results.testCalculation.taxabilityReasons || [];
          results.testCalculation.taxabilityReasons.push({
            reference: item.reference,
            reason: item.taxability_reason,
          });

          // Add warnings for common issues
          if (item.taxability_reason.includes('not_registered')) {
            results.configurationIssues.push({
              type: 'not_registered',
              message: `Not registered for tax in jurisdiction: ${item.taxability_reason}`,
              severity: 'high',
              recommendation: 'Register for tax collection in Stripe Dashboard → Tax → Registrations',
            });
            results.status = 'error';
          }

          if (item.taxability_reason.includes('exempt')) {
            results.configurationIssues.push({
              type: 'tax_exempt',
              message: `Product marked as tax exempt: ${item.taxability_reason}`,
              severity: 'medium',
            });
          }
        }
      });
    } catch (error) {
      results.configurationIssues.push({
        type: 'tax_calculation_error',
        message: 'Failed to create test tax calculation',
        error: error.message,
        severity: 'high',
      });
      results.status = 'error';
    }

    // 3. Try to get account settings (if available)
    try {
      // Note: Stripe doesn't have a direct API to check tax registrations
      // This would need to be done via Dashboard or webhooks
      results.recommendations.push({
        type: 'manual_check',
        message: 'Verify tax registrations in Stripe Dashboard → Tax → Registrations',
        action: 'https://dashboard.stripe.com/tax/registrations',
      });
    } catch (error) {
      // Silently fail - this is optional
    }

    // 4. Provide summary and recommendations
    if (results.status === 'success') {
      results.summary = 'Stripe Tax is configured correctly and calculating taxes properly.';
    } else if (results.status === 'warning') {
      results.summary = 'Stripe Tax is accessible but may have configuration issues. Review the issues below.';
    } else {
      results.summary = 'Stripe Tax has configuration issues that need to be addressed.';
    }

    return results;
  } catch (error) {
    results.status = 'error';
    results.configurationIssues.push({
      type: 'unknown_error',
      message: 'Unexpected error checking Stripe Tax configuration',
      error: error.message,
    });
    return results;
  }
};

// Get tax rates for a location (useful for display purposes)
export const getTaxRatesForLocation = async (address) => {
  try {
    // This is a simplified calculation to get estimated tax rates
    const calculation = await stripe.tax.calculations.create({
      currency: 'usd',
      customer_details: {
        address: {
          line1: address.street,
          city: address.city,
          state: address.state,
          postal_code: address.zipCode,
          country: address.country || 'US',
        },
        address_source: 'shipping',
      },
      line_items: [{
        amount: 10000, // $100 for calculation
        quantity: 1,
        tax_code: 'txcd_99999999',
        reference: 'test',
      }],
    });

    const taxRate = calculation.tax_amount_exclusive > 0 
      ? (calculation.tax_amount_exclusive / calculation.amount_total) * 100 
      : 0;

    return {
      success: true,
      estimatedTaxRate: taxRate,
      jurisdiction: calculation.line_items.data[0]?.tax_breakdown?.[0]?.jurisdiction?.display_name || '',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

export default {
  stripe,
  createPaymentIntent,
  createPaymentIntentWithTax,
  calculateTax,
  validateTaxCalculation,
  createTaxTransaction,
  retrievePaymentIntent,
  createRefund,
  createCustomer,
  attachPaymentMethod,
  listPaymentMethods,
  constructEvent,
  handlePaymentEvent,
  getTaxRatesForLocation,
  checkStripeTaxConfiguration,
};