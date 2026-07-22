// // templates/orderTemplates.js
// import { getEmailStyles } from './emailStyles.js';
// import { sendEmail } from '../config/emailConfig.js';

// /**
//  * Send payment confirmation email
//  */
// export const sendPaymentConfirmationEmail = async (userEmail, userName, orderDetails) => {
//   const subject = "Payment Confirmed - Your Style & Homes Order";

//   const {
//     orderId,
//     invoiceNumber,
//     totalAmount,
//     orderItems,
//     shippingAddress,
//     paymentMethod,
//     paidAt,
//     estimatedDelivery
//   } = orderDetails;

//   const text = `
//     Hello ${userName},
    
//     Great news! Your payment has been successfully processed for order #${invoiceNumber || orderId}.
    
//     Order Summary:
//     Order ID: ${orderId}
//     Invoice Number: ${invoiceNumber || orderId}
//     Total Amount: $${totalAmount}
//     Payment Method: ${paymentMethod}
//     Payment Date: ${new Date(paidAt).toLocaleDateString()}
    
//     Your order is now being processed and will be shipped to:
//     ${shippingAddress?.fullName || userName}
//     ${shippingAddress?.street || ''}
//     ${shippingAddress?.city || ''}, ${shippingAddress?.state || ''} ${shippingAddress?.zipCode || ''}
//     ${shippingAddress?.country || ''}
    
//     Estimated Delivery: ${estimatedDelivery || 'Within 7-10 business days'}
    
//     You can track your order status in your account dashboard.
    
//     Thank you for choosing Style & Homes!
    
//     Best regards,
//     The Style & Homes Team
//   `;

//   const orderItemsHtml = orderItems?.map(item => `
//     <tr>
//       <td style="padding: 12px 0; border-bottom: 1px solid #3a3a3a; color: #cccccc;">
//         ${item.name}
//         ${item.variationCombinationId ? `<br><small style="color: #888;">Variation: ${item.variationName || 'Custom'}</small>` : ''}
//       </td>
//       <td style="padding: 12px 0; border-bottom: 1px solid #3a3a3a; color: #cccccc; text-align: center;">
//         ${item.quantity}
//       </td>
//       <td style="padding: 12px 0; border-bottom: 1px solid #3a3a3a; color: #c2b280; text-align: right;">
//         $${(item.price * item.quantity).toFixed(2)}
//       </td>
//     </tr>
//   `).join('') || '';

//   const html = `
//     <!DOCTYPE html>
//     <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
//     <head>
//       <meta charset="UTF-8">
//       <meta name="viewport" content="width=device-width, initial-scale=1.0">
//       <meta http-equiv="X-UA-Compatible" content="IE=edge">
//       <meta name="x-apple-disable-message-reformatting">
//       <meta name="color-scheme" content="dark">
//       <meta name="supported-color-schemes" content="dark">
//       <title>Payment Confirmed - Style & Homes</title>
//       ${getEmailStyles()}
//     </head>
//     <body>
//       <div class="email-container">
//         <!-- Header -->
//         <div class="email-header">
//           <div class="brand-logo">STYLE & HOMES</div>
//           <div class="brand-tagline">Artisan Design • Extraordinary Spaces</div>
//         </div>
        
//         <!-- Main Content -->
//         <div class="email-content">
//           <div class="content-header">
//             <div class="main-subtitle">Payment Confirmed</div>
//             <div class="subtitle-line"></div>
//             <h1 class="main-title">Order Successfully Placed</h1>
//           </div>
          
//           <div class="welcome-text">
//             Hello <strong>${userName}</strong>,<br>
//             Excellent news! Your payment has been successfully processed and your order is now confirmed.
//           </div>
          
//           <div class="description-text">
//             Thank you for your purchase. Your order is now being processed by our team and will be carefully prepared for shipment.
//           </div>
          
//           <!-- Order Details -->
//           <div class="info-box">
//             <h3>Order Information</h3>
//             <div class="contact-details">
//               <table>
//                 <tr>
//                   <td>Order ID:</td>
//                   <td><span class="contact-id">${orderId}</span></td>
//                 </tr>
//                 <tr>
//                   <td>Invoice #:</td>
//                   <td>${invoiceNumber || orderId}</td>
//                 </tr>
//                 <tr>
//                   <td>Total Amount:</td>
//                   <td style="color: #c2b280; font-weight: 600;">$${totalAmount}</td>
//                 </tr>
//                 <tr>
//                   <td>Payment Method:</td>
//                   <td>${paymentMethod}</td>
//                 </tr>
//                 <tr>
//                   <td>Payment Date:</td>
//                   <td>${new Date(paidAt).toLocaleDateString()}</td>
//                 </tr>
//                 <tr>
//                   <td>Status:</td>
//                   <td style="color: #28a745; font-weight: 600;">Processing</td>
//                 </tr>
//               </table>
//             </div>
//           </div>

//           ${orderItems && orderItems.length > 0 ? `
//           <!-- Order Items -->
//           <div class="info-box">
//             <h3>Order Items</h3>
//             <table style="width: 100%; border-collapse: collapse;">
//               <thead>
//                 <tr style="border-bottom: 2px solid #c2b280;">
//                   <th style="padding: 12px 0; color: #c2b280; text-align: left; font-weight: 600;">Item</th>
//                   <th style="padding: 12px 0; color: #c2b280; text-align: center; font-weight: 600;">Qty</th>
//                   <th style="padding: 12px 0; color: #c2b280; text-align: right; font-weight: 600;">Total</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 ${orderItemsHtml}
//               </tbody>
//             </table>
//           </div>
//           ` : ''}

//           ${shippingAddress ? `
//           <!-- Shipping Address -->
//           <div class="info-box">
//             <h3>Shipping Address</h3>
//             <div style="color: #cccccc; line-height: 1.6;">
//               ${shippingAddress.fullName || userName}<br>
//               ${shippingAddress.street || ''}<br>
//               ${shippingAddress.city || ''}, ${shippingAddress.state || ''} ${shippingAddress.zipCode || ''}<br>
//               ${shippingAddress.country || ''}
//             </div>
//           </div>
//           ` : ''}
          
//           <!-- Security Notice -->
//           <div class="security-notice">
//             <p>📦 Estimated Delivery: ${estimatedDelivery || 'Within 7-10 business days'} | You can track your order status in your account dashboard.</p>
//           </div>
          
//           <div class="divider"></div>
          
//           <div style="text-align: center; color: #888888; font-size: 14px;">
//             Thank you for choosing Style & Homes. We're committed to delivering exceptional quality that reflects our dedication to extraordinary spaces.
//           </div>
//         </div>
        
//         <!-- Footer -->
//         <div class="email-footer">
//           <div class="footer-brand">STYLE & HOMES</div>
//           <div class="footer-tagline">Crafting Extraordinary Spaces</div>
//           <div class="footer-contact">
//             Track your order at <a href="https://stylenhomes.com/orders">stylenhomes.com/orders</a><br>
//             Questions? Contact us at <a href="mailto:orders@stylenhomes.com">orders@stylenhomes.com</a>
//           </div>
//         </div>
//       </div>
//     </body>
//     </html>
//   `;

//   return await sendEmail({
//     to: userEmail,
//     subject,
//     text,
//     html,
//   });
// };

// /**
//  * Send order status update email to user
//  */
// export const sendOrderStatusUpdateEmail = async (userEmail, userName, orderDetails, newStatus, trackingInfo = null) => {
//   const subject = `Order Update: ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)} - Style & Homes`;

//   const {
//     orderId,
//     invoiceNumber,
//     totalAmount,
//     orderItems,
//     estimatedDelivery
//   } = orderDetails;

//   const statusMessages = {
//     processing: "Your order is currently being processed by our team.",
//     shipped: "Great news! Your order has been shipped and is on its way to you.",
//     delivered: "Your order has been delivered successfully.",
//     cancelled: "Your order has been cancelled as requested.",
//     refunded: "Your order has been refunded successfully.",
//     returned: "Your return has been processed."
//   };

//   const text = `
//     Hello ${userName},
    
//     Your order #${invoiceNumber || orderId} status has been updated to: ${newStatus.toUpperCase()}
    
//     ${statusMessages[newStatus] || 'Your order status has been updated.'}
    
//     Order Details:
//     Order ID: ${orderId}
//     Invoice Number: ${invoiceNumber || orderId}
//     Total Amount: $${totalAmount}
//     Status: ${newStatus}
//     ${trackingInfo ? `Tracking Number: ${trackingInfo.trackingNumber}` : ''}
//     ${trackingInfo ? `Carrier: ${trackingInfo.carrier}` : ''}
    
//     ${newStatus === 'shipped' && estimatedDelivery ? `Estimated Delivery: ${estimatedDelivery}` : ''}
    
//     You can track your order status in your account dashboard.
    
//     Thank you for choosing Style & Homes!
    
//     Best regards,
//     The Style & Homes Team
//   `;

//   const getStatusColor = (status) => {
//     const colors = {
//       processing: '#ffc107',
//       shipped: '#17a2b8',
//       delivered: '#28a745',
//       cancelled: '#dc3545',
//       refunded: '#6c757d',
//       returned: '#fd7e14'
//     };
//     return colors[status] || '#c2b280';
//   };

//   const getStatusIcon = (status) => {
//     const icons = {
//       processing: '⚙️',
//       shipped: '🚚',
//       delivered: '📦',
//       cancelled: '❌',
//       refunded: '💰',
//       returned: '🔄'
//     };
//     return icons[status] || '📋';
//   };

//   const html = `
//     <!DOCTYPE html>
//     <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
//     <head>
//       <meta charset="UTF-8">
//       <meta name="viewport" content="width=device-width, initial-scale=1.0">
//       <meta http-equiv="X-UA-Compatible" content="IE=edge">
//       <meta name="x-apple-disable-message-reformatting">
//       <meta name="color-scheme" content="dark">
//       <meta name="supported-color-schemes" content="dark">
//       <title>Order Status Update - Style & Homes</title>
//       ${getEmailStyles()}
//     </head>
//     <body>
//       <div class="email-container">
//         <!-- Header -->
//         <div class="email-header">
//           <div class="brand-logo">STYLE & HOMES</div>
//           <div class="brand-tagline">Artisan Design • Extraordinary Spaces</div>
//         </div>
        
//         <!-- Main Content -->
//         <div class="email-content">
//           <div class="content-header">
//             <div class="main-subtitle">Order Update</div>
//             <div class="subtitle-line"></div>
//             <h1 class="main-title">${getStatusIcon(newStatus)} Order ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}</h1>
//           </div>
          
//           <div class="welcome-text">
//             Hello <strong>${userName}</strong>,<br>
//             We have an update regarding your order #${invoiceNumber || orderId}.
//           </div>
          
//           <div class="description-text">
//             ${statusMessages[newStatus] || 'Your order status has been updated.'}
//           </div>
          
//           <!-- Status Update -->
//           <div class="otp-section">
//             <div class="otp-label">Current Status</div>
//             <div style="font-family: 'Inter', sans-serif; font-size: 36px; font-weight: 700; color: ${getStatusColor(newStatus)}; letter-spacing: 2px; margin: 20px 0; text-transform: uppercase;">
//               ${newStatus}
//             </div>
//             <div class="otp-expiry">Updated on ${new Date().toLocaleDateString()}</div>
//           </div>
          
//           <!-- Order Details -->
//           <div class="info-box">
//             <h3>Order Information</h3>
//             <div class="contact-details">
//               <table>
//                 <tr>
//                   <td>Order ID:</td>
//                   <td><span class="contact-id">${orderId}</span></td>
//                 </tr>
//                 <tr>
//                   <td>Invoice #:</td>
//                   <td>${invoiceNumber || orderId}</td>
//                 </tr>
//                 <tr>
//                   <td>Total Amount:</td>
//                   <td style="color: #c2b280; font-weight: 600;">$${totalAmount}</td>
//                 </tr>
//                 <tr>
//                   <td>Status:</td>
//                   <td style="color: ${getStatusColor(newStatus)}; font-weight: 600; text-transform: uppercase;">${newStatus}</td>
//                 </tr>
//                 ${trackingInfo ? `
//                 <tr>
//                   <td>Tracking #:</td>
//                   <td style="font-family: 'Courier New', monospace; color: #c2b280;">${trackingInfo.trackingNumber}</td>
//                 </tr>
//                 <tr>
//                   <td>Carrier:</td>
//                   <td>${trackingInfo.carrier}</td>
//                 </tr>
//                 ` : ''}
//                 ${newStatus === 'shipped' && estimatedDelivery ? `
//                 <tr>
//                   <td>Est. Delivery:</td>
//                   <td style="color: #28a745; font-weight: 600;">${estimatedDelivery}</td>
//                 </tr>
//                 ` : ''}
//               </table>
//             </div>
//           </div>

//           ${trackingInfo && trackingInfo.trackingUrl ? `
//           <!-- Tracking Info -->
//           <div class="security-notice">
//             <p>📍 Track your package: <a href="${trackingInfo.trackingUrl}" style="color: #c2b280; text-decoration: none; font-weight: 600;">Click here to track</a></p>
//           </div>
//           ` : ''}
          
//           <div class="divider"></div>
          
//           <div style="text-align: center; color: #888888; font-size: 14px;">
//             ${newStatus === 'delivered' ? 
//               'Thank you for your business! We hope you love your new items from Style & Homes.' :
//               'We appreciate your patience and will keep you updated on any further changes to your order status.'
//             }
//           </div>
//         </div>
        
//         <!-- Footer -->
//         <div class="email-footer">
//           <div class="footer-brand">STYLE & HOMES</div>
//           <div class="footer-tagline">Crafting Extraordinary Spaces</div>
//           <div class="footer-contact">
//             Track your order at <a href="https://stylenhomes.com/orders">stylenhomes.com/orders</a><br>
//             Questions? Contact us at <a href="mailto:orders@stylenhomes.com">orders@stylenhomes.com</a>
//           </div>
//         </div>
//       </div>
//     </body>
//     </html>
//   `;

//   return await sendEmail({
//     to: userEmail,
//     subject,
//     text,
//     html,
//   });
// };

// /**
//  * Send admin notification for new order
//  */
// export const sendNewOrderNotificationEmail = async (orderDetails) => {
//   const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USERNAME;
//   const subject = `New Order Received - #${orderDetails.invoiceNumber || orderDetails.orderId}`;

//   const {
//     orderId,
//     invoiceNumber,
//     userName,
//     userEmail,
//     totalAmount,
//     orderItems,
//     shippingAddress,
//     paymentMethod,
//     paidAt
//   } = orderDetails;

//   const orderItemsHtml = orderItems?.map(item => `
//     <tr>
//       <td style="padding: 8px 0; border-bottom: 1px solid #3a3a3a; color: #cccccc;">
//         ${item.name}
//         ${item.variationCombinationId ? `<br><small style="color: #888;">Variation: ${item.variationName || 'Custom'}</small>` : ''}
//       </td>
//       <td style="padding: 8px 0; border-bottom: 1px solid #3a3a3a; color: #cccccc; text-align: center;">
//         ${item.quantity}
//       </td>
//       <td style="padding: 8px 0; border-bottom: 1px solid #3a3a3a; color: #c2b280; text-align: right;">
//         $${(item.price * item.quantity).toFixed(2)}
//       </td>
//     </tr>
//   `).join('') || '';

//   const text = `
//     New Order Received
    
//     Order ID: ${orderId}
//     Invoice Number: ${invoiceNumber || orderId}
//     Customer: ${userName} (${userEmail})
//     Total Amount: $${totalAmount}
//     Payment Method: ${paymentMethod}
//     Payment Date: ${new Date(paidAt).toLocaleString()}
    
//     Shipping Address:
//     ${shippingAddress?.fullName || userName}
//     ${shippingAddress?.street || ''}
//     ${shippingAddress?.city || ''}, ${shippingAddress?.state || ''} ${shippingAddress?.zipCode || ''}
//     ${shippingAddress?.country || ''}
    
//     Please process this order promptly.
//   `;

//   const html = `
//     <!DOCTYPE html>
//     <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
//     <head>
//       <meta charset="UTF-8">
//       <meta name="viewport" content="width=device-width, initial-scale=1.0">
//       <meta http-equiv="X-UA-Compatible" content="IE=edge">
//       <meta name="x-apple-disable-message-reformatting">
//       <meta name="color-scheme" content="dark">
//       <meta name="supported-color-schemes" content="dark">
//       <title>New Order - Style & Homes Admin</title>
//       ${getEmailStyles()}
//     </head>
//     <body>
//       <div class="email-container">
//         <!-- Header -->
//         <div class="email-header">
//           <div class="brand-logo">STYLE & HOMES</div>
//           <div class="brand-tagline">Admin Notification</div>
//         </div>
        
//         <!-- Main Content -->
//         <div class="email-content">
//           <div class="content-header">
//             <div class="main-subtitle">New Order</div>
//             <div class="subtitle-line"></div>
//             <h1 class="main-title">Order Received</h1>
//           </div>
          
//           <div class="welcome-text">
//             A new order has been placed and payment has been confirmed.
//           </div>
          
//           <!-- Order Details -->
//           <div class="contact-details">
//             <table>
//               <tr>
//                 <td>Order ID:</td>
//                 <td><span class="contact-id">${orderId}</span></td>
//               </tr>
//               <tr>
//                 <td>Invoice #:</td>
//                 <td>${invoiceNumber || orderId}</td>
//               </tr>
//               <tr>
//                 <td>Customer:</td>
//                 <td>${userName}</td>
//               </tr>
//               <tr>
//                 <td>Email:</td>
//                 <td><a href="mailto:${userEmail}">${userEmail}</a></td>
//               </tr>
//               <tr>
//                 <td>Total:</td>
//                 <td style="color: #c2b280; font-weight: 600;">$${totalAmount}</td>
//               </tr>
//               <tr>
//                 <td>Payment:</td>
//                 <td>${paymentMethod}</td>
//               </tr>
//               <tr>
//                 <td>Date:</td>
//                 <td>${new Date(paidAt).toLocaleString()}</td>
//               </tr>
//             </table>
//           </div>

//           ${orderItems && orderItems.length > 0 ? `
//           <!-- Order Items -->
//           <div class="info-box">
//             <h3>Order Items</h3>
//             <table style="width: 100%; border-collapse: collapse;">
//               <thead>
//                 <tr style="border-bottom: 2px solid #c2b280;">
//                   <th style="padding: 12px 0; color: #c2b280; text-align: left;">Item</th>
//                   <th style="padding: 12px 0; color: #c2b280; text-align: center;">Qty</th>
//                   <th style="padding: 12px 0; color: #c2b280; text-align: right;">Total</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 ${orderItemsHtml}
//               </tbody>
//             </table>
//           </div>
//           ` : ''}

//       ${shippingAddress ? `
//           <!-- Shipping Address -->
//           <div class="info-box">
//             <h3>Shipping Address</h3>
//             <div style="color: #cccccc; line-height: 1.6;">
//               ${shippingAddress.fullName || userName}<br>
//               ${shippingAddress.street || ''}<br>
//               ${shippingAddress.city || ''}, ${shippingAddress.state || ''} ${shippingAddress.zipCode || ''}<br>
//               ${shippingAddress.country || ''}
//             </div>
//           </div>
//           ` : ''}
          
//           <!-- Alert Box -->
//           <div class="alert-box">
//             <p>⚠️ Please process this order promptly</p>
//           </div>
//         </div>
        
//         <!-- Footer -->
//         <div class="email-footer">
//           <div class="footer-brand">STYLE & HOMES</div>
//           <div class="footer-tagline">Admin Dashboard</div>
//           <div class="footer-contact">
//             <a href="https://admin.stylenhomes.com/orders">View in Admin Panel</a>
//           </div>
//         </div>
//       </div>
//     </body>
//     </html>
//   `;

//   return await sendEmail({
//     to: adminEmail,
//     subject,
//     text,
//     html,
//   });
// };

// templates/orderTemplates.js
import { getEmailStyles } from './emailStyles.js';

/**
 * Payment confirmation email template
 */
export const sendPaymentConfirmationEmailTemplate = (userName, orderDetails) => {
  const subject = "Payment Confirmed - Your Style & Homes Order";

  const {
    invoiceNumber,
    totalAmount,
    orderItems,
    shippingAddress,
    paymentMethod,
    paidAt,
    estimatedDelivery
  } = orderDetails;

  const orderReference = invoiceNumber || "Pending Assignment";

  const text = `
    Hello ${userName},
    
    Great news! Your payment has been successfully processed for order #${orderReference}.
    
    Order Summary:
    Invoice Number: ${orderReference}
    Total Amount: $${totalAmount}
    Payment Method: ${paymentMethod}
    Payment Date: ${new Date(paidAt).toLocaleDateString()}
    
    Your order is now being processed and will be shipped to:
    ${shippingAddress?.fullName || userName}
    ${shippingAddress?.street || ''}
    ${shippingAddress?.city || ''}, ${shippingAddress?.state || ''} ${shippingAddress?.zipCode || ''}
    ${shippingAddress?.country || ''}
    
    Estimated Delivery: ${estimatedDelivery || 'Within 7-10 business days'}
    
    You can track your order status in your account dashboard.
    
    Thank you for choosing Style & Homes!
    
    Best regards,
    The Style & Homes Team
  `;

  // Helper function to construct full product/variation name
  const getFullProductName = (item) => {
    if (!item.selectedVariations || item.selectedVariations.length === 0) {
      return item.name;
    }
    
    // Build variation string from selected variations
    const variationValues = item.selectedVariations
      .map(v => v.value)
      .filter(Boolean)
      .join(' ');
    
    if (variationValues) {
      return `${item.name} - ${variationValues}`;
    }
    
    return item.name;
  };

  const orderItemsHtml = orderItems?.map(item => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #3a3a3a; color: #cccccc !important;">
        ${getFullProductName(item)}
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid #3a3a3a; color: #cccccc !important; text-align: center;">
        ${item.quantity}
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid #3a3a3a; color: #c2b280 !important; text-align: right;">
        $${(item.price * item.quantity).toFixed(2)}
      </td>
    </tr>
  `).join('') || '';

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
      <title>Payment Confirmed - Style & Homes</title>
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
            <div class="main-subtitle">Payment Confirmed</div>
            <div class="subtitle-line"></div>
            <h1 class="main-title">Order Successfully Placed</h1>
          </div>
          
          <div class="welcome-text">
            Hello <strong>${userName}</strong>,<br>
            Excellent news! Your payment has been successfully processed and your order is now confirmed.
          </div>
          
          <div class="description-text">
            Thank you for your purchase. Your order is now being processed by our team and will be carefully prepared for shipment.
          </div>
          
          <!-- Order Details -->
          <div class="info-box">
            <h3>Order Information</h3>
            <div class="contact-details">
              <table>
                <tr>
                  <td style="color: #c2b280 !important;">Invoice #:</td>
                  <td style="color: #cccccc !important;">${orderReference}</td>
                </tr>
                <tr>
                  <td style="color: #c2b280 !important;">Total Amount:</td>
                  <td style="color: #c2b280 !important; font-weight: 600;">$${totalAmount}</td>
                </tr>
                <tr>
                  <td style="color: #c2b280 !important;">Payment Method:</td>
                  <td style="color: #cccccc !important;">${paymentMethod}</td>
                </tr>
                <tr>
                  <td style="color: #c2b280 !important;">Payment Date:</td>
                  <td style="color: #cccccc !important;">${new Date(paidAt).toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td style="color: #c2b280 !important;">Status:</td>
                  <td style="color: #28a745 !important; font-weight: 600;">Processing</td>
                </tr>
              </table>
            </div>
          </div>

          ${orderItems && orderItems.length > 0 ? `
          <!-- Order Items -->
          <div class="info-box">
            <h3>Order Items</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 2px solid #c2b280;">
                  <th style="padding: 12px 0; color: #c2b280 !important; text-align: left; font-weight: 600;">Item</th>
                  <th style="padding: 12px 0; color: #c2b280 !important; text-align: center; font-weight: 600;">Qty</th>
                  <th style="padding: 12px 0; color: #c2b280 !important; text-align: right; font-weight: 600;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${orderItemsHtml}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${shippingAddress ? `
          <!-- Shipping Address -->
          <div class="info-box">
            <h3>Shipping Address</h3>
            <div style="color: #cccccc; line-height: 1.6;">
              ${shippingAddress.fullName || userName}<br>
              ${shippingAddress.street || ''}<br>
              ${shippingAddress.city || ''}, ${shippingAddress.state || ''} ${shippingAddress.zipCode || ''}<br>
              ${shippingAddress.country || ''}
            </div>
          </div>
          ` : ''}
          
          <!-- Security Notice -->
          <div class="security-notice">
            <p>📦 Estimated Delivery: ${estimatedDelivery || 'Within 7-10 business days'} | You can track your order status in your account dashboard.</p>
          </div>
          
          <div class="divider"></div>
          
          <div style="text-align: center; color: #888888; font-size: 14px;">
            Thank you for choosing Style & Homes. We're committed to delivering exceptional quality that reflects our dedication to extraordinary spaces.
          </div>
        </div>
        
        <!-- Footer -->
        <div class="email-footer">
          <div class="footer-brand">STYLE & HOMES</div>
          <div class="footer-tagline">Crafting Extraordinary Spaces</div>
          <div class="footer-contact">
            Track your order at <a href="https://stylenhomes.com/account">stylenhomes.com/account</a><br>
            Contact us at <a href="mailto:info@stylenhomes.com">info@stylenhomes.com</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject, text, html };
};

/**
 * Order status update email template
 */
export const sendOrderStatusUpdateEmailTemplate = (userName, orderDetails, newStatus, trackingInfo = null) => {
  const subject = `Order Update: ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)} - Style & Homes`;

  const {
    invoiceNumber,
    totalAmount,
    orderItems,
    estimatedDelivery
  } = orderDetails;

  const orderReference = invoiceNumber || "Pending Assignment";

  const statusMessages = {
    processing: "Your order is currently being processed by our team.",
    shipped: "Great news! Your order has been shipped and is on its way to you.",
    delivered: "Your order has been delivered successfully.",
    cancelled: "Your order has been cancelled as requested.",
    refunded: "Your order has been refunded successfully.",
    returned: "Your return has been processed."
  };

  const text = `
    Hello ${userName},
    
    Your order #${orderReference} status has been updated to: ${newStatus.toUpperCase()}
    
    ${statusMessages[newStatus] || 'Your order status has been updated.'}
    
    Order Details:
    Invoice Number: ${orderReference}
    Total Amount: $${totalAmount}
    Status: ${newStatus}
    ${trackingInfo ? `Tracking Number: ${trackingInfo.trackingNumber}` : ''}
    ${trackingInfo ? `Carrier: ${trackingInfo.carrier}` : ''}
    
    ${newStatus === 'shipped' && estimatedDelivery ? `Estimated Delivery: ${estimatedDelivery}` : ''}
    
    You can track your order status in your account dashboard.
    
    Thank you for choosing Style & Homes!
    
    Best regards,
    The Style & Homes Team
  `;

  const getStatusColor = (status) => {
    const colors = {
      processing: '#ffc107',
      shipped: '#17a2b8',
      delivered: '#28a745',
      cancelled: '#dc3545',
      refunded: '#6c757d',
      returned: '#fd7e14'
    };
    return colors[status] || '#c2b280';
  };

  const getStatusIcon = (status) => {
    const icons = {
      processing: '⚙️',
      shipped: '🚚',
      delivered: '📦',
      cancelled: '❌',
      refunded: '💰',
      returned: '🔄'
    };
    return icons[status] || '📋';
  };

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
      <title>Order Status Update - Style & Homes</title>
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
            <div class="main-subtitle">Order Update</div>
            <div class="subtitle-line"></div>
            <h1 class="main-title">${getStatusIcon(newStatus)} Order ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}</h1>
          </div>
          
          <div class="welcome-text">
            Hello <strong>${userName}</strong>,<br>
            We have an update regarding your order #${orderReference}.
          </div>
          
          <div class="description-text">
            ${statusMessages[newStatus] || 'Your order status has been updated.'}
          </div>
          
          <!-- Status Update -->
          <div class="otp-section">
            <div class="otp-label">Current Status</div>
            <div style="font-family: 'Inter', sans-serif; font-size: 36px; font-weight: 700; color: ${getStatusColor(newStatus)}; letter-spacing: 2px; margin: 20px 0; text-transform: uppercase;">
              ${newStatus}
            </div>
            <div class="otp-expiry">Updated on ${new Date().toLocaleDateString()}</div>
          </div>
          
          <!-- Order Details -->
          <div class="info-box">
            <h3>Order Information</h3>
            <div class="contact-details">
              <table>
                <tr>
                  <td>Invoice #:</td>
                  <td>${orderReference}</td>
                </tr>
                <tr>
                  <td>Total Amount:</td>
                  <td style="color: #c2b280; font-weight: 600;">$${totalAmount}</td>
                </tr>
                <tr>
                  <td>Status:</td>
                  <td style="color: ${getStatusColor(newStatus)}; font-weight: 600; text-transform: uppercase;">${newStatus}</td>
                </tr>
                ${trackingInfo ? `
                <tr>
                  <td>Tracking #:</td>
                  <td style="font-family: 'Courier New', monospace; color: #c2b280;">${trackingInfo.trackingNumber}</td>
                </tr>
                <tr>
                  <td>Carrier:</td>
                  <td>${trackingInfo.carrier}</td>
                </tr>
                ` : ''}
                ${newStatus === 'shipped' && estimatedDelivery ? `
                <tr>
                  <td>Est. Delivery:</td>
                  <td style="color: #28a745; font-weight: 600;">${estimatedDelivery}</td>
                </tr>
                ` : ''}
              </table>
            </div>
          </div>

          ${trackingInfo && trackingInfo.trackingUrl ? `
          <!-- Tracking Info -->
          <div class="security-notice">
            <p>📍 Track your package: <a href="${trackingInfo.trackingUrl}" style="color: #c2b280; text-decoration: none; font-weight: 600;">Click here to track</a></p>
          </div>
          ` : ''}
          
          <div class="divider"></div>
          
          <div style="text-align: center; color: #888888; font-size: 14px;">
            ${newStatus === 'delivered' ? 
              'Thank you for your business! We hope you love your new items from Style & Homes.' :
              'We appreciate your patience and will keep you updated on any further changes to your order status.'
            }
          </div>
        </div>
        
        <!-- Footer -->
        <div class="email-footer">
          <div class="footer-brand">STYLE & HOMES</div>
          <div class="footer-tagline">Crafting Extraordinary Spaces</div>
          <div class="footer-contact">
            Track your order at <a href="https://stylenhomes.com/account">stylenhomes.com/account</a><br>
            Contact us at <a href="mailto:info@stylenhomes.com">info@stylenhomes.com</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject, text, html };
};

/**
 * New order notification email template for admin
 */
export const sendNewOrderNotificationEmailTemplate = (orderDetails) => {
  const subject = `New Order Received - #${orderDetails.invoiceNumber || orderDetails.orderId}`;

  const {
    orderId,
    invoiceNumber,
    userName,
    userEmail,
    totalAmount,
    orderItems,
    shippingAddress,
    paymentMethod,
    paidAt
  } = orderDetails;

  const orderItemsHtml = orderItems?.map(item => `
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #3a3a3a; color: #cccccc;">
        ${item.name}
        ${item.variationCombinationId ? `<br><small style="color: #888;">Variation: ${item.variationName || 'Custom'}</small>` : ''}
      </td>
      <td style="padding: 8px 0; border-bottom: 1px solid #3a3a3a; color: #cccccc; text-align: center;">
        ${item.quantity}
      </td>
      <td style="padding: 8px 0; border-bottom: 1px solid #3a3a3a; color: #c2b280; text-align: right;">
        $${(item.price * item.quantity).toFixed(2)}
      </td>
    </tr>
  `).join('') || '';

  const text = `
    New Order Received
    
    Order ID: ${orderId}
    Invoice Number: ${invoiceNumber || orderId}
    Customer: ${userName} (${userEmail})
    Total Amount: $${totalAmount}
    Payment Method: ${paymentMethod}
    Payment Date: ${new Date(paidAt).toLocaleString()}
    
    Shipping Address:
    ${shippingAddress?.fullName || userName}
    ${shippingAddress?.street || ''}
    ${shippingAddress?.city || ''}, ${shippingAddress?.state || ''} ${shippingAddress?.zipCode || ''}
    ${shippingAddress?.country || ''}
    
    Please process this order promptly.
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
      <title>New Order - Style & Homes Admin</title>
      ${getEmailStyles()}
    </head>
    <body>
      <div class="email-container">
        <!-- Header -->
        <div class="email-header">
          <div class="brand-logo">STYLE & HOMES</div>
          <div class="brand-tagline">Admin Notification</div>
        </div>
        
        <!-- Main Content -->
        <div class="email-content">
          <div class="content-header">
            <div class="main-subtitle">New Order</div>
            <div class="subtitle-line"></div>
            <h1 class="main-title">Order Received</h1>
          </div>
          
          <div class="welcome-text">
            A new order has been placed and payment has been confirmed.
          </div>
          
          <!-- Order Details -->
          <div class="contact-details">
            <table>
              <tr>
                <td>Order ID:</td>
                <td><span class="contact-id">${orderId}</span></td>
              </tr>
              <tr>
                <td>Invoice #:</td>
                <td>${invoiceNumber || orderId}</td>
              </tr>
              <tr>
                <td>Customer:</td>
                <td>${userName}</td>
              </tr>
              <tr>
                <td>Email:</td>
                <td><a href="mailto:${userEmail}">${userEmail}</a></td>
              </tr>
              <tr>
                <td>Total:</td>
                <td style="color: #c2b280; font-weight: 600;">$${totalAmount}</td>
              </tr>
              <tr>
                <td>Payment:</td>
                <td>${paymentMethod}</td>
              </tr>
              <tr>
                <td>Date:</td>
                <td>${new Date(paidAt).toLocaleString()}</td>
              </tr>
            </table>
          </div>

          ${orderItems && orderItems.length > 0 ? `
          <!-- Order Items -->
          <div class="info-box">
            <h3>Order Items</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 2px solid #c2b280;">
                  <th style="padding: 12px 0; color: #c2b280; text-align: left;">Item</th>
                  <th style="padding: 12px 0; color: #c2b280; text-align: center;">Qty</th>
                  <th style="padding: 12px 0; color: #c2b280; text-align: right;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${orderItemsHtml}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${shippingAddress ? `
          <!-- Shipping Address -->
          <div class="info-box">
            <h3>Shipping Address</h3>
            <div style="color: #cccccc; line-height: 1.6;">
              ${shippingAddress.fullName || userName}<br>
              ${shippingAddress.street || ''}<br>
              ${shippingAddress.city || ''}, ${shippingAddress.state || ''} ${shippingAddress.zipCode || ''}<br>
              ${shippingAddress.country || ''}
            </div>
          </div>
          ` : ''}
          
          <!-- Alert Box -->
          <div class="alert-box">
            <p>⚠️ Please process this order promptly</p>
          </div>
        </div>
        
        <!-- Footer -->
        <div class="email-footer">
          <div class="footer-brand">STYLE & HOMES</div>
          <div class="footer-tagline">Admin Dashboard</div>
          <div class="footer-contact">
            <a href="https://admin.stylenhomes.com/orders">View in Admin Panel</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject, text, html };
};

/**
 * Order cancellation email template
 */
/**
 * Order cancellation email template
 */
export const sendOrderCancellationEmailTemplate = (userName, orderDetails) => {
  const {
    invoiceNumber,
    totalAmount,
    cancelReason,
    refundAmount,
    refundMethod
  } = orderDetails;

  const orderReference = invoiceNumber || "Pending Assignment";
  const subject = orderReference === "Pending Assignment"
    ? "Order Cancelled - Style & Homes"
    : `Order Cancelled - #${orderReference}`;

  const text = `
    Hello ${userName},
    
    Your order #${orderReference} has been cancelled as requested.
    
    Cancellation Details:
    Invoice Number: ${orderReference}
    Original Amount: $${totalAmount}
    ${cancelReason ? `Reason: ${cancelReason}` : ''}
    ${refundAmount ? `Refund Amount: $${refundAmount}` : ''}
    ${refundMethod ? `Refund Method: ${refundMethod}` : ''}
    
    ${refundAmount ? 'Your refund will be processed within 3-5 business days.' : ''}
    
    If you have any questions about this cancellation, please contact our support team.
    
    Thank you for your understanding.
    
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
      <title>Order Cancelled - Style & Homes</title>
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
            <div class="main-subtitle">Order Cancelled</div>
            <div class="subtitle-line"></div>
            <h1 class="main-title">❌ Order Cancellation Confirmed</h1>
          </div>
          
          <div class="welcome-text">
            Hello <strong>${userName}</strong>,<br>
            Your order cancellation has been processed successfully.
          </div>
          
          <div class="description-text">
            We've cancelled your order as requested. ${refundAmount ? 'Your refund is being processed.' : ''}
          </div>
          
          <!-- Cancellation Details -->
          <div class="info-box">
            <h3>Cancellation Details</h3>
            <div class="contact-details">
              <table>
                <tr>
                  <td>Invoice #:</td>
                  <td>${orderReference}</td>
                </tr>
                <tr>
                  <td>Original Amount:</td>
                  <td style="color: #c2b280; font-weight: 600;">$${totalAmount}</td>
                </tr>
                ${cancelReason ? `
                <tr>
                  <td>Reason:</td>
                  <td>${cancelReason}</td>
                </tr>
                ` : ''}
                ${refundAmount ? `
                <tr>
                  <td>Refund Amount:</td>
                  <td style="color: #28a745; font-weight: 600;">$${refundAmount}</td>
                </tr>
                ` : ''}
                ${refundMethod ? `
                <tr>
                  <td>Refund Method:</td>
                  <td>${refundMethod}</td>
                </tr>
                ` : ''}
                <tr>
                  <td>Status:</td>
                  <td style="color: #dc3545; font-weight: 600;">Cancelled</td>
                </tr>
              </table>
            </div>
          </div>

          ${refundAmount ? `
          <!-- Refund Notice -->
          <div class="security-notice">
            <p>💰 Your refund of $${refundAmount} will be processed within 3-5 business days to your original payment method.</p>
          </div>
          ` : ''}
          
          <div class="divider"></div>
          
          <div style="text-align: center; color: #888888; font-size: 14px;">
            Thank you for your understanding. We hope to serve you again in the future at Style & Homes.
          </div>
        </div>
        
        <!-- Footer -->
        <div class="email-footer">
          <div class="footer-brand">STYLE & HOMES</div>
          <div class="footer-tagline">Crafting Extraordinary Spaces</div>
          <div class="footer-contact">
            Questions? Contact us at <a href="mailto:support@stylenhomes.com">support@stylenhomes.com</a><br>
            Visit us at <a href="https://stylenhomes.com">stylenhomes.com</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject, text, html };
};

/**
 * Order cancellation notification email template for admin
 */
export const sendOrderCancellationNotificationEmailTemplate = (orderDetails) => {
  const subject = `Order Cancellation - #${orderDetails.invoiceNumber || orderDetails.orderId}`;

  const {
    orderId,
    invoiceNumber,
    userName,
    userEmail,
    totalAmount,
    cancelReason,
    refundAmount,
    cancelledAt
  } = orderDetails;

  const text = `
    Order Cancellation Notification
    
    Order ID: ${orderId}
    Invoice Number: ${invoiceNumber || orderId}
    Customer: ${userName} (${userEmail})
    Original Amount: $${totalAmount}
    ${cancelReason ? `Cancellation Reason: ${cancelReason}` : ''}
    ${refundAmount ? `Refund Amount: $${refundAmount}` : ''}
    Cancelled At: ${new Date(cancelledAt || Date.now()).toLocaleString()}
    
    Please review and process any necessary refunds.
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
      <title>Order Cancellation - Style & Homes Admin</title>
      ${getEmailStyles()}
    </head>
    <body>
      <div class="email-container">
        <!-- Header -->
        <div class="email-header">
          <div class="brand-logo">STYLE & HOMES</div>
          <div class="brand-tagline">Admin Notification</div>
        </div>
        
        <!-- Main Content -->
        <div class="email-content">
          <div class="content-header">
            <div class="main-subtitle">Order Cancellation</div>
            <div class="subtitle-line"></div>
            <h1 class="main-title">❌ Order Cancelled</h1>
          </div>
          
          <div class="welcome-text">
            An order has been cancelled and may require refund processing.
          </div>
          
          <!-- Cancellation Details -->
          <div class="contact-details">
            <table>
              <tr>
                <td>Order ID:</td>
                <td><span class="contact-id">${orderId}</span></td>
              </tr>
              <tr>
                <td>Invoice #:</td>
                <td>${invoiceNumber || orderId}</td>
              </tr>
              <tr>
                <td>Customer:</td>
                <td>${userName}</td>
              </tr>
              <tr>
                <td>Email:</td>
                <td><a href="mailto:${userEmail}">${userEmail}</a></td>
              </tr>
              <tr>
                <td>Original Amount:</td>
                <td style="color: #c2b280; font-weight: 600;">$${totalAmount}</td>
              </tr>
              ${cancelReason ? `
              <tr>
                <td>Reason:</td>
                <td>${cancelReason}</td>
              </tr>
              ` : ''}
              ${refundAmount ? `
              <tr>
                <td>Refund Amount:</td>
                <td style="color: #28a745; font-weight: 600;">$${refundAmount}</td>
              </tr>
              ` : ''}
              <tr>
                <td>Cancelled At:</td>
                <td>${new Date(cancelledAt || Date.now()).toLocaleString()}</td>
              </tr>
            </table>
          </div>

          ${refundAmount ? `
          <!-- Alert Box -->
          <div class="alert-box">
            <p>⚠️ Refund of $${refundAmount} requires processing</p>
          </div>
          ` : ''}
        </div>
        
        <!-- Footer -->
        <div class="email-footer">
          <div class="footer-brand">STYLE & HOMES</div>
          <div class="footer-tagline">Admin Dashboard</div>
          <div class="footer-contact">
            <a href="https://admin.stylenhomes.com/orders">View in Admin Panel</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject, text, html };
};

/**
 * Send vendor notification email when products are booked
 */
export const sendVendorOrderNotificationEmailTemplate = (vendorName, orderDetails) => {
  const {
    orderId,
    invoiceNumber,
    totalAmount,
    orderItems,
    shippingAddress,
    customerName,
    customerEmail,
    paidAt
  } = orderDetails;

  const text = `
    Hello ${vendorName},
    
    A new order has been placed that includes your products.
    
    Order Details:
    Order ID: ${orderId}
    Invoice Number: ${invoiceNumber || orderId}
    Customer: ${customerName} (${customerEmail})
    Total Order Amount: $${totalAmount}
    Order Date: ${new Date(paidAt).toLocaleDateString()}
    
    Shipping Address:
    ${shippingAddress?.fullName || customerName}
    ${shippingAddress?.street || ''}
    ${shippingAddress?.city || ''}, ${shippingAddress?.state || ''} ${shippingAddress?.zipCode || ''}
    ${shippingAddress?.country || ''}
    
    Please ensure the products are available and ready for fulfillment.
    
    Thank you for your partnership!
    
    Best regards,
    The Style & Homes Team
  `;

  const orderItemsHtml = orderItems?.map(item => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #3a3a3a; color: #cccccc;">
        ${item.name}
        ${item.variationCombinationId ? `<br><small style="color: #888;">Variation: ${item.variationName || 'Custom'}</small>` : ''}
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid #3a3a3a; color: #cccccc; text-align: center;">
        ${item.quantity}
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid #3a3a3a; color: #c2b280; text-align: right;">
        $${(item.price * item.quantity).toFixed(2)}
      </td>
    </tr>
  `).join('') || '';

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
      <title>New Order Notification - Style & Homes</title>
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
            <div class="main-subtitle">Vendor Notification</div>
            <div class="subtitle-line"></div>
            <h1 class="main-title">New Order Placed</h1>
          </div>
          
          <div class="welcome-text">
            Hello <strong>${vendorName}</strong>,<br>
            A new order has been placed that includes your products. Please review the details below.
          </div>
          
          <div class="description-text">
            This order has been confirmed and payment has been processed. Please ensure the products are available and ready for fulfillment.
          </div>
          
          <!-- Order Details -->
          <div class="info-section">
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">Order ID</div>
                <div class="info-value">${orderId}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Invoice Number</div>
                <div class="info-value">${invoiceNumber || orderId}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Customer</div>
                <div class="info-value">${customerName}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Customer Email</div>
                <div class="info-value">${customerEmail}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Order Date</div>
                <div class="info-value">${new Date(paidAt).toLocaleDateString()}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Total Amount</div>
                <div class="info-value">$${totalAmount}</div>
              </div>
            </div>
          </div>
          
          <!-- Shipping Address -->
          <div class="info-section">
            <h3 class="section-title">Shipping Address</h3>
            <div class="address-box">
              <div class="address-line">${shippingAddress?.fullName || customerName}</div>
              <div class="address-line">${shippingAddress?.street || ''}</div>
              <div class="address-line">${shippingAddress?.city || ''}, ${shippingAddress?.state || ''} ${shippingAddress?.zipCode || ''}</div>
              <div class="address-line">${shippingAddress?.country || ''}</div>
            </div>
          </div>
          
          <!-- Order Items -->
          <div class="info-section">
            <h3 class="section-title">Order Items</h3>
            <div class="table-container">
              <table class="order-table">
                <thead>
                  <tr>
                    <th style="text-align: left; padding: 12px 0; border-bottom: 2px solid #c2b280; color: #c2b280;">Product</th>
                    <th style="text-align: center; padding: 12px 0; border-bottom: 2px solid #c2b280; color: #c2b280;">Quantity</th>
                    <th style="text-align: right; padding: 12px 0; border-bottom: 2px solid #c2b280; color: #c2b280;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${orderItemsHtml}
                </tbody>
              </table>
            </div>
          </div>
          
          <div class="action-section">
            <div class="action-text">
              Please ensure all products are available and ready for fulfillment. If there are any issues with availability, please contact us immediately.
            </div>
          </div>
          
          <div class="footer-text">
            Thank you for your partnership with Style & Homes!
          </div>
        </div>
        
        <!-- Footer -->
        <div class="email-footer">
          <div class="footer-content">
            <div class="footer-text">© 2024 Style & Homes. All rights reserved.</div>
            <div class="footer-links">
              <a href="#" style="color: #c2b280; text-decoration: none;">Privacy Policy</a>
              <span style="color: #666; margin: 0 10px;">|</span>
              <a href="#" style="color: #c2b280; text-decoration: none;">Terms of Service</a>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return { text, html };
};