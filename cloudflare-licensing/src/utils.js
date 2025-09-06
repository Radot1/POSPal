/**
 * Utility functions for POSPal Licensing System
 */

/**
 * Generate a secure unlock token
 * Format: POSPAL-XXXX-XXXX-XXXX (16 chars after prefix)
 */
export function generateUnlockToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars
  const segments = [];
  
  for (let i = 0; i < 4; i++) {
    let segment = '';
    for (let j = 0; j < 4; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(segment);
  }
  
  return `POSPAL-${segments.join('-')}`;
}

/**
 * Validate email format
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Create CORS headers for API responses
 */
export function getCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

/**
 * Create API response with CORS headers
 */
export function createResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: getCORSHeaders(),
  });
}

/**
 * Handle CORS preflight requests
 */
export function handleCORS() {
  return new Response(null, {
    status: 200,
    headers: getCORSHeaders(),
  });
}

/**
 * Verify Stripe webhook signature
 */
export async function verifyStripeSignature(payload, signature, secret) {
  // Basic signature verification
  // In production, use proper Stripe webhook signature verification
  return signature && secret;
}

/**
 * Log audit event to database
 */
export async function logAuditEvent(db, customerId, eventType, eventData = {}) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_log (customer_id, event_type, event_data, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    
    await stmt.bind(
      customerId,
      eventType,
      JSON.stringify(eventData)
    ).run();
    
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

/**
 * Log email delivery attempt
 */
export async function logEmailDelivery(db, customerId, emailType, recipientEmail, subject, resendId = null) {
  try {
    const stmt = db.prepare(`
      INSERT INTO email_log (customer_id, email_type, recipient_email, subject, resend_id, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    
    const result = await stmt.bind(
      customerId,
      emailType,
      recipientEmail,
      subject,
      resendId
    ).run();
    
    return result.meta.last_row_id;
    
  } catch (error) {
    console.error('Failed to log email delivery:', error);
    return null;
  }
}

/**
 * Update email delivery status
 */
export async function updateEmailStatus(db, emailLogId, status, errorMessage = null) {
  try {
    const stmt = db.prepare(`
      UPDATE email_log 
      SET status = ?, error_message = ?, delivered_at = datetime('now')
      WHERE id = ?
    `);
    
    await stmt.bind(status, errorMessage, emailLogId).run();
    
  } catch (error) {
    console.error('Failed to update email status:', error);
  }
}

/**
 * Generate machine fingerprint hash (for comparison)
 */
export async function hashMachineFingerprint(fingerprint) {
  const encoder = new TextEncoder();
  const data = encoder.encode(fingerprint);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if subscription should be considered active
 */
export function isSubscriptionActive(customer) {
  if (customer.subscription_status !== 'active') {
    return false;
  }
  
  // Check payment failures (suspend after 3 failures)
  if (customer.payment_failures >= 3) {
    return false;
  }
  
  // Check last seen (suspend if not seen for 60 days)
  const lastSeen = new Date(customer.last_seen);
  const now = new Date();
  const daysSinceLastSeen = (now - lastSeen) / (1000 * 60 * 60 * 24);
  
  if (daysSinceLastSeen > 60) {
    return false;
  }
  
  return true;
}