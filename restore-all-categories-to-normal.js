import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const execAsync = promisify(exec);

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

// List of all categories with their product counts
const categories = [
  { name: 'RUGS', slug: 'rugs', products: 95 },
  { name: 'WALL COVERING', slug: 'wall-covering', products: 91 },
  { name: 'CHANDELIERS', slug: 'chandeliers', products: 79 },
  { name: 'Indoor Furniture', slug: 'indoor-furniture', products: 75 },
  { name: 'Outdoor lights', slug: 'outdoor-lights', products: 71 },
  { name: 'BASINS', slug: 'basins', products: 50 },
  { name: 'PENDANT LIGHTS', slug: 'pendant-lights', products: 46 },
  { name: 'Outdoor Furniture', slug: 'outdoor-furniture', products: 43 },
  { name: 'VANITIES', slug: 'vanities', products: 41 },
  { name: 'FABRICS', slug: 'fabrics', products: 42 },
  { name: 'PATTERN TILES', slug: 'pattern-tiles', products: 32 },
  { name: 'SHOWER CUBICLES', slug: 'shower-cubicles', products: 25 },
  { name: 'BATHTUBS', slug: 'bathtubs', products: 23 },
  { name: 'JACUZZI', slug: 'jacuzzi', products: 7 },
  { name: 'SMART TOILETS', slug: 'smart-toilets', products: 6 },
  { name: 'DECORATIVE LIGHTS', slug: 'decorative-lights', products: 280 },
  { name: 'DOORS', slug: 'doors', products: 97 },
  { name: 'FLOORING', slug: 'flooring', products: 17 },
  { name: 'WALL PANELS & WALL COVERINGS', slug: 'wall-panels-and-wall-coverings', products: 134 },
  { name: 'WINDOWS', slug: 'windows', products: 5 },
  { name: 'PERGOLAS', slug: 'pergolas', products: 16 },
  { name: 'RAILING', slug: 'railing', products: 6 },
  { name: 'SAUNA ROOM', slug: 'sauna-room', products: 5 },
  { name: 'STAIRCASE', slug: 'staircase', products: 6 },
  { name: 'COMMERCIAL SEATING', slug: 'commercial-seating', products: 3 }
];

const runScript = async (scriptPath, categoryName) => {
  try {
    console.log(`\n🔄 Running ${categoryName} restoration...`);
    const { stdout, stderr } = await execAsync(`node ${scriptPath}`);
    
    if (stderr && !stderr.includes('Warning')) {
      console.error(`❌ Error in ${categoryName}:`, stderr);
      return { success: false, error: stderr };
    }
    
    // Extract key information from stdout
    const lines = stdout.split('\n');
    const summaryLine = lines.find(line => line.includes('Products Restored:'));
    const backupLine = lines.find(line => line.includes('PageContent Records Restored:'));
    
    console.log(`✅ ${categoryName} restoration completed successfully`);
    if (summaryLine) console.log(`   ${summaryLine.trim()}`);
    if (backupLine) console.log(`   ${backupLine.trim()}`);
    
    return { success: true, output: stdout };
  } catch (error) {
    console.error(`❌ Failed to restore ${categoryName}:`, error.message);
    return { success: false, error: error.message };
  }
};

const restoreAllCategoriesToNormal = async () => {
  try {
    console.log('\n🎯 MASTER SCRIPT: RESTORING ALL CATEGORIES TO NORMAL PRICING\n');
    console.log('This will restore ALL categories to their original pricing using backups.\n');
    
    // Show summary
    const totalProducts = categories.reduce((sum, cat) => sum + cat.products, 0);
    console.log(`📊 SUMMARY:`);
    console.log(`   Total Categories: ${categories.length}`);
    console.log(`   Total Products: ${totalProducts}`);
    console.log(`   Estimated Time: ${Math.ceil(totalProducts / 100)} minutes\n`);
    
    const results = [];
    let successCount = 0;
    let failureCount = 0;
    let totalRestored = 0;
    
    // Process categories in order of size (smallest first for safety)
    const sortedCategories = [...categories].sort((a, b) => a.products - b.products);
    
    for (let i = 0; i < sortedCategories.length; i++) {
      const category = sortedCategories[i];
      const scriptPath = `category-converters/restore-${category.slug}-to-normal.js`;
      
      console.log(`\n📋 Processing ${i + 1}/${sortedCategories.length}: ${category.name} (${category.products} products)`);
      
      // Check if script exists
      if (!fs.existsSync(scriptPath)) {
        console.log(`⚠️ Script not found: ${scriptPath}`);
        results.push({ category: category.name, success: false, error: 'Script not found' });
        failureCount++;
        continue;
      }
      
      const result = await runScript(scriptPath, category.name);
      results.push({ category: category.name, success: result.success, error: result.error });
      
      if (result.success) {
        successCount++;
        // Extract number of products restored from output
        const restoredMatch = result.output?.match(/Products Restored: (\d+)/);
        if (restoredMatch) {
          totalRestored += parseInt(restoredMatch[1]);
        }
      } else {
        failureCount++;
      }
      
      // Add a small delay between scripts
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Final summary
    console.log('\n🎉 MASTER RESTORATION COMPLETED!\n');
    console.log('📊 FINAL SUMMARY:');
    console.log(`   Categories Processed: ${categories.length}`);
    console.log(`   Successful Restorations: ${successCount}`);
    console.log(`   Failed Restorations: ${failureCount}`);
    console.log(`   Total Products Restored: ${totalRestored}`);
    
    if (failureCount > 0) {
      console.log('\n❌ FAILED CATEGORIES:');
      results.filter(r => !r.success).forEach(result => {
        console.log(`   - ${result.category}: ${result.error}`);
      });
    }
    
    console.log('\n✅ SUCCESSFUL CATEGORIES:');
    results.filter(r => r.success).forEach(result => {
      console.log(`   - ${result.category}`);
    });
    
    return {
      totalCategories: categories.length,
      successful: successCount,
      failed: failureCount,
      totalRestored,
      results
    };
    
  } catch (error) {
    console.error('❌ Master restoration failed:', error);
    throw error;
  }
};

const main = async () => {
  try {
    await connectDB();
    const result = await restoreAllCategoriesToNormal();
    await mongoose.connection.close();
    console.log('\nDatabase connection closed.');
    return result;
  } catch (error) {
    console.error('❌ Master script failed:', error);
    process.exit(1);
  }
};

main().catch(console.error);

