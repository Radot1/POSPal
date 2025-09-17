/**
 * Comprehensive Phase 3 Webhook Idempotency Protection Test Suite
 *
 * This test suite validates all aspects of the webhook idempotency system:
 * 1. Duplicate webhook prevention
 * 2. Concurrent processing protection
 * 3. Event tracking verification
 * 4. Error recovery and retry behavior
 * 5. Performance impact measurement
 */

const fetch = require('node-fetch');
const fs = require('fs');

// Test Configuration
const CONFIG = {
    workerUrl: 'http://localhost:8787',
    webhookEndpoint: '/webhook',
    duplicateTestCount: 5,
    concurrentTestCount: 8,
    performanceIterations: 50,
    maxAcceptableOverhead: 100 // milliseconds
};

// Test Results
const results = {
    timestamp: new Date().toISOString(),
    testSuite: 'Phase 3 Webhook Idempotency Protection',
    tests: {
        duplicatePrevention: { passed: false, details: {} },
        concurrentProtection: { passed: false, details: {} },
        eventTracking: { passed: false, details: {} },
        errorRecovery: { passed: false, details: {} },
        performanceImpact: { passed: false, details: {} }
    },
    summary: { total: 0, passed: 0, failed: 0 }
};

// Utility Functions
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

function recordTest(testName, passed, details = {}) {
    results.tests[testName] = { passed, details, timestamp: new Date().toISOString() };
    results.summary.total++;

    if (passed) {
        results.summary.passed++;
        log(`✅ ${testName.replace(/([A-Z])/g, ' $1').toLowerCase()}`, 'PASS');
    } else {
        results.summary.failed++;
        log(`❌ ${testName.replace(/([A-Z])/g, ' $1').toLowerCase()}`, 'FAIL');
    }
}

async function sendWebhook(eventData, signature = 't=1234567890,v1=dummy_signature') {
    const startTime = Date.now();

    try {
        const response = await fetch(`${CONFIG.workerUrl}${CONFIG.webhookEndpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'stripe-signature': signature,
            },
            body: JSON.stringify(eventData)
        });

        const responseTime = Date.now() - startTime;
        const data = await response.json();

        return {
            success: response.ok,
            status: response.status,
            data,
            responseTime
        };

    } catch (error) {
        return {
            success: false,
            error: error.message,
            responseTime: Date.now() - startTime
        };
    }
}

function createTestEvent(id, type = 'checkout.session.completed') {
    return {
        id: id,
        type: type,
        data: {
            object: {
                id: `cs_${id}`,
                customer: `cus_${id}`,
                customer_details: {
                    email: `${id}@pospal.test`,
                    name: `Test Customer ${id}`
                },
                subscription: `sub_${id}`,
                mode: 'subscription',
                payment_method_id: 'pm_test_card'
            }
        }
    };
}

// Test 1: Duplicate Webhook Prevention
async function testDuplicatePrevention() {
    log('=== Testing Duplicate Webhook Prevention ===');

    const eventId = `evt_duplicate_${Date.now()}`;
    const testEvent = createTestEvent(eventId);

    const responses = [];

    // Send the same event multiple times
    for (let i = 0; i < CONFIG.duplicateTestCount; i++) {
        const response = await sendWebhook(testEvent);
        responses.push(response);

        // Small delay to ensure proper sequencing
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Analyze results
    const firstResponse = responses[0];
    const subsequentResponses = responses.slice(1);

    // First should either succeed or fail with processing error
    const firstProcessed = firstResponse.status === 200 || firstResponse.status === 500;

    // Subsequent should be marked as idempotent/duplicate
    const duplicatesHandled = subsequentResponses.every(response =>
        response.data?.idempotent === true ||
        response.data?.duplicate === true ||
        response.data?.message?.includes('already processed')
    );

    // Check that idempotent responses are faster
    const firstTime = firstResponse.responseTime;
    const avgIdempotentTime = subsequentResponses.reduce((sum, r) => sum + r.responseTime, 0) / subsequentResponses.length;
    const speedImprovement = firstTime > avgIdempotentTime;

    const testPassed = firstProcessed && duplicatesHandled && speedImprovement;

    recordTest('duplicatePrevention', testPassed, {
        eventId,
        firstResponseTime: firstTime,
        avgIdempotentTime: Math.round(avgIdempotentTime),
        speedImprovement,
        duplicatesDetected: subsequentResponses.filter(r =>
            r.data?.idempotent || r.data?.duplicate
        ).length,
        totalAttempts: CONFIG.duplicateTestCount,
        responseStatuses: responses.map(r => r.status)
    });

    return testPassed;
}

// Test 2: Concurrent Processing Protection
async function testConcurrentProtection() {
    log('=== Testing Concurrent Processing Protection ===');

    const eventId = `evt_concurrent_${Date.now()}`;
    const testEvent = createTestEvent(eventId);

    // Send multiple concurrent requests
    const startTime = Date.now();
    const promises = Array(CONFIG.concurrentTestCount).fill().map((_, i) =>
        sendWebhook(testEvent, `t=1234567890,v1=dummy_signature_${i}`)
    );

    const responses = await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    // Analyze concurrent behavior
    const successfulResponses = responses.filter(r => r.success).length;
    const processingResponses = responses.filter(r =>
        r.status === 500 && r.data?.error?.includes('process')
    ).length;
    const duplicateResponses = responses.filter(r =>
        r.data?.idempotent || r.data?.duplicate ||
        r.data?.message?.includes('currently being processed')
    ).length;

    // Should have at most 1 processing attempt, rest should be duplicates
    const properConcurrencyHandling = (processingResponses <= 1) &&
                                    (duplicateResponses >= CONFIG.concurrentTestCount - 1);

    const testPassed = successfulResponses === CONFIG.concurrentTestCount &&
                      properConcurrencyHandling;

    recordTest('concurrentProtection', testPassed, {
        eventId,
        totalRequests: CONFIG.concurrentTestCount,
        successfulResponses,
        processingResponses,
        duplicateResponses,
        totalTime,
        avgResponseTime: Math.round(responses.reduce((sum, r) => sum + r.responseTime, 0) / responses.length),
        responseStatuses: responses.map(r => ({ status: r.status, duplicate: !!r.data?.duplicate }))
    });

    return testPassed;
}

// Test 3: Event Tracking Verification
async function testEventTracking() {
    log('=== Testing Event Tracking Verification ===');

    const eventId = `evt_tracking_${Date.now()}`;
    const testEvent = createTestEvent(eventId);

    // Send initial event
    const initialResponse = await sendWebhook(testEvent);

    // Wait and send duplicate
    await new Promise(resolve => setTimeout(resolve, 1000));
    const duplicateResponse = await sendWebhook(testEvent);

    // Check tracking behavior
    const initialHandled = initialResponse.status === 200 || initialResponse.status === 500;
    const duplicateDetected = duplicateResponse.data?.idempotent === true ||
                             duplicateResponse.data?.duplicate === true ||
                             duplicateResponse.data?.message?.includes('already processed');

    // Verify processed_at timestamp exists in duplicate response
    const hasTimestamp = duplicateResponse.data?.processed_at !== undefined;

    const testPassed = initialHandled && duplicateDetected && hasTimestamp;

    recordTest('eventTracking', testPassed, {
        eventId,
        initialResponse: {
            status: initialResponse.status,
            responseTime: initialResponse.responseTime
        },
        duplicateResponse: {
            status: duplicateResponse.status,
            idempotent: duplicateResponse.data?.idempotent,
            duplicate: duplicateResponse.data?.duplicate,
            hasTimestamp,
            responseTime: duplicateResponse.responseTime
        }
    });

    return testPassed;
}

// Test 4: Error Recovery Testing
async function testErrorRecovery() {
    log('=== Testing Error Recovery ===');

    // Test with various error scenarios
    const scenarios = [
        {
            name: 'missing_customer_details',
            event: {
                id: `evt_error_missing_${Date.now()}`,
                type: 'checkout.session.completed',
                data: {
                    object: {
                        id: `cs_error_missing_${Date.now()}`,
                        // Missing required customer_details
                        subscription: 'sub_error_test'
                    }
                }
            }
        },
        {
            name: 'invalid_event_type',
            event: {
                id: `evt_error_type_${Date.now()}`,
                type: 'invalid.event.type',
                data: {
                    object: {
                        id: `cs_error_type_${Date.now()}`
                    }
                }
            }
        }
    ];

    const errorResults = [];

    for (const scenario of scenarios) {
        // Send error-inducing event
        const errorResponse = await sendWebhook(scenario.event);

        // Send same event again to test error handling idempotency
        await new Promise(resolve => setTimeout(resolve, 500));
        const retryResponse = await sendWebhook(scenario.event);

        const errorHandled = errorResponse.status === 200 || errorResponse.status === 400 || errorResponse.status === 500;
        const retryIdempotent = retryResponse.data?.idempotent || retryResponse.data?.duplicate;

        errorResults.push({
            scenario: scenario.name,
            errorHandled,
            retryIdempotent,
            errorStatus: errorResponse.status,
            retryStatus: retryResponse.status
        });
    }

    const allErrorsHandled = errorResults.every(r => r.errorHandled && r.retryIdempotent);

    recordTest('errorRecovery', allErrorsHandled, {
        scenarios: errorResults.length,
        allHandled: allErrorsHandled,
        results: errorResults
    });

    return allErrorsHandled;
}

// Test 5: Performance Impact Measurement
async function testPerformanceImpact() {
    log('=== Testing Performance Impact ===');

    const performanceData = {
        newEvents: [],
        duplicateEvents: []
    };

    // Test new event processing performance
    for (let i = 0; i < CONFIG.performanceIterations; i++) {
        const eventId = `evt_perf_new_${Date.now()}_${i}`;
        const testEvent = createTestEvent(eventId);

        const response = await sendWebhook(testEvent);
        if (response.responseTime) {
            performanceData.newEvents.push(response.responseTime);
        }

        // Pace requests to avoid overwhelming the system
        if (i % 10 === 0) await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Test duplicate event performance (idempotency check)
    const duplicateEventId = `evt_perf_duplicate_${Date.now()}`;
    const duplicateEvent = createTestEvent(duplicateEventId);

    // Send once to establish baseline
    await sendWebhook(duplicateEvent);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Now test duplicate performance
    for (let i = 0; i < CONFIG.performanceIterations; i++) {
        const response = await sendWebhook(duplicateEvent);
        if (response.responseTime) {
            performanceData.duplicateEvents.push(response.responseTime);
        }

        if (i % 10 === 0) await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Calculate metrics
    const avgNewTime = performanceData.newEvents.reduce((a, b) => a + b, 0) / performanceData.newEvents.length;
    const avgDuplicateTime = performanceData.duplicateEvents.reduce((a, b) => a + b, 0) / performanceData.duplicateEvents.length;
    const overhead = Math.abs(avgNewTime - avgDuplicateTime);

    // Performance test passes if overhead is within acceptable limits
    const testPassed = overhead <= CONFIG.maxAcceptableOverhead;

    recordTest('performanceImpact', testPassed, {
        iterations: CONFIG.performanceIterations,
        avgNewEventTime: Math.round(avgNewTime),
        avgDuplicateTime: Math.round(avgDuplicateTime),
        overhead: Math.round(overhead),
        maxAcceptableOverhead: CONFIG.maxAcceptableOverhead,
        newEventStats: {
            min: Math.min(...performanceData.newEvents),
            max: Math.max(...performanceData.newEvents),
            median: performanceData.newEvents.sort((a, b) => a - b)[Math.floor(performanceData.newEvents.length / 2)]
        },
        duplicateStats: {
            min: Math.min(...performanceData.duplicateEvents),
            max: Math.max(...performanceData.duplicateEvents),
            median: performanceData.duplicateEvents.sort((a, b) => a - b)[Math.floor(performanceData.duplicateEvents.length / 2)]
        }
    });

    return testPassed;
}

// Main Test Runner
async function runComprehensiveTests() {
    log('🚀 Starting Phase 3 Webhook Idempotency Protection Comprehensive Test Suite');
    log(`Target: ${CONFIG.workerUrl}${CONFIG.webhookEndpoint}`);

    try {
        // Health check
        const healthResponse = await fetch(`${CONFIG.workerUrl}/health`);
        if (!healthResponse.ok) {
            throw new Error(`Health check failed: ${healthResponse.status}`);
        }
        log('✅ Worker health check passed');

        // Run all tests
        const testResults = await Promise.all([
            testDuplicatePrevention(),
            testConcurrentProtection(),
            testEventTracking(),
            testErrorRecovery(),
            testPerformanceImpact()
        ]);

        // Generate final report
        const allTestsPassed = testResults.every(result => result === true);
        const successRate = (results.summary.passed / results.summary.total) * 100;

        log('\n📊 COMPREHENSIVE TEST RESULTS');
        log('===============================');
        log(`Total Tests: ${results.summary.total}`);
        log(`Passed: ${results.summary.passed}`);
        log(`Failed: ${results.summary.failed}`);
        log(`Success Rate: ${successRate.toFixed(2)}%`);

        if (allTestsPassed) {
            log('🎉 ALL TESTS PASSED - Phase 3 webhook idempotency protection is fully functional!');
        } else {
            log('⚠️  SOME TESTS FAILED - Review detailed results for specific issues');
        }

        // Save detailed report
        const reportFilename = `phase3_comprehensive_webhook_test_${Date.now()}.json`;
        fs.writeFileSync(reportFilename, JSON.stringify(results, null, 2));
        log(`📄 Detailed test report saved to: ${reportFilename}`);

        return allTestsPassed;

    } catch (error) {
        log(`❌ Test suite failed: ${error.message}`, 'ERROR');
        return false;
    }
}

// Execute if run directly
if (require.main === module) {
    runComprehensiveTests().then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = {
    runComprehensiveTests,
    testDuplicatePrevention,
    testConcurrentProtection,
    testEventTracking,
    testErrorRecovery,
    testPerformanceImpact
};