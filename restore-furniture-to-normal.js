import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './src/models/productModel.js';
import PageContent from './src/models/pageContentModel.js';
import Category from './src/models/categoryModel.js';

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

// Define backup schemas
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

const restoreFurnitureToNormal = async () => {
  try {
    console.log('\n🔄 RESTORING FURNITURE TO NORMAL PRICING...\n');
    
    // Find furniture category
    const furnitureCategory = await Category.findOne({ 
      $or: [
        { name: { $regex: /furniture/i } },
        { slug: { $regex: /furniture/i } }
      ]
    });
    
    if (!furnitureCategory) {
      console.log('❌ Furniture category not found');
      return;
    }
    
    console.log(`📂 Working with Furniture Category: ${furnitureCategory.name} (${furnitureCategory._id})`);
    
    // Find all furniture subcategories
    const furnitureSubcategories = await Category.find({
      parent: furnitureCategory._id
    });
    
    console.log(`📁 Found ${furnitureSubcategories.length} furniture subcategories:`);
    furnitureSubcategories.forEach((subcat, index) => {
      console.log(`   ${index + 1}. ${subcat.name} (${subcat._id})`);
    });
    
    // Get all category IDs
    const allCategoryIds = [furnitureCategory._id, ...furnitureSubcategories.map(sub => sub._id)];
    
    // Step 1: Check if backups exist
    const productBackups = await ProductBackup.find({ categoryId: { $in: allCategoryIds } });
    const pageContentBackups = await PageContentBackup.find();
    
    console.log(`💾 Found ${productBackups.length} product backups`);
    console.log(`💾 Found ${pageContentBackups.length} PageContent backups`);
    
    if (productBackups.length === 0) {
      console.log('❌ No product backups found. Cannot restore.');
      return;
    }
    
    // Step 2: Restore product data
    console.log('\n🔄 Restoring product data...');
    
    let productsRestored = 0;
    for (const backup of productBackups) {
      const updateResult = await Product.updateOne(
        { _id: backup.originalProductId },
        {
          $set: {
            price: backup.originalPrice,
            stock: backup.originalStock,
            isRequestQuote: backup.originalIsRequestQuote,
            comparePrice: backup.originalPrice // Set compare price same as original price
          }
        }
      );
      
      if (updateResult.modifiedCount > 0) {
        productsRestored++;
        console.log(`   ✅ Restored: ${backup.productName} (₹${backup.originalPrice})`);
      }
    }
    
    console.log(`✅ Restored ${productsRestored} products`);
    
    // Step 3: Restore PageContent variation prices
    console.log('\n🔄 Restoring PageContent variation prices...');
    
    let pageContentRestored = 0;
    for (const backup of pageContentBackups) {
      const pageContent = await PageContent.findOne({
        pageId: backup.originalPageId,
        pageType: 'product'
      });
      
      if (pageContent && pageContent.content && pageContent.content.variationCombinations) {
        // Restore variation prices
        pageContent.content.variationCombinations.forEach(variation => {
          const backupVariation = backup.originalVariationPrices.find(
            bv => bv.variationId === variation.id
          );
          
          if (backupVariation) {
            variation.price = backupVariation.price;
            console.log(`   ✅ Restored variation ${variation.id}: ₹${backupVariation.price}`);
          }
        });
        
        await pageContent.save();
        pageContentRestored++;
      }
    }
    
    console.log(`✅ Restored ${pageContentRestored} PageContent records`);
    
    // Step 4: Verify restoration
    console.log('\n✅ VERIFICATION:');
    const restoredProducts = await Product.find({
      $or: [
        { category: { $in: allCategoryIds } },
        { subcategory: { $in: allCategoryIds } }
      ]
    });
    
    const regularCount = restoredProducts.filter(p => !p.isRequestQuote).length;
    const quoteCount = restoredProducts.filter(p => p.isRequestQuote).length;
    
    console.log(`   Total Furniture Products: ${restoredProducts.length}`);
    console.log(`   Regular Products: ${regularCount}`);
    console.log(`   Quote Products: ${quoteCount}`);
    
    // Show sample restored products
    console.log('\n📋 SAMPLE RESTORED PRODUCTS:');
    restoredProducts.slice(0, 3).forEach((product, index) => {
      console.log(`\n   ${index + 1}. ${product.name}`);
      console.log(`      SKU: ${product.sku}`);
      console.log(`      Price: ₹${product.price}`);
      console.log(`      Stock: ${product.stock}`);
      console.log(`      Type: ${product.isRequestQuote ? 'Quote Request' : 'Regular'}`);
    });
    
    // Price analysis after restoration
    console.log('\n💰 PRICE ANALYSIS AFTER RESTORATION:');
    const priceStats = await Product.aggregate([
      {
        $match: { 
          $or: [
            { category: { $in: allCategoryIds } },
            { subcategory: { $in: allCategoryIds } }
          ],
          isRequestQuote: false,
          price: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
          avgPrice: { $avg: '$price' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    if (priceStats.length > 0) {
      const stats = priceStats[0];
      console.log(`   Regular Furniture with Price: ${stats.count}`);
      console.log(`   Min Price: ₹${stats.minPrice}`);
      console.log(`   Max Price: ₹${stats.maxPrice}`);
      console.log(`   Average Price: ₹${Math.round(stats.avgPrice)}`);
    }
    
    console.log('\n🎉 FURNITURE RESTORATION COMPLETED SUCCESSFULLY!');
    console.log('\n📊 SUMMARY:');
    console.log(`   Products Restored: ${productsRestored}`);
    console.log(`   PageContent Records Restored: ${pageContentRestored}`);
    
    return {
      productsRestored,
      pageContentRestored
    };
    
  } catch (error) {
    console.error('❌ Error restoring furniture to normal pricing:', error);
    throw error;
  }
};

const main = async () => {
  try {
    await connectDB();
    const result = await restoreFurnitureToNormal();
    await mongoose.connection.close();
    console.log('\nDatabase connection closed.');
    return result;
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
};

main().catch(console.error);

