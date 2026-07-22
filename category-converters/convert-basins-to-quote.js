import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../src/models/productModel.js';
import PageContent from '../src/models/pageContentModel.js';
import Category from '../src/models/categoryModel.js';

// Load environment variables
dotenv.config();

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

// Create backup collection schema
const productBackupSchema = new mongoose.Schema({
  originalProductId: { type: mongoose.Schema.Types.ObjectId, required: true },
  originalPrice: { type: Number, required: true },
  originalStock: { type: Number, required: true },
  originalIsRequestQuote: { type: Boolean, required: true },
  productName: { type: String, required: true },
  productSku: { type: String, required: true },
  backedUpAt: { type: Date, default: Date.now },
  categoryId: { type: mongoose.Schema.Types.ObjectId, required: true }
});

const pageContentBackupSchema = new mongoose.Schema({
  originalPageId: { type: String, required: true },
  originalVariationPrices: [{
    variationId: String,
    price: Number,
    sku: String,
    combination: mongoose.Schema.Types.Mixed
  }],
  productTitle: { type: String, required: true },
  backedUpAt: { type: Date, default: Date.now }
});

const ProductBackup = mongoose.model('ProductBackup', productBackupSchema);
const PageContentBackup = mongoose.model('PageContentBackup', pageContentBackupSchema);

const convertBASINSToQuote = async () => {
  try {
    console.log('\n🔄 CONVERTING BASINS TO QUOTE MODE...\n');
    
    // Find basins category
    const category = await Category.findOne({ 
      $or: [
        { name: { $regex: /basins/i } },
        { slug: { $regex: /basins/i } }
      ]
    });
    
    if (!category) {
      console.log('❌ BASINS category not found');
      return;
    }
    
    console.log(`📂 Working with BASINS Category: ${category.name} (${category._id})`);
    
    // Find all subcategories
    const subcategories = await Category.find({
      parent: category._id
    });
    
    console.log(`📁 Found ${subcategories.length} subcategories:`);
    subcategories.forEach((subcat, index) => {
      console.log(`   ${index + 1}. ${subcat.name} (${subcat._id})`);
    });
    
    // Find all products in category AND its subcategories
    const allCategoryIds = [category._id, ...subcategories.map(sub => sub._id)];
    
    const products = await Product.find({
      $or: [
        { category: { $in: allCategoryIds } },
        { subcategory: { $in: allCategoryIds } }
      ],
      isRequestQuote: false // Only convert regular products
    });
    
    console.log(`📦 Found ${products.length} basins products to convert`);
    
    if (products.length === 0) {
      console.log('✅ No basins products to convert');
      return;
    }
    
    // Step 1: Create backup of product data
    console.log('\n💾 Creating backup of product data...');
    const productBackups = [];
    
    for (const product of products) {
      const backup = {
        originalProductId: product._id,
        originalPrice: product.price,
        originalStock: product.stock,
        originalIsRequestQuote: product.isRequestQuote,
        productName: product.name,
        productSku: product.sku,
        categoryId: category._id
      };
      productBackups.push(backup);
    }
    
    await ProductBackup.insertMany(productBackups);
    console.log(`✅ Backed up ${productBackups.length} product records`);
    
    // Step 2: Create backup of PageContent variation prices
    console.log('\n💾 Creating backup of PageContent variation prices...');
    const pageContentBackups = [];
    
    for (const product of products) {
      const pageContent = await PageContent.findOne({
        pageId: `product-${product._id}`,
        pageType: 'product'
      });
      
      if (pageContent && pageContent.content && pageContent.content.variationCombinations) {
        const variationPrices = pageContent.content.variationCombinations.map(variation => ({
          variationId: variation.id,
          price: variation.price || 0,
          sku: variation.sku || '',
          combination: variation.combination || {}
        }));
        
        const backup = {
          originalPageId: pageContent.pageId,
          originalVariationPrices: variationPrices,
          productTitle: pageContent.title
        };
        pageContentBackups.push(backup);
      }
    }
    
    if (pageContentBackups.length > 0) {
      await PageContentBackup.insertMany(pageContentBackups);
      console.log(`✅ Backed up ${pageContentBackups.length} PageContent records`);
    } else {
      console.log('ℹ️ No PageContent records with variations found');
    }
    
    // Step 3: Convert products to quote mode
    console.log('\n🔄 Converting products to quote mode...');
    
    const updateResult = await Product.updateMany(
      {
        $or: [
          { category: { $in: allCategoryIds } },
          { subcategory: { $in: allCategoryIds } }
        ],
        isRequestQuote: false
      },
      {
        $set: {
          isRequestQuote: true,
          price: 0,
          comparePrice: 0,
          stock: 999999
        }
      }
    );
    
    console.log(`✅ Updated ${updateResult.modifiedCount} products to quote mode`);
    
    // Step 4: Convert PageContent variation prices to 0
    console.log('\n🔄 Converting PageContent variation prices to 0...');
    
    let pageContentUpdated = 0;
    for (const product of products) {
      const pageContent = await PageContent.findOne({
        pageId: `product-${product._id}`,
        pageType: 'product'
      });
      
      if (pageContent && pageContent.content && pageContent.content.variationCombinations) {
        // Update all variation prices to 0
        pageContent.content.variationCombinations.forEach(variation => {
          variation.price = 0;
        });
        
        await pageContent.save();
        pageContentUpdated++;
      }
    }
    
    console.log(`✅ Updated ${pageContentUpdated} PageContent records`);
    
    // Step 5: Verify conversion
    console.log('\n✅ VERIFICATION:');
    const convertedProducts = await Product.find({
      $or: [
        { category: { $in: allCategoryIds } },
        { subcategory: { $in: allCategoryIds } }
      ]
    });
    
    const regularCount = convertedProducts.filter(p => !p.isRequestQuote).length;
    const quoteCount = convertedProducts.filter(p => p.isRequestQuote).length;
    
    console.log(`   Total BASINS Products: ${convertedProducts.length}`);
    console.log(`   Regular Products: ${regularCount}`);
    console.log(`   Quote Products: ${quoteCount}`);
    
    // Show sample converted products
    console.log('\n📋 SAMPLE CONVERTED PRODUCTS:');
    convertedProducts.slice(0, 3).forEach((product, index) => {
      console.log(`\n   ${index + 1}. ${product.name}`);
      console.log(`      SKU: ${product.sku}`);
      console.log(`      Price: ₹${product.price} (was backed up)`);
      console.log(`      Stock: ${product.stock}`);
      console.log(`      Type: ${product.isRequestQuote ? 'Quote Request' : 'Regular'}`);
    });
    
    console.log('\n🎉 BASINS CONVERSION COMPLETED SUCCESSFULLY!');
    console.log('\n📊 SUMMARY:');
    console.log(`   Products Converted: ${updateResult.modifiedCount}`);
    console.log(`   Product Backups Created: ${productBackups.length}`);
    console.log(`   PageContent Backups Created: ${pageContentBackups.length}`);
    console.log(`   PageContent Records Updated: ${pageContentUpdated}`);
    
    return {
      productsConverted: updateResult.modifiedCount,
      productBackups: productBackups.length,
      pageContentBackups: pageContentBackups.length,
      pageContentUpdated: pageContentUpdated
    };
    
  } catch (error) {
    console.error('❌ Error converting basins to quote mode:', error);
    throw error;
  }
};

const main = async () => {
  try {
    await connectDB();
    const result = await convertBASINSToQuote();
    await mongoose.connection.close();
    console.log('\nDatabase connection closed.');
    return result;
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
};

main().catch(console.error);