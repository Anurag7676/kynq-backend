// controllers/productExportController.js - COMPLETE WITH DETAILS AND SPECIFICATIONS SUPPORT
import Product from "../models/productModel.js";
import Category from "../models/categoryModel.js";
import PageContent from "../models/pageContentModel.js";
import Papa from 'papaparse';

// @desc    Export products in CSV format
// @route   GET /api/products/export/csv
// @access  Private/Admin
const exportProductsCSV = async (req, res) => {
  try {
    const {
      published,
      category,
      brand,
      requestQuote,
      hasVariations,
      limit = 1000,
      includeVariations = true
    } = req.query;

    console.log(`[PRODUCT EXPORT] Starting CSV export with filters:`, {
      published, category, brand, requestQuote, hasVariations, limit, includeVariations
    });

    // Build export data
    const exportData = await buildExportData({
      published: published === 'true' ? true : published === 'false' ? false : undefined,
      category,
      brand,
      requestQuote: requestQuote === 'true' ? true : requestQuote === 'false' ? false : undefined,
      hasVariations: hasVariations === 'true' ? true : hasVariations === 'false' ? false : undefined,
      limit: parseInt(limit),
      includeVariations: includeVariations === 'true'
    });

    // Convert to CSV
    const csv = Papa.unparse(exportData.flatRows, {
      header: true,
      quotes: true,
      quoteChar: '"',
      escapeChar: '"'
    });

    // Set response headers for CSV download
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `products_export_${timestamp}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);

  } catch (error) {
    console.error('Error exporting products to CSV:', error);
    res.status(500).json({
      success: false,
      message: "Failed to export products",
      error: error.message
    });
  }
};

// @desc    Export products in JSON format (flat structure like CSV)
// @route   GET /api/products/export/json
// @access  Private/Admin
const exportProductsJSON = async (req, res) => {
  try {
    const {
      published,
      category,
      brand,
      requestQuote,
      hasVariations,
      limit = 1000,
      includeVariations = true
    } = req.query;

    console.log(`[PRODUCT EXPORT] Starting JSON export with filters:`, {
      published, category, brand, requestQuote, hasVariations, limit, includeVariations
    });

    // Build export data
    const exportData = await buildExportData({
      published: published === 'true' ? true : published === 'false' ? false : undefined,
      category,
      brand,
      requestQuote: requestQuote === 'true' ? true : requestQuote === 'false' ? false : undefined,
      hasVariations: hasVariations === 'true' ? true : hasVariations === 'false' ? false : undefined,
      limit: parseInt(limit),
      includeVariations: includeVariations === 'true'
    });

    res.status(200).json({
      success: true,
      data: exportData.flatRows, // Each row is a flat JSON object matching CSV structure
      metadata: {
        totalProducts: exportData.totalProducts,
        parentProducts: exportData.parentProducts,
        variations: exportData.variations,
        exportedAt: new Date().toISOString(),
        filters: req.query
      }
    });

  } catch (error) {
    console.error('Error exporting products to JSON:', error);
    res.status(500).json({
      success: false,
      message: "Failed to export products",
      error: error.message
    });
  }
};

// @desc    Get export statistics
// @route   GET /api/products/export/stats
// @access  Private/Admin
const getExportStats = async (req, res) => {
  try {
    const totalProducts = await Product.countDocuments();
    const publishedProducts = await Product.countDocuments({ isPublished: true });
    const draftProducts = await Product.countDocuments({ isPublished: false });
    const requestQuoteProducts = await Product.countDocuments({ isRequestQuote: true });
    
    // Count products with variations (have PageContent with variationCombinations)
    const productsWithVariations = await PageContent.countDocuments({
      pageType: 'product',
      'content.variationCombinations.0': { $exists: true }
    });

    // Count total variations across all products
    const variationStats = await PageContent.aggregate([
      { $match: { pageType: 'product' } },
      { $project: { variationCount: { $size: { $ifNull: ['$content.variationCombinations', []] } } } },
      { $group: { _id: null, totalVariations: { $sum: '$variationCount' } } }
    ]);

    const totalVariations = variationStats[0]?.totalVariations || 0;

    // Count products with details and specifications
    const productsWithDetails = await PageContent.countDocuments({
      pageType: 'product',
      'content.tabs': {
        $elemMatch: {
          id: 'details',
          'content.items.1': { $exists: true } // More than 1 detail item means custom details
        }
      }
    });

    const productsWithSpecifications = await PageContent.countDocuments({
      pageType: 'product',
      'content.tabs': {
        $elemMatch: {
          id: 'specs',
          'content.items.5': { $exists: true } // More than basic specs means custom specs
        }
      }
    });

    // Get category breakdown
    const categoryStats = await Product.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "_id",
          as: "categoryInfo"
        }
      },
      {
        $unwind: "$categoryInfo"
      },
      {
        $project: {
          _id: 1,
          name: "$categoryInfo.name",
          count: 1
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Get brand breakdown
    const brandStats = await Product.aggregate([
      { $match: { brand: { $ne: null, $ne: "" } } },
      {
        $group: {
          _id: "$brand",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);

    res.status(200).json({
      success: true,
      stats: {
        totalProducts,
        publishedProducts,
        draftProducts,
        requestQuoteProducts,
        productsWithVariations,
        totalVariations,
        productsWithDetails, // 🆕 NEW: Details count
        productsWithSpecifications, // 🆕 NEW: Specifications count
        categoryBreakdown: categoryStats,
        brandBreakdown: brandStats,
        exportFormats: ['CSV', 'JSON'],
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error fetching export stats:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch export statistics",
      error: error.message
    });
  }
};

// @desc    Get CSV template headers (now with Details and Specifications)
// @route   GET /api/products/export/template-headers
// @access  Private/Admin
const getTemplateHeaders = async (req, res) => {
  try {
    const headers = [
      'SKU', 'Parent SKU', 'Product Name', 'Description', 'Short Description',
      'Price', 'Stock', 'Category', 'Brand', 'UOM', 'Vendor Name', 'Vendor Code',
      'Vendor Email', 'Vendor Phone', 'Vendor Address', 'Vendor SKU', 'Vendor Cost',
      'Country of Origin', 'Country Code', 'Region', 'HSN Code', 'Images', 'Shipping Time',
      'Material', 'Dimensions', 'Details', 'Specifications', 'Request Quote', 'Is Variation',
      'Variation Type 1', 'Variation Value 1', 'Variation Type 2', 'Variation Value 2',
      'Variation Type 3', 'Variation Value 3', 'Meta Title', 'Meta Description',
      'Tags', 'Features', 'Care Instructions'
    ];

    res.status(200).json({
      success: true,
      headers,
      totalColumns: headers.length
    });

  } catch (error) {
    console.error('Error fetching template headers:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch template headers",
      error: error.message
    });
  }
};

// ========================================
// MAIN EXPORT DATA BUILDER FUNCTION
// ========================================
const buildExportData = async (filters) => {
  console.log(`[EXPORT BUILDER] Building export data with filters:`, filters);

  // Build MongoDB query based on filters
  const productQuery = {};
  
  if (filters.published !== undefined) {
    productQuery.isPublished = filters.published;
  }
  
  if (filters.category) {
    const category = await Category.findOne({ name: filters.category });
    if (category) {
      productQuery.category = category._id;
    }
  }
  
  if (filters.brand) {
    productQuery.brand = filters.brand;
  }
  
  if (filters.requestQuote !== undefined) {
    productQuery.isRequestQuote = filters.requestQuote;
  }

  console.log(`[EXPORT BUILDER] MongoDB query:`, productQuery);

  // Fetch products with category and pageContent
  const products = await Product.find(productQuery)
    .populate('category', 'name slug')
    .limit(filters.limit)
    .sort({ createdAt: -1 })
    .lean();

  console.log(`[EXPORT BUILDER] Found ${products.length} products`);

  // Get PageContent for all products
  const productIds = products.map(p => `product-${p._id}`);
  const pageContents = await PageContent.find({
    pageId: { $in: productIds },
    pageType: 'product'
  }).lean();

  // Create a map for quick PageContent lookup
  const pageContentMap = new Map();
  pageContents.forEach(pc => {
    const productId = pc.pageId.replace('product-', '');
    pageContentMap.set(productId, pc);
  });

  console.log(`[EXPORT BUILDER] Found ${pageContents.length} PageContent documents`);

  // Build flat rows for export
  const flatRows = [];
  let totalVariations = 0;

  for (const product of products) {
    const pageContent = pageContentMap.get(product._id.toString());
    
    // Add parent product row
    const parentRow = await buildParentProductRow(product, pageContent);
    flatRows.push(parentRow);

    // Add variation rows if requested and available
    if (filters.includeVariations && pageContent?.content?.variationCombinations?.length > 0) {
      const variationRows = await buildVariationRows(product, pageContent);
      flatRows.push(...variationRows);
      totalVariations += variationRows.length;
    }
  }

  console.log(`[EXPORT BUILDER] Built ${flatRows.length} total rows (${products.length} parents + ${totalVariations} variations)`);

  return {
    flatRows,
    totalProducts: flatRows.length,
    parentProducts: products.length,
    variations: totalVariations
  };
};

// ========================================
// PARENT PRODUCT ROW BUILDER WITH DETAILS AND SPECIFICATIONS
// ========================================
const buildParentProductRow = async (product, pageContent) => {
  console.log(`[EXPORT BUILDER] Building parent row for: ${product.sku}`);

  // Extract rich content from PageContent including Details and Specifications
  const richContent = extractRichContent(pageContent);

  // Build the flat row object matching CSV structure exactly
  const row = {
    'SKU': product.sku || '',
    'Parent SKU': '', // Always empty for parent products
    'Product Name': product.name || '',
    'Description': richContent.description || '',
    'Short Description': product.shortDescription || '',
    'Price': product.isRequestQuote ? '0' : (product.price ? product.price.toString() : '0'),
    'Stock': product.isRequestQuote ? '999999' : (product.stock ? product.stock.toString() : '0'),
    'Category': product.category?.name || '',
    'Brand': product.brand || '',
    'UOM': product.uom || '',
    'Vendor Name': product.vendorName || '',
    'Vendor Code': product.vendorCode || '',
    'Vendor Email': product.vendorEmail || '',
    'Vendor Phone': product.vendorPhone || '',
    'Vendor Address': product.vendorAddress || '',
    'Vendor SKU': product.vendorSku || '',
    'Vendor Cost': product.vendorCost ? product.vendorCost.toString() : '',
    'Country of Origin': product.countryOfOrigin?.country || '',
    'Country Code': product.countryOfOrigin?.countryCode || '',
    'Region': product.countryOfOrigin?.region || '',
    'HSN Code': product.hsnCode || '',
    'Images': formatImages(product.images),
    'Shipping Time': product.shippingEstimatedTime || '',
    'Material': richContent.material || '',
    'Dimensions': richContent.dimensions || '',
    'Details': richContent.details || '', // 🆕 NEW: Pipe-separated details
    'Specifications': richContent.specifications || '', // 🆕 NEW: Pipe-separated specifications
    'Request Quote': product.isRequestQuote ? 'TRUE' : 'FALSE',
    'Is Variation': 'FALSE', // Always FALSE for parent products
    'Variation Type 1': '',
    'Variation Value 1': '',
    'Variation Type 2': '',
    'Variation Value 2': '',
    'Variation Type 3': '',
    'Variation Value 3': '',
    'Meta Title': product.seo?.metaTitle || '',
    'Meta Description': product.seo?.metaDescription || '',
    'Tags': formatTags(product.tags),
    'Features': richContent.features || '',
    'Care Instructions': richContent.careInstructions || ''
  };

  return row;
};

// ========================================
// VARIATION ROWS BUILDER
// ========================================
const buildVariationRows = async (parentProduct, pageContent) => {
  console.log(`[EXPORT BUILDER] Building variation rows for parent: ${parentProduct.sku}`);

  const variationRows = [];
  const variations = pageContent.content.variationCombinations || [];

  console.log(`[EXPORT BUILDER] Found ${variations.length} variations for parent ${parentProduct.sku}`);

  const variationTypeDefs = pageContent?.content?.variations || pageContent?.content?.variationTypes || [];

  for (const variation of variations) {
    // Extract variation types and values using display labels (preserves / and parentheses)
    const variationTypes = extractVariationTypes(variation.combination, variationTypeDefs);
    
    // Extract variation-specific rich content
    const variationRichContent = extractVariationRichContent(variation);
    
    console.log(`[EXPORT BUILDER] Processing variation: ${variation.sku} with parent: ${parentProduct.sku}`);
    
    // Build variation row - use variation-specific data, fallback to parent for fields not stored in variation
    const variationRow = {
      'SKU': variation.sku || '',
      'Parent SKU': parentProduct.sku || '',
      'Product Name': variation.name || generateVariationName(parentProduct.name, variation.combination, variationTypeDefs),
      'Description': variation.description || '', // ✅ Use variation-specific description
      'Short Description': variation.shortDescription || '', // ✅ Use variation-specific short description
      'Price': variation.price ? variation.price.toString() : '0',
      'Stock': variation.stockQuantity ? variation.stockQuantity.toString() : '0',
      'Category': parentProduct.category?.name || '', // Not stored in variation, use parent
      'Brand': parentProduct.brand || '', // Not stored in variation, use parent
      'UOM': variation.uom || parentProduct.uom || '', // ✅ Variation may have its own UOM
      'Vendor Name': variation.vendorName || parentProduct.vendorName || '', // ✅ Variation-specific vendor
      'Vendor Code': variation.vendorCode || parentProduct.vendorCode || '', // ✅ Variation-specific vendor
      'Vendor Email': variation.vendorEmail || parentProduct.vendorEmail || '', // ✅ Variation-specific vendor
      'Vendor Phone': variation.vendorPhone || parentProduct.vendorPhone || '', // ✅ Variation-specific vendor
      'Vendor Address': variation.vendorAddress || parentProduct.vendorAddress || '', // ✅ Variation-specific vendor
      'Vendor SKU': variation.vendorSku || parentProduct.vendorSku || '', // ✅ Variation-specific vendor
      'Vendor Cost': variation.vendorCost ? variation.vendorCost.toString() : (parentProduct.vendorCost ? parentProduct.vendorCost.toString() : ''), // ✅ Variation-specific vendor
      'Country of Origin': variation.countryOfOrigin?.country || parentProduct.countryOfOrigin?.country || '', // ✅ Variation-specific country
      'Country Code': variation.countryOfOrigin?.countryCode || parentProduct.countryOfOrigin?.countryCode || '', // ✅ Variation-specific country
      'Region': variation.countryOfOrigin?.region || parentProduct.countryOfOrigin?.region || '', // ✅ Variation-specific country
      'HSN Code': variation.hsnCode || parentProduct.hsnCode || '', // ✅ Variation-specific HSN code
      'Images': formatImages(variation.images),
      'Shipping Time': parentProduct.shippingEstimatedTime || '', // Not stored in variation, use parent
      'Material': variation.material || '', // ✅ Use variation-specific material
      'Dimensions': variation.dimensions || '', // ✅ Use variation-specific dimensions
      'Details': variationRichContent.details || '', // ✅ Format variation details array
      'Specifications': variationRichContent.specifications || '', // ✅ Format variation specifications array
      'Request Quote': 'FALSE', // Variations are typically not request quote
      'Is Variation': 'TRUE', // Always TRUE for variations
      'Variation Type 1': variationTypes.type1 || '',
      'Variation Value 1': variationTypes.value1 || '',
      'Variation Type 2': variationTypes.type2 || '',
      'Variation Value 2': variationTypes.value2 || '',
      'Variation Type 3': variationTypes.type3 || '',
      'Variation Value 3': variationTypes.value3 || '',
      'Meta Title': '', // Not stored per variation
      'Meta Description': '', // Not stored per variation
      'Tags': '', // Not stored per variation
      'Features': variationRichContent.features || '', // ✅ Format variation features array
      'Care Instructions': variationRichContent.careInstructions || '' // ✅ Format variation careInstructions array
    };

    variationRows.push(variationRow);
  }

  console.log(`[EXPORT BUILDER] Built ${variationRows.length} variation rows`);
  return variationRows;
};

// ========================================
// HELPER FUNCTIONS - UPDATED WITH DETAILS AND SPECIFICATIONS
// ========================================

// Extract rich content from variation object including Details and Specifications
const extractVariationRichContent = (variation) => {
  if (!variation) {
    return {
      details: '',
      specifications: '',
      features: '',
      careInstructions: ''
    };
  }

  let details = '';
  let specifications = '';
  let features = '';
  let careInstructions = '';

  // Format details array (array of objects with description/title)
  if (variation.details && Array.isArray(variation.details)) {
    details = variation.details
      .map(item => item.description || item.title)
      .filter(desc => desc)
      .join('|');
  }

  // Format specifications array (array of objects with label/value)
  if (variation.specifications && Array.isArray(variation.specifications)) {
    specifications = variation.specifications
      .filter(spec => spec.label && spec.value)
      .map(spec => `${spec.label}: ${spec.value}`)
      .join('|');
  }

  // Format features array (array of objects with title/description)
  if (variation.features && Array.isArray(variation.features)) {
    features = variation.features
      .map(feature => feature.title || feature.description)
      .filter(f => f)
      .join('|');
  }

  // Format careInstructions array (array of strings)
  if (variation.careInstructions && Array.isArray(variation.careInstructions)) {
    careInstructions = variation.careInstructions
      .filter(instruction => instruction)
      .join('|');
  }

  return {
    details,
    specifications,
    features,
    careInstructions
  };
};

// Extract rich content from PageContent including Details and Specifications
const extractRichContent = (pageContent) => {
  if (!pageContent?.content) {
    return {
      description: '',
      features: '',
      careInstructions: '',
      material: '',
      dimensions: '',
      details: '', // 🆕 NEW: Details extraction
      specifications: '' // 🆕 NEW: Specifications extraction
    };
  }

  const content = pageContent.content;
  let description = '';
  let features = '';
  let careInstructions = '';
  let material = '';
  let dimensions = '';
  let details = ''; // 🆕 NEW: Details variable
  let specifications = ''; // 🆕 NEW: Specifications variable

  // Extract from tabs
  if (content.tabs) {
    content.tabs.forEach(tab => {
      switch (tab.id) {
        case 'details':
          // 🆕 NEW: Extract details using pipe separation
          if (tab.content?.items) {
            details = tab.content.items
              .map(item => item.description || item.title)
              .filter(desc => desc)
              .join('|'); // Use pipe separation for details
            
            // Also extract description for backward compatibility
            description = tab.content.items
              .map(item => item.description || item.title)
              .filter(desc => desc)
              .join(',');
          }
          break;
        
        case 'care':
          if (tab.content?.items?.[0]?.features) {
            careInstructions = tab.content.items[0].features.join('|');
          }
          break;
        
        case 'specs':
          // 🆕 NEW: Extract specifications using pipe separation
          if (tab.content?.items) {
            const specsMap = {};
            const customSpecs = [];
            
            tab.content.items.forEach(item => {
              // Skip basic system specs and extract custom ones
              if (!['SKU', 'Brand', 'Unit of Measure', 'Pricing', 'Availability', 'Price', 'Stock', 'Delivery Time'].includes(item.label)) {
                if (item.label && item.value) {
                  customSpecs.push(`${item.label}: ${item.value}`);
                }
              }
              
              // Also extract material and dimensions for backward compatibility
              specsMap[item.label] = item.value;
            });
            
            specifications = customSpecs.join('|'); // Use pipe separation for specifications
            material = specsMap['Material'] || '';
            dimensions = specsMap['Dimensions'] || '';
          }
          break;
      }
    });
  }

  // Extract features
  if (content.features) {
    features = content.features
      .map(feature => feature.title || feature.description)
      .filter(f => f)
      .join('|');
  }

  return {
    description,
    features,
    careInstructions,
    material,
    dimensions,
    details, // 🆕 NEW: Return details
    specifications // 🆕 NEW: Return specifications
  };
};

// Format images array to comma-separated string (matching CSV import format)
const formatImages = (images) => {
  if (!images || !Array.isArray(images)) return '';
  return images
    .map(img => img.url || img.src)
    .filter(url => url)
    .join(',');
};

// Format tags array to comma-separated string
const formatTags = (tags) => {
  if (!tags || !Array.isArray(tags)) return '';
  return tags.join(',');
};

// Extract variation types and values from combination object.
// Use variationTypeDefs (content.variations) when available so display labels
// preserve "/" and "()" instead of normalized keys/values.
const extractVariationTypes = (combination, variationTypeDefs = []) => {
  if (!combination || typeof combination !== 'object') {
    return {
      type1: '', value1: '',
      type2: '', value2: '',
      type3: '', value3: ''
    };
  }

  const keys = Object.keys(combination);
  const result = {
    type1: '', value1: '',
    type2: '', value2: '',
    type3: '', value3: ''
  };

  const resolveLabel = (normalizedType, normalizedValue) => {
    const vt = variationTypeDefs.find((v) => (v.name || v.type) === normalizedType);
    if (vt && Array.isArray(vt.options)) {
      const opt = vt.options.find((o) => (o.value || '').toString() === (normalizedValue || '').toString());
      const typeLabel = vt.label || vt.name || normalizedType;
      const valueLabel = opt ? (opt.label || opt.value) : normalizedValue;
      return { typeLabel, valueLabel };
    }
    return {
      typeLabel: capitalizeFirst((normalizedType || '').replace(/-/g, ' ')),
      valueLabel: capitalizeFirst((normalizedValue || '').replace(/-/g, ' '))
    };
  };

  if (keys[0]) {
    const { typeLabel, valueLabel } = resolveLabel(keys[0], combination[keys[0]]);
    result.type1 = typeLabel;
    result.value1 = valueLabel;
  }
  if (keys[1]) {
    const { typeLabel, valueLabel } = resolveLabel(keys[1], combination[keys[1]]);
    result.type2 = typeLabel;
    result.value2 = valueLabel;
  }
  if (keys[2]) {
    const { typeLabel, valueLabel } = resolveLabel(keys[2], combination[keys[2]]);
    result.type3 = typeLabel;
    result.value3 = valueLabel;
  }

  return result;
};

// Generate variation name from parent name and combination.
// Uses display labels from variationTypeDefs when available to preserve / and ().
const generateVariationName = (parentName, combination, variationTypeDefs = []) => {
  if (!combination || typeof combination !== 'object') {
    return parentName;
  }

  const keys = Object.keys(combination);
  const parts = keys.map((normalizedType) => {
    const normalizedValue = combination[normalizedType];
    const vt = variationTypeDefs.find((v) => (v.name || v.type) === normalizedType);
    if (vt && Array.isArray(vt.options)) {
      const opt = vt.options.find((o) => (o.value || '').toString() === (normalizedValue || '').toString());
      return opt ? (opt.label || opt.value) : capitalizeFirst((normalizedValue || '').replace(/-/g, ' '));
    }
    return capitalizeFirst((normalizedValue || '').replace(/-/g, ' '));
  });

  return `${parentName} - ${parts.join(' / ')}`;
};

// Capitalize first letter of string
const capitalizeFirst = (str) => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export {
  exportProductsCSV,
  exportProductsJSON,
  getExportStats,
  getTemplateHeaders
};