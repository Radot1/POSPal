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
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
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
 * Enhanced error response with detailed error information
 */
export function createErrorResponse(error, status = 500, details = {}) {
  return new Response(JSON.stringify({
    success: false,
    error: typeof error === 'string' ? error : error.message,
    errorCode: details.code || 'UNKNOWN_ERROR',
    timestamp: new Date().toISOString(),
    ...details
  }), {
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
      INSERT INTO audit_log (customer_id, action, metadata, created_at)
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
 * Enhanced for hybrid validation with detailed status information
 */
export function isSubscriptionActive(customer) {
  // Only check subscription status - no payment failure grace period
  // This ensures immediate suspension/reactivation based on payment status
  return customer.subscription_status === 'active';
}

/**
 * Get detailed subscription status for hybrid validation
 * Provides comprehensive status information for local caching decisions
 */
export function getDetailedSubscriptionStatus(customer) {
  const now = new Date();
  const lastSeen = customer.last_seen ? new Date(customer.last_seen) : null;
  const lastValidation = customer.last_validation ? new Date(customer.last_validation) : null;
  
  return {
    isActive: customer.subscription_status === 'active',
    status: customer.subscription_status,
    subscriptionId: customer.subscription_id,
    lastSeen: lastSeen ? lastSeen.toISOString() : null,
    lastValidation: lastValidation ? lastValidation.toISOString() : null,
    daysSinceLastSeen: lastSeen ? Math.floor((now - lastSeen) / (1000 * 60 * 60 * 24)) : null,
    hoursSinceLastValidation: lastValidation ? Math.floor((now - lastValidation) / (1000 * 60 * 60)) : null,
    validationRecommendation: getValidationRecommendation(customer, now)
  };
}

/**
 * Determine validation frequency recommendation based on subscription status
 */
function getValidationRecommendation(customer, now) {
  if (customer.subscription_status !== 'active') {
    return 'frequent'; // Check every startup for inactive subscriptions
  }
  
  const lastValidation = customer.last_validation ? new Date(customer.last_validation) : null;
  if (!lastValidation) {
    return 'immediate'; // No previous validation
  }
  
  const hoursSinceValidation = Math.floor((now - lastValidation) / (1000 * 60 * 60));
  
  if (hoursSinceValidation < 1) {
    return 'cached'; // Use local cache for < 1 hour
  } else if (hoursSinceValidation < 24) {
    return 'periodic'; // Check every few hours
  } else {
    return 'immediate'; // Force validation for > 24 hours
  }
}

/**
 * Create optimized response for validation endpoints
 * Includes caching headers and performance metadata
 */
export function createValidationResponse(data, cacheSeconds = 300) {
  const headers = {
    ...getCORSHeaders(),
    'Cache-Control': `private, max-age=${cacheSeconds}`,
    'X-Validation-Timestamp': new Date().toISOString(),
    'X-Cache-Duration': cacheSeconds.toString()
  };
  
  return new Response(JSON.stringify({
    ...data,
    validatedAt: new Date().toISOString(),
    cacheUntil: new Date(Date.now() + cacheSeconds * 1000).toISOString()
  }), {
    status: 200,
    headers
  });
}

/**
 * Performance-optimized customer lookup for validation
 * Uses indexed queries and minimal data retrieval
 */
export async function getCustomerForValidation(db, email, token) {
  try {
    // Use indexed lookup with minimal field selection for performance
    const customer = await db.prepare(`
      SELECT id, email, unlock_token, subscription_status, subscription_id, 
             machine_fingerprint, last_seen, last_validation, created_at
      FROM customers 
      WHERE email = ? AND unlock_token = ?
      LIMIT 1
    `).bind(email, token).first();
    
    return customer;
  } catch (error) {
    console.error('Customer lookup error:', error);
    return null;
  }
}

/**
 * Log validation event with performance metrics
 */
export async function logValidationEvent(db, customerId, validationType, metrics = {}, eventData = {}) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_log (customer_id, action, metadata, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    
    const metadata = {
      validationType,
      metrics: {
        responseTime: metrics.responseTime || 0,
        cacheHit: metrics.cacheHit || false,
        ...metrics
      },
      ...eventData
    };
    
    await stmt.bind(
      customerId,
      `validation_${validationType}`,
      JSON.stringify(metadata)
    ).run();
    
  } catch (error) {
    console.error('Failed to log validation event:', error);
  }
}

/**
 * Rate limiting configuration for license recovery
 */
const RATE_LIMITS = {
  // Per IP address limits
  EMAIL_RECOVERY_PER_IP_HOURLY: 5,    // Max 5 recovery attempts per IP per hour
  EMAIL_RECOVERY_PER_IP_DAILY: 20,     // Max 20 recovery attempts per IP per day
  
  // Per email address limits
  EMAIL_RECOVERY_PER_EMAIL_HOURLY: 3,  // Max 3 recovery attempts per email per hour
  EMAIL_RECOVERY_PER_EMAIL_DAILY: 10,  // Max 10 recovery attempts per email per day
  
  // Combined IP+email limits (stricter)
  EMAIL_RECOVERY_PER_COMBO_HOURLY: 2,  // Max 2 attempts per IP+email combo per hour
  EMAIL_RECOVERY_PER_COMBO_DAILY: 5,   // Max 5 attempts per IP+email combo per day
  
  // Temporary block duration after limits exceeded (in minutes)
  TEMPORARY_BLOCK_DURATION: 10         // Block for 10 minutes after limit exceeded
};

/**
 * Check if a recovery request should be rate limited
 */
export async function checkRateLimit(db, ip, email) {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const limits = [
    {
      identifier: ip,
      type: 'email_recovery_per_ip',
      hourlyLimit: RATE_LIMITS.EMAIL_RECOVERY_PER_IP_HOURLY,
      dailyLimit: RATE_LIMITS.EMAIL_RECOVERY_PER_IP_DAILY
    },
    {
      identifier: email.toLowerCase(),
      type: 'email_recovery_per_email',
      hourlyLimit: RATE_LIMITS.EMAIL_RECOVERY_PER_EMAIL_HOURLY,
      dailyLimit: RATE_LIMITS.EMAIL_RECOVERY_PER_EMAIL_DAILY
    },
    {
      identifier: `${ip}:${email.toLowerCase()}`,
      type: 'email_recovery_per_combo',
      hourlyLimit: RATE_LIMITS.EMAIL_RECOVERY_PER_COMBO_HOURLY,
      dailyLimit: RATE_LIMITS.EMAIL_RECOVERY_PER_COMBO_DAILY
    }
  ];
  
  for (const limit of limits) {
    // Check if currently blocked
    const blocked = await db.prepare(`
      SELECT blocked_until FROM rate_limits 
      WHERE identifier = ? AND limit_type = ? AND blocked_until > datetime('now')
    `).bind(limit.identifier, limit.type).first();
    
    if (blocked) {
      return {
        allowed: false,
        reason: 'temporarily_blocked',
        blockedUntil: blocked.blocked_until,
        message: `Temporarily blocked due to too many recovery attempts. Try again after ${blocked.blocked_until}.`
      };
    }
    
    // Check hourly and daily limits
    const hourlyCount = await db.prepare(`
      SELECT COUNT(*) as count FROM recovery_attempts 
      WHERE ${limit.type === 'email_recovery_per_ip' ? 'ip_address' : 
               limit.type === 'email_recovery_per_email' ? 'email' : 
               'ip_address || ":" || email'} = ? 
      AND created_at > datetime('now', '-1 hour')
    `).bind(limit.identifier).first();
    
    const dailyCount = await db.prepare(`
      SELECT COUNT(*) as count FROM recovery_attempts 
      WHERE ${limit.type === 'email_recovery_per_ip' ? 'ip_address' : 
               limit.type === 'email_recovery_per_email' ? 'email' : 
               'ip_address || ":" || email'} = ? 
      AND created_at > datetime('now', '-24 hours')
    `).bind(limit.identifier).first();
    
    if (hourlyCount?.count >= limit.hourlyLimit || dailyCount?.count >= limit.dailyLimit) {
      // Set temporary block
      const blockUntil = new Date(now.getTime() + RATE_LIMITS.TEMPORARY_BLOCK_DURATION * 60 * 1000);
      
      await db.prepare(`
        INSERT OR REPLACE INTO rate_limits 
        (identifier, limit_type, attempt_count, first_attempt, last_attempt, reset_after, blocked_until, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'), datetime('now', '+24 hours'), ?, datetime('now'))
      `).bind(
        limit.identifier, 
        limit.type, 
        Math.max(hourlyCount?.count || 0, dailyCount?.count || 0),
        blockUntil.toISOString()
      ).run();
      
      return {
        allowed: false,
        reason: 'rate_limit_exceeded',
        limitType: limit.type,
        blockedUntil: blockUntil.toISOString(),
        message: `Rate limit exceeded for ${limit.type}. Temporarily blocked until ${blockUntil.toLocaleString()}.`
      };
    }
  }
  
  return { allowed: true };
}

/**
 * Log a recovery attempt to the database
 */
export async function logRecoveryAttempt(db, email, ip, userAgent, success, customerId = null, securityFlags = {}) {
  try {
    const stmt = db.prepare(`
      INSERT INTO recovery_attempts 
      (email, ip_address, user_agent, success, customer_id, recovery_type, security_flags, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    
    const result = await stmt.bind(
      email.toLowerCase(),
      ip,
      userAgent,
      success,
      customerId,
      'email_recovery',
      JSON.stringify(securityFlags)
    ).run();
    
    return result.meta.last_row_id;
    
  } catch (error) {
    console.error('Failed to log recovery attempt:', error);
    return null;
  }
}

/**
 * Analyze security indicators for recovery request
 */
export function analyzeSecurityIndicators(request, email, customer) {
  const flags = {
    timestamp: new Date().toISOString(),
    email: email.toLowerCase(),
    ip: request.headers.get('cf-connecting-ip') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
    country: request.headers.get('cf-ipcountry') || 'unknown',
    securityLevel: 'normal'
  };
  
  // Check for suspicious patterns
  if (!customer) {
    flags.securityLevel = 'high';
    flags.reason = 'email_not_found';
  } else {
    // Check if customer has been recently active
    const lastSeen = customer.last_seen ? new Date(customer.last_seen) : null;
    const daysSinceLastSeen = lastSeen ? 
      (new Date() - lastSeen) / (1000 * 60 * 60 * 24) : null;
    
    if (daysSinceLastSeen && daysSinceLastSeen > 30) {
      flags.securityLevel = 'medium';
      flags.reason = 'long_inactive';
      flags.daysSinceLastSeen = Math.floor(daysSinceLastSeen);
    }
    
    if (customer.subscription_status !== 'active') {
      flags.securityLevel = 'medium';
      flags.reason = 'inactive_subscription';
      flags.subscriptionStatus = customer.subscription_status;
    }
  }
  
  return flags;
}

/**
 * Batch validation utility for multiple license checks
 */
export async function validateMultipleLicenses(db, validationRequests) {
  const results = [];
  const startTime = Date.now();
  
  try {
    // Process validations in parallel with limited concurrency
    const batchSize = 10; // Process max 10 validations concurrently
    
    for (let i = 0; i < validationRequests.length; i += batchSize) {
      const batch = validationRequests.slice(i, i + batchSize);
      const batchPromises = batch.map(async (request, index) => {
        const requestStart = Date.now();
        
        try {
          const customer = await getCustomerForValidation(db, request.email, request.token);
          
          if (!customer) {
            return {
              index: i + index,
              email: request.email,
              valid: false,
              error: 'Invalid email or unlock token',
              responseTime: Date.now() - requestStart
            };
          }
          
          const detailedStatus = getDetailedSubscriptionStatus(customer);
          
          return {
            index: i + index,
            email: request.email,
            valid: detailedStatus.isActive,
            customer: {
              id: customer.id,
              email: customer.email,
              subscriptionStatus: customer.subscription_status
            },
            subscriptionInfo: detailedStatus,
            responseTime: Date.now() - requestStart
          };
          
        } catch (error) {
          return {
            index: i + index,
            email: request.email,
            valid: false,
            error: 'Validation failed',
            responseTime: Date.now() - requestStart
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    // Sort results by original index to maintain order
    results.sort((a, b) => a.index - b.index);
    
    return {
      success: true,
      results: results.map(r => ({ ...r, index: undefined })), // Remove index from final results
      metadata: {
        totalRequests: validationRequests.length,
        totalTime: Date.now() - startTime,
        averageTime: (Date.now() - startTime) / validationRequests.length
      }
    };
    
  } catch (error) {
    console.error('Batch validation error:', error);
    return {
      success: false,
      error: 'Batch validation failed',
      results: [],
      metadata: {
        totalRequests: validationRequests.length,
        totalTime: Date.now() - startTime
      }
    };
  }
}

/**
 * Network timeout and retry configuration
 */
const NETWORK_CONFIG = {
  DEFAULT_TIMEOUT: 10000, // 10 seconds
  VALIDATION_TIMEOUT: 5000, // 5 seconds for validation endpoints
  BATCH_TIMEOUT: 30000, // 30 seconds for batch operations
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
  EXPONENTIAL_BACKOFF: true
};

/**
 * Create timeout-aware fetch wrapper
 */
export async function timeoutFetch(url, options = {}, timeoutMs = NETWORK_CONFIG.DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Retry wrapper with exponential backoff
 */
export async function retryOperation(operation, maxRetries = NETWORK_CONFIG.MAX_RETRIES, baseDelay = NETWORK_CONFIG.RETRY_DELAY) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        break; // Don't delay on the last attempt
      }
      
      const delay = NETWORK_CONFIG.EXPONENTIAL_BACKOFF 
        ? baseDelay * Math.pow(2, attempt)
        : baseDelay;
      
      console.warn(`Operation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Database operation with timeout and retry
 */
export async function executeDbOperation(db, operation, timeoutMs = 5000) {
  return retryOperation(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const result = await operation(db);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (controller.signal.aborted) {
        throw new Error(`Database operation timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  }, 2); // Retry database operations up to 2 times
}

/**
 * Graceful degradation response for offline scenarios
 */
export function createOfflineResponse(lastKnownStatus = null, cacheData = null) {
  return new Response(JSON.stringify({
    success: false,
    offline: true,
    error: 'Service temporarily unavailable',
    errorCode: 'SERVICE_OFFLINE',
    timestamp: new Date().toISOString(),
    fallbackData: {
      lastKnownStatus,
      cacheData,
      recommendation: 'Use local validation cache if available'
    },
    retryAfter: 30 // Suggest retry after 30 seconds
  }), {
    status: 503, // Service Unavailable
    headers: {
      ...getCORSHeaders(),
      'Retry-After': '30'
    }
  });
}

/**
 * Health check utilities for monitoring
 */
export async function performHealthCheck(db) {
  const startTime = Date.now();
  const healthData = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    services: {},
    performance: {}
  };
  
  try {
    // Database health check
    const dbStart = Date.now();
    await db.prepare('SELECT 1 as test').first();
    healthData.services.database = {
      status: 'healthy',
      responseTime: Date.now() - dbStart
    };
  } catch (error) {
    healthData.services.database = {
      status: 'unhealthy',
      error: error.message,
      responseTime: Date.now() - dbStart
    };
    healthData.status = 'degraded';
  }
  
  // Overall performance metrics
  healthData.performance.totalTime = Date.now() - startTime;
  
  return healthData;
}

/**
 * Circuit breaker pattern implementation
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 10000; // 10 seconds
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
  }
  
  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
    }
  }
  
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt
    };
  }
}

// Global circuit breaker instance for database operations
export const dbCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  monitoringPeriod: 10000 // 10 seconds
});