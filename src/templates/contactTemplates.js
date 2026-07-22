// config/templates/contactTemplates.js
import { getEmailStyles } from './emailStyles.js';

/**
 * Thank you email template for contact form submission
 */
export const sendContactThankYouEmailTemplate = (name, subject) => {
  const emailSubject = "Thank you for contacting Style & Homes!";

  const text = `
    Hello ${name},
    
    Thank you for reaching out to us regarding "${subject}".
    
    We have received your message and our team will review it shortly. We typically respond within 24-48 hours during business days.
    
    If your inquiry is urgent, please don't hesitate to call us directly.
    
    We appreciate your interest in our services and look forward to assisting you.
Best regards,
    Style & Homes Team
  `;

  const html = `
    <!DOCTYPE html>
    <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <meta name="x-apple-disable-message-reformatting">
      <meta name="color-scheme" content="dark">
      <meta name="supported-color-schemes" content="dark">
      <title>Thank You - Style & Homes</title>
      ${getEmailStyles()}
    </head>
    <body>
      <div class="email-container">
        <!-- Header -->
        <div class="email-header">
          <div class="brand-logo">STYLE & HOMES</div>
          <div class="brand-tagline">Artisan Design • Extraordinary Spaces</div>
        </div>
        
        <!-- Main Content -->
        <div class="email-content">
          <div class="content-header">
            <div class="main-subtitle">Message Received</div>
            <div class="subtitle-line"></div>
            <h1 class="main-title">Thank You for Contacting Us</h1>
          </div>
          
          <div class="welcome-text">
            Hello <strong>${name}</strong>,<br>
            Thank you for reaching out to us regarding "<em>${subject}</em>".
          </div>
          
          <div class="description-text">
            We have received your message and our team will review it shortly. Your inquiry is important to us, and we're committed to providing you with the exceptional service that reflects our dedication to extraordinary spaces.
          </div>
          
          <!-- Info Box -->
          <div class="info-box">
            <h3>What happens next?</h3>
            <ul>
              <li>Our team will review your message shortly</li>
              <li>We typically respond within 24-48 hours during business days</li>
              <li>You'll receive a detailed response from our support team</li>
            </ul>
          </div>
          
          <!-- Security Notice -->
          <div class="security-notice">
            <p>If your inquiry is urgent, please don't hesitate to contact us directly. We appreciate your interest in our services and look forward to assisting you.</p>
          </div>
          
          <div class="divider"></div>
          
          <div style="text-align: center; color: #888888; font-size: 14px;">
            Discover our award-winning projects and connect with our design excellence that reflects our commitment to extraordinary spaces.
          </div>
        </div>
        
        <!-- Footer -->
        <div class="email-footer">
          <div class="footer-brand">STYLE & HOMES</div>
          <div class="footer-tagline">Crafting Extraordinary Spaces</div>
          <div class="footer-contact">
            Questions? Contact us at <a href="mailto:info@stylenhomes.com">info@stylenhomes.com</a><br>
            Discover our portfolio at stylenhomes.com
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject: emailSubject, text, html };
};

/**
 * Admin notification email template for new contact message
 */
export const sendContactNotificationEmailTemplate = (
  userName,
  userEmail,
  subject,
  message,
  contactId
) => {
  const emailSubject = `New Contact Message: ${subject}`;

  const text = `
    New Contact Message Received
    
    Contact ID: ${contactId}
    
    From: ${userName}
    Email: ${userEmail}
    Subject: ${subject}
    
    Message:
    ${message}
    
    Received at: ${new Date().toLocaleString()}
    
    Please respond to the customer as soon as possible.
  `;

  const html = `
    <!DOCTYPE html>
    <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <meta name="x-apple-disable-message-reformatting">
      <meta name="color-scheme" content="dark">
      <meta name="supported-color-schemes" content="dark">
      <title>New Contact Message - Style & Homes</title>
      ${getEmailStyles()}
    </head>
    <body>
      <div class="email-container">
        <!-- Header -->
        <div class="email-header">
          <div class="brand-logo">STYLE & HOMES</div>
          <div class="brand-tagline">Artisan Design • Extraordinary Spaces</div>
        </div>
        
        <!-- Main Content -->
        <div class="email-content">
          <div class="content-header">
            <div class="main-subtitle">Admin Notification</div>
            <div class="subtitle-line"></div>
            <h1 class="main-title">New Contact Message</h1>
          </div>
          
          <div class="welcome-text">
            A new contact message has been received through the Style & Homes website.
          </div>
          
          <!-- Contact Details -->
          <div class="contact-details">
            <table>
              <tr>
                <td>Contact ID:</td>
                <td><span class="contact-id">${contactId}</span></td>
              </tr>
              <tr>
                <td>Name:</td>
                <td>${userName}</td>
              </tr>
              <tr>
                <td>Email:</td>
                <td><a href="mailto:${userEmail}">${userEmail}</a></td>
              </tr>
              <tr>
                <td>Subject:</td>
                <td><strong>${subject}</strong></td>
              </tr>
              <tr>
                <td>Received:</td>
                <td>${new Date().toLocaleString()}</td>
              </tr>
            </table>
          </div>
          
          <!-- Message Content -->
          <div class="info-box">
            <h3>Message</h3>
            <div class="message-content">
              ${message.split('\n').map(paragraph => `<p>${paragraph}</p>`).join('')}
            </div>
          </div>
          
          <!-- Alert Box -->
          <div class="alert-box">
            <p>⚠️ Please respond to the customer as soon as possible</p>
          </div>
          
          <div class="divider"></div>
          
          <div style="text-align: center; color: #888888; font-size: 14px;">
            This notification was sent automatically from your contact form system.
          </div>
        </div>
        
        <!-- Footer -->
        <div class="email-footer">
          <div class="footer-brand">STYLE & HOMES</div>
          <div class="footer-tagline">Crafting Extraordinary Spaces</div>
          <div class="footer-contact">
            Admin Portal • <a href="mailto:admin@stylenhomes.com">admin@stylenhomes.com</a><br>
            Style & Homes Management System
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject: emailSubject, text, html };
};