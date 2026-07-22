# Product Specifications - Bulk Upload API Documentation

## Overview

This document explains how product specifications are stored and processed in the bulk upload API. Specifications can be provided for both **parent products** and **variation combinations** via CSV upload.

---

## 📊 Storage Architecture

### Data Models

#### Product Model (`productModel.js`)
- **Does NOT store specifications**
- Stores only basic product information (SKU, name, price, stock, etc.)
- Specifications are stored separately in PageContent

#### PageContent Model (`pageContentModel.js`)
- **Primary storage for specifications**
- Stores all display-related product content
- Uses a flexible `content` field (Mixed type) for rich data structures

### Storage Structure

```javascript
PageContent {
  pageId: "product-{productId}",
  pageType: "product",
  title: "Product Name",
  content: {
    // Parent Product Specifications
    tabs: [
      {
        id: "specs",
        label: "Specifications",
        content: {
          type: "specs",
          items: [
            { id: "parent-spec-0", label: "Material", value: "New Zealand Wool", order: 0 },
            { id: "parent-spec-1", label: "Construction", value: "Handtufted", order: 1 },
            { id: "parent-spec-2", label: "Size", value: "8x10ft", order: 2 }
          ]
        }
      }
    ],
    
    // Variation Specifications
    variationCombinations: [
      {
        id: "combo-indian-wool-170-x-140-cm",
        combination: { material: "indian-wool", size: "170-x-140-cm" },
        specifications: [
          { id: "combo-...-spec-0", label: "Material", value: "Indian Wool", order: 0 },
          { id: "combo-...-spec-1", label: "Size", value: "170x140cm", order: 1 }
        ]
      }
    ]
  }
}
```

---

## 📝 CSV Format

### Column Name
`Specifications`

### Format Rules
1. **Separator for multiple specs:** Pipe `|`
2. **Separator for label-value:** Colon `:`
3. **Format:** `Label: Value|Label: Value|Label: Value`

### Examples

#### Parent Product Specifications
```csv
SKU,Product Name,Description,Price,Stock,Category,Specifications
RU-AST-173,Astral Modern Area Rug,Celestial design rug,260,10,Rugs,"Material: New Zealand Wool|Construction: Handtufted|Size: 8x10ft / 240x300cm|Brand: Shanghai Fuli|Country of Origin: China|Delivery Time: 60 days"
```

#### Variation Specifications
```csv
SKU,Parent SKU,Is Variation,Specifications,Variation Type 1,Variation Value 1,Variation Type 2,Variation Value 2
AM-RC-001,RU-AST-173,TRUE,"Material: Indian Wool|Size: 170 x 140 cm|Weight: 2.5kg|Thickness: 8mm",Material,Indian Wool,Size,170 x 140 cm
AM-RC-002,RU-AST-173,TRUE,"Material: New Zealand Wool|Size: 220 x 180 cm|Weight: 4.2kg|Thickness: 10mm",Material,New Zealand Wool,Size,220 x 180 cm
```

---

## 🔧 Processing Logic

### Parent Product Specifications

**Location:** `bulkUploadController.js` - `createPageContentFromRowDynamic()` function

**Processing Steps:**

1. **Extract from CSV** (Lines 2510-2527)
   ```javascript
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
   ```

2. **Store in PageContent** (Lines 2789-2813)
   ```javascript
   {
     id: "specs",
     label: "Specifications",
     content: {
       type: "specs",
       items: parentSpecifications.length > 0 ? parentSpecifications : [
         // Fallback to automatic values if CSV is empty
         { label: "SKU", value: product.sku },
         { label: "Brand", value: product.brand },
         // ... other automatic fields
       ]
     }
   }
   ```

**Key Features:**
- ✅ Uses CSV specifications when provided
- ✅ Falls back to automatic values (SKU, Brand, UOM, Price) if CSV is empty
- ✅ Supports unlimited number of specifications
- ✅ Each specification gets a unique ID

---

### Variation Specifications

**Location:** `bulkUploadController.js` - `createPageContentFromRowDynamic()` function

**Processing Steps:**

1. **Extract from CSV** (Lines 2613-2623)
   ```javascript
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
   ```

2. **Store in Variation Combination** (Lines 2658-2693)
   ```javascript
   variationCombinations.push({
     id: combinationId,
     combination,
     sku: variation.SKU,
     price: parseFloat(variation.Price),
     specifications: variationSpecifications,
     // ... other variation fields
   });
   ```

**Key Features:**
- ✅ Each variation can have unique specifications
- ✅ Specifications tied to specific variation combination
- ✅ Combination ID ensures uniqueness
- ✅ Inherits from parent product if variation doesn't specify

---

## 📤 Export Functionality

### Exporting Specifications

**Location:** `productExportController.js` - `extractRichContent()` function

When exporting products to CSV, specifications are extracted from PageContent:

**For Parent Products** (Lines 528-550)
```javascript
case 'specs':
  if (tab.content?.items) {
    const customSpecs = [];
    
    tab.content.items.forEach(item => {
      // Skip basic system specs (SKU, Brand, UOM, etc.)
      if (!['SKU', 'Brand', 'Unit of Measure', 'Pricing', 'Availability', 'Price', 'Stock', 'Delivery Time'].includes(item.label)) {
        if (item.label && item.value) {
          customSpecs.push(`${item.label}: ${item.value}`);
        }
      }
    });
    
    specifications = customSpecs.join('|'); // Pipe-separated output
  }
  break;
```

**For Variations** (Lines 411-473)
```javascript
const buildVariationRows = async (product, pageContent) => {
  variationCombinations.forEach(combo => {
    // Extract specifications from variation combination
    const variationSpecs = combo.specifications ? 
      combo.specifications.map(spec => `${spec.label}: ${spec.value}`).join('|') : '';
    
    row['Specifications'] = variationSpecs;
  });
};
```

**Export Features:**
- ✅ Exports in same format as import (pipe and colon separated)
- ✅ Filters out system-generated specs (SKU, Brand, etc.)
- ✅ Preserves custom specifications only
- ✅ Maintains label-value pairing

---

## 🎯 Use Cases

### Use Case 1: Product with Standard Specifications

**CSV Input:**
```csv
Specifications
"Material: Wool|Size: 8x10ft|Weight: 5kg|Care: Dry clean only"
```

**Stored As:**
```javascript
items: [
  { label: "Material", value: "Wool" },
  { label: "Size", value: "8x10ft" },
  { label: "Weight", value: "5kg" },
  { label: "Care", value: "Dry clean only" }
]
```

---

### Use Case 2: Variations with Different Specifications

**Parent Product:**
```csv
SKU: RU-AST-173
Specifications: "Type: Area Rug|Style: Modern|Collection: Astral"
```

**Variation 1:**
```csv
SKU: AM-RC-001
Parent SKU: RU-AST-173
Specifications: "Material: Indian Wool|Size: 170x140cm|Weight: 2.5kg"
Variation Type 1: Material
Variation Value 1: Indian Wool
```

**Variation 2:**
```csv
SKU: AM-RC-002
Parent SKU: RU-AST-173
Specifications: "Material: New Zealand Wool|Size: 220x180cm|Weight: 4.2kg"
Variation Type 1: Material
Variation Value 1: New Zealand Wool
```

**Result:**
- Parent has collection-level specs
- Each variation has material-specific specs
- Both sets displayed appropriately on frontend

---

### Use Case 3: No Specifications Provided

**CSV Input:**
```csv
SKU,Product Name,Specifications
PROD-001,Simple Product,
```

**Stored As (Automatic Fallback):**
```javascript
items: [
  { label: "SKU", value: "PROD-001" },
  { label: "Brand", value: "Style n Homes" },
  { label: "Price", value: "100" },
  { label: "Stock", value: "50" }
]
```

---

## 🔍 Validation Rules

### Format Validation
- ✅ Pipe `|` separator for multiple specifications
- ✅ Colon `:` separator for label-value pairs
- ✅ Leading/trailing whitespace is trimmed
- ✅ Empty values are handled gracefully

### Data Validation
- ✅ No specification: Falls back to automatic values
- ✅ Value without label: Uses entire string as value
- ✅ Multiple colons: Only first colon is used as separator
- ✅ Special characters: Allowed in both label and value

### Example Valid Formats
```
✅ "Material: Wool"
✅ "Material: Wool|Size: 8x10ft"
✅ "Material: 100% New Zealand Wool (Premium Grade)"
✅ "URL: https://example.com"
✅ "Description: High-quality, hand-crafted item"
```

### Example Invalid Formats (But Handled)
```
⚠️ "Material Wool" → Treated as { label: "", value: "Material Wool" }
⚠️ "Material:" → { label: "Material", value: "" }
⚠️ "" → Falls back to automatic specifications
```

---

## 🚀 API Endpoints

### Bulk Upload with Specifications

**Endpoint:** `POST /api/bulk-upload/process`

**Request:**
```json
{
  "s3Key": "bulk-uploads/1634567890-products.csv",
  "validateOnly": false
}
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "productsCreated": 10,
    "productsUpdated": 5,
    "pageContentCreated": 10,
    "pageContentUpdated": 5
  },
  "results": {
    "success": [
      "Successfully created: Astral Modern Area Rug (RU-AST-173) [Specifications]"
    ]
  }
}
```

---

## 📋 Logging

### Log Messages

**Parent Specifications Processing:**
```
[2024-10-22 10:30:15] [INFO] [PARENT_SPECIFICATIONS] Processed parent product specifications from CSV
{
  sku: "RU-AST-173",
  specificationsCount: 5,
  specifications: [
    { label: "Material", value: "New Zealand Wool" },
    { label: "Construction", value: "Handtufted" },
    ...
  ]
}
```

**Content Build:**
```
[2024-10-22 10:30:15] [INFO] [CONTENT_BUILD] PageContent structure built
{
  sku: "RU-AST-173",
  tabsCount: 3,
  featuresCount: 5,
  parentSpecificationsCount: 5,
  usingCSVSpecifications: true,
  variationCombinationsCount: 2
}
```

**Variation Combination:**
```
[2024-10-22 10:30:16] [INFO] [VARIATION_COMBINATION] Created variation combination with full details
{
  parentSku: "RU-AST-173",
  variationSku: "AM-RC-001",
  combinationId: "combo-indian-wool-170-x-140-cm",
  specificationsCount: 3,
  ...
}
```

---

## 🛠️ Troubleshooting

### Issue: Specifications Not Showing

**Possible Causes:**
1. CSV column name is not exactly `Specifications` (case-sensitive)
2. Format is incorrect (not using `|` and `:` separators)
3. PageContent was not created/updated

**Solution:**
- Check CSV column header: Must be `Specifications`
- Verify format: `Label: Value|Label: Value`
- Check logs for `PARENT_SPECIFICATIONS` or `VARIATION_COMBINATION` messages

---

### Issue: Automatic Specifications Showing Instead of CSV

**Possible Causes:**
1. Specifications column is empty in CSV
2. Specifications parsing failed (invalid format)

**Solution:**
- Ensure Specifications column has values
- Check log message `usingCSVSpecifications: true/false`
- Verify pipe and colon separators are used correctly

---

### Issue: Variation Specifications Not Unique

**Possible Causes:**
1. Variations have same specifications as parent
2. Specifications not provided in variation rows

**Solution:**
- Add unique Specifications column values for each variation row
- Each variation should have its own material, size, weight, etc.

---

## 📚 Related Documentation

- **[MULTIPLE_CATEGORIES_FILTER_FEATURE.md](./MULTIPLE_CATEGORIES_FILTER_FEATURE.md)** - Category filtering
- **[HSN_CODE_IMPLEMENTATION.md](./HSN_CODE_IMPLEMENTATION.md)** - HSN code documentation
- **[VARIATION_COMBINATION_DETAILS_UPDATE.md](./VARIATION_COMBINATION_DETAILS_UPDATE.md)** - Variation details
- **[VARIATION_DETAILS_CSV_EXAMPLE.csv](./VARIATION_DETAILS_CSV_EXAMPLE.csv)** - CSV template

---

## 🎓 Best Practices

### 1. Consistent Labeling
Use consistent label names across all products:
```
✅ "Material: Wool" (consistent)
❌ "Material: Wool" and "Fabric: Wool" (inconsistent)
```

### 2. Meaningful Values
Provide detailed, customer-friendly values:
```
✅ "Size: 8x10ft / 240x300cm"
❌ "Size: Large"
```

### 3. Variation Specificity
Make variation specifications unique and relevant:
```
✅ Parent: "Type: Area Rug|Style: Modern"
✅ Variation 1: "Material: Indian Wool|Size: 170x140cm|Weight: 2.5kg"
✅ Variation 2: "Material: NZ Wool|Size: 220x180cm|Weight: 4.2kg"
```

### 4. Avoid Redundancy
Don't repeat information already in product fields:
```
❌ "SKU: RU-AST-173|Name: Astral Rug" (redundant)
✅ "Material: Wool|Size: 8x10ft" (unique info)
```

### 5. Use Proper Units
Always include units of measurement:
```
✅ "Weight: 2.5kg"
✅ "Thickness: 8mm"
✅ "Size: 240x300cm"
❌ "Weight: 2.5"
```

---

## 📊 Example CSV Template

```csv
SKU,Parent SKU,Product Name,Description,Short Description,Price,Stock,Category,Brand,UOM,Specifications,Request Quote,Is Variation,Variation Type 1,Variation Value 1,Variation Type 2,Variation Value 2
RU-AST-173,,Astral Modern Area Rug,Celestial design inspired rug,Hand-tufted wool rug,260,10,Rugs,Style n Homes,piece,"Material: New Zealand Wool|Construction: Handtufted|Size: 8x10ft / 240x300cm|Brand: Shanghai Fuli|Country of Origin: China|Delivery Time: 60 days",FALSE,FALSE,,,,
AM-RC-001,RU-AST-173,Astral Modern Area Rug - Indian Wool 170x140cm,,,260,10,,,piece,"Material: Indian Wool|Size: 170 x 140 cm|Weight: 2.5kg|Thickness: 8mm|Pile Height: 12mm",FALSE,TRUE,Material,Indian Wool,Size,170 x 140 cm
AM-RC-002,RU-AST-173,Astral Modern Area Rug - NZ Wool 220x180cm,,,431,10,,,piece,"Material: New Zealand Wool|Size: 220 x 180 cm|Weight: 4.2kg|Thickness: 10mm|Pile Height: 15mm",FALSE,TRUE,Material,New Zealand Wool,Size,220 x 180 cm
```

---

## 📞 Support

For questions or issues related to product specifications in bulk upload:

1. Check this documentation
2. Review log files for error messages
3. Verify CSV format matches examples
4. Test with sample data first

---

## 📝 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Oct 2024 | Initial documentation |
| 1.1 | Oct 2024 | Added parent product specifications support |
| 1.2 | Oct 2024 | Enhanced variation specifications processing |

---

**Last Updated:** October 22, 2024
**Maintained By:** Development Team
**Status:** Active ✅






