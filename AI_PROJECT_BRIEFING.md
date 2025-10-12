# POSPal AI Project Briefing
**Last Updated**: October 2025
**Version**: 2.0
**Status**: LIVE IN PRODUCTION (Fully Operational)

## 🎯 Project Overview
POSPal is a Point-of-Sale (POS) application for restaurants with a subscription-based licensing system. The system handles payment processing, license validation, and customer management through a hybrid Flask/Cloudflare Workers architecture.

## 🏗️ System Architecture

```
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│   POSPal App    │    │   Flask Backend      │    │ Cloudflare      │
│   (Client)      │───▶│   (localhost:5000)   │───▶│ Workers API     │
│   License Check │    │   API Endpoints      │    │ Payment/License │
└─────────────────┘    └──────────────────────┘    └─────────────────┘
                                │                           │
                                ▼                           ▼
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│   Customer      │    │   Local Data         │    │ Cloudflare D1   │
│   Portal/Web    │    │   JSON Files         │    │ Database        │
│   Interface     │    │   Menu, Orders       │    │ Subscriptions   │
└─────────────────┘    └──────────────────────┘    └─────────────────┘
                                │
                                ▼
                    ┌──────────────────────┐
                    │   Stripe Payment     │
                    │   Processing         │
                    │   Webhooks           │
                    └──────────────────────┘
```

## 📂 Key File Structure
```
POSPal/
├── app.py                          # Main Flask application (4400+ lines)
├── config.py                       # Configuration management
├── pospalCore.js                   # Frontend JavaScript core
├── data/                           # Local data storage
│   ├── menu.json                   # Restaurant menu data
│   ├── orders.json                 # Order history
│   └── license.json                # License file (when active)
├── cloudflare-licensing/           # Payment & licensing system
│   ├── src/index.js               # Cloudflare Workers main
│   ├── src/utils.js               # Utilities and helpers
│   ├── complete-schema.sql        # Database schema
│   ├── deploy-database.bat        # DB deployment script
│   ├── backup-database.bat        # DB backup script
│   └── verify-database.js         # DB verification tool
├── HTML Files/                     # Frontend pages
│   ├── POSPal.html                # Main POS interface
│   ├── buy-license.html           # License purchase page
│   ├── customer-portal.html       # Customer management
│   └── success.html               # Payment success page
└── Documentation/
    ├── PRODUCTION_DEPLOYMENT_GUIDE.md
    ├── TROUBLESHOOTING.md
    └── AI_PROJECT_BRIEFING.md (this file)
```

## 🔧 Technology Stack

### Backend (Flask)
- **Python 3.8+** with Flask web framework
- **Local JSON storage** for menu, orders, analytics
- **File-based licensing** system with hardware fingerprinting
- **API endpoints** for frontend communication
- **Rate limiting** with Flask-Limiter
- **Environment variables** for configuration

### Frontend 
- **Vanilla JavaScript** (pospalCore.js - 2000+ lines)
- **HTML5/CSS3** with Tailwind CSS
- **Responsive design** for mobile and desktop
- **Real-time updates** for orders and inventory
- **Touch-friendly interface** for tablets

### Payment System (Cloudflare Workers)
- **Cloudflare Workers** (JavaScript runtime)
- **Cloudflare D1** (SQLite database)
- **Stripe integration** for payment processing
- **Resend.com** for email delivery
- **Webhook handling** for payment events

## 💳 Payment Flow
1. **Customer** visits buy-license.html
2. **Flask** serves the purchase page
3. **Frontend** calls `/api/create-subscription-session`
4. **Flask** forwards request to **Cloudflare Workers**
5. **Workers** creates Stripe checkout session
6. **Customer** completes payment on Stripe
7. **Stripe** sends webhook to **Workers**
8. **Workers** processes payment and creates license
9. **Email** sent to customer with license file
10. **Customer** downloads and installs license in POSPal

## 🗄️ Database Schema (Cloudflare D1)
```sql
-- Core tables
customers            # Customer accounts and subscriptions
audit_log           # System activity logging  
email_log           # Email delivery tracking
active_sessions     # Session management
refund_requests     # Customer refund requests
schema_version      # Database version tracking

-- Key indexes for performance
idx_customers_email, idx_customers_token
idx_audit_customer, idx_sessions_cleanup
```

## 🔐 Security Implementation
- **Environment variables** for all secrets (Stripe keys, API tokens)
- **Input validation** on all endpoints
- **Rate limiting** (3-5 requests per 5 minutes)
- **Hardware fingerprinting** for license validation
- **CORS protection** and secure headers
- **SQL injection prevention** (parameterized queries)

## 📍 Current Status & Completed Work

### ✅ PRODUCTION DEPLOYMENT STATUS
**Live URL**: `https://pospal-licensing-v2-production.bzoumboulis.workers.dev`
**API Version**: 2.0.0
**Environment**: Production
**Last Deployment**: September 15, 2025
**Health Status**: ✅ Operational (Database: 56ms response time)

### ✅ COMPLETED & DEPLOYED
1. **Real Stripe Payment Processing** - ✅ LIVE with idempotent webhook handling
2. **Unified Validation API (v2.0)** - ✅ Circuit breaker protection, intelligent caching
3. **NO GRACE PERIOD Policy** - ✅ Immediate suspension/reactivation on payment events
4. **Session Management** - ✅ Prevent multi-device usage with active session tracking
5. **Customer Portal Integration** - ✅ Direct Stripe portal access with fallback handling
6. **Email Automation** - ✅ Welcome, suspension, reactivation emails via Resend.com
7. **Security Hardening** - ✅ All secrets in environment variables, webhook idempotency
8. **Machine Fingerprinting** - ✅ Hardware-locked licenses with hash storage
9. **Comprehensive Audit Logging** - ✅ All actions logged with metadata
10. **Database Schema v3** - ✅ Optimized indexes, webhook_events table for idempotency

### 🎯 PRODUCTION FEATURES
- **Monthly Subscription Model**: €20/month recurring billing
- **Instant Post-Payment Validation**: Zero-delay license activation
- **Automatic Renewal Processing**: Stripe handles recurring charges
- **Failed Payment Handling**: Immediate suspension (no grace period)
- **Machine Switch Detection**: Email alerts for security
- **Duplicate Prevention**: Blocks multiple active subscriptions per email

## 🛠️ Development Environment Setup

### Prerequisites
- Python 3.8+ with pip
- Node.js 18+ with npm
- Wrangler CLI (`npm install -g wrangler`)

### Quick Start
```bash
# 1. Install dependencies
pip install -r requirements.txt
cd cloudflare-licensing && npm install

# 2. Configure environment
cp .env.template .env.local
# Fill in actual API keys

# 3. Start services
python app.py                    # Flask on :5000
wrangler dev --port 8787        # Workers on :8787

# 4. Test integration
curl http://localhost:5000/api/config
curl http://127.0.0.1:8787/health
```

## 🔍 Key API Endpoints

### Flask Backend (localhost:5000)
- `GET /api/config` - System configuration
- `GET /api/trial_status` - License status check
- `POST /api/validate-license` - License validation
- `POST /api/create-subscription-session` - Start payment flow
- `POST /api/create-portal-session` - Customer portal access

### Cloudflare Workers API v2.0 (Production)
**Base URL**: `https://pospal-licensing-v2-production.bzoumboulis.workers.dev`

#### Core Endpoints
- `GET /health` - Health check with circuit breaker status
- `POST /webhook` - Stripe webhook handler (idempotent)
- `POST /test-webhook` - Development webhook testing

#### Validation Endpoints (v2.0)
- `POST /validate-unified` - **NEW** Unified validation API with intelligent caching
- `POST /validate` - Legacy license validation (still supported)
- `POST /instant-validate` - Post-payment instant validation

#### Session Management
- `POST /session/start` - Start device session
- `POST /session/heartbeat` - Keep session alive
- `POST /session/end` - End session gracefully
- `POST /session/takeover` - Force device switch (kick other session)

#### Customer Portal
- `POST /create-checkout-session` - Create Stripe checkout session
- `POST /create-portal-session` - Generate Stripe billing portal URL
- `POST /customer-portal` - Get customer subscription data

## 📊 Performance Characteristics
- **Production API Response**: 56ms average (measured via /health endpoint)
- **Database Queries**: 2-4ms average on Cloudflare D1
- **Concurrent Users**: Tested with 20+ users, performs efficiently
- **Circuit Breaker**: Protects against database failures (state: CLOSED = healthy)
- **Intelligent Caching**:
  - Aggressive: 1 hour for recently validated licenses
  - Moderate: 30 minutes for active subscriptions
  - Conservative: 15 minutes for older validations
  - Minimal: 5 minutes for inactive subscriptions

## 🚨 Common Issues & Solutions

### "Subscription is not active"
- **Cause**: Payment failed and immediate suspension policy triggered
- **Solution**: Customer must update payment method via Stripe portal (NO GRACE PERIOD)

### "Another device is currently using this license"
- **Cause**: Session conflict - license already active on another device
- **Solution**: Use `/session/takeover` endpoint or wait 2 minutes for session timeout

### "Invalid email or unlock token"
- **Cause**: Wrong credentials or subscription not found in database
- **Solution**: Verify email/token combination, check database for customer record

### "Customer portal is temporarily unavailable"
- **Cause**: Missing Stripe customer_id or portal not configured
- **Solution**: System auto-creates Stripe customer as fallback, retry after 30 seconds

### Webhook Event Already Processed
- **Expected Behavior**: Idempotency protection prevents duplicate processing
- **Solution**: This is normal, webhook system working correctly

## 🧪 Testing & Verification

### Production Health Check
```bash
curl https://pospal-licensing-v2-production.bzoumboulis.workers.dev/health
# Expected: {"status":"healthy","services":{"database":{"status":"healthy",...}}
```

### Test Webhook Processing
```bash
# Use /test-webhook endpoint for development testing (bypasses signature verification)
curl -X POST https://pospal-licensing-v2-production.bzoumboulis.workers.dev/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"checkout.session.completed",...}'
```

### Verify Customer Record
```bash
cd cloudflare-licensing
npx wrangler d1 execute pospal-subscriptions \
  --command "SELECT email, subscription_status, unlock_token FROM customers WHERE email='test@example.com'" \
  --env production --remote
```

## 📈 Business Model (LIVE)
- **Monthly Subscription**: €20/month recurring billing via Stripe
- **Hardware-locked licensing**: One license = one active device session
- **Automatic Email Delivery**: Welcome email with unlock_token on signup
- **Stripe Customer Portal**: Direct billing management integration
- **NO GRACE PERIOD**: Immediate suspension on payment failure
- **Instant Reactivation**: Subscription restores immediately upon successful payment
- **Duplicate Prevention**: System blocks multiple active subscriptions per email

## 🎯 Production Monitoring & Maintenance
1. **Health Monitoring**: Check `/health` endpoint for system status
2. **Database Backups**: Use `backup-database.bat` for D1 snapshots
3. **Webhook Logs**: Query `webhook_events` table for idempotency tracking
4. **Audit Trail**: Review `audit_log` table for customer actions
5. **Email Delivery**: Monitor `email_log` table for delivery failures
6. **Session Management**: Check `active_sessions` for device conflicts

## 💡 AI Assistant Notes
- **System is LIVE IN PRODUCTION** - actively processing subscriptions
- **All core features deployed** - payment, validation, session management operational
- **Source of Truth**: `cloudflare-licensing/src/index.js` (deployed code)
- **API Version**: 2.0 with unified validation endpoints
- **NO GRACE PERIOD Policy**: Immediate suspension/reactivation implemented
- **Circuit Breaker**: Database protection layer active (state: CLOSED = healthy)
- **Idempotency**: All webhooks protected against duplicate processing
- **Fallback Handling**: Auto-creates Stripe customers when customer_id missing

## 🔗 Important File References
- **Main Application**: `app.py` (lines 1-4400+)
- **Frontend Core**: `pospalCore.js` (lines 1-2000+)
- **Workers API**: `cloudflare-licensing/src/index.js`
- **Database Schema**: `cloudflare-licensing/complete-schema.sql`
- **Deployment Guide**: `PRODUCTION_DEPLOYMENT_GUIDE.md`
- **Troubleshooting**: `TROUBLESHOOTING.md`

---

**This briefing provides complete context for any AI assistant to immediately understand the POSPal project structure, current status, and development priorities without requiring extensive codebase scanning.**