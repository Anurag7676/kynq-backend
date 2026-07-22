// utils/productToPageContentSync.js
import PageContent from "../models/pageContentModel.js";

/**
 * Predefined field mappings between Product and PageContent
 * Product field -> Array of possible PageContent field names
 */
const FIELD_MAPPINGS = {
  name: [
    'productName',
    'heroTitle', 
    'title',
    'name',
    'heading',
    'productTitle'
  ],
  
  description: [
    'fullDescription',
    'description',
    'desc',
    'longDescription',
    'productDescription',
    'content'
  ],
  
  shortDescription: [
    'shortDescription',
    'heroSubtitle',
    'subtitle',
    'shortDesc',
    'summary',
    'brief'
  ],
  
  price: [
    'basePrice',
    'price',
    'cost',
    'productPrice',
    'amount',
    'pricing'
  ],
  
  sku: [
    'sku',
    'productSku',
    'code',
    'productCode'
  ],
  
  'seo.metaTitle': [
    'metaTitle',
    'seoTitle',
    'pageTitle'
  ],
  
  'seo.metaDescription': [
    'metaDescription',
    'seoDescription',
    'metaDesc'
  ],
  
  'seo.metaKeywords': [
    'metaKeywords',
    'seoKeywords',
    'keywords'
  ],
  
  // 🆕 NEW: Shipping estimated time field
  shippingEstimatedTime: [
    'shippingEstimatedTime',
    'deliveryTime',
    'estimatedDelivery',
    'shippingTime'
  ]
};

/**
 * Special handling for images - more complex transformation needed
 */
const IMAGE_FIELD_MAPPINGS = [
  'productImages',
  'images',
  'gallery',
  'photos',
  'imageGallery'
];

const HERO_IMAGE_MAPPINGS = [
  'heroBackgroundImage',
  'heroImage',
  'featuredImage',
  'mainImage'
];

/**
 * Get nested object value using dot notation
 */
const getNestedValue = (obj, path) => {
  return path.split('.').reduce((current, key) => current?.[key], obj);
};

/**
 * Set nested object value using dot notation
 */
const setNestedValue = (obj, path, value) => {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((current, key) => {
    if (!current[key]) current[key] = {};
    return current[key];
  }, obj);
  target[lastKey] = value;
};

/**
 * Transform product images to pageContent format
 */
const transformProductImages = (productImages) => {
  if (!productImages || !Array.isArray(productImages)) return [];
  
  return productImages.map((img, index) => ({
    id: `img-${index}`,
    src: img.url,
    alt: img.alt || 'Product image',
    isFeatured: img.isFeatured || false,
    order: index
  }));
};

/**
 * Recursively find and update fields in content object
 */
const updateContentFields = (content, fieldName, newValue, depth = 0) => {
  // Prevent infinite recursion
  if (depth > 10) return false;
  
  let hasUpdates = false;
  
  if (!content || typeof content !== 'object') return false;
  
  // Handle arrays
  if (Array.isArray(content)) {
    content.forEach(item => {
      if (updateContentFields(item, fieldName, newValue, depth + 1)) {
        hasUpdates = true;
      }
    });
    return hasUpdates;
  }
  
  // Handle objects
  for (const [key, value] of Object.entries(content)) {
    // Check if this key matches our target field name
    if (key === fieldName) {
      console.log(`[SYNC] Updating ${key}: "${value}" -> "${newValue}"`);
      content[key] = newValue;
      hasUpdates = true;
    }
    
    // Recursively check nested objects
    if (typeof value === 'object' && value !== null) {
      if (updateContentFields(value, fieldName, newValue, depth + 1)) {
        hasUpdates = true;
      }
    }
  }
  
  return hasUpdates;
};

/**
 * Update image fields in content
 */
const updateImageFields = (content, newImages, depth = 0) => {
  if (depth > 10) return false;
  
  let hasUpdates = false;
  const transformedImages = transformProductImages(newImages);
  const heroImageUrl = newImages?.[0]?.url || null;
  
  if (!content || typeof content !== 'object') return false;
  
  // Handle arrays
  if (Array.isArray(content)) {
    content.forEach(item => {
      if (updateImageFields(item, newImages, depth + 1)) {
        hasUpdates = true;
      }
    });
    return hasUpdates;
  }
  
  // Handle objects
  for (const [key, value] of Object.entries(content)) {
    // Check for image gallery fields
    if (IMAGE_FIELD_MAPPINGS.includes(key)) {
      console.log(`[SYNC] Updating image gallery field: ${key}`);
      content[key] = transformedImages;
      hasUpdates = true;
    }
    
    // Check for hero image fields
    if (HERO_IMAGE_MAPPINGS.includes(key)) {
      console.log(`[SYNC] Updating hero image field: ${key}`);
      content[key] = heroImageUrl;
      hasUpdates = true;
    }
    
    // Recursively check nested objects
    if (typeof value === 'object' && value !== null) {
      if (updateImageFields(value, newImages, depth + 1)) {
        hasUpdates = true;
      }
    }
  }
  
  return hasUpdates;
};

/**
 * Main sync function: Product → PageContent
 */
export const syncProductToPageContent = async (productId, updatedFields) => {
  try {
    console.log(`[SYNC] Starting sync for product ${productId}`);
    console.log(`[SYNC] Updated fields:`, Object.keys(updatedFields));
    
    // Find PageContent for this product
    const pageContentId = `product-${productId}`;
    const pageContent = await PageContent.findOne({
      pageId: pageContentId,
      pageType: 'product'
    });
    
    if (!pageContent) {
      console.log(`[SYNC] No PageContent found for product ${productId}`);
      return { 
        success: false, 
        message: 'No PageContent found for this product'
      };
    }
    
    console.log(`[SYNC] Found PageContent: ${pageContent._id}`);
    
    // Clone content to avoid mutating original
    const updatedContent = JSON.parse(JSON.stringify(pageContent.content));
    let hasAnyUpdates = false;
    
    // Process each updated field
    for (const [productField, newValue] of Object.entries(updatedFields)) {
      const possibleFieldNames = FIELD_MAPPINGS[productField];
      
      if (possibleFieldNames) {
        console.log(`[SYNC] Processing ${productField} -> ${possibleFieldNames.join(', ')}`);
        
        // Handle nested fields (like seo.metaTitle)
        let actualValue = newValue;
        if (productField.includes('.')) {
          // For nested fields, the newValue is already the final value
          actualValue = newValue;
        }
        
        // Update each possible field name
        for (const fieldName of possibleFieldNames) {
          if (updateContentFields(updatedContent, fieldName, actualValue)) {
            hasAnyUpdates = true;
          }
        }
      }
      
      // Special handling for images
      else if (productField === 'images') {
        console.log(`[SYNC] Processing images`);
        if (updateImageFields(updatedContent, newValue)) {
          hasAnyUpdates = true;
        }
      }
      
      else {
        console.log(`[SYNC] No mapping found for field: ${productField}`);
      }
    }
    
    // Update price in specs tab if price was changed
    if (updatedFields.price && updatedContent.tabs) {
      const specsTab = updatedContent.tabs.find(tab => tab.id === 'specs');
      if (specsTab?.content?.items) {
        const priceSpec = specsTab.content.items.find(item => item.label === 'Price');
        if (priceSpec) {
          console.log(`[SYNC] Updating price in specs tab: ${priceSpec.value} -> ${updatedFields.price}`);
          priceSpec.value = updatedFields.price.toString();
          hasAnyUpdates = true;
        }
      }
    }
    
    // Save changes if any updates were made
    if (hasAnyUpdates) {
      pageContent.content = updatedContent;
      pageContent.updatedAt = new Date();
      await pageContent.save();
      
      console.log(`[SYNC] PageContent updated successfully`);
      return { 
        success: true, 
        message: 'PageContent synced successfully',
        updatedFields: Object.keys(updatedFields)
      };
    } else {
      console.log(`[SYNC] No matching fields found to update`);
      return { 
        success: true, 
        message: 'No matching fields found to update'
      };
    }
    
  } catch (error) {
    console.error(`[SYNC] Error syncing product to PageContent:`, error);
    return { 
      success: false, 
      message: error.message 
    };
  }
};

/**
 * Helper function to add new field mappings dynamically
 */
export const addFieldMapping = (productField, pageContentFields) => {
  if (!FIELD_MAPPINGS[productField]) {
    FIELD_MAPPINGS[productField] = [];
  }
  
  const newFields = Array.isArray(pageContentFields) ? pageContentFields : [pageContentFields];
  FIELD_MAPPINGS[productField].push(...newFields);
  
  // Remove duplicates
  FIELD_MAPPINGS[productField] = [...new Set(FIELD_MAPPINGS[productField])];
  
  console.log(`[SYNC] Added mapping: ${productField} -> ${newFields.join(', ')}`);
};

/**
 * Get current field mappings (for debugging/admin interface)
 */
export const getFieldMappings = () => {
  return {
    ...FIELD_MAPPINGS,
    images: IMAGE_FIELD_MAPPINGS,
    heroImages: HERO_IMAGE_MAPPINGS
  };
};