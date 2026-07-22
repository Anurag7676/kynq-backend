import mongoose from 'mongoose';
import dotenv from 'dotenv';
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

const cleanupVanitiesBackups = async () => {
  try {
    console.log('\n🧹 CLEANING UP VANITIES BACKUPS...\n');
    
    // Find vanities category
    const vanitiesCategory = await Category.findOne({ 
      $or: [
        { name: { $regex: /vanities/i } },
        { slug: { $regex: /vanities/i } }
      ]
    });
    
    if (!vanitiesCategory) {
      console.log('❌ Vanities category not found');
      return;
    }
    
    console.log(`📂 Working with Vanities Category: ${vanitiesCategory.name} (${vanitiesCategory._id})`);
    
    // Check current backups
    const productBackups = await ProductBackup.find({ categoryId: vanitiesCategory._id });
    const pageContentBackups = await PageContentBackup.find();
    
    console.log(`💾 Found ${productBackups.length} product backups`);
    console.log(`💾 Found ${pageContentBackups.length} PageContent backups`);
    
    if (productBackups.length === 0 && pageContentBackups.length === 0) {
      console.log('✅ No backups to clean up');
      return;
    }
    
    // Show backup details before deletion
    console.log('\n📋 BACKUP DETAILS:');
    productBackups.forEach((backup, index) => {
      console.log(`   ${index + 1}. ${backup.productName} - ₹${backup.originalPrice} (${backup.backedUpAt})`);
    });
    
    // Delete product backups
    if (productBackups.length > 0) {
      const deleteResult = await ProductBackup.deleteMany({ categoryId: vanitiesCategory._id });
      console.log(`\n🗑️ Deleted ${deleteResult.deletedCount} product backups`);
    }
    
    // Delete PageContent backups
    if (pageContentBackups.length > 0) {
      const deleteResult = await PageContentBackup.deleteMany({});
      console.log(`🗑️ Deleted ${deleteResult.deletedCount} PageContent backups`);
    }
    
    console.log('\n✅ BACKUP CLEANUP COMPLETED!');
    
  } catch (error) {
    console.error('❌ Error cleaning up backups:', error);
    throw error;
  }
};

const showBackupStatus = async () => {
  try {
    console.log('\n📊 BACKUP STATUS CHECK...\n');
    
    // Find vanities category
    const vanitiesCategory = await Category.findOne({ 
      $or: [
        { name: { $regex: /vanities/i } },
        { slug: { $regex: /vanities/i } }
      ]
    });
    
    if (!vanitiesCategory) {
      console.log('❌ Vanities category not found');
      return;
    }
    
    // Check backups
    const productBackups = await ProductBackup.find({ categoryId: vanitiesCategory._id });
    const pageContentBackups = await PageContentBackup.find();
    
    console.log(`📂 Vanities Category: ${vanitiesCategory.name}`);
    console.log(`💾 Product Backups: ${productBackups.length}`);
    console.log(`💾 PageContent Backups: ${pageContentBackups.length}`);
    
    if (productBackups.length > 0) {
      console.log('\n📋 PRODUCT BACKUPS:');
      productBackups.forEach((backup, index) => {
        console.log(`   ${index + 1}. ${backup.productName}`);
        console.log(`      SKU: ${backup.productSku}`);
        console.log(`      Original Price: ₹${backup.originalPrice}`);
        console.log(`      Original Stock: ${backup.originalStock}`);
        console.log(`      Backed Up: ${backup.backedUpAt}`);
      });
    }
    
    if (pageContentBackups.length > 0) {
      console.log('\n📋 PAGECONTENT BACKUPS:');
      pageContentBackups.forEach((backup, index) => {
        console.log(`   ${index + 1}. ${backup.productTitle}`);
        console.log(`      PageID: ${backup.originalPageId}`);
        console.log(`      Variations: ${backup.originalVariationPrices.length}`);
        console.log(`      Backed Up: ${backup.backedUpAt}`);
      });
    }
    
    console.log('\n✅ BACKUP STATUS CHECK COMPLETED!');
    
  } catch (error) {
    console.error('❌ Error checking backup status:', error);
    throw error;
  }
};

const main = async () => {
  try {
    await connectDB();
    
    // Check command line arguments
    const args = process.argv.slice(2);
    const command = args[0];
    
    if (command === 'cleanup') {
      await cleanupVanitiesBackups();
    } else if (command === 'status') {
      await showBackupStatus();
    } else {
      console.log('Usage:');
      console.log('  node backup-manager.js cleanup  - Delete all vanities backups');
      console.log('  node backup-manager.js status   - Show backup status');
    }
    
    await mongoose.connection.close();
    console.log('\nDatabase connection closed.');
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
};

main().catch(console.error);

