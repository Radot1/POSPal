# POSPal Production Deployment Guide

## Overview
This guide covers the complete production deployment process for POSPal's subscription-based licensing system, including Flask application, Cloudflare Workers, and database setup.

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│   POSPal App    │    │   Flask Backend      │    │ Cloudflare      │
│   (Client)      │───▶│   (localhost:5000)   │───▶│ Workers API     │
└─────────────────┘    └──────────────────────┘    └─────────────────┘
                                                             │
                                                             ▼
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│   Customer      │    │   Stripe Payment     │    │ Cloudflare D1   │
│   Portal        │───▶│   Processing         │    │ Database        │
└─────────────────┘    └──────────────────────┘    └─────────────────┘
```

## Prerequisites

### Required Accounts & Services
- [ ] **Cloudflare Account** with Workers & D1 Database enabled
- [ ] **Stripe Account** with test/live API keys  
- [ ] **Resend.com Account** for email delivery
- [ ] **Windows Server** or **Linux Server** for Flask deployment
- [ ] **Domain** with DNS access for custom URLs

### Required Software
- [ ] **Python 3.8+** with pip
- [ ] **Node.js 18+** with npm
- [ ] **Wrangler CLI** (`npm install -g wrangler`)
- [ ] **Git** for version control

## Phase 1: Environment Setup

### 1.1 Clone Repository
```bash
git clone <repository-url>
cd POSPal
```

### 1.2 Install Dependencies
```bash
# Install Python dependencies
pip install -r requirements.txt

# Install Cloudflare Workers dependencies
cd cloudflare-licensing
npm install
cd ..
```

### 1.3 Environment Configuration
Create environment files based on templates:

```bash
# Copy environment templates
cp .env.template .env.local
cp cloudflare-licensing/.env.template cloudflare-licensing/.env.local
```

## Phase 2: Database Setup

### 2.1 Create Production Database
```bash
cd cloudflare-licensing

# Create production database
wrangler d1 create pospal-subscriptions --env production

# Create development database
wrangler d1 create pospal-subscriptions-dev --env development
```

### 2.2 Deploy Database Schema
```bash
# Deploy to development first
./deploy-database.bat
# Choose option 1 (Development)

# Deploy to production
./deploy-database.bat  
# Choose option 2 (Production)
```

### 2.3 Verify Database
```bash
# Verify deployment
./deploy-database.bat
# Choose option 3 (Verify existing database)
```

## Phase 3: Cloudflare Workers Deployment

### 3.1 Configure Environment Variables
Set the following secrets in Cloudflare Workers:

```bash
# Stripe Configuration
wrangler secret put STRIPE_SECRET_KEY --env production
wrangler secret put STRIPE_PUBLISHABLE_KEY --env production
wrangler secret put STRIPE_WEBHOOK_SECRET --env production
wrangler secret put STRIPE_PRICE_ID --env production

# Email Configuration  
wrangler secret put RESEND_API_KEY --env production
wrangler secret put FROM_EMAIL --env production

# System Configuration
wrangler secret put ALLOWED_ORIGINS --env production
wrangler secret put SYSTEM_ADMIN_EMAIL --env production
```

### 3.2 Deploy Workers
```bash
# Deploy to production
wrangler deploy --env production

# Verify deployment
curl https://your-workers-subdomain.your-domain.workers.dev/health
```

### 3.3 Configure Custom Domain (Optional)
```bash
# Add custom domain
wrangler custom-domains add api.yourdomain.com --env production
```

## Phase 4: Flask Application Deployment

### 4.1 Configure Production Environment
Update `.env.local` with production values:

```env
# Stripe Configuration
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...

# Cloudflare Workers URL
CLOUDFLARE_WORKERS_URL=https://api.yourdomain.com

# Email Configuration
RESEND_API_KEY=re_...
FROM_EMAIL=noreply@yourdomain.com

# System Settings
FLASK_ENV=production
FLASK_DEBUG=False
```

### 4.2 Production Server Setup

#### Option A: Windows Server with IIS
1. Install **Python 3.8+** and **pip**
2. Install **IIS** with **CGI module**
3. Configure **web.config** for Python application
4. Set up **SSL certificate**
5. Configure **Windows Firewall** for port 5000

#### Option B: Linux Server with Gunicorn
```bash
# Install Gunicorn
pip install gunicorn

# Create systemd service
sudo nano /etc/systemd/system/pospal.service

[Unit]
Description=POSPal Flask Application
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/path/to/POSPal
ExecStart=/path/to/venv/bin/gunicorn --bind 0.0.0.0:5000 app:app
Restart=always

[Install]
WantedBy=multi-user.target

# Enable and start service
sudo systemctl enable pospal
sudo systemctl start pospal
```

#### Option C: Docker Deployment
```dockerfile
# Dockerfile
FROM python:3.9-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
```

```bash
# Build and run
docker build -t pospal .
docker run -d -p 5000:5000 --env-file .env.local pospal
```

### 4.3 SSL Configuration
Set up SSL certificate for HTTPS:

#### Using Cloudflare SSL (Recommended)
1. Add domain to Cloudflare
2. Enable **SSL/TLS Full (Strict)**  
3. Configure **Origin Certificate**
4. Update Flask to serve HTTPS

#### Using Let's Encrypt
```bash
# Install Certbot
sudo apt install certbot

# Get certificate
sudo certbot certonly --standalone -d yourdomain.com

# Configure web server to use certificate
```

### 4.4 Firewall Configuration
```bash
# Allow HTTPS traffic
sudo ufw allow 443/tcp
sudo ufw allow 5000/tcp  # If Flask runs on 5000

# For Windows
netsh advfirewall firewall add rule name="POSPal HTTPS" dir=in action=allow protocol=TCP localport=443
```

## Phase 5: Stripe Configuration

### 5.1 Webhook Endpoints
Configure Stripe webhooks to point to your Cloudflare Workers:

1. **Stripe Dashboard** → **Developers** → **Webhooks**
2. **Add endpoint**: `https://api.yourdomain.com/webhook`
3. **Events to send**:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`

### 5.2 Product & Price Setup
Create products and prices in Stripe Dashboard:

1. **Products** → **Add Product**
2. **Name**: "POSPal License"
3. **Pricing**: One-time payment or subscription
4. **Copy Price ID** to environment variables

## Phase 6: DNS Configuration

### 6.1 Domain Records
Configure DNS records:

```
A     yourdomain.com          → [Flask Server IP]
CNAME api.yourdomain.com      → [Cloudflare Workers URL]
CNAME www.yourdomain.com      → yourdomain.com
```

### 6.2 Subdomain Configuration
- **api.yourdomain.com** → Cloudflare Workers
- **app.yourdomain.com** → Flask Application
- **portal.yourdomain.com** → Customer Portal

## Phase 7: Testing & Verification

### 7.1 Integration Testing
```bash
# Test Flask application
curl https://app.yourdomain.com/api/config

# Test Cloudflare Workers
curl https://api.yourdomain.com/health

# Test payment flow
curl -X POST https://app.yourdomain.com/api/create-subscription-session \
  -H "Content-Type: application/json" \
  -d '{"customerName":"Test","customerEmail":"test@example.com","hardwareId":"TEST123"}'
```

### 7.2 End-to-End Testing
1. **Payment Flow**: Complete a test purchase
2. **License Delivery**: Verify license email delivery  
3. **License Validation**: Test license in POSPal app
4. **Customer Portal**: Test subscription management

### 7.3 Load Testing
```bash
# Run performance tests
node performance-test-suite.js
node high-load-test.js
```

## Phase 8: Monitoring & Maintenance

### 8.1 Logging Configuration
- **Flask Logs**: Configure log rotation and centralized logging
- **Workers Logs**: Monitor via Cloudflare Dashboard
- **Stripe Logs**: Monitor webhook delivery in Stripe Dashboard

### 8.2 Backup Procedures
```bash
# Automated database backups
./backup-database.bat

# Schedule daily backups via cron/Task Scheduler
0 2 * * * /path/to/POSPal/cloudflare-licensing/backup-database.bat
```

### 8.3 Health Monitoring
Set up monitoring for:
- [ ] **Flask Application** uptime
- [ ] **Cloudflare Workers** response times
- [ ] **Database** query performance
- [ ] **Payment Processing** success rates
- [ ] **Email Delivery** status

### 8.4 Security Updates
- [ ] **Regular Updates**: Keep all dependencies updated
- [ ] **Security Patches**: Monitor for security advisories  
- [ ] **API Key Rotation**: Regularly rotate Stripe/API keys
- [ ] **Certificate Renewal**: Automate SSL certificate renewal

## Phase 9: Disaster Recovery

### 9.1 Backup Strategy
- **Database**: Daily automated backups to secure storage
- **Code**: Git repository with tagged releases
- **Configuration**: Encrypted environment files backup
- **SSL Certificates**: Backup of SSL certificates and keys

### 9.2 Recovery Procedures
1. **Database Recovery**: Restore from backup using `restore-database.bat`
2. **Application Recovery**: Redeploy from Git with known good commit
3. **DNS Recovery**: Backup DNS configuration and restore process
4. **Service Recovery**: Step-by-step service restoration checklist

## Phase 10: Performance Optimization

### 10.1 Production Optimizations
- **Caching**: Implement Redis/Memcached for Flask sessions
- **CDN**: Use Cloudflare CDN for static assets
- **Load Balancing**: Configure load balancer for high availability
- **Database Optimization**: Monitor and optimize slow queries

### 10.2 Scaling Considerations
- **Horizontal Scaling**: Multiple Flask instances with load balancer
- **Database Scaling**: Consider read replicas for heavy read workloads
- **Workers Scaling**: Cloudflare Workers auto-scale automatically
- **Monitoring**: Set up alerts for resource utilization

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for detailed troubleshooting guide.

## Security Checklist

- [ ] All API keys stored as environment variables/secrets
- [ ] HTTPS enabled for all communications  
- [ ] Webhook signature verification enabled
- [ ] Input validation on all endpoints
- [ ] Rate limiting configured
- [ ] SQL injection prevention (parameterized queries)
- [ ] CORS properly configured
- [ ] Regular security updates applied

## Post-Deployment Checklist

- [ ] **DNS propagation** completed
- [ ] **SSL certificates** installed and valid
- [ ] **All services** responding correctly
- [ ] **Payment flow** tested end-to-end
- [ ] **Email delivery** working
- [ ] **Customer portal** accessible
- [ ] **Monitoring** configured and alerting
- [ ] **Backups** scheduled and tested
- [ ] **Documentation** updated with production URLs
- [ ] **Team trained** on production procedures

---

## Support Contacts

- **System Administrator**: [admin-email]
- **Developer Support**: [dev-support-email]  
- **Emergency Contact**: [emergency-contact]

**Last Updated**: [Date]
**Version**: 1.0