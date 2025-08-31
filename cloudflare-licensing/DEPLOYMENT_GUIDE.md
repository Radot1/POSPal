# POSPal Email + Token Licensing System - Deployment Guide

## Quick Start (30 minutes to live system)

### Prerequisites
- Cloudflare account (free)
- Stripe account
- Resend account (free tier)
- Node.js installed locally

---

## Step 1: Cloudflare D1 Database Setup (5 minutes)

### 1.1 Install Wrangler CLI
```bash
npm install -g wrangler
wrangler login
```

### 1.2 Create D1 Databases
```bash
# Production database
wrangler d1 create pospal-subscriptions

# Development database  
wrangler d1 create pospal-subscriptions-dev
```

### 1.3 Update wrangler.toml
Replace `YOUR_DATABASE_ID_HERE` in `wrangler.toml` with the IDs from step 1.2

### 1.4 Initialize Database Schema
```bash
# Production
wrangler d1 execute pospal-subscriptions --env production --file=schema.sql

# Development
wrangler d1 execute pospal-subscriptions-dev --env development --file=schema.sql
```

---

## Step 2: Stripe Setup (10 minutes)

### 2.1 Create Stripe Account
- Sign up at stripe.com
- Get your API keys from Dashboard → Developers → API keys

### 2.2 Create Monthly Product
```bash
# Using Stripe CLI (or do this in Dashboard)
stripe products create --name="POSPal Pro" --description="Monthly POSPal subscription"

# Create €20/month price
stripe prices create \
  --unit-amount=2000 \
  --currency=eur \
  --recurring-interval=month \
  --product=prod_YOUR_PRODUCT_ID
```

### 2.3 Set Up Webhook
- Go to Dashboard → Developers → Webhooks
- Add endpoint: `https://license.pospal.gr/webhook`
- Select events:
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `customer.subscription.deleted`
- Copy the webhook signing secret

---

## Step 3: Resend Email Setup (2 minutes)

### 3.1 Create Resend Account
- Sign up at resend.com (free tier: 100 emails/day)
- Get API key from Dashboard

### 3.2 Add Domain (Optional)
- Add `pospal.gr` domain for branded emails
- Or use default `onresend.com` domain

---

## Step 4: Environment Variables (3 minutes)

### 4.1 Update wrangler.toml
Replace these values in `wrangler.toml`:

```toml
# Production
STRIPE_SECRET_KEY = "sk_live_YOUR_LIVE_KEY"
STRIPE_WEBHOOK_SECRET = "whsec_YOUR_WEBHOOK_SECRET"
RESEND_API_KEY = "re_YOUR_RESEND_KEY"

# Development
STRIPE_SECRET_KEY = "sk_test_YOUR_TEST_KEY"
STRIPE_WEBHOOK_SECRET = "whsec_YOUR_TEST_WEBHOOK_SECRET"
RESEND_API_KEY = "re_YOUR_RESEND_KEY"
```

---

## Step 5: Deploy Workers (5 minutes)

### 5.1 Install Dependencies
```bash
cd cloudflare-licensing
npm install
```

### 5.2 Deploy
```bash
# Deploy to development
npm run deploy-dev

# Deploy to production
npm run deploy
```

### 5.3 Update unlock-pospal.html
Replace `pk_test_YOUR_PUBLISHABLE_KEY_HERE` with your actual Stripe publishable key.

---

## Step 6: DNS Setup (5 minutes)

### 6.1 Add DNS Records
Add these CNAME records to your domain:

```
license.pospal.gr → license-system.your-subdomain.workers.dev
```

### 6.2 Update Routes (Optional)
In `wrangler.toml`, update routes to match your domain:

```toml
[[env.production.routes]]
pattern = "license.pospal.gr/*"
```

---

## Step 7: Test the System (10 minutes)

### 7.1 Test Checkout Flow
1. Visit `https://pospal.gr/unlock-pospal.html`
2. Enter test email and name
3. Use Stripe test card: `4242424242424242`
4. Complete checkout
5. Check email was sent via Resend dashboard

### 7.2 Test License Validation
1. Click "Already paid? Enter unlock code" 
2. Enter email and token from test email
3. Verify license file downloads

### 7.3 Test Webhook
1. Check Cloudflare Workers logs
2. Verify customer was created in D1 database:

```bash
wrangler d1 execute pospal-subscriptions --env production --command="SELECT * FROM customers LIMIT 5"
```

---

## Going Live Checklist

### Production Readiness
- [ ] Replace Stripe test keys with live keys
- [ ] Update webhook endpoint to production URL
- [ ] Test with real €1 transaction
- [ ] Verify email delivery to real email address
- [ ] Set up monitoring/alerts

### App Integration
- [ ] Update POSPal app to call validation endpoint
- [ ] Add unlock dialog to POSPal interface
- [ ] Test machine switching functionality
- [ ] Update trial expiration to redirect to unlock page

### Marketing Pages
- [ ] Update `subscribe.html` to redirect to new unlock page
- [ ] Add pricing info to main website
- [ ] Create customer support documentation

---

## Monitoring & Maintenance

### Daily Checks
- Email delivery success rate (Resend dashboard)
- Failed webhook events (Cloudflare logs)
- Customer complaints about unlock codes

### Weekly Checks
- Database size and performance
- Subscription churn rate
- Machine switching frequency

### Monthly Tasks
- Review customer support tickets
- Update email templates based on feedback
- Monitor conversion rates

---

## Troubleshooting

### "Webhook not received"
1. Check Stripe webhook logs
2. Verify endpoint URL is correct
3. Check Cloudflare Workers logs
4. Ensure webhook events are selected

### "Email not delivered"
1. Check Resend dashboard for delivery status
2. Verify API key is correct
3. Check spam folder
4. Ensure domain is verified (if using custom domain)

### "License validation fails"
1. Check customer exists in database
2. Verify unlock token matches
3. Check subscription status is 'active'
4. Verify machine fingerprint logic

### "Database errors"
1. Check D1 database exists and schema is applied
2. Verify binding name in wrangler.toml matches code
3. Check database limits (100k reads/day on free plan)

---

## Cost Breakdown

### Free Tier Limits (Monthly)
- **Cloudflare Workers**: 100k requests
- **Cloudflare D1**: 100k reads, 50k writes
- **Resend**: 100 emails/day (3000/month)
- **Stripe**: 2.9% + €0.25 per transaction

### Scaling Costs (1000 customers)
- **Cloudflare Workers**: Free (within limits)
- **Resend**: €20/month (10k emails)
- **Stripe**: ~€0.83 per €20 transaction
- **Total**: ~€20-40/month operational costs

---

## Security Considerations

### Data Protection
- Customer emails are encrypted in D1 database
- Machine fingerprints are hashed
- Unlock tokens are cryptographically secure

### API Security  
- Webhook signature verification
- Rate limiting on validation endpoints
- CORS headers properly configured

### Business Logic
- One license per machine enforcement
- Subscription status validation
- Payment failure handling (3 strikes rule)

---

## Success Metrics to Track

### Technical Metrics
- Webhook delivery success rate (>99%)
- Email delivery success rate (>95%) 
- License validation response time (<500ms)
- System uptime (>99.9%)

### Business Metrics
- Trial-to-paid conversion rate (target: 5-10%)
- Monthly churn rate (target: <20%)
- Customer support ticket volume (target: <5%)
- Time to first unlock (target: <2 minutes)

---

## Next Steps After Launch

### Week 1-2: Monitor & Fix
- Watch for any system errors
- Respond quickly to customer support
- Fix any edge cases discovered

### Month 1: Optimize
- A/B test email templates
- Optimize unlock page conversion
- Add usage analytics

### Month 2-3: Scale
- Add customer portal features
- Implement renewal reminders
- Add team/multi-seat plans

**Goal: First paying customer within 48 hours of deployment** 🚀