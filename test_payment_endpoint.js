// Quick test of the payment endpoint
const testPaymentEndpoint = async () => {
    const BASE_URL = 'http://localhost:5000';

    console.log('🧪 Testing Payment Endpoint');
    console.log('===========================');

    try {
        // First create a table with an order
        console.log('1. Creating order for Table 1...');
        const order = {
            tableNumber: "1",
            items: [
                { name: "Test Item", quantity: 1, itemPriceWithModifiers: 10.00, basePrice: 10.00 }
            ],
            universalComment: "Test payment",
            paymentMethod: "Cash"
        };

        const orderResponse = await fetch(`${BASE_URL}/api/test/orders`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(order)
        });

        const orderResult = await orderResponse.json();
        console.log('Order result:', orderResult);

        if (orderResult.status === 'success') {
            // Now test payment recording
            console.log('\n2. Testing payment recording...');

            const payment = {
                amount: 5.00,
                method: "Cash",
                reference: "TEST001"
            };

            const paymentResponse = await fetch(`${BASE_URL}/api/tables/1/add-payment`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payment)
            });

            console.log('Payment response status:', paymentResponse.status);
            const paymentResult = await paymentResponse.json();
            console.log('Payment result:', JSON.stringify(paymentResult, null, 2));

            // Check bill after payment
            console.log('\n3. Checking bill after payment...');
            const billResponse = await fetch(`${BASE_URL}/api/tables/1/bill`);
            const billData = await billResponse.json();
            console.log('Bill data:', JSON.stringify(billData, null, 2));

        } else {
            console.log('❌ Order failed, cannot test payment');
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
    }
};

testPaymentEndpoint();