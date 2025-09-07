# POSPal Troubleshooting Guide

## Overview
This guide provides solutions to common issues encountered in POSPal's subscription and licensing system.

## Table of Contents
1. [Payment Processing Issues](#payment-processing-issues)
2. [License Validation Problems](#license-validation-problems)
3. [Flask Application Issues](#flask-application-issues)
4. [Cloudflare Workers Issues](#cloudflare-workers-issues)
5. [Database Problems](#database-problems)
6. [Email Delivery Issues](#email-delivery-issues)
7. [Performance Problems](#performance-problems)
8. [SSL/HTTPS Issues](#ssl-https-issues)
9. [Environment Configuration](#environment-configuration)
10. [Emergency Procedures](#emergency-procedures)

---

## Payment Processing Issues

### ❌ "Payment system temporarily unavailable" Error

**Symptoms**: Users see fallback mode during checkout
**Cause**: Cloudflare Workers API connection failure

**Diagnosis**:
```bash
# Test Workers connection
curl https://api.yourdomain.com/health

# Check Flask logs for API calls
tail -f /path/to/flask/logs/app.log | grep "cloudflare"
```

**Solution**:
1. **Check Workers Status**:
   ```bash
   wrangler dev --env production  # Test locally first
   ```
2. **Verify Environment Variables**:
   ```bash
   wrangler secret list --env production
   ```
3. **Check API Keys**:
   - Validate `STRIPE_SECRET_KEY` in Workers
   - Ensure `CLOUDFLARE_WORKERS_URL` in Flask is correct

**Prevention**: Set up monitoring alerts for API endpoint health

---

### ❌ Stripe Webhook Not Working

**Symptoms**: Payments succeed but licenses not delivered
**Cause**: Webhook endpoint not reachable or signature verification failing

**Diagnosis**:
```bash
# Check webhook logs in Stripe Dashboard
# Test webhook endpoint
curl -X POST https://api.yourdomain.com/webhook \
  -H "stripe-signature: test" \
  -d '{"type":"test"}'
```

**Solution**:
1. **Verify Webhook URL**: `https://api.yourdomain.com/webhook`
2. **Check Webhook Secret**:
   ```bash
   wrangler secret put STRIPE_WEBHOOK_SECRET --env production
   ```
3. **Test Webhook Signature Verification** in Cloudflare Workers logs

**Prevention**: Monitor webhook delivery success rate in Stripe Dashboard

---

### ❌ Invalid Hardware ID Format

**Symptoms**: "Invalid hardware ID format" error during checkout
**Cause**: Hardware ID doesn't meet validation requirements

**Diagnosis**: Check hardware ID validation in Flask:
```python
# app.py line 415-422
def validate_hardware_id(hardware_id):
    if not hardware_id or not isinstance(hardware_id, str):
        return False
    if len(hardware_id) < 10 or len(hardware_id) > 128:
        return False
    return all(c.isalnum() or c in '-_' for c in hardware_id)
```

**Solution**:
1. **Valid Format**: Alphanumeric, dashes, underscores only
2. **Length**: 10-128 characters
3. **Example**: `DESKTOP-ABC123-456-DEF789-GHI`

---

## License Validation Problems

### ❌ "License not found" Error

**Symptoms**: Valid license shows as invalid in POSPal app
**Cause**: License file missing, corrupted, or wrong format

**Diagnosis**:
```bash
# Check license file exists
ls -la /path/to/pospal/data/license.json

# Validate license file format
python -c "import json; print(json.load(open('data/license.json')))"
```

**Solution**:
1. **Regenerate License**:
   ```bash
   # Test API endpoint
   curl -X POST http://localhost:5000/api/validate-license \
     -H "Content-Type: application/json" \
     -d '{"unlockToken":"your-token","hardwareId":"your-hw-id"}'
   ```
2. **Check License File Permissions**
3. **Verify Hardware ID Match**

---

### ❌ Cloud Validation Failing

**Symptoms**: Local license works but cloud validation fails
**Cause**: Cloudflare Workers validation endpoint issues

**Diagnosis**:
```bash
# Test Workers validation endpoint
curl -X POST https://api.yourdomain.com/validate \
  -H "Content-Type: application/json" \
  -d '{"unlockToken":"test","machineFingerprint":"test"}'
```

**Solution**:
1. **Check Database Connection** in Workers
2. **Verify Token Format** in database
3. **Check Network Connectivity** from client to Workers

---

## Flask Application Issues

### ❌ Flask App Won't Start

**Symptoms**: "Port already in use" or startup errors
**Cause**: Port conflict or missing dependencies

**Diagnosis**:
```bash
# Check if port is in use
netstat -an | grep :5000

# Check Python dependencies
pip check

# Check app logs
python app.py
```

**Solution**:
1. **Kill Existing Process**:
   ```bash
   # Windows
   netstat -ano | findstr :5000
   taskkill /PID <process_id>
   
   # Linux
   sudo lsof -ti:5000 | xargs kill
   ```
2. **Install Missing Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

---

### ❌ High Memory Usage

**Symptoms**: Flask app consuming excessive RAM
**Cause**: Memory leaks or insufficient garbage collection

**Diagnosis**:
```bash
# Monitor memory usage
ps aux | grep python
top -p <flask_pid>
```

**Solution**:
1. **Restart Flask Application**
2. **Implement Connection Pooling**
3. **Add Memory Monitoring**:
   ```python
   import psutil
   print(f"Memory usage: {psutil.Process().memory_info().rss / 1024 / 1024:.1f} MB")
   ```

---

## Cloudflare Workers Issues

### ❌ Workers Deployment Failed

**Symptoms**: `wrangler deploy` errors
**Cause**: Configuration or permission issues

**Diagnosis**:
```bash
# Check wrangler authentication
wrangler whoami

# Validate wrangler.toml
wrangler validate
```

**Solution**:
1. **Re-authenticate Wrangler**:
   ```bash
   wrangler auth login
   ```
2. **Check wrangler.toml Configuration**
3. **Verify Database Bindings**

---

### ❌ D1 Database Connection Issues

**Symptoms**: "Database unavailable" errors in Workers
**Cause**: Database binding or permission problems

**Diagnosis**:
```bash
# List databases
wrangler d1 list

# Test database connection
wrangler d1 execute pospal-subscriptions --command="SELECT 1"
```

**Solution**:
1. **Verify Database Binding** in `wrangler.toml`
2. **Check Database Permissions**
3. **Recreate Database Binding** if necessary

---

## Database Problems

### ❌ Missing Tables Error

**Symptoms**: "Table 'customers' doesn't exist" errors
**Cause**: Database schema not deployed

**Diagnosis**:
```bash
# Check existing tables
wrangler d1 execute pospal-subscriptions --command="SELECT name FROM sqlite_master WHERE type='table'"
```

**Solution**:
```bash
# Deploy complete schema
cd cloudflare-licensing
./deploy-database.bat
# Choose appropriate environment
```

---

### ❌ Database Performance Issues

**Symptoms**: Slow query responses, timeouts
**Cause**: Missing indexes or large dataset

**Diagnosis**:
```bash
# Run database verification
node verify-database.js

# Check record counts
wrangler d1 execute pospal-subscriptions --command="SELECT COUNT(*) FROM customers"
```

**Solution**:
1. **Verify All Indexes Exist** (see `complete-schema.sql`)
2. **Clean Old Records**:
   ```sql
   DELETE FROM audit_log WHERE created_at < datetime('now', '-30 days');
   ```
3. **Monitor Query Performance**

---

## Email Delivery Issues

### ❌ License Emails Not Sending

**Symptoms**: Customers not receiving license emails
**Cause**: Resend API issues or configuration problems

**Diagnosis**:
```bash
# Check Resend API key
wrangler secret list --env production | grep RESEND

# Test email endpoint
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"from":"test@yourdomain.com","to":"test@example.com","subject":"Test"}'
```

**Solution**:
1. **Verify Resend API Key**
2. **Check Domain Configuration** in Resend dashboard
3. **Validate FROM_EMAIL** domain ownership

---

### ❌ Emails Going to Spam

**Symptoms**: Customers report emails in spam folder
**Cause**: SPF/DKIM/DMARC configuration issues

**Solution**:
1. **Configure SPF Record**:
   ```
   v=spf1 include:resend.com ~all
   ```
2. **Setup DKIM** in Resend dashboard
3. **Configure DMARC**:
   ```
   v=DMARC1; p=quarantine; rua=mailto:admin@yourdomain.com
   ```

---

## Performance Problems

### ❌ Slow API Response Times

**Symptoms**: >2s response times, user complaints
**Cause**: Network latency, database queries, or server overload

**Diagnosis**:
```bash
# Run performance tests
node performance-test-suite.js

# Check individual endpoints
curl -w "@curl-format.txt" -s -o /dev/null https://api.yourdomain.com/health
```

**Solution**:
1. **Optimize Database Queries**
2. **Implement Caching**:
   ```python
   from flask_caching import Cache
   cache = Cache(app)
   
   @cache.memoize(timeout=300)
   def expensive_operation():
       # cached for 5 minutes
   ```
3. **Scale Infrastructure** if needed

---

### ❌ High Load Failures

**Symptoms**: 503 errors under heavy traffic
**Cause**: Server capacity limitations

**Diagnosis**:
```bash
# Run load tests
node high-load-test.js

# Monitor server resources
top
df -h
```

**Solution**:
1. **Implement Rate Limiting** (already configured)
2. **Scale Horizontally**:
   - Deploy multiple Flask instances
   - Use load balancer
3. **Cloudflare Workers Auto-Scale** (already handles this)

---

## SSL/HTTPS Issues

### ❌ SSL Certificate Errors

**Symptoms**: "Not secure" warnings, connection errors
**Cause**: Expired or misconfigured certificates

**Diagnosis**:
```bash
# Check certificate expiry
openssl x509 -in certificate.crt -text -noout | grep "Not After"

# Test SSL configuration
curl -I https://yourdomain.com
```

**Solution**:
1. **Renew Certificate**:
   ```bash
   # Let's Encrypt
   certbot renew
   
   # Cloudflare
   # Automatic renewal via dashboard
   ```
2. **Update Certificate in Application**
3. **Verify HTTPS Redirect** is working

---

## Environment Configuration

### ❌ Environment Variables Missing

**Symptoms**: "Key error" or configuration not found
**Cause**: Missing or incorrect environment variable setup

**Diagnosis**:
```bash
# Check Flask environment
cat .env.local

# Check Workers secrets
wrangler secret list --env production
```

**Solution**:
1. **Recreate Environment Files**:
   ```bash
   cp .env.template .env.local
   # Fill in actual values
   ```
2. **Set Workers Secrets**:
   ```bash
   wrangler secret put VARIABLE_NAME --env production
   ```

---

### ❌ Wrong Environment Loading

**Symptoms**: Test mode in production or vice versa
**Cause**: Environment variable precedence issues

**Diagnosis**:
```python
import os
print("FLASK_ENV:", os.getenv('FLASK_ENV'))
print("STRIPE_PUBLISHABLE_KEY:", os.getenv('STRIPE_PUBLISHABLE_KEY', 'Not set')[:10] + '...')
```

**Solution**:
1. **Verify Environment Loading Order**
2. **Clear Environment Cache**
3. **Restart Application** after changes

---

## Emergency Procedures

### 🚨 System Down - Critical Failure

**Immediate Actions**:
1. **Check Service Status**:
   ```bash
   curl https://yourdomain.com/api/config
   curl https://api.yourdomain.com/health
   ```
2. **Check Recent Changes**: Review recent deployments
3. **Rollback if Necessary**:
   ```bash
   git reset --hard <last-known-good-commit>
   wrangler rollback --env production
   ```

### 🚨 Payment Processing Down

**Immediate Actions**:
1. **Enable Maintenance Mode** (if available)
2. **Switch to Fallback Processing** 
3. **Notify Customers** via email/website banner
4. **Check Stripe Status**: https://status.stripe.com

### 🚨 Data Loss Incident

**Immediate Actions**:
1. **Stop All Write Operations**
2. **Assess Scope of Loss**:
   ```bash
   wrangler d1 execute pospal-subscriptions --command="SELECT COUNT(*) FROM customers"
   ```
3. **Restore from Latest Backup**:
   ```bash
   ./restore-database.bat
   ```
4. **Validate Data Integrity**:
   ```bash
   node verify-database.js
   ```

---

## Monitoring & Alerting Setup

### Key Metrics to Monitor
- [ ] **API Response Times** (<2s average)
- [ ] **Error Rates** (<1% for critical endpoints)
- [ ] **Payment Success Rate** (>98%)
- [ ] **Email Delivery Rate** (>95%)
- [ ] **Database Query Performance** (<100ms average)
- [ ] **Server Resource Usage** (<80% CPU/Memory)

### Alert Thresholds
- **Critical**: API down >5 minutes, Payment failures >5%
- **Warning**: Response time >3s, Error rate >2%
- **Info**: Unusual traffic patterns, Resource usage >70%

---

## Diagnostic Commands Quick Reference

```bash
# System Health Check
curl https://yourdomain.com/api/config
curl https://api.yourdomain.com/health

# Database Status
wrangler d1 execute pospal-subscriptions --command="SELECT COUNT(*) FROM customers"
node verify-database.js

# Service Logs
tail -f /path/to/app.log
wrangler tail --env production

# Performance Test
node performance-test-suite.js

# Backup Database
./backup-database.bat

# Deploy Database
./deploy-database.bat
```

---

## Getting Help

### Internal Support
1. **Check Logs**: Always start with application logs
2. **Run Diagnostics**: Use provided scripts and tests
3. **Review Recent Changes**: Check git history
4. **Consult Documentation**: Reference architecture diagrams

### External Support
1. **Stripe Support**: For payment processing issues
2. **Cloudflare Support**: For Workers/D1 database issues  
3. **Resend Support**: For email delivery issues

### Emergency Contacts
- **System Administrator**: [admin-email]
- **Developer**: [dev-email]
- **24/7 Emergency**: [emergency-phone]

---

**Last Updated**: [Date]
**Version**: 1.0