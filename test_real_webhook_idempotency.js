// Test the real webhook endpoint with idempotency protection

const fetch = require('node-fetch');

const WORKER_URL = 'http://localhost:8787';

// Test event for idempotency
const testEvent = {
    id: 'evt_idempotency_real_' + Date.now(),
    type: 'checkout.session.completed',
    data: {
        object: {
            id: 'cs_idempotency_real_' + Date.now(),
            customer: 'cus_idempotency_test',
            customer_details: {
                email: 'idempotency.real@pospal.test',
                name: 'Real Idempotency Test'
            },
            subscription: 'sub_test_phase3_real',
            mode: 'subscription',
            payment_method_id: 'pm_test_card'
        }
    }
};

async function testRealWebhookIdempotency() {
    console.log('🧪 Testing Real Webhook Idempotency Protection');
    console.log(`Event ID: ${testEvent.id}`);

    // Test 1: Send webhook without signature (should fail gracefully)
    console.log('\n=== Test 1: No Signature (Expected: 400) ===');
    const noSigResponse = await fetch(`${WORKER_URL}/webhook`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(testEvent)
    });

    const noSigData = await noSigResponse.json();
    console.log(`Status: ${noSigResponse.status}`);
    console.log(`Response:`, JSON.stringify(noSigData, null, 2));

    // Test 2: Send webhook with dummy signature (will fail verification but should trigger idempotency logic)
    console.log('\n=== Test 2: Dummy Signature (Idempotency Check) ===');
    const dummySigResponse = await fetch(`${WORKER_URL}/webhook`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'stripe-signature': 't=1234567890,v1=dummy_signature',
        },
        body: JSON.stringify(testEvent)
    });

    const dummySigData = await dummySigResponse.json();
    console.log(`Status: ${dummySigResponse.status}`);
    console.log(`Response:`, JSON.stringify(dummySigData, null, 2));

    // Test 3: Send exact same event again (should trigger idempotency if first was processed)
    console.log('\n=== Test 3: Duplicate Event (Idempotency Test) ===');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const duplicateResponse = await fetch(`${WORKER_URL}/webhook`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'stripe-signature': 't=1234567890,v1=dummy_signature',
        },
        body: JSON.stringify(testEvent)
    });

    const duplicateData = await duplicateResponse.json();
    console.log(`Status: ${duplicateResponse.status}`);
    console.log(`Response:`, JSON.stringify(duplicateData, null, 2));

    // Check database for webhook tracking
    console.log('\n=== Database Check ===');
    try {
        // We can't directly query the database from Node.js, but we can check if responses indicate idempotency
        if (duplicateData.idempotent || duplicateData.duplicate || duplicateData.message?.includes('already processed')) {
            console.log('✅ Idempotency protection working');
        } else {
            console.log('❓ Idempotency unclear from response');
        }
    } catch (error) {
        console.log('❌ Could not verify idempotency:', error.message);
    }

    return {
        noSigResponse: { status: noSigResponse.status, data: noSigData },
        dummySigResponse: { status: dummySigResponse.status, data: dummySigData },
        duplicateResponse: { status: duplicateResponse.status, data: duplicateData }
    };
}

// Test concurrent processing with the real webhook endpoint
async function testRealConcurrentProcessing() {
    console.log('\n🔄 Testing Real Webhook Concurrent Processing');

    const concurrentEvent = {
        id: 'evt_concurrent_real_' + Date.now(),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: 'cs_concurrent_real_' + Date.now(),
                customer: 'cus_concurrent_real',
                customer_details: {
                    email: 'concurrent.real@pospal.test',
                    name: 'Concurrent Real Test'
                },
                subscription: 'sub_concurrent_real',
                mode: 'subscription'
            }
        }
    };

    console.log(`Event ID: ${concurrentEvent.id}`);

    // Send 3 concurrent requests to the real webhook endpoint
    const promises = Array(3).fill().map((_, i) =>
        fetch(`${WORKER_URL}/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'stripe-signature': `t=1234567890,v1=dummy_signature_${i}`,
            },
            body: JSON.stringify(concurrentEvent)
        }).then(async response => ({
            index: i,
            status: response.status,
            data: await response.json()
        }))
    );

    const results = await Promise.all(promises);

    console.log('\nConcurrent Results:');
    results.forEach(result => {
        console.log(`Request ${result.index}: Status ${result.status}`);
        console.log(`  Data:`, JSON.stringify(result.data, null, 2));
    });

    // Check for idempotency markers
    const idempotentResponses = results.filter(r =>
        r.data.idempotent || r.data.duplicate || r.data.message?.includes('already processed')
    );

    console.log(`\nIdempotent responses: ${idempotentResponses.length}/3`);

    if (idempotentResponses.length >= 2) {
        console.log('✅ Good concurrent protection detected');
    } else {
        console.log('❓ Concurrent protection unclear');
    }

    return results;
}

async function main() {
    try {
        const results = await testRealWebhookIdempotency();
        const concurrentResults = await testRealConcurrentProcessing();

        console.log('\n📊 Summary:');
        console.log('Real webhook idempotency test completed');
        console.log('Check responses above for idempotency markers');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

main();