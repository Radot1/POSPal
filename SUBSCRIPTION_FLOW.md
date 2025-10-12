# POSPal Subscription Flow Documentation
**Version**: 2.0
**Last Updated**: October 11, 2025
**Status**: Production Implementation

---

## 📋 Table of Contents
1. [Overview](#overview)
2. [New Customer Signup](#new-customer-signup)
3. [Instant Post-Payment Activation](#instant-post-payment-activation)
4. [License Validation](#license-validation)
5. [Monthly Renewal](#monthly-renewal)
6. [Payment Failure](#payment-failure)
7. [Subscription Cancellation](#subscription-cancellation)
8. [Machine Switch Detection](#machine-switch-detection)
9. [Session Management](#session-management)
10. [Customer Portal Access](#customer-portal-access)

---

## 🎯 Overview

POSPal uses a **monthly subscription model** (€20/month) with **NO GRACE PERIOD** policy:
- ✅ Immediate suspension on payment failure
- ✅ Immediate reactivation on successful payment
- ✅ Hardware-locked licenses (one active device per subscription)
- ✅ Email notifications for all state changes

---

## 1️⃣ New Customer Signup

### Flow Diagram
```
┌────────────┐    ┌────────────┐    ┌──────────┐    ┌───────────┐
│ Customer   │───▶│ POSPal App │───▶│  Flask   │───▶│ Cloudflare│
│ Clicks Buy │    │   UI       │    │  Backend │    │  Workers  │
└────────────┘    └────────────┘    └──────────┘    └───────────┘
                                                            │
                                                            ▼
                         ┌────────────────────────────────────┐
                         │  Stripe Checkout Session Created   │
                         │  URL: checkout.stripe.com/...      │
                         └────────────────────────────────────┘
                                                            │
                                                            ▼
                         ┌────────────────────────────────────┐
                         │  Customer Enters Payment Info      │
                         │  Card Number, Billing Address      │
                         └────────────────────────────────────┘
                                                            │
                                                            ▼
                         ┌────────────────────────────────────┐
                         │  Stripe Processes Payment          │
                         │  Creates Subscription (sub_xxx)    │
                         └────────────────────────────────────┘
                                                            │
                                                            ▼
                         ┌────────────────────────────────────┐
                         │  Webhook: checkout.session.        │
                         │            completed               │
                         └────────────────────────────────────┘
                                                            │
                                                            ▼
                    ┌──────────────────────────────────────────────┐
                    │  Cloudflare Worker Processes Webhook         │
                    │  1. Check idempotency (webhook_events table) │
                    │  2. Create customer record in D1 database    │
                    │  3. Generate unlock_token                    │
                    │  4. Fetch billing dates from Stripe          │
                    │  5. Send welcome email (Resend.com)          │
                    │  6. Log audit event                          │
                    └──────────────────────────────────────────────┘
                                                            │
                                                            ▼
                         ┌────────────────────────────────────┐
                         │  Customer Receives Email           │
                         │  - Welcome message                 │
                         │  - Unlock token: unlock_abc123     │
                         │  - Setup instructions              │
                         └────────────────────────────────────┘
```

### Step-by-Step Process

#### Step 1: Customer Initiates Checkout
**Location**: POSPal App → Management Modal → License Info Tab

**Frontend Action** (`pospalCore.js`):
```javascript
// User clicks "Subscribe to POSPal Pro"
const response = await fetch('/api/create-subscription-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        restaurantName: "My Restaurant",
        name: "John Doe",
        email: "john@restaurant.com",
        phone: "+1234567890"
    })
});
```

#### Step 2: Flask Forwards to Cloudflare Workers
**Location**: Flask Backend (`app.py`)

```python
# Flask proxies request to Cloudflare Workers
response = requests.post(
    'https://pospal-licensing-v2-production.bzoumboulis.workers.dev/create-checkout-session',
    json=request_data
)
```

#### Step 3: Cloudflare Creates Stripe Session
**Location**: `cloudflare-licensing/src/index.js:2247-2367`

**Worker Logic**:
```javascript
// 1. Check for duplicate subscription
const existingCustomer = await env.DB.prepare(`
  SELECT * FROM customers WHERE email = ? AND subscription_status = 'active'
`).bind(email).first();

if (existingCustomer) {
  return { error: 'You already have an active POSPal Pro subscription', duplicate: true };
}

// 2. Create Stripe Checkout Session
const session = await stripe.post('/checkout/sessions', {
  'payment_method_types[0]': 'card',
  'line_items[0][price]': 'price_1S2vQN0ee6hGru1PTberJVcZ', // €20/month
  'line_items[0][quantity]': '1',
  mode: 'subscription',
  success_url: 'http://localhost:5000/success.html?session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'http://localhost:5000/payment-failed.html?reason=cancelled',
  customer_email: email,
  'payment_method_collection': 'always' // Save card for renewals
});

return { checkoutUrl: session.url, sessionId: session.id };
```

#### Step 4: Customer Completes Payment
**Location**: Stripe Checkout Page (external)

- Customer enters card details
- Billing address collected
- Payment processed by Stripe
- Subscription created (ID: `sub_xxx`)
- Customer redirected to `success.html`

#### Step 5: Stripe Sends Webhook
**Event Type**: `checkout.session.completed`

**Webhook Payload**:
```json
{
  "id": "evt_abc123",
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_test_abc123",
      "customer": "cus_abc123",
      "customer_details": {
        "email": "john@restaurant.com",
        "name": "John Doe"
      },
      "subscription": "sub_abc123",
      "payment_status": "paid"
    }
  }
}
```

#### Step 6: Worker Processes Webhook
**Location**: `cloudflare-licensing/src/index.js:858-1157`

**Processing Steps**:
```javascript
// 1. Verify webhook signature
if (!request.headers.get('stripe-signature')) {
  return { error: 'Missing stripe signature' };
}

// 2. Check idempotency (prevent duplicates)
const existingEvent = await env.DB.prepare(`
  SELECT * FROM webhook_events WHERE stripe_event_id = ?
`).bind(event.id).first();

if (existingEvent && existingEvent.processing_status === 'completed') {
  return { received: true, idempotent: true, message: 'Event already processed' };
}

// 3. Mark event as processing
await env.DB.prepare(`
  INSERT INTO webhook_events (stripe_event_id, event_type, processing_status)
  VALUES (?, ?, 'processing')
`).bind(event.id, event.type).run();

// 4. Fetch subscription billing dates from Stripe
const subscription = await stripe.get(`/subscriptions/${subscriptionId}`);
const billingData = {
  current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
  current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
  next_billing_date: new Date(subscription.current_period_end * 1000).toISOString()
};

// 5. Create customer record
const unlockToken = generateUnlockToken(); // Random 24-char token
await env.DB.prepare(`
  INSERT INTO customers (email, name, stripe_customer_id, stripe_session_id,
                         unlock_token, subscription_id, subscription_status,
                         current_period_start, current_period_end, next_billing_date)
  VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
`).bind(email, name, stripeCustomerId, sessionId, unlockToken, subscriptionId,
        billingData.current_period_start, billingData.current_period_end,
        billingData.next_billing_date).run();

// 6. Log audit event
await logAuditEvent(env.DB, customerId, 'payment_success', { subscriptionId, sessionId });

// 7. Send welcome email
await sendWelcomeEmail(env, customerId, email, name, unlockToken);

// 8. Mark webhook as completed
await env.DB.prepare(`
  UPDATE webhook_events SET processing_status = 'completed', customer_id = ?
  WHERE stripe_event_id = ?
`).bind(customerId, event.id).run();
```

#### Step 7: Welcome Email Sent
**Location**: `cloudflare-licensing/src/index.js:1523-1558`

**Email Content**:
```
Subject: Welcome to POSPal Pro! 🎉

Hi John Doe,

Welcome to POSPal Pro! Your subscription is now active.

Your Unlock Token: unlock_abc123

Setup Instructions:
1. Open POSPal application
2. Go to Management → License Info
3. Click "Activate License"
4. Enter your email: john@restaurant.com
5. Enter unlock token: unlock_abc123

Your subscription details:
- Monthly cost: €20
- Next billing date: November 11, 2025
- Manage billing: [Customer Portal Link]

Thank you for choosing POSPal!

The POSPal Team
```

---

## 2️⃣ Instant Post-Payment Activation

**Use Case**: Customer wants immediate activation after payment (zero delay).

### Flow Diagram
```
┌─────────────┐    ┌──────────────┐    ┌───────────┐
│ Payment     │───▶│  POSPal App  │───▶│  Workers  │
│ Success Page│    │   /validate  │    │  /instant-│
│             │    │              │    │  validate │
└─────────────┘    └──────────────┘    └───────────┘
                                              │
                                              ▼
                   ┌────────────────────────────────────┐
                   │  Lookup by email + session ID      │
                   │  Store machine fingerprint         │
                   │  Return unlock_token immediately   │
                   └────────────────────────────────────┘
```

### Implementation
**Location**: Success page → POSPal App

**Frontend**:
```javascript
// On success.html page
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session_id');
const email = urlParams.get('email');

// Call instant validation
const response = await fetch('/api/instant-validate', {
    method: 'POST',
    body: JSON.stringify({
        email: email,
        stripeSessionId: sessionId,
        machineFingerprint: await generateHardwareFingerprint()
    })
});

const data = await response.json();
if (data.valid) {
    // Store unlock_token locally
    localStorage.setItem('pospal_unlock_token', data.unlockToken);
    // Activate immediately without waiting for email
}
```

**Backend** (`index.js:1439-1514`):
```javascript
// Look up customer by email + session ID
const customer = await env.DB.prepare(`
  SELECT * FROM customers
  WHERE email = ? AND stripe_session_id = ? AND subscription_status = 'active'
`).bind(email, stripeSessionId).first();

if (!customer) {
  return { valid: false, error: 'No valid subscription found' };
}

// Store machine fingerprint
const hashedFingerprint = await hashMachineFingerprint(machineFingerprint);
await env.DB.prepare(`
  UPDATE customers SET machine_fingerprint = ?, last_validation = datetime('now')
  WHERE id = ?
`).bind(hashedFingerprint, customer.id).run();

// Return unlock token immediately
return {
  valid: true,
  unlockToken: customer.unlock_token,
  customerName: customer.name
};
```

---

## 3️⃣ License Validation

**Frequency**: On app startup, every hour, or when subscription status changes.

### Flow Diagram
```
┌──────────────┐    ┌───────────┐    ┌──────────┐
│  POSPal App  │───▶│  Workers  │───▶│    D1    │
│  Validates   │    │ /validate-│    │ Database │
│  License     │    │  unified  │    │          │
└──────────────┘    └───────────┘    └──────────┘
                           │
                           ▼
                   ┌─────────────────┐
                   │  Check:         │
                   │  1. Credentials │
                   │  2. Status      │
                   │  3. Machine     │
                   │  4. Session     │
                   └─────────────────┘
```

### Implementation

**Request**:
```javascript
const response = await fetch('https://pospal-licensing-v2-production.bzoumboulis.workers.dev/validate-unified', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        operation: 'validate',
        credentials: {
            email: 'john@restaurant.com',
            token: 'unlock_abc123'
        },
        device: {
            machineFingerprint: await generateHardwareFingerprint(),
            deviceInfo: {
                hostname: 'Restaurant-POS-1',
                os: 'Windows 10'
            }
        }
    })
});
```

**Backend Processing** (`index.js:192-319`):
```javascript
// 1. Lookup customer with circuit breaker protection
const customer = await dbCircuitBreaker.execute(async () => {
    return await env.DB.prepare(`
        SELECT * FROM customers WHERE email = ? AND unlock_token = ?
    `).bind(email, token).first();
});

if (!customer) {
    return { success: false, error: 'Invalid credentials' };
}

// 2. Check subscription status
const subscriptionStatus = getDetailedSubscriptionStatus(customer);
if (!subscriptionStatus.isActive) {
    return { success: false, error: 'Subscription is not active' };
}

// 3. Check/update machine fingerprint
const hashedFingerprint = await hashMachineFingerprint(machineFingerprint);
const machineChanged = customer.machine_fingerprint &&
                       customer.machine_fingerprint !== hashedFingerprint;

if (machineChanged) {
    // Send machine switch alert email
    await sendMachineSwitchEmail(env, customer.id, customer.email, customer.name);
}

// Update machine fingerprint and validation timestamp
await env.DB.prepare(`
    UPDATE customers
    SET machine_fingerprint = ?, last_seen = datetime('now'), last_validation = datetime('now')
    WHERE id = ?
`).bind(hashedFingerprint, customer.id).run();

// 4. Determine caching strategy
const cacheStrategy = determineUnifiedCacheStrategy(customer, subscriptionStatus);

// 5. Return validation success with caching info
return {
    success: true,
    validation: { valid: true, status: 'active' },
    subscription: subscriptionStatus,
    caching: cacheStrategy
};
```

**Caching Logic**:
- **Aggressive (1 hour)**: Recent validation (<1 hour ago)
- **Moderate (30 min)**: Active subscription (1-24 hours ago)
- **Conservative (15 min)**: Older validation (>24 hours ago)
- **Minimal (5 min)**: Inactive subscription

---

## 4️⃣ Monthly Renewal

**Trigger**: Stripe automatically charges customer on billing date.

### Flow Diagram
```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│   Stripe     │───▶│   Webhook:    │───▶│   Workers    │
│ Auto-charge  │    │ invoice.      │    │   Process    │
│  on billing  │    │ payment_      │    │   Renewal    │
│     date     │    │ succeeded     │    │              │
└──────────────┘    └───────────────┘    └──────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │  Update billing dates   │
                                    │  Keep status: 'active'  │
                                    │  No interruption        │
                                    └─────────────────────────┘
```

### Implementation

**Webhook Event**: `invoice.payment_succeeded`

**Backend Processing** (`index.js:1163-1233`):
```javascript
// 1. Get customer by subscription ID
const customer = await env.DB.prepare(`
    SELECT * FROM customers WHERE subscription_id = ?
`).bind(subscriptionId).first();

// 2. Fetch updated billing dates from Stripe
const subscription = await stripe.get(`/subscriptions/${subscriptionId}`);
const billingData = {
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    next_billing_date: new Date(subscription.current_period_end * 1000).toISOString()
};

// 3. Check if this is reactivation (was inactive before)
const wasInactive = customer.subscription_status !== 'active';

// 4. Update customer status (IMMEDIATE REACTIVATION)
await env.DB.prepare(`
    UPDATE customers
    SET subscription_status = 'active',
        current_period_start = ?, current_period_end = ?, next_billing_date = ?
    WHERE subscription_id = ?
`).bind(billingData.current_period_start, billingData.current_period_end,
        billingData.next_billing_date, subscriptionId).run();

// 5. Log audit event
await logAuditEvent(env.DB, customer.id,
    wasInactive ? 'payment_succeeded_immediate_reactivation' : 'payment_succeeded_renewal',
    { subscriptionId, policy: 'no_grace_period' }
);

// 6. Send reactivation email (only if was previously inactive)
if (wasInactive) {
    await sendImmediateReactivationEmail(env, customer.id, customer.email, customer.name);
}
```

**Customer Experience**:
- ✅ No interruption in service
- ✅ Billing dates updated automatically
- ✅ If previously suspended, **immediate reactivation** (no grace period)

---

## 5️⃣ Payment Failure

**Trigger**: Stripe fails to charge card on billing date.

**Policy**: **NO GRACE PERIOD** - Immediate suspension.

### Flow Diagram
```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│   Stripe     │───▶│   Webhook:    │───▶│   Workers    │
│ Charge fails │    │ invoice.      │    │   IMMEDIATE  │
│              │    │ payment_      │    │   SUSPENSION │
│              │    │ failed        │    │              │
└──────────────┘    └───────────────┘    └──────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │  Status → 'inactive'    │
                                    │  Send suspension email  │
                                    │  License stops working  │
                                    └─────────────────────────┘
```

### Implementation

**Webhook Event**: `invoice.payment_failed`

**Backend Processing** (`index.js:1239-1283`):
```javascript
// 1. Get customer by subscription ID
const customer = await env.DB.prepare(`
    SELECT * FROM customers WHERE subscription_id = ?
`).bind(subscriptionId).first();

// 2. IMMEDIATE SUSPENSION (no grace period)
await env.DB.prepare(`
    UPDATE customers
    SET subscription_status = 'inactive'
    WHERE subscription_id = ?
`).bind(subscriptionId).run();

// 3. Log audit event
await logAuditEvent(env.DB, customer.id, 'payment_failed_immediate_suspension', {
    subscriptionId,
    policy: 'no_grace_period',
    suspendedAt: new Date().toISOString()
});

// 4. Send immediate suspension email
await sendImmediateSuspensionEmail(env, customer.id, customer.email, customer.name);
```

**Email Content**:
```
Subject: Payment Failed - POSPal Pro Suspended

Hi John,

We were unable to process your payment for POSPal Pro.

Your subscription has been immediately suspended.

To reactivate:
1. Update your payment method
2. Click: [Update Payment Method - Customer Portal]

Your service will be restored immediately upon successful payment.

Amount due: €20.00
Next attempt: [Date]

Need help? Contact support@pospal.gr

The POSPal Team
```

**Customer Experience**:
- ❌ License validation fails immediately
- ❌ POSPal shows "Subscription Inactive" message
- ❌ Must update payment method to restore service
- ✅ Immediate reactivation upon successful payment

---

## 6️⃣ Subscription Cancellation

**Trigger**: Customer cancels via Stripe portal or Stripe dashboard.

### Flow Diagram
```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│  Customer    │───▶│   Webhook:    │───▶│   Workers    │
│  Cancels in  │    │ customer.     │    │   Mark as    │
│   Portal     │    │ subscription. │    │  'cancelled' │
│              │    │ deleted       │    │              │
└──────────────┘    └───────────────┘    └──────────────┘
```

### Implementation

**Webhook Event**: `customer.subscription.deleted`

**Backend Processing** (`index.js:1288-1309`):
```javascript
// Update customer status to cancelled
await env.DB.prepare(`
    UPDATE customers
    SET subscription_status = 'cancelled'
    WHERE subscription_id = ?
`).bind(subscriptionId).run();

console.log(`Subscription cancelled: ${subscriptionId}`);
```

**Customer Experience**:
- Service continues until end of current billing period
- Then license validation fails with `subscription_status = 'cancelled'`
- Can resubscribe anytime by purchasing new subscription

---

## 7️⃣ Machine Switch Detection

**Trigger**: Customer tries to use license on different device.

### Flow Diagram
```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│  Different   │───▶│   Validation  │───▶│   Workers    │
│  Device      │    │   Request     │    │  Detects     │
│  Fingerprint │    │               │    │  Change      │
└──────────────┘    └───────────────┘    └──────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │  Update fingerprint     │
                                    │  Send security alert    │
                                    │  Allow new device       │
                                    └─────────────────────────┘
```

### Implementation

**Detection Logic** (`index.js:234-257`):
```javascript
// Compare stored fingerprint with new fingerprint
const hashedFingerprint = await hashMachineFingerprint(device.machineFingerprint);
const machineChanged = customer.machine_fingerprint &&
                       customer.machine_fingerprint !== hashedFingerprint;

if (machineChanged) {
    // Send security alert email
    await sendMachineSwitchEmail(env, customer.id, customer.email, customer.name);

    // Update to new machine (allow switch)
    await env.DB.prepare(`
        UPDATE customers
        SET machine_fingerprint = ?
        WHERE id = ?
    `).bind(hashedFingerprint, customer.id).run();
}
```

**Email Content**:
```
Subject: Security Alert - Device Change Detected

Hi John,

We detected that POSPal Pro was accessed from a new device.

Previous device: Restaurant-POS-1
New device: Restaurant-POS-2
Time: October 11, 2025 12:00 PM

If this was you, no action is needed.

If this was not you, secure your account:
[Manage Subscription - Customer Portal]

The POSPal Team
```

---

## 8️⃣ Session Management

**Purpose**: Prevent multiple devices from using same license simultaneously.

### Flow Diagram
```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│  Device 1    │───▶│ /session/     │───▶│  Active      │
│  Starts      │    │  start        │    │  Session     │
│  Session     │    │               │    │  Created     │
└──────────────┘    └───────────────┘    └──────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │  Heartbeat every 2 min  │
                                    └─────────────────────────┘

┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│  Device 2    │───▶│ /session/     │───▶│  Conflict!   │
│  Tries Start │    │  start        │    │  Rejected    │
└──────────────┘    └───────────────┘    └──────────────┘
```

### Implementation

**Start Session** (`index.js:1711-1787`):
```javascript
// Check for existing active session
const existingSession = await env.DB.prepare(`
    SELECT * FROM active_sessions
    WHERE customer_id = ? AND status = 'active'
    AND last_heartbeat > datetime('now', '-2 minutes')
`).bind(customer.id).first();

if (existingSession && existingSession.session_id !== sessionId) {
    // Another device is already active
    return {
        success: false,
        error: 'Another device is currently using this license',
        conflict: true,
        conflictInfo: {
            deviceInfo: JSON.parse(existingSession.device_info),
            lastSeen: existingSession.last_heartbeat
        }
    };
}

// Create new session
await env.DB.prepare(`
    INSERT OR REPLACE INTO active_sessions
    (customer_id, session_id, machine_fingerprint, device_info, status)
    VALUES (?, ?, ?, ?, 'active')
`).bind(customer.id, sessionId, hashedFingerprint, JSON.stringify(deviceInfo)).run();
```

**Heartbeat** (every 2 minutes):
```javascript
// Update last_heartbeat timestamp
await env.DB.prepare(`
    UPDATE active_sessions
    SET last_heartbeat = datetime('now')
    WHERE session_id = ?
`).bind(sessionId).run();
```

**Session Takeover**:
```javascript
// Force takeover - kicks other device
await env.DB.prepare(`
    UPDATE active_sessions
    SET status = 'kicked'
    WHERE customer_id = ? AND status = 'active'
`).bind(customer.id).run();

// Create new session
await env.DB.prepare(`
    INSERT INTO active_sessions (customer_id, session_id, status)
    VALUES (?, ?, 'active')
`).bind(customer.id, newSessionId).run();
```

---

## 9️⃣ Customer Portal Access

**Purpose**: Allow customers to manage their subscription (update payment, cancel, view invoices).

### Flow Diagram
```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│  Customer    │───▶│   /create-    │───▶│   Stripe     │
│  Clicks      │    │   portal-     │    │   Generates  │
│  "Manage"    │    │   session     │    │   Portal URL │
└──────────────┘    └───────────────┘    └──────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │  Customer redirected to │
                                    │  billing.stripe.com     │
                                    │  - Update payment       │
                                    │  - Cancel subscription  │
                                    │  - View invoices        │
                                    └─────────────────────────┘
```

### Implementation

**Request**:
```javascript
const response = await fetch('/api/create-portal-session', {
    method: 'POST',
    body: JSON.stringify({
        email: 'john@restaurant.com',
        unlockToken: 'unlock_abc123'
    })
});

const data = await response.json();
window.location.href = data.url; // Redirect to Stripe portal
```

**Backend** (`index.js:2049-2163`):
```javascript
// 1. Verify customer credentials
const customer = await env.DB.prepare(`
    SELECT * FROM customers WHERE email = ? AND unlock_token = ?
`).bind(email, unlockToken).first();

if (!customer) {
    return { error: 'Invalid credentials' };
}

// 2. Check if Stripe customer ID exists (fallback handling)
let stripeCustomerId = customer.stripe_customer_id;

if (!stripeCustomerId || stripeCustomerId === 'null') {
    // Auto-create Stripe customer as fallback
    const stripeCustomer = await stripe.post('/customers', {
        email: customer.email,
        name: customer.name
    });

    stripeCustomerId = stripeCustomer.id;

    // Update database
    await env.DB.prepare(`
        UPDATE customers SET stripe_customer_id = ? WHERE id = ?
    `).bind(stripeCustomerId, customer.id).run();
}

// 3. Create Stripe billing portal session
const portalSession = await stripe.post('/billing_portal/sessions', {
    customer: stripeCustomerId,
    return_url: 'http://localhost:5000' // Return to POSPal app
});

// 4. Return portal URL
return { url: portalSession.url };
```

---

## 🔍 Troubleshooting Common Issues

### Issue 1: "Subscription is not active"
**Cause**: Payment failed
**Solution**: Customer must update payment method via portal
**Timeline**: Immediate suspension (NO GRACE PERIOD)

### Issue 2: "Another device is currently using this license"
**Cause**: Session conflict
**Solutions**:
1. Wait 2 minutes for old session to expire
2. Use `/session/takeover` to force switch
3. End session on other device first

### Issue 3: "Invalid email or unlock token"
**Cause**: Wrong credentials
**Solution**: Check welcome email for correct unlock_token

### Issue 4: Machine switch not detecting
**Cause**: `skipMachineUpdate: true` in request
**Solution**: Set `skipMachineUpdate: false` or omit parameter

### Issue 5: Webhook not processed
**Cause**: Idempotency protection or processing failure
**Solution**: Check `webhook_events` table for status

---

## 📊 Database State Transitions

```
Customer States:
┌─────────┐    payment_success    ┌────────┐
│  None   │─────────────────────▶│ active │
└─────────┘                       └────────┘
                                      │ ▲
                payment_failed        │ │  payment_succeeded
                                      ▼ │
                                  ┌──────────┐
                                  │ inactive │
                                  └──────────┘
                                      │
                subscription_deleted  │
                                      ▼
                                  ┌───────────┐
                                  │ cancelled │
                                  └───────────┘
```

---

**Last Updated**: October 11, 2025
**API Version**: 2.0.0
**Status**: Production - Fully Operational
