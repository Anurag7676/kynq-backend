// models/bulkUploadJobModel.js
import mongoose from 'mongoose';

const bulkUploadResultSchema = mongoose.Schema({
  sku: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['success', 'error'],
    required: true,
  },
  error: {
    type: String,
    default: null,
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null,
  },
}, { _id: false });

const bulkUploadJobSchema = mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['pending', 'downloading', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true,
  },
  s3Url: {
    type: String,
    required: true,
  },
  deleteAfterProcessing: {
    type: Boolean,
    default: false,
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  totalItems: {
    type: Number,
    default: 0,
  },
  processedItems: {
    type: Number,
    default: 0,
  },
  successCount: {
    type: Number,
    default: 0,
  },
  errorCount: {
    type: Number,
    default: 0,
  },
  currentMessage: {
    type: String,
    default: '',
  },
  error: {
    type: String,
    default: null,
  },
  results: [bulkUploadResultSchema],
  metadata: {
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'metadata.userType',
    },
    userType: {
      type: String,
      enum: ['user', 'admin'], // Changed to lowercase to match your system
    },
    source: String,
    originalFileName: String,
    fileSize: Number,
    additionalInfo: mongoose.Schema.Types.Mixed,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'metadata.userType',
  },
  completedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
bulkUploadJobSchema.index({ status: 1, createdAt: -1 });
bulkUploadJobSchema.index({ 'metadata.uploadedBy': 1, createdAt: -1 });

// Virtual to calculate completion percentage
bulkUploadJobSchema.virtual('completionRate').get(function() {
  if (this.totalItems === 0) return 0;
  return Math.round((this.processedItems / this.totalItems) * 100);
});

// Virtual to calculate success rate
bulkUploadJobSchema.virtual('successRate').get(function() {
  if (this.processedItems === 0) return 0;
  return Math.round((this.successCount / this.processedItems) * 100);
});

// Method to get processing duration
bulkUploadJobSchema.methods.getProcessingDuration = function() {
  if (!this.completedAt) return null;
  
  const duration = this.completedAt - this.createdAt;
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

// Method to check if job is in progress
bulkUploadJobSchema.methods.isInProgress = function() {
  return ['pending', 'downloading', 'processing'].includes(this.status);
};

// Method to check if job is completed (successfully or with errors)
bulkUploadJobSchema.methods.isCompleted = function() {
  return ['completed', 'failed'].includes(this.status);
};

// Static method to get jobs by user
bulkUploadJobSchema.statics.getJobsByUser = function(userId, userType = 'user') {
  return this.find({
    'metadata.uploadedBy': userId,
    'metadata.userType': userType,
  }).sort({ createdAt: -1 });
};

// Static method to get active jobs count
bulkUploadJobSchema.statics.getActiveJobsCount = function() {
  return this.countDocuments({
    status: { $in: ['pending', 'downloading', 'processing'] }
  });
};

// Static method to cleanup old completed jobs
bulkUploadJobSchema.statics.cleanupOldJobs = function(daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  return this.deleteMany({
    status: { $in: ['completed', 'failed'] },
    createdAt: { $lt: cutoffDate }
  });
};

// Pre-save middleware to update progress
bulkUploadJobSchema.pre('save', function(next) {
  if (this.totalItems > 0) {
    this.progress = Math.round((this.processedItems / this.totalItems) * 100);
  }
  next();
});

const BulkUploadJob = mongoose.model('BulkUploadJob', bulkUploadJobSchema);

export default BulkUploadJob;