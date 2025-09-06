# 💳 Stripe Test Cards - Complete Reference

## 🧪 FOR TESTING YOUR POSPAL PAYMENT SYSTEM

### ✅ **SUCCESSFUL PAYMENT CARDS**

#### **Basic Success Cards:**
- **4242424242424242** → Visa (always succeeds)
- **4000056655665556** → Visa Debit (always succeeds)
- **5555555555554444** → Mastercard (always succeeds)
- **378282246310005** → American Express (always succeeds)

#### **European Cards:**
- **4000000760000002** → Visa (Greece)
- **4000002500000003** → Visa (Netherlands)
- **4000002760000016** → Visa (Switzerland)

### ❌ **FAILED PAYMENT CARDS (Error Testing)**

#### **Declined Cards:**
- **4000000000000002** → Generic decline
- **4000000000000069** → Expired card
- **4000000000000119** → Processing error
- **4000000000000341** → Incorrect CVC
- **4000000000000259** → Card blocked

#### **Insufficient Funds:**
- **4000000000009995** → Insufficient funds
- **4000000000009987** → Lost card
- **4000000000009979** → Stolen card

### 🔒 **3D SECURE CARDS (Authentication Testing)**

#### **Requires Authentication:**
- **4000002760003184** → Requires 3DS authentication
- **4000002500003155** → Requires 3DS authentication (Netherlands)
- **4000000000003220** → 3DS authentication required

#### **Authentication Fails:**
- **4000008400001629** → 3DS authentication fails
- **4000008260003178** → 3DS authentication unavailable

### 💰 **SUBSCRIPTION-SPECIFIC TESTING**

#### **First Payment Succeeds, Renewals Fail:**
- **4000000000000341** → First payment works, future payments fail

#### **Always Succeeds (Good for Testing):**
- **4242424242424242** → Perfect for subscription testing

### 🌍 **INTERNATIONAL CARDS**

#### **Currency Testing:**
- **4000000760000002** → EUR (Greece) 
- **4000001240000000** → USD (United States)
- **4000058260000005** → GBP (United Kingdom)

### 📱 **PAYMENT METHOD TESTING**

#### **Apple Pay / Google Pay:**
- **4242424242424242** → Works with digital wallets

#### **SEPA Direct Debit (EU):**
- **AT611904300234573201** → SEPA test account (Austria)

---

## 🧪 **TESTING SCENARIOS FOR POSPAL**

### **Scenario 1: Happy Path**
1. **Card**: `4242424242424242`
2. **Expiry**: Any future date (e.g., `12/28`)
3. **CVC**: Any 3 digits (e.g., `123`)
4. **Name**: Any name
5. **Expected**: Payment succeeds, webhook fires, customer gets email

### **Scenario 2: Card Declined**
1. **Card**: `4000000000000002`
2. **Expected**: Payment fails gracefully, user sees error message

### **Scenario 3: 3D Secure Authentication**
1. **Card**: `4000002760003184`  
2. **Expected**: Stripe shows 3DS challenge, user completes authentication

### **Scenario 4: Subscription Renewal**
1. **Use**: `4242424242424242` for first payment
2. **Wait**: For webhook to process
3. **Check**: Customer record created in database
4. **Simulate**: Next month billing (webhook testing)

### **Scenario 5: Payment Recovery**
1. **First card**: `4000000000000341` (fails after first payment)
2. **Expected**: Subscription created, but renewal will fail
3. **Customer**: Should get payment failure email
4. **Grace period**: Should activate
5. **Recovery**: Customer updates payment method

---

## 🔧 **WEBHOOK EVENTS TO EXPECT**

### **Successful Subscription Flow:**
1. `checkout.session.completed` → Customer subscribed
2. `customer.subscription.created` → Subscription active
3. `invoice.payment_succeeded` → First payment successful

### **Failed Payment Flow:**
1. `invoice.payment_failed` → Payment failed
2. `customer.subscription.updated` → Status changed to `past_due`

### **Cancellation Flow:**
1. `customer.subscription.deleted` → Subscription cancelled

---

## 🎯 **TESTING CHECKLIST**

### **Basic Payment Testing:**
- [ ] Successful payment with `4242424242424242`
- [ ] Failed payment with `4000000000000002`
- [ ] 3DS authentication with `4000002760003184`
- [ ] Different card types (Visa, Mastercard, Amex)

### **Subscription Testing:**
- [ ] New subscription creation
- [ ] Webhook processing 
- [ ] Customer email delivery
- [ ] Database record creation
- [ ] License generation

### **Error Handling:**
- [ ] Network failures during payment
- [ ] Webhook delivery failures
- [ ] Invalid webhook signatures
- [ ] Database connection issues

### **User Experience:**
- [ ] Clear error messages
- [ ] Loading states during payment
- [ ] Successful payment confirmation
- [ ] Email delivery confirmation

---

## 🚨 **IMPORTANT TESTING NOTES**

### **Never Use Real Cards in Test Mode:**
- Stripe test mode only accepts test cards
- Real cards will be declined automatically
- Use only the test cards listed above

### **Test Mode Limitations:**
- No real money is charged
- Webhooks work exactly like production
- Email delivery works normally
- All features function identically to live mode

### **Production Testing:**
- Use small amounts (€0.50) for initial live testing
- Test with your own real card first
- Monitor webhook delivery closely
- Have a rollback plan ready

---

**🧪 Ready for comprehensive testing! These test cards will help you verify every aspect of your payment system works correctly.**