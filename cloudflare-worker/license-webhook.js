/**
 * POSPal License Generator - Cloudflare Worker
 * Handles Stripe webhooks and generates license.key files
 * Domain: pospal.gr
 */

// Environment variables (set in CF Worker dashboard):
// STRIPE_WEBHOOK_SECRET - Your Stripe webhook signing secret
// POSPAL_SECRET_KEY - License signing key (0x8F3A2B1C9D4E5F6A in hex)
// RESEND_API_KEY - Resend.com API key for email delivery

const STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET; // Set in CF Worker env
const POSPAL_SECRET_KEY = 0x8F3A2B1C9D4E5F6A; // Keep secret!
const RESEND_API_KEY = RESEND_API_KEY; // Set in CF Worker env

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, stripe-signature',
      },
    });
  }
  
  // Stripe webhook endpoint
  if (url.pathname === '/stripe-webhook' && request.method === 'POST') {
    return handleStripeWebhook(request);
  }
  
  // Health check endpoint
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ 
      status: 'ok', 
      service: 'POSPal License Generator',
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  return new Response('POSPal License Generator API', { status: 200 });
}

async function handleStripeWebhook(request) {
  try {
    // Get webhook signature
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      console.error('Missing stripe-signature header');
      return new Response('Missing signature', { status: 400 });
    }
    
    const payload = await request.text();
    
    // Verify webhook signature (simplified - you should use proper Stripe verification)
    // In production, use: stripe.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET)
    
    const event = JSON.parse(payload);
    console.log('Received Stripe event:', event.type);
    
    // Handle subscription creation (first payment)
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      // Only handle subscription checkouts, skip one-time payments
      if (session.mode !== 'subscription') {
        console.log('Skipping non-subscription checkout:', session.mode);
        return new Response('Non-subscription checkout ignored', { status: 200 });
      }
      
      // Extract customer data
      const customerEmail = session.customer_details?.email;
      const hardwareId = session.metadata?.hardware_id;
      const customerName = session.customer_details?.name || 'Customer';
      const subscriptionId = session.subscription;
      
      console.log('Processing subscription license for:', { customerEmail, hardwareId, customerName, subscriptionId });
      
      if (!customerEmail || !hardwareId || !subscriptionId) {
        console.error('Missing required data:', { customerEmail, hardwareId, subscriptionId });
        return new Response('Missing customer data', { status: 400 });
      }
      
      // Validate Hardware ID format (basic check)
      if (!isValidHardwareId(hardwareId)) {
        console.error('Invalid Hardware ID format:', hardwareId);
        await sendErrorEmail(customerEmail, customerName, hardwareId);
        return new Response('Invalid Hardware ID', { status: 400 });
      }
      
      // Generate time-limited license (1 month)
      const license = generateSubscriptionLicense(customerName, hardwareId, subscriptionId);
      
      // Send license via email
      await sendLicenseEmail(customerEmail, customerName, license, hardwareId);
      
      console.log('Subscription license sent successfully to:', customerEmail);
      return new Response('Subscription license generated and sent', { status: 200 });
    }
    
    // Handle successful subscription renewal
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      
      // Only handle subscription invoices
      if (!invoice.subscription) {
        console.log('Skipping non-subscription invoice');
        return new Response('Non-subscription invoice ignored', { status: 200 });
      }
      
      const subscriptionId = invoice.subscription;
      const customerEmail = invoice.customer_email;
      
      console.log('Processing subscription renewal for:', { customerEmail, subscriptionId });
      
      // For renewals, we need to fetch customer metadata from our storage
      // For now, we'll handle this in a future update
      // TODO: Implement customer data storage and retrieval
      
      return new Response('Subscription renewal processed', { status: 200 });
    }
    
    // Handle failed payments
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      
      if (!invoice.subscription) {
        return new Response('Non-subscription invoice ignored', { status: 200 });
      }
      
      const customerEmail = invoice.customer_email;
      console.log('Payment failed for:', { customerEmail, subscription: invoice.subscription });
      
      // TODO: Send payment failure email and handle grace period
      
      return new Response('Payment failure processed', { status: 200 });
    }
    
    // Other webhook events
    return new Response('Event received', { status: 200 });
    
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Webhook error: ' + error.message, { status: 500 });
  }
}

function generateSubscriptionLicense(customerName, hardwareId, subscriptionId) {
  // Generate signature using same method as POSPal app
  const data = `${hardwareId}${POSPAL_SECRET_KEY}`;
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  
  // Generate SHA256 hash (sync version for CF Worker)
  const signature = sha256(dataBuffer);
  
  // Calculate expiration date (1 month from now)
  const now = new Date();
  const validUntil = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  
  return {
    customer: customerName,
    hardware_id: hardwareId,
    subscription_id: subscriptionId,
    signature: signature,
    generated_at: now.toISOString(),
    valid_until: validUntil.toISOString().split('T')[0], // YYYY-MM-DD format
    license_type: "subscription",
    version: "1.2.0"
  };
}

// Legacy function for backward compatibility
function generateLicense(customerName, hardwareId) {
  // For one-time purchases, generate permanent license
  const data = `${hardwareId}${POSPAL_SECRET_KEY}`;
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  
  const signature = sha256(dataBuffer);
  
  return {
    customer: customerName,
    hardware_id: hardwareId,
    signature: signature,
    generated_at: new Date().toISOString(),
    license_type: "full",
    version: "1.2.0"
  };
}

// Simple SHA256 implementation for CF Workers
function sha256(buffer) {
  // Note: In production, use crypto.subtle.digest('SHA-256', buffer)
  // This is a simplified sync version - replace with proper async crypto
  
  // For now, return a mock signature - REPLACE WITH REAL SHA256
  // This needs to match exactly what your POSPal app expects
  const hardwareId = new TextDecoder().decode(buffer).split(POSPAL_SECRET_KEY)[0];
  
  // Mock signature generation - REPLACE THIS
  let hash = 0;
  const str = hardwareId + POSPAL_SECRET_KEY.toString();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Convert to hex (this is NOT real SHA256 - just for demo)
  return Math.abs(hash).toString(16).padStart(64, '0');
}

function isValidHardwareId(hardwareId) {
  // Validate enhanced hardware ID format
  // Should be like: "mac:cpu:disk:winid" or similar
  if (!hardwareId || hardwareId.length < 10) return false;
  
  // Basic format check - adjust based on your actual format
  const parts = hardwareId.split(':');
  return parts.length >= 4; // Expecting at least 4 components
}

async function sendLicenseEmail(email, customerName, license, hardwareId) {
  try {
    const licenseJson = JSON.stringify(license, null, 2);
    
    const emailData = {
      from: 'POSPal <noreply@pospal.gr>',
      to: email,
      subject: 'Your POSPal License - Ready to Activate!',
      html: generateEmailHTML(customerName, hardwareId),
      attachments: [
        {
          filename: 'license.key',
          content: btoa(licenseJson), // Base64 encode
          contentType: 'application/json',
        },
      ],
    };
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Resend API error:', error);
      throw new Error('Failed to send email: ' + error);
    }
    
    const result = await response.json();
    console.log('Email sent successfully:', result.id);
    
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
}

async function sendErrorEmail(email, customerName, hardwareId) {
  try {
    const emailData = {
      from: 'POSPal Support <support@pospal.gr>',
      to: email,
      subject: 'POSPal License - Hardware ID Issue',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">Hardware ID Issue</h2>
          <p>Dear ${customerName},</p>
          <p>We received your payment, but there was an issue with the Hardware ID format:</p>
          <p><code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px;">${hardwareId}</code></p>
          
          <h3>How to get your correct Hardware ID:</h3>
          <ol>
            <li>Open POSPal application</li>
            <li>Go to Management → License Information</li>
            <li>Copy the Hardware ID displayed there</li>
          </ol>
          
          <p>Please reply to this email with your correct Hardware ID, and we'll send your license immediately.</p>
          
          <p>Best regards,<br>POSPal Support Team</p>
        </div>
      `,
    };
    
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });
    
  } catch (error) {
    console.error('Failed to send error email:', error);
  }
}

function generateEmailHTML(customerName, hardwareId) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #16a34a; margin: 0;">POSPal License Activated!</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Your restaurant POS system is ready</p>
      </div>
      
      <div style="background: #f0fdf4; border: 1px solid #16a34a; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #15803d; margin: 0 0 10px 0;">✅ ${license.license_type === 'subscription' ? 'Subscription Active' : 'Payment Successful'}</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, your POSPal ${license.license_type === 'subscription' ? 'subscription' : 'license'} has been activated and is attached to this email.</p>
        ${license.valid_until ? `<p style="margin: 10px 0 0 0; color: #374151; font-weight: 500;">Your subscription is active until ${new Date(license.valid_until).toLocaleDateString()}. It will automatically renew monthly.</p>` : ''}
      </div>
      
      <h3 style="color: #374151;">📦 License Details</h3>
      <ul style="color: #6b7280;">
        <li><strong>Customer:</strong> ${customerName}</li>
        <li><strong>Hardware ID:</strong> <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${hardwareId}</code></li>
        <li><strong>License Type:</strong> ${license.license_type === 'subscription' ? 'Monthly Subscription' : 'Full Version'}</li>
        <li><strong>Generated:</strong> ${new Date().toLocaleDateString()}</li>
        ${license.valid_until ? `<li><strong>Valid Until:</strong> ${new Date(license.valid_until).toLocaleDateString()}</li>` : ''}
      </ul>
      
      <h3 style="color: #374151;">🚀 How to Activate</h3>
      <ol style="color: #6b7280; line-height: 1.6;">
        <li><strong>Download</strong> the attached <code>license.key</code> file</li>
        <li><strong>Close</strong> POSPal application if it's running</li>
        <li><strong>Copy</strong> <code>license.key</code> to the same folder as <code>POSPal.exe</code></li>
        <li><strong>Restart</strong> POSPal - you should see "Licensed" status</li>
      </ol>
      
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #92400e; margin: 0 0 10px 0;">⚠️ Important Notes</h4>
        <ul style="color: #92400e; margin: 0; padding-left: 20px;">
          <li>This license is tied to your specific computer hardware</li>
          <li>Keep the license.key file safe - you'll need it if you reinstall</li>
          <li>Contact support if you need to transfer to a new computer</li>
        </ul>
      </div>
      
      <div style="text-align: center; margin: 30px 0; padding: 20px; background: #f9fafb; border-radius: 8px;">
        <h3 style="color: #374151; margin: 0 0 10px 0;">Need Help?</h3>
        <p style="color: #6b7280; margin: 0 0 15px 0;">Our support team is here to help with setup and troubleshooting</p>
        <a href="mailto:support@pospal.gr" style="background: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">Contact Support</a>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          Thank you for choosing POSPal!<br>
          <a href="https://pospal.gr" style="color: #16a34a;">pospal.gr</a> • Modern Point of Sale System
        </p>
      </div>
    </div>
  `;
}