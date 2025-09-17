# Phase 2 Testing Guide: Billing Date Implementation

## Overview

This guide provides comprehensive testing procedures for the newly implemented billing date functionality in POSPal's licensing system. Phase 2 adds three critical billing columns to the customer database:

- `next_billing_date` - When the next payment is due
- `current_period_start` - Start of current billing period
- `current_period_end` - End of current billing period

## Pre-Testing Checklist

✅ **Database Schema Updated**
- [ ] Development database has new billing columns
- [ ] Production database has new billing columns
- [ ] Columns are type `TEXT` for ISO date storage

✅ **Code Deployment**
- [ ] Latest code deployed to development environment
- [ ] Webhook handlers updated with billing data capture
- [ ] Database queries updated to include billing columns

✅ **Test Environment Ready**
- [ ] Cloudflare Worker running locally or deployed
- [ ] Stripe test account configured
- [ ] Test webhook endpoints accessible

## Test Categories

### 1. Automated Testing

#### A. Run Billing Date Test Script

```bash
cd cloudflare-licensing
node test-billing-dates.js
```

**Expected Results:**
- ✅ Webhook endpoint availability
- ✅ Webhook signature processing
- ✅ Checkout webhook processing
- ✅ Payment succeeded webhook processing
- ✅ Billing date format validation

#### B. Run Database Test Script

```bash
node test-database-billing.js test ./your-database.sqlite3
```

**Expected Results:**
- ✅ All billing date columns present
- ✅ Correct column types (TEXT)
- ✅ Billing data queries functional
- ✅ Date format validation

### 2. Manual Webhook Testing

#### A. Checkout Session Completed Webhook

**Test Steps:**

1. **Prepare Test Data:**
   ```json
   {
     "type": "checkout.session.completed",
     "data": {
       "object": {
         "id": "cs_test_manual_123",
         "customer": "cus_test_customer_456",
         "subscription": "sub_test_subscription_789",
         "customer_details": {
           "email": "manual-test@pospal.gr",
           "name": "Manual Test Customer"
         },
         "mode": "subscription",
         "payment_status": "paid"
       }
     }
   }
   ```

2. **Send Webhook:**
   ```bash
   curl -X POST http://localhost:8787/webhook \
     -H "Content-Type: application/json" \
     -H "stripe-signature: test_signature" \
     -d @checkout-webhook.json
   ```

3. **Expected Response:**
   - Status: 200 OK
   - Response: `{"success": true}`

4. **Verify Database:**
   ```sql
   SELECT email, current_period_start, current_period_end, next_billing_date
   FROM customers
   WHERE email = 'manual-test@pospal.gr';
   ```

**Expected Database State:**
- Customer record created/updated
- All billing date fields populated with ISO dates
- `next_billing_date` equals `current_period_end`

#### B. Payment Succeeded Webhook

**Test Steps:**

1. **Prepare Test Data:**
   ```json
   {
     "type": "invoice.payment_succeeded",
     "data": {
       "object": {
         "id": "in_test_renewal_101",
         "customer": "cus_test_customer_456",
         "subscription": "sub_test_subscription_789",
         "customer_email": "manual-test@pospal.gr"
       }
     }
   }
   ```

2. **Send Webhook:**
   ```bash
   curl -X POST http://localhost:8787/webhook \
     -H "Content-Type: application/json" \
     -H "stripe-signature: test_signature" \
     -d @payment-webhook.json
   ```

3. **Expected Response:**
   - Status: 200 OK
   - Customer immediately reactivated
   - Billing dates updated

### 3. License Validation Testing

#### A. Standard Validation with Billing Data

**Test Steps:**

1. **Send Validation Request:**
   ```bash
   curl -X POST http://localhost:8787/validate-unified \
     -H "Content-Type: application/json" \
     -d '{
       "operation": "validate",
       "credentials": {
         "email": "manual-test@pospal.gr",
         "token": "POSPAL-TEST-TOKEN-XXXX"
       },
       "device": {
         "machineFingerprint": "test_device_123"
       }
     }'
   ```

2. **Expected Response Structure:**
   ```json
   {
     "success": true,
     "validation": {
       "valid": true,
       "status": "active"
     },
     "subscription": {
       "billingInfo": {
         "nextBillingDate": "2024-02-13T00:00:00.000Z",
         "currentPeriodStart": "2024-01-13T00:00:00.000Z",
         "currentPeriodEnd": "2024-02-13T00:00:00.000Z"
       }
     }
   }
   ```

#### B. Instant Validation After Payment

**Test Steps:**

1. **Send Instant Validation Request:**
   ```bash
   curl -X POST http://localhost:8787/validate-unified \
     -H "Content-Type: application/json" \
     -d '{
       "operation": "instant",
       "credentials": {
         "email": "new-customer@pospal.gr",
         "stripeSessionId": "cs_test_instant_456"
       },
       "device": {
         "machineFingerprint": "new_device_456"
       }
     }'
   ```

2. **Expected Response:**
   - Customer validation successful
   - Unlock token provided
   - Billing information included

### 4. Error Handling Testing

#### A. Missing Stripe Subscription Data

**Test Steps:**

1. **Send webhook with invalid subscription ID:**
   ```json
   {
     "type": "checkout.session.completed",
     "data": {
       "object": {
         "subscription": "sub_invalid_nonexistent"
       }
     }
   }
   ```

2. **Expected Behavior:**
   - Webhook processes successfully
   - Customer created without billing data
   - Error logged but process continues
   - Billing data can be backfilled later

#### B. Null/Missing Subscription Field

**Test Steps:**

1. **Send webhook with null subscription:**
   ```json
   {
     "type": "checkout.session.completed",
     "data": {
       "object": {
         "subscription": null
       }
     }
   }
   ```

2. **Expected Behavior:**
   - Graceful handling
   - Customer created
   - No billing data stored (expected)

### 5. Production Monitoring

#### A. Cloudflare Workers Logs

**Monitor for:**
```
✅ "Billing data captured: {current_period_start: ..., current_period_end: ..., next_billing_date: ...}"
✅ "Payment renewal - billing data updated: {...}"
❌ "Failed to fetch subscription billing data: ..."
```

#### B. Database Integrity Checks

**Run these queries periodically:**

```sql
-- Count customers with complete billing data
SELECT COUNT(*) as complete_billing_data
FROM customers
WHERE subscription_status = 'active'
AND next_billing_date IS NOT NULL
AND current_period_start IS NOT NULL
AND current_period_end IS NOT NULL;

-- Find customers missing billing data
SELECT id, email, subscription_id, created_at
FROM customers
WHERE subscription_status = 'active'
AND (next_billing_date IS NULL
OR current_period_start IS NULL
OR current_period_end IS NULL);

-- Validate billing period logic
SELECT id, email,
       current_period_start,
       current_period_end,
       next_billing_date,
       CASE
         WHEN current_period_end = next_billing_date THEN 'OK'
         ELSE 'MISMATCH'
       END as billing_logic_check
FROM customers
WHERE next_billing_date IS NOT NULL;
```

### 6. Billing Date Backfill (If Needed)

If some customers are missing billing data:

#### A. Manual Backfill Script

```sql
-- Example backfill for missing billing dates
UPDATE customers
SET current_period_start = datetime('now'),
    current_period_end = datetime('now', '+30 days'),
    next_billing_date = datetime('now', '+30 days')
WHERE subscription_status = 'active'
AND next_billing_date IS NULL
AND subscription_id IS NOT NULL;
```

#### B. Stripe API Backfill

Use the `/fix-billing-dates` endpoint:

```bash
curl -X GET http://localhost:8787/fix-billing-dates
```

This will fetch current billing data from Stripe for all active subscriptions.

## Test Result Documentation

### Success Criteria

✅ **Database Schema**
- [ ] All billing columns exist with correct types
- [ ] No schema errors during queries

✅ **Webhook Processing**
- [ ] `checkout.session.completed` captures billing data
- [ ] `invoice.payment_succeeded` updates billing data
- [ ] Error handling works for missing Stripe data

✅ **Data Integrity**
- [ ] Billing dates stored in ISO 8601 format
- [ ] `next_billing_date` equals `current_period_end`
- [ ] No invalid date values in database

✅ **API Responses**
- [ ] Validation responses include billing information
- [ ] Date formats consistent across all endpoints
- [ ] No performance degradation

### Common Issues & Solutions

#### Issue: "Missing billing date columns"
**Solution:** Run database migration:
```sql
ALTER TABLE customers ADD COLUMN next_billing_date TEXT;
ALTER TABLE customers ADD COLUMN current_period_start TEXT;
ALTER TABLE customers ADD COLUMN current_period_end TEXT;
```

#### Issue: "Failed to fetch subscription billing data"
**Solution:**
- Verify Stripe API key is correct
- Check subscription ID validity
- Ensure network connectivity to Stripe

#### Issue: "Invalid date format in database"
**Solution:**
- Check timezone handling in date conversion
- Verify Unix timestamp to ISO conversion
- Update date parsing logic if needed

#### Issue: "Billing data not appearing in validation responses"
**Solution:**
- Check if customer has billing data in database
- Verify response formatting in validation endpoints
- Test with known customers with billing data

## Rollback Plan

If critical issues are found:

1. **Immediate Actions:**
   - Revert to previous code version
   - Remove billing date columns if causing issues
   - Monitor for continued stability

2. **Data Recovery:**
   - Billing data can be re-fetched from Stripe
   - Customer functionality continues without billing dates
   - No critical features depend on billing dates initially

3. **Re-deployment:**
   - Fix identified issues
   - Re-test thoroughly
   - Deploy with additional monitoring

## Success Metrics

- **0 webhook processing errors** related to billing data
- **>95% of active customers** have complete billing data
- **<100ms additional response time** for validation requests
- **No customer-facing disruption** during deployment

---

**Next Phase:** Once Phase 2 is stable, proceed to implement billing-aware features like subscription renewal reminders and proactive payment failure handling.