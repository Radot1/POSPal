/**
 * Phase 3 Webhook Idempotency Protection Comprehensive Test Suite
 *
 * Tests the webhook idempotency system to ensure:
 * 1. Duplicate webhooks are properly prevented
 * 2. Concurrent processing protection works
 * 3. Event tracking is accurate
 * 4. Error recovery functions correctly
 * 5. Performance impact is minimal
 */

const fs = require('fs');

// Test Configuration
const TEST_CONFIG = {
    workerUrl: 'http://localhost:8787',
    testWebhookEndpoint: '/test-webhook',
    duplicateTestCount: 5,
    concurrentTestCount: 10,
    performanceIterations: 100,
    expectedMaxOverhead: 50 // milliseconds
};

// Test Results Storage
let testResults = {
    timestamp: new Date().toISOString(),
    duplicateTests: [],
    concurrentTests: [],
    eventTrackingTests: [],
    errorRecoveryTests: [],
    performanceTests: [],
    summary: {
        passed: 0,
        failed: 0,
        total: 0
    }
};

// Test Data Templates
const sampleEvents = {
    checkout_completed: {
        id: 'evt_test_checkout_' + Date.now(),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: 'cs_test_' + Date.now(),
                customer: 'cus_test_' + Date.now(),
                customer_details: {
                    email: 'test@pospal.test',
                    name: 'Test Customer'
                },
                subscription: 'sub_test_phase3_' + Date.now(),
                mode: 'subscription',
                payment_method_id: 'pm_test_card'
            }
        }
    },
    payment_succeeded: {
        id: 'evt_test_payment_' + Date.now(),
        type: 'invoice.payment_succeeded',
        data: {
            object: {
                subscription: 'sub_test_phase3_' + Date.now(),
                customer_email: 'test@pospal.test'
            }
        }
    }
};

// Utility Functions
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

function recordResult(testType, testName, passed, details = {}) {
    const result = {
        testName,
        passed,
        timestamp: new Date().toISOString(),
        details
    };

    testResults[testType].push(result);
    testResults.summary.total++;

    if (passed) {
        testResults.summary.passed++;
        log(`✓ ${testName}`, 'PASS');
    } else {
        testResults.summary.failed++;
        log(`✗ ${testName}`, 'FAIL');
    }

    return result;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendWebhook(eventData, description = '') {
    const startTime = Date.now();

    try {
        const response = await fetch(`${TEST_CONFIG.workerUrl}${TEST_CONFIG.testWebhookEndpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(eventData)
        });

        const responseTime = Date.now() - startTime;
        const result = await response.json();

        return {
            success: true,
            status: response.status,
            data: result,
            responseTime,
            description
        };

    } catch (error) {
        return {
            success: false,
            error: error.message,
            responseTime: Date.now() - startTime,
            description
        };
    }
}

// Test 1: Duplicate Webhook Prevention
async function testDuplicateWebhookPrevention() {
    log('=== Testing Duplicate Webhook Prevention ===');

    // Create a unique checkout event
    const eventData = { ...sampleEvents.checkout_completed };
    eventData.id = 'evt_duplicate_test_' + Date.now();
    eventData.data.object.id = 'cs_duplicate_test_' + Date.now();
    eventData.data.object.customer_details.email = 'duplicate.test@pospal.test';

    const responses = [];

    // Send the same event multiple times
    for (let i = 0; i < TEST_CONFIG.duplicateTestCount; i++) {
        const response = await sendWebhook(eventData, `Duplicate attempt ${i + 1}`);
        responses.push(response);

        // Small delay to ensure proper ordering
        await sleep(100);
    }

    // Analyze results
    const firstResponse = responses[0];
    const subsequentResponses = responses.slice(1);

    // First request should succeed
    const firstSucceeded = firstResponse.success && firstResponse.status === 200;

    // Subsequent requests should return idempotent responses
    const duplicatesHandled = subsequentResponses.every(response => {
        return response.success &&
               (response.data.idempotent === true || response.data.duplicate === true);
    });

    // Check response times (idempotent responses should be faster)
    const idempotentResponseTimes = subsequentResponses.map(r => r.responseTime);
    const avgIdempotentTime = idempotentResponseTimes.reduce((a, b) => a + b, 0) / idempotentResponseTimes.length;

    const testPassed = firstSucceeded && duplicatesHandled;

    recordResult('duplicateTests', 'Duplicate Event Prevention', testPassed, {
        eventId: eventData.id,
        firstResponseTime: firstResponse.responseTime,
        avgIdempotentResponseTime: avgIdempotentTime,
        totalAttempts: TEST_CONFIG.duplicateTestCount,
        responses: responses.map(r => ({
            success: r.success,
            status: r.status,
            idempotent: r.data?.idempotent || false,
            duplicate: r.data?.duplicate || false,
            responseTime: r.responseTime
        }))
    });

    return testPassed;
}

// Test 2: Concurrent Processing Protection
async function testConcurrentProcessingProtection() {
    log('=== Testing Concurrent Processing Protection ===');

    // Create a unique event for concurrent testing
    const eventData = { ...sampleEvents.checkout_completed };
    eventData.id = 'evt_concurrent_test_' + Date.now();
    eventData.data.object.id = 'cs_concurrent_test_' + Date.now();
    eventData.data.object.customer_details.email = 'concurrent.test@pospal.test';

    // Send multiple concurrent requests
    const startTime = Date.now();
    const promises = Array(TEST_CONFIG.concurrentTestCount).fill().map((_, i) =>
        sendWebhook(eventData, `Concurrent request ${i + 1}`)
    );

    const responses = await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    // Analyze concurrent responses
    const successfulResponses = responses.filter(r => r.success);
    const processingResponses = responses.filter(r => r.data?.received === true && !r.data?.duplicate);
    const duplicateResponses = responses.filter(r => r.data?.duplicate === true || r.data?.idempotent === true);

    // Exactly one should be processed, others should be marked as duplicates/concurrent
    const properConcurrencyHandling = processingResponses.length === 1 &&
                                    duplicateResponses.length === (TEST_CONFIG.concurrentTestCount - 1);

    const testPassed = successfulResponses.length === TEST_CONFIG.concurrentTestCount &&
                      properConcurrencyHandling;

    recordResult('concurrentTests', 'Concurrent Processing Protection', testPassed, {
        eventId: eventData.id,
        totalRequests: TEST_CONFIG.concurrentTestCount,
        successfulResponses: successfulResponses.length,
        processingResponses: processingResponses.length,
        duplicateResponses: duplicateResponses.length,
        totalTime,
        avgResponseTime: responses.reduce((sum, r) => sum + r.responseTime, 0) / responses.length
    });

    return testPassed;
}

// Test 3: Event Tracking Verification (requires database query simulation)
async function testEventTracking() {
    log('=== Testing Event Tracking Verification ===');

    // Create unique event for tracking test
    const eventData = { ...sampleEvents.payment_succeeded };
    eventData.id = 'evt_tracking_test_' + Date.now();
    eventData.data.object.customer_email = 'tracking.test@pospal.test';

    // Send initial webhook
    const response = await sendWebhook(eventData, 'Event tracking test');

    // Verify response structure indicates proper tracking
    const hasProperTracking = response.success &&
                            response.data.received === true &&
                            !response.data.error;

    // Send duplicate to verify tracking prevents reprocessing
    await sleep(500);
    const duplicateResponse = await sendWebhook(eventData, 'Duplicate for tracking verification');

    const duplicateHandled = duplicateResponse.success &&
                           (duplicateResponse.data.idempotent === true ||
                            duplicateResponse.data.duplicate === true);

    const testPassed = hasProperTracking && duplicateHandled;

    recordResult('eventTrackingTests', 'Event Tracking and Status Management', testPassed, {
        eventId: eventData.id,
        initialResponse: {
            success: response.success,
            status: response.status,
            responseTime: response.responseTime
        },
        duplicateResponse: {
            success: duplicateResponse.success,
            idempotent: duplicateResponse.data?.idempotent,
            duplicate: duplicateResponse.data?.duplicate,
            responseTime: duplicateResponse.responseTime
        }
    });

    return testPassed;
}

// Test 4: Error Recovery Testing
async function testErrorRecovery() {
    log('=== Testing Error Recovery and Retry Behavior ===');

    // Test with invalid event data to trigger processing errors
    const invalidEventData = {
        id: 'evt_error_test_' + Date.now(),
        type: 'checkout.session.completed',
        data: {
            object: {
                // Missing required fields to trigger error
                id: 'cs_error_test_' + Date.now()
                // Intentionally missing customer_details, subscription, etc.
            }
        }
    };

    // Send invalid webhook
    const errorResponse = await sendWebhook(invalidEventData, 'Error recovery test');

    // Should handle error gracefully
    const errorHandledGracefully = errorResponse.success &&
                                 (errorResponse.status === 200 || errorResponse.status === 400);

    // Send the same invalid event again to test failed event retry
    await sleep(500);
    const retryResponse = await sendWebhook(invalidEventData, 'Error retry test');

    const retryHandled = retryResponse.success;

    // Test with corrected event data (simulating error fix)
    const correctedEventData = { ...sampleEvents.checkout_completed };
    correctedEventData.id = invalidEventData.id; // Same ID but correct data
    correctedEventData.data.object.customer_details.email = 'error.recovery.test@pospal.test';

    const correctedResponse = await sendWebhook(correctedEventData, 'Corrected event test');
    const correctedProcessed = correctedResponse.success && correctedResponse.status === 200;

    const testPassed = errorHandledGracefully && retryHandled && correctedProcessed;

    recordResult('errorRecoveryTests', 'Error Recovery and Retry Logic', testPassed, {
        eventId: invalidEventData.id,
        errorResponse: {
            success: errorResponse.success,
            status: errorResponse.status,
            responseTime: errorResponse.responseTime
        },
        retryResponse: {
            success: retryResponse.success,
            status: retryResponse.status,
            responseTime: retryResponse.responseTime
        },
        correctedResponse: {
            success: correctedResponse.success,
            status: correctedResponse.status,
            responseTime: correctedResponse.responseTime
        }
    });

    return testPassed;
}

// Test 5: Performance Impact Measurement
async function testPerformanceImpact() {
    log('=== Testing Performance Impact of Idempotency Checks ===');

    const performanceResults = {
        newEvents: [],
        duplicateEvents: [],
        averageOverhead: 0
    };

    // Test performance for new events (first time processing)
    for (let i = 0; i < TEST_CONFIG.performanceIterations; i++) {
        const eventData = { ...sampleEvents.checkout_completed };
        eventData.id = `evt_perf_new_${Date.now()}_${i}`;
        eventData.data.object.id = `cs_perf_new_${Date.now()}_${i}`;
        eventData.data.object.customer_details.email = `perf.new.${i}@pospal.test`;

        const response = await sendWebhook(eventData, `Performance test new event ${i}`);
        if (response.success) {
            performanceResults.newEvents.push(response.responseTime);
        }

        // Small delay to prevent overwhelming the server
        if (i % 10 === 0) await sleep(100);
    }

    // Test performance for duplicate events (idempotency check)
    const duplicateEventData = { ...sampleEvents.checkout_completed };
    duplicateEventData.id = 'evt_perf_duplicate_' + Date.now();
    duplicateEventData.data.object.customer_details.email = 'perf.duplicate@pospal.test';

    // Send once to establish the event in the system
    await sendWebhook(duplicateEventData, 'Performance baseline duplicate');
    await sleep(500);

    // Now test duplicate performance
    for (let i = 0; i < TEST_CONFIG.performanceIterations; i++) {
        const response = await sendWebhook(duplicateEventData, `Performance test duplicate ${i}`);
        if (response.success) {
            performanceResults.duplicateEvents.push(response.responseTime);
        }

        if (i % 10 === 0) await sleep(100);
    }

    // Calculate performance metrics
    const avgNewEventTime = performanceResults.newEvents.reduce((a, b) => a + b, 0) / performanceResults.newEvents.length;
    const avgDuplicateEventTime = performanceResults.duplicateEvents.reduce((a, b) => a + b, 0) / performanceResults.duplicateEvents.length;
    const overhead = avgNewEventTime - avgDuplicateEventTime;

    performanceResults.averageOverhead = overhead;

    // Test passes if overhead is within acceptable limits
    const testPassed = Math.abs(overhead) <= TEST_CONFIG.expectedMaxOverhead;

    recordResult('performanceTests', 'Idempotency Performance Impact', testPassed, {
        iterations: TEST_CONFIG.performanceIterations,
        avgNewEventTime: Math.round(avgNewEventTime),
        avgDuplicateEventTime: Math.round(avgDuplicateEventTime),
        overhead: Math.round(overhead),
        expectedMaxOverhead: TEST_CONFIG.expectedMaxOverhead,
        newEventStats: {
            min: Math.min(...performanceResults.newEvents),
            max: Math.max(...performanceResults.newEvents),
            median: performanceResults.newEvents.sort((a, b) => a - b)[Math.floor(performanceResults.newEvents.length / 2)]
        },
        duplicateEventStats: {
            min: Math.min(...performanceResults.duplicateEvents),
            max: Math.max(...performanceResults.duplicateEvents),
            median: performanceResults.duplicateEvents.sort((a, b) => a - b)[Math.floor(performanceResults.duplicateEvents.length / 2)]
        }
    });

    return testPassed;
}

// Main Test Execution
async function runAllTests() {
    log('🚀 Starting Phase 3 Webhook Idempotency Protection Test Suite');
    log(`Target URL: ${TEST_CONFIG.workerUrl}${TEST_CONFIG.testWebhookEndpoint}`);

    try {
        // Health check
        log('Performing health check...');
        const healthResponse = await fetch(`${TEST_CONFIG.workerUrl}/health`);
        if (!healthResponse.ok) {
            throw new Error(`Health check failed: ${healthResponse.status}`);
        }
        log('✓ Health check passed');

        // Run all test suites
        const testResults = [
            await testDuplicateWebhookPrevention(),
            await testConcurrentProcessingProtection(),
            await testEventTracking(),
            await testErrorRecovery(),
            await testPerformanceImpact()
        ];

        // Generate summary
        const allTestsPassed = testResults.every(result => result === true);

        log('\n=== PHASE 3 WEBHOOK IDEMPOTENCY TEST RESULTS ===');
        log(`Total Tests: ${testResults.summary.total}`);
        log(`Passed: ${testResults.summary.passed}`);
        log(`Failed: ${testResults.summary.failed}`);
        log(`Success Rate: ${((testResults.summary.passed / testResults.summary.total) * 100).toFixed(2)}%`);

        if (allTestsPassed) {
            log('🎉 ALL TESTS PASSED - Webhook idempotency protection is working correctly!');
        } else {
            log('❌ SOME TESTS FAILED - Review detailed results for issues');
        }

        // Save detailed results
        const reportFilename = `phase3_webhook_idempotency_test_report_${Date.now()}.json`;
        fs.writeFileSync(reportFilename, JSON.stringify(testResults, null, 2));
        log(`📄 Detailed test report saved to: ${reportFilename}`);

        return allTestsPassed;

    } catch (error) {
        log(`❌ Test suite failed: ${error.message}`, 'ERROR');
        return false;
    }
}

// Execute tests if run directly
if (require.main === module) {
    runAllTests().then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = {
    runAllTests,
    testDuplicateWebhookPrevention,
    testConcurrentProcessingProtection,
    testEventTracking,
    testErrorRecovery,
    testPerformanceImpact
};