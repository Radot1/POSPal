/**
 * POSPal Licensing System v2.0 - Stripe Integration
 * Handles Stripe Checkout, Subscriptions, and Webhooks
 */

import { createResponse, logEvent, generateSecureToken } from './utils.js';
import { sendWelcomeEmail, sendPaymentFailureEmail, sendGracePeriodEmail } from './email-service.js';

/**
 * Create Stripe Checkout Session for subscription
 */
export async function createCheckoutSession(request, env) {
  try {
    const { email, name, restaurantName } = await request.json();
    
    if (!email || !name) {
      return createResponse({ error: 'Missing required fields: email, name' }, 400);
    }
    
    // Check if customer already exists
    const existingCustomer = await env.DB.prepare(`
      SELECT id, stripe_customer_id FROM customers WHERE email = ?
    `).bind(email.toLowerCase()).first();
    
    let stripeCustomerId = existingCustomer?.stripe_customer_id;
    
    // Create Stripe customer if doesn't exist
    if (!stripeCustomerId) {
      const customerResponse = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          email: email,
          name: name,
          'metadata[restaurant_name]': restaurantName || '',
          'metadata[source]': 'pospal_v2'
        })
      });
      
      if (!customerResponse.ok) {
        const error = await customerResponse.text();
        console.error('Stripe customer creation failed:', error);
        return createResponse({ error: 'Failed to create customer' }, 500);
      }
      
      const customer = await customerResponse.json();
      stripeCustomerId = customer.id;
      
      // Update our database with Stripe customer ID
      if (existingCustomer) {
        await env.DB.prepare(`
          UPDATE customers SET stripe_customer_id = ? WHERE id = ?
        `).bind(stripeCustomerId, existingCustomer.id).run();
      }
    }
    
    // Create Stripe Price (€20/month) - or use existing price ID
    let priceId = await getSystemConfig(env.DB, 'stripe_price_id');
    
    if (!priceId) {
      const priceResponse = await fetch('https://api.stripe.com/v1/prices', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          unit_amount: '2000', // €20.00 in cents
          currency: 'eur',
          recurring: JSON.stringify({ interval: 'month' }),
          product_data: JSON.stringify({
            name: 'POSPal Monthly Subscription',
            description: 'Professional Point of Sale System for Restaurants'
          })
        })
      });
      
      if (!priceResponse.ok) {
        const error = await priceResponse.text();
        console.error('Stripe price creation failed:', error);
        return createResponse({ error: 'Failed to create price' }, 500);
      }
      
      const price = await priceResponse.json();
      priceId = price.id;
      
      // Save price ID for future use
      await env.DB.prepare(`
        INSERT OR REPLACE INTO system_config (key, value, updated_at)
        VALUES ('stripe_price_id', ?, datetime('now'))
      `).bind(priceId).run();
    }
    
    // Create Checkout Session
    const baseUrl = 'http://localhost:5000';
      
    const sessionResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: stripeCustomerId,
        mode: 'subscription',
        'payment_method_types[]': 'card',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/subscribe.html?cancelled=true`,
        'metadata[customer_email]': email,
        'metadata[customer_name]': name,
        'metadata[restaurant_name]': restaurantName || '',
        'metadata[source]': 'pospal_v2'
      })
    });
    
    if (!sessionResponse.ok) {
      const error = await sessionResponse.text();
      console.error('Stripe session creation failed:', error);
      return createResponse({ error: 'Failed to create checkout session' }, 500);
    }
    
    const session = await sessionResponse.json();
    
    // Store session ID for tracking
    if (existingCustomer) {
      await env.DB.prepare(`
        UPDATE customers SET stripe_session_id = ? WHERE id = ?
      `).bind(session.id, existingCustomer.id).run();
    }
    
    return createResponse({
      success: true,
      sessionId: session.id,
      checkoutUrl: session.url
    });
    
  } catch (error) {
    console.error('Checkout session creation error:', error);
    return createResponse({ error: 'Internal server error' }, 500);
  }
}

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(request, env) {
  try {
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      console.error('Missing Stripe signature');
      return createResponse({ error: 'Missing signature' }, 400);
    }
    
    const payload = await request.text();
    
    // Verify webhook signature
    const verified = await verifyStripeWebhook(payload, signature, env.STRIPE_WEBHOOK_SECRET);
    if (!verified) {
      console.error('Invalid Stripe signature');
      return createResponse({ error: 'Invalid signature' }, 400);
    }
    
    const event = JSON.parse(payload);
    console.log(`Processing Stripe event: ${event.type}`);
    
    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed':
        return await handleCheckoutCompleted(event.data.object, env);
        
      case 'invoice.payment_succeeded':
        return await handlePaymentSucceeded(event.data.object, env);
        
      case 'invoice.payment_failed':
        return await handlePaymentFailed(event.data.object, env);
        
      case 'customer.subscription.created':
        return await handleSubscriptionCreated(event.data.object, env);
        
      case 'customer.subscription.updated':
        return await handleSubscriptionUpdated(event.data.object, env);
        
      case 'customer.subscription.deleted':
        return await handleSubscriptionDeleted(event.data.object, env);
        
      default:
        console.log(`Unhandled event type: ${event.type}`);
        return createResponse({ received: true });
    }
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    return createResponse({ error: 'Webhook processing failed' }, 500);
  }
}

/**
 * Handle successful checkout completion
 */
async function handleCheckoutCompleted(session, env) {
  try {
    const customerEmail = session.customer_details?.email || session.metadata?.customer_email;
    const customerName = session.customer_details?.name || session.metadata?.customer_name;
    const restaurantName = session.metadata?.restaurant_name;
    
    console.log(`Checkout completed for: ${customerEmail}`);
    
    // Find or create customer record
    let customer = await env.DB.prepare(`
      SELECT id FROM customers WHERE email = ?
    `).bind(customerEmail.toLowerCase()).first();
    
    if (!customer) {
      // Create customer record if it doesn't exist
      // For Stripe customers, we set a placeholder password hash that can be updated later
      const result = await env.DB.prepare(`
        INSERT INTO customers 
        (email, password_hash, name, restaurant_name, stripe_customer_id, stripe_session_id, 
         subscription_status, email_verified, created_at)
        VALUES (?, 'stripe_customer_pending_password', ?, ?, ?, ?, 'active', true, datetime('now'))
      `).bind(
        customerEmail.toLowerCase(),
        customerName,
        restaurantName || null,
        session.customer,
        session.id
      ).run();
      
      customer = { id: result.meta.last_row_id };
    } else {
      // Update existing customer
      await env.DB.prepare(`
        UPDATE customers 
        SET stripe_customer_id = ?, stripe_session_id = ?, 
            subscription_status = 'active', email_verified = true
        WHERE id = ?
      `).bind(session.customer, session.id, customer.id).run();
    }
    
    // Log subscription event
    await logEvent(env.DB, customer.id, 'subscription_created', {
      sessionId: session.id,
      stripeCustomerId: session.customer,
      subscriptionId: session.subscription
    });
    
    // Record subscription event
    await env.DB.prepare(`
      INSERT INTO subscription_events 
      (customer_id, event_type, subscription_id, amount_cents, currency, 
       stripe_event_id, details, created_at)
      VALUES (?, 'created', ?, 2000, 'eur', ?, ?, datetime('now'))
    `).bind(
      customer.id,
      session.subscription,
      session.id,
      JSON.stringify({ session_mode: session.mode })
    ).run();
    
    // Send welcome email (non-blocking)
    const emailToken = generateSecureToken();
    await sendWelcomeEmail(env, customer.id, customerEmail, customerName, emailToken);
    
    console.log(`Subscription activated for customer: ${customer.id}`);
    return createResponse({ received: true, processed: 'checkout_completed' });
    
  } catch (error) {
    console.error('Checkout completion handling error:', error);
    return createResponse({ error: 'Failed to process checkout completion' }, 500);
  }
}

/**
 * Handle successful payment (renewals)
 */
async function handlePaymentSucceeded(invoice, env) {
  try {
    if (!invoice.subscription) {
      console.log('Ignoring non-subscription invoice payment');
      return createResponse({ received: true, ignored: 'non_subscription' });
    }
    
    // Find customer by Stripe customer ID
    const customer = await env.DB.prepare(`
      SELECT id, email, name FROM customers WHERE stripe_customer_id = ?
    `).bind(invoice.customer).first();
    
    if (!customer) {
      console.error(`Customer not found for Stripe ID: ${invoice.customer}`);
      return createResponse({ error: 'Customer not found' }, 404);
    }
    
    // Update subscription status and clear grace period
    await env.DB.prepare(`
      UPDATE customers 
      SET subscription_status = 'active', grace_period_until = NULL, payment_failures = 0
      WHERE id = ?
    `).bind(customer.id).run();
    
    // Log renewal event
    await logEvent(env.DB, customer.id, 'payment_succeeded', {
      invoiceId: invoice.id,
      subscriptionId: invoice.subscription,
      amount: invoice.amount_paid
    });
    
    // Record subscription event
    await env.DB.prepare(`
      INSERT INTO subscription_events 
      (customer_id, event_type, subscription_id, amount_cents, currency, 
       stripe_event_id, details, created_at)
      VALUES (?, 'renewed', ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      customer.id,
      invoice.subscription,
      invoice.amount_paid,
      invoice.currency,
      invoice.id,
      JSON.stringify({ period_start: invoice.period_start, period_end: invoice.period_end })
    ).run();
    
    console.log(`Payment successful for customer: ${customer.id}`);
    return createResponse({ received: true, processed: 'payment_succeeded' });
    
  } catch (error) {
    console.error('Payment success handling error:', error);
    return createResponse({ error: 'Failed to process payment success' }, 500);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice, env) {
  try {
    if (!invoice.subscription) {
      console.log('Ignoring non-subscription invoice failure');
      return createResponse({ received: true, ignored: 'non_subscription' });
    }
    
    // Find customer
    const customer = await env.DB.prepare(`
      SELECT id, email, name, payment_failures FROM customers 
      WHERE stripe_customer_id = ?
    `).bind(invoice.customer).first();
    
    if (!customer) {
      console.error(`Customer not found for Stripe ID: ${invoice.customer}`);
      return createResponse({ error: 'Customer not found' }, 404);
    }
    
    const failureCount = (customer.payment_failures || 0) + 1;
    
    // Calculate grace period (7 days for paying customers)
    const gracePeriodDays = 7;
    const gracePeriodEnd = new Date();
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + gracePeriodDays);
    
    // Update customer status
    await env.DB.prepare(`
      UPDATE customers 
      SET subscription_status = 'past_due', payment_failures = ?, 
          grace_period_until = ?
      WHERE id = ?
    `).bind(failureCount, gracePeriodEnd.toISOString(), customer.id).run();
    
    // Log payment failure
    await logEvent(env.DB, customer.id, 'payment_failed', {
      invoiceId: invoice.id,
      subscriptionId: invoice.subscription,
      failureCount,
      gracePeriodEnd: gracePeriodEnd.toISOString()
    });
    
    // Record subscription event
    await env.DB.prepare(`
      INSERT INTO subscription_events 
      (customer_id, event_type, subscription_id, stripe_event_id, details, created_at)
      VALUES (?, 'failed', ?, ?, ?, datetime('now'))
    `).bind(
      customer.id,
      invoice.subscription,
      invoice.id,
      JSON.stringify({ 
        attempt_count: invoice.attempt_count,
        failure_count: failureCount,
        grace_period_end: gracePeriodEnd.toISOString()
      })
    ).run();
    
    // Send payment failure email (non-blocking)
    await sendPaymentFailureEmail(env, customer.id, customer.email, customer.name, gracePeriodEnd.toISOString());
    
    console.log(`Payment failed for customer: ${customer.id}, attempt: ${failureCount}`);
    return createResponse({ received: true, processed: 'payment_failed' });
    
  } catch (error) {
    console.error('Payment failure handling error:', error);
    return createResponse({ error: 'Failed to process payment failure' }, 500);
  }
}

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreated(subscription, env) {
  try {
    // Update customer record with subscription ID
    await env.DB.prepare(`
      UPDATE customers 
      SET subscription_id = ?, subscription_status = 'active'
      WHERE stripe_customer_id = ?
    `).bind(subscription.id, subscription.customer).run();
    
    console.log(`Subscription created: ${subscription.id}`);
    return createResponse({ received: true, processed: 'subscription_created' });
    
  } catch (error) {
    console.error('Subscription creation handling error:', error);
    return createResponse({ error: 'Failed to process subscription creation' }, 500);
  }
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdated(subscription, env) {
  try {
    const status = subscription.status; // active, past_due, canceled, etc.
    
    await env.DB.prepare(`
      UPDATE customers 
      SET subscription_status = ?
      WHERE subscription_id = ?
    `).bind(status, subscription.id).run();
    
    console.log(`Subscription updated: ${subscription.id}, status: ${status}`);
    return createResponse({ received: true, processed: 'subscription_updated' });
    
  } catch (error) {
    console.error('Subscription update handling error:', error);
    return createResponse({ error: 'Failed to process subscription update' }, 500);
  }
}

/**
 * Handle subscription deletion/cancellation
 */
async function handleSubscriptionDeleted(subscription, env) {
  try {
    // Update customer status
    await env.DB.prepare(`
      UPDATE customers 
      SET subscription_status = 'cancelled'
      WHERE subscription_id = ?
    `).bind(subscription.id).run();
    
    // Find customer for logging
    const customer = await env.DB.prepare(`
      SELECT id FROM customers WHERE subscription_id = ?
    `).bind(subscription.id).first();
    
    if (customer) {
      await logEvent(env.DB, customer.id, 'subscription_cancelled', {
        subscriptionId: subscription.id,
        canceledAt: subscription.canceled_at
      });
    }
    
    console.log(`Subscription cancelled: ${subscription.id}`);
    return createResponse({ received: true, processed: 'subscription_deleted' });
    
  } catch (error) {
    console.error('Subscription deletion handling error:', error);
    return createResponse({ error: 'Failed to process subscription deletion' }, 500);
  }
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
 * Verify Stripe webhook signature
 */
async function verifyStripeWebhook(payload, signature, secret) {
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