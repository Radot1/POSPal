// Debug webhook to understand what's failing

const fetch = require('node-fetch');

const WORKER_URL = 'http://localhost:8787';

// Very minimal test event
const minimalEvent = {
    id: 'evt_debug_' + Date.now(),
    type: 'checkout.session.completed',
    data: {
        object: {
            id: 'cs_debug_' + Date.now(),
            customer: 'cus_debug_test',
            customer_details: {
                email: 'debug@pospal.test',
                name: 'Debug Test'
            },
            subscription: 'sub_debug_test'
        }
    }
};

async function debugWebhook() {
    console.log('🐛 Debugging webhook processing');
    console.log('Event:', JSON.stringify(minimalEvent, null, 2));

    try {
        const response = await fetch(`${WORKER_URL}/test-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(minimalEvent)
        });

        const responseData = await response.json();

        console.log(`\nResponse Status: ${response.status}`);
        console.log('Response Headers:', Object.fromEntries(response.headers.entries()));
        console.log('Response Data:', JSON.stringify(responseData, null, 2));

        // Check if it's being tracked as processed
        console.log('\n=== Testing duplicate after 2 seconds ===');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const duplicateResponse = await fetch(`${WORKER_URL}/test-webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(minimalEvent)
        });

        const duplicateData = await duplicateResponse.json();
        console.log(`Duplicate Status: ${duplicateResponse.status}`);
        console.log('Duplicate Data:', JSON.stringify(duplicateData, null, 2));

        // Analyze for idempotency
        if (duplicateData.idempotent || duplicateData.duplicate || duplicateData.message?.includes('already processed')) {
            console.log('✅ Idempotency detected in duplicate response');
        } else {
            console.log('❌ No idempotency protection detected');
        }

    } catch (error) {
        console.error('❌ Debug failed:', error.message);
    }
}

// Test with real webhook endpoint
async function debugRealWebhook() {
    console.log('\n🔗 Testing real webhook endpoint (with signature issues expected)');

    try {
        const response = await fetch(`${WORKER_URL}/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(minimalEvent)
        });

        const responseData = await response.json();
        console.log(`Real webhook Status: ${response.status}`);
        console.log('Real webhook Data:', JSON.stringify(responseData, null, 2));

    } catch (error) {
        console.error('Real webhook error:', error.message);
    }
}

async function main() {
    await debugWebhook();
    await debugRealWebhook();
}

main();