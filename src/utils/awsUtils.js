import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Configure AWS SDK - Using environment variables for security
AWS.config.update({
  region: process.env.AWS_REGION || "ap-south-1",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Validate that AWS credentials are set
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.warn("⚠️  WARNING: AWS credentials not found in environment variables!");
  console.warn("Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your .env file");
}

// Initialize S3 and SQS clients
const s3 = new AWS.S3();
const sqs = new AWS.SQS();

// Generate a presigned URL for uploading to S3
export const generatePresignedUrl = (key, contentType, expiresIn = 900) => {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Expires: expiresIn, // 15 minutes by default
    ContentType: contentType
  };
  
  return s3.getSignedUrl('putObject', params);
};

// Send message to SQS queue
export const sendToSQS = async (messageBody) => {
  const params = {
    QueueUrl: process.env.SQS_QUEUE_URL,
    MessageBody: JSON.stringify(messageBody)
  };
  
  return sqs.sendMessage(params).promise();
};

// Check if an object exists in S3
export const checkS3ObjectExists = async (key) => {
  try {
    await s3.headObject({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key
    }).promise();
    return true;
  } catch (error) {
    return false;
  }
};

export { s3, sqs };