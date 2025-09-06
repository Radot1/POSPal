# Stripe Integration URLs - POSPal

## Current Payment Flow

Your subscription modal in POSPal calls:
```
POST ${WORKER_URL}/create-checkout-session
```

## Required Stripe URLs Configuration

When you update your Cloudflare Worker (`pospal-licensing-v2.bzoumboulis.workers.dev`), ensure the `/create-checkout-session` endpoint uses these URLs:

### Success URL
```
success_url: 'http://localhost:5000/success.html?session_id={CHECKOUT_SESSION_ID}'
```

### Failure/Cancel URL  
```
cancel_url: 'http://localhost:5000/payment-failed.html?reason=cancelled'
```

## Page Files

✅ **Active Pages:**
- `success.html` - Beautiful success page with POSPal branding
- `payment-failed.html` - Professional failure page with retry options

❌ **Removed Pages:**
- `payment-success.html` - Old version (removed)  
- `payment-cancelled.html` - Old version (removed)

## Port Detection

Both pages automatically detect the correct POSPal port:
1. Tries stored port from localStorage (`pospal_port`)
2. Falls back to referrer URL detection  
3. Defaults to port 5000 (your configured port)
4. Also tries common ports: [5000, 8080, 3000, 8000]

## Integration Notes

- Both pages store payment result in localStorage for POSPal to detect
- Success page: `pospal_payment_success = 'true'`
- Failure page: `pospal_payment_cancelled = 'true'`
- Both set: `pospal_payment_timestamp = Date.now()`

## Example Stripe Checkout Session Configuration

```javascript
const session = await stripe.checkout.sessions.create({
  payment_method_types: ['card'],
  line_items: [{
    price: env.STRIPE_PRICE_ID, // Your €20/month price
    quantity: 1,
  }],
  mode: 'subscription',
  success_url: `http://localhost:5000/success.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `http://localhost:5000/payment-failed.html?reason=cancelled`,
  customer_email: customerData.email,
  metadata: {
    restaurant_name: customerData.restaurantName,
    customer_name: customerData.name,
    customer_phone: customerData.phone
  }
});
```

This ensures users always return to the correct port with a beautiful, branded experience!