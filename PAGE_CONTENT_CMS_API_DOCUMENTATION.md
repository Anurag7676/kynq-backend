# Page Content CMS API Documentation

Complete API documentation for editing and managing page content through the CMS, including product variations, categories, and custom pages.

## Table of Contents
- [Base URL](#base-url)
- [Authentication](#authentication)
- [Endpoints Overview](#endpoints-overview)
- [Public Endpoints](#public-endpoints)
- [CMS Endpoints](#cms-endpoints)
- [Content Structure](#content-structure)
- [Variation Management](#variation-management)
- [Reference System](#reference-system)
- [Examples](#examples)
- [Error Handling](#error-handling)

---

## Base URL

```
/api/content
```

**Note:** Replace with your actual API base URL (e.g., `https://yourdomain.com/api/content`)

---

## Authentication

### For CMS Endpoints

All CMS endpoints require:
1. **Bearer Token Authentication** - JWT token in Authorization header
2. **CMS Permission** - User must have `cms` section permission (Admin or Editor with CMS access)

### Headers Required

```http
Authorization: Bearer <your_jwt_token>
Content-Type: application/json
```

### Authentication Flow

1. Login via `/api/admin/login` to get JWT token
2. Include token in `Authorization` header for all CMS requests
3. Token must belong to an Admin or Editor with `cms` permissions

---

## Endpoints Overview

### Public Endpoints (No Authentication)
- `GET /api/content/:pageType/:id` - Get content for a specific page
- `GET /api/content/:pageType` - Get all pages by type (with pagination)

### CMS Endpoints (Authentication Required)
- `GET /api/content` - Get list of all page content entries
- `POST /api/content/:pageType/:id` - Create new page content
- `PUT /api/content/:pageType/:id` - Update existing page content
- `DELETE /api/content/:pageType/:id` - Delete page content

---

## Public Endpoints

### 1. Get Page Content

Retrieve content for a specific page (product, category, homepage, or custom page).

**Endpoint:** `GET /api/content/:pageType/:id`

**Authentication:** Not required

**Path Parameters:**
- `pageType` (required): Type of page
  - Values: `product`, `category`, `homepage`, `custom`
- `id` (required): 
  - For `product`: Product ID (MongoDB ObjectId) or slug
  - For `category`: Category ID (MongoDB ObjectId) or slug
  - For `homepage`: Must be `"homepage"`
  - For `custom`: Custom page identifier

**Response (200 OK):**
```json
{
  "success": true,
  "entity": {
    "_id": "product_id",
    "name": "Product Name",
    "slug": "product-slug",
    "price": 299.99,
    "images": ["url1", "url2"]
  },
  "content": {
    "hero": {
      "title": "Product Name",
      "subtitle": "Product description",
      "image": "image_url"
    },
    "sections": [],
    "tabs": [],
    "variationCombinations": [],
    "seo": {}
  }
}
```

**Note:** If no custom content exists, returns default structure based on entity data.

---

### 2. Get All Pages by Type

Retrieve a paginated list of all pages of a specific type.

**Endpoint:** `GET /api/content/:pageType`

**Authentication:** Not required

**Path Parameters:**
- `pageType` (required): Type of page (`product`, `category`, `homepage`, `custom`)

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `includeContent` (optional): Include full content in response (`true`/`false`, default: `false`)

**Response (200 OK):**
```json
{
  "success": true,
  "pageType": "product",
  "data": [
    {
      "pageId": "product-507f1f77bcf86cd799439011",
      "pageType": "product",
      "title": "Product Name",
      "isActive": true,
      "updatedAt": "2024-01-15T10:30:00.000Z",
      "createdAt": "2024-01-10T08:00:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalCount": 50,
    "limit": 10,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

## CMS Endpoints

### 3. Get All Page Content

Get a list of all page content entries (for admin dashboard).

**Endpoint:** `GET /api/content`

**Authentication:** Required (Bearer Token + CMS Permission)

**Response (200 OK):**
```json
{
  "success": true,
  "count": 150,
  "pageContents": [
    {
      "pageId": "product-507f1f77bcf86cd799439011",
      "pageType": "product",
      "title": "Product Name",
      "isActive": true,
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### 4. Create Page Content

Create new page content for a product, category, homepage, or custom page.

**Endpoint:** `POST /api/content/:pageType/:id`

**Authentication:** Required (Bearer Token + CMS Permission)

**Path Parameters:**
- `pageType`: `product`, `category`, `homepage`, or `custom`
- `id`: Entity ID or slug (for homepage use `"homepage"`)

**Request Body:**
```json
{
  "content": {
    "hero": {
      "title": "Product Title",
      "subtitle": "Product Subtitle",
      "image": "https://example.com/image.jpg"
    },
    "sections": [],
    "tabs": [],
    "variationCombinations": [],
    "seo": {}
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Page content created successfully",
  "pageContent": {
    "_id": "page_content_id",
    "pageId": "product-507f1f77bcf86cd799439011",
    "pageType": "product",
    "title": "Product Name",
    "content": { /* full content object */ },
    "isActive": true,
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "message": "Page content already exists. Use PUT to update."
}
```

---

### 5. Update Page Content

Update existing page content (creates if doesn't exist - upsert behavior).

**Endpoint:** `PUT /api/content/:pageType/:id`

**Authentication:** Required (Bearer Token + CMS Permission)

**Path Parameters:**
- `pageType`: `product`, `category`, `homepage`, or `custom`
- `id`: Entity ID or slug

**Request Body:**
```json
{
  "content": {
    /* Full or partial content object */
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Page content updated successfully",
  "pageContent": {
    /* Updated page content object */
  }
}
```

**Note:** This endpoint supports partial updates. You can send only the fields you want to update.

---

### 6. Delete Page Content

Delete page content for a specific page.

**Endpoint:** `DELETE /api/content/:pageType/:id`

**Authentication:** Required (Bearer Token + CMS Permission)

**Path Parameters:**
- `pageType`: `product`, `category`, `homepage`, or `custom`
- `id`: Entity ID or slug

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Page content deleted successfully"
}
```

---

## Content Structure

### Complete Content Object Structure

The `content` field in PageContent is a flexible Mixed type that can contain any structure. Below are the recommended structures for different page types:

### Product Page Content Structure

```typescript
{
  // Hero Section
  hero: {
    title: string;
    subtitle?: string;
    image?: string;
    backgroundImage?: string;
    ctaButton?: {
      text: string;
      link: string;
    };
  };

  // Main Sections (flexible array)
  sections: Array<{
    id: string;
    type: "text" | "image" | "gallery" | "video" | "productShowcase" | "custom";
    title?: string;
    content: any; // Flexible based on type
    order: number;
    isActive: boolean;
  }>;

  // Tabbed Content
  tabs: Array<{
    id: string;
    label: string;
    content: {
      type: "specs" | "details" | "features" | "care" | "custom";
      items?: Array<{
        id: string;
        label: string;
        value: string;
        order: number;
        isActive: boolean;
      }>;
      // For specs type
      items?: Array<{
        id: string;
        label: string;
        value: string;
        order: number;
        isActive: boolean;
      }>;
      // For features type
      features?: Array<{
        id: string;
        icon: string;
        title: string;
        description: string;
        order: number;
        isActive: boolean;
      }>;
      // For care instructions
      careInstructions?: string[];
    };
    order: number;
    isActive: boolean;
  }>;

  // Variation Combinations (see Variation Management section)
  variationCombinations: Array<{
    id: string;
    combination: { [key: string]: string }; // e.g., { color: "blue", size: "large" }
    sku: string;
    price: number;
    comparePrice?: number;
    stockQuantity: number;
    images: string[];
    displayLabel: string;
    description?: string;
    shortDescription?: string;
    material?: string;
    dimensions?: string;
    details?: Array<{
      id: string;
      description: string;
      order: number;
      isActive: boolean;
    }>;
    specifications?: Array<{
      id: string;
      label: string;
      value: string;
      order: number;
      isActive: boolean;
    }>;
    careInstructions?: string[];
    features?: Array<{
      id: string;
      icon: string;
      title: string;
      description: string;
      order: number;
      isActive: boolean;
    }>;
    uom?: string;
    isActive?: boolean;
    isEnabled?: boolean;
  }>;

  // SEO Settings
  seo: {
    metaTitle?: string;
    metaDescription?: string;
    metaKeywords?: string[];
    ogImage?: {
      url: string;
      alt: string;
    };
  };

  // Additional fields
  uom?: string; // Unit of Measure
  shippingEstimatedTime?: string;
}
```

### Category Page Content Structure

```typescript
{
  hero: {
    title: string;
    subtitle?: string;
    image?: string;
  };
  sections: Array<{
    id: string;
    type: string;
    content: any;
    order: number;
    isActive: boolean;
  }>;
  seo: {
    metaTitle?: string;
    metaDescription?: string;
  };
}
```

### Homepage Content Structure

```typescript
{
  hero: {
    title: string;
    subtitle?: string;
    image?: string;
  };
  sections: Array<{
    id: string;
    type: string;
    content: any;
    order: number;
    isActive: boolean;
  }>;
}
```

### Custom Page Content Structure

```typescript
{
  hero: {
    title: string;
    subtitle?: string;
    image?: string;
  };
  sections: Array<{
    id: string;
    type: string;
    content: any;
    order: number;
    isActive: boolean;
  }>;
  seo?: {
    metaTitle?: string;
    metaDescription?: string;
  };
}
```

---

## Variation Management

### Understanding Variation Combinations

Variation combinations represent different product variants (e.g., different colors, sizes, materials). Each combination has:
- Unique combination ID (e.g., `"color-blue-size-large"`)
- Combination object mapping variation types to values
- Individual pricing, stock, images, and content

### Creating/Updating Variation Combinations

**Example: Add a new variation combination**

```http
PUT /api/content/product/PRODUCT_ID
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": {
    "variationCombinations": [
      {
        "id": "color-blue-size-large",
        "combination": {
          "color": "blue",
          "size": "large"
        },
        "sku": "PROD-001-BLU-LG",
        "price": 299.99,
        "comparePrice": 349.99,
        "stockQuantity": 10,
        "images": [
          "https://example.com/blue-large-1.jpg",
          "https://example.com/blue-large-2.jpg"
        ],
        "displayLabel": "Blue / Large",
        "description": "This is the blue large variant with premium materials",
        "shortDescription": "Blue Large",
        "material": "Premium Cotton Blend",
        "dimensions": "120cm x 80cm",
        "details": [
          {
            "id": "detail-1",
            "description": "Handcrafted with premium materials",
            "order": 0,
            "isActive": true
          }
        ],
        "specifications": [
          {
            "id": "spec-1",
            "label": "Material",
            "value": "Premium Cotton Blend",
            "order": 0,
            "isActive": true
          },
          {
            "id": "spec-2",
            "label": "Size",
            "value": "120cm x 80cm",
            "order": 1,
            "isActive": true
          }
        ],
        "careInstructions": [
          "Machine wash cold",
          "Tumble dry low",
          "Do not bleach"
        ],
        "features": [
          {
            "id": "feature-1",
            "icon": "✦",
            "title": "Premium Quality",
            "description": "Made with the finest materials",
            "order": 0,
            "isActive": true
          }
        ],
        "uom": "piece",
        "isActive": true,
        "isEnabled": true
      }
    ]
  }
}
```

### Updating a Specific Variation

To update only one variation combination, you can:

1. **Get current content:**
```http
GET /api/content/product/PRODUCT_ID
```

2. **Modify the specific variation in the array:**
```json
{
  "content": {
    "variationCombinations": [
      {
        "id": "color-blue-size-large",
        // ... update only the fields you want to change
        "price": 279.99,  // Updated price
        "stockQuantity": 15,  // Updated stock
        "images": ["new-image.jpg"]  // Updated images
      }
    ]
  }
}
```

3. **Send PUT request with updated content**

### Adding Multiple Variations

```json
{
  "content": {
    "variationCombinations": [
      {
        "id": "color-blue-size-small",
        "combination": { "color": "blue", "size": "small" },
        "sku": "PROD-001-BLU-SM",
        "price": 199.99,
        "stockQuantity": 5,
        "images": ["blue-small.jpg"],
        "displayLabel": "Blue / Small",
        "isActive": true
      },
      {
        "id": "color-red-size-large",
        "combination": { "color": "red", "size": "large" },
        "sku": "PROD-001-RED-LG",
        "price": 299.99,
        "stockQuantity": 8,
        "images": ["red-large.jpg"],
        "displayLabel": "Red / Large",
        "isActive": true
      }
    ]
  }
}
```

### Removing a Variation

To remove a variation, send the updated `variationCombinations` array without the variation you want to remove:

```json
{
  "content": {
    "variationCombinations": [
      // Only include variations you want to keep
      {
        "id": "color-blue-size-large",
        // ... keep this one
      }
      // Removed: color-red-size-large
    ]
  }
}
```

### Variation Combination ID Format

The combination ID should be a unique string that identifies the specific variation combination. Common formats:

- `"color-blue-size-large"`
- `"material-wool-size-8x10"`
- `"combo-indian-wool-170-x-140-cm"`

**Best Practice:** Use a format that's readable and includes the variation values.

---

## Reference System

The page content system supports references to products and categories. This allows you to embed product/category information dynamically.

### Product Reference

Reference a product in your content:

```json
{
  "sections": [
    {
      "id": "related-products",
      "type": "productShowcase",
      "content": {
        "products": [
          {
            "__type": "productRef",
            "id": "507f1f77bcf86cd799439011"
          }
        ]
      }
    }
  ]
}
```

When fetched, the API automatically resolves this to:

```json
{
  "__type": "product",
  "id": "507f1f77bcf86cd799439011",
  "name": "Product Name",
  "slug": "product-slug",
  "price": 299.99,
  "imageUrl": "https://example.com/image.jpg",
  "stock": 10
}
```

### Category Reference

Reference a category:

```json
{
  "sections": [
    {
      "id": "related-categories",
      "type": "categoryShowcase",
      "content": {
        "categories": [
          {
            "__type": "categoryRef",
            "id": "507f1f77bcf86cd799439012"
          }
        ]
      }
    }
  ]
}
```

Resolved to:

```json
{
  "__type": "category",
  "id": "507f1f77bcf86cd799439012",
  "name": "Category Name",
  "slug": "category-slug",
  "image": "https://example.com/category.jpg"
}
```

### Reference Validation

When creating/updating content with references, the API validates:
- Product references must point to existing, published products
- Category references must point to existing categories
- Invalid references will cause the request to fail with a 400 error

---

## Examples

### Example 1: Create Product Page Content with Variations

```bash
curl -X POST https://yourdomain.com/api/content/product/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "hero": {
        "title": "Premium Area Rug",
        "subtitle": "Handcrafted luxury for your home",
        "image": "https://example.com/hero.jpg"
      },
      "tabs": [
        {
          "id": "specs",
          "label": "Specifications",
          "content": {
            "type": "specs",
            "items": [
              {
                "id": "spec-1",
                "label": "Material",
                "value": "New Zealand Wool",
                "order": 0,
                "isActive": true
              },
              {
                "id": "spec-2",
                "label": "Size",
                "value": "8x10ft",
                "order": 1,
                "isActive": true
              }
            ]
          },
          "order": 0,
          "isActive": true
        },
        {
          "id": "features",
          "label": "Features",
          "content": {
            "type": "features",
            "features": [
              {
                "id": "feature-1",
                "icon": "✦",
                "title": "Premium Quality",
                "description": "Made with finest materials",
                "order": 0,
                "isActive": true
              }
            ]
          },
          "order": 1,
          "isActive": true
        }
      ],
      "variationCombinations": [
        {
          "id": "material-wool-size-8x10",
          "combination": {
            "material": "wool",
            "size": "8x10"
          },
          "sku": "RUG-001-WOOL-8X10",
          "price": 299.99,
          "comparePrice": 349.99,
          "stockQuantity": 10,
          "images": ["rug-wool-8x10-1.jpg", "rug-wool-8x10-2.jpg"],
          "displayLabel": "Wool / 8x10ft",
          "description": "Premium wool rug in 8x10ft size",
          "specifications": [
            {
              "id": "var-spec-1",
              "label": "Material",
              "value": "Wool",
              "order": 0,
              "isActive": true
            }
          ],
          "isActive": true
        }
      ],
      "seo": {
        "metaTitle": "Premium Area Rug - Luxury Home Decor",
        "metaDescription": "Handcrafted premium area rug",
        "metaKeywords": ["rug", "carpet", "home decor"]
      }
    }
  }'
```

### Example 2: Update Only Variation Price and Stock

```bash
# First, get current content
curl -X GET https://yourdomain.com/api/content/product/507f1f77bcf86cd799439011

# Then update with modified variation
curl -X PUT https://yourdomain.com/api/content/product/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "variationCombinations": [
        {
          "id": "material-wool-size-8x10",
          "combination": {
            "material": "wool",
            "size": "8x10"
          },
          "sku": "RUG-001-WOOL-8X10",
          "price": 279.99,
          "stockQuantity": 5,
          "images": ["rug-wool-8x10-1.jpg"],
          "displayLabel": "Wool / 8x10ft",
          "isActive": true
        }
      ]
    }
  }'
```

### Example 3: Add a New Variation to Existing Product

```bash
# Get current content
curl -X GET https://yourdomain.com/api/content/product/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" > current-content.json

# Modify to add new variation, then:
curl -X PUT https://yourdomain.com/api/content/product/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "variationCombinations": [
        {
          "id": "material-wool-size-8x10",
          // ... existing variation
        },
        {
          "id": "material-cotton-size-6x9",
          "combination": {
            "material": "cotton",
            "size": "6x9"
          },
          "sku": "RUG-001-COTTON-6X9",
          "price": 199.99,
          "stockQuantity": 8,
          "images": ["rug-cotton-6x9.jpg"],
          "displayLabel": "Cotton / 6x9ft",
          "isActive": true
        }
      ]
    }
  }'
```

### Example 4: Update Product Specifications Tab

```bash
curl -X PUT https://yourdomain.com/api/content/product/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "tabs": [
        {
          "id": "specs",
          "label": "Specifications",
          "content": {
            "type": "specs",
            "items": [
              {
                "id": "spec-1",
                "label": "Material",
                "value": "Premium New Zealand Wool",
                "order": 0,
                "isActive": true
              },
              {
                "id": "spec-2",
                "label": "Construction",
                "value": "Hand-tufted",
                "order": 1,
                "isActive": true
              },
              {
                "id": "spec-3",
                "label": "Size",
                "value": "8x10ft / 240x300cm",
                "order": 2,
                "isActive": true
              },
              {
                "id": "spec-4",
                "label": "Weight",
                "value": "5.2kg",
                "order": 3,
                "isActive": true
              }
            ]
          },
          "order": 0,
          "isActive": true
        }
      ]
    }
  }'
```

### Example 5: Create Category Page Content

```bash
curl -X POST https://yourdomain.com/api/content/category/507f1f77bcf86cd799439012 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "hero": {
        "title": "Rugs Collection",
        "subtitle": "Discover our premium rug collection",
        "image": "https://example.com/category-hero.jpg"
      },
      "sections": [
        {
          "id": "intro",
          "type": "text",
          "content": {
            "text": "Our rugs collection features handcrafted pieces from around the world."
          },
          "order": 0,
          "isActive": true
        },
        {
          "id": "featured-products",
          "type": "productShowcase",
          "content": {
            "products": [
              {
                "__type": "productRef",
                "id": "507f1f77bcf86cd799439011"
              }
            ]
          },
          "order": 1,
          "isActive": true
        }
      ],
      "seo": {
        "metaTitle": "Rugs Collection - Premium Home Decor",
        "metaDescription": "Browse our collection of premium rugs"
      }
    }
  }'
```

### Example 6: JavaScript/Fetch Example - Update Variation

```javascript
async function updateVariation(productId, combinationId, updates) {
  const token = 'YOUR_JWT_TOKEN';
  
  // First, get current content
  const getResponse = await fetch(
    `https://yourdomain.com/api/content/product/${productId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  const { content } = await getResponse.json();
  
  // Find and update the specific variation
  const variationIndex = content.variationCombinations.findIndex(
    v => v.id === combinationId
  );
  
  if (variationIndex === -1) {
    throw new Error('Variation not found');
  }
  
  // Update the variation
  content.variationCombinations[variationIndex] = {
    ...content.variationCombinations[variationIndex],
    ...updates
  };
  
  // Send update request
  const updateResponse = await fetch(
    `https://yourdomain.com/api/content/product/${productId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    }
  );
  
  const result = await updateResponse.json();
  
  if (result.success) {
    console.log('Variation updated successfully');
    return result.pageContent;
  } else {
    throw new Error(result.message);
  }
}

// Usage
updateVariation('507f1f77bcf86cd799439011', 'material-wool-size-8x10', {
  price: 279.99,
  stockQuantity: 5
});
```

### Example 7: Add New Variation with Full Details

```javascript
async function addVariation(productId, variationData) {
  const token = 'YOUR_JWT_TOKEN';
  
  // Get current content
  const getResponse = await fetch(
    `https://yourdomain.com/api/content/product/${productId}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );
  
  const { content } = await getResponse.json();
  
  // Ensure variationCombinations array exists
  if (!content.variationCombinations) {
    content.variationCombinations = [];
  }
  
  // Add new variation
  content.variationCombinations.push({
    id: variationData.id,
    combination: variationData.combination,
    sku: variationData.sku,
    price: variationData.price,
    comparePrice: variationData.comparePrice,
    stockQuantity: variationData.stockQuantity,
    images: variationData.images || [],
    displayLabel: variationData.displayLabel,
    description: variationData.description,
    shortDescription: variationData.shortDescription,
    material: variationData.material,
    dimensions: variationData.dimensions,
    details: variationData.details || [],
    specifications: variationData.specifications || [],
    careInstructions: variationData.careInstructions || [],
    features: variationData.features || [],
    uom: variationData.uom,
    isActive: true,
    isEnabled: true
  });
  
  // Update content
  const updateResponse = await fetch(
    `https://yourdomain.com/api/content/product/${productId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    }
  );
  
  return await updateResponse.json();
}

// Usage
addVariation('507f1f77bcf86cd799439011', {
  id: 'material-silk-size-10x12',
  combination: { material: 'silk', size: '10x12' },
  sku: 'RUG-001-SILK-10X12',
  price: 499.99,
  comparePrice: 599.99,
  stockQuantity: 3,
  images: ['silk-rug-1.jpg', 'silk-rug-2.jpg'],
  displayLabel: 'Silk / 10x12ft',
  description: 'Luxury silk rug in 10x12ft size',
  specifications: [
    {
      id: 'spec-1',
      label: 'Material',
      value: '100% Silk',
      order: 0,
      isActive: true
    }
  ]
});
```

---

## Error Handling

### Standard Error Response Format

```json
{
  "success": false,
  "message": "Error message here",
  "error": "Detailed error message (development only)"
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors, invalid references)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (no CMS permission)
- `404` - Not Found (page content/entity doesn't exist)
- `500` - Server Error

### Common Error Messages

1. **Authentication Errors:**
   - `"Not authorized, no token provided"` - Missing token
   - `"Not authorized, token failed"` - Invalid/expired token
   - `"Access denied. You don't have cms permissions."` - No CMS access

2. **Validation Errors:**
   - `"Invalid page type"` - Invalid pageType parameter
   - `"Content is required"` - Missing content in request body
   - `"One or more product references are invalid"` - Invalid product reference
   - `"One or more category references are invalid"` - Invalid category reference
   - `"Product not found"` - Product doesn't exist
   - `"Category not found"` - Category doesn't exist

3. **Not Found Errors:**
   - `"Page content not found"` - Page content doesn't exist (for DELETE)
   - `"Category not found"` - Category entity doesn't exist
   - `"Product not found"` - Product entity doesn't exist

4. **Conflict Errors:**
   - `"Page content already exists. Use PUT to update."` - Trying to create when one exists (POST)

---

## Best Practices

### 1. Variation Management

- **Unique IDs:** Always use unique, descriptive combination IDs
- **Consistent Structure:** Keep variation structure consistent across all combinations
- **Stock Management:** Update stock quantities through variations, not parent product
- **Images:** Provide at least one image per variation for better UX

### 2. Content Updates

- **Partial Updates:** You can send only the fields you want to update
- **Get Before Update:** For complex updates, fetch current content first
- **Reference Validation:** Always validate product/category references exist before using

### 3. Performance

- **Pagination:** Use pagination when fetching lists of pages
- **includeContent:** Only include full content when needed (use `includeContent=false` for lists)
- **Batch Operations:** For multiple updates, consider batching requests

### 4. SEO

- **Meta Tags:** Always include SEO meta tags for better search visibility
- **Descriptive Titles:** Use descriptive, keyword-rich titles
- **OG Images:** Include Open Graph images for social sharing

### 5. Variation Combinations

- **Display Labels:** Use clear, user-friendly display labels
- **Combination Object:** Keep combination object keys consistent (e.g., always use "color", not "Color" or "COLOR")
- **Specifications:** Provide variation-specific specifications when they differ from parent

---

## Notes

1. **Page ID Format:**
   - Format: `{pageType}-{entityId}`
   - Examples: `product-507f1f77bcf86cd799439011`, `category-507f1f77bcf86cd799439012`, `homepage-homepage`

2. **Slug Support:**
   - Products and categories can be accessed by slug instead of ID
   - API automatically resolves slug to ID internally

3. **Upsert Behavior:**
   - `PUT` endpoint creates content if it doesn't exist (upsert)
   - `POST` endpoint only creates (fails if exists)

4. **Reference Resolution:**
   - References are automatically resolved when fetching content
   - Invalid references are marked with `notFound: true` in response

5. **Variation Stock:**
   - Variation stock is managed in PageContent, not Product model
   - Stock updates should be done through variation combinations

6. **Content Flexibility:**
   - The `content` field is Mixed type - you can store any structure
   - Recommended structures are provided, but you can customize

---

## Support

For issues or questions:
1. Check this documentation
2. Review API error messages
3. Verify authentication and permissions
4. Check that referenced entities exist

---

**Last Updated:** January 2024  
**Version:** 1.0  
**Status:** Active ✅




