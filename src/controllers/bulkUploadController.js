


// // controllers/bulkUploadController.js - UPDATED WITH DETAILS AND SPECIFICATIONS SUPPORT
// import AWS from 'aws-sdk';
// import Papa from 'papaparse';
// import Product from "../models/productModel.js";
// import Category from "../models/categoryModel.js";
// import PageContent from "../models/pageContentModel.js";
// import slugify from "slugify";
// import { v4 as uuidv4 } from "uuid";

// // Hardcoded S3 Configuration
// const s3 = new AWS.S3({
//   accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'your-access-key-here',
//   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'your-secret-key-here',
//   region: 'ap-south-1'
// });

// const S3_BUCKET = 'styleandhomes';

// // Helper function to normalize values for IDs and keys
// const normalizeValue = (value) => {
//   return value
//     .toLowerCase()
//     .replace(/\s+/g, '-')
//     .replace(/[^a-z0-9-]/g, '')
//     .replace(/-+/g, '-')
//     .replace(/^-|-$/g, '');
// };

// // Helper function to create combination ID from values
// const createCombinationId = (combination) => {
//   const values = Object.values(combination).map(v => normalizeValue(v));
//   return `combo-${values.join('-')}`;
// };

// // @desc    Generate presigned URL for CSV upload
// // @route   GET /api/bulk-upload/presigned-url
// // @access  Private/Admin
// const getPresignedUrl = async (req, res) => {
//   try {
//     const { fileName, fileType } = req.query;
    
//     if (!fileName || !fileType) {
//       return res.status(400).json({
//         success: false,
//         message: "fileName and fileType are required"
//       });
//     }

//     if (!fileType.includes('csv')) {
//       return res.status(400).json({
//         success: false,
//         message: "Only CSV files are allowed"
//       });
//     }

//     const key = `bulk-uploads/${Date.now()}-${fileName}`;
    
//     const signedUrl = s3.getSignedUrl('putObject', {
//       Bucket: S3_BUCKET,
//       Key: key,
//       ContentType: fileType,
//       Expires: 300,
//     });

//     res.status(200).json({
//       success: true,
//       signedUrl,
//       key,
//       expiresIn: 300
//     });
//   } catch (error) {
//     console.error('Error generating presigned URL:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to generate upload URL",
//       error: error.message
//     });
//   }
// };

// // @desc    Process bulk upload from S3 CSV
// // @route   POST /api/bulk-upload/process
// // @access  Private/Admin
// const processBulkUpload = async (req, res) => {
//   try {
//     const { s3Key, validateOnly = false } = req.body;
    
//     if (!s3Key) {
//       return res.status(400).json({
//         success: false,
//         message: "S3 key is required"
//       });
//     }

//     console.log(`[BULK UPLOAD] Starting processing for S3 key: ${s3Key}`);
//     console.log(`[BULK UPLOAD] Validation only mode: ${validateOnly}`);

//     // Download CSV from S3
//     const csvData = await downloadCSVFromS3(s3Key);
    
//     // Parse CSV dynamically
//     const parsedData = await parseCSV(csvData);
    
//     // Validate and structure data dynamically
//     const validationResult = await validateAndStructureDataDynamic(parsedData);
    
//     if (!validationResult.isValid) {
//       return res.status(400).json({
//         success: false,
//         message: "CSV validation failed",
//         errors: validationResult.errors,
//         summary: validationResult.summary
//       });
//     }

//     // If validation only, return validation results
//     if (validateOnly) {
//       return res.status(200).json({
//         success: true,
//         message: "CSV validation completed",
//         summary: validationResult.summary,
//         preview: validationResult.preview
//       });
//     }

//     // Process the upload with auto-category creation
//     const processResult = await processProductsAndContentDynamic(validationResult.structuredData, req.admin._id);
    
//     res.status(200).json({
//       success: true,
//       message: "Bulk upload completed",
//       summary: processResult.summary,
//       results: processResult.results
//     });

//   } catch (error) {
//     console.error('Error processing bulk upload:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to process bulk upload",
//       error: error.message
//     });
//   }
// };

// // @desc    Validate CSV structure without processing
// // @route   POST /api/bulk-upload/validate
// // @access  Private/Admin
// const validateCSVStructure = async (req, res) => {
//   try {
//     const { s3Key } = req.body;
    
//     if (!s3Key) {
//       return res.status(400).json({
//         success: false,
//         message: "S3 key is required"
//       });
//     }

//     console.log(`[CSV VALIDATION] Validating CSV structure for S3 key: ${s3Key}`);

//     const csvData = await downloadCSVFromS3(s3Key);
//     const parsedData = await parseCSV(csvData);
    
//     const validationResult = await validateAndStructureDataDynamic(parsedData);
    
//     res.status(200).json({
//       success: true,
//       message: "CSV validation completed",
//       isValid: validationResult.isValid,
//       errors: validationResult.errors,
//       summary: validationResult.summary,
//       preview: validationResult.preview
//     });

//   } catch (error) {
//     console.error('Error validating CSV structure:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to validate CSV structure",
//       error: error.message
//     });
//   }
// };

// // @desc    Get all draft products for bulk publishing
// // @route   GET /api/bulk-upload/drafts
// // @access  Private/Admin
// const getDraftProducts = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 20;
//     const skip = (page - 1) * limit;
    
//     // Build filter for draft products
//     const filter = { isPublished: false };
    
//     // Optional category filter
//     if (req.query.category) {
//       filter.category = req.query.category;
//     }
    
//     // Optional search
//     if (req.query.search) {
//       filter.$text = { $search: req.query.search };
//     }
    
//     // Optional brand filter
//     if (req.query.brand) {
//       filter.brand = req.query.brand;
//     }
    
//     const draftProducts = await Product.find(filter)
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit)
//       .populate('category', 'name slug')
//       .select('name slug sku price stock category createdAt images brand isRequestQuote uom');
    
//     const totalDrafts = await Product.countDocuments(filter);
    
//     // Format response with essential product info including UOM
//     const formattedProducts = draftProducts.map(product => ({
//       id: product._id,
//       name: product.name,
//       slug: product.slug,
//       sku: product.sku,
//       price: product.price,
//       stock: product.stock,
//       brand: product.brand,
//       category: product.category,
//       uom: product.uom,
//       createdAt: product.createdAt,
//       isRequestQuote: product.isRequestQuote,
//       featuredImage: product.images.find(img => img.isFeatured)?.url || product.images[0]?.url || null
//     }));
    
//     res.status(200).json({
//       success: true,
//       products: formattedProducts,
//       pagination: {
//         currentPage: page,
//         totalPages: Math.ceil(totalDrafts / limit),
//         totalCount: totalDrafts,
//         limit
//       }
//     });
    
//   } catch (error) {
//     console.error('Error fetching draft products:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch draft products",
//       error: error.message
//     });
//   }
// };

// // @desc    Bulk publish products
// // @route   POST /api/bulk-upload/publish
// // @access  Private/Admin
// const bulkPublishProducts = async (req, res) => {
//   try {
//     const { productIds, publishAll = false } = req.body;
    
//     if (!publishAll && (!productIds || !Array.isArray(productIds) || productIds.length === 0)) {
//       return res.status(400).json({
//         success: false,
//         message: "Please provide product IDs to publish or set publishAll to true"
//       });
//     }
    
//     console.log(`[BULK PUBLISH] Starting bulk publish process`);
//     console.log(`[BULK PUBLISH] Publish all: ${publishAll}`);
//     console.log(`[BULK PUBLISH] Product IDs: ${productIds?.length || 0}`);
    
//     let filter = { isPublished: false };
    
//     // If not publishing all, filter by specific IDs
//     if (!publishAll) {
//       filter._id = { $in: productIds };
//     }
    
//     // Update products to published state
//     const updateResult = await Product.updateMany(
//       filter,
//       { 
//         $set: { 
//           isPublished: true,
//           updatedAt: new Date()
//         }
//       }
//     );
    
//     console.log(`[BULK PUBLISH] Updated ${updateResult.modifiedCount} products`);
    
//     // Get the updated products for response
//     const publishedProducts = await Product.find({
//       _id: publishAll ? undefined : { $in: productIds },
//       isPublished: true
//     }).select('name slug sku');
    
//     res.status(200).json({
//       success: true,
//       message: `Successfully published ${updateResult.modifiedCount} products`,
//       summary: {
//         totalPublished: updateResult.modifiedCount,
//         publishedProducts: publishedProducts.map(p => ({
//           id: p._id,
//           name: p.name,
//           slug: p.slug,
//           sku: p.sku
//         }))
//       }
//     });
    
//   } catch (error) {
//     console.error('Error in bulk publish:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to publish products",
//       error: error.message
//     });
//   }
// };

// // @desc    Bulk unpublish products
// // @route   POST /api/bulk-upload/unpublish
// // @access  Private/Admin
// const bulkUnpublishProducts = async (req, res) => {
//   try {
//     const { productIds } = req.body;
    
//     if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Please provide product IDs to unpublish"
//       });
//     }
    
//     console.log(`[BULK UNPUBLISH] Unpublishing ${productIds.length} products`);
    
//     // Update products to unpublished state
//     const updateResult = await Product.updateMany(
//       { 
//         _id: { $in: productIds },
//         isPublished: true 
//       },
//       { 
//         $set: { 
//           isPublished: false,
//           updatedAt: new Date()
//         }
//       }
//     );
    
//     console.log(`[BULK UNPUBLISH] Updated ${updateResult.modifiedCount} products`);
    
//     res.status(200).json({
//       success: true,
//       message: `Successfully unpublished ${updateResult.modifiedCount} products`,
//       summary: {
//         totalUnpublished: updateResult.modifiedCount
//       }
//     });
    
//   } catch (error) {
//     console.error('Error in bulk unpublish:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to unpublish products",
//       error: error.message
//     });
//   }
// };

// // @desc    Get bulk publish/draft statistics
// // @route   GET /api/bulk-upload/publish-stats
// // @access  Private/Admin
// const getBulkPublishStats = async (req, res) => {
//   try {
//     const totalProducts = await Product.countDocuments();
//     const publishedProducts = await Product.countDocuments({ isPublished: true });
//     const draftProducts = await Product.countDocuments({ isPublished: false });
//     const requestQuoteProducts = await Product.countDocuments({ isRequestQuote: true });
    
//     // Get draft products by category
//     const draftsByCategory = await Product.aggregate([
//       { $match: { isPublished: false } },
//       {
//         $group: {
//           _id: "$category",
//           count: { $sum: 1 }
//         }
//       },
//       {
//         $lookup: {
//           from: "categories",
//           localField: "_id",
//           foreignField: "_id",
//           as: "categoryInfo"
//         }
//       },
//       {
//         $unwind: "$categoryInfo"
//       },
//       {
//         $project: {
//           _id: 1,
//           name: "$categoryInfo.name",
//           count: 1
//         }
//       },
//       {
//         $sort: { count: -1 }
//       }
//     ]);
    
//     // Get recent draft products
//     const recentDrafts = await Product.find({ isPublished: false })
//       .sort({ createdAt: -1 })
//       .limit(5)
//       .populate('category', 'name')
//       .select('name sku createdAt category isRequestQuote uom');
    
//     res.status(200).json({
//       success: true,
//       stats: {
//         totalProducts,
//         publishedProducts,
//         draftProducts,
//         requestQuoteProducts,
//         publishRate: totalProducts > 0 ? ((publishedProducts / totalProducts) * 100).toFixed(1) : 0,
//         draftsByCategory,
//         recentDrafts: recentDrafts.map(product => ({
//           id: product._id,
//           name: product.name,
//           sku: product.sku,
//           category: product.category?.name || 'Unknown',
//           isRequestQuote: product.isRequestQuote,
//           uom: product.uom,
//           createdAt: product.createdAt
//         }))
//       }
//     });
    
//   } catch (error) {
//     console.error('Error fetching publish stats:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch statistics",
//       error: error.message
//     });
//   }
// };

// // Helper function to download CSV from S3
// const downloadCSVFromS3 = async (key) => {
//   console.log(`[BULK UPLOAD] Downloading CSV from S3: ${key}`);
  
//   const params = {
//     Bucket: S3_BUCKET,
//     Key: key
//   };

//   const data = await s3.getObject(params).promise();
//   return data.Body.toString('utf-8');
// };

// // Helper function to parse CSV using Papa Parse
// const parseCSV = async (csvData) => {
//   console.log(`[BULK UPLOAD] Parsing CSV data`);
  
//   return new Promise((resolve, reject) => {
//     Papa.parse(csvData, {
//       header: true,
//       skipEmptyLines: true,
//       transformHeader: (header) => header.trim(),
//       complete: (results) => {
//         if (results.errors.length > 0) {
//           console.log(`[BULK UPLOAD] CSV parsing errors:`, results.errors);
//         }
//         resolve(results.data);
//       },
//       error: (error) => {
//         reject(error);
//       }
//     });
//   });
// };

// // 🆕 UPDATED: Dynamic validation function with Details and Specifications support
// const validateAndStructureDataDynamic = async (csvRows) => {
//   console.log(`[BULK UPLOAD] Dynamically validating ${csvRows.length} CSV rows`);
  
//   const errors = [];
//   const parentProducts = [];
//   const variationsMap = new Map();
//   const categoriesNeeded = new Set();
//   const warnings = [];
  
//   // First pass: separate parents and variations dynamically
//   csvRows.forEach((row, index) => {
//     const rowNum = index + 2;
    
//     try {
//       const isVariation = row['Is Variation']?.toString().toUpperCase() === 'TRUE';
//       const isRequestQuote = row['Request Quote']?.toString().toUpperCase() === 'TRUE';
      
//       if (isVariation) {
//         const parentSku = row['Parent SKU']?.trim();
//         if (!parentSku) {
//           errors.push(`Row ${rowNum}: Variation row missing Parent SKU`);
//           return;
//         }
        
//         if (!variationsMap.has(parentSku)) {
//           variationsMap.set(parentSku, []);
//         }
//         variationsMap.get(parentSku).push({ ...row, rowNum });
//       } else {
//         // Parent product
//         const sku = row.SKU?.trim();
//         if (!sku) {
//           errors.push(`Row ${rowNum}: Parent product missing SKU`);
//           return;
//         }
        
//         // Validate Request Quote logic
//         if (isRequestQuote) {
//           console.log(`[BULK UPLOAD] Row ${rowNum}: Request Quote product detected - ${row['Product Name']} ${row.UOM ? `(UOM: ${row.UOM})` : ''}`);
//         } else {
//           // For regular products, validate price and stock
//           if (!row.Price || isNaN(parseFloat(row.Price))) {
//             errors.push(`Row ${rowNum}: Regular product missing valid price`);
//           }
          
//           if (!row.Stock || isNaN(parseInt(row.Stock))) {
//             errors.push(`Row ${rowNum}: Regular product missing valid stock quantity`);
//           }
//         }
        
//         // Validate UOM if provided
//         if (row.UOM && row.UOM.trim()) {
//           const uomValue = row.UOM.trim();
//           if (uomValue.length > 50) {
//             errors.push(`Row ${rowNum}: UOM too long (max 50 characters)`);
//           }
//           console.log(`[BULK UPLOAD] Row ${rowNum}: UOM detected - ${uomValue}`);
//         }
        
//         // 🆕 NEW: Validate Details column if provided
//         if (row.Details && row.Details.trim()) {
//           const detailsValue = row.Details.trim();
//           // Basic validation - check if pipe-separated
//           if (detailsValue.includes('|')) {
//             console.log(`[BULK UPLOAD] Row ${rowNum}: Details detected (${detailsValue.split('|').length} items)`);
//           } else {
//             console.log(`[BULK UPLOAD] Row ${rowNum}: Details detected (single item)`);
//           }
//         }
        
//         // 🆕 NEW: Validate Specifications column if provided
//         if (row.Specifications && row.Specifications.trim()) {
//           const specificationsValue = row.Specifications.trim();
//           // Basic validation - check if pipe-separated
//           if (specificationsValue.includes('|')) {
//             console.log(`[BULK UPLOAD] Row ${rowNum}: Specifications detected (${specificationsValue.split('|').length} items)`);
//           } else {
//             console.log(`[BULK UPLOAD] Row ${rowNum}: Specifications detected (single item)`);
//           }
//         }
        
//         // Validate vendor data if provided
//         if (row['Vendor Code'] && row['Vendor Code'].trim()) {
//           const vendorCode = row['Vendor Code'].trim();
//           if (vendorCode.length < 1) {
//             errors.push(`Row ${rowNum}: Vendor code cannot be empty`);
//           }
//           console.log(`[BULK UPLOAD] Row ${rowNum}: Vendor code detected - ${vendorCode}`);
//         }
        
//         if (row['Vendor Email'] && row['Vendor Email'].trim()) {
//           const email = row['Vendor Email'].trim().toLowerCase();
//           const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//           if (!emailRegex.test(email)) {
//             errors.push(`Row ${rowNum}: Invalid vendor email format`);
//           }
//         }
        
//         // Validate country of origin data if provided
//         if (row['Country Code'] && row['Country Code'].trim()) {
//           const countryCode = row['Country Code'].trim().toUpperCase();
//           if (countryCode.length !== 2 && countryCode.length !== 3) {
//             errors.push(`Row ${rowNum}: Country code must be 2 or 3 characters long`);
//           }
//           if (!/^[A-Z]+$/.test(countryCode)) {
//             errors.push(`Row ${rowNum}: Country code must contain only letters`);
//           }
//           console.log(`[BULK UPLOAD] Row ${rowNum}: Country code detected - ${countryCode}`);
//         }
        
//         parentProducts.push({ ...row, rowNum });
//       }
      
//       // Collect categories for validation/creation
//       if (row.Category?.trim()) {
//         categoriesNeeded.add(row.Category.trim());
//       }
      
//     } catch (error) {
//       errors.push(`Row ${rowNum}: ${error.message}`);
//     }
//   });
  
//   // DYNAMIC category handling - create missing categories
//   const categoryValidation = await validateOrCreateCategories(Array.from(categoriesNeeded));
  
//   // Add warnings for created categories instead of errors
//   if (categoryValidation.created.length > 0) {
//     warnings.push(`Auto-created categories: ${categoryValidation.created.join(', ')}`);
//   }
  
//   // DYNAMIC variation validation
//   for (const parentProduct of parentProducts) {
//     const parentSku = parentProduct.SKU?.trim();
//     const variations = variationsMap.get(parentSku) || [];
    
//     if (variations.length > 0) {
//       const variationErrors = validateVariationStructureDynamic(parentProduct, variations);
//       errors.push(...variationErrors);
//     }
//   }
  
//   // Count products with new fields
//   const requestQuoteCount = parentProducts.filter(product => 
//     product['Request Quote']?.toString().toUpperCase() === 'TRUE'
//   ).length;
  
//   const productsWithUOM = parentProducts.filter(product => 
//     product.UOM && product.UOM.trim()
//   ).length;
  
//   const productsWithVendor = parentProducts.filter(product => 
//     product['Vendor Code'] && product['Vendor Code'].trim()
//   ).length;
  
//   const productsWithCountryOfOrigin = parentProducts.filter(product => 
//     product['Country of Origin'] && product['Country of Origin'].trim()
//   ).length;
  
//   // 🆕 NEW: Count products with Details and Specifications
//   const productsWithDetails = parentProducts.filter(product => 
//     product.Details && product.Details.trim()
//   ).length;
  
//   const productsWithSpecifications = parentProducts.filter(product => 
//     product.Specifications && product.Specifications.trim()
//   ).length;
  
//   const summary = {
//     totalRows: csvRows.length,
//     parentProducts: parentProducts.length,
//     requestQuoteProducts: requestQuoteCount,
//     regularProducts: parentProducts.length - requestQuoteCount,
//     productsWithUOM: productsWithUOM,
//     productsWithVendor: productsWithVendor,
//     productsWithCountryOfOrigin: productsWithCountryOfOrigin,
//     productsWithDetails: productsWithDetails, // 🆕 NEW: Details count
//     productsWithSpecifications: productsWithSpecifications, // 🆕 NEW: Specifications count
//     totalVariations: Array.from(variationsMap.values()).reduce((sum, variations) => sum + variations.length, 0),
//     categoriesFound: categoryValidation.found.length,
//     categoriesCreated: categoryValidation.created.length,
//     errorsCount: errors.length,
//     warningsCount: warnings.length
//   };
  
//   const preview = parentProducts.slice(0, 5).map(product => ({
//     sku: product.SKU,
//     name: product['Product Name'],
//     category: product.Category,
//     isRequestQuote: product['Request Quote']?.toString().toUpperCase() === 'TRUE',
//     uom: product.UOM?.trim() || null,
//     vendorCode: product['Vendor Code']?.trim() || null,
//     countryOfOrigin: product['Country of Origin']?.trim() || null,
//     details: product.Details?.trim() || null, // 🆕 NEW: Include details in preview
//     specifications: product.Specifications?.trim() || null, // 🆕 NEW: Include specifications in preview
//     price: product.Price,
//     variations: variationsMap.get(product.SKU?.trim())?.length || 0
//   }));
  
//   return {
//     isValid: errors.length === 0,
//     errors,
//     warnings,
//     summary,
//     preview,
//     structuredData: {
//       parentProducts,
//       variationsMap,
//       categoriesMap: categoryValidation.categoriesMap
//     }
//   };
// };

// // DYNAMIC category validation/creation
// const validateOrCreateCategories = async (categoryNames) => {
//   const found = [];
//   const created = [];
//   const categoriesMap = new Map();
  
//   for (const categoryName of categoryNames) {
//     let category = await Category.findOne({ name: categoryName });
    
//     if (category) {
//       found.push(categoryName);
//       categoriesMap.set(categoryName, category);
//     } else {
//       // AUTO-CREATE missing category
//       console.log(`[BULK UPLOAD] Auto-creating category: ${categoryName}`);
      
//       try {
//         category = await Category.create({
//           name: categoryName,
//           slug: slugify(categoryName, { lower: true }),
//           description: `Auto-created category for ${categoryName}`,
//           isActive: true,
//           displayOrder: 0
//         });
        
//         created.push(categoryName);
//         categoriesMap.set(categoryName, category);
        
//         console.log(`[BULK UPLOAD] Successfully created category: ${categoryName}`);
//       } catch (error) {
//         console.error(`[BULK UPLOAD] Failed to create category ${categoryName}:`, error);
//       }
//     }
//   }
  
//   return { found, created, categoriesMap };
// };

// // DYNAMIC variation validation
// const validateVariationStructureDynamic = (parentProduct, variations) => {
//   const errors = [];
//   const parentSku = parentProduct.SKU?.trim();
  
//   // Extract all variation columns dynamically
//   const variationColumns = {};
  
//   variations.forEach((variation, index) => {
//     // Find all "Variation Type X" and "Variation Value X" columns
//     Object.keys(variation).forEach(key => {
//       if (key.startsWith('Variation Type') && variation[key]?.trim()) {
//         const typeNum = key.replace('Variation Type ', '');
//         const valueKey = `Variation Value ${typeNum}`;
//         const typeValue = variation[key].trim();
//         const varValue = variation[valueKey]?.trim();
        
//         if (typeValue && varValue) {
//           if (!variationColumns[typeValue]) {
//             variationColumns[typeValue] = new Set();
//           }
//           variationColumns[typeValue].add(varValue);
//         }
//       }
//     });
    
//     // Validate required fields for variations
//     if (!variation.SKU?.trim()) {
//       errors.push(`Variation ${index + 1} for parent ${parentSku}: Missing SKU`);
//     }
    
//     if (!variation.Price || isNaN(parseFloat(variation.Price))) {
//       errors.push(`Variation ${index + 1} for parent ${parentSku}: Invalid or missing price`);
//     }
//   });
  
//   console.log(`[BULK UPLOAD] Found variation types for ${parentSku}:`, Object.keys(variationColumns));
  
//   return errors;
// };

// // DYNAMIC product and content processing with UPDATE SUPPORT
// const processProductsAndContentDynamic = async (structuredData, adminId) => {
//   const { parentProducts, variationsMap, categoriesMap } = structuredData;
//   const results = {
//     productsCreated: 0,
//     productsUpdated: 0,
//     pageContentCreated: 0,
//     pageContentUpdated: 0,
//     requestQuoteProductsCreated: 0,
//     requestQuoteProductsUpdated: 0,
//     productsWithUOMCreated: 0,
//     productsWithUOMUpdated: 0,
//     productsWithDetailsCreated: 0, // 🆕 NEW: Details count
//     productsWithDetailsUpdated: 0, // 🆕 NEW: Details count
//     productsWithSpecificationsCreated: 0, // 🆕 NEW: Specifications count
//     productsWithSpecificationsUpdated: 0, // 🆕 NEW: Specifications count
//     errors: [],
//     success: []
//   };
  
//   for (const parentProductRow of parentProducts) {
//     try {
//       console.log(`[BULK UPLOAD] Processing product: ${parentProductRow['Product Name']}`);
      
//       // Check if product already exists
//       const existingProduct = await Product.findOne({ sku: parentProductRow.SKU?.trim() });
//       const isUpdate = !!existingProduct;
//       const isRequestQuote = parentProductRow['Request Quote']?.toString().toUpperCase() === 'TRUE';
//       const hasUOM = parentProductRow.UOM && parentProductRow.UOM.trim();
//       const hasDetails = parentProductRow.Details && parentProductRow.Details.trim();
//       const hasSpecifications = parentProductRow.Specifications && parentProductRow.Specifications.trim();
      
//       // Create or update product
//       const product = await createProductFromRowDynamic(parentProductRow, categoriesMap, adminId);
//       const variations = variationsMap.get(parentProductRow.SKU?.trim()) || [];
      
//       // Create or update PageContent
//       const pageContentId = `product-${product._id}`;
//       const existingPageContent = await PageContent.findOne({
//         pageId: pageContentId,
//         pageType: 'product'
//       });
      
//       const pageContent = await createPageContentFromRowDynamic(product, parentProductRow, variations);
      
//       // Update counters
//       if (isUpdate) {
//         results.productsUpdated++;
//         if (isRequestQuote) {
//           results.requestQuoteProductsUpdated++;
//         }
//         if (hasUOM) {
//           results.productsWithUOMUpdated++;
//         }
//         if (hasDetails) {
//           results.productsWithDetailsUpdated++; // 🆕 NEW: Count details updates
//         }
//         if (hasSpecifications) {
//           results.productsWithSpecificationsUpdated++; // 🆕 NEW: Count specifications updates
//         }
//         results.success.push(`Successfully updated: ${product.name} (${product.sku})${isRequestQuote ? ' [Request Quote]' : ''}${hasUOM ? ` [UOM: ${product.uom}]` : ''}${hasDetails ? ' [Details]' : ''}${hasSpecifications ? ' [Specifications]' : ''}`);
//       } else {
//         results.productsCreated++;
//         if (isRequestQuote) {
//           results.requestQuoteProductsCreated++;
//         }
//         if (hasUOM) {
//           results.productsWithUOMCreated++;
//         }
//         if (hasDetails) {
//           results.productsWithDetailsCreated++; // 🆕 NEW: Count details creations
//         }
//         if (hasSpecifications) {
//           results.productsWithSpecificationsCreated++; // 🆕 NEW: Count specifications creations
//         }
//         results.success.push(`Successfully created (draft): ${product.name} (${product.sku})${isRequestQuote ? ' [Request Quote]' : ''}${hasUOM ? ` [UOM: ${product.uom}]` : ''}${hasDetails ? ' [Details]' : ''}${hasSpecifications ? ' [Specifications]' : ''}`);
//       }
      
//       if (existingPageContent) {
//         results.pageContentUpdated++;
//       } else {
//         results.pageContentCreated++;
//       }
      
//     } catch (error) {
//       console.error(`[BULK UPLOAD] Error processing ${parentProductRow['Product Name']}:`, error);
//       results.errors.push(`Failed to process ${parentProductRow['Product Name']}: ${error.message}`);
//     }
//   }
  
//   const summary = {
//     totalProcessed: parentProducts.length,
//     successful: results.productsCreated + results.productsUpdated,
//     failed: results.errors.length,
//     productsCreated: results.productsCreated,
//     productsUpdated: results.productsUpdated,
//     requestQuoteProductsCreated: results.requestQuoteProductsCreated,
//     requestQuoteProductsUpdated: results.requestQuoteProductsUpdated,
//     productsWithUOMCreated: results.productsWithUOMCreated,
//     productsWithUOMUpdated: results.productsWithUOMUpdated,
//     productsWithDetailsCreated: results.productsWithDetailsCreated, // 🆕 NEW: Details counts in summary
//     productsWithDetailsUpdated: results.productsWithDetailsUpdated, // 🆕 NEW: Details counts in summary
//     productsWithSpecificationsCreated: results.productsWithSpecificationsCreated, // 🆕 NEW: Specifications counts in summary
//     productsWithSpecificationsUpdated: results.productsWithSpecificationsUpdated, // 🆕 NEW: Specifications counts in summary
//     pageContentCreated: results.pageContentCreated,
//     pageContentUpdated: results.pageContentUpdated,
//     note: "New products created in draft state. Updated products keep their original published status. Request Quote products have price=0 and stock=999999. UOM, Details, and Specifications fields are preserved for all products."
//   };
  
//   return { summary, results };
// };

// // 🆕 UPDATED - Product creation/update with UOM, Details, and Specifications support
// const createProductFromRowDynamic = async (row, categoriesMap, adminId) => {
//   const category = categoriesMap.get(row.Category?.trim());
//   const slug = slugify(row['Product Name'], { lower: true });
  
//   // Check if this is a request quote product
//   const isRequestQuote = row['Request Quote']?.toString().toUpperCase() === 'TRUE';
  
//   // Check for existing product by SKU first, then by slug
//   let existingProduct = await Product.findOne({ sku: row.SKU?.trim() });
  
//   if (!existingProduct) {
//     // If no product found by SKU, check by slug to avoid slug conflicts
//     existingProduct = await Product.findOne({ slug });
//   }
  
//   const isUpdate = !!existingProduct;
  
//   // Process images
//   const images = row.Images ? 
//     row.Images.split(',').map((url, index) => ({
//       url: url.trim(),
//       alt: `${row['Product Name']} image ${index + 1}`,
//       isFeatured: index === 0
//     })) : [];
  
//   // Process shipping info (keeping original structure)
//   const shippingInfo = {
//     weight: 0, // Default weight
//     dimensions: {
//       length: 0,
//       width: 0,
//       height: 0
//     },
//     freeShipping: false
//   };
  
//   const productData = {
//     name: row['Product Name'],
//     slug,
//     description: row.Description || '',
//     shortDescription: row['Short Description'] || '',
//     // Handle Request Quote logic for price and stock
//     isRequestQuote: isRequestQuote,
//     price: isRequestQuote ? 0 : (parseFloat(row.Price) || 0),
//     comparePrice: isRequestQuote ? 0 : (parseFloat(row.Price) || 0),
//     category: category._id,
//     brand: row.Brand || '',
//     sku: row.SKU,
//     stock: isRequestQuote ? 999999 : (parseInt(row.Stock) || 0),
//     // Add UOM support from CSV
//     uom: row.UOM?.trim() || null,
//     // Add vendor details from CSV
//     vendorName: row['Vendor Name']?.trim() || null,
//     vendorCode: row['Vendor Code']?.trim() || null,
//     vendorEmail: row['Vendor Email']?.trim()?.toLowerCase() || null,
//     vendorPhone: row['Vendor Phone']?.trim() || null,
//     vendorAddress: row['Vendor Address']?.trim() || null,
//     // Add vendor SKU information from CSV
//     vendorSku: row['Vendor SKU']?.trim() || null,
//     // Add country of origin details from CSV
//     countryOfOrigin: row['Country of Origin'] || row['Country Code'] || row['Region'] ? {
//       country: row['Country of Origin']?.trim() || null,
//       countryCode: row['Country Code']?.trim()?.toUpperCase() || null,
//       region: row['Region']?.trim() || null,
//     } : null,
//     images,
//     tags: row.Tags ? row.Tags.split(',').map(tag => tag.trim()) : [],
//     shippingInfo, // Original shipping info structure
//     // Separate shipping estimated time field
//     shippingEstimatedTime: row['Shipping Time']?.trim() || null,
//     seo: {
//       metaTitle: row['Meta Title'] || row['Product Name'],
//       metaDescription: row['Meta Description'] || row['Short Description'] || '',
//       metaKeywords: row['Meta Keywords'] ? row['Meta Keywords'].split(',').map(kw => kw.trim()) : []
//     },
//     updatedAt: new Date()
//   };

//   if (isUpdate) {
//     // UPDATE EXISTING PRODUCT
//     console.log(`[BULK UPLOAD] Updating existing product: ${existingProduct.sku} (Request Quote: ${isRequestQuote}, UOM: ${productData.uom})`);
    
//     // Update all fields except createdBy and isPublished (keep original values)
//     Object.keys(productData).forEach(key => {
//       if (key !== 'createdBy') {
//         existingProduct[key] = productData[key];
//       }
//     });
    
//     // Don't change published status during bulk update - keep original
//     // isPublished remains as it was
    
//     return await existingProduct.save();
//   } else {
//     // CREATE NEW PRODUCT
//     console.log(`[BULK UPLOAD] Creating new product: ${row.SKU} (Request Quote: ${isRequestQuote}, UOM: ${productData.uom})`);
    
//     // Add creation-specific fields
//     productData.isPublished = false; // New products are draft by default
//     productData.createdBy = adminId;
    
//     return await Product.create(productData);
//   }
// };

// // 🆕 UPDATED PageContent creation with UOM, Details, and Specifications support
// const createPageContentFromRowDynamic = async (product, parentRow, variations) => {
//   const pageContentId = `product-${product._id}`;
  
//   // Check if PageContent already exists
//   const existingPageContent = await PageContent.findOne({
//     pageId: pageContentId,
//     pageType: 'product'
//   });
  
//   // DYNAMICALLY build variation combinations with IMAGES
//   const variationCombinations = [];
//   const variationTypes = [];
  
//   if (variations.length > 0) {
//     console.log(`[BULK UPLOAD] Processing ${variations.length} variations for ${product.name}`);
    
//     // DYNAMICALLY extract ALL variation types with correct format
//     const variationTypesMap = new Map();
    
//     variations.forEach(variation => {
//       // Find all "Variation Type X" columns dynamically
//       Object.keys(variation).forEach(key => {
//         if (key.startsWith('Variation Type') && variation[key]?.trim()) {
//           const typeNum = key.replace('Variation Type ', '');
//           const valueKey = `Variation Value ${typeNum}`;
//           const typeName = variation[key].trim();
//           const typeValue = variation[valueKey]?.trim();
          
//           if (typeName && typeValue) {
//             if (!variationTypesMap.has(typeName)) {
//               variationTypesMap.set(typeName, new Set());
//             }
//             variationTypesMap.get(typeName).add(typeValue);
//           }
//         }
//       });
//     });
    
//     // Build variation types structure in EXACT format
//     let displayOrder = 0;
//     variationTypesMap.forEach((values, typeName) => {
//       const normalizedTypeName = normalizeValue(typeName);
      
//       const variationOptions = Array.from(values).map((value, index) => ({
//         id: `${normalizedTypeName}-${normalizeValue(value)}`,
//         label: value,
//         value: normalizeValue(value),
//         isDefault: index === 0, // First option is default
//         order: index
//       }));
      
//       variationTypes.push({
//         id: `variation-${normalizedTypeName}`,
//         type: normalizedTypeName,
//         label: typeName,
//         name: normalizedTypeName,
//         options: variationOptions,
//         displayOrder: displayOrder++,
//         isActive: true
//       });
//     });
    
//     console.log(`[BULK UPLOAD] Built ${variationTypes.length} variation types with exact format`);
    
//     // Build combinations DYNAMICALLY with IMAGES SUPPORT
//     variations.forEach(variation => {
//       const combination = {};
      
//       // Extract all variation type-value pairs for this combination
//       Object.keys(variation).forEach(key => {
//         if (key.startsWith('Variation Type') && variation[key]?.trim()) {
//           const typeNum = key.replace('Variation Type ', '');
//           const valueKey = `Variation Value ${typeNum}`;
//           const typeName = variation[key].trim();
//           const typeValue = variation[valueKey]?.trim();
          
//           if (typeName && typeValue) {
//             const normalizedTypeName = normalizeValue(typeName);
//             const normalizedValue = normalizeValue(typeValue);
//             combination[normalizedTypeName] = normalizedValue;
//           }
//         }
//       });
      
//       if (Object.keys(combination).length > 0) {
//         const combinationId = createCombinationId(combination);
        
//         // PROCESS VARIATION IMAGES FROM CSV
//         const variationImages = variation.Images ? 
//           variation.Images.split(',').map((url, index) => ({
//             id: `${combinationId}-img-${index}`,
//             src: url.trim(),
//             alt: `${variation.SKU} image ${index + 1}`,
//             isFeatured: index === 0,
//             order: index
//           })) : [];
        
//         variationCombinations.push({
//           id: combinationId,
//           combination,
//           sku: variation.SKU,
//           price: parseFloat(variation.Price) || 0,
//           stockQuantity: parseInt(variation.Stock) || 0,
//           isEnabled: true,
//           // ADD IMAGES TO VARIATION COMBINATIONS
//           images: variationImages
//         });
//       }
//     });
    
//     console.log(`[BULK UPLOAD] Created ${variationCombinations.length} variation combinations with images`);
//   }
  
//   // Build features from CSV - Each comma-separated feature as individual section
//   const features = parentRow.Features ? 
//     parentRow.Features.split(',').map((feature, index) => ({
//       id: `feature-${index + 1}`,
//       icon: "✦",
//       title: feature.trim(),
//       description: "",
//       order: index,
//       isActive: true
//     })) : [];
  
//   // Build care instructions - Each comma-separated instruction as individual section
//   const careInstructions = parentRow['Care Instructions'] ? 
//     parentRow['Care Instructions'].split(',').map(instruction => instruction.trim()) : [];
  
//   // 🆕 NEW: Build details from CSV - Each pipe-separated detail as individual section
//   const detailsItems = parentRow.Details ? 
//     parentRow.Details.split('|').map((detail, index) => ({
//       id: `details-${index + 1}`,
//       title: `Detail ${index + 1}`,
//       description: detail.trim(),
//       features: [],
//       order: index
//     })) : [{
//       id: "details-1",
//       title: "Specifications",
//       description: product.description,
//       features: [],
//       order: 0
//     }];
  
//   // Build specs items dynamically with shipping time, UOM, and Request Quote support
//   const specsItems = [
//     {
//       label: "SKU",
//       value: product.sku
//     },
//     {
//       label: "Brand",
//       value: product.brand || "Style n Homes"
//     }
//   ];
  
//   // Add UOM to specifications if available
//   if (product.uom && product.uom.trim()) {
//     specsItems.push({
//       label: "Unit of Measure",
//       value: product.uom
//     });
//   }
  
//   // Handle Request Quote products differently in specs
//   if (product.isRequestQuote) {
//     specsItems.push({
//       label: "Pricing",
//       value: "Request Quote"
//     });
//     specsItems.push({
//       label: "Availability",
//       value: "Made to Order"
//     });
//   } else {
//     specsItems.push({
//       label: "Price",
//       value: product.price.toString()
//     });
//     specsItems.push({
//       label: "Stock",
//       value: product.stock.toString()
//     });
//   }
  
//   // Add shipping estimated time to specs if available
//   if (product.shippingEstimatedTime) {
//     specsItems.push({
//       label: "Delivery Time",
//       value: product.shippingEstimatedTime
//     });
//   }
  
//   // Add other specs from CSV if available
//   if (parentRow.Material?.trim()) {
//     specsItems.push({
//       label: "Material",
//       value: parentRow.Material.trim()
//     });
//   }
  
//   if (parentRow.Dimensions?.trim()) {
//     specsItems.push({
//       label: "Dimensions",
//       value: parentRow.Dimensions.trim()
//     });
//   }
  
//   if (parentRow['Country of Origin']?.trim()) {
//     specsItems.push({
//       label: "Country of Origin",
//       value: parentRow['Country of Origin'].trim()
//     });
//   }
  
//   // 🆕 NEW: Add specifications from CSV using pipe separation
//   if (parentRow.Specifications && parentRow.Specifications.trim()) {
//     const specificationsFromCSV = parentRow.Specifications.split('|').map(spec => {
//       const specTrimmed = spec.trim();
//       // Try to split by colon to get label:value pairs
//       if (specTrimmed.includes(':')) {
//         const [label, value] = specTrimmed.split(':').map(s => s.trim());
//         return { label, value };
//       } else {
//         // If no colon, use the whole string as value with a generic label
//         return { label: "Additional Specification", value: specTrimmed };
//       }
//     });
    
//     specsItems.push(...specificationsFromCSV);
//   }
  
//   const content = {
//     productId: product._id.toString(),
//     productName: product.name,
//     shortDescription: product.shortDescription,
//     fullDescription: product.description,
//     sku: product.sku,
//     basePrice: product.price,
//     currency: "USD",
//     // Update hero section for Request Quote products and UOM
//     heroTitle: product.isRequestQuote ? `${product.name} - Request Quote` : product.name,
//     heroSubtitle: product.isRequestQuote ? 
//       `${product.shortDescription} - Contact us for custom pricing${product.uom ? ` (${product.uom})` : ''}` : 
//       `${product.shortDescription}${product.uom ? ` (${product.uom})` : ''}`,
//     heroBackgroundImage: product.images.length > 0 ? product.images[0].url : null,
//     breadcrumbs: [
//       { label: "Home", href: "/" },
//       { label: "Products", href: "/products" },
//       { label: product.name, href: "#" }
//     ],
//     productImages: product.images.map((img, index) => ({
//       id: `img-${index}`,
//       src: img.url,
//       alt: img.alt,
//       isFeatured: img.isFeatured,
//       order: index
//     })),
//     variations: variationTypes,
//     variationCombinations, // Now includes images
//     tabs: [
//       {
//         id: "details",
//         label: "Details",
//         isActive: true,
//         order: 0,
//         content: {
//           type: "details",
//           title: "About the Product",
//           description: "Product details and specifications",
//           items: detailsItems // 🆕 NEW: Use pipe-separated details from CSV
//         }
//       },
//       // UPDATED: Specs tab with Request Quote, UOM, and pipe-separated specifications support
//       {
//         id: "specs",
//         label: "Specifications",
//         isActive: true,
//         order: 2,
//         content: {
//           type: "specs",
//           items: specsItems
//         }
//       }
//     ],
//     featuresTitle: "Features & Benefits",
//     featuresSubtitle: "Discover what makes this product special",
//     features,
//     relatedProductsTitle: "You May Also Like",
//     relatedProductIds: [],
//     metaTitle: product.seo.metaTitle,
//     metaDescription: product.seo.metaDescription,
//     metaKeywords: product.seo.metaKeywords,
//     isActive: true,
//     // Add Request Quote and UOM flags to content
//     isRequestQuote: product.isRequestQuote,
//     uom: product.uom || null
//   };
  
//   // Add care instructions tab if available
//   if (careInstructions.length > 0) {
//     content.tabs.push({
//       id: "care",
//       label: "Care Instructions",
//       isActive: true,
//       order: 1,
//       content: {
//         type: "care",
//         items: [{
//           id: "care-1",
//           features: careInstructions,
//           order: 0
//         }]
//       }
//     });
//   }
  
//   // Update or create PageContent
//   if (existingPageContent) {
//     // UPDATE existing PageContent
//     console.log(`[BULK UPLOAD] Updating existing PageContent for: ${product.sku} ${product.uom ? `(UOM: ${product.uom})` : ''}`);
//     existingPageContent.content = content;
//     existingPageContent.title = product.name;
//     existingPageContent.updatedAt = new Date();
//     return await existingPageContent.save();
//   } else {
//     // CREATE new PageContent
//     console.log(`[BULK UPLOAD] Creating new PageContent for: ${product.sku} ${product.uom ? `(UOM: ${product.uom})` : ''}`);
//     const pageContent = new PageContent({
//       pageId: pageContentId,
//       pageType: "product",
//       title: product.name,
//       content,
//       updatedBy: product.createdBy
//     });
    
//     return await pageContent.save();
//   }
// };

// // Other controller functions remain the same...
// const getBulkUploadHistory = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;

//     const mockHistory = [
//       {
//         id: "upload_1",
//         fileName: "products_batch_1.csv",
//         uploadedAt: new Date(),
//         uploadedBy: req.admin._id,
//         status: "completed",
//         summary: {
//           totalRows: 150,
//           successful: 145,
//           failed: 5,
//           productsCreated: 145,
//           requestQuoteProductsCreated: 12,
//           productsWithUOMCreated: 87,
//           productsWithDetailsCreated: 67, // 🆕 NEW: Details count in history
//           productsWithSpecificationsCreated: 89, // 🆕 NEW: Specifications count in history
//           pageContentCreated: 145
//         }
//       }
//     ];

//     res.status(200).json({
//       success: true,
//       history: mockHistory,
//       pagination: {
//         currentPage: page,
//         totalPages: Math.ceil(mockHistory.length / limit),
//         totalCount: mockHistory.length,
//         limit
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching bulk upload history:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch upload history",
//       error: error.message
//     });
//   }
// };

// const getBulkUploadStatus = async (req, res) => {
//   try {
//     const { jobId } = req.params;
    
//     const mockStatus = {
//       jobId,
//       status: "processing",
//       progress: {
//         totalItems: 100,
//         processedItems: 75,
//         successfulItems: 73,
//         failedItems: 2,
//         percentage: 75
//       },
//       startedAt: new Date(Date.now() - 300000),
//       estimatedCompletion: new Date(Date.now() + 60000),
//       errors: []
//     };

//     res.status(200).json({
//       success: true,
//       status: mockStatus
//     });

//   } catch (error) {
//     console.error('Error fetching job status:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch job status",
//       error: error.message
//     });
//   }
// };

// // 🆕 UPDATED: Download template with Details and Specifications columns
// const downloadTemplate = async (req, res) => {
//   try {
//     const template = `SKU,Parent SKU,Product Name,Description,Short Description,Price,Stock,Category,Brand,UOM,Vendor Name,Vendor Code,Vendor Email,Vendor Phone,Vendor Address,Vendor SKU,Country of Origin,Country Code,Region,Images,Shipping Time,Material,Dimensions,Details,Specifications,Request Quote,Is Variation,Variation Type 1,Variation Value 1,Variation Type 2,Variation Value 2,Variation Type 3,Variation Value 3,Meta Title,Meta Description,Tags,Features,Care Instructions
// RU-AST-173,,Astral Modern Area Rug,Inspired by celestial patterns and contemporary elegance,A hand-tufted wool rug with a celestial modern design,260,10,Rugs,Style n Homes,piece,ABC Suppliers,ABC001,supplier@abc.com,+91-9876543210,123 Main Street Mumbai India,Available,China,CN,Asia,https://example.com/image1.jpg,https://example.com/image2.jpg,3-5 business days,New Zealand Wool,300x400cm,Handtufted craftsmanship using new zealand wool|Premium handtufted construction|Elegant design with premium material blend,Material: New Zealand Wool|Construction: Handtufted|Size: 8x10ft / 240x300cm|Brand: Shanghai Fuli brocart Carpet Industry Co Ltd.|Country of Origin: China|Delivery Time: 60 days,FALSE,FALSE,,,,,,,Astral Modern Area Rug - Premium Hand-Tufted Rugs,Inspired by celestial patterns bringing movement and mystery to your interiors,rugs,modern,handmade,Premium Materials,Hand-Tufted Quality,Vacuum regularly,Rotate periodically,Professional cleaning recommended
// CUSTOM-001,,Custom Furniture Design,Get a custom quote for bespoke furniture design,Custom furniture tailored to your space,0,0,Furniture,Style n Homes,set,Custom Craftsmen,CUST001,custom@craftsmen.com,+91-9876543211,456 Craft Lane Delhi India,Contact for availability,India,IN,Asia,https://example.com/custom1.jpg,Contact for timeline,Various,Custom,Professional design consultation|Custom materials and finishes|Made to order specifications,Construction: Custom|Material: Various|Lead Time: Contact for details|Customization: Full customization available,TRUE,FALSE,,,,,,,Custom Furniture Design - Request Quote,Get personalized furniture designed specifically for your space,custom,furniture,bespoke,Professional Design,Custom Materials,Contact for care instructions
// TILE-001,,Premium Ceramic Tiles,High-quality ceramic tiles for modern spaces,Durable and stylish ceramic flooring solution,45,500,Tiles,Style n Homes,sq ft,Tile Masters,TILE001,tiles@masters.com,+91-9876543212,789 Tile Road Bangalore India,In Stock,Spain,ES,Europe,https://example.com/tile1.jpg,5-7 business days,Ceramic,60x60cm,High-quality ceramic construction|Modern design aesthetic|Suitable for floors and walls,Material: Ceramic|Size: 60x60cm|Finish: Glossy|Thickness: 8mm|Water Absorption: <0.5%,FALSE,FALSE,,,,,,,Premium Ceramic Tiles - Flooring Solution,Transform your space with premium ceramic tiles,tiles,ceramic,flooring,Water Resistant,Easy to Clean,Regular mopping,Avoid harsh chemicals
// FABRIC-001,,Designer Upholstery Fabric,Premium fabric for furniture upholstery,Luxurious fabric perfect for custom furniture,25,100,Fabrics,Style n Homes,yard,Fabric World,FAB001,fabric@world.com,+91-9876543213,321 Fabric Street Chennai India,Limited Stock,Italy,IT,Europe,https://example.com/fabric1.jpg,2-3 business days,Cotton Blend,Width 140cm,Premium cotton blend construction|Fade resistant properties|Stain resistant treatment,Material: Cotton Blend|Width: 140cm|Weight: 280gsm|Pattern: Solid|Color Fastness: Grade 4-5,FALSE,FALSE,,,,,,,Designer Upholstery Fabric - Premium Quality,Create stunning furniture with our premium upholstery fabric,fabric,upholstery,designer,Fade Resistant,Stain Resistant,Dry clean only,Professional cleaning recommended
// AM-RC-001,RU-AST-173,Astral Modern Area Rug - Indian Wool 170 x 140 cm,,,260,10,,,piece,ABC Suppliers,ABC001,supplier@abc.com,+91-9876543210,123 Main Street Mumbai India,Available,China,CN,Asia,https://example.com/red-wool-1.jpg,https://example.com/red-wool-2.jpg,3-5 business days,,,,,FALSE,TRUE,Material,Indian Wool,Size,170 x 140 cm,,,,,,,
// AM-RC-002,RU-AST-173,Astral Modern Area Rug - New Zealand Wool 220 x 180 cm,,,431,10,,,piece,ABC Suppliers,ABC001,supplier@abc.com,+91-9876543210,123 Main Street Mumbai India,Available,China,CN,Asia,https://example.com/nz-wool-1.jpg,https://example.com/nz-wool-2.jpg,3-5 business days,,,,,FALSE,TRUE,Material,New Zealand Wool,Size,220 x 180 cm,Color,Beige,,,,,`;

//     res.setHeader('Content-Type', 'text/csv');
//     res.setHeader('Content-Disposition', 'attachment; filename="bulk_upload_template_with_details_and_specifications.csv"');
//     res.status(200).send(template);

//   } catch (error) {
//     console.error('Error generating template:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to generate template",
//       error: error.message
//     });
//   }
// };

// const retryFailedProducts = async (req, res) => {
//   try {
//     const { jobId } = req.params;
    
//     const retryResult = {
//       jobId,
//       retriedItems: 5,
//       successfulRetries: 4,
//       stillFailed: 1,
//       newErrors: []
//     };

//     res.status(200).json({
//       success: true,
//       message: "Retry process completed",
//       result: retryResult
//     });

//   } catch (error) {
//     console.error('Error retrying failed products:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to retry products",
//       error: error.message
//     });
//   }
// };

// const cancelBulkUpload = async (req, res) => {
//   try {
//     const { jobId } = req.params;
    
//     res.status(200).json({
//       success: true,
//       message: "Bulk upload job cancelled successfully",
//       jobId
//     });

//   } catch (error) {
//     console.error('Error cancelling bulk upload:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to cancel bulk upload",
//       error: error.message
//     });
//   }
// };

// const getBulkUploadStats = async (req, res) => {
//   try {
//     const mockStats = {
//       totalUploads: 25,
//       totalProductsCreated: 1250,
//       totalProductsFailed: 45,
//       requestQuoteProductsCreated: 128,
//       productsWithUOMCreated: 890,
//       productsWithVendorCreated: 567,
//       productsWithVendorSkuCreated: 234,
//       productsWithCountryOfOriginCreated: 423,
//       productsWithDetailsCreated: 345, // 🆕 NEW: Details statistics
//       productsWithSpecificationsCreated: 678, // 🆕 NEW: Specifications statistics
//       averageSuccessRate: 96.4,
//       lastUpload: new Date(),
//       uploadsThisMonth: 8,
//       productsCreatedThisMonth: 420
//     };

//     res.status(200).json({
//       success: true,
//       stats: mockStats
//     });

//   } catch (error) {
//     console.error('Error fetching bulk upload stats:', error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch statistics",
//       error: error.message
//     });
//   }
// };

// const deleteS3File = async (key) => {
//   const params = {
//     Bucket: S3_BUCKET,
//     Key: key
//   };
  
//   return s3.deleteObject(params).promise();
// };

// export {
//   getPresignedUrl,
//   processBulkUpload,
//   validateCSVStructure,
//   getBulkUploadHistory,
//   getBulkUploadStatus,
//   downloadTemplate,
//   retryFailedProducts,
//   cancelBulkUpload,
//   getBulkUploadStats,
//   // BULK PUBLISH EXPORTS
//   getDraftProducts,
//   bulkPublishProducts,
//   bulkUnpublishProducts,
//   getBulkPublishStats
// };



// controllers/bulkUploadController.js - COMPLETE WITH COMPREHENSIVE DIAGNOSTICS
import AWS from 'aws-sdk';
import Papa from 'papaparse';
import Product from "../models/productModel.js";
import Category from "../models/categoryModel.js";
import PageContent from "../models/pageContentModel.js";
import slugify from "slugify";
import { v4 as uuidv4 } from "uuid";

// S3 Configuration - Using environment variables for security
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'ap-south-1'
});

// Validate AWS credentials
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.warn("⚠️  WARNING: AWS credentials not found in environment variables!");
  console.warn("Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your .env file");
}

const S3_BUCKET = 'styleandhomes';

// 🆕 ENHANCED LOGGING UTILITY
const logWithTimestamp = (level, section, message, data = null) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] [${section}] ${message}`;
  
  if (level === 'error') {
    console.error(logMessage);
    if (data) console.error('Error Details:', JSON.stringify(data, null, 2));
  } else if (level === 'warn') {
    console.warn(logMessage);
    if (data) console.warn('Warning Details:', JSON.stringify(data, null, 2));
  } else {
    console.log(logMessage);
    if (data) console.log('Additional Data:', JSON.stringify(data, null, 2));
  }
};

// Helper function to normalize values for IDs and keys
const normalizeValue = (value) => {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

// Helper function to create combination ID from values
const createCombinationId = (combination) => {
  const values = Object.values(combination).map(v => normalizeValue(v));
  return `combo-${values.join('-')}`;
};

// @desc    Generate presigned URL for CSV upload
// @route   GET /api/bulk-upload/presigned-url
// @access  Private/Admin
const getPresignedUrl = async (req, res) => {
  try {
    logWithTimestamp('info', 'PRESIGNED_URL', 'Generating presigned URL request', { 
      fileName: req.query.fileName, 
      fileType: req.query.fileType 
    });

    const { fileName, fileType } = req.query;
    
    if (!fileName || !fileType) {
      logWithTimestamp('warn', 'PRESIGNED_URL', 'Missing required parameters');
      return res.status(400).json({
        success: false,
        message: "fileName and fileType are required"
      });
    }

    if (!fileType.includes('csv')) {
      logWithTimestamp('warn', 'PRESIGNED_URL', 'Invalid file type', { fileType });
      return res.status(400).json({
        success: false,
        message: "Only CSV files are allowed"
      });
    }

    const key = `bulk-uploads/${Date.now()}-${fileName}`;
    
    const signedUrl = s3.getSignedUrl('putObject', {
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: fileType,
      Expires: 300,
    });

    logWithTimestamp('info', 'PRESIGNED_URL', 'Successfully generated presigned URL', { key });

    res.status(200).json({
      success: true,
      signedUrl,
      key,
      expiresIn: 300
    });
  } catch (error) {
    logWithTimestamp('error', 'PRESIGNED_URL', 'Failed to generate presigned URL', error);
    res.status(500).json({
      success: false,
      message: "Failed to generate upload URL",
      error: error.message
    });
  }
};

// @desc    Process bulk upload from S3 CSV
// @route   POST /api/bulk-upload/process
// @access  Private/Admin
const processBulkUpload = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { s3Key, validateOnly = false } = req.body;
    
    // Get user ID from either admin or editor
    const userId = req.admin?._id || req.editor?._id;
    
    logWithTimestamp('info', 'BULK_UPLOAD', 'Starting bulk upload process', {
      s3Key,
      validateOnly,
      adminId: userId,
      userType: req.userType
    });
    
    if (!s3Key) {
      logWithTimestamp('warn', 'BULK_UPLOAD', 'Missing S3 key');
      return res.status(400).json({
        success: false,
        message: "S3 key is required"
      });
    }

    // Download CSV from S3
    logWithTimestamp('info', 'BULK_UPLOAD', 'Downloading CSV from S3', { s3Key });
    const csvData = await downloadCSVFromS3(s3Key);
    logWithTimestamp('info', 'BULK_UPLOAD', 'CSV downloaded successfully', { 
      dataLength: csvData.length 
    });
    
    // Parse CSV dynamically
    logWithTimestamp('info', 'BULK_UPLOAD', 'Starting CSV parsing');
    const parsedData = await parseCSV(csvData);
    logWithTimestamp('info', 'BULK_UPLOAD', 'CSV parsed successfully', { 
      rowCount: parsedData.length 
    });
    
    // Validate and structure data dynamically
    logWithTimestamp('info', 'BULK_UPLOAD', 'Starting data validation');
    const validationResult = await validateAndStructureDataDynamic(parsedData);
    logWithTimestamp('info', 'BULK_UPLOAD', 'Data validation completed', {
      isValid: validationResult.isValid,
      errorCount: validationResult.errors.length,
      warningCount: validationResult.warnings.length
    });
    
    if (!validationResult.isValid) {
      logWithTimestamp('error', 'BULK_UPLOAD', 'CSV validation failed', {
        errors: validationResult.errors,
        summary: validationResult.summary
      });
      return res.status(400).json({
        success: false,
        message: "CSV validation failed",
        errors: validationResult.errors,
        summary: validationResult.summary
      });
    }

    // If validation only, return validation results
    if (validateOnly) {
      logWithTimestamp('info', 'BULK_UPLOAD', 'Validation-only mode completed successfully');
      return res.status(200).json({
        success: true,
        message: "CSV validation completed",
        summary: validationResult.summary,
        preview: validationResult.preview
      });
    }

    // Process the upload with auto-category creation
    logWithTimestamp('info', 'BULK_UPLOAD', 'Starting product processing');
    const processResult = await processProductsAndContentDynamic(validationResult.structuredData, userId);
    
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    logWithTimestamp('info', 'BULK_UPLOAD', 'Bulk upload completed successfully', {
      processingTimeMs: processingTime,
      summary: processResult.summary
    });
    
    res.status(200).json({
      success: true,
      message: "Bulk upload completed",
      summary: processResult.summary,
      results: processResult.results,
      processingTime: `${(processingTime / 1000).toFixed(2)}s`
    });

  } catch (error) {
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    logWithTimestamp('error', 'BULK_UPLOAD', 'Bulk upload failed', {
      error: error.message,
      stack: error.stack,
      processingTimeMs: processingTime
    });
    
    res.status(500).json({
      success: false,
      message: "Failed to process bulk upload",
      error: error.message
    });
  }
};

// Helper function to download CSV from S3
const downloadCSVFromS3 = async (key) => {
  try {
    logWithTimestamp('info', 'S3_DOWNLOAD', 'Starting S3 download', { key });
    
    const params = {
      Bucket: S3_BUCKET,
      Key: key
    };

    const data = await s3.getObject(params).promise();
    const csvData = data.Body.toString('utf-8');
    
    logWithTimestamp('info', 'S3_DOWNLOAD', 'S3 download completed', { 
      dataSize: csvData.length,
      contentType: data.ContentType
    });
    
    return csvData;
  } catch (error) {
    logWithTimestamp('error', 'S3_DOWNLOAD', 'Failed to download from S3', {
      key,
      error: error.message
    });
    throw error;
  }
};

// 🆕 ENHANCED CSV PARSING WITH COMPREHENSIVE DIAGNOSTICS
const parseCSV = async (csvData) => {
  try {
    logWithTimestamp('info', 'CSV_PARSE', 'Starting CSV parsing');
    
    // 🆕 LOG RAW CSV DATA ANALYSIS
    logWithTimestamp('info', 'CSV_RAW_DATA', 'Raw CSV content analysis', {
      first500chars: csvData.slice(0, 500),
      totalLength: csvData.length,
      lineCount: csvData.split('\n').length,
      hasCarriageReturn: csvData.includes('\r'),
      hasTab: csvData.includes('\t'),
      hasComma: csvData.includes(','),
      hasPipe: csvData.includes('|'),
      hasSemicolon: csvData.includes(';'),
      encoding: 'utf-8'
    });
    
    // 🆕 LOG FIRST FEW LINES SEPARATELY
    const lines = csvData.split('\n');
    lines.slice(0, 5).forEach((line, index) => {
      logWithTimestamp('info', 'CSV_LINE_ANALYSIS', `Line ${index + 1}`, {
        content: line.slice(0, 200) + (line.length > 200 ? '...' : ''),
        length: line.length,
        isEmpty: line.trim() === '',
        commaCount: (line.match(/,/g) || []).length,
        tabCount: (line.match(/\t/g) || []).length,
        pipeCount: (line.match(/\|/g) || []).length
      });
    });
    
    return new Promise((resolve, reject) => {
      Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        delimiter: '', // Auto-detect
        newline: '', // Auto-detect
        quoteChar: '"',
        escapeChar: '"',
        transformHeader: (header) => header.trim(),
        complete: (results) => {
          // 🆕 ENHANCED PARSING RESULTS LOGGING
          logWithTimestamp('info', 'CSV_PARSE_RESULTS', 'Detailed parsing results', {
            rowCount: results.data.length,
            fields: results.meta.fields,
            fieldCount: results.meta.fields?.length || 0,
            errors: results.errors,
            errorCount: results.errors.length,
            delimiter: results.meta.delimiter,
            linebreak: results.meta.linebreak,
            aborted: results.meta.aborted,
            truncated: results.meta.truncated
          });
          
          // 🆕 LOG FIRST FEW PARSED ROWS
          results.data.slice(0, 3).forEach((row, index) => {
            const nonEmptyFields = Object.entries(row).filter(([key, value]) => value && value.toString().trim() !== '');
            
            logWithTimestamp('info', 'CSV_PARSED_ROW', `Parsed row ${index + 1}`, {
              sku: row.SKU,
              productName: row['Product Name'],
              category: row.Category,
              keysCount: Object.keys(row).length,
              nonEmptyFieldsCount: nonEmptyFields.length,
              nonEmptyFields: nonEmptyFields.map(([key, value]) => `${key}: ${value?.toString().slice(0, 50)}`)
            });
          });
          
          // 🆕 CHECK FOR COMMON ISSUES
          if (results.data.length === 0) {
            logWithTimestamp('error', 'CSV_PARSE', 'No data rows found!', {
              possibleCauses: [
                'File contains only headers',
                'Incorrect delimiter detection',
                'File encoding issues',
                'All rows are empty or invalid'
              ]
            });
          }
          
          if (results.errors.length > 0) {
            logWithTimestamp('warn', 'CSV_PARSE', 'CSV parsing completed with errors', {
              errorCount: results.errors.length,
              errors: results.errors.slice(0, 5)
            });
          } else {
            logWithTimestamp('info', 'CSV_PARSE', 'CSV parsing completed successfully', {
              rowCount: results.data.length,
              fields: results.meta.fields
            });
          }
          
          resolve(results.data);
        },
        error: (error) => {
          logWithTimestamp('error', 'CSV_PARSE', 'CSV parsing failed', error);
          reject(error);
        }
      });
    });
  } catch (error) {
    logWithTimestamp('error', 'CSV_PARSE', 'Error in CSV parsing function', error);
    throw error;
  }
};

// 🆕 ENHANCED VALIDATION WITH DETAILED ROW ANALYSIS
const validateAndStructureDataDynamic = async (csvRows) => {
  logWithTimestamp('info', 'VALIDATION', 'Starting data validation', {
    totalRows: csvRows.length
  });
  
  // 🆕 ANALYZE EACH ROW IN DETAIL
  csvRows.forEach((row, index) => {
    const rowNum = index + 2;
    
    const rowAnalysis = {
      rowNum,
      rowKeys: Object.keys(row),
      totalFields: Object.keys(row).length,
      sku: row.SKU?.trim(),
      productName: row['Product Name'],
      category: row.Category?.trim(),
      price: row.Price,
      stock: row.Stock,
      isEmpty: Object.values(row).every(val => !val || val.toString().trim() === ''),
      hasRequiredFields: !!(row.SKU?.trim() && row['Product Name'] && row.Category?.trim()),
      nonEmptyFieldCount: Object.values(row).filter(val => val && val.toString().trim() !== '').length
    };
    
    logWithTimestamp('info', 'ROW_DETAILED_ANALYSIS', `Analyzing row ${rowNum}`, rowAnalysis);
    
    // 🆕 FLAG POTENTIAL ISSUES
    if (rowAnalysis.isEmpty) {
      logWithTimestamp('warn', 'ROW_ISSUE', `Row ${rowNum} is completely empty`);
    }
    
    if (!rowAnalysis.hasRequiredFields) {
      logWithTimestamp('warn', 'ROW_ISSUE', `Row ${rowNum} missing required fields`, {
        missingSku: !row.SKU?.trim(),
        missingName: !row['Product Name'],
        missingCategory: !row.Category?.trim()
      });
    }
  });
  
  const errors = [];
  const parentProducts = [];
  const variationsMap = new Map();
  const categoriesNeeded = new Set();
  const warnings = [];
  
  // First pass: separate parents and variations dynamically
  csvRows.forEach((row, index) => {
    const rowNum = index + 2;
    
    try {
      const isVariation = row['Is Variation']?.toString().toUpperCase() === 'TRUE';
      const isRequestQuote = row['Request Quote']?.toString().toUpperCase() === 'TRUE';
      
      logWithTimestamp('info', 'ROW_VALIDATION', `Validating row ${rowNum}`, {
        rowNum,
        sku: row.SKU?.trim(),
        isVariation,
        isRequestQuote
      });
      
      if (isVariation) {
        const parentSku = row['Parent SKU']?.trim();
        if (!parentSku) {
          errors.push(`Row ${rowNum}: Variation row missing Parent SKU`);
          return;
        }
        
        if (!variationsMap.has(parentSku)) {
          variationsMap.set(parentSku, []);
        }
        variationsMap.get(parentSku).push({ ...row, rowNum });
        
        logWithTimestamp('info', 'VARIATION_ROW', 'Variation row processed', {
          rowNum,
          parentSku,
          variationSku: row.SKU?.trim()
        });
      } else {
        // Parent product
        const sku = row.SKU?.trim();
        if (!sku) {
          errors.push(`Row ${rowNum}: Parent product missing SKU`);
          return;
        }
        
        // Validate Request Quote logic
        if (isRequestQuote) {
          logWithTimestamp('info', 'REQUEST_QUOTE', 'Request Quote product detected', {
            rowNum,
            sku,
            productName: row['Product Name'],
            uom: row.UOM?.trim() || 'N/A'
          });
        } else {
          // For regular products, validate price and stock
          if (!row.Price || isNaN(parseFloat(row.Price))) {
            errors.push(`Row ${rowNum}: Regular product missing valid price`);
          }
          
          if (!row.Stock || isNaN(parseInt(row.Stock))) {
            errors.push(`Row ${rowNum}: Regular product missing valid stock quantity`);
          }
        }
        
        // Validate UOM if provided
        if (row.UOM && row.UOM.trim()) {
          const uomValue = row.UOM.trim();
          if (uomValue.length > 50) {
            errors.push(`Row ${rowNum}: UOM too long (max 50 characters)`);
          }
          logWithTimestamp('info', 'UOM_DETECTED', 'UOM field detected', {
            rowNum,
            sku,
            uom: uomValue
          });
        }
        
        parentProducts.push({ ...row, rowNum });
        
        logWithTimestamp('info', 'PARENT_ROW', 'Parent product row processed', {
          rowNum,
          sku,
          productName: row['Product Name']
        });
      }
      
      // Collect categories for validation/creation
      if (row.Category?.trim()) {
        categoriesNeeded.add(row.Category.trim());
      }
      
    } catch (error) {
      logWithTimestamp('error', 'ROW_VALIDATION', `Row validation failed`, {
        rowNum,
        error: error.message
      });
      errors.push(`Row ${rowNum}: ${error.message}`);
    }
  });
  
  logWithTimestamp('info', 'VALIDATION', 'First pass completed', {
    parentProductsCount: parentProducts.length,
    variationsMapSize: variationsMap.size,
    categoriesNeeded: categoriesNeeded.size,
    errorsCount: errors.length
  });
  
  // DYNAMIC category handling
  logWithTimestamp('info', 'CATEGORY_VALIDATION', 'Starting category validation/creation');
  const categoryValidation = await validateOrCreateCategories(Array.from(categoriesNeeded));
  
  if (categoryValidation.created.length > 0) {
    warnings.push(`Auto-created categories: ${categoryValidation.created.join(', ')}`);
    logWithTimestamp('info', 'CATEGORY_CREATION', 'Categories auto-created', {
      createdCategories: categoryValidation.created
    });
  }
  
  const summary = {
    totalRows: csvRows.length,
    parentProducts: parentProducts.length,
    totalVariations: Array.from(variationsMap.values()).reduce((sum, variations) => sum + variations.length, 0),
    categoriesFound: categoryValidation.found.length,
    categoriesCreated: categoryValidation.created.length,
    errorsCount: errors.length,
    warningsCount: warnings.length
  };
  
  logWithTimestamp('info', 'VALIDATION', 'Validation completed', summary);
  
  const preview = parentProducts.slice(0, 5).map(product => ({
    sku: product.SKU,
    name: product['Product Name'],
    category: product.Category,
    price: product.Price,
    variations: variationsMap.get(product.SKU?.trim())?.length || 0
  }));
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    summary,
    preview,
    structuredData: {
      parentProducts,
      variationsMap,
      categoriesMap: categoryValidation.categoriesMap
    }
  };
};

// DYNAMIC category validation/creation with logging
const validateOrCreateCategories = async (categoryNames) => {
  const found = [];
  const created = [];
  const categoriesMap = new Map();
  
  logWithTimestamp('info', 'CATEGORY_PROCESS', 'Processing categories', {
    categoryCount: categoryNames.length,
    categories: categoryNames
  });
  
  for (const categoryName of categoryNames) {
    try {
      logWithTimestamp('info', 'CATEGORY_CHECK', 'Checking category', { categoryName });
      
      let category = await Category.findOne({ name: categoryName });
      
      if (category) {
        found.push(categoryName);
        categoriesMap.set(categoryName, category);
        logWithTimestamp('info', 'CATEGORY_FOUND', 'Category exists', {
          categoryName,
          categoryId: category._id
        });
      } else {
        // AUTO-CREATE missing category
        logWithTimestamp('info', 'CATEGORY_CREATE', 'Auto-creating category', { categoryName });
        
        category = await Category.create({
          name: categoryName,
          slug: slugify(categoryName, { lower: true }),
          description: `Auto-created category for ${categoryName}`,
          isActive: true,
          displayOrder: 0
        });
        
        created.push(categoryName);
        categoriesMap.set(categoryName, category);
        
        logWithTimestamp('info', 'CATEGORY_CREATED', 'Category created successfully', {
          categoryName,
          categoryId: category._id
        });
      }
    } catch (error) {
      logWithTimestamp('error', 'CATEGORY_ERROR', 'Category processing failed', {
        categoryName,
        error: error.message
      });
    }
  }
  
  return { found, created, categoriesMap };
};

// DYNAMIC product and content processing with comprehensive logging
const processProductsAndContentDynamic = async (structuredData, adminId) => {
  const { parentProducts, variationsMap, categoriesMap } = structuredData;
  
  logWithTimestamp('info', 'PRODUCT_PROCESSING', 'Starting product processing', {
    parentProductCount: parentProducts.length,
    variationMapSize: variationsMap.size,
    categoriesMapSize: categoriesMap.size,
    adminId
  });
  
  const results = {
    productsCreated: 0,
    productsUpdated: 0,
    pageContentCreated: 0,
    pageContentUpdated: 0,
    errors: [],
    success: []
  };
  
  for (let i = 0; i < parentProducts.length; i++) {
    const parentProductRow = parentProducts[i];
    const productStartTime = Date.now();
    
    try {
      const sku = parentProductRow.SKU?.trim();
      const productName = parentProductRow['Product Name'];
      
      logWithTimestamp('info', 'PRODUCT_PROCESSING', `Processing product ${i + 1}/${parentProducts.length}`, {
        sku,
        productName,
        rowNum: parentProductRow.rowNum
      });
      
      // Create or update product with comprehensive checks
      const product = await createProductFromRowDynamic(parentProductRow, categoriesMap, adminId);
      
      if (!product || !product._id) {
        throw new Error('Product creation/update returned invalid result');
      }
      
      const isUpdate = !!await Product.findOne({ sku });
      
      logWithTimestamp('info', 'PRODUCT_CREATION', 'Product creation/update completed', {
        sku,
        productId: product._id,
        isUpdate,
        productName: product.name
      });
      
      const variations = variationsMap.get(sku) || [];
      
      // Create or update PageContent
      const pageContent = await createPageContentFromRowDynamic(product, parentProductRow, variations);
      
      if (!pageContent || !pageContent._id) {
        throw new Error('PageContent creation/update returned invalid result');
      }
      
      // Update counters
      if (isUpdate) {
        results.productsUpdated++;
        results.success.push(`Successfully updated: ${product.name} (${product.sku})`);
      } else {
        results.productsCreated++;
        results.success.push(`Successfully created (draft): ${product.name} (${product.sku})`);
      }
      
      const productEndTime = Date.now();
      const productProcessingTime = productEndTime - productStartTime;
      
      logWithTimestamp('info', 'PRODUCT_TIMING', 'Product processing completed', {
        sku,
        processingTimeMs: productProcessingTime,
        index: i + 1,
        total: parentProducts.length
      });
      
    } catch (error) {
      const productEndTime = Date.now();
      const productProcessingTime = productEndTime - productStartTime;
      
      logWithTimestamp('error', 'PRODUCT_ERROR', 'Product processing failed', {
        sku: parentProductRow.SKU?.trim(),
        productName: parentProductRow['Product Name'],
        rowNum: parentProductRow.rowNum,
        processingTimeMs: productProcessingTime,
        error: error.message,
        stack: error.stack
      });
      
      results.errors.push(`Failed to process ${parentProductRow['Product Name']} (${parentProductRow.SKU}): ${error.message}`);
    }
  }
  
  const summary = {
    totalProcessed: parentProducts.length,
    successful: results.productsCreated + results.productsUpdated,
    failed: results.errors.length,
    productsCreated: results.productsCreated,
    productsUpdated: results.productsUpdated,
    pageContentCreated: results.pageContentCreated,
    pageContentUpdated: results.pageContentUpdated
  };
  
  logWithTimestamp('info', 'PRODUCT_PROCESSING', 'All products processing completed', summary);
  
  return { summary, results };
};

// 🆕 ENHANCED Product creation/update with comprehensive existence checks
const createProductFromRowDynamic = async (row, categoriesMap, adminId) => {
  const sku = row.SKU?.trim();
  
  try {
    logWithTimestamp('info', 'PRODUCT_CREATE', 'Starting product creation/update process', {
      sku,
      productName: row['Product Name'],
      category: row.Category?.trim()
    });
    
    // 🆕 COMPREHENSIVE EXISTENCE CHECKS
    logWithTimestamp('info', 'PRODUCT_EXISTENCE_CHECK', 'Performing comprehensive existence checks', { sku });
    
    // Check by SKU
    const existingBySku = await Product.findOne({ sku });
    logWithTimestamp('info', 'PRODUCT_EXISTENCE_SKU', 'SKU check result', {
      sku,
      found: !!existingBySku,
      existingId: existingBySku?._id,
      existingName: existingBySku?.name,
      isPublished: existingBySku?.isPublished
    });
    
    // Check by slug
    const slug = slugify(row['Product Name'], { lower: true });
    const existingBySlug = await Product.findOne({ slug });
    logWithTimestamp('info', 'PRODUCT_EXISTENCE_SLUG', 'Slug check result', {
      slug,
      found: !!existingBySlug,
      existingId: existingBySlug?._id,
      existingSku: existingBySlug?.sku
    });
    
    // Check by name
    const existingByName = await Product.findOne({ name: row['Product Name'] });
    logWithTimestamp('info', 'PRODUCT_EXISTENCE_NAME', 'Name check result', {
      name: row['Product Name'],
      found: !!existingByName,
      existingId: existingByName?._id,
      existingSku: existingByName?.sku
    });
    
    // 🆕 DATABASE STATISTICS
    const totalProducts = await Product.countDocuments();
    const totalDrafts = await Product.countDocuments({ isPublished: false });
    const totalPublished = await Product.countDocuments({ isPublished: true });
    
    logWithTimestamp('info', 'DATABASE_STATS', 'Current database statistics', {
      totalProducts,
      totalDrafts,
      totalPublished
    });
    
    const category = categoriesMap.get(row.Category?.trim());
    if (!category) {
      throw new Error(`Category not found: ${row.Category?.trim()}`);
    }
    
    const existingProduct = existingBySku || existingBySlug;
    const isUpdate = !!existingProduct;
    
    logWithTimestamp('info', 'PRODUCT_DECISION', 'Final decision on create vs update', {
      sku,
      isUpdate,
      reason: existingBySku ? 'Found by SKU' : existingBySlug ? 'Found by slug' : 'Not found - will create',
      existingProductId: existingProduct?._id
    });
    
    const isRequestQuote = row['Request Quote']?.toString().toUpperCase() === 'TRUE';
    
    // Process images
    const images = row.Images ? 
      row.Images.split(',').map((url, index) => ({
        url: url.trim(),
        alt: `${row['Product Name']} image ${index + 1}`,
        isFeatured: index === 0
      })) : [];
    
    const productData = {
      name: row['Product Name'],
      slug,
      description: row.Description || '',
      shortDescription: row['Short Description'] || '',
      isRequestQuote: isRequestQuote,
      price: isRequestQuote ? 0 : (parseFloat(row.Price) || 0),
      comparePrice: isRequestQuote ? 0 : (parseFloat(row.Price) || 0),
      category: category._id,
      brand: row.Brand || '',
      sku: row.SKU,
      stock: isRequestQuote ? 999999 : (parseInt(row.Stock) || 0),
      uom: row.UOM?.trim() || null,
      // Vendor information
      vendorName: row['Vendor Name']?.trim() || null,
      vendorCode: row['Vendor Code']?.trim() || null,
      vendorEmail: row['Vendor Email']?.trim()?.toLowerCase() || null,
      vendorPhone: row['Vendor Phone']?.trim() || null,
      vendorAddress: row['Vendor Address']?.trim() || null,
      vendorSku: row['Vendor SKU']?.trim() || null,
      vendorCost: row['Vendor Cost'] || row['vendorCost'] ? parseFloat(row['Vendor Cost'] || row['vendorCost']) : null,
      // HSN Code
      hsnCode: row['HSN Code']?.trim() || null,
      // Country of origin details
      countryOfOrigin: row['Country of Origin'] || row['Country Code'] || row['Region'] ? {
        country: row['Country of Origin']?.trim() || null,
        countryCode: row['Country Code']?.trim()?.toUpperCase() || null,
        region: row['Region']?.trim() || null,
      } : null,
      images,
      tags: row.Tags ? row.Tags.split(',').map(tag => tag.trim()) : [],
      shippingInfo: {
        weight: 0,
        dimensions: { length: 0, width: 0, height: 0 },
        freeShipping: false
      },
      shippingEstimatedTime: row['Shipping Time']?.trim() || null,
      seo: {
        metaTitle: row['Meta Title'] || row['Product Name'],
        metaDescription: row['Meta Description'] || row['Short Description'] || '',
        metaKeywords: row['Meta Keywords'] ? row['Meta Keywords'].split(',').map(kw => kw.trim()) : []
      },
      updatedAt: new Date()
    };

    logWithTimestamp('info', 'PRODUCT_CREATE', 'Product data prepared', {
      sku,
      productDataKeys: Object.keys(productData),
      isRequestQuote: productData.isRequestQuote,
      price: productData.price,
      stock: productData.stock,
      uom: productData.uom,
      vendorCost: productData.vendorCost,
      vendorCostRaw: row['Vendor Cost'] || row['vendorCost'],
      vendorCostParsed: row['Vendor Cost'] || row['vendorCost'] ? parseFloat(row['Vendor Cost'] || row['vendorCost']) : null,
      hsnCode: productData.hsnCode,
      hasVendorInfo: !!(productData.vendorName || productData.vendorCode),
      hasCountryOfOrigin: !!productData.countryOfOrigin
    });

    if (isUpdate) {
      // UPDATE EXISTING PRODUCT
      logWithTimestamp('info', 'PRODUCT_UPDATE', 'Starting product update', {
        sku,
        existingProductId: existingProduct._id
      });
      
      Object.keys(productData).forEach(key => {
        if (key !== 'createdBy') {
          existingProduct[key] = productData[key];
        }
      });
      
      logWithTimestamp('info', 'PRODUCT_UPDATE', 'Preserving original published status', {
        sku,
        isPublished: existingProduct.isPublished
      });
      
      const updatedProduct = await existingProduct.save();
      
      logWithTimestamp('info', 'PRODUCT_UPDATE', 'Product updated successfully', {
        sku,
        productId: updatedProduct._id,
        name: updatedProduct.name
      });
      
      return updatedProduct;
    } else {
      // CREATE NEW PRODUCT
      logWithTimestamp('info', 'PRODUCT_CREATE', 'Starting new product creation', { sku });
      
      productData.isPublished = false;
      productData.createdBy = adminId;
      
      logWithTimestamp('info', 'PRODUCT_CREATE', 'Creating product with data', {
        sku,
        adminId,
        isPublished: productData.isPublished
      });
      
      const newProduct = await Product.create(productData);
      
      logWithTimestamp('info', 'PRODUCT_CREATE', 'New product created successfully', {
        sku,
        productId: newProduct._id,
        name: newProduct.name
      });
      
      return newProduct;
    }
  } catch (error) {
    logWithTimestamp('error', 'PRODUCT_CREATE', 'Product creation/update failed', {
      sku,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

// PageContent creation with logging
const createPageContentFromRowDynamic = async (product, parentRow, variations) => {
  const pageContentId = `product-${product._id}`;
  
  try {
    logWithTimestamp('info', 'PAGECONTENT_CREATE', 'Starting PageContent creation/update', {
      sku: product.sku,
      pageContentId,
      variationCount: variations.length
    });
    
    const existingPageContent = await PageContent.findOne({
      pageId: pageContentId,
      pageType: 'product'
    });
    
    const isUpdate = !!existingPageContent;
    
    logWithTimestamp('info', 'PAGECONTENT_CREATE', isUpdate ? 'Existing PageContent found - updating' : 'No existing PageContent - creating new', {
      sku: product.sku,
      existingPageContentId: existingPageContent?._id,
      isUpdate
    });
    
    const features = parentRow.Features ? 
      parentRow.Features.split('|').map((feature, index) => ({
        id: `feature-${index + 1}`,
        icon: "✦",
        title: feature.trim(),
        description: "",
        order: index,
        isActive: true
      })) : [];
    
    const careInstructions = parentRow['Care Instructions'] ? 
      parentRow['Care Instructions'].split('|').map(instruction => instruction.trim()) : [];
    
    // 🆕 PROCESS PARENT PRODUCT DETAILS FROM CSV (pipe-separated)
    const parentDetails = parentRow.Details ? 
      parentRow.Details.split('|').map((detail, index) => ({
        id: `parent-detail-${index}`,
        title: `Detail ${index + 1}`,
        description: detail.trim(),
        features: [],
        order: index
      })) : [];
    
    // 🆕 PROCESS PARENT PRODUCT SPECIFICATIONS FROM CSV
    const parentSpecifications = parentRow.Specifications ? 
      parentRow.Specifications.split('|').map((spec, index) => {
        const parts = spec.split(':').map(p => p.trim());
        return {
          id: `parent-spec-${index}`,
          label: parts[0] || '',
          value: parts[1] || parts[0] || '',
          order: index,
          isActive: true
        };
      }) : [];
    
    // 🆕 ADD MATERIAL AND DIMENSIONS TO PARENT SPECIFICATIONS IF PRESENT IN CSV
    let specIndex = parentSpecifications.length;
    
    if (parentRow.Material?.trim()) {
      parentSpecifications.push({
        id: `parent-spec-material`,
        label: 'Material',
        value: parentRow.Material.trim(),
        order: specIndex++,
        isActive: true
      });
    }
    
    if (parentRow.Dimensions?.trim()) {
      parentSpecifications.push({
        id: `parent-spec-dimensions`,
        label: 'Dimensions',
        value: parentRow.Dimensions.trim(),
        order: specIndex++,
        isActive: true
      });
    }
    
    logWithTimestamp('info', 'PARENT_SPECIFICATIONS', 'Processed parent product specifications from CSV', {
      sku: product.sku,
      specificationsCount: parentSpecifications.length,
      hasMaterial: !!parentRow.Material?.trim(),
      hasDimensions: !!parentRow.Dimensions?.trim(),
      specifications: parentSpecifications
    });
    
    // PROCESS VARIATIONS DYNAMICALLY
    const variationCombinations = [];
    const variationTypes = [];
    
    if (variations.length > 0) {
      logWithTimestamp('info', 'VARIATION_PROCESSING', `Processing ${variations.length} variations for ${product.name}`, {
        sku: product.sku,
        variationCount: variations.length
      });
      
      // DYNAMICALLY extract ALL variation types with correct format
      const variationTypesMap = new Map();
      
      variations.forEach(variation => {
        // Find all "Variation Type X" columns dynamically
        Object.keys(variation).forEach(key => {
          if (key.startsWith('Variation Type') && variation[key]?.trim()) {
            const typeNum = key.replace('Variation Type ', '');
            const valueKey = `Variation Value ${typeNum}`;
            const typeName = variation[key].trim();
            const typeValue = variation[valueKey]?.trim();
            
            if (typeName && typeValue) {
              if (!variationTypesMap.has(typeName)) {
                variationTypesMap.set(typeName, new Set());
              }
              variationTypesMap.get(typeName).add(typeValue);
            }
          }
        });
      });
      
      // Build variation types structure in EXACT format
      let displayOrder = 0;
      variationTypesMap.forEach((values, typeName) => {
        const normalizedTypeName = normalizeValue(typeName);
        
        const variationOptions = Array.from(values).map((value, index) => ({
          id: `${normalizedTypeName}-${normalizeValue(value)}`,
          label: value,
          value: normalizeValue(value),
          isDefault: index === 0, // First option is default
          order: index
        }));
        
        variationTypes.push({
          id: `variation-${normalizedTypeName}`,
          type: normalizedTypeName,
          label: typeName,
          name: normalizedTypeName,
          options: variationOptions,
          displayOrder: displayOrder++,
          isActive: true
        });
      });
      
      logWithTimestamp('info', 'VARIATION_TYPES', `Built ${variationTypes.length} variation types`, {
        sku: product.sku,
        types: variationTypes.map(vt => vt.label)
      });
      
      // Build combinations DYNAMICALLY with IMAGES SUPPORT
      variations.forEach(variation => {
        const combination = {};
        
        // Extract all variation type-value pairs for this combination
        Object.keys(variation).forEach(key => {
          if (key.startsWith('Variation Type') && variation[key]?.trim()) {
            const typeNum = key.replace('Variation Type ', '');
            const valueKey = `Variation Value ${typeNum}`;
            const typeName = variation[key].trim();
            const typeValue = variation[valueKey]?.trim();
            
            if (typeName && typeValue) {
              const normalizedTypeName = normalizeValue(typeName);
              const normalizedValue = normalizeValue(typeValue);
              combination[normalizedTypeName] = normalizedValue;
            }
          }
        });
        
        if (Object.keys(combination).length > 0) {
          const combinationId = createCombinationId(combination);
          
          // PROCESS VARIATION IMAGES FROM CSV
          const variationImages = variation.Images ? 
            variation.Images.split(',').map((url, index) => ({
              id: `${combinationId}-img-${index}`,
              src: url.trim(),
              alt: `${variation.SKU} image ${index + 1}`,
              isFeatured: index === 0,
              order: index
            })) : [];
          
          // 🆕 PROCESS VARIATION DETAILS, SPECIFICATIONS, CARE INSTRUCTIONS
          const variationDetails = variation.Details ? 
            variation.Details.split('|').map((detail, index) => ({
              id: `${combinationId}-detail-${index}`,
              description: detail.trim(),
              order: index,
              isActive: true
            })) : [];
          
          const variationSpecifications = variation.Specifications ? 
            variation.Specifications.split('|').map((spec, index) => {
              const parts = spec.split(':').map(p => p.trim());
              return {
                id: `${combinationId}-spec-${index}`,
                label: parts[0] || '',
                value: parts[1] || parts[0] || '',
                order: index,
                isActive: true
              };
            }) : [];
          
          const variationCareInstructions = variation['Care Instructions'] ? 
            variation['Care Instructions'].split('|').map(instruction => instruction.trim()) : [];
          
          const variationFeatures = variation.Features ? 
            variation.Features.split('|').map((feature, index) => ({
              id: `${combinationId}-feature-${index}`,
              icon: "✦",
              title: feature.trim(),
              description: "",
              order: index,
              isActive: true
            })) : [];
          
          variationCombinations.push({
            id: combinationId,
            combination,
            sku: variation.SKU,
            price: parseFloat(variation.Price) || product.price,
            comparePrice: parseFloat(variation.Price) || product.price,
            stockQuantity: parseInt(variation.Stock) || 0,
            images: variationImages,
            uom: variation.UOM?.trim() || product.uom || null,
            isActive: true,
            displayLabel: Object.entries(combination)
              .map(([type, value]) => {
                // Find the original label for this value
                const variationType = variationTypes.find(vt => vt.name === type);
                if (variationType) {
                  const option = variationType.options.find(opt => opt.value === value);
                  return option ? option.label : value;
                }
                return value;
              })
              .join(' / '),
            // 🆕 VARIATION-SPECIFIC INFORMATION
            name: variation['Product Name'] || `${product.name} - ${Object.entries(combination)
              .map(([type, value]) => {
                const variationType = variationTypes.find(vt => vt.name === type);
                if (variationType) {
                  const option = variationType.options.find(opt => opt.value === value);
                  return option ? option.label : value;
                }
                return value;
              })
              .join(' / ')}`,
            description: variation.Description || '',
            shortDescription: variation['Short Description'] || '',
            material: variation.Material?.trim() || '',
            dimensions: variation.Dimensions?.trim() || '',
            details: variationDetails,
            specifications: variationSpecifications,
            careInstructions: variationCareInstructions,
            features: variationFeatures,
            // 🆕 VARIATION-SPECIFIC VENDOR INFORMATION
            vendorName: variation['Vendor Name']?.trim() || product.vendorName || '',
            vendorCode: variation['Vendor Code']?.trim() || product.vendorCode || '',
            vendorEmail: variation['Vendor Email']?.trim()?.toLowerCase() || product.vendorEmail || '',
            vendorPhone: variation['Vendor Phone']?.trim() || product.vendorPhone || '',
            vendorAddress: variation['Vendor Address']?.trim() || product.vendorAddress || '',
            vendorSku: variation['Vendor SKU']?.trim() || product.vendorSku || '',
            vendorCost: variation['Vendor Cost'] || variation['vendorCost'] ? parseFloat(variation['Vendor Cost'] || variation['vendorCost']) : product.vendorCost || null,
            // 🆕 VARIATION-SPECIFIC HSN CODE
            hsnCode: variation['HSN Code']?.trim() || product.hsnCode || '',
            // 🆕 VARIATION-SPECIFIC COUNTRY OF ORIGIN
            countryOfOrigin: variation['Country of Origin'] || variation['Country Code'] || variation['Region'] ? {
              country: variation['Country of Origin']?.trim() || product.countryOfOrigin?.country || null,
              countryCode: variation['Country Code']?.trim()?.toUpperCase() || product.countryOfOrigin?.countryCode || null,
              region: variation['Region']?.trim() || product.countryOfOrigin?.region || null,
            } : product.countryOfOrigin || null
          });
          
          logWithTimestamp('info', 'VARIATION_COMBINATION', 'Created variation combination with full details', {
            parentSku: product.sku,
            variationSku: variation.SKU,
            combinationId,
            combination,
            variationName: variation['Product Name'] || 'Auto-generated',
            hasImages: variationImages.length > 0,
            hasDescription: !!variation.Description,
            hasMaterial: !!variation.Material,
            hasDimensions: !!variation.Dimensions,
            detailsCount: variationDetails.length,
            specificationsCount: variationSpecifications.length,
            careInstructionsCount: variationCareInstructions.length,
            featuresCount: variationFeatures.length,
            hasVendorCost: !!(variation['Vendor Cost'] || variation['vendorCost']),
            hasHsnCode: !!variation['HSN Code'],
            hasCountryOfOrigin: !!(variation['Country of Origin'] || variation['Country Code'] || variation['Region'])
          });
        }
      });
      
      logWithTimestamp('info', 'VARIATION_PROCESSING', `Completed variation processing for ${product.name}`, {
        sku: product.sku,
        variationTypesCount: variationTypes.length,
        variationCombinationsCount: variationCombinations.length
      });
    }
    
    const content = {
      productId: product._id.toString(),
      productName: product.name,
      shortDescription: product.shortDescription,
      fullDescription: product.description,
      sku: product.sku,
      basePrice: product.price,
      currency: "USD",
      heroTitle: product.isRequestQuote ? `${product.name} - Request Quote` : product.name,
      heroSubtitle: product.isRequestQuote ? 
        `${product.shortDescription} - Contact us for custom pricing${product.uom ? ` (${product.uom})` : ''}` : 
        `${product.shortDescription}${product.uom ? ` (${product.uom})` : ''}`,
      heroBackgroundImage: product.images.length > 0 ? product.images[0].url : null,
      breadcrumbs: [
        { label: "Home", href: "/" },
        { label: "Products", href: "/products" },
        { label: product.name, href: "#" }
      ],
      productImages: product.images.map((img, index) => ({
        id: `img-${index}`,
        src: img.url,
        alt: img.alt,
        isFeatured: img.isFeatured,
        order: index
      })),
      variations: variationTypes,
      variationCombinations: variationCombinations,
      variationTypes: variationTypes,
      tabs: [
        {
          id: "details",
          label: "Details",
          isActive: true,
          order: 0,
          content: {
            type: "details",
            title: "About the Product",
            description: "Product details and specifications",
            items: parentDetails.length > 0 ? parentDetails : [{
              id: "details-1",
              title: "Specifications",
              description: product.description,
              features: [],
              order: 0
            }]
          }
        },
        {
          id: "specs",
          label: "Specifications",
          isActive: true,
          order: 2,
          content: {
            type: "specs",
            items: parentSpecifications.length > 0 ? parentSpecifications : [
              { label: "SKU", value: product.sku },
              { label: "Brand", value: product.brand || "Style n Homes" },
              ...(product.uom ? [{ label: "Unit of Measure", value: product.uom }] : []),
              ...(product.isRequestQuote ? 
                [
                  { label: "Pricing", value: "Request Quote" },
                  { label: "Availability", value: "Made to Order" }
                ] : 
                [
                  { label: "Price", value: product.price.toString() },
                  { label: "Stock", value: product.stock.toString() }
                ]
              ),
              ...(product.shippingEstimatedTime ? [{ label: "Delivery Time", value: product.shippingEstimatedTime }] : [])
            ]
          }
        }
      ],
      featuresTitle: "Features & Benefits",
      featuresSubtitle: "Discover what makes this product special",
      features,
      relatedProductsTitle: "You May Also Like",
      relatedProductIds: [],
      metaTitle: product.seo.metaTitle,
      metaDescription: product.seo.metaDescription,
      metaKeywords: product.seo.metaKeywords,
      isActive: true,
      isRequestQuote: product.isRequestQuote,
      uom: product.uom || null,
      // 🆕 PARENT PRODUCT MATERIAL AND DIMENSIONS
      material: parentRow.Material?.trim() || null,
      dimensions: parentRow.Dimensions?.trim() || null
    };
    
    if (careInstructions.length > 0) {
      content.tabs.push({
        id: "care",
        label: "Care Instructions",
        isActive: true,
        order: 1,
        content: {
          type: "care",
          items: [{
            id: "care-1",
            features: careInstructions,
            order: 0
          }]
        }
      });
    }
    
    logWithTimestamp('info', 'CONTENT_BUILD', 'PageContent structure built', {
      sku: product.sku,
      tabsCount: content.tabs.length,
      featuresCount: content.features.length,
      parentSpecificationsCount: parentSpecifications.length,
      usingCSVSpecifications: parentSpecifications.length > 0,
      variationCombinationsCount: variationCombinations.length
    });
    
    if (existingPageContent) {
      logWithTimestamp('info', 'PAGECONTENT_UPDATE', 'Updating existing PageContent', {
        sku: product.sku,
        pageContentId: existingPageContent._id
      });
      
      existingPageContent.content = content;
      existingPageContent.title = product.name;
      existingPageContent.updatedAt = new Date();
      
      const updatedPageContent = await existingPageContent.save();
      
      logWithTimestamp('info', 'PAGECONTENT_UPDATE', 'PageContent updated successfully', {
        sku: product.sku,
        pageContentId: updatedPageContent._id
      });
      
      return updatedPageContent;
    } else {
      logWithTimestamp('info', 'PAGECONTENT_CREATE', 'Creating new PageContent', {
        sku: product.sku,
        pageContentId
      });
      
      const pageContent = new PageContent({
        pageId: pageContentId,
        pageType: "product",
        title: product.name,
        content,
        updatedBy: product.createdBy
      });
      
      const newPageContent = await pageContent.save();
      
      logWithTimestamp('info', 'PAGECONTENT_CREATE', 'New PageContent created successfully', {
        sku: product.sku,
        pageContentId: newPageContent._id
      });
      
      return newPageContent;
    }
  } catch (error) {
    logWithTimestamp('error', 'PAGECONTENT_CREATE', 'PageContent creation/update failed', {
      sku: product.sku,
      pageContentId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

// 🆕 DEBUG DATABASE STATE ENDPOINT
const debugDatabaseState = async (req, res) => {
  try {
    logWithTimestamp('info', 'DEBUG_DATABASE', 'Starting database state check');
    
    // Count products
    const totalProducts = await Product.countDocuments();
    const publishedProducts = await Product.countDocuments({ isPublished: true });
    const draftProducts = await Product.countDocuments({ isPublished: false });
    
    // Find products with MARS and VA-VAN SKUs
    const marsProducts = await Product.find({ 
      sku: { $regex: /^SH-BY-B/ } 
    }).select('sku name isPublished createdAt').limit(20);
    
    const vanProducts = await Product.find({ 
      sku: { $regex: /^VA-VAN/ } 
    }).select('sku name isPublished createdAt').limit(20);
    
    // Check for specific SKUs from your upload
    const testSkus = [
      'SH-BY-B6713-120', 'SH-BY-B6718-100', 'SH-BY-B6707-180',
      'SH-BY-B6706-180', 'SH-BY-B6692-150', 'SH-BY-B6510-150',
      'VA-VAN-63', 'VA-VAN-512', 'VA-VAN-423'
    ];
    
    const skuChecks = {};
    for (const sku of testSkus) {
      const product = await Product.findOne({ sku }).select('sku name isPublished createdAt');
      skuChecks[sku] = product ? {
        exists: true,
        id: product._id,
        name: product.name,
        isPublished: product.isPublished,
        createdAt: product.createdAt
      } : { exists: false };
    }
    
    // Get recent products
    const recentProducts = await Product.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('sku name isPublished createdAt');
    
    const debugInfo = {
      databaseStats: {
        totalProducts,
        publishedProducts,
        draftProducts
      },
      marsProducts: marsProducts.map(p => ({
        sku: p.sku,
        name: p.name,
        isPublished: p.isPublished,
        createdAt: p.createdAt
      })),
      vanProducts: vanProducts.map(p => ({
        sku: p.sku,
        name: p.name,
        isPublished: p.isPublished,
        createdAt: p.createdAt
      })),
      specificSkuChecks: skuChecks,
      recentProducts: recentProducts.map(p => ({
        sku: p.sku,
        name: p.name,
        isPublished: p.isPublished,
        createdAt: p.createdAt
      }))
    };
    
    logWithTimestamp('info', 'DEBUG_DATABASE', 'Database state analysis completed', debugInfo);
    
    res.status(200).json({
      success: true,
      message: "Database state analysis completed",
      debugInfo
    });
    
  } catch (error) {
    logWithTimestamp('error', 'DEBUG_DATABASE', 'Database state check failed', error);
    res.status(500).json({
      success: false,
      message: "Failed to check database state",
      error: error.message
    });
  }
};

// Other controller functions with basic logging
const validateCSVStructure = async (req, res) => {
  try {
    const { s3Key } = req.body;
    
    logWithTimestamp('info', 'CSV_VALIDATION', 'Starting CSV structure validation', { s3Key });
    
    if (!s3Key) {
      return res.status(400).json({
        success: false,
        message: "S3 key is required"
      });
    }

    const csvData = await downloadCSVFromS3(s3Key);
    const parsedData = await parseCSV(csvData);
    
    const validationResult = await validateAndStructureDataDynamic(parsedData);
    
    logWithTimestamp('info', 'CSV_VALIDATION', 'CSV validation completed', {
      isValid: validationResult.isValid,
      errorsCount: validationResult.errors.length
    });
    
    res.status(200).json({
      success: true,
      message: "CSV validation completed",
      isValid: validationResult.isValid,
      errors: validationResult.errors,
      summary: validationResult.summary,
      preview: validationResult.preview
    });

  } catch (error) {
    logWithTimestamp('error', 'CSV_VALIDATION', 'CSV validation failed', error);
    res.status(500).json({
      success: false,
      message: "Failed to validate CSV structure",
      error: error.message
    });
  }
};

const getDraftProducts = async (req, res) => {
  try {
    logWithTimestamp('info', 'DRAFT_PRODUCTS', 'Fetching draft products');
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const filter = { isPublished: false };
    
    if (req.query.category) {
      filter.category = req.query.category;
    }
    
    if (req.query.search) {
      filter.$text = { $search: req.query.search };
    }
    
    if (req.query.brand) {
      filter.brand = req.query.brand;
    }
    
    const draftProducts = await Product.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('category', 'name slug')
      .select('name slug sku price stock category createdAt images brand isRequestQuote uom');
    
    const totalDrafts = await Product.countDocuments(filter);
    
    const formattedProducts = draftProducts.map(product => ({
      id: product._id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      price: product.price,
      stock: product.stock,
      brand: product.brand,
      category: product.category,
      uom: product.uom,
      createdAt: product.createdAt,
      isRequestQuote: product.isRequestQuote,
      featuredImage: product.images.find(img => img.isFeatured)?.url || product.images[0]?.url || null
    }));
    
    logWithTimestamp('info', 'DRAFT_PRODUCTS', 'Draft products fetched successfully', {
      totalDrafts,
      currentPage: page,
      productsReturned: formattedProducts.length
    });
    
    res.status(200).json({
      success: true,
      products: formattedProducts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalDrafts / limit),
        totalCount: totalDrafts,
        limit
      }
    });
    
  } catch (error) {
    logWithTimestamp('error', 'DRAFT_PRODUCTS', 'Failed to fetch draft products', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch draft products",
      error: error.message
    });
  }
};

const bulkPublishProducts = async (req, res) => {
  try {
    const { productIds, publishAll = false } = req.body;
    
    logWithTimestamp('info', 'BULK_PUBLISH', 'Starting bulk publish process', {
      publishAll,
      productIdsCount: productIds?.length || 0
    });
    
    if (!publishAll && (!productIds || !Array.isArray(productIds) || productIds.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "Please provide product IDs to publish or set publishAll to true"
      });
    }
    
    let filter = { isPublished: false };
    
    if (!publishAll) {
      filter._id = { $in: productIds };
    }
    
    const updateResult = await Product.updateMany(
      filter,
      { 
        $set: { 
          isPublished: true,
          updatedAt: new Date()
        }
      }
    );
    
    logWithTimestamp('info', 'BULK_PUBLISH', 'Products published successfully', {
      modifiedCount: updateResult.modifiedCount
    });
    
    const publishedProducts = await Product.find({
      _id: publishAll ? undefined : { $in: productIds },
      isPublished: true
    }).select('name slug sku');
    
    res.status(200).json({
      success: true,
      message: `Successfully published ${updateResult.modifiedCount} products`,
      summary: {
        totalPublished: updateResult.modifiedCount,
        publishedProducts: publishedProducts.map(p => ({
          id: p._id,
          name: p.name,
          slug: p.slug,
          sku: p.sku
        }))
      }
    });
    
  } catch (error) {
    logWithTimestamp('error', 'BULK_PUBLISH', 'Bulk publish failed', error);
    res.status(500).json({
      success: false,
      message: "Failed to publish products",
      error: error.message
    });
  }
};

const bulkUnpublishProducts = async (req, res) => {
  try {
    const { productIds } = req.body;
    
    logWithTimestamp('info', 'BULK_UNPUBLISH', 'Starting bulk unpublish process', {
      productIdsCount: productIds?.length || 0
    });
    
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide product IDs to unpublish"
      });
    }
    
    const updateResult = await Product.updateMany(
      { 
        _id: { $in: productIds },
        isPublished: true 
      },
      { 
        $set: { 
          isPublished: false,
          updatedAt: new Date()
        }
      }
    );
    
    logWithTimestamp('info', 'BULK_UNPUBLISH', 'Products unpublished successfully', {
      modifiedCount: updateResult.modifiedCount
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully unpublished ${updateResult.modifiedCount} products`,
      summary: {
        totalUnpublished: updateResult.modifiedCount
      }
    });
    
  } catch (error) {
    logWithTimestamp('error', 'BULK_UNPUBLISH', 'Bulk unpublish failed', error);
    res.status(500).json({
      success: false,
      message: "Failed to unpublish products",
      error: error.message
    });
  }
};

const getBulkPublishStats = async (req, res) => {
  try {
    logWithTimestamp('info', 'PUBLISH_STATS', 'Fetching bulk publish statistics');
    
    const totalProducts = await Product.countDocuments();
    const publishedProducts = await Product.countDocuments({ isPublished: true });
    const draftProducts = await Product.countDocuments({ isPublished: false });
    const requestQuoteProducts = await Product.countDocuments({ isRequestQuote: true });
    
    const draftsByCategory = await Product.aggregate([
      { $match: { isPublished: false } },
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
    
    const recentDrafts = await Product.find({ isPublished: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('category', 'name')
      .select('name sku createdAt category isRequestQuote uom');
    
    const stats = {
      totalProducts,
      publishedProducts,
      draftProducts,
      requestQuoteProducts,
      publishRate: totalProducts > 0 ? ((publishedProducts / totalProducts) * 100).toFixed(1) : 0,
      draftsByCategory,
      recentDrafts: recentDrafts.map(product => ({
        id: product._id,
        name: product.name,
        sku: product.sku,
        category: product.category?.name || 'Unknown',
        isRequestQuote: product.isRequestQuote,
        uom: product.uom,
        createdAt: product.createdAt
      }))
    };
    
    logWithTimestamp('info', 'PUBLISH_STATS', 'Statistics fetched successfully', {
      totalProducts,
      publishedProducts,
      draftProducts
    });
    
    res.status(200).json({
      success: true,
      stats
    });
    
  } catch (error) {
    logWithTimestamp('error', 'PUBLISH_STATS', 'Failed to fetch statistics', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error: error.message
    });
  }
};

// Other standard endpoints (keeping them simple for brevity)
const getBulkUploadHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    // Get user ID from either admin or editor
    const userId = req.admin?._id || req.editor?._id;

    const mockHistory = [{
      id: "upload_1",
      fileName: "products_batch_1.csv",
      uploadedAt: new Date(),
      uploadedBy: userId,
      status: "completed",
      summary: {
        totalRows: 150,
        successful: 145,
        failed: 5,
        productsCreated: 145,
        pageContentCreated: 145
      }
    }];

    res.status(200).json({
      success: true,
      history: mockHistory,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(mockHistory.length / limit),
        totalCount: mockHistory.length,
        limit
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch upload history",
      error: error.message
    });
  }
};

const getBulkUploadStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const mockStatus = {
      jobId,
      status: "processing",
      progress: {
        totalItems: 100,
        processedItems: 75,
        successfulItems: 73,
        failedItems: 2,
        percentage: 75
      },
      startedAt: new Date(Date.now() - 300000),
      estimatedCompletion: new Date(Date.now() + 60000),
      errors: []
    };

    res.status(200).json({
      success: true,
      status: mockStatus
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch job status",
      error: error.message
    });
  }
};

const downloadTemplate = async (req, res) => {
  try {
    const template = `SKU,Parent SKU,Product Name,Description,Short Description,Price,Stock,Category,Brand,UOM,Vendor Name,Vendor Code,Vendor Email,Vendor Phone,Vendor Address,Vendor SKU,vendorCost,HSN Code,Country of Origin,Country Code,Region,Images,Shipping Time,Material,Dimensions,Details,Specifications,Request Quote,Is Variation,Variation Type 1,Variation Value 1,Variation Type 2,Variation Value 2,Variation Type 3,Variation Value 3,Meta Title,Meta Description,Tags,Features,Care Instructions
TEST-001,,Test Product,Test Description,Test Short Description,100,10,VANITIES,Style n Homes,piece,ABC Suppliers,ABC001,supplier@abc.com,+91-9876543210,123 Main Street Mumbai India,AST-001,180.00,57032000,China,CN,Asia,"https://example.com/image1.jpg,https://example.com/image2.jpg",3-5 days,Wood,100x50x80cm,"Premium construction|Durable materials|Modern design","Material: Wood|Size: 100x50x80cm|Weight: 15kg",FALSE,FALSE,,,,,,,Test Product Title,Test product for bulk upload,test,Premium Quality,Easy to clean
TEST-001-BLU,,Test Product Blue Variant,Blue variant description,Blue variant short description,120,5,VANITIES,Style n Homes,piece,ABC Suppliers,ABC001,supplier@abc.com,+91-9876543210,123 Main Street Mumbai India,AST-001-BLU,200.00,57032000,China,CN,Asia,"https://example.com/blue1.jpg,https://example.com/blue2.jpg",3-5 days,Blue Wood,100x50x80cm,"Blue wood construction|Premium blue finish|Modern blue design","Material: Blue Wood|Size: 100x50x80cm|Weight: 15kg|Color: Blue",FALSE,TRUE,Color,Blue,,,,,Test Product Blue Variant,Blue variant for bulk upload,test,blue,Premium Blue Quality,Blue specific care`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bulk_upload_template.csv"');
    res.status(200).send(template);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to generate template",
      error: error.message
    });
  }
};

const retryFailedProducts = async (req, res) => {
  try {
    const { jobId } = req.params;
    const retryResult = {
      jobId,
      retriedItems: 5,
      successfulRetries: 4,
      stillFailed: 1,
      newErrors: []
    };

    res.status(200).json({
      success: true,
      message: "Retry process completed",
      result: retryResult
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to retry products",
      error: error.message
    });
  }
};

const cancelBulkUpload = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    res.status(200).json({
      success: true,
      message: "Bulk upload job cancelled successfully",
      jobId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to cancel bulk upload",
      error: error.message
    });
  }
};

const getBulkUploadStats = async (req, res) => {
  try {
    const mockStats = {
      totalUploads: 25,
      totalProductsCreated: 1250,
      totalProductsFailed: 45,
      averageSuccessRate: 96.4,
      lastUpload: new Date(),
      uploadsThisMonth: 8,
      productsCreatedThisMonth: 420
    };

    res.status(200).json({
      success: true,
      stats: mockStats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error: error.message
    });
  }
};

export {
  getPresignedUrl,
  processBulkUpload,
  validateCSVStructure,
  getBulkUploadHistory,
  getBulkUploadStatus,
  downloadTemplate,
  retryFailedProducts,
  cancelBulkUpload,
  getBulkUploadStats,
  getDraftProducts,
  bulkPublishProducts,
  bulkUnpublishProducts,
  getBulkPublishStats,
  debugDatabaseState  // 🆕 NEW DEBUG ENDPOINT
};