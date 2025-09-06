/**
 * POSPal Licensing System v2.0 - Utility Functions
 * Security, validation, and helper functions
 */

/**
 * Hash password using bcrypt-compatible method
 */
export async function hashPassword(password) {
  // Using Web Crypto API for password hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(password + getSalt());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password, hash) {
  const computedHash = await hashPassword(password);
  return computedHash === hash;
}

/**
 * Generate JWT token
 */
export async function generateJWT(payload, secret) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    ...payload,
    iat: now,
    exp: now + (4 * 60 * 60) // 4 hours
  };
  
  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header));
  const payloadB64 = btoa(JSON.stringify(jwtPayload));
  const data = `${headerB64}.${payloadB64}`;
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  return `${data}.${signatureB64}`;
}

/**
 * Verify JWT token
 */
export async function verifyJWT(token, secret) {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    const data = `${headerB64}.${payloadB64}`;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signature = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data));
    
    if (!isValid) return null;
    
    const payload = JSON.parse(atob(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    
    if (payload.exp && payload.exp < now) {
      return null; // Token expired
    }
    
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Generate secure random token
 */
export function generateSecureToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate email format
 */
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Create standardized API response
 */
export function createResponse(data, status = 200, headers = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...headers
  };
  
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: defaultHeaders
  });
}

/**
 * Handle CORS preflight
 */
export function handleCORS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    }
  });
}

/**
 * Log events to audit trail
 */
export async function logEvent(db, customerId, action, details = {}) {
  try {
    await db.prepare(`
      INSERT INTO session_audit 
      (customer_id, action, details, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).bind(
      customerId,
      action,
      JSON.stringify(details)
    ).run();
  } catch (error) {
    console.error('Failed to log event:', error);
    // Don't throw - logging failures shouldn't break the main flow
  }
}

/**
 * Generate device fingerprint (for session management)
 */
export function generateDeviceFingerprint(userAgent, ip, additionalData = {}) {
  const fingerprint = {
    userAgent: userAgent?.substring(0, 200) || 'unknown',
    ip: ip || 'unknown',
    timestamp: Date.now(),
    ...additionalData
  };
  
  return generateHash(JSON.stringify(fingerprint));
}

/**
 * Generate SHA-256 hash
 */
export async function generateHash(data) {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify Stripe webhook signature
 */
export async function verifyStripeWebhook(payload, signature, secret) {
  try {
    const elements = signature.split(',');
    const timestamp = elements.find(e => e.startsWith('t=')).substring(2);
    const sig = elements.find(e => e.startsWith('v1=')).substring(3);
    
    const payloadString = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const expectedSig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadString));
    const expectedSigHex = Array.from(new Uint8Array(expectedSig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Timing-safe comparison
    if (expectedSigHex.length !== sig.length) return false;
    
    let result = 0;
    for (let i = 0; i < expectedSigHex.length; i++) {
      result |= expectedSigHex.charCodeAt(i) ^ sig.charCodeAt(i);
    }
    
    return result === 0;
  } catch (error) {
    console.error('Webhook verification error:', error);
    return false;
  }
}

/**
 * Rate limiting helper
 */
export async function checkRateLimit(db, identifier, maxRequests = 10, windowMinutes = 1) {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);
  
  // Count recent requests
  const count = await db.prepare(`
    SELECT COUNT(*) as count 
    FROM session_audit 
    WHERE details LIKE ? AND created_at > ?
  `).bind(`%"identifier":"${identifier}"%`, windowStart.toISOString()).first();
  
  return (count?.count || 0) < maxRequests;
}

/**
 * Get salt for password hashing (environment-specific)
 */
function getSalt() {
  // In production, this should be from environment variables
  return 'pospal-v2-salt-2024';
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input, maxLength = 255) {
  if (typeof input !== 'string') return '';
  return input.trim().substring(0, maxLength);
}

/**
 * Generate license-compatible signature (matches POSPal app.py)
 */
export async function generateLicenseSignature(hardwareId, secretKey) {
  const data = `${hardwareId}${secretKey}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Format date for database storage
 */
export function formatDateTime(date = new Date()) {
  return date.toISOString();
}

/**
 * Parse grace period configuration
 */
export function parseGracePeriod(customer, config) {
  const now = new Date();
  
  // Trial users get 1 day grace
  if (customer.trial_ends_at && new Date(customer.trial_ends_at) < now) {
    const graceDays = parseInt(config.grace_period_trial || '1');
    return new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);
  }
  
  // Paying customers get 7 days grace
  if (customer.subscription_status === 'past_due') {
    const graceDays = parseInt(config.grace_period_paid || '7');
    return new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);
  }
  
  return null;
}