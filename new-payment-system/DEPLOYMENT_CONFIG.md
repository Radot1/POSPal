# 🔐 POSPal v2.0 - Deployment Configuration

## ✅ ALL SECRETS COLLECTED

### Stripe Keys:
- **Publishable Key**: `pk_test_51S2bGO0ee6hGru1PcQXsgn6AvCPqDGqVwZ9AuON37wN3EQpsLNCSCMlpLC4U3xVAda7zgL2D4ifbT1TSXn0PJtbL00b1W7wxZT`
- **Secret Key**: `sk_test_51S2bGO0ee6hGru1PF5o9w508HFtJYwdSMIfUmbGXjUUwzXS7MBEpScjBC5WBsoIZP2a3FwjVeh8sw2Cf1Ptpp54i00LaksBs2d`
- **Webhook Secret**: `whsec_VDkwzJ2rwghFQt6IVwiSLuLARPl3vPIU`

### Generated Secrets:
- **JWT Secret**: `pospal_jwt_v2_secure_signing_key_2024_production_ready_32chars_minimum`
- **App Secret Key**: `0x8F3A2B1C9D4E5F6A` (matches POSPal app.py)

### Email Service:
- **Resend API Key**: `re_8E5HhfwM_5Za4spJwwoEoeCAf1uYnwQ2M` (from existing config)

---

## 🚀 DEPLOYMENT COMMANDS

### Step 1: Create D1 Database
```bash
cd new-payment-system
wrangler d1 create pospal-licensing-dev
```

### Step 2: Update wrangler.toml with Database ID
Copy the database ID from step 1 and update `wrangler.toml`

### Step 3: Run Database Schema
```bash
wrangler d1 execute pospal-licensing-dev --file=schema.sql
```

### Step 4: Set All Secrets
```bash
echo "sk_test_51S2bGO0ee6hGru1PF5o9w508HFtJYwdSMIfUmbGXjUUwzXS7MBEpScjBC5WBsoIZP2a3FwjVeh8sw2Cf1Ptpp54i00LaksBs2d" | wrangler secret put STRIPE_SECRET_KEY

echo "whsec_VDkwzJ2rwghFQt6IVwiSLuLARPl3vPIU" | wrangler secret put STRIPE_WEBHOOK_SECRET

echo "re_8E5HhfwM_5Za4spJwwoEoeCAf1uYnwQ2M" | wrangler secret put RESEND_API_KEY

echo "pospal_jwt_v2_secure_signing_key_2024_production_ready_32chars_minimum" | wrangler secret put JWT_SECRET

echo "0x8F3A2B1C9D4E5F6A" | wrangler secret put APP_SECRET_KEY
```

### Step 5: Deploy Worker
```bash
wrangler publish
```

### Step 6: Test and Go Live
1. Test payment flow with test-payment.html
2. Update webhook URL in Stripe to point to new worker
3. Disable maintenance mode
4. System is LIVE! 🎉

---

## 📋 POST-DEPLOYMENT CHECKLIST

- [ ] Worker deployed successfully
- [ ] Database schema applied
- [ ] All secrets configured
- [ ] Test payment completes
- [ ] Webhook receives events
- [ ] Email notifications sent
- [ ] Maintenance mode disabled
- [ ] All payment forms working
- [ ] POSPal app integration tested

---

## 🔗 WORKER URLS

After deployment, your new system will be available at:
- **Worker URL**: `https://pospal-licensing-v2.YOUR-USERNAME.workers.dev`
- **Webhook URL**: `https://pospal-licensing-v2.YOUR-USERNAME.workers.dev/webhook/stripe`
- **Health Check**: `https://pospal-licensing-v2.YOUR-USERNAME.workers.dev/health`

---

**Ready to deploy! All secrets collected and configuration complete.**