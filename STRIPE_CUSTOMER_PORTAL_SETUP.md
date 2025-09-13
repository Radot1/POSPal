# Stripe Customer Portal Configuration Guide

## Overview
This guide explains how to configure the Stripe Customer Portal to properly display payment methods and allow customers to manage their subscriptions.

## Issue Identified
**Problem**: Payment methods (test cards) were not showing up in the Stripe Customer Portal after customers completed payments through the POSPal subscription flow.

**Root Causes**:
1. Checkout sessions weren't configured to save payment methods for future use
2. Missing webhook handlers for payment method attachment events  
3. Customer Portal configuration in Stripe Dashboard needs proper setup

## Code Changes Made

### 1. Enhanced Checkout Session Configuration
**File**: `cloudflare-licensing/src/index.js` - `handleCreateCheckoutSession()`

```javascript
// Added these critical parameters to checkout session:
'payment_method_collection': 'always',
'payment_method_options[card][setup_future_usage]': 'off_session'
```

**Why This Matters**: 
- `payment_method_collection: 'always'` ensures payment methods are collected and saved
- `setup_future_usage: 'off_session'` allows the payment method to be reused for future payments without customer presence

### 2. Added Missing Webhook Handlers
**New webhook events handled**:
- `payment_method.attached` - Triggered when payment methods are attached to customers
- `setup_intent.succeeded` - Triggered when setup intents complete (for saving cards)

**Functions Added**:
- `handlePaymentMethodAttached()` - Logs payment method attachment for audit trail
- `handleSetupIntentSucceeded()` - Logs setup intent completion

## Stripe Dashboard Configuration Required

### Customer Portal Settings
1. **Access Stripe Dashboard** → **Settings** → **Customer Portal**

2. **Enable Payment Method Management**:
   - ✅ Allow customers to update payment methods
   - ✅ Allow customers to remove payment methods
   - ✅ Show payment method details (last 4 digits, expiry)

3. **Configure Portal Features**:
   ```
   Subscription management: ✅ Enabled
   - Cancel subscriptions: ✅ Enabled
   - Pause subscriptions: ✅ Enabled (optional)
   - Switch plans: ✅ Enabled (if multiple plans)
   
   Payment methods: ✅ Enabled
   - Update payment method: ✅ Enabled  
   - Remove payment method: ✅ Enabled
   - Add payment method: ✅ Enabled
   
   Billing history: ✅ Enabled
   - Download invoices: ✅ Enabled
   ```

4. **Business Information**:
   - Company name: POSPal
   - Support email: support@pospal.gr
   - Website: https://pospal.gr

### Webhook Endpoints Configuration
1. **Access Stripe Dashboard** → **Developers** → **Webhooks**

2. **Add webhook endpoint**: `https://your-cloudflare-worker.workers.dev/webhook`

3. **Select events to send**:
   ```
   ✅ checkout.session.completed
   ✅ invoice.payment_succeeded  
   ✅ invoice.payment_failed
   ✅ customer.subscription.deleted
   ✅ payment_method.attached         [NEW - CRITICAL]
   ✅ setup_intent.succeeded          [NEW - CRITICAL]
   ```

## Testing the Fix

### Test Scenario 1: New Customer Payment
1. Use POSPal app with valid email/license
2. Access customer portal (should trigger subscription modal)
3. Complete payment with test card: `4242 4242 4242 4242`
4. Check Stripe Customer Portal - payment method should now appear

### Test Scenario 2: Existing Customer Portal Access  
1. Use existing customer credentials
2. Access customer portal directly
3. Verify payment methods section shows saved cards
4. Test updating/removing payment methods

### Test Cards for Different Scenarios
```
Success: 4242 4242 4242 4242
Decline: 4000 0000 0000 0002
Requires SCA: 4000 0025 0000 3155
Expired: 4000 0000 0000 0069
```

## Expected Behavior After Fix

### Customer Portal Should Show:
1. **Payment Methods Section**:
   - Current default payment method
   - Card details (•••• •••• •••• 4242, Expires 12/25)
   - "Update payment method" button
   - "Add payment method" option

2. **Subscription Management**:
   - Current plan details (€20/month)
   - Next billing date
   - Cancel/pause options
   - Plan change options (if multiple plans)

3. **Billing History**:
   - Past invoices with download links
   - Payment dates and amounts
   - Payment status (Paid/Failed)

## Troubleshooting

### Issue: Portal shows "No configuration provided"
**Solution**: Configure Customer Portal in Stripe Dashboard (see configuration steps above)

### Issue: Payment methods still not showing
**Check**:
1. Webhook events are being received (check Cloudflare Worker logs)
2. `payment_method.attached` events are firing
3. Checkout session includes the new payment method configuration
4. Customer Portal settings allow payment method management

### Issue: Test payments work but real payments don't
**Check**:
1. Switch from test mode to live mode in Stripe Dashboard
2. Update webhook URLs for production environment
3. Verify live API keys are configured in Cloudflare Worker

## Security Notes

### PCI Compliance
- Payment method data is handled entirely by Stripe
- POSPal never stores credit card information
- All payment flows use Stripe's secure hosted pages

### Data Protection
- Customer payment methods are encrypted by Stripe
- Only last 4 digits and metadata are accessible via API
- Payment method tokens are used for subsequent charges

## Monitoring and Logs

### Audit Events Added
- `payment_method_attached` - When cards are saved to customer
- `setup_intent_succeeded` - When payment method setup completes

### Key Metrics to Monitor
- Percentage of customers with saved payment methods
- Failed payment recovery rate after implementing off_session usage
- Customer portal usage and engagement

## Support Information

If customers still experience issues with payment methods not appearing:

1. **Immediate Fix**: Manually check their Stripe customer record for attached payment methods
2. **Long-term**: Review webhook delivery logs for missed events
3. **Escalation**: Contact Stripe support for account-specific configuration issues

**Support Contact**: support@pospal.gr
**Technical Contact**: For webhook/integration issues, check Cloudflare Worker logs first