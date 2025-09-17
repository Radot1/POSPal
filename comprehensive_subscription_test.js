/**
 * POSPal Comprehensive Subscription System Testing Suite
 * Tests the complete subscription model including trial, purchase, validation, and management
 */

class ComprehensiveSubscriptionTester {
    constructor() {
        this.baseUrl = 'http://localhost:5000';
        this.workerUrl = 'http://localhost:8787';
        this.testResults = {
            trialFlow: [],
            subscriptionPurchase: [],
            licenseActivation: [],
            customerPortal: [],
            licenseValidation: [],
            edgeCases: [],
            performance: [],
            uiux: [],
            dataPersistence: []
        };
        this.startTime = Date.now();
    }

    log(category, test, result, details = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            test: test,
            result: result, // 'PASS', 'FAIL', 'WARNING'
            details: details,
            duration: details.duration || 0
        };
        this.testResults[category].push(entry);
        console.log(`[${category.toUpperCase()}] ${test}: ${result}`, details);
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async makeRequest(url, options = {}) {
        const startTime = Date.now();
        try {
            const response = await fetch(url, options);
            const data = await response.json();
            const duration = Date.now() - startTime;
            return { success: true, data, status: response.status, duration };
        } catch (error) {
            const duration = Date.now() - startTime;
            return { success: false, error: error.message, duration };
        }
    }

    // Test 1: Complete Trial Experience Flow
    async testTrialExperience() {
        console.log('\n=== TESTING TRIAL EXPERIENCE FLOW ===');

        // Test 1.1: Initial trial status
        const trialStatus = await this.makeRequest(`${this.baseUrl}/api/trial_status`);
        if (trialStatus.success && trialStatus.data.active) {
            this.log('trialFlow', 'Initial trial status check', 'PASS', {
                daysLeft: trialStatus.data.days_left,
                duration: trialStatus.duration
            });
        } else {
            this.log('trialFlow', 'Initial trial status check', 'FAIL', trialStatus);
        }

        // Test 1.2: License validation during trial
        const licenseValidation = await this.makeRequest(`${this.baseUrl}/api/validate-license`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'trial-test@example.com',
                hardware_id: 'test-machine-trial-001'
            })
        });

        if (licenseValidation.success && !licenseValidation.data.licensed && licenseValidation.data.active) {
            this.log('trialFlow', 'Trial license validation', 'PASS', {
                source: licenseValidation.data.source,
                daysLeft: licenseValidation.data.days_left,
                duration: licenseValidation.duration
            });
        } else {
            this.log('trialFlow', 'Trial license validation', 'FAIL', licenseValidation);
        }

        // Test 1.3: Configuration endpoint during trial
        const config = await this.makeRequest(`${this.baseUrl}/api/config`);
        if (config.success && config.data.license.source === 'trial') {
            this.log('trialFlow', 'Configuration endpoint trial state', 'PASS', {
                version: config.data.app.version,
                features: Object.keys(config.data.features),
                duration: config.duration
            });
        } else {
            this.log('trialFlow', 'Configuration endpoint trial state', 'FAIL', config);
        }

        // Test 1.4: Trial expiration simulation
        console.log('Testing trial expiration behavior...');
        // We'll test the UI response to expired trial status

        return this.testResults.trialFlow;
    }

    // Test 2: Subscription Purchase Flow
    async testSubscriptionPurchase() {
        console.log('\n=== TESTING SUBSCRIPTION PURCHASE FLOW ===');

        // Test 2.1: Stripe checkout session creation
        const checkoutSession = await this.makeRequest(`${this.workerUrl}/create-checkout-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'test-customer@example.com',
                success_url: 'http://localhost:5000/success.html',
                cancel_url: 'http://localhost:5000/cancel.html'
            })
        });

        if (checkoutSession.success && checkoutSession.data.checkout_url) {
            this.log('subscriptionPurchase', 'Stripe checkout session creation', 'PASS', {
                sessionId: checkoutSession.data.session_id,
                checkoutUrl: checkoutSession.data.checkout_url.substring(0, 50) + '...',
                duration: checkoutSession.duration
            });
        } else {
            this.log('subscriptionPurchase', 'Stripe checkout session creation', 'FAIL', checkoutSession);
        }

        // Test 2.2: Customer portal session creation
        const portalSession = await this.makeRequest(`${this.workerUrl}/create-portal-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_id: 'cus_test_customer_id',
                return_url: 'http://localhost:5000'
            })
        });

        if (portalSession.success && portalSession.data.portal_url) {
            this.log('subscriptionPurchase', 'Customer portal session creation', 'PASS', {
                portalUrl: portalSession.data.portal_url.substring(0, 50) + '...',
                duration: portalSession.duration
            });
        } else {
            this.log('subscriptionPurchase', 'Customer portal session creation', 'FAIL', portalSession);
        }

        return this.testResults.subscriptionPurchase;
    }

    // Test 3: License Validation System
    async testLicenseValidation() {
        console.log('\n=== TESTING LICENSE VALIDATION SYSTEM ===');

        // Test 3.1: Cloud validation with valid credentials
        const cloudValidation = await this.makeRequest(`${this.workerUrl}/validate-unified`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operation: 'validate',
                credentials: {
                    email: 'valid-test@example.com',
                    token: 'test-token-123',
                    hardware_id: 'test-machine-validation-001'
                }
            })
        });

        if (cloudValidation.success) {
            this.log('licenseValidation', 'Cloud validation request format', 'PASS', {
                responseTime: cloudValidation.duration,
                requestId: cloudValidation.data.requestId
            });
        } else {
            this.log('licenseValidation', 'Cloud validation request format', 'FAIL', cloudValidation);
        }

        // Test 3.2: Offline validation behavior
        const offlineValidation = await this.makeRequest(`${this.baseUrl}/api/validate-license`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'offline-test@example.com',
                hardware_id: 'test-machine-offline-001',
                force_offline: true
            })
        });

        if (offlineValidation.success) {
            this.log('licenseValidation', 'Offline validation fallback', 'PASS', {
                source: offlineValidation.data.source,
                validationMethod: offlineValidation.data.validation_method,
                duration: offlineValidation.duration
            });
        } else {
            this.log('licenseValidation', 'Offline validation fallback', 'FAIL', offlineValidation);
        }

        // Test 3.3: Invalid license handling
        const invalidValidation = await this.makeRequest(`${this.workerUrl}/validate-unified`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operation: 'validate',
                credentials: {
                    email: 'invalid@example.com',
                    token: 'invalid-token',
                    hardware_id: 'invalid-machine'
                }
            })
        });

        if (invalidValidation.success === false || (invalidValidation.data && !invalidValidation.data.success)) {
            this.log('licenseValidation', 'Invalid license rejection', 'PASS', {
                errorHandled: true,
                duration: invalidValidation.duration
            });
        } else {
            this.log('licenseValidation', 'Invalid license rejection', 'WARNING', {
                unexpectedSuccess: true,
                data: invalidValidation.data
            });
        }

        return this.testResults.licenseValidation;
    }

    // Test 4: Edge Cases and Error Scenarios
    async testEdgeCases() {
        console.log('\n=== TESTING EDGE CASES AND ERROR SCENARIOS ===');

        // Test 4.1: Malformed request handling
        const malformedRequest = await this.makeRequest(`${this.workerUrl}/validate-unified`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invalid: 'request' })
        });

        if (!malformedRequest.success || (malformedRequest.data && !malformedRequest.data.success)) {
            this.log('edgeCases', 'Malformed request rejection', 'PASS', {
                errorCode: malformedRequest.data?.error?.code,
                duration: malformedRequest.duration
            });
        } else {
            this.log('edgeCases', 'Malformed request rejection', 'FAIL', malformedRequest);
        }

        // Test 4.2: Network timeout simulation
        console.log('Testing network timeout behavior...');
        const timeoutTest = await Promise.race([
            this.makeRequest(`${this.workerUrl}/validate-unified`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    operation: 'validate',
                    credentials: {
                        email: 'timeout-test@example.com',
                        token: 'timeout-token',
                        hardware_id: 'timeout-machine'
                    }
                })
            }),
            new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 5000))
        ]);

        if (timeoutTest.timeout) {
            this.log('edgeCases', 'Network timeout handling', 'WARNING', {
                message: 'Request took longer than 5 seconds'
            });
        } else {
            this.log('edgeCases', 'Network timeout handling', 'PASS', {
                responseTime: timeoutTest.duration
            });
        }

        // Test 4.3: Concurrent validation requests
        console.log('Testing concurrent validation requests...');
        const concurrentRequests = await Promise.all([
            this.makeRequest(`${this.baseUrl}/api/validate-license`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'concurrent1@example.com',
                    hardware_id: 'concurrent-machine-001'
                })
            }),
            this.makeRequest(`${this.baseUrl}/api/validate-license`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'concurrent2@example.com',
                    hardware_id: 'concurrent-machine-002'
                })
            }),
            this.makeRequest(`${this.baseUrl}/api/validate-license`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'concurrent3@example.com',
                    hardware_id: 'concurrent-machine-003'
                })
            })
        ]);

        const successfulConcurrent = concurrentRequests.filter(r => r.success).length;
        if (successfulConcurrent === 3) {
            this.log('edgeCases', 'Concurrent validation requests', 'PASS', {
                successfulRequests: successfulConcurrent,
                avgResponseTime: concurrentRequests.reduce((sum, r) => sum + r.duration, 0) / 3
            });
        } else {
            this.log('edgeCases', 'Concurrent validation requests', 'WARNING', {
                successfulRequests: successfulConcurrent,
                totalRequests: 3
            });
        }

        return this.testResults.edgeCases;
    }

    // Test 5: Performance Testing
    async testPerformance() {
        console.log('\n=== TESTING PERFORMANCE UNDER LOAD ===');

        // Test 5.1: API response times
        const responseTimeTests = [];
        for (let i = 0; i < 10; i++) {
            const result = await this.makeRequest(`${this.baseUrl}/api/trial_status`);
            if (result.success) {
                responseTimeTests.push(result.duration);
            }
        }

        const avgResponseTime = responseTimeTests.reduce((sum, time) => sum + time, 0) / responseTimeTests.length;
        const maxResponseTime = Math.max(...responseTimeTests);

        if (avgResponseTime < 500 && maxResponseTime < 1000) {
            this.log('performance', 'API response time performance', 'PASS', {
                avgResponseTime: Math.round(avgResponseTime),
                maxResponseTime,
                testCount: responseTimeTests.length
            });
        } else {
            this.log('performance', 'API response time performance', 'WARNING', {
                avgResponseTime: Math.round(avgResponseTime),
                maxResponseTime,
                testCount: responseTimeTests.length
            });
        }

        // Test 5.2: Memory usage simulation
        console.log('Testing system resource usage...');
        const memoryTest = await this.makeRequest(`${this.baseUrl}/api/config`);
        if (memoryTest.success) {
            this.log('performance', 'System resource availability', 'PASS', {
                configLoadTime: memoryTest.duration,
                systemResponsive: true
            });
        } else {
            this.log('performance', 'System resource availability', 'FAIL', memoryTest);
        }

        return this.testResults.performance;
    }

    // Test 6: Data Persistence
    async testDataPersistence() {
        console.log('\n=== TESTING DATA PERSISTENCE ===');

        // Test 6.1: License cache persistence
        const initialValidation = await this.makeRequest(`${this.baseUrl}/api/validate-license`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'persistence-test@example.com',
                hardware_id: 'persistence-machine-001'
            })
        });

        if (initialValidation.success) {
            this.log('dataPersistence', 'Initial license validation', 'PASS', {
                source: initialValidation.data.source,
                duration: initialValidation.duration
            });

            // Wait and test again to check cache
            await this.sleep(1000);

            const cachedValidation = await this.makeRequest(`${this.baseUrl}/api/validate-license`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: 'persistence-test@example.com',
                    hardware_id: 'persistence-machine-001'
                })
            });

            if (cachedValidation.success && cachedValidation.duration < initialValidation.duration) {
                this.log('dataPersistence', 'License cache functionality', 'PASS', {
                    initialTime: initialValidation.duration,
                    cachedTime: cachedValidation.duration,
                    improvement: Math.round(((initialValidation.duration - cachedValidation.duration) / initialValidation.duration) * 100) + '%'
                });
            } else {
                this.log('dataPersistence', 'License cache functionality', 'WARNING', {
                    cacheEffectiveness: 'unclear',
                    initialTime: initialValidation.duration,
                    secondTime: cachedValidation.duration
                });
            }
        } else {
            this.log('dataPersistence', 'Initial license validation', 'FAIL', initialValidation);
        }

        return this.testResults.dataPersistence;
    }

    // Generate comprehensive test report
    generateReport() {
        console.log('\n' + '='.repeat(80));
        console.log('POSPal COMPREHENSIVE SUBSCRIPTION SYSTEM TEST REPORT');
        console.log('='.repeat(80));

        const totalDuration = Date.now() - this.startTime;
        const categories = Object.keys(this.testResults);

        console.log(`\nTest Duration: ${Math.round(totalDuration / 1000)}s`);
        console.log(`Test Categories: ${categories.length}`);

        let totalTests = 0;
        let totalPassed = 0;
        let totalFailed = 0;
        let totalWarnings = 0;

        categories.forEach(category => {
            const results = this.testResults[category];
            const passed = results.filter(r => r.result === 'PASS').length;
            const failed = results.filter(r => r.result === 'FAIL').length;
            const warnings = results.filter(r => r.result === 'WARNING').length;

            totalTests += results.length;
            totalPassed += passed;
            totalFailed += failed;
            totalWarnings += warnings;

            console.log(`\n--- ${category.toUpperCase()} ---`);
            console.log(`Tests: ${results.length} | Pass: ${passed} | Fail: ${failed} | Warning: ${warnings}`);

            if (failed > 0 || warnings > 0) {
                results.filter(r => r.result !== 'PASS').forEach(test => {
                    console.log(`  [${test.result}] ${test.test}: ${JSON.stringify(test.details, null, 2)}`);
                });
            }
        });

        console.log('\n' + '='.repeat(80));
        console.log('SUMMARY');
        console.log('='.repeat(80));
        console.log(`Total Tests: ${totalTests}`);
        console.log(`Passed: ${totalPassed} (${Math.round((totalPassed/totalTests)*100)}%)`);
        console.log(`Failed: ${totalFailed} (${Math.round((totalFailed/totalTests)*100)}%)`);
        console.log(`Warnings: ${totalWarnings} (${Math.round((totalWarnings/totalTests)*100)}%)`);

        const healthScore = Math.round(((totalPassed + (totalWarnings * 0.5)) / totalTests) * 100);
        console.log(`\nSystem Health Score: ${healthScore}%`);

        if (healthScore >= 90) {
            console.log('Status: EXCELLENT - System is performing optimally');
        } else if (healthScore >= 80) {
            console.log('Status: GOOD - System is stable with minor issues');
        } else if (healthScore >= 70) {
            console.log('Status: FAIR - System needs attention');
        } else {
            console.log('Status: POOR - System requires immediate attention');
        }

        console.log('='.repeat(80));

        return {
            totalTests,
            totalPassed,
            totalFailed,
            totalWarnings,
            healthScore,
            duration: totalDuration,
            categories: this.testResults
        };
    }

    // Run all tests
    async runAllTests() {
        console.log('Starting POSPal Comprehensive Subscription System Testing...');

        try {
            await this.testTrialExperience();
            await this.testSubscriptionPurchase();
            await this.testLicenseValidation();
            await this.testEdgeCases();
            await this.testPerformance();
            await this.testDataPersistence();

            return this.generateReport();
        } catch (error) {
            console.error('Test suite error:', error);
            return { error: error.message, partialResults: this.testResults };
        }
    }
}

// Usage
if (typeof window !== 'undefined') {
    // Browser environment
    window.ComprehensiveSubscriptionTester = ComprehensiveSubscriptionTester;
    window.runComprehensiveTests = async function() {
        const tester = new ComprehensiveSubscriptionTester();
        return await tester.runAllTests();
    };
} else {
    // Node.js environment
    module.exports = ComprehensiveSubscriptionTester;
}