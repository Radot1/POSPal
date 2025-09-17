/**
 * Webhook Idempotency Testing Script for POSPal Stripe Integration
 *
 * This script tests the Phase 3 webhook idempotency protection to ensure:
 * 1. Duplicate events are properly detected and ignored
 * 2. Concurrent events don't create duplicate customers
 * 3. Failed events can be retried
 * 4. Processing status is properly tracked
 */

const crypto = require('crypto');

// Configuration - Update these URLs based on your deployment
const WEBHOOK_ENDPOINTS = {
  development: 'http://localhost:8787/webhook',
  production: 'https://your-worker.your-subdomain.workers.dev/webhook'
};

// Test webhook secret (use your actual webhook secret for real testing)
const WEBHOOK_SECRET = 'whsec_test_webhook_secret';

class WebhookTester {
  constructor(environment = 'development') {
    this.endpoint = WEBHOOK_ENDPOINTS[environment];
    this.secret = WEBHOOK_SECRET;
  }

  /**
   * Create a Stripe webhook signature for testing
   */
  createWebhookSignature(payload, timestamp) {
    const elements = [timestamp, payload].join('.');
    const signature = crypto.createHmac('sha256', this.secret).update(elements).digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  /**
   * Send a webhook event
   */
  async sendWebhook(eventData, eventId = null) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      id: eventId || `evt_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      object: 'event',
      created: timestamp,
      type: eventData.type,
      data: eventData.data,
      ...eventData
    });

    const signature = this.createWebhookSignature(payload, timestamp);

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature
      },
      body: payload
    });

    return {
      status: response.status,
      response: await response.json(),
      eventId: JSON.parse(payload).id
    };
  }

  /**
   * Test 1: Basic idempotency - send same event twice
   */
  async testBasicIdempotency() {
    console.log('\n🧪 Test 1: Basic Idempotency Protection');
    console.log('=' .repeat(50));

    const eventData = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_idempotency_' + Date.now(),
          customer: 'cus_test_customer_' + Date.now(),
          subscription: 'sub_test_subscription_' + Date.now(),
          metadata: {
            email: 'test@example.com',
            device_id: 'test_device_' + Date.now()
          }
        }
      }
    };

    // First webhook call
    console.log('📤 Sending first webhook...');
    const first = await this.sendWebhook(eventData, 'evt_idempotency_test_1');
    console.log(`✅ First call: ${first.status}`, first.response);

    // Second webhook call with same event ID
    console.log('📤 Sending duplicate webhook...');
    const second = await this.sendWebhook(eventData, 'evt_idempotency_test_1');
    console.log(`✅ Second call: ${second.status}`, second.response);

    // Verify idempotency
    if (second.response.idempotent || second.response.duplicate) {
      console.log('✅ PASS: Idempotency protection working');
    } else {
      console.log('❌ FAIL: Duplicate event was processed');
    }
  }

  /**
   * Test 2: Concurrent webhook processing
   */
  async testConcurrentProcessing() {
    console.log('\n🧪 Test 2: Concurrent Processing Protection');
    console.log('=' .repeat(50));

    const eventData = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_concurrent_' + Date.now(),
          customer: 'cus_test_concurrent_' + Date.now(),
          subscription: 'sub_test_concurrent_' + Date.now(),
          metadata: {
            email: 'concurrent@example.com',
            device_id: 'test_device_concurrent_' + Date.now()
          }
        }
      }
    };

    console.log('📤 Sending concurrent webhooks...');

    // Send multiple webhooks simultaneously
    const promises = Array.from({ length: 3 }, (_, i) =>
      this.sendWebhook(eventData, 'evt_concurrent_test_1')
    );

    const results = await Promise.all(promises);

    console.log('📊 Results:');
    results.forEach((result, index) => {
      console.log(`  Request ${index + 1}: ${result.status}`, result.response);
    });

    // Check that only one was processed successfully
    const processed = results.filter(r => !r.response.idempotent && !r.response.duplicate).length;
    const ignored = results.filter(r => r.response.idempotent || r.response.duplicate).length;

    if (processed === 1 && ignored === 2) {
      console.log('✅ PASS: Only one event processed, others ignored');
    } else {
      console.log('❌ FAIL: Concurrent processing not properly handled');
    }
  }

  /**
   * Test 3: Failed event retry
   */
  async testFailedEventRetry() {
    console.log('\n🧪 Test 3: Failed Event Retry Mechanism');
    console.log('=' .repeat(50));

    // Send an event that should fail (invalid data)
    const failedEventData = {
      type: 'checkout.session.completed',
      data: {
        object: {
          // Missing required fields to trigger failure
          id: 'cs_test_failed_' + Date.now()
          // Missing customer, subscription, metadata
        }
      }
    };

    console.log('📤 Sending event that should fail...');
    const first = await this.sendWebhook(failedEventData, 'evt_retry_test_1');
    console.log(`❌ First attempt: ${first.status}`, first.response);

    // Now send the same event with correct data (simulating retry)
    const correctedEventData = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_corrected_' + Date.now(),
          customer: 'cus_test_retry_' + Date.now(),
          subscription: 'sub_test_retry_' + Date.now(),
          metadata: {
            email: 'retry@example.com',
            device_id: 'test_device_retry_' + Date.now()
          }
        }
      }
    };

    console.log('📤 Retrying with corrected data...');
    const retry = await this.sendWebhook(correctedEventData, 'evt_retry_test_1');
    console.log(`✅ Retry attempt: ${retry.status}`, retry.response);

    if (retry.status === 200 && !retry.response.error) {
      console.log('✅ PASS: Failed event successfully retried');
    } else {
      console.log('❌ FAIL: Event retry not working properly');
    }
  }

  /**
   * Test 4: Different event types
   */
  async testDifferentEventTypes() {
    console.log('\n🧪 Test 4: Different Event Types');
    console.log('=' .repeat(50));

    const eventTypes = [
      'checkout.session.completed',
      'invoice.payment_succeeded',
      'invoice.payment_failed',
      'customer.subscription.deleted'
    ];

    for (const eventType of eventTypes) {
      console.log(`📤 Testing ${eventType}...`);

      const eventData = {
        type: eventType,
        data: {
          object: {
            id: `test_${eventType.replace('.', '_')}_${Date.now()}`,
            customer: 'cus_test_' + Date.now(),
            subscription: 'sub_test_' + Date.now(),
            metadata: {
              email: `${eventType}@example.com`,
              device_id: 'test_device_' + Date.now()
            }
          }
        }
      };

      const result = await this.sendWebhook(eventData);
      console.log(`  ✅ ${eventType}: ${result.status}`,
                  result.response.received ? 'Received' : 'Failed');
    }
  }

  /**
   * Test 5: Performance and monitoring
   */
  async testPerformanceImpact() {
    console.log('\n🧪 Test 5: Performance Impact Assessment');
    console.log('=' .repeat(50));

    const eventData = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_performance_' + Date.now(),
          customer: 'cus_test_performance_' + Date.now(),
          subscription: 'sub_test_performance_' + Date.now(),
          metadata: {
            email: 'performance@example.com',
            device_id: 'test_device_performance_' + Date.now()
          }
        }
      }
    };

    const iterations = 10;
    const times = [];

    console.log(`📊 Running ${iterations} webhook calls to measure performance...`);

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      const result = await this.sendWebhook(eventData);
      const duration = Date.now() - start;
      times.push(duration);

      console.log(`  Call ${i + 1}: ${duration}ms (${result.status})`);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);

    console.log(`📈 Performance Summary:`);
    console.log(`  Average: ${avgTime.toFixed(2)}ms`);
    console.log(`  Min: ${minTime}ms`);
    console.log(`  Max: ${maxTime}ms`);

    if (avgTime < 1000) {
      console.log('✅ PASS: Good performance (< 1s average)');
    } else {
      console.log('⚠️  WARNING: Slow performance (> 1s average)');
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🚀 Starting Webhook Idempotency Tests');
    console.log('Testing endpoint:', this.endpoint);
    console.log('=' .repeat(60));

    try {
      await this.testBasicIdempotency();
      await this.testConcurrentProcessing();
      await this.testFailedEventRetry();
      await this.testDifferentEventTypes();
      await this.testPerformanceImpact();

      console.log('\n🎉 All tests completed!');
      console.log('Check your webhook_events table to verify database entries.');

    } catch (error) {
      console.error('❌ Test suite failed:', error);
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const environment = process.argv[2] || 'development';
  const tester = new WebhookTester(environment);

  console.log(`Testing in ${environment} environment`);
  tester.runAllTests();
}

module.exports = WebhookTester;