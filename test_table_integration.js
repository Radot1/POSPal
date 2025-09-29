// Test script to verify order-table integration fix
const testOrderTableIntegration = async () => {
    const BASE_URL = 'http://localhost:5000';

    console.log('🧪 Testing Order-Table Integration Fix');
    console.log('=====================================');

    try {
        // Step 1: Create table configuration
        console.log('📋 Step 1: Setting up table configuration...');
        const tableConfig = {
            tables: {
                "1": {name: "Test Table 1", seats: 4, status: "available"},
                "2": {name: "Test Table 2", seats: 2, status: "available"}
            },
            settings: {
                auto_clear_paid_tables: true,
                default_table_timeout: 3600
            }
        };

        const configResponse = await fetch(`${BASE_URL}/api/tables/configure`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(tableConfig)
        });

        if (configResponse.ok) {
            console.log('✅ Table configuration successful');
        } else {
            console.log('❌ Table configuration failed:', await configResponse.text());
        }

        // Step 2: Check initial table states
        console.log('\n📊 Step 2: Checking initial table states...');
        const tablesResponse = await fetch(`${BASE_URL}/api/tables`);
        const tablesData = await tablesResponse.json();
        console.log('Tables:', JSON.stringify(tablesData, null, 2));

        // Step 3: Submit order with table number
        console.log('\n🍽️ Step 3: Submitting order for Table 1...');
        const orderData = {
            tableNumber: "1",
            items: [
                {
                    name: "Test Coffee",
                    quantity: 2,
                    itemPriceWithModifiers: 3.50,
                    basePrice: 3.50
                },
                {
                    name: "Test Sandwich",
                    quantity: 1,
                    itemPriceWithModifiers: 8.50,
                    basePrice: 8.50
                }
            ],
            universalComment: "Test order for table integration",
            paymentMethod: "Cash"
        };

        const orderResponse = await fetch(`${BASE_URL}/api/orders`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(orderData)
        });

        const orderResult = await orderResponse.json();
        console.log('Order response:', JSON.stringify(orderResult, null, 2));

        if (orderResult.status === 'success' || orderResult.status === 'error_trial_expired') {
            const orderNumber = orderResult.order_number;
            console.log(`✅ Order submitted: #${orderNumber}`);

            // Step 4: Check if table session was updated
            console.log('\n🔍 Step 4: Checking table session update...');
            const sessionResponse = await fetch(`${BASE_URL}/api/tables/1/session`);
            const sessionData = await sessionResponse.json();
            console.log('Table 1 session:', JSON.stringify(sessionData, null, 2));

            if (sessionData.orders && sessionData.orders.includes(orderNumber)) {
                console.log('✅ SUCCESS: Order correctly linked to table session!');
                console.log(`   - Orders in session: [${sessionData.orders.join(', ')}]`);
                console.log(`   - Total amount: €${sessionData.total_amount}`);
            } else {
                console.log('❌ FAILURE: Order NOT linked to table session');
                console.log(`   - Expected order #${orderNumber} in session`);
                console.log(`   - Found orders: [${(sessionData.orders || []).join(', ')}]`);
            }

            // Step 5: Check table bill
            console.log('\n🧾 Step 5: Testing table bill generation...');
            const billResponse = await fetch(`${BASE_URL}/api/tables/1/bill`);
            const billData = await billResponse.json();
            console.log('Table 1 bill:', JSON.stringify(billData, null, 2));

            if (billData.total_amount > 0) {
                console.log(`✅ SUCCESS: Table bill shows total of €${billData.total_amount}`);
            } else {
                console.log(`❌ FAILURE: Table bill shows €0.0 total`);
            }

        } else {
            console.log('❌ Order submission failed:', orderResult.message);
        }

    } catch (error) {
        console.error('❌ Test failed with error:', error);
    }

    console.log('\n🏁 Test completed');
};

// Run the test
testOrderTableIntegration();