/**
 * Backfill Billing Dates Migration Script
 *
 * This script fetches billing information from Stripe for all existing customers
 * and updates their records with current_period_start, current_period_end, and next_billing_date
 *
 * Usage:
 * 1. Deploy this as a temporary Cloudflare Worker
 * 2. Set up the same environment variables as the main licensing worker
 * 3. Call the /backfill-billing-dates endpoint
 * 4. Monitor logs for progress
 *
 * OR run the backfill function directly from the main worker by adding it as a route
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/backfill-billing-dates') {
      return await backfillBillingDates(env);
    }

    return new Response('Backfill script ready. Call /backfill-billing-dates to start migration.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

/**
 * Backfill billing dates for all existing customers
 */
async function backfillBillingDates(env) {
  const startTime = Date.now();
  let processed = 0;
  let updated = 0;
  let errors = 0;
  const errorDetails = [];

  try {
    // Get all customers with active subscriptions that don't have billing dates
    const customers = await env.DB.prepare(`
      SELECT id, email, subscription_id, stripe_customer_id, subscription_status
      FROM customers
      WHERE subscription_id IS NOT NULL
      AND (current_period_end IS NULL OR next_billing_date IS NULL)
      ORDER BY created_at ASC
    `).all();

    console.log(`Found ${customers.results.length} customers needing billing date backfill`);

    // Create Stripe API helper
    const stripe = {
      async get(url) {
        const response = await fetch(`https://api.stripe.com/v1${url}`, {
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
          }
        });
        return response.json();
      }
    };

    // Process customers in batches to avoid rate limiting
    const batchSize = 5; // Conservative batch size for Stripe API

    for (let i = 0; i < customers.results.length; i += batchSize) {
      const batch = customers.results.slice(i, i + batchSize);

      // Process batch concurrently but with delay between batches
      const batchPromises = batch.map(async (customer) => {
        processed++;

        try {
          if (!customer.subscription_id) {
            console.log(`Skipping customer ${customer.email} - no subscription ID`);
            return;
          }

          // Fetch subscription from Stripe
          const subscription = await stripe.get(`/subscriptions/${customer.subscription_id}`);

          if (subscription.error) {
            throw new Error(`Stripe API error: ${subscription.error.message}`);
          }

          if (!subscription.current_period_start || !subscription.current_period_end) {
            throw new Error('Missing billing period data from Stripe');
          }

          // Calculate billing dates
          const billingData = {
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            next_billing_date: new Date(subscription.current_period_end * 1000).toISOString()
          };

          // Update customer record
          const updateResult = await env.DB.prepare(`
            UPDATE customers
            SET current_period_start = ?, current_period_end = ?, next_billing_date = ?
            WHERE id = ?
          `).bind(
            billingData.current_period_start,
            billingData.current_period_end,
            billingData.next_billing_date,
            customer.id
          ).run();

          if (updateResult.success) {
            updated++;
            console.log(`Updated billing dates for customer ${customer.email}:`, billingData);
          } else {
            throw new Error('Database update failed');
          }

        } catch (error) {
          errors++;
          const errorDetail = {
            customerId: customer.id,
            email: customer.email,
            subscriptionId: customer.subscription_id,
            error: error.message
          };
          errorDetails.push(errorDetail);
          console.error(`Error processing customer ${customer.email}:`, error);
        }
      });

      await Promise.all(batchPromises);

      // Add delay between batches to respect Stripe rate limits
      if (i + batchSize < customers.results.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    const summary = {
      success: true,
      totalTime: Date.now() - startTime,
      stats: {
        totalCustomers: customers.results.length,
        processed,
        updated,
        errors
      },
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined
    };

    console.log('Billing dates backfill completed:', summary);

    return new Response(JSON.stringify(summary, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    console.error('Backfill process failed:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      totalTime: Date.now() - startTime,
      stats: { processed, updated, errors },
      errorDetails
    }, null, 2), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  }
}

/**
 * Alternative: Add this function to the main index.js worker as a temporary route
 *
 * Add this route handler in the main switch statement:
 *
 * case '/backfill-billing-dates':
 *   return handleBillingDatesBackfill(request, env);
 *
 * Then add this function to index.js:
 */

/*
async function handleBillingDatesBackfill(request, env) {
  // Only allow POST requests for safety
  if (request.method !== 'POST') {
    return createResponse({ error: 'Method not allowed' }, 405);
  }

  // Optional: Add authentication check
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${env.BACKFILL_SECRET || 'your-secret-key'}`) {
    return createResponse({ error: 'Unauthorized' }, 401);
  }

  return await backfillBillingDates(env);
}
*/