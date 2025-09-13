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
  checkRateLimit,
  logRecoveryAttempt,
  analyzeSecurityIndicators
} from './utils.js';

import { 
  getWelcomeEmailTemplate, 
  getPaymentFailureEmailTemplate,
  getImmediateSuspensionEmailTemplate,
  getImmediateReactivationEmailTemplate,
  getRenewalReminderEmailTemplate,
  getMachineSwitchEmailTemplate,
  getLicenseRecoveryEmailTemplate
} from './email-templates.js';

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
      case '/validate':
        return handleLicenseValidation(request, env);
      case '/batch-validate':
        return handleBatchValidation(request, env);
      case '/instant-validate':
        return handleInstantValidation(request, env);
      case '/validate-status':
        return handleValidationStatus(request, env);
      case '/session/start':
        return handleSessionStart(request, env);
      case '/session/heartbeat':
        return handleSessionHeartbeat(request, env);
      case '/session/end':
        return handleSessionEnd(request, env);
      case '/session/takeover':
        return handleSessionTakeover(request, env);
      case '/create-checkout':
        return handleCreateCheckout(request, env);
      case '/create-checkout-session':
        return handleCreateCheckoutSession(request, env);
      case '/check-duplicate':
        return handleCheckDuplicate(request, env);
      case '/customer-portal':
        return handleCustomerPortal(request, env);
      case '/billing-history':
        return handleBillingHistory(request, env);
      case '/cancel-subscription':
        return handleCancelSubscription(request, env);
      case '/pause-subscription':
        return handlePauseSubscription(request, env);
      case '/retention-offer':
        return handleRetentionOffer(request, env);
      case '/refund-request':
        return handleRefundRequest(request, env);
      case '/invoice-refund':
        return handleInvoiceRefund(request, env);
      case '/export-data':
        return handleExportData(request, env);
      case '/create-portal-session':
        return handleCreatePortalSession(request, env);
      case '/manual-license-creation':
        return handleManualLicenseCreation(request, env);
      case '/customer-lookup':
        return handleCustomerLookup(request, env);
      case '/resend-license-email':
        return handleResendLicenseEmail(request, env);
      case '/recover-license':
        return handleLicenseRecovery(request, env);
      case '/health':
        return handleHealthCheck(request, env);
      default:
        return createResponse({ error: 'Not found' }, 404);
    }
  }
};

/**
 * Handle Stripe webhook events
 */
async function handleStripeWebhook(request, env) {
  try {
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return createResponse({ error: 'Missing stripe signature' }, 400);
    }
    
    const payload = await request.text();
    const event = JSON.parse(payload);
    
    console.log(`Stripe event: ${event.type}`);
    
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
        console.log(`Unhandled event type: ${event.type}`);
        return createResponse({ received: true });
    }
    
  } catch (error) {
    console.error('Webhook error:', error);
    return createResponse({ error: 'Webhook processing failed' }, 500);
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
          SET subscription_id = ?, stripe_customer_id = ?, stripe_session_id = ?, last_seen = datetime('now')
          WHERE id = ?
        `).bind(subscriptionId, session.customer, session.id, customerId).run();
        
        // Don't send another welcome email, just log the event
        console.log(`Updated existing customer ${customerEmail} with new subscription ${subscriptionId}`);
        return createResponse({ success: true, customer_id: customerId });
      } else {
        // Customer exists but no active subscription - reactivate them
        await env.DB.prepare(`
          UPDATE customers 
          SET subscription_id = ?, stripe_customer_id = ?, stripe_session_id = ?, 
              subscription_status = 'active', payment_failures = 0, last_seen = datetime('now')
          WHERE id = ?
        `).bind(subscriptionId, session.customer, session.id, customerId).run();
        
        console.log(`Reactivated customer ${customerEmail} with subscription ${subscriptionId}`);
      }
    } else {
      // New customer - create fresh record
      unlockToken = generateUnlockToken();
      
      const insertResult = await env.DB.prepare(`
        INSERT INTO customers 
        (email, name, stripe_customer_id, stripe_session_id, unlock_token, subscription_id, subscription_status, created_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
      `).bind(
        customerEmail,
        customerName,
        session.customer,
        session.id,
        unlockToken,
        subscriptionId
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
    
    // IMMEDIATE REACTIVATION - clear any inactive status
    await env.DB.prepare(`
      UPDATE customers 
      SET subscription_status = 'active', last_seen = datetime('now')
      WHERE subscription_id = ?
    `).bind(subscriptionId).run();
    
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
    
    if (!detailedStatus.isActive) {
      // Log validation attempt for inactive subscription
      await logValidationEvent(env.DB, customer.id, 'inactive_validation', {
        responseTime: Date.now() - startTime
      }, {
        subscriptionStatus: customer.subscription_status,
        daysSinceLastSeen: detailedStatus.daysSinceLastSeen
      });
      
      return createValidationResponse({ 
        valid: false, 
        error: 'Subscription is not active',
        errorCode: 'SUBSCRIPTION_INACTIVE',
        subscriptionInfo: detailedStatus
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
 * Handle batch validation for multiple licenses
 */
async function handleBatchValidation(request, env) {
  const startTime = Date.now();
  
  try {
    const { validations, options = {} } = await request.json();
    
    if (!validations || !Array.isArray(validations)) {
      return createErrorResponse('Missing or invalid validations array', 400, {
        code: 'INVALID_VALIDATIONS_ARRAY'
      });
    }
    
    if (validations.length > 50) {
      return createErrorResponse('Too many validations requested (max 50)', 400, {
        code: 'TOO_MANY_VALIDATIONS'
      });
    }
    
    // Validate request format
    for (let i = 0; i < validations.length; i++) {
      const validation = validations[i];
      if (!validation.email || !validation.token) {
        return createErrorResponse(`Invalid validation at index ${i}: missing email or token`, 400, {
          code: 'INVALID_VALIDATION_FORMAT',
          index: i
        });
      }
      
      if (!isValidEmail(validation.email)) {
        return createErrorResponse(`Invalid email format at index ${i}`, 400, {
          code: 'INVALID_EMAIL_FORMAT',
          index: i
        });
      }
    }
    
    // Process batch validation
    const batchResult = await validateMultipleLicenses(env.DB, validations);
    
    // Log batch validation event
    const sampleCustomerId = batchResult.results.find(r => r.valid && r.customer)?.customer?.id;
    if (sampleCustomerId) {
      await logValidationEvent(env.DB, sampleCustomerId, 'batch_validation', {
        ...batchResult.metadata,
        totalRequests: validations.length
      }, {
        batchSize: validations.length,
        successRate: batchResult.results.filter(r => r.valid).length / validations.length
      });
    }
    
    console.log(`Batch validation completed: ${validations.length} requests in ${Date.now() - startTime}ms`);
    
    return createValidationResponse({
      success: batchResult.success,
      results: batchResult.results,
      metadata: {
        ...batchResult.metadata,
        processedAt: new Date().toISOString(),
        totalProcessingTime: Date.now() - startTime
      }
    }, 300); // Cache batch results for 5 minutes
    
  } catch (error) {
    console.error('Batch validation error:', error);
    return createErrorResponse('Batch validation failed', 500, {
      code: 'BATCH_VALIDATION_ERROR',
      responseTime: Date.now() - startTime
    });
  }
}

/**
 * Handle validation status check (lightweight endpoint for status polling)
 */
async function handleValidationStatus(request, env) {
  const startTime = Date.now();
  
  try {
    const { email, token } = await request.json();
    
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
    
    // Lightweight customer lookup (no machine fingerprint updates)
    const customer = await getCustomerForValidation(env.DB, email, token);
    
    if (!customer) {
      return createValidationResponse({ 
        valid: false, 
        error: 'Invalid email or unlock token',
        errorCode: 'INVALID_CREDENTIALS'
      }, 300); // Cache negative results for 5 minutes
    }
    
    // Get detailed subscription status
    const detailedStatus = getDetailedSubscriptionStatus(customer);
    
    // Log lightweight validation
    await logValidationEvent(env.DB, customer.id, 'status_check', {
      responseTime: Date.now() - startTime,
      lightweight: true
    });
    
    console.log(`Status check for ${email} in ${Date.now() - startTime}ms`);
    
    return createValidationResponse({
      valid: detailedStatus.isActive,
      subscriptionInfo: detailedStatus,
      customerName: customer.name || customer.email.split('@')[0],
      performance: {
        responseTime: Date.now() - startTime,
        lightweight: true
      }
    }, 600); // Cache status for 10 minutes
    
  } catch (error) {
    console.error('Status check error:', error);
    return createErrorResponse('Status check failed', 500, {
      code: 'STATUS_CHECK_ERROR',
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
async function handleCreateCheckout(request, env) {
  try {
    const { email, name, paymentMethodId } = await request.json();
    
    if (!email || !name || !paymentMethodId) {
      return createResponse({ error: 'Missing required fields: email, name, paymentMethodId' }, 400);
    }
    
    if (!isValidEmail(email)) {
      return createResponse({ error: 'Invalid email' }, 400);
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

    // Step 1: Create Stripe Customer
    const stripeCustomer = await stripe.post('/customers', {
      email: email,
      name: name,
      payment_method: paymentMethodId,
      'invoice_settings[default_payment_method]': paymentMethodId
    });

    if (stripeCustomer.error) {
      console.error('Stripe customer error:', stripeCustomer.error);
      return createResponse({ error: stripeCustomer.error.message }, 400);
    }

    // Step 2: Create Subscription
    const subscription = await stripe.post('/subscriptions', {
      customer: stripeCustomer.id,
      'items[0][price]': env.STRIPE_PRICE_ID,
      default_payment_method: paymentMethodId,
      'expand[0]': 'latest_invoice.payment_intent'
    });

    if (subscription.error) {
      console.error('Stripe subscription error:', subscription.error);
      return createResponse({ error: subscription.error.message }, 400);
    }

    // Generate session ID for tracking
    const sessionId = `cs_embedded_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    
    // Create unlock token
    const unlockToken = generateUnlockToken();

    try {
      await env.DB.prepare(`
        INSERT INTO customers (email, name, unlock_token, stripe_session_id, stripe_customer_id, subscription_id, subscription_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(email, name, unlockToken, sessionId, stripeCustomer.id, subscription.id, subscription.status).run();

      console.log('Customer created with embedded payment:', {
        sessionId,
        customerId: stripeCustomer.id,
        subscriptionId: subscription.id,
        status: subscription.status
      });

    } catch (dbError) {
      console.error('Database error:', dbError);
      return createResponse({ error: 'Failed to create customer record' }, 500);
    }

    return createResponse({
      id: sessionId,
      subscription_id: subscription.id,
      customer_id: stripeCustomer.id,
      status: subscription.status,
      unlock_token: unlockToken
    });
    
  } catch (error) {
    console.error('Checkout creation error:', error);
    return createResponse({ error: 'Failed to create checkout' }, 500);
  }
}

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
 * Send license recovery email with enhanced security template
 */
async function sendLicenseRecoveryEmail(env, customerId, email, name, unlockToken, securityFlags = {}) {
  try {
    const { subject, html } = getLicenseRecoveryEmailTemplate(name, unlockToken, email, securityFlags);
    
    // Log email attempt
    const emailLogId = await logEmailDelivery(env.DB, customerId, 'license_recovery', email, subject);
    
    // Send email via Resend
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'POSPal License Recovery <recovery@pospal.gr>',
        to: [email],
        subject: subject,
        html: html,
      }),
    });
    
    if (response.ok) {
      const result = await response.json();
      await updateEmailStatus(env.DB, emailLogId, 'delivered');
      console.log(`License recovery email sent to ${email}, ID: ${result.id}`);
      
      // Log successful email delivery
      await logAuditEvent(env.DB, customerId, 'license_recovery_email_sent', {
        emailId: result.id,
        securityLevel: securityFlags.securityLevel || 'normal',
        timestamp: new Date().toISOString()
      });
    } else {
      const error = await response.text();
      await updateEmailStatus(env.DB, emailLogId, 'failed', error);
      console.error(`Failed to send license recovery email to ${email}:`, error);
      
      // Log failed email delivery
      await logAuditEvent(env.DB, customerId, 'license_recovery_email_failed', {
        error: error,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('License recovery email error:', error);
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
    const { sessionId } = await request.json();
    
    if (!sessionId) {
      return createResponse({ 
        success: false, 
        error: 'Missing session ID' 
      }, 400);
    }
    
    // Mark session as ended
    await env.DB.prepare(`
      UPDATE active_sessions 
      SET status = 'ended', last_heartbeat = datetime('now')
      WHERE session_id = ? AND status = 'active'
    `).bind(sessionId).run();
    
    return createResponse({ 
      success: true
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
 * Handle billing history request
 */
async function handleBillingHistory(request, env) {
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
    
    if (!customer.stripe_customer_id) {
      return createResponse({ invoices: [] });
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
      }
    };
    
    // Get invoices from Stripe
    const invoices = await stripe.get(`/invoices?customer=${customer.stripe_customer_id}&limit=50`);
    
    if (invoices.error) {
      console.error('Failed to fetch invoices:', invoices.error);
      return createResponse({ error: 'Failed to load billing history' }, 500);
    }
    
    return createResponse({
      invoices: invoices.data || []
    });
    
  } catch (error) {
    console.error('Billing history error:', error);
    return createResponse({ error: 'Failed to load billing history' }, 500);
  }
}

/**
 * Handle subscription cancellation
 */
async function handleCancelSubscription(request, env) {
  try {
    const { email, unlockToken, reason, feedback } = await request.json();
    
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
    
    if (!customer.subscription_id) {
      return createResponse({ error: 'No active subscription found' }, 400);
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
    
    // Cancel subscription at period end
    const cancelledSubscription = await stripe.post(`/subscriptions/${customer.subscription_id}`, {
      cancel_at_period_end: 'true'
    });
    
    if (cancelledSubscription.error) {
      console.error('Failed to cancel subscription:', cancelledSubscription.error);
      return createResponse({ error: 'Failed to cancel subscription' }, 500);
    }
    
    // Update customer status
    await env.DB.prepare(`
      UPDATE customers 
      SET subscription_status = 'cancelled', last_seen = datetime('now')
      WHERE id = ?
    `).bind(customer.id).run();
    
    // Log cancellation with feedback
    await logAuditEvent(env.DB, customer.id, 'subscription_cancelled', {
      reason: reason || 'not_specified',
      feedback: feedback || '',
      cancel_at_period_end: true,
      period_end: new Date(cancelledSubscription.current_period_end * 1000)
    });
    
    // Send cancellation confirmation email
    await sendCancellationEmail(env, customer.id, customer.email, customer.name, cancelledSubscription.current_period_end);
    
    return createResponse({
      success: true,
      message: 'Subscription cancelled successfully',
      access_until: new Date(cancelledSubscription.current_period_end * 1000)
    });
    
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return createResponse({ error: 'Failed to cancel subscription' }, 500);
  }
}

/**
 * Handle subscription pause
 */
async function handlePauseSubscription(request, env) {
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
    
    if (!customer.subscription_id) {
      return createResponse({ error: 'No active subscription found' }, 400);
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
    
    // Pause subscription
    const pausedSubscription = await stripe.post(`/subscriptions/${customer.subscription_id}`, {
      'pause_collection[behavior]': 'void'
    });
    
    if (pausedSubscription.error) {
      console.error('Failed to pause subscription:', pausedSubscription.error);
      return createResponse({ error: 'Failed to pause subscription' }, 500);
    }
    
    // Update customer status
    await env.DB.prepare(`
      UPDATE customers 
      SET subscription_status = 'paused', last_seen = datetime('now')
      WHERE id = ?
    `).bind(customer.id).run();
    
    // Log pause event
    await logAuditEvent(env.DB, customer.id, 'subscription_paused', {
      pause_behavior: 'void'
    });
    
    return createResponse({
      success: true,
      message: 'Subscription paused successfully'
    });
    
  } catch (error) {
    console.error('Pause subscription error:', error);
    return createResponse({ error: 'Failed to pause subscription' }, 500);
  }
}

/**
 * Handle retention offer acceptance
 */
async function handleRetentionOffer(request, env) {
  try {
    const { email, unlockToken, offerType } = await request.json();
    
    if (!email || !unlockToken || !offerType) {
      return createResponse({ error: 'Missing required fields' }, 400);
    }
    
    // Verify customer
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND unlock_token = ?
    `).bind(email, unlockToken).first();
    
    if (!customer) {
      return createResponse({ error: 'Invalid credentials' }, 401);
    }
    
    if (!customer.subscription_id) {
      return createResponse({ error: 'No active subscription found' }, 400);
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
    
    // Apply 50% discount for 3 months
    if (offerType === '50_percent_3_months') {
      // Create coupon
      const coupon = await stripe.post('/coupons', {
        percent_off: '50',
        duration: 'repeating',
        duration_in_months: '3',
        name: 'Retention Offer - 50% Off for 3 Months'
      });
      
      if (coupon.error) {
        console.error('Failed to create retention coupon:', coupon.error);
        return createResponse({ error: 'Failed to create discount' }, 500);
      }
      
      // Apply coupon to subscription
      const updatedSubscription = await stripe.post(`/subscriptions/${customer.subscription_id}`, {
        coupon: coupon.id,
        cancel_at_period_end: 'false'
      });
      
      if (updatedSubscription.error) {
        console.error('Failed to apply retention coupon:', updatedSubscription.error);
        return createResponse({ error: 'Failed to apply discount' }, 500);
      }
      
      // Update customer status (uncancel if was cancelled)
      await env.DB.prepare(`
        UPDATE customers 
        SET subscription_status = 'active', last_seen = datetime('now')
        WHERE id = ?
      `).bind(customer.id).run();
      
      // Log retention offer acceptance
      await logAuditEvent(env.DB, customer.id, 'retention_offer_accepted', {
        offerType: offerType,
        couponId: coupon.id,
        discount: '50% for 3 months'
      });
      
      return createResponse({
        success: true,
        message: '50% discount applied for the next 3 months!'
      });
    }
    
    return createResponse({ error: 'Invalid offer type' }, 400);
    
  } catch (error) {
    console.error('Retention offer error:', error);
    return createResponse({ error: 'Failed to apply retention offer' }, 500);
  }
}

/**
 * Handle refund request
 */
async function handleRefundRequest(request, env) {
  try {
    const { email, unlockToken, reason, details } = await request.json();
    
    if (!email || !unlockToken || !reason || !details) {
      return createResponse({ error: 'Missing required fields' }, 400);
    }
    
    // Verify customer
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND unlock_token = ?
    `).bind(email, unlockToken).first();
    
    if (!customer) {
      return createResponse({ error: 'Invalid credentials' }, 401);
    }
    
    // Store refund request in database (you'd need to create this table)
    await env.DB.prepare(`
      INSERT INTO refund_requests 
      (customer_id, reason, details, status, created_at)
      VALUES (?, ?, ?, 'pending', datetime('now'))
    `).bind(customer.id, reason, details).run();
    
    // Log refund request
    await logAuditEvent(env.DB, customer.id, 'refund_requested', {
      reason,
      details
    });
    
    // Send notification email to support team
    await sendRefundRequestNotification(env, customer, reason, details);
    
    return createResponse({
      success: true,
      message: 'Refund request submitted successfully'
    });
    
  } catch (error) {
    console.error('Refund request error:', error);
    return createResponse({ error: 'Failed to submit refund request' }, 500);
  }
}

/**
 * Handle specific invoice refund
 */
async function handleInvoiceRefund(request, env) {
  try {
    const { email, unlockToken, invoiceId } = await request.json();
    
    if (!email || !unlockToken || !invoiceId) {
      return createResponse({ error: 'Missing required fields' }, 400);
    }
    
    // Verify customer
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND unlock_token = ?
    `).bind(email, unlockToken).first();
    
    if (!customer) {
      return createResponse({ error: 'Invalid credentials' }, 401);
    }
    
    // Store invoice refund request
    await env.DB.prepare(`
      INSERT INTO refund_requests 
      (customer_id, invoice_id, reason, details, status, created_at)
      VALUES (?, ?, 'invoice_refund', 'Refund request for specific invoice', 'pending', datetime('now'))
    `).bind(customer.id, invoiceId).run();
    
    // Log refund request
    await logAuditEvent(env.DB, customer.id, 'invoice_refund_requested', {
      invoiceId
    });
    
    return createResponse({
      success: true,
      message: 'Invoice refund request submitted successfully'
    });
    
  } catch (error) {
    console.error('Invoice refund error:', error);
    return createResponse({ error: 'Failed to submit refund request' }, 500);
  }
}

/**
 * Handle customer data export
 */
async function handleExportData(request, env) {
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
    
    // Get audit log
    const auditLogs = await env.DB.prepare(`
      SELECT * FROM audit_log 
      WHERE customer_id = ?
      ORDER BY created_at DESC
    `).bind(customer.id).all();
    
    // Get email logs
    const emailLogs = await env.DB.prepare(`
      SELECT * FROM email_log 
      WHERE customer_id = ?
      ORDER BY created_at DESC
    `).bind(customer.id).all();
    
    // Get session history
    const sessions = await env.DB.prepare(`
      SELECT session_id, device_info, ip_address, session_started, last_heartbeat, status
      FROM active_sessions 
      WHERE customer_id = ?
      ORDER BY session_started DESC
    `).bind(customer.id).all();
    
    const exportData = {
      customer: {
        email: customer.email,
        name: customer.name,
        created_at: customer.created_at,
        subscription_status: customer.subscription_status,
        last_seen: customer.last_seen
      },
      audit_logs: auditLogs.results || [],
      email_logs: emailLogs.results || [],
      sessions: sessions.results || [],
      exported_at: new Date().toISOString()
    };
    
    // Log export
    await logAuditEvent(env.DB, customer.id, 'data_exported', {
      export_timestamp: new Date().toISOString()
    });
    
    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="pospal-data-export.json"',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('Data export error:', error);
    return createResponse({ error: 'Failed to export data' }, 500);
  }
}

/**
 * Send cancellation confirmation email
 */
async function sendCancellationEmail(env, customerId, email, name, periodEndTimestamp) {
  try {
    const periodEndDate = new Date(periodEndTimestamp * 1000).toLocaleDateString();
    
    const subject = 'Subscription Cancelled - POSPal';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Subscription Cancelled</h2>
        <p>Hi ${name},</p>
        <p>Your POSPal Pro subscription has been cancelled as requested.</p>
        
        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h3>What happens next:</h3>
          <ul>
            <li>You'll keep access to POSPal Pro until <strong>${periodEndDate}</strong></li>
            <li>No more charges will be made after that date</li>
            <li>You can reactivate your subscription anytime before then</li>
          </ul>
        </div>
        
        <p>We're sorry to see you go! If you change your mind, you can always resubscribe.</p>
        
        <p>Questions? Reply to this email or contact us at support@pospal.gr</p>
        
        <p>Thanks,<br>The POSPal Team</p>
      </div>
    `;
    
    await logEmailDelivery(env.DB, customerId, 'cancellation', email, subject);
    
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
      console.log(`Cancellation email sent to ${email}`);
    } else {
      console.error('Failed to send cancellation email:', await response.text());
    }
    
  } catch (error) {
    console.error('Cancellation email error:', error);
  }
}

/**
 * Send refund request notification to support team
 */
async function sendRefundRequestNotification(env, customer, reason, details) {
  try {
    const subject = `Refund Request - ${customer.email}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>New Refund Request</h2>
        
        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h3>Customer Information:</h3>
          <p><strong>Email:</strong> ${customer.email}</p>
          <p><strong>Name:</strong> ${customer.name}</p>
          <p><strong>Customer ID:</strong> ${customer.id}</p>
          <p><strong>Subscription ID:</strong> ${customer.subscription_id}</p>
        </div>
        
        <div style="background: #fff3cd; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h3>Refund Details:</h3>
          <p><strong>Reason:</strong> ${reason}</p>
          <p><strong>Details:</strong> ${details}</p>
        </div>
        
        <p>Please review and process this refund request within 24 hours.</p>
      </div>
    `;
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'POSPal System <system@pospal.gr>',
        to: ['system@send.pospal.gr'],
        subject: subject,
        html: html,
      }),
    });
    
    if (response.ok) {
      console.log('Refund request notification sent to support team');
    } else {
      console.error('Failed to send refund notification:', await response.text());
    }
    
  } catch (error) {
    console.error('Refund notification error:', error);
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
 * Handle duplicate email checking for frontend
 */
async function handleCheckDuplicate(request, env) {
  try {
    const { email } = await request.json();
    
    if (!email) {
      return createResponse({ error: 'Missing email field' }, 400);
    }
    
    if (!isValidEmail(email)) {
      return createResponse({ error: 'Invalid email format' }, 400);
    }
    
    // Check if customer already has an active subscription
    const activeCustomer = await env.DB.prepare(`
      SELECT email, subscription_status, created_at, subscription_id FROM customers 
      WHERE email = ? AND subscription_status = 'active'
    `).bind(email).first();
    
    if (activeCustomer) {
      console.log(`Duplicate check: ${email} has active subscription`);
      
      return createResponse({ 
        isDuplicate: true,
        status: 'active',
        message: 'This email already has an active POSPal Pro subscription',
        subscriptionInfo: {
          email: activeCustomer.email,
          status: activeCustomer.subscription_status,
          createdAt: activeCustomer.created_at
        },
        actionRequired: 'redirect_to_portal'
      });
    }
    
    // Check if customer exists with cancelled/paused subscription
    const inactiveCustomer = await env.DB.prepare(`
      SELECT email, subscription_status, created_at, subscription_id FROM customers 
      WHERE email = ? AND subscription_status IN ('cancelled', 'paused', 'inactive')
    `).bind(email).first();
    
    if (inactiveCustomer) {
      console.log(`Duplicate check: ${email} has inactive subscription (${inactiveCustomer.subscription_status})`);
      
      return createResponse({ 
        isDuplicate: false,
        isReturningCustomer: true,
        status: inactiveCustomer.subscription_status,
        message: `Welcome back! You previously had a ${inactiveCustomer.subscription_status} subscription`,
        subscriptionInfo: {
          email: inactiveCustomer.email,
          status: inactiveCustomer.subscription_status,
          createdAt: inactiveCustomer.created_at
        },
        actionRequired: 'allow_subscription'
      });
    }
    
    // No existing customer - new subscription allowed
    console.log(`Duplicate check: ${email} is new customer`);
    
    return createResponse({ 
      isDuplicate: false,
      isReturningCustomer: false,
      message: 'Email is available for new subscription',
      actionRequired: 'allow_subscription'
    });
    
  } catch (error) {
    console.error('Duplicate check error:', error);
    return createResponse({ 
      error: 'Failed to check for duplicates' 
    }, 500);
  }
}

/**
 * Handle manual license creation for users who paid but didn't receive license
 * SECURITY: This should be protected with an admin key in production
 */
async function handleManualLicenseCreation(request, env) {
  try {
    const { email, name, adminKey, subscriptionId } = await request.json();
    
    // Simple admin key check (in production, use a secure admin key)
    if (adminKey !== 'pospal-admin-2024') {
      return createResponse({ error: 'Unauthorized' }, 401);
    }
    
    if (!email || !name) {
      return createResponse({ error: 'Missing required fields: email, name' }, 400);
    }
    
    if (!isValidEmail(email)) {
      return createResponse({ error: 'Invalid email format' }, 400);
    }
    
    // Check if customer already exists
    const existingCustomer = await env.DB.prepare(`
      SELECT * FROM customers WHERE email = ?
    `).bind(email).first();
    
    if (existingCustomer) {
      // Resend the existing license
      await sendWelcomeEmail(env, existingCustomer.id, existingCustomer.email, existingCustomer.name, existingCustomer.unlock_token);
      
      return createResponse({
        success: true,
        message: 'License email resent to existing customer',
        customer_id: existingCustomer.id,
        unlock_token: existingCustomer.unlock_token
      });
    }
    
    // Create new customer
    const unlockToken = generateUnlockToken();
    const insertResult = await env.DB.prepare(`
      INSERT INTO customers 
      (email, name, unlock_token, subscription_id, subscription_status, created_at, last_seen)
      VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `).bind(
      email,
      name,
      unlockToken,
      subscriptionId || `manual_${Date.now()}`
    ).run();
    
    const customerId = insertResult.meta.last_row_id;
    
    // Log the manual creation
    await logAuditEvent(env.DB, customerId, 'manual_license_created', {
      adminCreated: true,
      subscriptionId: subscriptionId || 'manual',
      timestamp: new Date().toISOString()
    });
    
    // Send welcome email
    await sendWelcomeEmail(env, customerId, email, name, unlockToken);
    
    console.log(`Manual license created for ${email}: ${unlockToken}`);
    
    return createResponse({
      success: true,
      message: 'License created and email sent successfully',
      customer_id: customerId,
      unlock_token: unlockToken
    });
    
  } catch (error) {
    console.error('Manual license creation error:', error);
    return createResponse({ error: 'Failed to create license' }, 500);
  }
}

/**
 * Handle customer lookup by email
 */
async function handleCustomerLookup(request, env) {
  try {
    const { email } = await request.json();
    
    if (!email) {
      return createResponse({ error: 'Missing email field' }, 400);
    }
    
    if (!isValidEmail(email)) {
      return createResponse({ error: 'Invalid email format' }, 400);
    }
    
    // Look up customer
    const customer = await env.DB.prepare(`
      SELECT id, email, name, unlock_token, subscription_status, created_at, last_seen 
      FROM customers WHERE email = ?
    `).bind(email).first();
    
    if (!customer) {
      return createResponse({ 
        found: false, 
        message: 'No account found with this email address. If you recently made a payment, please contact support.' 
      });
    }
    
    // Update last seen
    await env.DB.prepare(`
      UPDATE customers SET last_seen = datetime('now') WHERE id = ?
    `).bind(customer.id).run();
    
    return createResponse({
      found: true,
      customer: {
        email: customer.email,
        name: customer.name,
        unlock_token: customer.unlock_token,
        subscription_status: customer.subscription_status,
        created_at: customer.created_at
      }
    });
    
  } catch (error) {
    console.error('Customer lookup error:', error);
    return createResponse({ error: 'Failed to lookup customer' }, 500);
  }
}

/**
 * Handle license key recovery with enhanced security and rate limiting
 * This is the main endpoint for license recovery with full security features
 */
async function handleLicenseRecovery(request, env) {
  try {
    const { email } = await request.json();
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    
    if (!email) {
      return createResponse({ error: 'Missing email field' }, 400);
    }
    
    if (!isValidEmail(email)) {
      return createResponse({ error: 'Invalid email format' }, 400);
    }
    
    // Check rate limits first
    const rateLimitResult = await checkRateLimit(env.DB, ip, email);
    if (!rateLimitResult.allowed) {
      // Log the blocked attempt
      await logRecoveryAttempt(env.DB, email, ip, userAgent, false, null, {
        blocked: true,
        reason: rateLimitResult.reason,
        message: rateLimitResult.message
      });
      
      return createResponse({ 
        error: rateLimitResult.message,
        rateLimited: true,
        reason: rateLimitResult.reason,
        blockedUntil: rateLimitResult.blockedUntil
      }, 429);
    }
    
    // Look up customer
    const customer = await env.DB.prepare(`
      SELECT * FROM customers WHERE email = ?
    `).bind(email).first();
    
    // Analyze security indicators
    const securityFlags = analyzeSecurityIndicators(request, email, customer);
    
    if (!customer) {
      // Log failed attempt for non-existent customer
      await logRecoveryAttempt(env.DB, email, ip, userAgent, false, null, securityFlags);
      
      // Return generic error to prevent email enumeration
      return createResponse({ 
        error: 'If this email has a POSPal account, a recovery email will be sent within a few minutes.'
      });
    }
    
    // For inactive subscriptions, still send the email but include subscription status info
    const isActive = isSubscriptionActive(customer);
    
    // Send license recovery email (using dedicated template)
    await sendLicenseRecoveryEmail(env, customer.id, customer.email, customer.name, customer.unlock_token, securityFlags);
    
    // Log successful recovery attempt
    await logRecoveryAttempt(env.DB, email, ip, userAgent, true, customer.id, securityFlags);
    
    // Log audit event
    await logAuditEvent(env.DB, customer.id, 'license_recovery_requested', {
      timestamp: new Date().toISOString(),
      ip: ip,
      userAgent: userAgent,
      subscriptionActive: isActive,
      securityLevel: securityFlags.securityLevel,
      securityReason: securityFlags.reason || 'normal'
    });
    
    // Generic success message to prevent information leakage
    return createResponse({
      success: true,
      message: 'If this email has a POSPal account, a recovery email will be sent within a few minutes.',
      // Only include customer info if this is a successful recovery
      ...(customer && {
        customerInfo: {
          subscriptionStatus: customer.subscription_status,
          accountCreated: customer.created_at
        }
      })
    });
    
  } catch (error) {
    console.error('License recovery error:', error);
    return createResponse({ error: 'Failed to process recovery request' }, 500);
  }
}

/**
 * Handle resending license email for existing customers
 * DEPRECATED: This endpoint is kept for backward compatibility
 * Use /recover-license for new implementations
 */
async function handleResendLicenseEmail(request, env) {
  console.warn('DEPRECATED ENDPOINT: /resend-license-email is deprecated. Use /recover-license instead.');
  
  // Forward to the new secure recovery handler
  return handleLicenseRecovery(request, env);
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
      'payment_method_collection': 'always',
      'payment_method_options[card][setup_future_usage]': 'off_session',
      // Additional configuration for better test mode compatibility
      'customer_creation': 'always'
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