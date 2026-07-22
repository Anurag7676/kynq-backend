import nodemailer from "nodemailer";
import dotenv from "dotenv";

// Import all templates
import { sendOTPEmailTemplate, sendPasswordResetOTPTemplate } from "../templates/authTemplates.js";
import { sendContactThankYouEmailTemplate, sendContactNotificationEmailTemplate } from '../templates/contactTemplates.js';
import { 
  sendPaymentConfirmationEmailTemplate, 
  sendOrderStatusUpdateEmailTemplate, 
  sendNewOrderNotificationEmailTemplate,
  sendOrderCancellationEmailTemplate,
  sendOrderCancellationNotificationEmailTemplate,
  sendVendorOrderNotificationEmailTemplate // 🆕 NEW: Vendor notification template
} from '../templates/orderTemplates.js';
import { 
  sendQuoteRequestConfirmationTemplate, 
  sendQuoteRequestNotificationTemplate 
} from '../templates/quoteTemplates.js';

// Load environment variables
dotenv.config();

// Create a transporter for sending emails with Gmail
const createTransporter = () => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
  return transporter;
};

/**
 * Send an email
 */
const sendEmail = async (options) => {
  try {
    // Validate email configuration
    if (!process.env.EMAIL_USERNAME || !process.env.EMAIL_PASSWORD) {
      console.error("❌ Email configuration missing: EMAIL_USERNAME or EMAIL_PASSWORD not set");
      throw new Error("Email configuration is missing. Please set EMAIL_USERNAME and EMAIL_PASSWORD environment variables.");
    }

    if (!options.to) {
      console.error("❌ Email recipient is missing");
      throw new Error("Email recipient (to) is required");
    }

    console.log("📧 Attempting to send email to:", options.to);
    
    const transporter = createTransporter();

    const mailOptions = {
      from: `${process.env.FROM_NAME || 'Style & Homes'} <${process.env.EMAIL_USERNAME}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    console.log("📤 Mail options:", {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully:", {
      messageId: info.messageId,
      response: info.response
    });
    
    return info;
  } catch (error) {
    console.error("❌ Error sending email:", {
      error: error.message,
      stack: error.stack,
      to: options.to,
      subject: options.subject
    });
    throw new Error(`Email could not be sent: ${error.message}`);
  }
};

/**
 * Send OTP verification email
 */
const sendOTPEmail = async (email, name, otp) => {
  const { subject, text, html } = sendOTPEmailTemplate(name, otp);
  
  return await sendEmail({
    to: email,
    subject,
    text,
    html,
  });
};

/**
 * Send password reset OTP
 */
const sendPasswordResetOTP = async (email, name, otp) => {
  const { subject, text, html } = sendPasswordResetOTPTemplate(name, otp);
  
  return await sendEmail({
    to: email,
    subject,
    text,
    html,
  });
};

/**
 * Send thank you email to user after contact form submission
 */
const sendContactThankYouEmail = async (email, name, subject) => {
  const { subject: emailSubject, text, html } = sendContactThankYouEmailTemplate(name, subject);
  
  return await sendEmail({
    to: email,
    subject: emailSubject,
    text,
    html,
  });
};

/**
 * Send notification email to admin about new contact message
 */
const sendContactNotificationEmail = async (
  userName,
  userEmail,
  subject,
  message,
  contactId
) => {
  const { subject: emailSubject, text, html } = sendContactNotificationEmailTemplate(
    userName,
    userEmail,
    subject,
    message,
    contactId
  );
  
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USERNAME;
  
  return await sendEmail({
    to: adminEmail,
    subject: emailSubject,
    text,
    html,
  });
};

/**
 * Send payment confirmation email
 */
const sendPaymentConfirmationEmail = async (userEmail, userName, orderDetails) => {
  const { subject, text, html } = sendPaymentConfirmationEmailTemplate(userName, orderDetails);
  
  return await sendEmail({
    to: userEmail,
    subject,
    text,
    html,
  });
};

/**
 * Send order status update email to user
 */
const sendOrderStatusUpdateEmail = async (userEmail, userName, orderDetails, newStatus, trackingInfo = null) => {
  const { subject, text, html } = sendOrderStatusUpdateEmailTemplate(userName, orderDetails, newStatus, trackingInfo);
  
  return await sendEmail({
    to: userEmail,
    subject,
    text,
    html,
  });
};

/**
 * Send admin notification for new order
 */
const sendNewOrderNotificationEmail = async (orderDetails) => {
  const { subject, text, html } = sendNewOrderNotificationEmailTemplate(orderDetails);
  
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USERNAME;
  
  return await sendEmail({
    to: adminEmail,
    subject,
    text,
    html,
  });
};

/**
 * Send order cancellation email to user
 */
const sendOrderCancellationEmail = async (userEmail, userName, orderDetails) => {
  const { subject, text, html } = sendOrderCancellationEmailTemplate(userName, orderDetails);
  
  return await sendEmail({
    to: userEmail,
    subject,
    text,
    html,
  });
};

/**
 * Send order cancellation notification to admin
 */
const sendOrderCancellationNotificationEmail = async (orderDetails) => {
  const { subject, text, html } = sendOrderCancellationNotificationEmailTemplate(orderDetails);
  
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USERNAME;
  
  return await sendEmail({
    to: adminEmail,
    subject,
    text,
    html,
  });
};

/**
 * Send quote request confirmation email to user
 */
const sendQuoteRequestConfirmationEmail = async (userEmail, userName, productName, quoteId) => {
  const { subject, text, html } = sendQuoteRequestConfirmationTemplate(userName, productName, quoteId);
  
  return await sendEmail({
    to: userEmail,
    subject,
    text,
    html,
  });
};

/**
 * Send quote request notification email to admin
 */
const sendQuoteRequestNotificationEmail = async (quoteRequest, productName) => {
  const { subject, text, html } = sendQuoteRequestNotificationTemplate(quoteRequest, productName);
  
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USERNAME;
  
  return await sendEmail({
    to: adminEmail,
    subject,
    text,
    html,
  });
};

/**
 * Send vendor notification email when products are booked
 */
const sendVendorOrderNotificationEmail = async (vendorEmail, vendorName, orderDetails) => {
  const { text, html } = sendVendorOrderNotificationEmailTemplate(vendorName, orderDetails);
  
  return await sendEmail({
    to: vendorEmail,
    subject: "New Order Notification - Style & Homes",
    text,
    html,
  });
};

/**
 * Verify email connection
 */
const verifyConnection = async () => {
  try {
    console.log("🔍 Verifying email connection...");
    const transporter = createTransporter();
    await transporter.verify();
    console.log("✅ Email server connection verified");
    return true;
  } catch (error) {
    console.error("❌ Email server connection failed:", error);
    console.error("📋 Connection error details:", {
      message: error.message,
      code: error.code,
      command: error.command
    });
    return false;
  }
};

export {
  sendEmail,  
  sendOTPEmail,
  sendPasswordResetOTP,
  sendContactThankYouEmail,
  sendContactNotificationEmail,
  sendPaymentConfirmationEmail,
  sendOrderStatusUpdateEmail,
  sendNewOrderNotificationEmail,
  sendOrderCancellationEmail,
  sendOrderCancellationNotificationEmail,
  sendQuoteRequestConfirmationEmail,
  sendQuoteRequestNotificationEmail,
  sendVendorOrderNotificationEmail, // 🆕 NEW: Vendor notification email
  verifyConnection,
};