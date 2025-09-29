// Test the table integration using the bypass endpoint
const testTableIntegrationWithBypass = async () => {
    const BASE_URL = 'http://localhost:5000';

    console.log('🧪 Testing Table Integration with Bypass Endpoint');
    console.log('================================================');

    try {
        // Step 1: Submit test order for Table 1
        console.log('🍽️ Step 1: Submitting test order for Table 1...');
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

        const orderResponse = await fetch(`${BASE_URL}/api/test/orders`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(orderData)
        });

        const orderResult = await orderResponse.json();
        console.log('Order response:', JSON.stringify(orderResult, null, 2));

        if (orderResult.status === 'success') {
            const orderNumber = orderResult.order_number;
            console.log(`✅ Test order submitted: #${orderNumber}`);

            // Wait a moment for processing
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Step 2: Check table session update
            console.log('\n🔍 Step 2: Checking table session...');
            const sessionResponse = await fetch(`${BASE_URL}/api/tables/1/session`);
            const sessionData = await sessionResponse.json();
            console.log('Table 1 session:', JSON.stringify(sessionData, null, 2));

            if (sessionData.session && sessionData.session.orders && sessionData.session.orders.includes(orderNumber)) {
                console.log('✅ SUCCESS: Order correctly linked to table session!');
                console.log(`   - Orders in session: [${sessionData.session.orders.join(', ')}]`);
                console.log(`   - Total amount: €${sessionData.session.total_amount}`);
            } else {
                console.log('❌ FAILURE: Order NOT linked to table session');
                console.log(`   - Expected order #${orderNumber} in session`);
                console.log(`   - Found orders: [${(sessionData.session?.orders || []).join(', ')}]`);
            }

            // Step 3: Check table bill
            console.log('\n🧾 Step 3: Testing table bill generation...');
            const billResponse = await fetch(`${BASE_URL}/api/tables/1/bill`);
            const billData = await billResponse.json();
            console.log('Table 1 bill:', JSON.stringify(billData, null, 2));

            if (billData.grand_total > 0) {
                console.log(`✅ SUCCESS: Table bill shows total of €${billData.grand_total}`);
            } else {
                console.log(`❌ FAILURE: Table bill shows €0.0 total`);
            }

            // Step 4: Test another order to same table
            console.log('\n🍽️ Step 4: Adding second order to same table...');
            const order2Data = {
                tableNumber: "1",
                items: [
                    {
                        name: "Test Dessert",
                        quantity: 1,
                        itemPriceWithModifiers: 5.00,
                        basePrice: 5.00
                    }
                ],
                universalComment: "Second order for table 1",
                paymentMethod: "Cash"
            };

            const order2Response = await fetch(`${BASE_URL}/api/test/orders`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(order2Data)
            });

            const order2Result = await order2Response.json();
            if (order2Result.status === 'success') {
                const order2Number = order2Result.order_number;
                console.log(`✅ Second order submitted: #${order2Number}`);

                // Wait a moment
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Check updated session
                const session2Response = await fetch(`${BASE_URL}/api/tables/1/session`);
                const session2Data = await session2Response.json();
                console.log('\nUpdated table session:', JSON.stringify(session2Data, null, 2));

                const orders = session2Data.session?.orders || [];
                if (orders.includes(orderNumber) && orders.includes(order2Number)) {
                    console.log('✅ SUCCESS: Both orders in table session!');
                    console.log(`   - Total orders: ${orders.length}`);
                    console.log(`   - Running total: €${session2Data.session?.total_amount || 0}`);
                } else {
                    console.log('❌ FAILURE: Not all orders in table session');
                }
            }

        } else {
            console.log('❌ Test order submission failed:', orderResult.message);
        }

    } catch (error) {
        console.error('❌ Test failed with error:', error);
    }

    console.log('\n🏁 Test completed');
};

// Run the test
testTableIntegrationWithBypass();