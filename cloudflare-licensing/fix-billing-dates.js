/**
 * Fix billing dates for manually created customer records
 * This script will find the real Stripe subscription and update the billing dates
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/fix-billing-dates') {
      return await fixCustomerBillingDates(env);
    }

    return new Response('Fix billing dates endpoint ready', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

async function fixCustomerBillingDates(env) {
  const customerEmail = 'bzoumboulis@yahoo.co.uk';

  try {
    // First, let's list all Stripe customers to find the real subscription
    const stripe = createStripeHelper(env);

    // Search for customer by email
    const customers = await stripe.get(`/customers?email=${encodeURIComponent(customerEmail)}&limit=1`);

    if (customers.error || !customers.data || customers.data.length === 0) {
      return new Response(`No Stripe customer found for ${customerEmail}`, { status: 404 });
    }

    const stripeCustomer = customers.data[0];
    console.log('Found Stripe customer:', stripeCustomer.id);

    // Get customer's subscriptions
    const subscriptions = await stripe.get(`/subscriptions?customer=${stripeCustomer.id}&status=active&limit=1`);

    if (subscriptions.error || !subscriptions.data || subscriptions.data.length === 0) {
      return new Response(`No active subscription found for customer ${stripeCustomer.id}`, { status: 404 });
    }

    const subscription = subscriptions.data[0];
    console.log('Found active subscription:', subscription.id);

    // Extract billing dates
    const billingData = {
      subscription_id: subscription.id,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      next_billing_date: new Date(subscription.current_period_end * 1000).toISOString()
    };

    console.log('Billing data to update:', billingData);

    // Update the customer record
    const updateResult = await env.DB.prepare(`
      UPDATE customers
      SET subscription_id = ?,
          current_period_start = ?,
          current_period_end = ?,
          next_billing_date = ?,
          last_seen = datetime('now')
      WHERE email = ?
    `).bind(
      billingData.subscription_id,
      billingData.current_period_start,
      billingData.current_period_end,
      billingData.next_billing_date,
      customerEmail
    ).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Billing dates updated successfully',
      stripeCustomerId: stripeCustomer.id,
      subscriptionId: subscription.id,
      billingData: billingData,
      updateResult: updateResult
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error fixing billing dates:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Helper function to create Stripe API helper (copy from main worker)
function createStripeHelper(env) {
  const baseURL = 'https://api.stripe.com/v1';
  const auth = `Basic ${btoa(env.STRIPE_SECRET_KEY + ':')}`;

  return {
    async get(endpoint) {
      const response = await fetch(`${baseURL}${endpoint}`, {
        headers: { 'Authorization': auth }
      });
      return await response.json();
    }
  };
}