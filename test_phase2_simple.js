/**
 * Simple Phase 2 Billing Date Tests
 * Using direct API calls to test the new billing functionality
 */

// Test data
const testData = {
  checkout_session: {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_phase2_' + Date.now(),
        customer: 'cus_test_phase2',
        subscription: 'sub_test_phase2',
        customer_details: {
          email: 'phase2test@pospal.test',
          name: 'Phase 2 Test Customer'
        },
        mode: 'subscription',
        payment_method_types: ['card']
      }
    }
  }
};

console.log('Phase 2 Billing Date Test Data:');
console.log(JSON.stringify(testData, null, 2));

console.log('\n=== MANUAL TESTING INSTRUCTIONS ===');
console.log('1. Test webhook endpoint:');
console.log(`curl -X POST http://127.0.0.1:8787/webhook \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -d '${JSON.stringify(testData.checkout_session)}'`);

console.log('\n2. Test health endpoint:');
console.log('curl http://127.0.0.1:8787/health');

console.log('\n3. Test Flask backend:');
console.log('curl http://127.0.0.1:5000/api/health');

module.exports = testData;