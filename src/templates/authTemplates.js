// config/templates/authTemplates.js
import { getEmailStyles } from './emailStyles.js';

/**
 * OTP verification email template
 */
export const sendOTPEmailTemplate = (name, otp) => {
  const subject = "Verify Your Style & Homes Account";

  const text = `
    Hello ${name},
    
    Welcome to Style & Homes! We're delighted to have you join our community where innovation meets timeless elegance.
    
    Your verification code is: ${otp}
    
    This code will expire in 10 minutes for your security.
    
    If you didn't create an account with us, you can safely ignore this email.
    
    Best regards,
    The Style & Homes Team
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
      <title>Verify Your Account - Style & Homes</title>
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
            <div class="main-subtitle">Account Verification</div>
            <div class="subtitle-line"></div>
            <h1 class="main-title">Welcome to Our Community</h1>
          </div>
          
          <div class="welcome-text">
            Hello <strong>${name}</strong>,<br>
            We're delighted to welcome you to Style & Homes, where innovation meets timeless elegance in every meticulously crafted space.
          </div>
          
          <div class="description-text">
            To complete your account registration and gain access to our exclusive collection of residential and commercial design projects, please verify your email address using the code below.
          </div>
          
          <!-- OTP Section -->
          <div class="otp-section">
            <div class="otp-label">Verification Code</div>
            <div class="otp-code">${otp}</div>
            <div class="otp-expiry">This code expires in 10 minutes</div>
          </div>
          
          <!-- Security Notice -->
          <div class="security-notice">
            <p>🔒 For your security, this verification code will expire in 10 minutes. If you did not create an account with Style & Homes, please disregard this email.</p>
          </div>
          
          <div class="divider"></div>
          
          <div style="text-align: center; color: #888888; font-size: 14px;">
            Once verified, you'll discover our award-winning projects and connect with our design excellence that reflects our commitment to extraordinary spaces.
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

  return { subject, text, html };
};

/**
 * Password reset OTP template
 */
export const sendPasswordResetOTPTemplate = (name, otp) => {
  const subject = "Reset Your Style & Homes Password";

  const text = `
    Hello ${name},
    
    We received a request to reset your Style & Homes password.
    
    Your password reset code is: ${otp}
    
    This code will expire in 10 minutes for your security.
    
    If you didn't request a password reset, please ignore this email.
    
    Best regards,
    The Style & Homes Team
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
      <title>Password Reset - Style & Homes</title>
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
            <div class="main-subtitle">Password Reset</div>
            <div class="subtitle-line"></div>
            <h1 class="main-title">Secure Your Account</h1>
          </div>
          
          <div class="welcome-text">
            Hello <strong>${name}</strong>,<br>
            We received a request to reset the password for your Style & Homes account.
          </div>
          
          <div class="description-text">
            Use the verification code below to proceed with setting up your new password and continue accessing our exclusive design collections.
          </div>
          
          <!-- OTP Section -->
          <div class="otp-section">
            <div class="otp-label">Password Reset Code</div>
            <div class="otp-code">${otp}</div>
            <div class="otp-expiry">This code expires in 10 minutes</div>
          </div>
          
          <!-- Security Notice -->
          <div class="security-notice">
            <p>🔒 If you didn't request a password reset, please ignore this email or contact our support team immediately if you suspect unauthorized access to your account.</p>
          </div>
          
          <div class="divider"></div>
          
          <div style="text-align: center; color: #888888; font-size: 14px;">
            After resetting your password, you'll continue to enjoy full access to our premium collections and design services.
          </div>
        </div>
        
        <!-- Footer -->
        <div class="email-footer">
          <div class="footer-brand">STYLE & HOMES</div>
          <div class="footer-tagline">Crafting Extraordinary Spaces</div>
          <div class="footer-contact">
            Need help? Contact us at <a href="mailto:support@stylenhomes.com">support@stylenhomes.com</a><br>
            Discover our portfolio at stylenhomes.com
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject, text, html };
};