/**
 * Stripe Integration Test Suite for POSPal
 * Tests the complete payment flow from Flask app to Cloudflare Workers
 */

const FLASK_BASE_URL = 'http://localhost:5000';
const TEST_DATA = {
    customerName: 'Test Restaurant',
    customerEmail: 'test@pospal.com', 
    hardwareId: 'TEST-HW-12345-ABCDE-67890',
    restaurantName: 'Test Restaurant Ltd'
};

class StripeIntegrationTester {
    constructor() {
        this.results = [];
        this.startTime = Date.now();
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const result = { timestamp, message, type };
        this.results.push(result);
        
        const colors = {
            info: '\x1b[36m',    // Cyan
            success: '\x1b[32m', // Green  
            error: '\x1b[31m',   // Red
            warning: '\x1b[33m', // Yellow
            reset: '\x1b[0m'     // Reset
        };
        
        console.log(`${colors[type]}[${timestamp}] ${message}${colors.reset}`);
    }

    async testApiEndpoint(endpoint, options = {}) {
        try {
            const url = `${FLASK_BASE_URL}${endpoint}`;
            this.log(`Testing: ${endpoint}`, 'info');
            
            const response = await fetch(url, {
                method: 'GET',
                ...options
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.log(`✅ ${endpoint} - Status: ${response.status}`, 'success');
                return { success: true, data, status: response.status };
            } else {
                this.log(`❌ ${endpoint} - Status: ${response.status}, Error: ${data.error || 'Unknown'}`, 'error');
                return { success: false, data, status: response.status };
            }
            
        } catch (error) {
            this.log(`💥 ${endpoint} - Network Error: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    async testPostEndpoint(endpoint, payload) {
        try {
            const url = `${FLASK_BASE_URL}${endpoint}`;
            this.log(`Testing POST: ${endpoint}`, 'info');
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.log(`✅ ${endpoint} - Status: ${response.status}`, 'success');
                return { success: true, data, status: response.status };
            } else {
                this.log(`❌ ${endpoint} - Status: ${response.status}, Error: ${data.error || 'Unknown'}`, 'error');
                return { success: false, data, status: response.status };
            }
            
        } catch (error) {
            this.log(`💥 ${endpoint} - Network Error: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    async testStripeConfig() {
        this.log('🔧 Testing Stripe Configuration', 'info');
        
        const result = await this.testApiEndpoint('/api/config');
        if (result.success && result.data.stripe && result.data.stripe.publishable_key) {
            this.log('✅ Stripe config loaded successfully', 'success');
            return true;
        } else {
            this.log('❌ Stripe config missing or invalid', 'error');
            return false;
        }
    }

    async testCheckoutSessionCreation() {
        this.log('💳 Testing Stripe Checkout Session Creation', 'info');
        
        const result = await this.testPostEndpoint('/api/create-checkout-session', TEST_DATA);
        
        if (result.success) {
            const { data } = result;
            
            // Validate response structure
            const requiredFields = ['id', 'url', 'message', 'code'];
            const missingFields = requiredFields.filter(field => !data[field]);
            
            if (missingFields.length === 0) {
                this.log('✅ Checkout session structure valid', 'success');
                
                // Validate session ID format
                if (data.id && data.id.startsWith('cs_')) {
                    this.log('✅ Session ID format valid', 'success');
                } else {
                    this.log(`⚠️ Session ID format unexpected: ${data.id}`, 'warning');
                }
                
                // Validate checkout URL
                if (data.url && data.url.startsWith('https://')) {
                    this.log('✅ Checkout URL format valid', 'success');
                } else {
                    this.log(`⚠️ Checkout URL format unexpected: ${data.url}`, 'warning');
                }
                
                return { success: true, sessionData: data };
            } else {
                this.log(`❌ Missing response fields: ${missingFields.join(', ')}`, 'error');
                return { success: false };
            }
        }
        
        return result;
    }

    async testCustomerPortalSession() {
        this.log('🏢 Testing Customer Portal Session Creation', 'info');
        
        const result = await this.testPostEndpoint('/api/create-portal-session', {
            customerEmail: TEST_DATA.customerEmail
        });
        
        if (result.success) {
            const { data } = result;
            
            if (data.url && data.url.startsWith('https://')) {
                this.log('✅ Portal session created successfully', 'success');
                return { success: true, portalData: data };
            } else {
                this.log(`⚠️ Portal URL format unexpected: ${data.url}`, 'warning');
                return { success: false };
            }
        }
        
        return result;
    }

    async testRateLimiting() {
        this.log('🛡️ Testing Rate Limiting', 'info');
        
        // Test rate limiting on checkout session endpoint
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(this.testPostEndpoint('/api/create-checkout-session', TEST_DATA));
        }
        
        const results = await Promise.all(promises);
        const rateLimitedResults = results.filter(r => r.status === 429);
        
        if (rateLimitedResults.length > 0) {
            this.log(`✅ Rate limiting working - ${rateLimitedResults.length} requests blocked`, 'success');
        } else {
            this.log('⚠️ Rate limiting may not be working as expected', 'warning');
        }
    }

    async testInputValidation() {
        this.log('🔍 Testing Input Validation', 'info');
        
        // Test invalid email
        const invalidEmailTest = await this.testPostEndpoint('/api/create-checkout-session', {
            ...TEST_DATA,
            customerEmail: 'invalid-email'
        });
        
        if (!invalidEmailTest.success && invalidEmailTest.status === 400) {
            this.log('✅ Email validation working', 'success');
        } else {
            this.log('❌ Email validation not working properly', 'error');
        }
        
        // Test missing required fields
        const missingFieldTest = await this.testPostEndpoint('/api/create-checkout-session', {
            customerName: 'Test Only'
            // Missing email and hardwareId
        });
        
        if (!missingFieldTest.success && missingFieldTest.status === 400) {
            this.log('✅ Required field validation working', 'success');
        } else {
            this.log('❌ Required field validation not working properly', 'error');
        }
    }

    async testErrorHandling() {
        this.log('⚠️ Testing Error Handling', 'info');
        
        // Test malformed JSON
        try {
            const response = await fetch(`${FLASK_BASE_URL}/api/create-checkout-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: 'invalid-json'
            });
            
            if (response.status === 400) {
                this.log('✅ Malformed JSON handled correctly', 'success');
            } else {
                this.log('❌ Malformed JSON not handled properly', 'error');
            }
        } catch (error) {
            this.log(`⚠️ Error handling test failed: ${error.message}`, 'warning');
        }
    }

    async runAllTests() {
        this.log('🚀 Starting Stripe Integration Test Suite', 'info');
        this.log('=' .repeat(60), 'info');
        
        const tests = [
            () => this.testStripeConfig(),
            () => this.testCheckoutSessionCreation(), 
            () => this.testCustomerPortalSession(),
            () => this.testInputValidation(),
            () => this.testErrorHandling(),
            () => this.testRateLimiting()
        ];
        
        let passedTests = 0;
        let totalTests = tests.length;
        
        for (const test of tests) {
            try {
                const result = await test();
                if (result && result.success) {
                    passedTests++;
                }
            } catch (error) {
                this.log(`Test failed with exception: ${error.message}`, 'error');
            }
        }
        
        this.log('=' .repeat(60), 'info');
        this.log(`🎯 Test Results: ${passedTests}/${totalTests} tests passed`, 
                passedTests === totalTests ? 'success' : 'warning');
        
        const duration = (Date.now() - this.startTime) / 1000;
        this.log(`⏱️ Total execution time: ${duration.toFixed(2)} seconds`, 'info');
        
        this.generateReport();
        
        return {
            passed: passedTests,
            total: totalTests,
            success: passedTests === totalTests,
            duration,
            results: this.results
        };
    }

    generateReport() {
        const reportPath = './stripe-integration-test-report.json';
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                total_tests: this.results.filter(r => r.type === 'success' || r.type === 'error').length,
                passed: this.results.filter(r => r.type === 'success').length,
                failed: this.results.filter(r => r.type === 'error').length,
                warnings: this.results.filter(r => r.type === 'warning').length,
                duration: (Date.now() - this.startTime) / 1000
            },
            test_configuration: {
                flask_url: FLASK_BASE_URL,
                test_data: TEST_DATA
            },
            detailed_results: this.results
        };
        
        // In Node.js environment, you would write to file
        // For now, just log the report structure
        this.log('📊 Test report generated', 'info');
        console.log('\n📋 Test Report Summary:');
        console.log(JSON.stringify(report.summary, null, 2));
    }
}

// For browser testing
if (typeof window !== 'undefined') {
    window.StripeIntegrationTester = StripeIntegrationTester;
    window.runStripeTests = async function() {
        const tester = new StripeIntegrationTester();
        return await tester.runAllTests();
    };
}

// For Node.js testing  
if (typeof module !== 'undefined') {
    module.exports = StripeIntegrationTester;
}

// Auto-run if called directly
if (typeof require !== 'undefined' && require.main === module) {
    const tester = new StripeIntegrationTester();
    tester.runAllTests();
}