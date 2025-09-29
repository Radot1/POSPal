// Comprehensive end-to-end table management workflow test
const runCompleteTableWorkflowTest = async () => {
    const BASE_URL = 'http://localhost:5000';
    console.log('🧪 COMPREHENSIVE TABLE MANAGEMENT WORKFLOW TEST');
    console.log('==============================================');

    let testResults = {
        passed: 0,
        failed: 0,
        details: []
    };

    const test = (name, condition, message) => {
        if (condition) {
            console.log(`✅ ${name}: PASS`);
            testResults.passed++;
        } else {
            console.log(`❌ ${name}: FAIL - ${message}`);
            testResults.failed++;
        }
        testResults.details.push({ name, passed: condition, message });
    };

    try {
        // Phase 1: Table Configuration
        console.log('\n📋 PHASE 1: Table Configuration');
        console.log('------------------------------');

        const configResponse = await fetch(`${BASE_URL}/api/tables/configure`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                tables: {
                    "1": {name: "Table 1", seats: 4, status: "available"},
                    "2": {name: "Table 2", seats: 2, status: "available"},
                    "3": {name: "VIP Table", seats: 6, status: "available"}
                },
                settings: {
                    auto_clear_paid_tables: true,
                    default_table_timeout: 3600
                }
            })
        });

        test('Table Configuration', configResponse.ok, 'Failed to configure tables');

        // Phase 2: Initial State Verification
        console.log('\n📊 PHASE 2: Initial State Verification');
        console.log('------------------------------------');

        const tablesResponse = await fetch(`${BASE_URL}/api/tables`);
        const tablesData = await tablesResponse.json();

        test('Tables API Response', tablesData.status === 'success', 'Tables API failed');
        test('All Tables Available',
            Object.values(tablesData.tables).every(t => t.status === 'available'),
            'Not all tables show available status'
        );
        test('Consistent Status',
            Object.values(tablesData.tables).every(t => t.status === t.session.status),
            'Table status inconsistent with session status'
        );

        // Phase 3: Order Placement & Table Integration
        console.log('\n🍽️ PHASE 3: Order Placement & Table Integration');
        console.log('----------------------------------------------');

        // Place first order on Table 1
        const order1 = {
            tableNumber: "1",
            items: [
                { name: "Cappuccino", quantity: 2, itemPriceWithModifiers: 3.50, basePrice: 3.50 },
                { name: "Croissant", quantity: 1, itemPriceWithModifiers: 2.50, basePrice: 2.50 }
            ],
            universalComment: "First order for table 1",
            paymentMethod: "Cash"
        };

        const order1Response = await fetch(`${BASE_URL}/api/test/orders`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(order1)
        });

        const order1Result = await order1Response.json();
        test('Order 1 Submission', order1Result.status === 'success', 'Failed to submit first order');

        // Verify table session update
        await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay

        const table1Session = await fetch(`${BASE_URL}/api/tables/1/session`);
        const table1Data = await table1Session.json();

        test('Table 1 Session Creation',
            table1Data.session && table1Data.session.orders.length > 0,
            'Table session not created after order'
        );
        test('Table 1 Total Calculation',
            table1Data.session.total_amount === 9.5,
            `Expected €9.5, got €${table1Data.session.total_amount}`
        );

        // Place second order on same table
        const order2 = {
            tableNumber: "1",
            items: [
                { name: "Sandwich", quantity: 1, itemPriceWithModifiers: 8.50, basePrice: 8.50 }
            ],
            universalComment: "Second order for table 1",
            paymentMethod: "Card"
        };

        const order2Response = await fetch(`${BASE_URL}/api/test/orders`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(order2)
        });

        const order2Result = await order2Response.json();
        test('Order 2 Submission', order2Result.status === 'success', 'Failed to submit second order');

        // Verify running total
        await new Promise(resolve => setTimeout(resolve, 500));

        const table1Updated = await fetch(`${BASE_URL}/api/tables/1/session`);
        const table1UpdatedData = await table1Updated.json();

        test('Running Total Update',
            table1UpdatedData.session.total_amount === 18.0,
            `Expected €18.0, got €${table1UpdatedData.session.total_amount}`
        );
        test('Multiple Orders Tracking',
            table1UpdatedData.session.orders.length >= 2,
            'Multiple orders not tracked correctly'
        );

        // Phase 4: Bill Generation
        console.log('\n🧾 PHASE 4: Bill Generation');
        console.log('----------------------------');

        const billResponse = await fetch(`${BASE_URL}/api/tables/1/bill`);
        const billData = await billResponse.json();

        test('Bill Generation', billData.status === 'success', 'Bill generation failed');
        test('Bill Total Accuracy',
            billData.grand_total === 18.0,
            `Expected €18.0, got €${billData.grand_total}`
        );
        test('Bill Order Details',
            billData.orders && billData.orders.length >= 2,
            'Bill missing order details'
        );
        test('Payment Status Tracking',
            billData.payment_status === 'unpaid',
            'Incorrect payment status'
        );

        // Phase 5: Table Status Verification
        console.log('\n📊 PHASE 5: Table Status Verification');
        console.log('-----------------------------------');

        const tablesAfterOrders = await fetch(`${BASE_URL}/api/tables`);
        const tablesAfterData = await tablesAfterOrders.json();

        test('Table 1 Occupied Status',
            tablesAfterData.tables["1"].status === 'occupied',
            'Table 1 should show occupied status'
        );
        test('Other Tables Available',
            tablesAfterData.tables["2"].status === 'available' &&
            tablesAfterData.tables["3"].status === 'available',
            'Other tables should remain available'
        );

        // Phase 6: Payment Processing
        console.log('\n💳 PHASE 6: Payment Processing');
        console.log('-------------------------------');

        // Record partial payment
        const partialPayment = {
            payment_method: "Cash",
            amount: 10.0,
            reference: "CASH001"
        };

        const paymentResponse = await fetch(`${BASE_URL}/api/tables/1/payment/record`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(partialPayment)
        });

        const paymentResult = await paymentResponse.json();
        test('Partial Payment Recording', paymentResult.status === 'success', 'Failed to record partial payment');

        // Verify payment tracking
        const billAfterPayment = await fetch(`${BASE_URL}/api/tables/1/bill`);
        const billAfterPaymentData = await billAfterPayment.json();

        test('Payment Amount Tracking',
            billAfterPaymentData.amount_paid === 10.0,
            `Expected €10.0 paid, got €${billAfterPaymentData.amount_paid}`
        );
        test('Remaining Balance Calculation',
            billAfterPaymentData.amount_remaining === 8.0,
            `Expected €8.0 remaining, got €${billAfterPaymentData.amount_remaining}`
        );
        test('Partial Payment Status',
            billAfterPaymentData.payment_status === 'partial',
            'Payment status should be partial'
        );

        // Complete payment
        const finalPayment = {
            payment_method: "Card",
            amount: 8.0,
            reference: "CARD002"
        };

        const finalPaymentResponse = await fetch(`${BASE_URL}/api/tables/1/payment/record`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(finalPayment)
        });

        test('Final Payment Recording', finalPaymentResponse.ok, 'Failed to record final payment');

        // Verify full payment
        const billPaid = await fetch(`${BASE_URL}/api/tables/1/bill`);
        const billPaidData = await billPaid.json();

        test('Full Payment Status',
            billPaidData.payment_status === 'paid',
            'Payment status should be paid'
        );
        test('Zero Remaining Balance',
            billPaidData.amount_remaining <= 0.01,
            'Remaining balance should be zero'
        );

        // Phase 7: Table Clearing
        console.log('\n🧹 PHASE 7: Table Clearing');
        console.log('----------------------------');

        // Try clearing with unpaid balance (should fail)
        const clearAttempt1 = await fetch(`${BASE_URL}/api/tables/1/clear`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({})
        });

        // This should succeed since table is now paid
        test('Clear Paid Table', clearAttempt1.ok, 'Failed to clear paid table');

        // Verify table is available
        const tableAfterClear = await fetch(`${BASE_URL}/api/tables/1/status`);
        const tableAfterClearData = await tableAfterClear.json();

        test('Table Available After Clear',
            tableAfterClearData.table.status === 'available',
            'Table should be available after clearing'
        );
        test('Session Reset After Clear',
            tableAfterClearData.table.session.total_amount === 0.0,
            'Session should be reset after clearing'
        );

        // Phase 8: Multi-table Operations
        console.log('\n🏢 PHASE 8: Multi-table Operations');
        console.log('----------------------------------');

        // Place orders on multiple tables simultaneously
        const order3 = {
            tableNumber: "2",
            items: [{ name: "Coffee", quantity: 1, itemPriceWithModifiers: 2.50, basePrice: 2.50 }],
            universalComment: "Table 2 order",
            paymentMethod: "Cash"
        };

        const order4 = {
            tableNumber: "3",
            items: [{ name: "Lunch", quantity: 2, itemPriceWithModifiers: 12.00, basePrice: 12.00 }],
            universalComment: "VIP table order",
            paymentMethod: "Card"
        };

        const [order3Response, order4Response] = await Promise.all([
            fetch(`${BASE_URL}/api/test/orders`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(order3)
            }),
            fetch(`${BASE_URL}/api/test/orders`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(order4)
            })
        ]);

        const order3Result = await order3Response.json();
        const order4Result = await order4Response.json();

        test('Multi-table Order 1', order3Result.status === 'success', 'Table 2 order failed');
        test('Multi-table Order 2', order4Result.status === 'success', 'Table 3 order failed');

        // Verify all table states
        await new Promise(resolve => setTimeout(resolve, 500));

        const finalTablesState = await fetch(`${BASE_URL}/api/tables`);
        const finalTablesData = await finalTablesState.json();

        test('Table 1 Available',
            finalTablesData.tables["1"].status === 'available',
            'Table 1 should be available'
        );
        test('Table 2 Occupied',
            finalTablesData.tables["2"].status === 'occupied',
            'Table 2 should be occupied'
        );
        test('Table 3 Occupied',
            finalTablesData.tables["3"].status === 'occupied',
            'Table 3 should be occupied'
        );

        // Summary
        console.log('\n📊 TEST RESULTS SUMMARY');
        console.log('=======================');
        console.log(`✅ Passed: ${testResults.passed}`);
        console.log(`❌ Failed: ${testResults.failed}`);
        console.log(`📊 Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);

        if (testResults.failed === 0) {
            console.log('\n🎉 ALL TESTS PASSED! Table management system is working perfectly!');
        } else {
            console.log('\n⚠️ Some tests failed. Details:');
            testResults.details.filter(t => !t.passed).forEach(t => {
                console.log(`   - ${t.name}: ${t.message}`);
            });
        }

    } catch (error) {
        console.error('❌ Test suite failed with error:', error);
        testResults.failed++;
    }

    return testResults;
};

// Run the comprehensive test
runCompleteTableWorkflowTest();