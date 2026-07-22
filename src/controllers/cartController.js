


import Cart from "../models/cartModel.js";
import Product from "../models/productModel.js";
import PageContent from "../models/pageContentModel.js";
import { calculateTax } from "../utils/stripeUtils.js";
import mongoose from "mongoose";

// Helper function to find variation combination in PageContent
const findVariationCombinationById = (pageContent, combinationId) => {
  if (!pageContent || !pageContent.content || !pageContent.content.variationCombinations) {
    return null;
  }

  const combinations = pageContent.content.variationCombinations;
  return combinations.find(combo => combo.id === combinationId && (combo.isActive || combo.isEnabled));
};

// Helper function to validate variation selection matches combination
const validateVariationMatch = (combination, selectedVariations) => {
  if (!combination || !selectedVariations) return false;
  
  const combKeys = Object.keys(combination.combination);
  const selectedKeys = Object.keys(selectedVariations);
  
  // Check if all keys match
  if (combKeys.length !== selectedKeys.length) return false;
  
  // Check if all values match
  return combKeys.every(key => 
    combination.combination[key] === selectedVariations[key]
  );
};

// Helper function to convert variations object to array format for storage
const convertVariationsToArray = (variationsObj) => {
  if (!variationsObj || Object.keys(variationsObj).length === 0) {
    return [];
  }
  
  return Object.entries(variationsObj).map(([name, value]) => ({
    name,
    value,
    priceModifier: 0 // Keep for backward compatibility
  }));
};

const getCart = async (req, res) => {
  try {
    let cart;

    if (req.user) {
      cart = await Cart.findOne({ user: req.user._id }).populate({
        path: "items.product",
        select: "name slug images price stock",
      });
    } else if (req.query.sessionId) {
      cart = await Cart.findOne({ sessionId: req.query.sessionId }).populate({
        path: "items.product",
        select: "name slug images price stock",
      });
    }

    if (!cart) {
      if (req.user) {
        cart = new Cart({ user: req.user._id, items: [] });
      } else if (req.query.sessionId) {
        cart = new Cart({ sessionId: req.query.sessionId, items: [] });
      } else {
        const sessionId = mongoose.Types.ObjectId().toString();
        cart = new Cart({ sessionId, items: [] });
      }
      await cart.save();
    }

    // Include tax calculation status in response
    const response = {
      success: true,
      cart,
      taxCalculationNeeded: cart.needsTaxCalculation(),
      hasShippingAddress: !!(cart.tempShippingAddress && cart.tempShippingAddress.zipCode),
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

const addToCart = async (req, res) => {
  try {
    const {
      productId,
      quantity = 1,
      variations = {}, // Object format: {size: "32x80"}
      variationDetails = {}, // Additional details from frontend
      sku,
      combinationId,
      sessionId,
      color,
      size,
      material,
      giftWrapping = false,
      installationService = false,
      taxCode, // NEW: Optional tax code for Stripe Tax
      agentCode, // Optional agent code for MLM/commission tracking
    } = req.body;

    console.log("AddToCart payload:", {
      productId,
      quantity,
      variations,
      combinationId,
      sku,
      taxCode
    });

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    // Fetch product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (!product.isPublished) {
      return res.status(400).json({
        success: false,
        message: "Product is not available",
      });
    }

    // Determine if this product has variations
    const hasVariations = Object.keys(variations).length > 0 || combinationId;
    let validatedPrice = product.price;
    let availableStock = product.stock;
    let variationInfo = null;

    if (hasVariations) {
      // Fetch PageContent for variation validation
      const pageContentId = `product-${productId}`;
      const pageContent = await PageContent.findOne({
        pageId: pageContentId,
        pageType: "product"
      });

      if (!pageContent) {
        return res.status(400).json({
          success: false,
          message: "Product has variations but no page content found. Please contact support.",
        });
      }

      // Find the variation combination
      let combination = null;
      
      if (combinationId) {
        // Direct lookup by combination ID
        combination = findVariationCombinationById(pageContent, combinationId);
        
        if (!combination) {
          return res.status(400).json({
            success: false,
            message: "Invalid variation combination ID provided.",
          });
        }

        // Validate that provided variations match the combination
        if (!validateVariationMatch(combination, variations)) {
          return res.status(400).json({
            success: false,
            message: "Provided variations do not match the combination ID.",
          });
        }
      } else {
        // Fallback: Find combination by variations
        const combinations = pageContent.content.variationCombinations || [];
        combination = combinations.find(combo => {
          if (!(combo.isActive || combo.isEnabled)) return false;
          return validateVariationMatch(combo, variations);
        });

        if (!combination) {
          return res.status(400).json({
            success: false,
            message: "Invalid variation combination selected.",
          });
        }
      }

      // Validate combination is enabled
      if (!(combination.isActive || combination.isEnabled)) {
        return res.status(400).json({
          success: false,
          message: "Selected variation is not available.",
        });
      }

      // Check stock for this variation
      if (combination.stockQuantity < quantity) {
        return res.status(400).json({
          success: false,
          message: `Only ${combination.stockQuantity} items available for selected variation.`,
        });
      }

      // Use combination pricing and stock
      validatedPrice = combination.price;
      availableStock = combination.stockQuantity;
      variationInfo = {
        combinationId: combination.id,
        sku: combination.sku,
        variations: variations,
        images: Array.isArray(combination.images) ? combination.images : [],
      };

      console.log("Variation validation successful:", {
        combinationId: combination.id,
        price: validatedPrice,
        stock: availableStock
      });
    } else {
      // Simple product without variations
      if (product.stock < quantity) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} items available`,
        });
      }
    }

    // Get or create cart
    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user._id });
      if (!cart) {
        cart = new Cart({ user: req.user._id, items: [] });
      }
    } else if (sessionId) {
      cart = await Cart.findOne({ sessionId });
      if (!cart) {
        cart = new Cart({ sessionId, items: [] });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "User authentication or session ID is required",
      });
    }

    // Validate agent code if provided (per item)
    let validatedAgentCode = null;
    if (agentCode) {
      const Agent = (await import("../models/agentModel.js")).default;
      const agent = await Agent.findOne({ agentCode: agentCode.trim() });
      
      if (!agent) {
        return res.status(400).json({
          success: false,
          message: `Invalid agent code: ${agentCode}. Agent not found in the system.`,
        });
      }
      
      validatedAgentCode = agent.agentCode;
      console.log("[CART] Agent code validated for product:", {
        agentCode: validatedAgentCode,
        agentName: agent.displayName || `${agent.firstName} ${agent.lastName}`,
        productId: productId,
      });
    }

    // Convert variations to array format for storage (backward compatibility)
    const variationsArray = convertVariationsToArray(variations);

    // Use cart method to add item with variation info and agent code
    cart.addItem(productId, quantity, variationsArray, validatedPrice, {
      color,
      size,
      material,
      giftWrapping,
      installationService,
      variationCombinationId: variationInfo?.combinationId,
      variationSku: variationInfo?.sku,
      variationsObject: variations, // Store original object format
       variationImages: variationInfo?.images || [],
      taxCode: taxCode || 'txcd_99999999', // Default to general product tax code
      agentCode: validatedAgentCode, // Store agent code per item
    });

    await cart.save();

    await cart.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    console.log("Item added to cart successfully");

    res.status(200).json({
      success: true,
      message: "Item added to cart",
      cart,
      taxCalculationNeeded: cart.needsTaxCalculation(),
    });
  } catch (error) {
    console.error("Error adding to cart:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// NEW: Calculate tax for cart
const calculateCartTax = async (req, res) => {
  try {
    const { shippingAddress } = req.body;

    if (!shippingAddress || !shippingAddress.zipCode) {
      return res.status(400).json({
        success: false,
        message: "Shipping address with zip code is required for tax calculation",
      });
    }

    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user._id }).populate({
        path: "items.product",
        select: "name slug images price stock",
      });
    } else if (req.body.sessionId) {
      cart = await Cart.findOne({ sessionId: req.body.sessionId }).populate({
        path: "items.product",
        select: "name slug images price stock",
      });
    }

    if (!cart || cart.items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cart not found or empty",
      });
    }

    // Prepare order data for Stripe Tax calculation
    const orderData = {
      currency: 'usd',
      shippingAddress: {
        street: shippingAddress.street,
        city: shippingAddress.city,
        state: shippingAddress.state,
        zipCode: shippingAddress.zipCode,
        country: shippingAddress.country || 'US',
      },
      lineItems: cart.items.map(item => {
        // Ensure quantity is a valid number
        const quantity = typeof item.quantity === 'number' && item.quantity > 0 
          ? item.quantity 
          : 1;
        
        // Ensure price is a valid number
        const price = typeof item.price === 'number' && item.price > 0 
          ? item.price 
          : 0;
        
        console.log("[TAX CALCULATION] Processing cart item:", {
          itemId: item._id.toString(),
          productId: item.product?._id?.toString(),
          rawQuantity: item.quantity,
          rawQuantityType: typeof item.quantity,
          validatedQuantity: quantity,
          rawPrice: item.price,
          validatedPrice: price,
          totalPrice: item.totalPrice,
        });
        
        return {
          id: item._id.toString(),
          productId: item.product._id.toString(),
          price: price, // Unit price per item (not totalPrice)
          quantity: quantity, // Actual quantity (validated)
          taxCode: item.taxCode || 'txcd_99999999',
        };
      }),
      shippingCost: cart.shippingCost || 0,
    };

    // Log cart items being sent to tax calculation
    console.log("[TAX CALCULATION] Cart items being sent to tax calculation:", {
      cartId: cart._id,
      userId: cart.user,
      address: orderData.shippingAddress,
      items: cart.items.map(item => ({
        itemId: item._id.toString(),
        productId: item.product?._id?.toString(),
        productName: item.product?.name,
        unitPrice: item.price,
        quantity: item.quantity,
        totalPrice: item.totalPrice,
        taxCode: item.taxCode,
      })),
      orderDataLineItems: orderData.lineItems.map(item => ({
        productId: item.productId,
        unitPrice: item.price,
        quantity: item.quantity,
        totalAmount: item.price * item.quantity,
        taxCode: item.taxCode,
      })),
      subtotal: cart.subtotal,
      lineItemsCount: orderData.lineItems.length,
    });

    // Calculate tax using Stripe
    const taxResult = await calculateTax(orderData);

    if (!taxResult.success) {
      console.error("[TAX CALCULATION] Stripe error:", taxResult.error);
      return res.status(400).json({
        success: false,
        message: "Failed to calculate tax",
        error: taxResult.error,
      });
    }

    // Update cart with shipping address and tax data
    cart.setShippingAddress(shippingAddress);
    cart.updateStripeTaxData(taxResult);

    await cart.save();

    console.log("[TAX CALCULATION] Tax calculated successfully", {
      cartId: cart._id,
      totalTax: taxResult.totalTax,
      calculationId: taxResult.calculationId,
    });

    res.status(200).json({
      success: true,
      message: "Tax calculated successfully",
      cart,
      taxDetails: {
        totalTax: taxResult.totalTax,
        taxBreakdown: taxResult.taxBreakdown,
        calculationId: taxResult.calculationId,
        jurisdiction: taxResult.taxBreakdown[0]?.jurisdiction || '',
      },
    });
  } catch (error) {
    console.error("[TAX CALCULATION] Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// NEW: Get estimated tax rate for location (for display before adding address)
const getEstimatedTaxRate = async (req, res) => {
  try {
    const { zipCode, state, country = 'US' } = req.query;

    if (!zipCode || !state) {
      return res.status(400).json({
        success: false,
        message: "Zip code and state are required",
      });
    }

    // Use Stripe Tax to get estimated rate with a sample calculation
    const sampleOrderData = {
      currency: 'usd',
      shippingAddress: {
        street: '123 Main St', // Sample street
        city: 'Sample City', // Sample city
        state: state,
        zipCode: zipCode,
        country: country,
      },
      lineItems: [{
        id: 'sample',
        productId: 'sample',
        price: 100, // $100 sample
        quantity: 1,
        taxCode: 'txcd_99999999',
      }],
      shippingCost: 0,
    };

    const taxResult = await calculateTax(sampleOrderData);

    if (!taxResult.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to calculate estimated tax rate",
        error: taxResult.error,
      });
    }

    const estimatedRate = taxResult.totalTax > 0 ? (taxResult.totalTax / 100) * 100 : 0;

    res.status(200).json({
      success: true,
      estimatedTaxRate: estimatedRate.toFixed(2),
      jurisdiction: taxResult.taxBreakdown[0]?.jurisdiction || '',
      location: `${state}, ${zipCode}`,
    });
  } catch (error) {
    console.error("[ESTIMATED TAX] Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const updateCartItem = async (req, res) => {
  try {
    const { itemId, quantity, giftWrapping, installationService } = req.body;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "Item ID is required",
      });
    }

    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user._id });
    } else if (req.body.sessionId) {
      cart = await Cart.findOne({ sessionId: req.body.sessionId });
    }

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const cartItem = cart.items.id(itemId);
    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      });
    }

    if (quantity !== undefined) {
      if (quantity <= 0) {
        cart.removeItem(itemId);
      } else {
        // Validate stock for the new quantity
        const product = await Product.findById(cartItem.product);
        if (!product) {
          throw new Error("Product not found");
        }

        let availableStock = product.stock;

        // Check if this item has variations
        if (cartItem.variationCombinationId) {
          // Fetch PageContent to validate variation stock
          const pageContentId = `product-${cartItem.product}`;
          const pageContent = await PageContent.findOne({
            pageId: pageContentId,
            pageType: "product"
          });

          if (pageContent && pageContent.content && pageContent.content.variationCombinations) {
            const combination = findVariationCombinationById(pageContent, cartItem.variationCombinationId);
            
            if (!combination) {
              throw new Error("Variation combination not found");
            }

            if (!(combination.isActive || combination.isEnabled)) {
              throw new Error("Selected variation is no longer available");
            }

            availableStock = combination.stockQuantity;
          }
        }

        if (availableStock < quantity) {
          throw new Error(`Not enough stock available. Only ${availableStock} items available.`);
        }

        cart.updateItemQuantity(itemId, quantity);
      }
    }

    if (giftWrapping !== undefined) {
      cartItem.giftWrapping = giftWrapping;
    }

    if (installationService !== undefined) {
      cartItem.installationService = installationService;
    }

    await cart.save();
    await cart.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: "Cart updated",
      cart,
      taxCalculationNeeded: cart.needsTaxCalculation(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const removeFromCart = async (req, res) => {
  try {
    const { itemId } = req.params;

    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user._id });
    } else if (req.query.sessionId) {
      cart = await Cart.findOne({ sessionId: req.query.sessionId });
    }

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    cart.removeItem(itemId);
    await cart.save();

    await cart.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: "Item removed from cart",
      cart,
      taxCalculationNeeded: cart.needsTaxCalculation(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const clearCart = async (req, res) => {
  try {
    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user._id });
    } else if (req.query.sessionId) {
      cart = await Cart.findOne({ sessionId: req.query.sessionId });
    }

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    cart.clearCart();
    await cart.save();

    res.status(200).json({
      success: true,
      message: "Cart cleared",
      cart,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const setShippingMethod = async (req, res) => {
  try {
    const { shippingMethod, deliveryDate, deliveryTimeSlot } = req.body;

    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user._id });
    } else if (req.body.sessionId) {
      cart = await Cart.findOne({ sessionId: req.body.sessionId });
    }

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    cart.setDeliveryDetails(shippingMethod, deliveryDate, deliveryTimeSlot);
    await cart.save();

    await cart.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: "Shipping method updated",
      cart,
      taxCalculationNeeded: cart.needsTaxCalculation(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const addServices = async (req, res) => {
  try {
    const { installation, assembly, giftWrapping } = req.body;

    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user._id });
    } else if (req.body.sessionId) {
      cart = await Cart.findOne({ sessionId: req.body.sessionId });
    }

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    cart.addServices({ installation, assembly, giftWrapping });
    await cart.save();

    await cart.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: "Services added to cart",
      cart,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const mergeGuestCart = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId || !req.user) {
      return res.status(400).json({
        success: false,
        message: "Session ID and user authentication required",
      });
    }

    const mergedCart = await Cart.mergeGuestCart(sessionId, req.user._id);

    await mergedCart.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: "Carts merged successfully",
      cart: mergedCart,
      taxCalculationNeeded: mergedCart.needsTaxCalculation(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const setAgentCode = async (req, res) => {
  try {
    const { agentCode } = req.body;

    // Find or create cart
    let cart;
    if (req.user) {
      cart = await Cart.findOne({ user: req.user._id });
      if (!cart) {
        cart = new Cart({ user: req.user._id, items: [] });
      }
    } else if (req.query.sessionId) {
      cart = await Cart.findOne({ sessionId: req.query.sessionId });
      if (!cart) {
        cart = new Cart({ sessionId: req.query.sessionId, items: [] });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "User authentication or sessionId required",
      });
    }

    // If agentCode is provided, validate it exists
    if (agentCode) {
      const Agent = (await import("../models/agentModel.js")).default;
      const agent = await Agent.findOne({ agentCode: agentCode.trim() });
      
      if (!agent) {
        return res.status(400).json({
          success: false,
          message: `Invalid agent code: ${agentCode}. Agent not found in the system.`,
        });
      }
      
      cart.agentCode = agent.agentCode;
      console.log("[CART] Agent code set:", {
        agentCode: agent.agentCode,
        agentName: agent.displayName || `${agent.firstName} ${agent.lastName}`,
        cartId: cart._id,
      });
    } else {
      // If agentCode is null/empty, remove it from cart
      cart.agentCode = null;
      console.log("[CART] Agent code removed from cart:", cart._id);
    }

    await cart.save();

    await cart.populate({
      path: "items.product",
      select: "name slug images price stock",
    });

    res.status(200).json({
      success: true,
      message: agentCode ? "Agent code set successfully" : "Agent code removed successfully",
      cart,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export {
  getCart,
  addToCart,
  calculateCartTax, // NEW
  getEstimatedTaxRate, // NEW
  updateCartItem,
  removeFromCart,
  clearCart,
  setShippingMethod,
  addServices,
  mergeGuestCart,
  setAgentCode,
};