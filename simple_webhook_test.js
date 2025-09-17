// Simple webhook idempotency test to understand actual behavior

const fetch = require('node-fetch');

const WORKER_URL = 'http://localhost:8787';

// Test webhook with proper data structure
const testEvent = {
    id: 'evt_test_idempotency_' + Date.now(),
    type: 'checkout.session.completed',
    data: {
        object: {
            id: 'cs_test_idempotency_' + Date.now(),
            customer: 'cus_test_idempotency',
            customer_details: {
                email: 'idempotency.test@pospal.test',
                name: 'Idempotency Test Customer'
            },
            subscription: 'sub_test_phase3_idempotency',
            mode: 'subscription',
            payment_method_id: 'pm_test_card'
        }
    }
};

async function sendWebhook(eventData, label) {
    console.log(`\n=== ${label} ===`);
    console.log(`Event ID: ${eventData.id}`);

    const startTime = Date.now();

    try {
        const response = await fetch(`${WORKER_URL}/test-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(eventData)
        });

        const responseTime = Date.now() - startTime;
        const responseData = await response.json();

        console.log(`Status: ${response.status}`);
        console.log(`Response Time: ${responseTime}ms`);
        console.log(`Response:`, JSON.stringify(responseData, null, 2));

        return {
            success: response.ok,
            status: response.status,
            data: responseData,
            responseTime
        };

    } catch (error) {
        console.log(`Error: ${error.message}`);
        return {
            success: false,
            error: error.message,
            responseTime: Date.now() - startTime
        };
    }
}

async function testIdempotency() {
    console.log('🧪 Testing Webhook Idempotency Protection');
    console.log(`Target: ${WORKER_URL}/test-webhook`);

    // Test 1: Send initial webhook
    const response1 = await sendWebhook(testEvent, 'First Request');

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 2: Send exact same webhook (should be idempotent)
    const response2 = await sendWebhook(testEvent, 'Duplicate Request (Same Event ID)');

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 3: Send same webhook again (should still be idempotent)
    const response3 = await sendWebhook(testEvent, 'Second Duplicate Request');

    // Analysis
    console.log('\n=== ANALYSIS ===');
    console.log(`First request successful: ${response1.success}`);
    console.log(`Second request handled: ${response2.success}`);
    console.log(`Third request handled: ${response3.success}`);

    if (response2.data && (response2.data.idempotent || response2.data.duplicate)) {
        console.log('✅ Idempotency protection working - duplicate detected');
    } else {
        console.log('❌ Idempotency protection may not be working');
    }

    if (response3.data && (response3.data.idempotent || response3.data.duplicate)) {
        console.log('✅ Multiple duplicates handled correctly');
    } else {
        console.log('❌ Multiple duplicates not handled correctly');
    }

    // Performance comparison
    console.log(`\nResponse times:`);
    console.log(`First: ${response1.responseTime}ms`);
    console.log(`Second: ${response2.responseTime}ms`);
    console.log(`Third: ${response3.responseTime}ms`);

    if (response2.responseTime < response1.responseTime && response3.responseTime < response1.responseTime) {
        console.log('✅ Idempotent responses are faster (good caching)');
    }
}

// Test concurrent requests
async function testConcurrentRequests() {
    console.log('\n🔄 Testing Concurrent Webhook Processing');

    const concurrentEvent = {
        id: 'evt_concurrent_' + Date.now(),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: 'cs_concurrent_' + Date.now(),
                customer: 'cus_concurrent_test',
                customer_details: {
                    email: 'concurrent.test@pospal.test',
                    name: 'Concurrent Test Customer'
                },
                subscription: 'sub_concurrent_test',
                mode: 'subscription',
                payment_method_id: 'pm_test_card'
            }
        }
    };

    console.log(`\nSending 5 concurrent requests with same event ID: ${concurrentEvent.id}`);

    // Send 5 concurrent requests
    const promises = Array(5).fill().map((_, i) =>
        sendWebhook(concurrentEvent, `Concurrent Request ${i + 1}`)
    );

    const startTime = Date.now();
    const responses = await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    console.log(`\nAll concurrent requests completed in ${totalTime}ms`);

    // Analysis
    const successful = responses.filter(r => r.success).length;
    const withIdempotency = responses.filter(r => r.data && (r.data.idempotent || r.data.duplicate)).length;
    const withoutIdempotency = responses.filter(r => r.success && r.data && !r.data.idempotent && !r.data.duplicate).length;

    console.log(`Successful responses: ${successful}/5`);
    console.log(`Idempotent responses: ${withIdempotency}/5`);
    console.log(`Processed responses: ${withoutIdempotency}/5`);

    if (withoutIdempotency === 1 && withIdempotency === 4) {
        console.log('✅ Perfect concurrency protection - exactly 1 processed, 4 idempotent');
    } else if (withoutIdempotency <= 1) {
        console.log('✅ Good concurrency protection - at most 1 processed');
    } else {
        console.log('❌ Concurrency protection issue - multiple events processed');
    }
}

async function main() {
    try {
        // Health check first
        const healthResponse = await fetch(`${WORKER_URL}/health`);
        if (!healthResponse.ok) {
            throw new Error(`Health check failed: ${healthResponse.status}`);
        }
        console.log('✅ Worker health check passed');

        await testIdempotency();
        await testConcurrentRequests();

        console.log('\n🎯 Simple webhook idempotency test completed');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

main();