# POSPal API Reference v2.0
**Base URL**: `https://pospal-licensing-v2-production.bzoumboulis.workers.dev`
**API Version**: 2.0.0
**Last Updated**: October 11, 2025

---

## 📋 Table of Contents
1. [Authentication](#authentication)
2. [Core Endpoints](#core-endpoints)
3. [Validation Endpoints](#validation-endpoints-v20)
4. [Session Management](#session-management)
5. [Customer Portal](#customer-portal)
6. [Webhook Handlers](#webhook-handlers)
7. [Error Codes](#error-codes)
8. [Response Formats](#response-formats)

---

## 🔐 Authentication

Most endpoints require customer credentials:
- **email**: Customer email address
- **unlock_token** or **token**: Unique unlock token (provided in welcome email)

Machine operations also require:
- **machineFingerprint**: Hardware fingerprint (SHA-256 hash)

---

## 🏥 Core Endpoints

### GET /health
Health check endpoint with circuit breaker monitoring.

**Request**: No body required

**Response**:
```json
{
  "status": "healthy",
  "services": {
    "database": {
      "status": "healthy",
      "responseTime": 56
    }
  },
  "circuitBreaker": {
    "state": "CLOSED",
    "failures": 0
  },
  "system": {
    "worker": "cloudflare-licensing",
    "version": "2.0.0",
    "environment": "production"
  },
  "timestamp": "2025-10-11T12:00:00.000Z"
}
```

**Status Codes**:
- `200` - System healthy
- `503` - System unhealthy

---

## ✅ Validation Endpoints (v2.0)

### POST /validate-unified
**NEW** Unified validation endpoint supporting multiple operation types.

**Request Body**:
```json
{
  "operation": "validate|instant|session",
  "credentials": {
    "email": "customer@example.com",
    "token": "unlock_abc123",
    "sessionId": "session_xyz789",           // Required for session operations
    "stripeSessionId": "cs_test_abc123"      // Required for instant validation
  },
  "device": {
    "machineFingerprint": "hw_fingerprint_hash",
    "skipMachineUpdate": false,              // Optional: skip machine update
    "deviceInfo": {
      "hostname": "Restaurant-POS-1",
      "os": "Windows 10"
    }
  },
  "action": "start|heartbeat|end|takeover",  // Required for session operations
  "options": {}                               // Optional parameters
}
```

**Response (Standard Validation)**:
```json
{
  "success": true,
  "timestamp": "2025-10-11T12:00:00.000Z",
  "requestId": "req_abc123xyz",
  "validation": {
    "valid": true,
    "status": "active",
    "validationType": "standard",
    "customer": {
      "id": 1,
      "email": "customer@example.com",
      "name": "Restaurant Owner"
    }
  },
  "subscription": {
    "status": "active",
    "id": "sub_1ABC123",
    "isActive": true,
    "currentPeriodEnd": "2025-11-11T00:00:00.000Z",
    "nextBillingDate": "2025-11-11T00:00:00.000Z",
    "daysRemaining": 31
  },
  "session": {
    "allowed": true,
    "sessionId": null,
    "machineChanged": false,
    "deviceInfo": {
      "current": "Restaurant-POS-1",
      "registered": "2025-10-11T12:00:00.000Z"
    }
  },
  "caching": {
    "strategy": "aggressive",
    "duration": 3600,
    "validUntil": "2025-10-11T13:00:00.000Z",
    "recommendation": "cache_locally",
    "nextCheck": "2025-10-11T12:48:00.000Z"
  },
  "performance": {
    "responseTime": 56,
    "databaseQueries": 2,
    "cacheHit": false,
    "circuitBreakerState": "CLOSED"
  },
  "metadata": {
    "apiVersion": "2.0",
    "operation": "unified",
    "endpoint": "/validate-unified"
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "timestamp": "2025-10-11T12:00:00.000Z",
  "requestId": "req_abc123xyz",
  "error": {
    "code": "SUBSCRIPTION_INACTIVE",
    "message": "Subscription is not active",
    "category": "subscription",
    "severity": "high",
    "retryable": false
  },
  "subscriptionInfo": {
    "status": "inactive",
    "isActive": false,
    "daysSinceLastSeen": 5
  },
  "supportActions": {
    "portalUrl": "https://billing.stripe.com/p/login/customer_portal",
    "contactSupport": true
  },
  "responseTime": 45,
  "metadata": {
    "apiVersion": "2.0",
    "endpoint": "/validate-unified"
  }
}
```

**Status Codes**:
- `200` - Validation successful
- `400` - Invalid request format
- `401` - Invalid credentials
- `403` - Subscription inactive
- `404` - Customer not found
- `409` - Session conflict
- `500` - Server error

---

### POST /validate
**Legacy** license validation endpoint (still supported).

**Request Body**:
```json
{
  "email": "customer@example.com",
  "token": "unlock_abc123",
  "machineFingerprint": "hw_fingerprint_hash",
  "skipMachineUpdate": false
}
```

**Response**:
```json
{
  "valid": true,
  "customerName": "Restaurant Owner",
  "customerId": 1,
  "subscriptionInfo": {
    "status": "active",
    "isActive": true,
    "currentPeriodEnd": "2025-11-11T00:00:00.000Z",
    "daysRemaining": 31,
    "validationRecommendation": "cached"
  },
  "machineChanged": false,
  "performance": {
    "responseTime": 45,
    "cached": false,
    "validationRecommendation": "cached"
  }
}
```

**Status Codes**:
- `200` - Validation result (check `valid` field)
- `400` - Invalid request
- `500` - Server error

---

### POST /instant-validate
Post-payment instant validation (zero-delay activation).

**Request Body**:
```json
{
  "email": "customer@example.com",
  "stripeSessionId": "cs_test_abc123",
  "machineFingerprint": "hw_fingerprint_hash"
}
```

**Response**:
```json
{
  "valid": true,
  "unlockToken": "unlock_abc123",
  "customerName": "Restaurant Owner",
  "subscriptionInfo": {
    "status": "active",
    "isActive": true
  },
  "performance": {
    "responseTime": 67,
    "instant": true
  }
}
```

**Status Codes**:
- `200` - Validation successful
- `400` - Invalid request
- `404` - No valid subscription found
- `500` - Server error

---

## 🔄 Session Management

### POST /session/start
Start a new device session (prevents multi-device usage).

**Request Body**:
```json
{
  "email": "customer@example.com",
  "token": "unlock_abc123",
  "machineFingerprint": "hw_fingerprint_hash",
  "sessionId": "session_xyz789",
  "deviceInfo": {
    "hostname": "Restaurant-POS-1",
    "os": "Windows 10",
    "version": "1.2.1"
  }
}
```

**Response (Success)**:
```json
{
  "success": true,
  "sessionId": "session_xyz789"
}
```

**Response (Conflict)**:
```json
{
  "success": false,
  "error": "Another device is currently using this license",
  "conflict": true,
  "conflictInfo": {
    "deviceInfo": {
      "hostname": "Restaurant-POS-2",
      "os": "Windows 10"
    },
    "lastSeen": "2025-10-11T11:55:00.000Z"
  }
}
```

**Status Codes**:
- `200` - Session started or conflict detected
- `400` - Missing required fields
- `401` - Invalid license
- `500` - Server error

---

### POST /session/heartbeat
Keep session alive (must be called every 2 minutes).

**Request Body**:
```json
{
  "sessionId": "session_xyz789"
}
```

**Response**:
```json
{
  "success": true,
  "timestamp": "2025-10-11T12:00:00.000Z"
}
```

**Status Codes**:
- `200` - Heartbeat updated
- `400` - Missing session ID
- `404` - Session not found or expired
- `500` - Server error

---

### POST /session/end
End session gracefully (free up license for other devices).

**Request Body**:
```json
{
  "sessionId": "session_xyz789"
}
```

**Response**:
```json
{
  "success": true
}
```

**Status Codes**:
- `200` - Session ended
- `400` - Missing session ID
- `500` - Server error

---

### POST /session/takeover
Force takeover of license (kicks other device).

**Request Body**:
```json
{
  "email": "customer@example.com",
  "token": "unlock_abc123",
  "machineFingerprint": "hw_fingerprint_hash",
  "sessionId": "session_xyz789",
  "deviceInfo": {
    "hostname": "Restaurant-POS-1",
    "os": "Windows 10"
  }
}
```

**Response**:
```json
{
  "success": true,
  "sessionId": "session_xyz789"
}
```

**Status Codes**:
- `200` - Takeover successful
- `400` - Missing required fields
- `401` - Invalid license
- `500` - Server error

---

## 👤 Customer Portal

### POST /create-checkout-session
Create Stripe checkout session for new subscription.

**Request Body**:
```json
{
  "restaurantName": "My Restaurant",
  "name": "John Doe",
  "email": "john@restaurant.com",
  "phone": "+1234567890"
}
```

**Response (Success)**:
```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_abc123",
  "sessionId": "cs_test_abc123"
}
```

**Response (Duplicate)**:
```json
{
  "error": "You already have an active POSPal Pro subscription",
  "duplicate": true,
  "redirectTo": "customer-portal",
  "existingSubscription": {
    "email": "john@restaurant.com",
    "subscriptionStatus": "active",
    "createdAt": "2025-10-01T12:00:00.000Z"
  }
}
```

**Status Codes**:
- `200` - Checkout session created
- `400` - Invalid request or Stripe error
- `409` - Duplicate subscription
- `500` - Server error

---

### POST /create-portal-session
Generate Stripe billing portal URL for subscription management.

**Request Body**:
```json
{
  "email": "customer@example.com",
  "unlockToken": "unlock_abc123"
}
```

**Response**:
```json
{
  "url": "https://billing.stripe.com/p/session/test_abc123"
}
```

**Error Responses**:
```json
{
  "error": "Unable to access customer portal at this time. Please try again in a few minutes or contact support if the issue persists.",
  "errorCode": "STRIPE_CUSTOMER_CREATION_FAILED",
  "supportEmail": "support@pospal.gr"
}
```

```json
{
  "error": "Customer portal is temporarily unavailable. Please try again in a few minutes or contact support.",
  "errorCode": "STRIPE_PORTAL_NOT_CONFIGURED",
  "supportEmail": "support@pospal.gr",
  "details": "Portal configuration required"
}
```

**Status Codes**:
- `200` - Portal URL generated
- `400` - Missing credentials
- `401` - Invalid credentials
- `500` - Failed to create portal session
- `503` - Portal not configured

---

### POST /customer-portal
Get customer subscription data (for displaying in app).

**Request Body**:
```json
{
  "email": "customer@example.com",
  "unlockToken": "unlock_abc123"
}
```

**Response**:
```json
{
  "customer": {
    "id": 1,
    "email": "customer@example.com",
    "name": "Restaurant Owner",
    "subscription_status": "active",
    "created_at": "2025-10-01T12:00:00.000Z",
    "last_seen": "2025-10-11T12:00:00.000Z"
  },
  "subscription": {
    "id": "sub_1ABC123",
    "status": "active",
    "current_period_start": 1728648000,
    "current_period_end": 1731326400,
    "default_payment_method": {
      "id": "pm_abc123",
      "type": "card",
      "card": {
        "brand": "visa",
        "last4": "4242",
        "exp_month": 12,
        "exp_year": 2025
      }
    }
  }
}
```

**Status Codes**:
- `200` - Customer data retrieved
- `400` - Missing credentials
- `401` - Invalid credentials
- `500` - Server error

---

## 🪝 Webhook Handlers

### POST /webhook
Stripe webhook handler with idempotency protection.

**Headers Required**:
- `stripe-signature`: Stripe webhook signature for verification

**Supported Event Types**:
- `checkout.session.completed` - New subscription created
- `invoice.payment_succeeded` - Payment successful (renewal or reactivation)
- `invoice.payment_failed` - Payment failed (immediate suspension)
- `customer.subscription.deleted` - Subscription cancelled
- `payment_method.attached` - Payment method added
- `setup_intent.succeeded` - Card setup completed

**Response (Success)**:
```json
{
  "received": true,
  "success": true,
  "customer_id": 1
}
```

**Response (Idempotent - Already Processed)**:
```json
{
  "received": true,
  "idempotent": true,
  "message": "Event already processed",
  "processed_at": "2025-10-11T11:50:00.000Z"
}
```

**Response (Duplicate - Currently Processing)**:
```json
{
  "received": true,
  "duplicate": true,
  "message": "Event currently being processed"
}
```

**Status Codes**:
- `200` - Webhook processed or already processed
- `400` - Missing signature or invalid payload
- `500` - Processing failed

---

### POST /test-webhook
Development webhook testing (bypasses signature verification).

**Request Body**: Same as Stripe webhook payload

**Response**: Same as `/webhook` endpoint

**⚠️ Warning**: Only use for development/testing. Not for production use.

---

## ❌ Error Codes

### Authentication Errors
- `INVALID_CREDENTIALS` - Wrong email or unlock token
- `INVALID_EMAIL_FORMAT` - Email format invalid
- `MISSING_REQUIRED_FIELDS` - Required fields missing from request

### Subscription Errors
- `SUBSCRIPTION_INACTIVE` - Subscription not active (payment failed or cancelled)
- `NO_VALID_SUBSCRIPTION` - No subscription found for this payment session
- `INVALID_CREDENTIALS_OR_SUBSCRIPTION` - Invalid credentials or inactive subscription

### Session Errors
- `SESSION_CONFLICT` - Another device using this license
- `SESSION_NOT_FOUND` - Session expired or doesn't exist
- `MISSING_SESSION_DATA` - Session ID or device info missing
- `INVALID_SESSION_ACTION` - Unsupported session action

### Request Errors
- `INVALID_REQUEST_FORMAT` - Request body structure invalid
- `MISSING_SESSION_ID` - Session ID required but not provided
- `UNSUPPORTED_OPERATION` - Operation type not supported

### System Errors
- `VALIDATION_ERROR` - General validation failure
- `INSTANT_VALIDATION_ERROR` - Instant validation failed
- `SESSION_OPERATION_ERROR` - Session operation failed
- `REQUEST_PROCESSING_ERROR` - Error processing request
- `CIRCUIT_BREAKER_OPEN` - Database protection activated
- `DATABASE_ERROR` - Database operation failed
- `TIMEOUT_ERROR` - Operation timed out

### Customer Portal Errors
- `STRIPE_CUSTOMER_CREATION_FAILED` - Failed to create Stripe customer
- `STRIPE_PORTAL_CREATION_FAILED` - Failed to generate portal URL
- `STRIPE_PORTAL_NOT_CONFIGURED` - Stripe portal configuration missing

---

## 📦 Response Formats

### Standard Success Response
```json
{
  "success": true,
  "timestamp": "2025-10-11T12:00:00.000Z",
  "requestId": "req_abc123xyz",
  "data": { /* endpoint-specific data */ },
  "metadata": {
    "apiVersion": "2.0",
    "operation": "operation_name",
    "endpoint": "/endpoint-path"
  }
}
```

### Standard Error Response
```json
{
  "success": false,
  "timestamp": "2025-10-11T12:00:00.000Z",
  "requestId": "req_abc123xyz",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "category": "authentication|subscription|session|system|general",
    "severity": "high|medium|low",
    "retryable": true|false
  },
  "responseTime": 45,
  "metadata": {
    "apiVersion": "2.0",
    "endpoint": "/endpoint-path"
  }
}
```

### Legacy Response Format (for `/validate` endpoint)
```json
{
  "valid": true|false,
  "error": "Error message (if valid=false)",
  "errorCode": "ERROR_CODE",
  "data": { /* validation data */ }
}
```

---

## 🔄 Caching Strategies

### Response Cache Control Headers
- `Cache-Control: private, max-age={duration}`
- `X-API-Version: 2.0`
- `X-Response-Time: {milliseconds}`
- `X-Cache-Strategy: aggressive|moderate|conservative|minimal|none`
- `X-Validation-Timestamp: {ISO timestamp}`

### Cache Duration Guidelines
| Strategy | Duration | Use Case |
|----------|----------|----------|
| Aggressive | 3600s (1h) | Recent validations (<1h ago) |
| Moderate | 1800s (30m) | Active subscriptions (1-24h ago) |
| Conservative | 900s (15m) | Older validations (>24h ago) |
| Minimal | 300s (5m) | Inactive subscriptions |
| None | 0s | Errors, negative results |

---

## 📊 Rate Limiting

**Current Status**: No rate limiting implemented at Cloudflare Workers level.

Cloudflare Workers automatically scale to handle load. Rate limiting (if needed) should be implemented at the Flask backend level or using Cloudflare's built-in rate limiting features.

---

## 🛡️ Security Notes

1. **HTTPS Only**: All endpoints require HTTPS
2. **CORS**: Configured for specific origins
3. **Input Validation**: All inputs validated before processing
4. **SQL Injection Prevention**: Parameterized queries used throughout
5. **Machine Fingerprinting**: SHA-256 hashed before storage
6. **Webhook Signature**: Stripe webhooks verified with signature (except `/test-webhook`)
7. **Circuit Breaker**: Database protection against cascading failures
8. **Idempotency**: Webhook events processed only once

---

## 📞 Support

For API support or issues:
- Email: support@pospal.gr
- Documentation: See `PRODUCTION_STATUS.md` and `TROUBLESHOOTING.md`
- Health Check: https://pospal-licensing-v2-production.bzoumboulis.workers.dev/health

---

**Last Updated**: October 11, 2025
**API Version**: 2.0.0
**Status**: Production - Fully Operational
