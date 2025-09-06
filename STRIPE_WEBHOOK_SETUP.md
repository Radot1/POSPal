# 🔗 Stripe Webhook Setup Guide

## New Keys Received ✅
- **Publishable Key**: `pk_test_51S2bGO0ee6hGru1PcQXsgn6AvCPqDGqVwZ9AuON37wN3EQpsLNCSCMlpLC4U3xVAda7zgL2D4ifbT1TSXn0PJtbL00b1W7wxZT`
- **Secret Key**: `sk_test_51S2bGO0ee6hGru1PF5o9w508HFtJYwdSMIfUmbGXjUUwzXS7MBEpScjBC5WBsoIZP2a3FwjVeh8sw2Cf1Ptpp54i00LaksBs2d`

## 🎯 Webhook Setup Instructions

### Step 1: Go to Stripe Dashboard
1. Login to https://dashboard.stripe.com/
2. Go to **Developers** → **Webhooks**
3. Click **Add endpoint**

### Step 2: Configure Webhook
**Endpoint URL**: `https://pospal-licensing-development.bzoumboulis.workers.dev/webhook/stripe`

OR

**New Worker URL**: `https://pospal-licensing-v2.YOURNAME.workers.dev/webhook/stripe`
(We'll get this URL after deploying)

**Events to select** (click "Select events"):
- `checkout.session.completed`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### Step 3: Get Webhook Secret
After creating the webhook:
1. Click on the webhook you just created
2. Click **Reveal** next to "Signing secret"
3. Copy the secret (starts with `whsec_`)
4. **PROVIDE IT HERE**: `whsec_XXXXXXXXX`

---

## ⚡ MEANWHILE - I'M UPDATING ALL THE FORMS

I'll update all your payment forms with the new publishable key while you set up the webhook.

**Once you provide the webhook secret, we'll deploy everything together!**