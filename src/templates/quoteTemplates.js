// templates/quoteTemplates.js

/**
 * Send quote request confirmation email to user
 */
export const sendQuoteRequestConfirmationTemplate = (userName, productName, quoteId) => {
  const subject = "Quote Request Received - We'll Get Back to You Soon!";
  
  const text = `
Dear ${userName},

Thank you for your quote request!

We have successfully received your quote request for "${productName}".

Quote Request Details:
- Quote ID: ${quoteId}
- Product: ${productName}
- Status: Under Review

Our team will review your request and get back to you within 1-2 business days with a detailed quote.

If you have any questions or need to provide additional information, please reply to this email or contact us directly.

Thank you for choosing us!

Best regards,
The Sales Team
  `;

  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quote Request Confirmation</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
        }
        .container {
            background-color: #ffffff;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo {
            font-size: 28px;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 10px;
        }
        .title {
            color: #27ae60;
            font-size: 24px;
            margin-bottom: 20px;
            text-align: center;
        }
        .quote-details {
            background-color: #ecf0f1;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .quote-details h3 {
            color: #2c3e50;
            margin-top: 0;
            margin-bottom: 15px;
        }
        .quote-item {
            padding: 8px 0;
            border-bottom: 1px solid #bdc3c7;
        }
        .quote-item:last-child {
            border-bottom: none;
        }
        .quote-item strong {
            color: #2c3e50;
            display: inline-block;
            width: 100px;
        }
        .status-badge {
            background-color: #f39c12;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
        }
        .next-steps {
            background-color: #e8f5e8;
            border-left: 4px solid #27ae60;
            padding: 15px;
            margin: 20px 0;
        }
        .next-steps h4 {
            color: #27ae60;
            margin-top: 0;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #ecf0f1;
            color: #7f8c8d;
            font-size: 14px;
        }
        .button {
            display: inline-block;
            background-color: #3498db;
            color: white;
            padding: 12px 25px;
            text-decoration: none;
            border-radius: 5px;
            margin: 15px 0;
            font-weight: bold;
        }
        .contact-info {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🏠 Home Decor Store</div>
        </div>
        
        <h2 class="title">Quote Request Received!</h2>
        
        <p>Dear <strong>${userName}</strong>,</p>
        
        <p>Thank you for your quote request! We have successfully received your inquiry and our team is excited to work with you.</p>
        
        <div class="quote-details">
            <h3>📋 Quote Request Details</h3>
            <div class="quote-item">
                <strong>Quote ID:</strong> ${quoteId}
            </div>
            <div class="quote-item">
                <strong>Product:</strong> ${productName}
            </div>
            <div class="quote-item">
                <strong>Status:</strong> <span class="status-badge">Under Review</span>
            </div>
            <div class="quote-item">
                <strong>Submitted:</strong> ${new Date().toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}
            </div>
        </div>
        
        <div class="next-steps">
            <h4>🚀 What Happens Next?</h4>
            <ul>
                <li><strong>Review Process:</strong> Our team will carefully review your requirements</li>
                <li><strong>Custom Quote:</strong> We'll prepare a detailed quote tailored to your needs</li>
                <li><strong>Response Time:</strong> You'll hear back from us within 1-2 business days</li>
                <li><strong>Direct Contact:</strong> Our sales representative may reach out for any clarifications</li>
            </ul>
        </div>
        
        <div class="contact-info">
            <h4>📞 Need to Add More Details?</h4>
            <p>If you have additional specifications or questions, feel free to reply to this email or contact us directly:</p>
            <ul>
                <li><strong>Email:</strong> sales@homedecor.com</li>
                <li><strong>Phone:</strong> +1 (555) 123-4567</li>
                <li><strong>Business Hours:</strong> Monday - Friday, 9:00 AM - 6:00 PM</li>
            </ul>
        </div>
        
        <p>We appreciate your interest in our products and look forward to providing you with an excellent quote!</p>
        
        <div class="footer">
            <p><strong>Best regards,</strong><br>
            The Sales Team<br>
            Home Decor Store</p>
            <p>This is an automated confirmation email. Please do not reply to this email address.</p>
        </div>
    </div>
</body>
</html>
  `;

  return { subject, text, html };
};

/**
 * Send quote request notification to admin
 */
export const sendQuoteRequestNotificationTemplate = (quoteRequest, productName) => {
  const subject = `New Quote Request - ${productName} (ID: ${quoteRequest._id})`;
  
  const text = `
NEW QUOTE REQUEST RECEIVED

Customer Details:
- Name: ${quoteRequest.fullName}
- Email: ${quoteRequest.email}
- Phone: ${quoteRequest.phone}
- Company: ${quoteRequest.company || 'Not provided'}

Product Information:
- Product: ${productName}
- Quantity: ${quoteRequest.quantity}

Request Details:
- Message: ${quoteRequest.message}
- Specifications: ${quoteRequest.specifications || 'None provided'}
- Preferred Timeline: ${quoteRequest.preferredTimeline}
- Budget Range: ${quoteRequest.budgetRange?.min ? `$${quoteRequest.budgetRange.min} - $${quoteRequest.budgetRange.max}` : 'Not specified'}

Quote ID: ${quoteRequest._id}
Priority: ${quoteRequest.priorityDisplay}
Status: ${quoteRequest.statusDisplay}

Submitted: ${new Date(quoteRequest.createdAt).toLocaleString()}

Please review and respond to this quote request within 1-2 business days.
  `;

  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Quote Request</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 700px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
        }
        .container {
            background-color: #ffffff;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
        }
        .header {
            background-color: #e74c3c;
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            margin-bottom: 25px;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .section {
            margin-bottom: 25px;
            padding: 20px;
            border-left: 4px solid #3498db;
            background-color: #f8f9fa;
        }
        .section h3 {
            margin-top: 0;
            color: #2c3e50;
            border-bottom: 2px solid #ecf0f1;
            padding-bottom: 10px;
        }
        .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #ecf0f1;
        }
        .detail-row:last-child {
            border-bottom: none;
        }
        .detail-label {
            font-weight: bold;
            color: #2c3e50;
            flex: 0 0 150px;
        }
        .detail-value {
            flex: 1;
            text-align: right;
        }
        .priority-high { color: #e74c3c; font-weight: bold; }
        .priority-urgent { color: #c0392b; font-weight: bold; }
        .priority-medium { color: #f39c12; font-weight: bold; }
        .priority-low { color: #27ae60; font-weight: bold; }
        .quote-id {
            background-color: #2c3e50;
            color: white;
            padding: 10px;
            border-radius: 5px;
            text-align: center;
            font-family: monospace;
            font-size: 18px;
            margin: 15px 0;
        }
        .action-buttons {
            text-align: center;
            margin: 25px 0;
        }
        .button {
            display: inline-block;
            background-color: #3498db;
            color: white;
            padding: 12px 25px;
            text-decoration: none;
            border-radius: 5px;
            margin: 0 10px;
            font-weight: bold;
        }
        .button-urgent {
            background-color: #e74c3c;
        }
        .message-box {
            background-color: #ecf0f1;
            padding: 15px;
            border-radius: 5px;
            font-style: italic;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚨 New Quote Request Received</h1>
            <p>Immediate attention required</p>
        </div>
        
        <div class="quote-id">
            Quote ID: ${quoteRequest._id}
        </div>
        
        <div class="section">
            <h3>👤 Customer Information</h3>
            <div class="detail-row">
                <span class="detail-label">Name:</span>
                <span class="detail-value">${quoteRequest.fullName}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Email:</span>
                <span class="detail-value">${quoteRequest.email}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Phone:</span>
                <span class="detail-value">${quoteRequest.phone}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Company:</span>
                <span class="detail-value">${quoteRequest.company || 'Not provided'}</span>
            </div>
        </div>
        
        <div class="section">
            <h3>🛍️ Product Information</h3>
            <div class="detail-row">
                <span class="detail-label">Product:</span>
                <span class="detail-value"><strong>${productName}</strong></span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Quantity:</span>
                <span class="detail-value">${quoteRequest.quantity}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Timeline:</span>
                <span class="detail-value">${quoteRequest.preferredTimeline}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Budget Range:</span>
                <span class="detail-value">${quoteRequest.budgetRange?.min ? `$${quoteRequest.budgetRange.min} - $${quoteRequest.budgetRange.max}` : 'Not specified'}</span>
            </div>
        </div>
        
        <div class="section">
            <h3>📝 Request Details</h3>
            <div class="detail-row">
                <span class="detail-label">Priority:</span>
                <span class="detail-value priority-${quoteRequest.priority}">${quoteRequest.priorityDisplay}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Status:</span>
                <span class="detail-value">${quoteRequest.statusDisplay}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Submitted:</span>
                <span class="detail-value">${new Date(quoteRequest.createdAt).toLocaleString()}</span>
            </div>
            
            <h4>Customer Message:</h4>
            <div class="message-box">
                "${quoteRequest.message}"
            </div>
            
            ${quoteRequest.specifications ? `
            <h4>Specifications:</h4>
            <div class="message-box">
                "${quoteRequest.specifications}"
            </div>
            ` : ''}
            
            ${quoteRequest.selectedVariations && quoteRequest.selectedVariations.length > 0 ? `
            <h4>Selected Variations:</h4>
            <ul>
                ${quoteRequest.selectedVariations.map(variation => 
                    `<li><strong>${variation.variationName}:</strong> ${variation.selectedOption}</li>`
                ).join('')}
            </ul>
            ` : ''}
        </div>
        
        <div class="action-buttons">
            <a href="#" class="button">View in Admin Panel</a>
            <a href="#" class="button button-urgent">Reply to Customer</a>
        </div>
        
        <p><strong>Action Required:</strong> Please review this quote request and respond to the customer within 1-2 business days to maintain our service standards.</p>
    </div>
</body>
</html>
  `;

  return { subject, text, html };
};