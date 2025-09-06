/**
 * POSPal Licensing System v2.0
 * Secure Email/Password Authentication + Stripe Subscriptions
 * No hardcoded secrets - all from environment variables
 */

import { 
  hashPassword, 
  verifyPassword, 
  generateJWT, 
  verifyJWT,
  generateSecureToken,
  validateEmail,
  createResponse,
  handleCORS,
  logEvent
} from './utils.js';

import { 
  sendWelcomeEmail,
  sendPasswordResetEmail, 
  sendPaymentFailureEmail,
  sendGracePeriodEmail,
  sendSessionTakeoverEmail
} from './email-service.js';

import {
  createCheckoutSession,
  handleStripeWebhook
} from './stripe-handler.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }
    
    // Maintenance mode check (except for status endpoint)
    if (url.pathname !== '/status' && url.pathname !== '/health') {
      const maintenanceMode = await getSystemConfig(env.DB, 'maintenance_mode');
      if (maintenanceMode === 'true') {
        return createResponse({ 
          maintenance: true,
          message: 'System is currently under maintenance. Please try again later.'
        }, 503);
      }
    }
    
    // Route requests
    switch (url.pathname) {
      // System endpoints
      case '/health':
      case '/status':
        return handleSystemStatus(env);
        
      // Authentication endpoints  
      case '/auth/register':
        return handleRegister(request, env);
      case '/auth/login':
        return handleLogin(request, env);
      case '/auth/refresh':
        return handleRefreshToken(request, env);
      case '/auth/logout':
        return handleLogout(request, env);
      case '/auth/reset-password':
        return handlePasswordReset(request, env);
      case '/auth/confirm-reset':
        return handlePasswordResetConfirm(request, env);
        
      // Session management
      case '/session/heartbeat':
        return handleSessionHeartbeat(request, env);
      case '/session/takeover':
        return handleSessionTakeover(request, env);
      case '/session/status':
        return handleSessionStatus(request, env);
        
      // Stripe Checkout and Payment Management
      case '/create-checkout-session':
        return createCheckoutSession(request, env);
      case '/create-portal-session':
        return handleCustomerPortal(request, env);
      case '/checkout-success':
        return handleCheckoutSuccess(request, env);
        
      // Account Management
      case '/account-info':
        return handleAccountInfo(request, env);
      case '/cancel-subscription':
        return handleCancelSubscription(request, env);
      case '/export-data':
        return handleExportData(request, env);
        
      // Subscription management (legacy)
      case '/subscription/create':
        return createCheckoutSession(request, env);
      case '/subscription/status':
        return handleSubscriptionStatus(request, env);
      case '/subscription/portal':
        return handleCustomerPortal(request, env);
        
      // Stripe webhooks
      case '/webhook/stripe':
        return handleStripeWebhook(request, env);
        
      // Admin endpoints (future)
      case '/admin/config':
        return handleAdminConfig(request, env);
        
      default:
        return createResponse({ error: 'Endpoint not found' }, 404);
    }
  }
};

/**
 * System status - always available even during maintenance
 */
async function handleSystemStatus(env) {
  const maintenanceMode = await getSystemConfig(env.DB, 'maintenance_mode');
  const appVersion = await getSystemConfig(env.DB, 'app_version');
  
  return createResponse({
    status: 'ok',
    maintenance: maintenanceMode === 'true',
    version: appVersion || '2.0.0',
    environment: env.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString()
  });
}

/**
 * Handle user registration (subscription signup)
 */
async function handleRegister(request, env) {
  try {
    const { email, password, name, restaurantName } = await request.json();
    
    // Validate input
    if (!email || !password || !name) {
      return createResponse({ error: 'Missing required fields: email, password, name' }, 400);
    }
    
    if (!validateEmail(email)) {
      return createResponse({ error: 'Invalid email format' }, 400);
    }
    
    if (password.length < 8) {
      return createResponse({ error: 'Password must be at least 8 characters' }, 400);
    }
    
    // Check if user already exists
    const existingUser = await env.DB.prepare(`
      SELECT id FROM customers WHERE email = ?
    `).bind(email.toLowerCase()).first();
    
    if (existingUser) {
      return createResponse({ error: 'Email already registered' }, 400);
    }
    
    // Hash password
    const passwordHash = await hashPassword(password);
    
    // Generate email verification token
    const emailToken = generateSecureToken();
    
    // Create customer record
    const stmt = env.DB.prepare(`
      INSERT INTO customers 
      (email, password_hash, name, restaurant_name, email_verify_token, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    
    const result = await stmt.bind(
      email.toLowerCase(),
      passwordHash,
      name,
      restaurantName || null,
      emailToken
    ).run();
    
    const customerId = result.meta.last_row_id;
    
    // Log registration event
    await logEvent(env.DB, customerId, 'user_registered', {
      email: email.toLowerCase(),
      hasRestaurantName: !!restaurantName
    });
    
    // Send welcome email (non-blocking)
    ctx.waitUntil(sendWelcomeEmail(env, customerId, email, name, emailToken));
    
    return createResponse({
      success: true,
      message: 'Account created successfully. Please check your email to verify your account.',
      customerId: customerId
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    return createResponse({ error: 'Registration failed' }, 500);
  }
}

/**
 * Handle user login
 */
async function handleLogin(request, env) {
  try {
    const { email, password, deviceInfo } = await request.json();
    
    if (!email || !password) {
      return createResponse({ error: 'Missing email or password' }, 400);
    }
    
    // Get customer record
    const customer = await env.DB.prepare(`
      SELECT id, email, password_hash, name, restaurant_name, 
             subscription_status, failed_login_attempts, locked_until,
             grace_period_until, trial_ends_at
      FROM customers 
      WHERE email = ?
    `).bind(email.toLowerCase()).first();
    
    if (!customer) {
      return createResponse({ error: 'Invalid email or password' }, 401);
    }
    
    // Check if account is locked
    if (customer.locked_until && new Date(customer.locked_until) > new Date()) {
      const unlockTime = new Date(customer.locked_until).toLocaleString();
      return createResponse({ 
        error: `Account is locked until ${unlockTime}. Please try again later.` 
      }, 429);
    }
    
    // Verify password
    const validPassword = await verifyPassword(password, customer.password_hash);
    
    if (!validPassword) {
      // Increment failed attempts
      const failedAttempts = (customer.failed_login_attempts || 0) + 1;
      const maxAttempts = parseInt(await getSystemConfig(env.DB, 'max_login_attempts') || '10');
      const lockoutMinutes = parseInt(await getSystemConfig(env.DB, 'lockout_duration_minutes') || '30');
      
      let lockUntil = null;
      if (failedAttempts >= maxAttempts) {
        lockUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
      }
      
      await env.DB.prepare(`
        UPDATE customers 
        SET failed_login_attempts = ?, locked_until = ?
        WHERE id = ?
      `).bind(failedAttempts, lockUntil?.toISOString() || null, customer.id).run();
      
      await logEvent(env.DB, customer.id, 'login_failed', {
        failedAttempts,
        locked: !!lockUntil
      });
      
      return createResponse({ error: 'Invalid email or password' }, 401);
    }
    
    // Check subscription status and grace periods
    const subscriptionValid = await checkSubscriptionAccess(customer);
    
    if (!subscriptionValid.hasAccess) {
      return createResponse({
        error: 'Subscription required',
        subscriptionStatus: subscriptionValid
      }, 402);
    }
    
    // Check for existing active sessions
    const existingSession = await env.DB.prepare(`
      SELECT session_id, device_info, last_heartbeat 
      FROM active_sessions 
      WHERE customer_id = ? AND status = 'active'
      AND last_heartbeat > datetime('now', '-2 minutes')
      ORDER BY last_heartbeat DESC
      LIMIT 1
    `).bind(customer.id).first();
    
    if (existingSession) {
      return createResponse({
        error: 'Another session is active',
        conflict: true,
        conflictInfo: {
          deviceInfo: JSON.parse(existingSession.device_info || '{}'),
          lastSeen: existingSession.last_heartbeat
        }
      }, 409);
    }
    
    // Clear failed login attempts
    await env.DB.prepare(`
      UPDATE customers 
      SET failed_login_attempts = 0, locked_until = NULL, last_login = datetime('now')
      WHERE id = ?
    `).bind(customer.id).run();
    
    // Create new session
    const sessionId = generateSecureToken();
    const accessToken = await generateJWT({
      customerId: customer.id,
      email: customer.email,
      sessionId: sessionId
    }, env.JWT_SECRET);
    
    const refreshToken = generateSecureToken();
    
    await env.DB.prepare(`
      INSERT INTO active_sessions 
      (customer_id, session_id, access_token, refresh_token, device_info, 
       ip_address, user_agent, created_at, last_heartbeat)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      customer.id,
      sessionId,
      accessToken,
      refreshToken,
      JSON.stringify(deviceInfo || {}),
      request.headers.get('cf-connecting-ip') || 'unknown',
      request.headers.get('user-agent') || 'unknown'
    ).run();
    
    // Log successful login
    await logEvent(env.DB, customer.id, 'login_success', {
      sessionId,
      deviceInfo: deviceInfo || {}
    });
    
    return createResponse({
      success: true,
      accessToken,
      refreshToken,
      sessionId,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        restaurantName: customer.restaurant_name
      },
      subscription: subscriptionValid
    });
    
  } catch (error) {
    console.error('Login error:', error);
    return createResponse({ error: 'Login failed' }, 500);
  }
}

/**
 * Helper function to check subscription access including grace periods
 */
async function checkSubscriptionAccess(customer) {
  const now = new Date();
  
  // Check trial period
  if (customer.trial_ends_at && new Date(customer.trial_ends_at) > now) {
    return {
      hasAccess: true,
      type: 'trial',
      expiresAt: customer.trial_ends_at
    };
  }
  
  // Check active subscription
  if (customer.subscription_status === 'active') {
    return {
      hasAccess: true,
      type: 'subscription',
      status: 'active'
    };
  }
  
  // Check grace period
  if (customer.grace_period_until && new Date(customer.grace_period_until) > now) {
    return {
      hasAccess: true,
      type: 'grace_period',
      expiresAt: customer.grace_period_until,
      warning: 'Your subscription has expired but you have grace period access.'
    };
  }
  
  return {
    hasAccess: false,
    type: 'expired',
    needsSubscription: true
  };
}

/**
 * Get system configuration value
 */
async function getSystemConfig(db, key) {
  const config = await db.prepare(`
    SELECT value FROM system_config WHERE key = ?
  `).bind(key).first();
  
  return config?.value || null;
}

/**
 * Handle session heartbeat - keep session alive
 */
async function handleSessionHeartbeat(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return createResponse({ error: 'Missing or invalid authorization' }, 401);
    }
    
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, env.JWT_SECRET);
    
    if (!payload) {
      return createResponse({ error: 'Invalid or expired token' }, 401);
    }
    
    // Update heartbeat
    const result = await env.DB.prepare(`
      UPDATE active_sessions 
      SET last_heartbeat = datetime('now')
      WHERE customer_id = ? AND session_id = ? AND status = 'active'
    `).bind(payload.customerId, payload.sessionId).run();
    
    if (result.changes === 0) {
      return createResponse({ error: 'Session not found or expired' }, 401);
    }
    
    // Get updated subscription status
    const customer = await env.DB.prepare(`
      SELECT subscription_status, grace_period_until, trial_ends_at
      FROM customers WHERE id = ?
    `).bind(payload.customerId).first();
    
    const subscriptionValid = await checkSubscriptionAccess(customer);
    
    return createResponse({
      success: true,
      timestamp: new Date().toISOString(),
      subscription: subscriptionValid
    });
    
  } catch (error) {
    console.error('Heartbeat error:', error);
    return createResponse({ error: 'Heartbeat failed' }, 500);
  }
}

/**
 * Handle checkout success page data
 */
async function handleCheckoutSuccess(request, env) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');
    
    if (!sessionId) {
      return createResponse({ error: 'Missing session_id' }, 400);
    }
    
    // Initialize Stripe
    const stripe = (await import('stripe')).default(env.STRIPE_SECRET_KEY);
    
    // Retrieve checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (!session) {
      return createResponse({ error: 'Session not found' }, 404);
    }
    
    // Get customer details
    const customer = await stripe.customers.retrieve(session.customer);
    const subscription = session.subscription ? 
      await stripe.subscriptions.retrieve(session.subscription) : null;
    
    return createResponse({
      customerEmail: customer.email,
      restaurantName: session.metadata?.restaurant_name || 'Your Restaurant',
      nextBilling: subscription ? 
        new Date(subscription.current_period_end * 1000).toLocaleDateString('el-GR') : 
        'N/A'
    });
    
  } catch (error) {
    console.error('Checkout success error:', error);
    return createResponse({ error: 'Failed to load checkout success data' }, 500);
  }
}

/**
 * Handle account information request
 */
async function handleAccountInfo(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return createResponse({ error: 'Missing or invalid authorization' }, 401);
    }
    
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, env.JWT_SECRET);
    
    if (!payload) {
      return createResponse({ error: 'Invalid or expired token' }, 401);
    }
    
    // Get customer data from database
    const customer = await env.DB.prepare(`
      SELECT id, email, name, restaurant_name, stripe_customer_id,
             subscription_status, created_at
      FROM customers WHERE id = ?
    `).bind(payload.customerId).first();
    
    if (!customer) {
      return createResponse({ error: 'Customer not found' }, 404);
    }
    
    // Initialize Stripe to get subscription details
    const stripe = (await import('stripe')).default(env.STRIPE_SECRET_KEY);
    
    let subscriptionData = {
      status: 'none',
      amount: 20,
      nextBilling: 'N/A',
      cancelAtPeriodEnd: false
    };
    
    if (customer.stripe_customer_id) {
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: customer.stripe_customer_id,
          limit: 1
        });
        
        if (subscriptions.data.length > 0) {
          const subscription = subscriptions.data[0];
          subscriptionData = {
            status: subscription.status,
            amount: Math.round(subscription.items.data[0].price.unit_amount / 100),
            nextBilling: new Date(subscription.current_period_end * 1000).toLocaleDateString('el-GR'),
            cancelAtPeriodEnd: subscription.cancel_at_period_end
          };
        }
      } catch (stripeError) {
        console.error('Stripe API error:', stripeError);
      }
    }
    
    // Get usage statistics
    const stats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 END) as monthly_orders
      FROM user_activity 
      WHERE customer_id = ? AND action LIKE '%order%'
    `).bind(customer.id).first();
    
    return createResponse({
      restaurantName: customer.restaurant_name || customer.name,
      email: customer.email,
      subscription: subscriptionData,
      stats: {
        totalOrders: stats?.total_orders || 0,
        monthlyOrders: stats?.monthly_orders || 0,
        activeTables: 12, // Could be dynamic based on actual data
        uptime: '99.8' // Could be calculated from monitoring data
      }
    });
    
  } catch (error) {
    console.error('Account info error:', error);
    return createResponse({ error: 'Failed to load account information' }, 500);
  }
}

/**
 * Handle Stripe Customer Portal creation
 */
async function handleCustomerPortal(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return createResponse({ error: 'Missing or invalid authorization' }, 401);
    }
    
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, env.JWT_SECRET);
    
    if (!payload) {
      return createResponse({ error: 'Invalid or expired token' }, 401);
    }
    
    // Get customer Stripe ID
    const customer = await env.DB.prepare(`
      SELECT stripe_customer_id FROM customers WHERE id = ?
    `).bind(payload.customerId).first();
    
    if (!customer?.stripe_customer_id) {
      return createResponse({ error: 'No Stripe customer found' }, 404);
    }
    
    // Initialize Stripe
    const stripe = (await import('stripe')).default(env.STRIPE_SECRET_KEY);
    
    // Create customer portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: `${new URL(request.url).origin}/account`,
    });
    
    return createResponse({ url: session.url });
    
  } catch (error) {
    console.error('Customer portal error:', error);
    return createResponse({ error: 'Failed to create customer portal session' }, 500);
  }
}

/**
 * Handle subscription cancellation
 */
async function handleCancelSubscription(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return createResponse({ error: 'Missing or invalid authorization' }, 401);
    }
    
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, env.JWT_SECRET);
    
    if (!payload) {
      return createResponse({ error: 'Invalid or expired token' }, 401);
    }
    
    // Get customer Stripe ID
    const customer = await env.DB.prepare(`
      SELECT stripe_customer_id FROM customers WHERE id = ?
    `).bind(payload.customerId).first();
    
    if (!customer?.stripe_customer_id) {
      return createResponse({ error: 'No Stripe customer found' }, 404);
    }
    
    // Initialize Stripe
    const stripe = (await import('stripe')).default(env.STRIPE_SECRET_KEY);
    
    // Get active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.stripe_customer_id,
      status: 'active',
      limit: 1
    });
    
    if (subscriptions.data.length === 0) {
      return createResponse({ error: 'No active subscription found' }, 400);
    }
    
    const subscription = subscriptions.data[0];
    
    // Cancel at period end (not immediately)
    const cancelledSubscription = await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: true,
      metadata: {
        cancelled_by: 'customer',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'customer_request'
      }
    });
    
    // Log cancellation in database
    await logEvent(env.DB, payload.customerId, 'subscription_cancelled', {
      subscription_id: subscription.id,
      cancelled_at_period_end: true
    });
    
    return createResponse({
      success: true,
      message: 'Subscription cancelled successfully',
      activeUntil: new Date(subscription.current_period_end * 1000).toLocaleDateString('el-GR')
    });
    
  } catch (error) {
    console.error('Subscription cancellation error:', error);
    return createResponse({ error: 'Failed to cancel subscription' }, 500);
  }
}

/**
 * Handle data export request
 */
async function handleExportData(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return createResponse({ error: 'Missing or invalid authorization' }, 401);
    }
    
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, env.JWT_SECRET);
    
    if (!payload) {
      return createResponse({ error: 'Invalid or expired token' }, 401);
    }
    
    // Get customer data
    const customer = await env.DB.prepare(`
      SELECT id, email, name, restaurant_name, created_at
      FROM customers WHERE id = ?
    `).bind(payload.customerId).first();
    
    if (!customer) {
      return createResponse({ error: 'Customer not found' }, 404);
    }
    
    // Get user activity log
    const activities = await env.DB.prepare(`
      SELECT action, details, created_at
      FROM user_activity
      WHERE customer_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).bind(customer.id).all();
    
    // Compile export data
    const exportData = {
      account: {
        restaurant_name: customer.restaurant_name,
        name: customer.name,
        email: customer.email,
        created_at: customer.created_at
      },
      activity_log: activities.results.map(activity => ({
        action: activity.action,
        details: activity.details ? JSON.parse(activity.details) : null,
        timestamp: activity.created_at
      })),
      export_info: {
        generated_at: new Date().toISOString(),
        format: 'JSON',
        version: '1.0'
      }
    };
    
    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="pospal-data-export-${Date.now()}.json"`
      }
    });
    
  } catch (error) {
    console.error('Data export error:', error);
    return createResponse({ error: 'Failed to export data' }, 500);
  }
}

/**
 * Handle subscription status check (legacy endpoint)
 */
async function handleSubscriptionStatus(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return createResponse({ error: 'Missing or invalid authorization' }, 401);
    }
    
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, env.JWT_SECRET);
    
    if (!payload) {
      return createResponse({ error: 'Invalid or expired token' }, 401);
    }
    
    // Get customer subscription status
    const customer = await env.DB.prepare(`
      SELECT subscription_status, grace_period_until, trial_ends_at
      FROM customers WHERE id = ?
    `).bind(payload.customerId).first();
    
    if (!customer) {
      return createResponse({ error: 'Customer not found' }, 404);
    }
    
    const subscriptionValid = await checkSubscriptionAccess(customer);
    
    return createResponse({
      subscription: subscriptionValid,
      customerId: payload.customerId
    });
    
  } catch (error) {
    console.error('Subscription status error:', error);
    return createResponse({ error: 'Failed to check subscription status' }, 500);
  }
}