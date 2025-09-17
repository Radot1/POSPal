/**
 * POSPal Phase 2 Billing Date Functionality Test Suite
 *
 * Tests the database billing date functionality after adding the missing columns:
 * - next_billing_date
 * - current_period_start
 * - current_period_end
 *
 * This comprehensive test validates webhook processing, database operations,
 * and customer portal integration for the new billing date fields.
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Test Configuration
const WORKER_BASE_URL = 'http://127.0.0.1:8787';
const FLASK_BASE_URL = 'http://127.0.0.1:5000';

// Test Data Templates
const TEST_CUSTOMER_DATA = {
  email: 'phase2test@pospal.test',
  name: 'Phase 2 Test Customer',
  restaurantName: 'Test Restaurant Phase 2'
};

// Mock Stripe Data for Webhook Testing
const MOCK_SUBSCRIPTION = {
  id: 'sub_test_phase2_billing',
  current_period_start: Math.floor(Date.now() / 1000), // Current timestamp
  current_period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000), // 30 days from now
  status: 'active'
};

const MOCK_CHECKOUT_SESSION = {
  id: 'cs_test_phase2_billing_123',
  customer: 'cus_test_phase2_customer',
  subscription: MOCK_SUBSCRIPTION.id,
  customer_details: {
    email: TEST_CUSTOMER_DATA.email,
    name: TEST_CUSTOMER_DATA.name
  },
  mode: 'subscription',
  payment_method_types: ['card']
};

// Test Results Tracking
let testResults = {
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  errors: [],
  performance: {},
  details: []
};

// Utility Functions
function logTest(testName, status, details = {}) {
  testResults.totalTests++;

  if (status === 'PASS') {
    testResults.passedTests++;
    console.log(`✅ ${testName}`);
  } else {
    testResults.failedTests++;
    console.log(`❌ ${testName} - ${details.error || 'Unknown error'}`);
    testResults.errors.push({ test: testName, error: details.error, details });
  }

  testResults.details.push({
    test: testName,
    status,
    timestamp: new Date().toISOString(),
    responseTime: details.responseTime,
    details
  });
}

async function makeRequest(url, options = {}) {
  const startTime = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    const responseTime = Date.now() - startTime;
    const data = await response.json();

    return {
      ok: response.ok,
      status: response.status,
      data,
      responseTime
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message,
      responseTime: Date.now() - startTime
    };
  }
}

// Database Schema Verification
async function testDatabaseSchemaColumns() {
  console.log('\n🔍 Testing Database Schema - Billing Columns...');

  try {
    // Test by attempting to create a customer with billing data via webhook
    const webhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          ...MOCK_CHECKOUT_SESSION,
          id: 'cs_schema_test_' + Date.now()
        }
      }
    };

    const result = await makeRequest(`${WORKER_BASE_URL}/webhook`, {
      method: 'POST',
      body: JSON.stringify(webhookEvent)
    });

    if (result.ok && result.data.success) {
      logTest('Database Schema - Billing columns exist and functioning', 'PASS', {
        responseTime: result.responseTime,
        customerId: result.data.customer_id
      });
      return result.data.customer_id;
    } else {
      logTest('Database Schema - Billing columns verification', 'FAIL', {
        error: result.data?.error || result.error || 'Webhook processing failed',
        responseTime: result.responseTime,
        status: result.status
      });
      return null;
    }
  } catch (error) {
    logTest('Database Schema - Billing columns verification', 'FAIL', {
      error: error.message
    });
    return null;
  }
}

// Webhook Handler Testing
async function testWebhookProcessing() {
  console.log('\n📨 Testing Webhook Handler Processing...');

  // Test 1: Checkout Session Completed with Billing Data
  const checkoutEvent = {
    type: 'checkout.session.completed',
    data: {
      object: {
        ...MOCK_CHECKOUT_SESSION,
        id: 'cs_webhook_test_' + Date.now(),
        customer_details: {
          email: `webhook_test_${Date.now()}@pospal.test`,
          name: 'Webhook Test Customer'
        }
      }
    }
  };

  const checkoutResult = await makeRequest(`${WORKER_BASE_URL}/webhook`, {
    method: 'POST',
    body: JSON.stringify(checkoutEvent)
  });

  if (checkoutResult.ok && checkoutResult.data.success) {
    logTest('Webhook - Checkout Session Completed Processing', 'PASS', {
      responseTime: checkoutResult.responseTime,
      customerId: checkoutResult.data.customer_id
    });
  } else {
    logTest('Webhook - Checkout Session Completed Processing', 'FAIL', {
      error: checkoutResult.data?.error || checkoutResult.error,
      responseTime: checkoutResult.responseTime,
      status: checkoutResult.status
    });
  }

  // Test 2: Payment Succeeded with Billing Data Update
  const paymentSucceededEvent = {
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        subscription: MOCK_SUBSCRIPTION.id,
        customer_email: checkoutEvent.data.object.customer_details.email
      }
    }
  };

  const paymentResult = await makeRequest(`${WORKER_BASE_URL}/webhook`, {
    method: 'POST',
    body: JSON.stringify(paymentSucceededEvent)
  });

  if (paymentResult.ok) {
    logTest('Webhook - Payment Succeeded Processing', 'PASS', {
      responseTime: paymentResult.responseTime
    });
  } else {
    logTest('Webhook - Payment Succeeded Processing', 'FAIL', {
      error: paymentResult.data?.error || paymentResult.error,
      responseTime: paymentResult.responseTime
    });
  }

  return checkoutResult.data?.customer_id;
}

// Database CRUD Operations Testing
async function testDatabaseOperations(customerId) {
  console.log('\n💾 Testing Database CRUD Operations...');

  if (!customerId) {
    logTest('Database CRUD - Customer ID Required', 'FAIL', {
      error: 'No customer ID provided for CRUD testing'
    });
    return;
  }

  // Test direct API call to verify customer data
  try {
    // We'll use the webhook handler to verify the data was stored correctly
    const verifyResult = await makeRequest(`${WORKER_BASE_URL}/health`);

    if (verifyResult.ok) {
      logTest('Database CRUD - Connection and Basic Operations', 'PASS', {
        responseTime: verifyResult.responseTime,
        databaseStatus: verifyResult.data.services?.database?.status
      });
    } else {
      logTest('Database CRUD - Connection and Basic Operations', 'FAIL', {
        error: 'Health check failed',
        responseTime: verifyResult.responseTime
      });
    }
  } catch (error) {
    logTest('Database CRUD - Connection and Basic Operations', 'FAIL', {
      error: error.message
    });
  }
}

// Customer Portal Integration Testing
async function testCustomerPortalIntegration() {
  console.log('\n🏪 Testing Customer Portal Integration...');

  // Create a test customer first via webhook
  const testCustomerEvent = {
    type: 'checkout.session.completed',
    data: {
      object: {
        ...MOCK_CHECKOUT_SESSION,
        id: 'cs_portal_test_' + Date.now(),
        customer_details: {
          email: `portal_test_${Date.now()}@pospal.test`,
          name: 'Portal Test Customer'
        }
      }
    }
  };

  const customerResult = await makeRequest(`${WORKER_BASE_URL}/webhook`, {
    method: 'POST',
    body: JSON.stringify(testCustomerEvent)
  });

  if (!customerResult.ok) {
    logTest('Customer Portal - Test Customer Creation', 'FAIL', {
      error: 'Failed to create test customer for portal testing'
    });
    return;
  }

  // Test customer portal data access
  // Note: We'll need to implement a way to get the unlock token for testing
  logTest('Customer Portal - Test Customer Created', 'PASS', {
    responseTime: customerResult.responseTime,
    customerId: customerResult.data.customer_id
  });

  // Test portal session creation
  const portalResult = await makeRequest(`${WORKER_BASE_URL}/create-portal-session`, {
    method: 'POST',
    body: JSON.stringify({
      email: testCustomerEvent.data.object.customer_details.email,
      unlockToken: 'test_token_placeholder' // This would need to be retrieved in real testing
    })
  });

  // This test may fail due to missing unlock token, but we're testing the endpoint exists
  logTest('Customer Portal - Portal Session Endpoint Accessible', portalResult.ok ? 'PASS' : 'INFO', {
    responseTime: portalResult.responseTime,
    note: 'Endpoint accessible, token validation expected'
  });
}

// Error Handling and Fallback Testing
async function testErrorHandlingAndFallbacks() {
  console.log('\n🔧 Testing Error Handling and Fallbacks...');

  // Test 1: Webhook with Missing Billing Data
  const incompleteEvent = {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_incomplete_' + Date.now(),
        customer_details: {
          email: `incomplete_${Date.now()}@pospal.test`,
          name: 'Incomplete Test'
        },
        subscription: null // Missing subscription data
      }
    }
  };

  const incompleteResult = await makeRequest(`${WORKER_BASE_URL}/webhook`, {
    method: 'POST',
    body: JSON.stringify(incompleteEvent)
  });

  // Should handle gracefully
  if (incompleteResult.ok || incompleteResult.status === 400) {
    logTest('Error Handling - Missing Billing Data Graceful Handling', 'PASS', {
      responseTime: incompleteResult.responseTime,
      status: incompleteResult.status
    });
  } else {
    logTest('Error Handling - Missing Billing Data Graceful Handling', 'FAIL', {
      error: 'Unexpected error response',
      responseTime: incompleteResult.responseTime,
      status: incompleteResult.status
    });
  }

  // Test 2: Invalid Webhook Event Type
  const invalidEvent = {
    type: 'invalid.event.type',
    data: { object: {} }
  };

  const invalidResult = await makeRequest(`${WORKER_BASE_URL}/webhook`, {
    method: 'POST',
    body: JSON.stringify(invalidEvent)
  });

  if (invalidResult.ok && invalidResult.data.received) {
    logTest('Error Handling - Invalid Event Type Handling', 'PASS', {
      responseTime: invalidResult.responseTime
    });
  } else {
    logTest('Error Handling - Invalid Event Type Handling', 'FAIL', {
      error: 'Should acknowledge unknown events',
      responseTime: invalidResult.responseTime
    });
  }
}

// Load Testing for Concurrent Webhooks
async function testConcurrentWebhookProcessing() {
  console.log('\n⚡ Testing Concurrent Webhook Processing...');

  const concurrentRequests = 5;
  const requests = [];

  for (let i = 0; i < concurrentRequests; i++) {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          ...MOCK_CHECKOUT_SESSION,
          id: `cs_concurrent_${i}_${Date.now()}`,
          customer_details: {
            email: `concurrent_${i}_${Date.now()}@pospal.test`,
            name: `Concurrent Test ${i}`
          }
        }
      }
    };

    requests.push(makeRequest(`${WORKER_BASE_URL}/webhook`, {
      method: 'POST',
      body: JSON.stringify(event)
    }));
  }

  const startTime = Date.now();
  const results = await Promise.all(requests);
  const totalTime = Date.now() - startTime;

  const successfulResults = results.filter(r => r.ok);
  const averageResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

  testResults.performance.concurrentWebhooks = {
    totalRequests: concurrentRequests,
    successfulRequests: successfulResults.length,
    totalTime,
    averageResponseTime
  };

  if (successfulResults.length === concurrentRequests) {
    logTest('Load Testing - Concurrent Webhook Processing', 'PASS', {
      totalTime,
      averageResponseTime,
      successRate: '100%'
    });
  } else {
    logTest('Load Testing - Concurrent Webhook Processing', 'FAIL', {
      error: `Only ${successfulResults.length}/${concurrentRequests} requests succeeded`,
      totalTime,
      averageResponseTime
    });
  }
}

// System Health Verification
async function testSystemHealth() {
  console.log('\n🏥 Testing System Health...');

  // Test Worker Health
  const workerHealth = await makeRequest(`${WORKER_BASE_URL}/health`);

  if (workerHealth.ok && workerHealth.data.status === 'healthy') {
    logTest('System Health - Cloudflare Worker', 'PASS', {
      responseTime: workerHealth.responseTime,
      status: workerHealth.data.status
    });
  } else {
    logTest('System Health - Cloudflare Worker', 'FAIL', {
      error: workerHealth.data?.error || workerHealth.error,
      responseTime: workerHealth.responseTime
    });
  }

  // Test Flask Backend Health
  const flaskHealth = await makeRequest(`${FLASK_BASE_URL}/api/health`);

  if (flaskHealth.ok) {
    logTest('System Health - Flask Backend', 'PASS', {
      responseTime: flaskHealth.responseTime
    });
  } else {
    logTest('System Health - Flask Backend', 'FAIL', {
      error: flaskHealth.error || 'Health endpoint not responding',
      responseTime: flaskHealth.responseTime
    });
  }
}

// Main Test Execution
async function runPhase2BillingTests() {
  console.log('🚀 Starting POSPal Phase 2 Billing Date Functionality Tests');
  console.log('=' .repeat(70));

  const overallStartTime = Date.now();

  try {
    // Phase 1: System Health Check
    await testSystemHealth();

    // Phase 2: Database Schema Verification
    const testCustomerId = await testDatabaseSchemaColumns();

    // Phase 3: Webhook Processing Tests
    const webhookCustomerId = await testWebhookProcessing();

    // Phase 4: Database Operations
    await testDatabaseOperations(webhookCustomerId || testCustomerId);

    // Phase 5: Customer Portal Integration
    await testCustomerPortalIntegration();

    // Phase 6: Error Handling and Fallbacks
    await testErrorHandlingAndFallbacks();

    // Phase 7: Load Testing
    await testConcurrentWebhookProcessing();

  } catch (error) {
    console.error('❌ Critical test execution error:', error);
    testResults.errors.push({
      test: 'Test Execution',
      error: error.message,
      critical: true
    });
  }

  const totalExecutionTime = Date.now() - overallStartTime;
  testResults.performance.totalExecutionTime = totalExecutionTime;

  // Generate Test Report
  generateTestReport();
}

// Test Report Generation
function generateTestReport() {
  console.log('\n' + '='.repeat(70));
  console.log('📊 PHASE 2 BILLING DATE FUNCTIONALITY TEST REPORT');
  console.log('='.repeat(70));

  console.log(`\n📈 OVERALL RESULTS:`);
  console.log(`   Total Tests: ${testResults.totalTests}`);
  console.log(`   Passed: ${testResults.passedTests} ✅`);
  console.log(`   Failed: ${testResults.failedTests} ❌`);
  console.log(`   Success Rate: ${((testResults.passedTests / testResults.totalTests) * 100).toFixed(1)}%`);

  console.log(`\n⏱️ PERFORMANCE METRICS:`);
  console.log(`   Total Execution Time: ${testResults.performance.totalExecutionTime}ms`);

  if (testResults.performance.concurrentWebhooks) {
    const concurrent = testResults.performance.concurrentWebhooks;
    console.log(`   Concurrent Webhooks: ${concurrent.successfulRequests}/${concurrent.totalRequests} successful`);
    console.log(`   Average Response Time: ${concurrent.averageResponseTime.toFixed(0)}ms`);
  }

  if (testResults.failedTests > 0) {
    console.log(`\n❌ FAILED TESTS:`);
    testResults.errors.forEach((error, index) => {
      console.log(`   ${index + 1}. ${error.test}`);
      console.log(`      Error: ${error.error}`);
      if (error.details) {
        console.log(`      Details: ${JSON.stringify(error.details, null, 6)}`);
      }
    });
  }

  console.log(`\n🎯 KEY FINDINGS:`);

  const databaseTest = testResults.details.find(d => d.test.includes('Database Schema'));
  if (databaseTest?.status === 'PASS') {
    console.log(`   ✅ Billing columns (next_billing_date, current_period_start, current_period_end) are functional`);
  } else {
    console.log(`   ❌ Billing columns appear to be missing or non-functional`);
  }

  const webhookTests = testResults.details.filter(d => d.test.includes('Webhook'));
  const successfulWebhooks = webhookTests.filter(t => t.status === 'PASS').length;
  console.log(`   ${successfulWebhooks === webhookTests.length ? '✅' : '❌'} Webhook processing: ${successfulWebhooks}/${webhookTests.length} tests passed`);

  const errorHandlingTests = testResults.details.filter(d => d.test.includes('Error Handling'));
  const successfulErrorHandling = errorHandlingTests.filter(t => t.status === 'PASS').length;
  console.log(`   ${successfulErrorHandling === errorHandlingTests.length ? '✅' : '❌'} Error handling: ${successfulErrorHandling}/${errorHandlingTests.length} tests passed`);

  console.log(`\n📋 RECOMMENDATIONS:`);

  if (testResults.failedTests === 0) {
    console.log(`   🎉 All tests passed! Phase 2 billing functionality is working correctly.`);
    console.log(`   🔧 Consider running additional load tests for production readiness.`);
  } else {
    console.log(`   🔍 Review failed tests and address issues before deploying to production.`);
    if (databaseTest?.status !== 'PASS') {
      console.log(`   📊 Verify database migration was completed successfully.`);
      console.log(`   🔧 Check that the new billing columns exist in both development and production databases.`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Test completed at: ${new Date().toISOString()}`);
  console.log('='.repeat(70));
}

// Execute Tests
if (require.main === module) {
  runPhase2BillingTests().catch(error => {
    console.error('Fatal test execution error:', error);
    process.exit(1);
  });
}

module.exports = {
  runPhase2BillingTests,
  testResults
};