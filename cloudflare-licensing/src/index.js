/**
 * POSPal Email + Token Licensing System
 * Cloudflare Worker for webhook handling and license validation
 */

import { 
  generateUnlockToken, 
  isValidEmail, 
  createResponse, 
  createErrorResponse,
  createValidationResponse,
  createOfflineResponse,
  handleCORS, 
  getCORSHeaders,
  logAuditEvent,
  logEmailDelivery,
  updateEmailStatus,
  hashMachineFingerprint,
  isSubscriptionActive,
  getDetailedSubscriptionStatus,
  getCustomerForValidation,
  logValidationEvent,
  validateMultipleLicenses,
  executeDbOperation,
  performHealthCheck,
  dbCircuitBreaker,
  retryOperation,
} from './utils.js';

import {
  getWelcomeEmailTemplate,
  getPaymentFailureEmailTemplate,
  getImmediateSuspensionEmailTemplate,
  getImmediateReactivationEmailTemplate,
  getRenewalReminderEmailTemplate,
  getMachineSwitchEmailTemplate,
  getLicenseDisconnectionEmailTemplate
} from './email-templates.js';

/**
 * Create Stripe API helper for webhook handlers
 */
function createStripeHelper(env) {
  return {
    async get(url) {
      const response = await fetch(`https://api.stripe.com/v1${url}`, {
        headers: {
          'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        }
      });
      return response.json();
    },
    async post(url, data) {
      const response = await fetch(`https://api.stripe.com/v1${url}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(data).toString(),
      });
      return response.json();
    }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }
    
    // Route requests
    switch (url.pathname) {
      case '/webhook':
        return handleStripeWebhook(request, env);
      case '/test-webhook':
        return handleTestWebhook(request, env);
      case '/validate-unified':
        return handleUnifiedValidation(request, env);
      case '/validate':
        return handleLicenseValidation(request, env);
      case '/instant-validate':
        return handleInstantValidation(request, env);
      case '/fix-billing-dates':
        return await fixCustomerBillingDates(env);
      case '/session/start':
        return handleSessionStart(request, env);
      case '/session/heartbeat':
        return handleSessionHeartbeat(request, env);
      case '/session/end':
        return handleSessionEnd(request, env);
      case '/session/takeover':
        return handleSessionTakeover(request, env);
      case '/create-checkout-session':
        return handleCreateCheckoutSession(request, env);
      case '/customer-portal':
        return handleCustomerPortal(request, env);
      case '/create-portal-session':
        return handleCreatePortalSession(request, env);
      case '/check-duplicate':
        return handleCheckDuplicate(request, env);
      case '/recover-license':
        return handleRecoverLicense(request, env);
      case '/health':
        return handleHealthCheck(request, env);
      default:
        return createResponse({ error: 'Not found' }, 404);
    }
  }
};

/**
 * Handle unified validation requests (consolidates /validate, /instant-validate, /session/*)
 */
async function handleUnifiedValidation(request, env) {
  const startTime = Date.now();
  let requestData;
  
  try {
    requestData = await request.json();
    
    // Validate request structure
    const validationResult = validateUnifiedRequestStructure(requestData);
    if (!validationResult.valid) {
      return createUnifiedErrorResponse('INVALID_REQUEST_FORMAT', validationResult.errors, 400, {
        responseTime: Date.now() - startTime
      });
    }
    
    // Route based on operation type
    switch (requestData.operation) {
      case 'validate':
        return await handleUnifiedStandardValidation(requestData, env, startTime);
      case 'instant':
        return await handleUnifiedInstantValidation(requestData, env, startTime);
      case 'session':
        return await handleUnifiedSessionOperation(requestData, env, startTime);
      default:
        return createUnifiedErrorResponse('UNSUPPORTED_OPERATION', `Operation '${requestData.operation}' not supported`, 400, {
          responseTime: Date.now() - startTime
        });
    }
    
  } catch (error) {
    console.error('Unified validation error:', error);
    return createUnifiedErrorResponse('REQUEST_PROCESSING_ERROR', error.message, 500, {
      responseTime: Date.now() - startTime,
      errorDetails: error.stack
    });
  }
}

/**
 * Validate unified request structure
 */
function validateUnifiedRequestStructure(requestData) {
  const errors = [];
  
  if (!requestData.operation) {
    errors.push('Missing required field: operation');
  } else if (!['validate', 'instant', 'session'].includes(requestData.operation)) {
    errors.push('Invalid operation type. Must be: validate, instant, or session');
  }
  
  if (!requestData.credentials) {
    errors.push('Missing required field: credentials');
  } else {
    if (!requestData.credentials.email) {
      errors.push('Missing required field: credentials.email');
    }
    if (!requestData.credentials.token && requestData.operation !== 'instant') {
      errors.push('Missing required field: credentials.token');
    }
  }
  
  if (requestData.operation === 'session' && !requestData.action) {
    errors.push('Missing required field: action for session operation');
  }
  
  if (requestData.operation === 'instant' && !requestData.credentials.stripeSessionId) {
    errors.push('Missing required field: credentials.stripeSessionId for instant validation');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Handle unified standard validation
 */
async function handleUnifiedStandardValidation(requestData, env, startTime) {
  const { credentials, device, options = {} } = requestData;
  
  try {
    // Performance-optimized customer lookup with circuit breaker protection
    const customer = await dbCircuitBreaker.execute(async () => {
      return await getCustomerForValidation(env.DB, credentials.email, credentials.token);
    });
    
    if (!customer) {
      return createUnifiedErrorResponse('INVALID_CREDENTIALS', 'Invalid email or unlock token', 401, {
        responseTime: Date.now() - startTime,
        validationType: 'standard'
      });
    }
    
    // Get detailed subscription status
    const subscriptionStatus = getDetailedSubscriptionStatus(customer);
    
    if (!subscriptionStatus.isActive) {
      // Log validation attempt for inactive subscription
      await logValidationEvent(env.DB, customer.id, 'inactive_validation_unified', {
        responseTime: Date.now() - startTime,
        operation: 'validate'
      }, {
        subscriptionStatus: customer.subscription_status,
        daysSinceLastSeen: subscriptionStatus.daysSinceLastSeen
      });
      
      return createUnifiedErrorResponse('SUBSCRIPTION_INACTIVE', 'Subscription is not active', 403, {
        responseTime: Date.now() - startTime,
        subscriptionInfo: subscriptionStatus,
        supportActions: {
          portalUrl: await generateCustomerPortalUrl(customer.stripe_customer_id, env),
          contactSupport: true
        }
      });
    }
    
    let sessionInfo = { allowed: true, sessionId: null, machineChanged: false };
    
    // Handle machine fingerprint and session management
    if (device && device.machineFingerprint && !device.skipMachineUpdate) {
      const hashedFingerprint = await hashMachineFingerprint(device.machineFingerprint);
      const machineChanged = customer.machine_fingerprint && 
                            customer.machine_fingerprint !== hashedFingerprint;
      
      // Update customer with new machine fingerprint and validation timestamp
      await dbCircuitBreaker.execute(async () => {
        return await env.DB.prepare(`
          UPDATE customers 
          SET machine_fingerprint = ?, last_seen = datetime('now'), last_validation = datetime('now')
          WHERE id = ?
        `).bind(hashedFingerprint, customer.id).run();
      });
      
      sessionInfo.machineChanged = machineChanged;
      sessionInfo.deviceInfo = {
        current: device.deviceInfo?.hostname || 'Unknown Device',
        registered: new Date().toISOString()
      };
      
      // Send machine switch notification if needed
      if (machineChanged) {
        await sendMachineSwitchEmail(env, customer.id, customer.email, customer.name || 'Customer');
      }
    } else {
      // Just update validation timestamp
      await env.DB.prepare(`
        UPDATE customers 
        SET last_seen = datetime('now'), last_validation = datetime('now')
        WHERE id = ?
      `).bind(customer.id).run();
    }
    
    // Determine caching strategy
    const cacheStrategy = determineUnifiedCacheStrategy(customer, subscriptionStatus);
    
    // Log successful validation
    await logValidationEvent(env.DB, customer.id, 'successful_validation_unified', {
      responseTime: Date.now() - startTime,
      operation: 'validate',
      machineChanged: sessionInfo.machineChanged,
      cacheStrategy: cacheStrategy.strategy
    }, {
      machineChanged: sessionInfo.machineChanged,
      validationRecommendation: subscriptionStatus.validationRecommendation
    });
    
    console.log(`Unified validation successful for ${credentials.email} in ${Date.now() - startTime}ms`);
    
    return createUnifiedResponse({
      validation: {
        valid: true,
        status: 'active',
        validationType: 'standard',
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name || customer.email.split('@')[0]
        }
      },
      subscription: {
        status: subscriptionStatus.status,
        id: customer.subscription_id,
        isActive: subscriptionStatus.isActive,
        currentPeriodEnd: subscriptionStatus.currentPeriodEnd,
        nextBillingDate: subscriptionStatus.nextBillingDate,
        daysRemaining: subscriptionStatus.daysRemaining
      },
      session: sessionInfo,
      caching: cacheStrategy,
      performance: {
        responseTime: Date.now() - startTime,
        databaseQueries: 2,
        cacheHit: false,
        circuitBreakerState: dbCircuitBreaker.getState().state
      }
    }, cacheStrategy.duration);
    
  } catch (error) {
    console.error('Unified standard validation error:', error);
    return createUnifiedErrorResponse('VALIDATION_ERROR', 'Validation failed', 500, {
      responseTime: Date.now() - startTime,
      operation: 'validate'
    });
  }
}

/**
 * Handle unified instant validation (post-payment)
 */
async function handleUnifiedInstantValidation(requestData, env, startTime) {
  const { credentials, device, options = {} } = requestData;
  
  try {
    if (!credentials.email || !credentials.stripeSessionId || !device?.machineFingerprint) {
      return createUnifiedErrorResponse('MISSING_REQUIRED_FIELDS', 'Email, stripeSessionId, and machineFingerprint are required', 400, {
        responseTime: Date.now() - startTime
      });
    }
    
    // Look up customer by email and verify recent payment
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND stripe_session_id = ? AND subscription_status = 'active'
    `).bind(credentials.email, credentials.stripeSessionId).first();
    
    if (!customer) {
      return createUnifiedErrorResponse('NO_VALID_SUBSCRIPTION', 'No valid subscription found for this payment session', 404, {
        responseTime: Date.now() - startTime,
        validationType: 'instant'
      });
    }
    
    // Get detailed subscription status
    const subscriptionStatus = getDetailedSubscriptionStatus(customer);
    
    // Hash and update machine fingerprint
    const hashedFingerprint = await hashMachineFingerprint(device.machineFingerprint);
    
    await env.DB.prepare(`
      UPDATE customers 
      SET machine_fingerprint = ?, last_seen = datetime('now'), last_validation = datetime('now')
      WHERE id = ?
    `).bind(hashedFingerprint, customer.id).run();
    
    // Create session info
    const sessionInfo = {
      allowed: true,
      sessionId: credentials.stripeSessionId,
      status: 'active',
      deviceInfo: {
        current: device.deviceInfo?.hostname || 'New Device',
        registered: new Date().toISOString()
      },
      machineChanged: false // New activation, no previous machine
    };
    
    // Determine caching strategy for new activation
    const cacheStrategy = {
      strategy: 'aggressive',
      duration: 3600, // 1 hour for fresh activations
      validUntil: new Date(Date.now() + 3600000).toISOString(),
      recommendation: 'cache_locally',
      nextCheck: new Date(Date.now() + 2880000).toISOString() // 48 minutes
    };
    
    // Log successful instant validation
    await logValidationEvent(env.DB, customer.id, 'instant_validation_unified', {
      responseTime: Date.now() - startTime,
      operation: 'instant',
      sessionId: credentials.stripeSessionId
    }, {
      sessionId: credentials.stripeSessionId,
      machineFingerprint: hashedFingerprint,
      paymentFlow: 'embedded'
    });
    
    console.log(`Unified instant validation successful for ${credentials.email} in ${Date.now() - startTime}ms`);
    
    return createUnifiedResponse({
      validation: {
        valid: true,
        status: 'active',
        validationType: 'instant',
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name
        }
      },
      subscription: {
        status: subscriptionStatus.status,
        id: customer.subscription_id,
        isActive: subscriptionStatus.isActive,
        unlockToken: customer.unlock_token
      },
      session: sessionInfo,
      caching: cacheStrategy,
      performance: {
        responseTime: Date.now() - startTime,
        databaseQueries: 2,
        instant: true,
        circuitBreakerState: dbCircuitBreaker.getState().state
      }
    }, cacheStrategy.duration);
    
  } catch (error) {
    console.error('Unified instant validation error:', error);
    return createUnifiedErrorResponse('INSTANT_VALIDATION_ERROR', 'Instant validation failed', 500, {
      responseTime: Date.now() - startTime,
      operation: 'instant'
    });
  }
}

/**
 * Handle unified session operations
 */
async function handleUnifiedSessionOperation(requestData, env, startTime) {
  const { credentials, device, action } = requestData;
  
  try {
    // First validate the license for session operations
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND unlock_token = ?
    `).bind(credentials.email, credentials.token).first();
    
    if (!customer || !isSubscriptionActive(customer)) {
      return createUnifiedErrorResponse('INVALID_CREDENTIALS_OR_SUBSCRIPTION', 'Invalid credentials or inactive subscription', 401, {
        responseTime: Date.now() - startTime,
        operation: 'session',
        action
      });
    }
    
    switch (action) {
      case 'start':
        return await handleUnifiedSessionStart(customer, device, credentials.sessionId, env, startTime);
      case 'heartbeat':
        return await handleUnifiedSessionHeartbeat(credentials.sessionId, env, startTime);
      case 'end':
        return await handleUnifiedSessionEnd(credentials.sessionId, env, startTime);
      case 'takeover':
        return await handleUnifiedSessionTakeover(customer, device, credentials.sessionId, env, startTime);
      default:
        return createUnifiedErrorResponse('INVALID_SESSION_ACTION', `Session action '${action}' not supported`, 400, {
          responseTime: Date.now() - startTime
        });
    }
    
  } catch (error) {
    console.error('Unified session operation error:', error);
    return createUnifiedErrorResponse('SESSION_OPERATION_ERROR', 'Session operation failed', 500, {
      responseTime: Date.now() - startTime,
      operation: 'session',
      action
    });
  }
}

/**
 * Determine unified caching strategy
 */
function determineUnifiedCacheStrategy(customer, subscriptionStatus) {
  const now = Date.now();
  const lastValidation = customer.last_validation ? new Date(customer.last_validation).getTime() : 0;
  const timeSinceLastValidation = now - lastValidation;
  
  let cacheDuration, strategy, recommendation, nextCheck;
  
  if (subscriptionStatus.status === 'active') {
    if (timeSinceLastValidation < 3600000) { // Less than 1 hour ago
      cacheDuration = 3600; // 1 hour
      strategy = 'aggressive';
      recommendation = 'cache_locally';
      nextCheck = new Date(now + 2880000).toISOString(); // 48 minutes
    } else if (timeSinceLastValidation < 86400000) { // Less than 24 hours ago
      cacheDuration = 1800; // 30 minutes
      strategy = 'moderate';
      recommendation = 'periodic_check';
      nextCheck = new Date(now + 1440000).toISOString(); // 24 minutes
    } else {
      cacheDuration = 900; // 15 minutes
      strategy = 'conservative';
      recommendation = 'frequent_validation';
      nextCheck = new Date(now + 720000).toISOString(); // 12 minutes
    }
  } else {
    cacheDuration = 300; // 5 minutes
    strategy = 'minimal';
    recommendation = 'frequent_validation';
    nextCheck = new Date(now + 240000).toISOString(); // 4 minutes
  }
  
  return {
    strategy,
    duration: cacheDuration,
    validUntil: new Date(now + cacheDuration * 1000).toISOString(),
    recommendation,
    nextCheck
  };
}

/**
 * Create unified response format
 */
function createUnifiedResponse(data, cacheSeconds = 300) {
  const response = {
    success: true,
    timestamp: new Date().toISOString(),
    requestId: generateRequestId(),
    ...data,
    metadata: {
      apiVersion: '2.0',
      operation: data.operation || 'unified',
      endpoint: '/validate-unified'
    }
  };
  
  const headers = {
    ...getCORSHeaders(),
    'Cache-Control': `private, max-age=${cacheSeconds}`,
    'X-API-Version': '2.0',
    'X-Response-Time': data.performance?.responseTime?.toString() || '0',
    'X-Cache-Strategy': data.caching?.strategy || 'none',
    'X-Validation-Timestamp': new Date().toISOString()
  };
  
  return new Response(JSON.stringify(response), {
    status: 200,
    headers
  });
}

/**
 * Create unified error response format
 */
function createUnifiedErrorResponse(code, message, status = 500, details = {}) {
  const response = {
    success: false,
    timestamp: new Date().toISOString(),
    requestId: generateRequestId(),
    error: {
      code,
      message,
      category: getErrorCategory(code),
      severity: getErrorSeverity(code),
      retryable: isRetryableError(code)
    },
    ...details,
    metadata: {
      apiVersion: '2.0',
      endpoint: '/validate-unified'
    }
  };
  
  return new Response(JSON.stringify(response), {
    status,
    headers: getCORSHeaders()
  });
}

/**
 * Generate unique request ID
 */
function generateRequestId() {
  return 'req_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * Get error category for classification
 */
function getErrorCategory(code) {
  if (code.includes('CREDENTIALS') || code.includes('INVALID')) return 'authentication';
  if (code.includes('SUBSCRIPTION')) return 'subscription';
  if (code.includes('SESSION')) return 'session';
  if (code.includes('SYSTEM') || code.includes('ERROR')) return 'system';
  return 'general';
}

/**
 * Get error severity level
 */
function getErrorSeverity(code) {
  if (code.includes('SUBSCRIPTION_INACTIVE') || code.includes('INVALID_CREDENTIALS')) return 'high';
  if (code.includes('SESSION') || code.includes('TIMEOUT')) return 'medium';
  return 'low';
}

/**
 * Check if error is retryable
 */
function isRetryableError(code) {
  const retryableCodes = ['TIMEOUT_ERROR', 'SERVICE_UNAVAILABLE', 'DATABASE_ERROR', 'CIRCUIT_BREAKER_OPEN'];
  return retryableCodes.some(retryable => code.includes(retryable));
}

/**
 * Generate customer portal URL (helper function)
 */
async function generateCustomerPortalUrl(stripeCustomerId, env) {
  // This would integrate with Stripe to generate portal URL
  // For now, return a placeholder
  return `https://billing.stripe.com/p/login/customer_portal`;
}

/**
 * Handle unified session start
 */
async function handleUnifiedSessionStart(customer, device, sessionId, env, startTime) {
  if (!device?.machineFingerprint || !sessionId || !device.deviceInfo) {
    return createUnifiedErrorResponse('MISSING_SESSION_DATA', 'Machine fingerprint, session ID, and device info are required', 400, {
      responseTime: Date.now() - startTime
    });
  }
  
  // Check for existing active sessions
  const existingSession = await env.DB.prepare(`
    SELECT * FROM active_sessions 
    WHERE customer_id = ? AND status = 'active' 
    AND last_heartbeat > datetime('now', '-2 minutes')
  `).bind(customer.id).first();
  
  if (existingSession && existingSession.session_id !== sessionId) {
    return createUnifiedErrorResponse('SESSION_CONFLICT', 'Another device is currently using this license', 409, {
      responseTime: Date.now() - startTime,
      conflict: true,
      conflictInfo: {
        deviceInfo: existingSession.device_info ? JSON.parse(existingSession.device_info) : null,
        lastSeen: existingSession.last_heartbeat
      }
    });
  }
  
  // Create or update session
  await env.DB.prepare(`
    INSERT OR REPLACE INTO active_sessions 
    (customer_id, session_id, machine_fingerprint, device_info, ip_address, user_agent, session_started, last_heartbeat, status)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'active')
  `).bind(
    customer.id,
    sessionId,
    await hashMachineFingerprint(device.machineFingerprint),
    JSON.stringify(device.deviceInfo || {}),
    'unknown', // IP would be available from request in real implementation
    'POSPal-Client'
  ).run();
  
  // Log session start
  await logAuditEvent(env.DB, customer.id, 'SESSION_START_UNIFIED', {
    sessionId,
    deviceInfo: device.deviceInfo,
    responseTime: Date.now() - startTime
  });
  
  return createUnifiedResponse({
    validation: {
      valid: true,
      status: 'active',
      validationType: 'session_start'
    },
    session: {
      allowed: true,
      sessionId: sessionId,
      status: 'active',
      deviceInfo: {
        current: device.deviceInfo.hostname || 'Unknown Device',
        registered: new Date().toISOString()
      }
    },
    performance: {
      responseTime: Date.now() - startTime,
      databaseQueries: 2
    }
  });
}

/**
 * Handle unified session heartbeat
 */
async function handleUnifiedSessionHeartbeat(sessionId, env, startTime) {
  if (!sessionId) {
    return createUnifiedErrorResponse('MISSING_SESSION_ID', 'Session ID is required', 400, {
      responseTime: Date.now() - startTime
    });
  }
  
  // Update heartbeat timestamp
  const result = await env.DB.prepare(`
    UPDATE active_sessions 
    SET last_heartbeat = datetime('now')
    WHERE session_id = ? AND status = 'active'
  `).bind(sessionId).run();
  
  if (result.changes === 0) {
    return createUnifiedErrorResponse('SESSION_NOT_FOUND', 'Session not found or expired', 404, {
      responseTime: Date.now() - startTime
    });
  }
  
  return createUnifiedResponse({
    session: {
      allowed: true,
      sessionId: sessionId,
      status: 'active',
      lastHeartbeat: new Date().toISOString()
    },
    performance: {
      responseTime: Date.now() - startTime,
      databaseQueries: 1
    }
  });
}

/**
 * Handle unified session end
 */
async function handleUnifiedSessionEnd(sessionId, env, startTime) {
  if (!sessionId) {
    return createUnifiedErrorResponse('MISSING_SESSION_ID', 'Session ID is required', 400, {
      responseTime: Date.now() - startTime
    });
  }
  
  // Mark session as ended
  await env.DB.prepare(`
    UPDATE active_sessions 
    SET status = 'ended', ended_at = datetime('now')
    WHERE session_id = ? AND status = 'active'
  `).bind(sessionId).run();
  
  return createUnifiedResponse({
    session: {
      allowed: false,
      sessionId: sessionId,
      status: 'ended',
      endedAt: new Date().toISOString()
    },
    performance: {
      responseTime: Date.now() - startTime,
      databaseQueries: 1
    }
  });
}

/**
 * Handle unified session takeover
 */
async function handleUnifiedSessionTakeover(customer, device, sessionId, env, startTime) {
  if (!device?.machineFingerprint || !sessionId || !device.deviceInfo) {
    return createUnifiedErrorResponse('MISSING_SESSION_DATA', 'Machine fingerprint, session ID, and device info are required', 400, {
      responseTime: Date.now() - startTime
    });
  }
  
  // Mark all existing sessions as 'kicked'
  await env.DB.prepare(`
    UPDATE active_sessions 
    SET status = 'kicked', ended_at = datetime('now')
    WHERE customer_id = ? AND status = 'active'
  `).bind(customer.id).run();
  
  // Create new session
  await env.DB.prepare(`
    INSERT INTO active_sessions 
    (customer_id, session_id, machine_fingerprint, device_info, ip_address, user_agent, session_started, last_heartbeat, status)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'active')
  `).bind(
    customer.id,
    sessionId,
    await hashMachineFingerprint(device.machineFingerprint),
    JSON.stringify(device.deviceInfo || {}),
    'unknown',
    'POSPal-Client'
  ).run();
  
  // Log session takeover
  await logAuditEvent(env.DB, customer.id, 'SESSION_TAKEOVER_UNIFIED', {
    newSessionId: sessionId,
    deviceInfo: device.deviceInfo,
    responseTime: Date.now() - startTime
  });
  
  return createUnifiedResponse({
    validation: {
      valid: true,
      status: 'active',
      validationType: 'session_takeover'
    },
    session: {
      allowed: true,
      sessionId: sessionId,
      status: 'active',
      deviceInfo: {
        current: device.deviceInfo.hostname || 'Unknown Device',
        registered: new Date().toISOString()
      },
      takeover: true
    },
    performance: {
      responseTime: Date.now() - startTime,
      databaseQueries: 2
    }
  });
}

/**
 * Handle test webhook events (bypasses signature verification for development)
 */
async function handleTestWebhook(request, env) {
  try {
    const payload = await request.text();
    const event = JSON.parse(payload);

    console.log(`Test webhook event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
        return await handleCheckoutCompleted(event, env);
      case 'invoice.payment_succeeded':
        return await handlePaymentSucceeded(event, env);
      case 'invoice.payment_failed':
        return await handlePaymentFailed(event, env);
      case 'customer.subscription.deleted':
        return await handleSubscriptionCancelled(event, env);
      case 'payment_method.attached':
        return await handlePaymentMethodAttached(event, env);
      case 'setup_intent.succeeded':
        return await handleSetupIntentSucceeded(event, env);
      default:
        console.log(`Unhandled test event type: ${event.type}`);
        return createResponse({ received: true, test: true });
    }

  } catch (error) {
    console.error('Test webhook error:', error);
    return createResponse({ error: 'Test webhook processing failed', details: error.message }, 500);
  }
}

/**
 * Handle Stripe webhook events with idempotency protection
 */
async function handleStripeWebhook(request, env) {
  try {
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return createResponse({ error: 'Missing stripe signature' }, 400);
    }

    const payload = await request.text();
    const event = JSON.parse(payload);

    console.log(`Stripe event: ${event.type} ID: ${event.id}`);

    // Check if this event has already been processed (idempotency protection)
    const existingEvent = await env.DB.prepare(`
      SELECT processing_status, processed_at, customer_id
      FROM webhook_events
      WHERE stripe_event_id = ?
    `).bind(event.id).first();

    if (existingEvent) {
      if (existingEvent.processing_status === 'completed') {
        console.log(`Event ${event.id} already processed successfully at ${existingEvent.processed_at}`);
        return createResponse({
          received: true,
          idempotent: true,
          message: 'Event already processed',
          processed_at: existingEvent.processed_at
        });
      } else if (existingEvent.processing_status === 'processing') {
        console.log(`Event ${event.id} is currently being processed, ignoring duplicate`);
        return createResponse({
          received: true,
          duplicate: true,
          message: 'Event currently being processed'
        });
      }
      // If status is 'failed', we'll retry below
    }

    // Mark event as being processed to prevent concurrent processing
    await env.DB.prepare(`
      INSERT OR REPLACE INTO webhook_events
      (stripe_event_id, event_type, processing_status, retry_count, created_at)
      VALUES (?, ?, 'processing', COALESCE((SELECT retry_count FROM webhook_events WHERE stripe_event_id = ?), 0) + 1, datetime('now'))
    `).bind(event.id, event.type, event.id).run();
    
    let result;
    let customerId = null;

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          result = await handleCheckoutCompleted(event, env);
          break;
        case 'invoice.payment_succeeded':
          result = await handlePaymentSucceeded(event, env);
          break;
        case 'invoice.payment_failed':
          result = await handlePaymentFailed(event, env);
          break;
        case 'customer.subscription.deleted':
          result = await handleSubscriptionCancelled(event, env);
          break;
        case 'payment_method.attached':
          result = await handlePaymentMethodAttached(event, env);
          break;
        case 'setup_intent.succeeded':
          result = await handleSetupIntentSucceeded(event, env);
          break;
        default:
          console.log(`Unhandled event type: ${event.type}`);
          result = createResponse({ received: true, unhandled: true });
      }

      // Extract customer ID from successful result if available
      const resultData = await result.clone().json();
      if (resultData.customer_id) {
        customerId = resultData.customer_id;
      }

      // Mark webhook event as completed
      await env.DB.prepare(`
        UPDATE webhook_events
        SET processing_status = 'completed', processed_at = datetime('now'), customer_id = ?
        WHERE stripe_event_id = ?
      `).bind(customerId, event.id).run();

      console.log(`Webhook event ${event.id} processed successfully`);
      return result;

    } catch (handlerError) {
      // Mark webhook event as failed
      await env.DB.prepare(`
        UPDATE webhook_events
        SET processing_status = 'failed', processed_at = datetime('now'), error_message = ?
        WHERE stripe_event_id = ?
      `).bind(handlerError.message, event.id).run();

      console.error(`Webhook event ${event.id} processing failed:`, handlerError);
      throw handlerError; // Re-throw to be caught by outer catch
    }

  } catch (error) {
    console.error('Webhook error:', error);
    return createResponse({ error: 'Webhook processing failed', event_id: event?.id }, 500);
  }
}

/**
 * Handle successful checkout (first payment)
 */
async function handleCheckoutCompleted(event, env) {
  const session = event.data.object;
  const customerEmail = session.customer_details?.email;
  const customerName = session.customer_details?.name || 'Customer';
  const subscriptionId = session.subscription;

  // Debug logging for payment method investigation
  console.log('Checkout completed debug info:', {
    sessionId: session.id,
    customerId: session.customer,
    paymentMethodId: session.payment_method_id || 'not_available',
    mode: session.mode,
    paymentMethodTypes: session.payment_method_types,
    setupIntentId: session.setup_intent || 'none'
  });

  if (!customerEmail || !subscriptionId) {
    console.error('Missing customer email or subscription ID');
    return createResponse({ error: 'Invalid session data' }, 400);
  }

  // Fetch subscription details from Stripe to get billing dates
  let billingData = {};
  if (subscriptionId) {
    try {
      // For test webhooks, use mock billing data instead of calling Stripe API
      if (subscriptionId.includes('test_phase2')) {
        const now = new Date();
        const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        billingData = {
          current_period_start: now.toISOString(),
          current_period_end: monthFromNow.toISOString(),
          next_billing_date: monthFromNow.toISOString()
        };

        console.log('Test billing data created:', billingData);
      } else {
        const stripe = createStripeHelper(env);
        const subscription = await stripe.get(`/subscriptions/${subscriptionId}`);

        if (!subscription.error) {
          billingData = {
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            next_billing_date: new Date(subscription.current_period_end * 1000).toISOString()
          };

          console.log('Billing data captured:', billingData);
        }
      }
    } catch (error) {
      console.error('Failed to fetch subscription billing data:', error);
      // Continue without billing data - it can be backfilled later
    }
  }

  try {
    // First check if customer already exists
    const existingCustomer = await env.DB.prepare(`
      SELECT * FROM customers WHERE email = ?
    `).bind(customerEmail).first();
    
    let customerId;
    let unlockToken;
    
    if (existingCustomer) {
      customerId = existingCustomer.id;
      unlockToken = existingCustomer.unlock_token;
      
      // Check if they already have an active subscription
      if (existingCustomer.subscription_id && existingCustomer.subscription_status === 'active') {
        console.log(`Customer ${customerEmail} already has active subscription: ${existingCustomer.subscription_id}`);
        
        // Log the duplicate payment attempt
        await logAuditEvent(env.DB, customerId, 'duplicate_payment_attempt', {
          existingSubscriptionId: existingCustomer.subscription_id,
          newSubscriptionId: subscriptionId,
          sessionId: session.id
        });
        
        // Update with new subscription data (they might have upgraded or changed plans)
        await env.DB.prepare(`
          UPDATE customers
          SET subscription_id = ?, stripe_customer_id = ?, stripe_session_id = ?,
              current_period_start = ?, current_period_end = ?, next_billing_date = ?,
              last_seen = datetime('now')
          WHERE id = ?
        `).bind(subscriptionId, session.customer, session.id,
                billingData.current_period_start, billingData.current_period_end, billingData.next_billing_date,
                customerId).run();
        
        // Don't send another welcome email, just log the event
        console.log(`Updated existing customer ${customerEmail} with new subscription ${subscriptionId}`);
        return createResponse({ success: true, customer_id: customerId });
      } else {
        // Customer exists but no active subscription - reactivate them
        await env.DB.prepare(`
          UPDATE customers
          SET subscription_id = ?, stripe_customer_id = ?, stripe_session_id = ?,
              subscription_status = 'active', payment_failures = 0,
              current_period_start = ?, current_period_end = ?, next_billing_date = ?,
              last_seen = datetime('now')
          WHERE id = ?
        `).bind(subscriptionId, session.customer, session.id,
                billingData.current_period_start, billingData.current_period_end, billingData.next_billing_date,
                customerId).run();
        
        console.log(`Reactivated customer ${customerEmail} with subscription ${subscriptionId}`);
      }
    } else {
      // New customer - create fresh record
      unlockToken = generateUnlockToken();
      
      const insertResult = await env.DB.prepare(`
        INSERT INTO customers
        (email, name, stripe_customer_id, stripe_session_id, unlock_token, subscription_id,
         subscription_status, current_period_start, current_period_end, next_billing_date,
         created_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(
        customerEmail,
        customerName,
        session.customer,
        session.id,
        unlockToken,
        subscriptionId,
        billingData.current_period_start,
        billingData.current_period_end,
        billingData.next_billing_date
      ).run();
      
      customerId = insertResult.meta.last_row_id;
      console.log(`New customer created: ${customerEmail} with token ${unlockToken}`);
    }
    
    // Fetch and log customer payment methods for debugging
    if (session.customer) {
      try {
        const stripe = {
          async get(url) {
            const response = await fetch(`https://api.stripe.com/v1${url}`, {
              headers: {
                'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
              }
            });
            return response.json();
          }
        };
        
        const paymentMethods = await stripe.get(`/customers/${session.customer}/payment_methods?type=card`);
        console.log('Customer payment methods after checkout:', {
          customerId: session.customer,
          paymentMethodCount: paymentMethods.data?.length || 0,
          paymentMethods: paymentMethods.data?.map(pm => ({
            id: pm.id,
            type: pm.type,
            card: pm.card ? {
              brand: pm.card.brand,
              last4: pm.card.last4,
              exp_month: pm.card.exp_month,
              exp_year: pm.card.exp_year
            } : null
          })) || []
        });
      } catch (debugError) {
        console.error('Error fetching payment methods for debugging:', debugError);
      }
    }

    // Log audit event
    await logAuditEvent(env.DB, customerId, 'payment_success', {
      subscriptionId,
      sessionId: session.id,
      isNewCustomer: !existingCustomer
    });
    
    // Send welcome email (only for truly new customers or reactivations)
    if (!existingCustomer || existingCustomer.subscription_status !== 'active') {
      await sendWelcomeEmail(env, customerId, customerEmail, customerName, unlockToken);
    }
    
    return createResponse({ success: true, customer_id: customerId });
    
  } catch (error) {
    console.error('Checkout processing error:', error);
    return createResponse({ error: 'Failed to process checkout' }, 500);
  }
}

/**
 * Handle successful payment (renewal) - NO GRACE PERIOD POLICY
 * Immediate reactivation on successful payment
 */
async function handlePaymentSucceeded(event, env) {
  const invoice = event.data.object;
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) {
    return createResponse({ received: true });
  }

  // Fetch subscription details from Stripe to get updated billing dates
  let billingData = {};
  try {
    const stripe = createStripeHelper(env);
    const subscription = await stripe.get(`/subscriptions/${subscriptionId}`);

    if (!subscription.error) {
      billingData = {
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        next_billing_date: new Date(subscription.current_period_end * 1000).toISOString()
      };

      console.log('Payment renewal - billing data updated:', billingData);
    }
  } catch (error) {
    console.error('Failed to fetch subscription billing data on renewal:', error);
    // Continue without billing data update
  }

  try {
    // Get customer details first to check if this is a reactivation
    const customer = await env.DB.prepare(`
      SELECT id, email, name, subscription_status FROM customers WHERE subscription_id = ?
    `).bind(subscriptionId).first();

    if (!customer) {
      console.error(`Customer not found for subscription: ${subscriptionId}`);
      return createResponse({ error: 'Customer not found' }, 404);
    }

    const wasInactive = customer.subscription_status !== 'active';

    // IMMEDIATE REACTIVATION - clear any inactive status and update billing dates
    await env.DB.prepare(`
      UPDATE customers
      SET subscription_status = 'active',
          current_period_start = ?, current_period_end = ?, next_billing_date = ?,
          last_seen = datetime('now')
      WHERE subscription_id = ?
    `).bind(billingData.current_period_start, billingData.current_period_end, billingData.next_billing_date, subscriptionId).run();
    
    // Log audit event
    await logAuditEvent(env.DB, customer.id, wasInactive ? 'payment_succeeded_immediate_reactivation' : 'payment_succeeded_renewal', {
      subscriptionId,
      policy: 'no_grace_period',
      reactivatedAt: wasInactive ? new Date().toISOString() : null,
      previousStatus: customer.subscription_status
    });
    
    // Send reactivation email only if account was previously inactive
    if (wasInactive) {
      await sendImmediateReactivationEmail(env, customer.id, customer.email, customer.name || 'Customer');
    }
    
    console.log(`Payment succeeded for ${customer.email}${wasInactive ? ' - IMMEDIATELY REACTIVATED' : ' - RENEWED'}`);
    return createResponse({ success: true });
    
  } catch (error) {
    console.error('Payment success handling error:', error);
    return createResponse({ error: 'Failed to process payment success' }, 500);
  }
}

/**
 * Handle failed payment - NO GRACE PERIOD POLICY
 * Immediate suspension on first payment failure
 */
async function handlePaymentFailed(event, env) {
  const invoice = event.data.object;
  const subscriptionId = invoice.subscription;
  const customerEmail = invoice.customer_email;
  
  if (!subscriptionId) {
    return createResponse({ received: true });
  }
  
  try {
    // Get customer details
    const customer = await env.DB.prepare(`
      SELECT id, email, name FROM customers WHERE subscription_id = ?
    `).bind(subscriptionId).first();
    
    if (!customer) {
      console.error(`Customer not found for subscription: ${subscriptionId}`);
      return createResponse({ error: 'Customer not found' }, 404);
    }
    
    // IMMEDIATE SUSPENSION - no grace period or failure count tracking
    await env.DB.prepare(`
      UPDATE customers 
      SET subscription_status = 'inactive', last_seen = datetime('now')
      WHERE subscription_id = ?
    `).bind(subscriptionId).run();
    
    // Log audit event
    await logAuditEvent(env.DB, customer.id, 'payment_failed_immediate_suspension', {
      subscriptionId,
      policy: 'no_grace_period',
      suspendedAt: new Date().toISOString()
    });
    
    // Send immediate suspension email
    await sendImmediateSuspensionEmail(env, customer.id, customerEmail || customer.email, customer.name || 'Customer');
    
    console.log(`Payment failed for ${customer.email} - IMMEDIATELY SUSPENDED (no grace period)`);
    return createResponse({ success: true });
    
  } catch (error) {
    console.error('Payment failure handling error:', error);
    return createResponse({ error: 'Failed to process payment failure' }, 500);
  }
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionCancelled(event, env) {
  const subscription = event.data.object;
  const subscriptionId = subscription.id;
  
  try {
    // Update customer status to cancelled
    const stmt = env.DB.prepare(`
      UPDATE customers 
      SET subscription_status = 'cancelled'
      WHERE subscription_id = ?
    `);
    
    await stmt.bind(subscriptionId).run();
    
    console.log(`Subscription cancelled: ${subscriptionId}`);
    return createResponse({ success: true });
    
  } catch (error) {
    console.error('Cancellation handling error:', error);
    return createResponse({ error: 'Failed to process cancellation' }, 500);
  }
}

/**
 * Handle license validation requests (Enhanced for hybrid cloud-first validation)
 */
async function handleLicenseValidation(request, env) {
  const startTime = Date.now();
  
  try {
    const { email, token, machineFingerprint, skipMachineUpdate } = await request.json();
    
    if (!email || !token) {
      return createErrorResponse('Missing required fields: email, token', 400, {
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }
    
    if (!isValidEmail(email)) {
      return createErrorResponse('Invalid email format', 400, {
        code: 'INVALID_EMAIL_FORMAT'
      });
    }
    
    // Performance-optimized customer lookup with circuit breaker protection
    const customer = await dbCircuitBreaker.execute(async () => {
      return await getCustomerForValidation(env.DB, email, token);
    });
    
    if (!customer) {
      return createValidationResponse({ 
        valid: false, 
        error: 'Invalid email or unlock token',
        errorCode: 'INVALID_CREDENTIALS'
      }, 60); // Cache negative results for 1 minute
    }
    
    // Get detailed subscription status for hybrid validation
    const detailedStatus = getDetailedSubscriptionStatus(customer);

    // IMPORTANT: Accept all licenses that exist in database (even inactive)
    // Feature restrictions will be handled by frontend based on subscription status
    // This supports seasonal businesses that cancel and reactivate
    if (!detailedStatus.isActive) {
      // Log validation attempt for inactive subscription
      await logValidationEvent(env.DB, customer.id, 'inactive_validation', {
        responseTime: Date.now() - startTime
      }, {
        subscriptionStatus: customer.subscription_status,
        daysSinceLastSeen: detailedStatus.daysSinceLastSeen
      });

      // Return success with inactive subscription info - let frontend control features
      console.log(`License validated for inactive subscription: ${email}, status: ${customer.subscription_status}`);

      return createValidationResponse({
        valid: true,
        customerName: customer.name || customer.email.split('@')[0],
        customerId: customer.id,
        subscriptionInfo: detailedStatus,
        machineChanged: false,
        subscriptionWarning: 'Subscription is not active. Some features may be restricted.',
        performance: {
          responseTime: Date.now() - startTime,
          cached: false,
          validationRecommendation: detailedStatus.validationRecommendation
        }
      }, 300); // Cache for 5 minutes
    }
    
    let machineChanged = false;
    let hashedFingerprint = null;
    
    // Handle machine fingerprint if provided
    if (machineFingerprint && !skipMachineUpdate) {
      hashedFingerprint = await hashMachineFingerprint(machineFingerprint);
      machineChanged = customer.machine_fingerprint && 
                      customer.machine_fingerprint !== hashedFingerprint;
      
      // Update customer with new machine fingerprint and validation timestamp
      await dbCircuitBreaker.execute(async () => {
        return await env.DB.prepare(`
          UPDATE customers 
          SET machine_fingerprint = ?, last_seen = datetime('now'), last_validation = datetime('now')
          WHERE id = ?
        `).bind(hashedFingerprint, customer.id).run();
      });
      
      // Send machine switch notification if needed
      if (machineChanged) {
        await sendMachineSwitchEmail(env, customer.id, customer.email, 'Customer');
      }
    } else {
      // Just update last validation timestamp for tracking
      await env.DB.prepare(`
        UPDATE customers 
        SET last_seen = datetime('now'), last_validation = datetime('now')
        WHERE id = ?
      `).bind(customer.id).run();
    }
    
    // Log successful validation with performance metrics
    await logValidationEvent(env.DB, customer.id, 'successful_validation', {
      responseTime: Date.now() - startTime,
      machineChanged,
      skipMachineUpdate: skipMachineUpdate || false
    }, {
      machineChanged,
      hashedFingerprint,
      validationRecommendation: detailedStatus.validationRecommendation
    });
    
    console.log(`License validated for ${email} in ${Date.now() - startTime}ms, machine changed: ${machineChanged}`);
    
    // Determine cache duration based on subscription stability
    const cacheDuration = detailedStatus.validationRecommendation === 'cached' ? 3600 : 900; // 1 hour or 15 minutes
    
    return createValidationResponse({
      valid: true,
      customerName: customer.name || customer.email.split('@')[0],
      customerId: customer.id,
      subscriptionInfo: detailedStatus,
      machineChanged,
      performance: {
        responseTime: Date.now() - startTime,
        cached: false,
        validationRecommendation: detailedStatus.validationRecommendation
      }
    }, cacheDuration);
    
  } catch (error) {
    console.error('Validation error:', error);
    return createErrorResponse('Validation failed', 500, {
      code: 'VALIDATION_ERROR',
      responseTime: Date.now() - startTime
    });
  }
}



/**
 * Handle instant validation after payment (Enhanced for embedded flow)
 */
async function handleInstantValidation(request, env) {
  const startTime = Date.now();
  
  try {
    const { email, stripeSessionId, machineFingerprint } = await request.json();
    
    if (!email || !stripeSessionId || !machineFingerprint) {
      return createErrorResponse('Missing required fields', 400, {
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }
    
    if (!isValidEmail(email)) {
      return createErrorResponse('Invalid email format', 400, {
        code: 'INVALID_EMAIL_FORMAT'
      });
    }
    
    // Look up customer by email and verify they have a recent payment
    const customer = await env.DB.prepare(`
      SELECT * FROM customers
      WHERE email = ? AND stripe_session_id = ? AND subscription_status = 'active'
    `).bind(email, stripeSessionId).first();
    
    if (!customer) {
      return createValidationResponse({ 
        valid: false, 
        error: 'No valid subscription found for this payment session',
        errorCode: 'NO_VALID_SUBSCRIPTION'
      }, 60); // Cache negative results briefly
    }
    
    // Get detailed subscription status
    const detailedStatus = getDetailedSubscriptionStatus(customer);
    
    // Hash machine fingerprint for storage
    const hashedFingerprint = await hashMachineFingerprint(machineFingerprint);
    
    // Update customer with machine fingerprint and validation timestamp
    await env.DB.prepare(`
      UPDATE customers 
      SET machine_fingerprint = ?, last_seen = datetime('now'), last_validation = datetime('now')
      WHERE id = ?
    `).bind(hashedFingerprint, customer.id).run();
    
    // Log successful instant validation with performance metrics
    await logValidationEvent(env.DB, customer.id, 'instant_validation', {
      responseTime: Date.now() - startTime,
      sessionId: stripeSessionId
    }, {
      sessionId: stripeSessionId,
      machineFingerprint: hashedFingerprint,
      paymentFlow: 'embedded'
    });
    
    console.log(`Instant validation successful for ${email} in ${Date.now() - startTime}ms`);
    
    return createValidationResponse({ 
      valid: true,
      unlockToken: customer.unlock_token,
      customerName: customer.name,
      subscriptionInfo: detailedStatus,
      performance: {
        responseTime: Date.now() - startTime,
        instant: true
      }
    }, 3600); // Cache instant validations for 1 hour
    
  } catch (error) {
    console.error('Instant validation error:', error);
    return createErrorResponse('Validation failed', 500, {
      code: 'INSTANT_VALIDATION_ERROR',
      responseTime: Date.now() - startTime
    });
  }
}

/**
 * Handle checkout session creation
 */

/**
 * Send welcome email with unlock token
 */
async function sendWelcomeEmail(env, customerId, email, name, unlockToken) {
  try {
    const { subject, html } = getWelcomeEmailTemplate(name, unlockToken, email);
    
    // Log email attempt
    const emailLogId = await logEmailDelivery(env.DB, customerId, 'welcome', email, subject);
    
    // Send email via Resend
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'POSPal <noreply@pospal.gr>',
        to: [email],
        subject: subject,
        html: html,
      }),
    });
    
    if (response.ok) {
      const result = await response.json();
      await updateEmailStatus(env.DB, emailLogId, 'delivered');
      console.log(`Welcome email sent to ${email}, ID: ${result.id}`);
    } else {
      const error = await response.text();
      await updateEmailStatus(env.DB, emailLogId, 'failed', error);
      console.error(`Failed to send welcome email to ${email}:`, error);
    }
    
  } catch (error) {
    console.error('Welcome email error:', error);
  }
}

/**
 * Send payment failure email
 */
async function sendPaymentFailureEmail(env, customerId, email, name) {
  try {
    const { subject, html } = getPaymentFailureEmailTemplate(name);
    
    const emailLogId = await logEmailDelivery(env.DB, customerId, 'payment_failed', email, subject);
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'POSPal Billing <billing@pospal.gr>',
        to: [email],
        subject: subject,
        html: html,
      }),
    });
    
    if (response.ok) {
      await updateEmailStatus(env.DB, emailLogId, 'delivered');
      console.log(`Payment failure email sent to ${email}`);
    } else {
      const error = await response.text();
      await updateEmailStatus(env.DB, emailLogId, 'failed', error);
      console.error(`Failed to send payment failure email:`, error);
    }
    
  } catch (error) {
    console.error('Payment failure email error:', error);
  }
}

/**
 * Send immediate suspension email - NO GRACE PERIOD POLICY
 */
async function sendImmediateSuspensionEmail(env, customerId, email, name) {
  try {
    const { subject, html } = getImmediateSuspensionEmailTemplate(name);
    
    const emailLogId = await logEmailDelivery(env.DB, customerId, 'immediate_suspension', email, subject);
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'POSPal Billing <billing@pospal.gr>',
        to: [email],
        subject: subject,
        html: html,
      }),
    });
    
    if (response.ok) {
      await updateEmailStatus(env.DB, emailLogId, 'delivered');
      console.log(`Immediate suspension email sent to ${email}`);
    } else {
      const error = await response.text();
      await updateEmailStatus(env.DB, emailLogId, 'failed', error);
      console.error(`Failed to send immediate suspension email:`, error);
    }
    
  } catch (error) {
    console.error('Immediate suspension email error:', error);
  }
}

/**
 * Send immediate reactivation email - NO GRACE PERIOD POLICY
 */
async function sendImmediateReactivationEmail(env, customerId, email, name) {
  try {
    const { subject, html } = getImmediateReactivationEmailTemplate(name);
    
    const emailLogId = await logEmailDelivery(env.DB, customerId, 'immediate_reactivation', email, subject);
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'POSPal <noreply@pospal.gr>',
        to: [email],
        subject: subject,
        html: html,
      }),
    });
    
    if (response.ok) {
      await updateEmailStatus(env.DB, emailLogId, 'delivered');
      console.log(`Immediate reactivation email sent to ${email}`);
    } else {
      const error = await response.text();
      await updateEmailStatus(env.DB, emailLogId, 'failed', error);
      console.error(`Failed to send immediate reactivation email:`, error);
    }
    
  } catch (error) {
    console.error('Immediate reactivation email error:', error);
  }
}

/**
 * Send machine switch notification email
 */
async function sendMachineSwitchEmail(env, customerId, email, name) {
  try {
    const { subject, html } = getMachineSwitchEmailTemplate(name, 'New Computer');
    
    const emailLogId = await logEmailDelivery(env.DB, customerId, 'machine_switch', email, subject);
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'POSPal Security <security@pospal.gr>',
        to: [email],
        subject: subject,
        html: html,
      }),
    });
    
    if (response.ok) {
      await updateEmailStatus(env.DB, emailLogId, 'delivered');
      console.log(`Machine switch email sent to ${email}`);
    } else {
      const error = await response.text();
      await updateEmailStatus(env.DB, emailLogId, 'failed', error);
      console.error(`Failed to send machine switch email:`, error);
    }
    
  } catch (error) {
    console.error('Machine switch email error:', error);
  }
}

/**
 * Send license disconnection confirmation email
 */
async function sendLicenseDisconnectionEmail(env, customerId, email, name, unlockToken) {
  try {
    const { subject, html } = getLicenseDisconnectionEmailTemplate(name, unlockToken, email);

    const emailLogId = await logEmailDelivery(env.DB, customerId, 'license_disconnection', email, subject);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'POSPal License Management <noreply@pospal.gr>',
        to: [email],
        subject: subject,
        html: html,
      }),
    });

    if (response.ok) {
      await updateEmailStatus(env.DB, emailLogId, 'delivered');
      console.log(`License disconnection email sent to ${email}`);
    } else {
      const error = await response.text();
      await updateEmailStatus(env.DB, emailLogId, 'failed', error);
      console.error(`Failed to send disconnection email:`, error);
    }

  } catch (error) {
    console.error('License disconnection email error:', error);
  }
}

/**
 * Handle session start (register new active session)
 */
async function handleSessionStart(request, env) {
  try {
    const { email, token, machineFingerprint, sessionId, deviceInfo } = await request.json();
    
    if (!email || !token || !machineFingerprint || !sessionId) {
      return createResponse({ 
        success: false, 
        error: 'Missing required fields' 
      }, 400);
    }
    
    // First validate the license
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND unlock_token = ?
    `).bind(email, token).first();
    
    if (!customer || !isSubscriptionActive(customer)) {
      return createResponse({ 
        success: false, 
        error: 'Invalid license or subscription not active' 
      });
    }
    
    // Check for existing active sessions for this customer
    const existingSession = await env.DB.prepare(`
      SELECT * FROM active_sessions 
      WHERE customer_id = ? AND status = 'active' 
      AND last_heartbeat > datetime('now', '-2 minutes')
    `).bind(customer.id).first();
    
    if (existingSession && existingSession.session_id !== sessionId) {
      // Another device is already active
      return createResponse({ 
        success: false, 
        error: 'Another device is currently using this license',
        conflict: true,
        conflictInfo: {
          deviceInfo: existingSession.device_info ? JSON.parse(existingSession.device_info) : null,
          lastSeen: existingSession.last_heartbeat
        }
      });
    }
    
    // Create or update session
    await env.DB.prepare(`
      INSERT OR REPLACE INTO active_sessions 
      (customer_id, session_id, machine_fingerprint, device_info, ip_address, user_agent, session_started, last_heartbeat)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      customer.id,
      sessionId,
      await hashMachineFingerprint(machineFingerprint),
      JSON.stringify(deviceInfo || {}),
      request.headers.get('cf-connecting-ip') || 'unknown',
      request.headers.get('user-agent') || 'unknown'
    ).run();
    
    // Log audit event
    await logAuditEvent(env.DB, customer.id, 'SESSION_START', {
      sessionId,
      deviceInfo: deviceInfo || {}
    });
    
    return createResponse({ 
      success: true,
      sessionId: sessionId
    });
    
  } catch (error) {
    console.error('Session start error:', error);
    return createResponse({ 
      success: false, 
      error: 'Failed to start session' 
    }, 500);
  }
}

/**
 * Handle session heartbeat (keep session alive)
 */
async function handleSessionHeartbeat(request, env) {
  try {
    const { sessionId } = await request.json();
    
    if (!sessionId) {
      return createResponse({ 
        success: false, 
        error: 'Missing session ID' 
      }, 400);
    }
    
    // Update heartbeat timestamp
    const result = await env.DB.prepare(`
      UPDATE active_sessions 
      SET last_heartbeat = datetime('now')
      WHERE session_id = ? AND status = 'active'
    `).bind(sessionId).run();
    
    if (result.changes === 0) {
      return createResponse({ 
        success: false, 
        error: 'Session not found or expired' 
      });
    }
    
    return createResponse({ 
      success: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Session heartbeat error:', error);
    return createResponse({ 
      success: false, 
      error: 'Failed to update heartbeat' 
    }, 500);
  }
}

/**
 * Handle session end (terminate session)
 */
async function handleSessionEnd(request, env) {
  try {
    const { sessionId, sendEmail } = await request.json();

    if (!sessionId) {
      return createResponse({
        success: false,
        error: 'Missing session ID'
      }, 400);
    }

    // Get session and customer info BEFORE ending session (for email)
    const session = await env.DB.prepare(`
      SELECT s.customer_id, c.email, c.name, c.unlock_token
      FROM active_sessions s
      JOIN customers c ON s.customer_id = c.id
      WHERE s.session_id = ? AND s.status = 'active'
    `).bind(sessionId).first();

    // Mark session as ended
    await env.DB.prepare(`
      UPDATE active_sessions
      SET status = 'ended', last_heartbeat = datetime('now')
      WHERE session_id = ? AND status = 'active'
    `).bind(sessionId).run();

    // Send email notification if requested and session was found
    if (sendEmail && session) {
      await sendLicenseDisconnectionEmail(
        env,
        session.customer_id,
        session.email,
        session.name || 'Customer',
        session.unlock_token
      );
    }

    return createResponse({
      success: true,
      emailSent: sendEmail && session ? true : false
    });

  } catch (error) {
    console.error('Session end error:', error);
    return createResponse({
      success: false,
      error: 'Failed to end session'
    }, 500);
  }
}

/**
 * Force takeover of existing session (kick other device)
 */
async function handleSessionTakeover(request, env) {
  try {
    const { email, token, machineFingerprint, sessionId, deviceInfo } = await request.json();
    
    if (!email || !token || !machineFingerprint || !sessionId) {
      return createResponse({ 
        success: false, 
        error: 'Missing required fields' 
      }, 400);
    }
    
    // Validate license
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND unlock_token = ?
    `).bind(email, token).first();
    
    if (!customer || !isSubscriptionActive(customer)) {
      return createResponse({ 
        success: false, 
        error: 'Invalid license or subscription not active' 
      });
    }
    
    // Mark all existing sessions as 'kicked'
    await env.DB.prepare(`
      UPDATE active_sessions 
      SET status = 'kicked'
      WHERE customer_id = ? AND status = 'active'
    `).bind(customer.id).run();
    
    // Create new session
    await env.DB.prepare(`
      INSERT INTO active_sessions 
      (customer_id, session_id, machine_fingerprint, device_info, ip_address, user_agent, session_started, last_heartbeat)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      customer.id,
      sessionId,
      await hashMachineFingerprint(machineFingerprint),
      JSON.stringify(deviceInfo || {}),
      request.headers.get('cf-connecting-ip') || 'unknown',
      request.headers.get('user-agent') || 'unknown'
    ).run();
    
    // Log audit event
    await logAuditEvent(env.DB, customer.id, 'SESSION_TAKEOVER', {
      newSessionId: sessionId,
      deviceInfo: deviceInfo || {}
    });
    
    return createResponse({ 
      success: true,
      sessionId: sessionId
    });
    
  } catch (error) {
    console.error('Session takeover error:', error);
    return createResponse({ 
      success: false, 
      error: 'Failed to takeover session' 
    }, 500);
  }
}

/**
 * Handle customer portal data request
 */
async function handleCustomerPortal(request, env) {
  try {
    const { email, unlockToken } = await request.json();
    
    if (!email || !unlockToken) {
      return createResponse({ error: 'Missing email or unlock token' }, 400);
    }
    
    // Get customer data
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND unlock_token = ?
    `).bind(email, unlockToken).first();
    
    if (!customer) {
      return createResponse({ error: 'Invalid credentials' }, 401);
    }
    
    // Create Stripe API helper
    const stripe = {
      async get(url) {
        const response = await fetch(`https://api.stripe.com/v1${url}`, {
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
          }
        });
        return response.json();
      },
      async post(url, data) {
        const response = await fetch(`https://api.stripe.com/v1${url}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(data).toString(),
        });
        return response.json();
      }
    };
    
    // Handle missing stripe_customer_id (same fallback as portal session)
    if (!customer.stripe_customer_id || customer.stripe_customer_id === 'null') {
      console.log(`Customer ${customer.email} missing stripe_customer_id, creating Stripe customer`);
      
      const stripeCustomer = await stripe.post('/customers', {
        email: customer.email,
        name: customer.name || customer.email.split('@')[0],
        'metadata[pospal_customer_id]': customer.id.toString(),
        'metadata[unlock_token]': customer.unlock_token,
        'metadata[created_via]': 'customer_portal_fallback'
      });
      
      if (stripeCustomer.error) {
        console.error('Failed to create Stripe customer for portal:', stripeCustomer.error);
      } else {
        // Update database with new Stripe customer ID
        await env.DB.prepare(`
          UPDATE customers 
          SET stripe_customer_id = ?
          WHERE id = ?
        `).bind(stripeCustomer.id, customer.id).run();
        
        customer.stripe_customer_id = stripeCustomer.id;
        
        // Log the fallback customer creation
        await logAuditEvent(env.DB, customer.id, 'stripe_customer_created_portal_fallback', {
          stripeCustomerId: stripeCustomer.id,
          reason: 'missing_stripe_customer_id_during_portal_data_fetch'
        });
      }
    }
    
    // Get subscription details from Stripe
    let subscriptionData = null;
    if (customer.subscription_id && customer.stripe_customer_id) {
      subscriptionData = await stripe.get(`/subscriptions/${customer.subscription_id}?expand[]=default_payment_method&expand[]=customer`);
      
      if (subscriptionData.error) {
        console.error('Failed to fetch subscription from Stripe:', subscriptionData.error);
      }
    }
    
    // Update customer's last seen
    await env.DB.prepare(`
      UPDATE customers 
      SET last_seen = datetime('now')
      WHERE id = ?
    `).bind(customer.id).run();
    
    return createResponse({
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        subscription_status: customer.subscription_status,
        created_at: customer.created_at,
        last_seen: customer.last_seen
      },
      subscription: subscriptionData
    });
    
  } catch (error) {
    console.error('Customer portal error:', error);
    return createResponse({ error: 'Failed to load customer data' }, 500);
  }
}



/**
 * Handle Stripe Customer Portal session creation
 */
async function handleCreatePortalSession(request, env) {
  try {
    const { email, unlockToken } = await request.json();
    
    if (!email || !unlockToken) {
      return createResponse({ error: 'Missing email or unlock token' }, 400);
    }
    
    // Verify customer
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND unlock_token = ?
    `).bind(email, unlockToken).first();
    
    if (!customer) {
      return createResponse({ error: 'Invalid credentials' }, 401);
    }
    
    // Create Stripe API helper
    const stripe = {
      async post(url, data) {
        const response = await fetch(`https://api.stripe.com/v1${url}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(data).toString(),
        });
        return response.json();
      }
    };
    
    let stripeCustomerId = customer.stripe_customer_id;
    
    // If no Stripe customer ID, create one (check for both null and string "null")
    if (!stripeCustomerId || stripeCustomerId === 'null') {
      console.log(`Creating Stripe customer for ${email} - missing stripe_customer_id`);
      
      const stripeCustomer = await stripe.post('/customers', {
        email: customer.email,
        name: customer.name || customer.email.split('@')[0],
        'metadata[pospal_customer_id]': customer.id.toString(),
        'metadata[unlock_token]': customer.unlock_token,
        'metadata[created_via]': 'portal_session_fallback'
      });
      
      if (stripeCustomer.error) {
        console.error('Failed to create Stripe customer:', stripeCustomer.error);
        return createResponse({ 
          error: 'Unable to access customer portal at this time. Please try again in a few minutes or contact support if the issue persists.',
          errorCode: 'STRIPE_CUSTOMER_CREATION_FAILED',
          supportEmail: 'support@pospal.gr'
        }, 500);
      }
      
      stripeCustomerId = stripeCustomer.id;
      
      // Update database with new Stripe customer ID
      await env.DB.prepare(`
        UPDATE customers 
        SET stripe_customer_id = ?
        WHERE id = ?
      `).bind(stripeCustomerId, customer.id).run();
      
      // Log the fallback customer creation
      await logAuditEvent(env.DB, customer.id, 'stripe_customer_created_fallback', {
        stripeCustomerId: stripeCustomerId,
        reason: 'missing_stripe_customer_id_during_portal_access',
        originalSubscriptionId: customer.subscription_id
      });
      
      console.log(`Created Stripe customer ${stripeCustomerId} for existing customer ${customer.email}`);
    }
    
    // Create billing portal session
    const portalSession = await stripe.post('/billing_portal/sessions', {
      customer: stripeCustomerId,
      return_url: request.headers.get('Referer') || 'http://127.0.0.1:5000'
    });
    
    if (portalSession.error) {
      console.error('Failed to create portal session:', portalSession.error);
      
      // Special handling for portal configuration error
      if (portalSession.error.message && portalSession.error.message.includes('No configuration provided')) {
        return createResponse({ 
          error: 'Customer portal is temporarily unavailable. Please try again in a few minutes or contact support.',
          errorCode: 'STRIPE_PORTAL_NOT_CONFIGURED',
          supportEmail: 'support@pospal.gr',
          details: 'Portal configuration required'
        }, 503); // Service Unavailable
      }
      
      return createResponse({ 
        error: 'Unable to open customer portal at this time. Please try again in a few minutes.',
        errorCode: 'STRIPE_PORTAL_CREATION_FAILED',
        supportEmail: 'support@pospal.gr'
      }, 500);
    }
    
    // Log portal access
    await logAuditEvent(env.DB, customer.id, 'customer_portal_accessed', {
      portalSessionId: portalSession.id
    });
    
    return createResponse({
      url: portalSession.url
    });
    
  } catch (error) {
    console.error('Portal session error:', error);
    return createResponse({ error: 'Failed to create portal session' }, 500);
  }
}


/**
 * Handle payment method attachment to customer
 */
async function handlePaymentMethodAttached(event, env) {
  try {
    const paymentMethod = event.data.object;
    const customerId = paymentMethod.customer;
    
    if (!customerId) {
      console.log('Payment method attached but no customer ID');
      return createResponse({ received: true });
    }
    
    // Find customer in our database by Stripe customer ID
    const customer = await env.DB.prepare(`
      SELECT id, email FROM customers WHERE stripe_customer_id = ?
    `).bind(customerId).first();
    
    if (customer) {
      // Log payment method attachment for audit
      await logAuditEvent(env.DB, customer.id, 'payment_method_attached', {
        paymentMethodId: paymentMethod.id,
        paymentMethodType: paymentMethod.type,
        last4: paymentMethod.card?.last4,
        brand: paymentMethod.card?.brand,
        expMonth: paymentMethod.card?.exp_month,
        expYear: paymentMethod.card?.exp_year
      });
      
      console.log(`Payment method ${paymentMethod.id} attached to customer ${customer.email}`);
    }
    
    return createResponse({ received: true });
    
  } catch (error) {
    console.error('Payment method attachment handling error:', error);
    return createResponse({ error: 'Failed to process payment method attachment' }, 500);
  }
}

/**
 * Handle setup intent succeeded (for saving cards without immediate payment)
 */
async function handleSetupIntentSucceeded(event, env) {
  try {
    const setupIntent = event.data.object;
    const customerId = setupIntent.customer;
    const paymentMethodId = setupIntent.payment_method;
    
    if (!customerId || !paymentMethodId) {
      console.log('Setup intent succeeded but missing customer ID or payment method ID');
      return createResponse({ received: true });
    }
    
    // Find customer in our database by Stripe customer ID
    const customer = await env.DB.prepare(`
      SELECT id, email FROM customers WHERE stripe_customer_id = ?
    `).bind(customerId).first();
    
    if (customer) {
      // Log setup intent completion for audit
      await logAuditEvent(env.DB, customer.id, 'setup_intent_succeeded', {
        setupIntentId: setupIntent.id,
        paymentMethodId: paymentMethodId,
        usage: setupIntent.usage
      });
      
      console.log(`Setup intent ${setupIntent.id} succeeded for customer ${customer.email}`);
    }
    
    return createResponse({ received: true });
    
  } catch (error) {
    console.error('Setup intent handling error:', error);
    return createResponse({ error: 'Failed to process setup intent' }, 500);
  }
}

/**
 * Handle Stripe Checkout Session creation (for POSPal subscription modal)
 */
async function handleCreateCheckoutSession(request, env) {
  try {
    const { restaurantName, name, email, phone } = await request.json();
    
    if (!restaurantName || !name || !email) {
      return createResponse({ error: 'Missing required fields: restaurantName, name, email' }, 400);
    }
    
    if (!isValidEmail(email)) {
      return createResponse({ error: 'Invalid email' }, 400);
    }
    
    // Check if customer already has an active subscription
    const existingCustomer = await env.DB.prepare(`
      SELECT * FROM customers WHERE email = ? AND subscription_status = 'active'
    `).bind(email).first();
    
    if (existingCustomer) {
      console.log(`Duplicate subscription attempt blocked for ${email}`);
      
      // Log the duplicate attempt
      await logAuditEvent(env.DB, existingCustomer.id, 'duplicate_subscription_attempt', {
        attemptedAt: new Date().toISOString(),
        existingSubscriptionId: existingCustomer.subscription_id
      });
      
      // Return error with redirect to customer portal
      return createResponse({ 
        error: 'You already have an active POSPal Pro subscription',
        duplicate: true,
        redirectTo: 'customer-portal',
        existingSubscription: {
          email: existingCustomer.email,
          subscriptionStatus: existingCustomer.subscription_status,
          createdAt: existingCustomer.created_at
        }
      }, 409); // 409 Conflict status code
    }
    
    // Check if customer exists but with inactive subscription
    const inactiveCustomer = await env.DB.prepare(`
      SELECT * FROM customers WHERE email = ? AND subscription_status != 'active'
    `).bind(email).first();
    
    if (inactiveCustomer) {
      console.log(`Previous customer returning: ${email}, status: ${inactiveCustomer.subscription_status}`);
      
      // Log the returning customer attempt
      await logAuditEvent(env.DB, inactiveCustomer.id, 'returning_customer_checkout', {
        previousStatus: inactiveCustomer.subscription_status,
        previousSubscriptionId: inactiveCustomer.subscription_id
      });
    }
    
    // Get request origin to determine success/cancel URLs
    const requestUrl = new URL(request.url);
    const origin = request.headers.get('Origin') || `${requestUrl.protocol}//${requestUrl.host}`;
    
    // Determine if this is localhost (development) or production
    const isLocalhost = origin.includes('localhost');
    const baseUrl = isLocalhost ? 'http://localhost:5000' : origin;
    
    // Create Stripe API helper
    const stripe = {
      async post(url, data) {
        const response = await fetch(`https://api.stripe.com/v1${url}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(data).toString(),
        });
        return response.json();
      }
    };

    // Create Stripe Checkout Session
    const session = await stripe.post('/checkout/sessions', {
      'payment_method_types[0]': 'card',
      'line_items[0][price]': env.STRIPE_PRICE_ID || 'price_1S26QQ1HM7SuDGcMAqFI7r9C',
      'line_items[0][quantity]': '1',
      mode: 'subscription',
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}`,
      cancel_url: `${baseUrl}/payment-failed.html?reason=cancelled`,
      customer_email: email,
      'metadata[restaurant_name]': restaurantName,
      'metadata[customer_name]': name,
      'metadata[customer_phone]': phone || '',
      'allow_promotion_codes': 'true',
      'billing_address_collection': 'required',
      'automatic_tax[enabled]': 'true',
      // CRITICAL: Save payment methods for future use and customer portal
      'payment_method_collection': 'always'
      // Removed 'customer_creation': 'always' - incompatible with payment_method_collection
      // Removed 'payment_method_options[card][setup_future_usage]' - not allowed in subscription mode
    });

    if (session.error) {
      console.error('Stripe checkout session error:', session.error);
      return createResponse({ 
        error: session.error.message,
        details: `Using price ID: ${env.STRIPE_PRICE_ID || 'price_1S26QQ1HM7SuDGcMAqFI7r9C'}`,
        type: session.error.type,
        code: session.error.code
      }, 400);
    }

    // Log checkout session creation
    console.log(`Checkout session created: ${session.id} for ${email}`);
    
    return createResponse({
      checkoutUrl: session.url,
      sessionId: session.id
    });

  } catch (error) {
    console.error('Checkout session creation error:', error);
    return createResponse({ error: 'Failed to create checkout session' }, 500);
  }
}

/**
 * Handle email duplicate check
 */
async function handleCheckDuplicate(request, env) {
  try {
    const { email } = await request.json();

    if (!email || !isValidEmail(email)) {
      return createResponse({ error: 'Valid email is required' }, 400);
    }

    // Check if customer exists
    const customer = await env.DB.prepare(`
      SELECT id, email, subscription_status, stripe_customer_id FROM customers WHERE email = ?
    `).bind(email.toLowerCase()).first();

    if (!customer) {
      // Email not found - available for new subscription
      return createResponse({
        isDuplicate: false,
        isReturningCustomer: false,
        message: 'Email available for new subscription'
      });
    }

    // Customer exists - check if they have active subscription
    if (customer.subscription_status === 'active') {
      // Active subscription - block new signup, offer portal
      const stripe = {
        async post(url, data) {
          const response = await fetch(`https://api.stripe.com/v1${url}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(data).toString(),
          });
          return response.json();
        }
      };

      let portalUrl = null;
      if (customer.stripe_customer_id && customer.stripe_customer_id !== 'null') {
        try {
          const portalSession = await stripe.post('/billing_portal/sessions', {
            customer: customer.stripe_customer_id,
            return_url: 'http://127.0.0.1:5000'
          });

          if (!portalSession.error) {
            portalUrl = portalSession.url;
          }
        } catch (portalError) {
          console.error('Failed to generate portal URL:', portalError);
        }
      }

      return createResponse({
        isDuplicate: true,
        isReturningCustomer: false,
        subscriptionStatus: 'active',
        portalUrl: portalUrl,
        message: 'This email already has an active subscription'
      });
    } else {
      // Inactive subscription - allow resubscription
      return createResponse({
        isDuplicate: true,
        isReturningCustomer: true,
        subscriptionStatus: customer.subscription_status,
        message: 'Welcome back! You can resubscribe with this email'
      });
    }

  } catch (error) {
    console.error('Check duplicate error:', error);
    return createResponse({ error: 'Failed to check email' }, 500);
  }
}

/**
 * Handle license recovery (resend unlock token to email)
 */
async function handleRecoverLicense(request, env) {
  try {
    const { email } = await request.json();

    if (!email || !isValidEmail(email)) {
      return createResponse({ error: 'Valid email is required' }, 400);
    }

    // Look up customer by email
    const customer = await env.DB.prepare(`
      SELECT id, email, name, unlock_token, subscription_status FROM customers WHERE email = ?
    `).bind(email.toLowerCase()).first();

    if (!customer) {
      // Don't reveal whether email exists or not (security)
      return createResponse({
        success: true,
        message: 'If this email exists in our system, you will receive your license key shortly.'
      });
    }

    // Send recovery email with unlock token
    try {
      const { subject, html } = getWelcomeEmailTemplate(
        customer.name || 'Customer',
        customer.unlock_token,
        customer.email
      );

      const emailLogId = await logEmailDelivery(env.DB, customer.id, 'license_recovery', customer.email, 'License Key Recovery');

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'POSPal <noreply@pospal.gr>',
          to: [customer.email],
          subject: 'Your POSPal License Key',
          html: html,
        }),
      });

      if (response.ok) {
        await updateEmailStatus(env.DB, emailLogId, 'delivered');
        console.log(`License recovery email sent to ${customer.email}`);
      } else {
        const error = await response.text();
        await updateEmailStatus(env.DB, emailLogId, 'failed', error);
        console.error(`Failed to send recovery email to ${customer.email}:`, error);
      }

      // Log recovery attempt
      await logAuditEvent(env.DB, customer.id, 'license_recovery_requested', {
        requestedAt: new Date().toISOString()
      });

    } catch (emailError) {
      console.error('Recovery email error:', emailError);
      // Still return success to user (don't reveal internal errors)
    }

    return createResponse({
      success: true,
      message: 'If this email exists in our system, you will receive your license key shortly.'
    });

  } catch (error) {
    console.error('License recovery error:', error);
    return createResponse({ error: 'Failed to process recovery request' }, 500);
  }
}

/**
 * Enhanced health check endpoint with circuit breaker monitoring
 */
async function handleHealthCheck(request, env) {
  try {
    // Use circuit breaker for database health check
    const healthData = await dbCircuitBreaker.execute(async () => {
      return await performHealthCheck(env.DB);
    });
    
    // Add circuit breaker status
    healthData.circuitBreaker = dbCircuitBreaker.getState();
    
    // Add system information
    healthData.system = {
      worker: 'cloudflare-licensing',
      version: '2.0.0',
      environment: env.ENVIRONMENT || 'production'
    };
    
    // Determine overall status based on services
    let overallStatus = 'healthy';
    if (healthData.services.database?.status === 'unhealthy') {
      overallStatus = 'unhealthy';
    } else if (healthData.circuitBreaker.state !== 'CLOSED') {
      overallStatus = 'degraded';
    }
    
    healthData.status = overallStatus;
    
    const statusCode = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 200 : 503;
    
    return new Response(JSON.stringify(healthData), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('Health check error:', error);
    
    // Return offline response if health check fails
    return createOfflineResponse('unknown', {
      error: error.message,
      circuitBreaker: dbCircuitBreaker.getState()
    });
  }
}