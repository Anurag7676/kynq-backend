// config/templates/emailStyles.js

/**
 * Cross-platform optimized email styles with light/dark theme compatibility
 * Fixed to ensure OTP codes are always visible
 */
export const getEmailStyles = () => `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');
    
    /* Reset and base styles */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      background-color: #0a0a0a !important;
      color: #ffffff !important;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      width: 100% !important;
      min-width: 100%;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    
    /* Email client compatibility */
    table {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
      width: 100%;
    }
    
    img {
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
    }
    
    /* Force dark theme compatibility - ENHANCED */
    [data-ogsc] body,
    [data-ogsc] .email-container,
    [data-ogsc] .email-header,
    [data-ogsc] .email-content,
    [data-ogsc] .email-footer,
    [data-ogsb] body,
    [data-ogsb] .email-container {
      background-color: #0a0a0a !important;
      color: #ffffff !important;
    }
    
    /* Container */
    .email-container {
      max-width: 650px;
      margin: 0 auto;
      background-color: #0a0a0a !important;
      width: 100%;
      color-scheme: dark;
    }
    
    /* Header */
    .email-header {
      background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%) !important;
      padding: 60px 40px;
      text-align: center;
      position: relative;
      border-bottom: 1px solid #2a2a2a;
    }
    
    .email-header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(circle at 30% 50%, rgba(194, 178, 128, 0.1) 0%, transparent 50%);
      pointer-events: none;
    }
    
    .brand-logo {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 32px;
      font-weight: 600;
      color: #ffffff !important;
      letter-spacing: 2px;
      margin-bottom: 12px;
      position: relative;
      z-index: 2;
    }
    
    .brand-logo::after {
      content: '';
      display: block;
      width: 40px;
      height: 2px;
      background: linear-gradient(90deg, #c2b280 0%, #d4c794 100%);
      margin: 12px auto 0;
    }
    
    .brand-tagline {
      color: #888888 !important;
      font-size: 13px;
      font-weight: 400;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      position: relative;
      z-index: 2;
      margin-top: 16px;
    }
    
    /* Content */
    .email-content {
      background-color: #1a1a1a !important;
      padding: 60px 50px;
      position: relative;
    }
    
    .content-header {
      text-align: center;
      margin-bottom: 50px;
    }
    
    .main-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 42px;
      font-weight: 600;
      color: #ffffff !important;
      margin-bottom: 16px;
      letter-spacing: -0.5px;
      line-height: 1.2;
    }
    
    .main-subtitle {
      color: #c2b280 !important;
      font-size: 16px;
      font-weight: 400;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    
    .subtitle-line {
      width: 60px;
      height: 1px;
      background: #c2b280;
      margin: 0 auto;
    }
    
    .welcome-text {
      color: #cccccc !important;
      font-size: 18px;
      font-weight: 400;
      margin: 40px 0;
      text-align: center;
      line-height: 1.7;
    }
    
    .welcome-text strong {
      color: #ffffff !important;
      font-weight: 500;
    }
    
    /* OTP Section - ENHANCED for better visibility */
    .otp-section {
      background: linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%) !important;
      border: 1px solid #3a3a3a;
      border-radius: 12px;
      padding: 40px;
      text-align: center;
      margin: 50px 0;
      position: relative;
      overflow: hidden;
    }
    
    .otp-section::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent 0%, #c2b280 50%, transparent 100%);
    }
    
    .otp-label {
      color: #c2b280 !important;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: 20px;
    }
    
    .otp-code {
      font-family: 'Inter', 'Courier New', monospace !important;
      font-size: 48px !important;
      font-weight: 700 !important;
      color: #ffffff !important;
      letter-spacing: 12px;
      margin: 20px 0;
      text-shadow: 0 0 20px rgba(194, 178, 128, 0.3);
      background-color: #2a2a2a !important;
      padding: 15px 20px;
      border-radius: 8px;
      border: 2px solid #c2b280 !important;
      display: inline-block;
    }
    
    .otp-expiry {
      color: #888888 !important;
      font-size: 14px;
      font-weight: 400;
      margin-top: 16px;
    }
    
    .description-text {
      color: #aaaaaa !important;
      font-size: 16px;
      line-height: 1.7;
      margin: 30px 0;
      text-align: left;
    }
    
    .security-notice {
      background: rgba(194, 178, 128, 0.1) !important;
      border: 1px solid rgba(194, 178, 128, 0.3);
      border-radius: 8px;
      padding: 25px;
      margin: 40px 0;
    }
    
    .security-notice p {
      color: #c2b280 !important;
      font-size: 14px;
      margin: 0;
      font-weight: 400;
      line-height: 1.6;
    }
    
    .divider {
      height: 1px;
      background: linear-gradient(90deg, transparent 0%, #3a3a3a 50%, transparent 100%);
      margin: 50px 0;
    }
    
    /* Footer */
    .email-footer {
      background-color: #0a0a0a !important;
      padding: 50px 40px;
      text-align: center;
      border-top: 1px solid #2a2a2a;
    }
    
    .footer-brand {
      font-family: 'Playfair Display', Georgia, serif;
      color: #ffffff !important;
      font-weight: 600;
      font-size: 20px;
      margin-bottom: 12px;
      letter-spacing: 1px;
    }
    
    .footer-tagline {
      color: #888888 !important;
      font-size: 13px;
      font-weight: 400;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 30px;
    }
    
    .footer-contact {
      color: #aaaaaa !important;
      font-size: 14px;
      line-height: 1.6;
    }
    
    .footer-contact a {
      color: #c2b280 !important;
      text-decoration: none;
    }
    
    .footer-contact a:hover {
      text-decoration: underline;
    }
    
    /* Special sections for contact emails */
    .info-box {
      background: linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%) !important;
      border: 1px solid #3a3a3a;
      border-radius: 12px;
      padding: 30px;
      margin: 40px 0;
      position: relative;
      overflow: hidden;
    }
    
    .info-box::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent 0%, #c2b280 50%, transparent 100%);
    }
    
    .info-box h3 {
      color: #c2b280 !important;
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 15px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .info-box ul {
      color: #aaaaaa !important;
      font-size: 14px;
      line-height: 1.6;
      margin: 0;
      padding-left: 20px;
    }
    
    .info-box li {
      margin-bottom: 8px;
      color: #aaaaaa !important;
    }
    
    .contact-details {
      background: linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%) !important;
      border: 1px solid #3a3a3a;
      border-radius: 12px;
      padding: 30px;
      margin: 40px 0;
    }
    
    .contact-details table {
      width: 100%;
    }
    
    .contact-details td {
      padding: 12px 0;
      border-bottom: 1px solid #3a3a3a;
      vertical-align: top;
    }
    
    .contact-details td:first-child {
      font-weight: 600;
      color: #c2b280 !important;
      width: 120px;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .contact-details td:last-child {
      color: #cccccc !important;
      font-size: 14px;
      line-height: 1.6;
    }
    
    /* Force table cell colors in dark mode */
    .contact-details td {
      color: #cccccc !important;
    }
    
    .contact-details td:first-child {
      color: #c2b280 !important;
    }
    
    /* Order items table styling */
    .info-box table td,
    .info-box table th {
      color: #cccccc !important;
    }
    
    .info-box table th {
      color: #c2b280 !important;
    }
    
    .contact-details a {
      color: #c2b280 !important;
      text-decoration: none;
    }
    
    .contact-id {
      font-family: 'Inter', 'Courier New', monospace;
      background: rgba(194, 178, 128, 0.1) !important;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      letter-spacing: 1px;
      color: #c2b280 !important;
    }
    
    .message-content {
      background: rgba(194, 178, 128, 0.05) !important;
      border: 1px solid rgba(194, 178, 128, 0.2);
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
      border-left: 4px solid #c2b280;
    }
    
    .message-content p {
      color: #cccccc !important;
      font-size: 15px;
      line-height: 1.7;
      margin: 0 0 12px 0;
    }
    
    .message-content p:last-child {
      margin-bottom: 0;
    }
    
    .alert-box {
      background: rgba(220, 53, 69, 0.1) !important;
      border: 1px solid rgba(220, 53, 69, 0.3);
      border-radius: 8px;
      padding: 20px;
      margin: 30px 0;
      text-align: center;
    }
    
    .alert-box p {
      color: #dc3545 !important;
      font-size: 14px;
      font-weight: 600;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    /* LIGHT/DARK MODE FIXES */
    /* Force dark mode regardless of system preference */
    @media (prefers-color-scheme: light) {
      body,
      .email-container,
      .email-header,
      .email-content,
      .email-footer {
        background-color: #0a0a0a !important;
        color: #ffffff !important;
      }
      
      .email-content {
        background-color: #1a1a1a !important;
      }
      
      .main-title,
      .brand-logo,
      .welcome-text strong,
      .otp-code {
        color: #ffffff !important;
      }
      
      .otp-code {
        background-color: #2a2a2a !important;
        border: 2px solid #c2b280 !important;
      }
      
      .main-subtitle,
      .otp-label,
      .security-notice p,
      .info-box h3,
      .contact-details td:first-child,
      .contact-id {
        color: #c2b280 !important;
      }
      
      .welcome-text,
      .description-text,
      .info-box ul,
      .info-box li,
      .contact-details td:last-child,
      .contact-details td,
      .info-box table td,
      .message-content p {
        color: #cccccc !important;
      }
      
      .contact-details td:first-child,
      .info-box table th {
        color: #c2b280 !important;
      }
      
      .brand-tagline,
      .otp-expiry,
      .footer-tagline {
        color: #888888 !important;
      }
      
      .footer-contact {
        color: #aaaaaa !important;
      }
      
      .footer-contact a,
      .contact-details a {
        color: #c2b280 !important;
      }
      
      .alert-box p {
        color: #dc3545 !important;
      }
    }
    
    @media (prefers-color-scheme: dark) {
      body,
      .email-container,
      .email-header,
      .email-content,
      .email-footer {
        background-color: #0a0a0a !important;
        color: #ffffff !important;
      }
      
      .email-content {
        background-color: #1a1a1a !important;
      }
      
      .main-title,
      .brand-logo,
      .welcome-text strong,
      .otp-code {
        color: #ffffff !important;
      }
      
      .otp-code {
        background-color: #2a2a2a !important;
        border: 2px solid #c2b280 !important;
      }
      
      .main-subtitle,
      .otp-label,
      .security-notice p,
      .info-box h3,
      .contact-details td:first-child,
      .contact-id {
        color: #c2b280 !important;
      }
      
      .welcome-text,
      .description-text,
      .info-box ul,
      .info-box li,
      .contact-details td:last-child,
      .contact-details td,
      .info-box table td,
      .message-content p {
        color: #cccccc !important;
      }
      
      .contact-details td:first-child,
      .info-box table th {
        color: #c2b280 !important;
      }
      
      .brand-tagline,
      .otp-expiry,
      .footer-tagline {
        color: #888888 !important;
      }
      
      .footer-contact {
        color: #aaaaaa !important;
      }
      
      .footer-contact a,
      .contact-details a {
        color: #c2b280 !important;
      }
      
      .alert-box p {
        color: #dc3545 !important;
      }
    }
    
    /* Gmail app specific fixes */
    [data-ogsb] body,
    [data-ogsb] .email-container,
    [data-ogsb] .otp-code {
      background-color: #0a0a0a !important;
      color: #ffffff !important;
    }
    
    [data-ogsb] .otp-code {
      background-color: #2a2a2a !important;
      border: 2px solid #c2b280 !important;
    }
    
    /* Outlook dark mode fixes */
    [data-ogsc] body {
      background-color: #0a0a0a !important;
    }
    
    [data-ogsc] .email-container {
      background-color: #0a0a0a !important;
    }
    
    [data-ogsc] .otp-code {
      background-color: #2a2a2a !important;
      color: #ffffff !important;
      border: 2px solid #c2b280 !important;
    }
    
    /* Apple Mail dark mode */
    @supports (-webkit-appearance: none) {
      @media (prefers-color-scheme: dark) {
        body,
        .email-container {
          background-color: #0a0a0a !important;
          color: #ffffff !important;
        }
        
        .otp-code {
          background-color: #2a2a2a !important;
          color: #ffffff !important;
          border: 2px solid #c2b280 !important;
        }
      }
      
      @media (prefers-color-scheme: light) {
        body,
        .email-container {
          background-color: #0a0a0a !important;
          color: #ffffff !important;
        }
        
        .otp-code {
          background-color: #2a2a2a !important;
          color: #ffffff !important;
          border: 2px solid #c2b280 !important;
        }
      }
    }
    
    /* Mobile responsiveness */
    @media (max-width: 640px) {
      .email-header,
      .email-content,
      .email-footer {
        padding: 40px 24px !important;
      }
      
      .main-title {
        font-size: 32px !important;
      }
      
      .otp-code {
        font-size: 40px !important;
        letter-spacing: 8px !important;
        padding: 12px 16px !important;
      }
      
      .otp-section {
        padding: 30px 20px !important;
      }
      
      .brand-logo {
        font-size: 28px !important;
      }
      
      .welcome-text {
        font-size: 16px !important;
      }
      
      .contact-details td:first-child {
        width: 100px;
        font-size: 12px;
      }
    }
    
    @media (max-width: 480px) {
      .email-header,
      .email-content,
      .email-footer {
        padding: 30px 16px !important;
      }
      
      .main-title {
        font-size: 28px !important;
        line-height: 1.3 !important;
      }
      
      .otp-code {
        font-size: 36px !important;
        letter-spacing: 6px !important;
        padding: 10px 14px !important;
      }
      
      .brand-tagline {
        font-size: 11px !important;
        letter-spacing: 1px !important;
      }
      
      .otp-section {
        padding: 25px 15px !important;
      }
    }
  </style>
`;