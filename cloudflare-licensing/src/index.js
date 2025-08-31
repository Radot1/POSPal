/**
 * POSPal Email + Token Licensing System
 * Cloudflare Worker for webhook handling and license validation
 */

import { 
  generateUnlockToken, 
  isValidEmail, 
  createResponse, 
  handleCORS, 
  logAuditEvent,
  logEmailDelivery,
  updateEmailStatus,
  hashMachineFingerprint,
  isSubscriptionActive
} from './utils.js';

import { 
  getWelcomeEmailTemplate, 
  getPaymentFailureEmailTemplate,
  getRenewalReminderEmailTemplate,
  getMachineSwitchEmailTemplate
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
      case '/instant-validate':
        return handleInstantValidation(request, env);
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
      case '/health':
        return createResponse({ status: 'ok', timestamp: new Date().toISOString() });
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
  
  if (!customerEmail || !subscriptionId) {
    console.error('Missing customer email or subscription ID');
    return createResponse({ error: 'Invalid session data' }, 400);
  }
  
  try {
    // Generate unlock token
    const unlockToken = generateUnlockToken();
    
    // Store customer in database
    const stmt = env.DB.prepare(`
      INSERT OR REPLACE INTO customers 
      (email, name, stripe_customer_id, stripe_session_id, unlock_token, subscription_id, subscription_status, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `);
    
    const result = await stmt.bind(
      customerEmail,
      customerName,
      session.customer,
      session.id,
      unlockToken,
      subscriptionId
    ).run();
    
    const customerId = result.meta.last_row_id;
    
    // Log audit event
    await logAuditEvent(env.DB, customerId, 'payment_success', {
      subscriptionId,
      sessionId: session.id
    });
    
    // Send welcome email with unlock token
    await sendWelcomeEmail(env, customerId, customerEmail, customerName, unlockToken);
    
    console.log(`New customer created: ${customerEmail} with token ${unlockToken}`);
    return createResponse({ success: true, customer_id: customerId });
    
  } catch (error) {
    console.error('Checkout processing error:', error);
    return createResponse({ error: 'Failed to process checkout' }, 500);
  }
}

/**
 * Handle successful payment (renewal)
 */
async function handlePaymentSucceeded(event, env) {
  const invoice = event.data.object;
  const subscriptionId = invoice.subscription;
  
  if (!subscriptionId) {
    return createResponse({ received: true });
  }
  
  try {
    // Update customer subscription status
    const stmt = env.DB.prepare(`
      UPDATE customers 
      SET subscription_status = 'active', payment_failures = 0, last_seen = datetime('now')
      WHERE subscription_id = ?
    `);
    
    await stmt.bind(subscriptionId).run();
    
    console.log(`Payment succeeded for subscription: ${subscriptionId}`);
    return createResponse({ success: true });
    
  } catch (error) {
    console.error('Payment success handling error:', error);
    return createResponse({ error: 'Failed to process payment success' }, 500);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(event, env) {
  const invoice = event.data.object;
  const subscriptionId = invoice.subscription;
  const customerEmail = invoice.customer_email;
  
  if (!subscriptionId) {
    return createResponse({ received: true });
  }
  
  try {
    // Get customer and increment failure count
    const customer = await env.DB.prepare(`
      SELECT id, email, payment_failures FROM customers WHERE subscription_id = ?
    `).bind(subscriptionId).first();
    
    if (!customer) {
      console.error(`Customer not found for subscription: ${subscriptionId}`);
      return createResponse({ error: 'Customer not found' }, 404);
    }
    
    const newFailureCount = (customer.payment_failures || 0) + 1;
    
    // Update failure count
    const updateStmt = env.DB.prepare(`
      UPDATE customers 
      SET payment_failures = ?, subscription_status = CASE 
        WHEN ? >= 3 THEN 'inactive' 
        ELSE subscription_status 
      END
      WHERE subscription_id = ?
    `);
    
    await updateStmt.bind(newFailureCount, newFailureCount, subscriptionId).run();
    
    // Log audit event
    await logAuditEvent(env.DB, customer.id, 'payment_failed', {
      failureCount: newFailureCount,
      subscriptionId
    });
    
    // Send payment failure email
    await sendPaymentFailureEmail(env, customer.id, customerEmail || customer.email, 'Customer');
    
    console.log(`Payment failed for ${customer.email}, failure count: ${newFailureCount}`);
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
 * Handle license validation requests
 */
async function handleLicenseValidation(request, env) {
  try {
    const { email, token, machineFingerprint } = await request.json();
    
    if (!email || !token || !machineFingerprint) {
      return createResponse({ 
        valid: false, 
        error: 'Missing required fields' 
      }, 400);
    }
    
    if (!isValidEmail(email)) {
      return createResponse({ 
        valid: false, 
        error: 'Invalid email format' 
      }, 400);
    }
    
    // Look up customer
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND unlock_token = ?
    `).bind(email, token).first();
    
    if (!customer) {
      return createResponse({ 
        valid: false, 
        error: 'Invalid email or unlock token' 
      });
    }
    
    // Check subscription status
    if (!isSubscriptionActive(customer)) {
      return createResponse({ 
        valid: false, 
        error: 'Subscription is not active' 
      });
    }
    
    // Hash machine fingerprint for storage
    const hashedFingerprint = await hashMachineFingerprint(machineFingerprint);
    
    // Check if machine has changed
    const machineChanged = customer.machine_fingerprint && 
                          customer.machine_fingerprint !== hashedFingerprint;
    
    // Update customer with new machine fingerprint and last seen
    const updateStmt = env.DB.prepare(`
      UPDATE customers 
      SET machine_fingerprint = ?, last_seen = datetime('now'), last_validation = datetime('now')
      WHERE id = ?
    `);
    
    await updateStmt.bind(hashedFingerprint, customer.id).run();
    
    // Log validation event
    await logAuditEvent(env.DB, customer.id, 'validation', {
      machineChanged,
      oldMachine: customer.machine_fingerprint,
      newMachine: hashedFingerprint
    });
    
    // Send machine switch notification if needed
    if (machineChanged) {
      await sendMachineSwitchEmail(env, customer.id, customer.email, 'Customer');
      
      await logAuditEvent(env.DB, customer.id, 'machine_switch', {
        oldMachine: customer.machine_fingerprint,
        newMachine: hashedFingerprint
      });
    }
    
    console.log(`License validated for ${email}, machine changed: ${machineChanged}`);
    
    return createResponse({
      valid: true,
      customerName: customer.email.split('@')[0], // Simple name extraction
      subscriptionStatus: customer.subscription_status,
      machineChanged
    });
    
  } catch (error) {
    console.error('Validation error:', error);
    return createResponse({ 
      valid: false, 
      error: 'Validation failed' 
    }, 500);
  }
}

/**
 * Handle instant validation after payment (for embedded flow)
 */
async function handleInstantValidation(request, env) {
  try {
    const { email, stripeSessionId, machineFingerprint } = await request.json();
    
    if (!email || !stripeSessionId || !machineFingerprint) {
      return createResponse({ 
        valid: false, 
        error: 'Missing required fields' 
      }, 400);
    }
    
    if (!isValidEmail(email)) {
      return createResponse({ 
        valid: false, 
        error: 'Invalid email format' 
      }, 400);
    }
    
    // Look up customer by email and verify they have a recent payment
    const customer = await env.DB.prepare(`
      SELECT * FROM customers 
      WHERE email = ? AND stripe_session_id = ? AND subscription_status = 'active'
    `).bind(email, stripeSessionId).first();
    
    if (!customer) {
      return createResponse({ 
        valid: false, 
        error: 'No valid subscription found for this payment session' 
      });
    }
    
    // Hash machine fingerprint for storage
    const hashedFingerprint = await hashMachineFingerprint(machineFingerprint);
    
    // Update customer with machine fingerprint
    await env.DB.prepare(`
      UPDATE customers 
      SET machine_fingerprint = ?, last_seen = datetime('now'), last_validation = datetime('now')
      WHERE id = ?
    `).bind(hashedFingerprint, customer.id).run();
    
    // Log successful validation
    await logAuditEvent(env, customer.id, 'INSTANT_VALIDATION_SUCCESS', {
      sessionId: stripeSessionId,
      machineFingerprint: hashedFingerprint
    });
    
    return createResponse({ 
      valid: true,
      unlockToken: customer.unlock_token,
      customerName: customer.name
    });
    
  } catch (error) {
    console.error('Instant validation error:', error);
    return createResponse({ 
      valid: false, 
      error: 'Validation failed' 
    }, 500);
  }
}

/**
 * Handle checkout session creation
 */
async function handleCreateCheckout(request, env) {
  try {
    const { email, name, successUrl, cancelUrl } = await request.json();
    
    if (!email || !name) {
      return createResponse({ error: 'Missing required fields' }, 400);
    }
    
    if (!isValidEmail(email)) {
      return createResponse({ error: 'Invalid email' }, 400);
    }
    
    // Create Stripe checkout session
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

    const checkoutSession = await stripe.post('/checkout/sessions', {
      'payment_method_types[0]': 'card',
      'line_items[0][price]': env.STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      'mode': 'subscription',
      'customer_email': email,
      'metadata[customer_name]': name,
      'success_url': successUrl || 'https://pospal.gr/success.html?session_id={CHECKOUT_SESSION_ID}',
      'cancel_url': cancelUrl || 'https://pospal.gr/unlock-pospal.html',
      'allow_promotion_codes': 'true'
    });

    if (checkoutSession.error) {
      console.error('Stripe checkout error:', checkoutSession.error);
      return createResponse({ error: 'Failed to create checkout session' }, 500);
    }

    return createResponse({
      id: checkoutSession.id,
      url: checkoutSession.url
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
        from: 'POSPal <billing@pospal.gr>',
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
    await logAuditEvent(env, customer.id, 'SESSION_START', {
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
    await logAuditEvent(env, customer.id, 'SESSION_TAKEOVER', {
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