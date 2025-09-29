/**
 * Comprehensive Table Management System Test Suite
 * Tests all 19+ table management endpoints and functionality
 */

class TableManagementTester {
    constructor(baseUrl = 'http://localhost:5000') {
        this.baseUrl = baseUrl;
        this.testResults = {
            passed: 0,
            failed: 0,
            total: 0,
            details: [],
            performance: {},
            errors: []
        };
        this.testStartTime = Date.now();
    }

    // Utility method for HTTP requests with performance tracking
    async makeRequest(endpoint, options = {}) {
        const startTime = Date.now();
        const url = `${this.baseUrl}${endpoint}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });

            const endTime = Date.now();
            const responseTime = endTime - startTime;

            // Track performance
            if (!this.testResults.performance[endpoint]) {
                this.testResults.performance[endpoint] = [];
            }
            this.testResults.performance[endpoint].push(responseTime);

            const data = await response.json();
            return {
                status: response.status,
                data,
                responseTime,
                success: response.ok
            };
        } catch (error) {
            const endTime = Date.now();
            const responseTime = endTime - startTime;

            this.testResults.errors.push({
                endpoint,
                error: error.message,
                timestamp: new Date().toISOString()
            });

            return {
                status: 0,
                data: null,
                responseTime,
                success: false,
                error: error.message
            };
        }
    }

    // Test result tracking
    logTest(testName, passed, details = '', responseTime = 0) {
        this.testResults.total++;
        if (passed) {
            this.testResults.passed++;
        } else {
            this.testResults.failed++;
        }

        this.testResults.details.push({
            test: testName,
            status: passed ? 'PASS' : 'FAIL',
            details,
            responseTime: `${responseTime}ms`,
            timestamp: new Date().toISOString()
        });

        console.log(`${passed ? '✓' : '✗'} ${testName} (${responseTime}ms) - ${details}`);
    }

    // === CONFIGURATION TESTS ===
    async testConfigurationEndpoints() {
        console.log('\n=== CONFIGURATION TESTS ===');

        // Test 1: Get current configuration
        const configResult = await this.makeRequest('/api/config');
        this.logTest(
            'GET /api/config',
            configResult.success && configResult.data.hasOwnProperty('app'),
            `Status: ${configResult.status}, Has app config: ${configResult.data?.app ? 'Yes' : 'No'}`,
            configResult.responseTime
        );

        // Test 2: Check table management enabled status
        const tableEnabled = configResult.data?.table_management_enabled;
        this.logTest(
            'Table Management Enabled Check',
            tableEnabled === true,
            `Table management enabled: ${tableEnabled}`,
            0
        );

        // Test 3: Toggle table management (disable then re-enable)
        const disableResult = await this.makeRequest('/api/config', {
            method: 'POST',
            body: JSON.stringify({ table_management_enabled: false })
        });
        this.logTest(
            'POST /api/config (disable table management)',
            disableResult.success && disableResult.data?.table_management_enabled === false,
            `Status: ${disableResult.status}, Table management disabled: ${disableResult.success}`,
            disableResult.responseTime
        );

        // Test 4: Re-enable table management
        const enableResult = await this.makeRequest('/api/config', {
            method: 'POST',
            body: JSON.stringify({ table_management_enabled: true })
        });
        this.logTest(
            'POST /api/config (re-enable table management)',
            enableResult.success && enableResult.data?.table_management_enabled === true,
            `Status: ${enableResult.status}, Table management re-enabled: ${enableResult.success}`,
            enableResult.responseTime
        );
    }

    // === TABLE MANAGEMENT CORE TESTS ===
    async testTableManagementEndpoints() {
        console.log('\n=== TABLE MANAGEMENT CORE TESTS ===');

        // Test 5: Get all tables
        const tablesResult = await this.makeRequest('/api/tables');
        this.logTest(
            'GET /api/tables',
            tablesResult.success && Array.isArray(tablesResult.data?.tables) || typeof tablesResult.data?.tables === 'object',
            `Status: ${tablesResult.status}, Has tables: ${tablesResult.data?.tables ? 'Yes' : 'No'}`,
            tablesResult.responseTime
        );

        // Test 6: Table configuration
        const configTablesResult = await this.makeRequest('/api/tables/configure', {
            method: 'POST',
            body: JSON.stringify({
                tables: {
                    "test1": { name: "Test Table 1", seats: 4, status: "available" },
                    "test2": { name: "Test Table 2", seats: 2, status: "available" }
                }
            })
        });
        this.logTest(
            'POST /api/tables/configure',
            configTablesResult.success,
            `Status: ${configTablesResult.status}, Configuration updated: ${configTablesResult.success}`,
            configTablesResult.responseTime
        );

        // Test 7: Get specific table status
        const tableStatusResult = await this.makeRequest('/api/tables/1/status');
        this.logTest(
            'GET /api/tables/{id}/status',
            tableStatusResult.success,
            `Status: ${tableStatusResult.status}, Table status retrieved: ${tableStatusResult.success}`,
            tableStatusResult.responseTime
        );

        // Test 8: Update table status
        const updateStatusResult = await this.makeRequest('/api/tables/1/status', {
            method: 'POST',
            body: JSON.stringify({ status: 'occupied' })
        });
        this.logTest(
            'POST /api/tables/{id}/status',
            updateStatusResult.success,
            `Status: ${updateStatusResult.status}, Status updated: ${updateStatusResult.success}`,
            updateStatusResult.responseTime
        );
    }

    // === TABLE SESSION TESTS ===
    async testTableSessionEndpoints() {
        console.log('\n=== TABLE SESSION TESTS ===');

        // Test 9: Get table session
        const sessionResult = await this.makeRequest('/api/tables/1/session');
        this.logTest(
            'GET /api/tables/{id}/session',
            sessionResult.success,
            `Status: ${sessionResult.status}, Session data: ${sessionResult.success}`,
            sessionResult.responseTime
        );

        // Test 10: Open table
        const openResult = await this.makeRequest('/api/tables/2/open', {
            method: 'POST',
            body: JSON.stringify({ party_size: 2 })
        });
        this.logTest(
            'POST /api/tables/{id}/open',
            openResult.success,
            `Status: ${openResult.status}, Table opened: ${openResult.success}`,
            openResult.responseTime
        );

        // Test 11: Close table
        const closeResult = await this.makeRequest('/api/tables/2/close', {
            method: 'POST'
        });
        this.logTest(
            'POST /api/tables/{id}/close',
            closeResult.success,
            `Status: ${closeResult.status}, Table closed: ${closeResult.success}`,
            closeResult.responseTime
        );

        // Test 12: Clear table
        const clearResult = await this.makeRequest('/api/tables/2/clear', {
            method: 'POST'
        });
        this.logTest(
            'POST /api/tables/{id}/clear',
            clearResult.success,
            `Status: ${clearResult.status}, Table cleared: ${clearResult.success}`,
            clearResult.responseTime
        );
    }

    // === BILLING AND PAYMENT TESTS ===
    async testBillingAndPaymentEndpoints() {
        console.log('\n=== BILLING AND PAYMENT TESTS ===');

        // Test 13: Get table bill
        const billResult = await this.makeRequest('/api/tables/1/bill');
        this.logTest(
            'GET /api/tables/{id}/bill',
            billResult.success,
            `Status: ${billResult.status}, Bill generated: ${billResult.success}`,
            billResult.responseTime
        );

        // Test 14: Add payment
        const paymentResult = await this.makeRequest('/api/tables/1/add-payment', {
            method: 'POST',
            body: JSON.stringify({
                amount: 25.50,
                method: 'cash',
                reference: 'TEST_PAYMENT_001'
            })
        });
        this.logTest(
            'POST /api/tables/{id}/add-payment',
            paymentResult.success,
            `Status: ${paymentResult.status}, Payment added: ${paymentResult.success}`,
            paymentResult.responseTime
        );

        // Test 15: Get table payments
        const paymentsResult = await this.makeRequest('/api/tables/1/payments');
        this.logTest(
            'GET /api/tables/{id}/payments',
            paymentsResult.success,
            `Status: ${paymentsResult.status}, Payments retrieved: ${paymentsResult.success}`,
            paymentsResult.responseTime
        );

        // Test 16: Split bill
        const splitBillResult = await this.makeRequest('/api/tables/1/split-bill', {
            method: 'POST',
            body: JSON.stringify({
                split_type: 'equal',
                parts: 2
            })
        });
        this.logTest(
            'POST /api/tables/{id}/split-bill',
            splitBillResult.success,
            `Status: ${splitBillResult.status}, Bill split: ${splitBillResult.success}`,
            splitBillResult.responseTime
        );
    }

    // === PRINTING TESTS ===
    async testPrintingEndpoints() {
        console.log('\n=== PRINTING TESTS ===');

        // Test 17: Print table bill
        const printBillResult = await this.makeRequest('/api/tables/1/print-bill', {
            method: 'POST'
        });
        this.logTest(
            'POST /api/tables/{id}/print-bill',
            printBillResult.success,
            `Status: ${printBillResult.status}, Bill printed: ${printBillResult.success}`,
            printBillResult.responseTime
        );

        // Test 18: Print customer receipt
        const printReceiptResult = await this.makeRequest('/api/tables/1/print-customer-receipt', {
            method: 'POST',
            body: JSON.stringify({
                payment_id: 'TEST_PAYMENT_001'
            })
        });
        this.logTest(
            'POST /api/tables/{id}/print-customer-receipt',
            printReceiptResult.success,
            `Status: ${printReceiptResult.status}, Receipt printed: ${printReceiptResult.success}`,
            printReceiptResult.responseTime
        );
    }

    // === ADVANCED FEATURES TESTS ===
    async testAdvancedFeatures() {
        console.log('\n=== ADVANCED FEATURES TESTS ===');

        // Test 19: Table history
        const historyResult = await this.makeRequest('/api/tables/history/2025-09-28');
        this.logTest(
            'GET /api/tables/history/{date}',
            historyResult.success,
            `Status: ${historyResult.status}, History retrieved: ${historyResult.success}`,
            historyResult.responseTime
        );

        // Test 20: Recalculate table total
        const recalcResult = await this.makeRequest('/api/tables/1/recalculate', {
            method: 'POST'
        });
        this.logTest(
            'POST /api/tables/{id}/recalculate',
            recalcResult.success,
            `Status: ${recalcResult.status}, Total recalculated: ${recalcResult.success}`,
            recalcResult.responseTime
        );

        // Test 21: Table suggestions
        const suggestResult = await this.makeRequest('/api/tables/suggest?party_size=4');
        this.logTest(
            'GET /api/tables/suggest',
            suggestResult.success,
            `Status: ${suggestResult.status}, Suggestions provided: ${suggestResult.success}`,
            suggestResult.responseTime
        );

        // Test 22: Health check
        const healthResult = await this.makeRequest('/api/tables/health');
        this.logTest(
            'GET /api/tables/health',
            healthResult.success && healthResult.data?.table_management_enabled === true,
            `Status: ${healthResult.status}, Health: ${healthResult.data?.status || 'unknown'}`,
            healthResult.responseTime
        );

        // Test 23: Add new table
        const addTableResult = await this.makeRequest('/api/tables/add', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Test Table New',
                seats: 6,
                section: 'test'
            })
        });
        this.logTest(
            'POST /api/tables/add',
            addTableResult.success,
            `Status: ${addTableResult.status}, Table added: ${addTableResult.success}`,
            addTableResult.responseTime
        );

        // Test 24: Bulk clear tables
        const bulkClearResult = await this.makeRequest('/api/tables/bulk-clear', {
            method: 'POST',
            body: JSON.stringify({
                table_ids: ['2', '3']
            })
        });
        this.logTest(
            'POST /api/tables/bulk-clear',
            bulkClearResult.success,
            `Status: ${bulkClearResult.status}, Tables bulk cleared: ${bulkClearResult.success}`,
            bulkClearResult.responseTime
        );

        // Test 25: Table summary
        const summaryResult = await this.makeRequest('/api/tables/summary');
        this.logTest(
            'GET /api/tables/summary',
            summaryResult.success,
            `Status: ${summaryResult.status}, Summary generated: ${summaryResult.success}`,
            summaryResult.responseTime
        );

        // Test 26: Integrity check
        const integrityResult = await this.makeRequest('/api/tables/integrity-check');
        this.logTest(
            'GET /api/tables/integrity-check',
            integrityResult.success,
            `Status: ${integrityResult.status}, Integrity check: ${integrityResult.data?.status || 'unknown'}`,
            integrityResult.responseTime
        );

        // Test 27: System cleanup
        const cleanupResult = await this.makeRequest('/api/tables/cleanup', {
            method: 'POST'
        });
        this.logTest(
            'POST /api/tables/cleanup',
            cleanupResult.success,
            `Status: ${cleanupResult.status}, Cleanup completed: ${cleanupResult.success}`,
            cleanupResult.responseTime
        );

        // Test 28: Performance metrics
        const perfResult = await this.makeRequest('/api/tables/performance');
        this.logTest(
            'GET /api/tables/performance',
            perfResult.success,
            `Status: ${perfResult.status}, Performance metrics: ${perfResult.success}`,
            perfResult.responseTime
        );
    }

    // === ERROR CONDITION TESTS ===
    async testErrorConditions() {
        console.log('\n=== ERROR CONDITION TESTS ===');

        // Test 29: Invalid table ID
        const invalidTableResult = await this.makeRequest('/api/tables/999/status');
        this.logTest(
            'GET /api/tables/invalid-id/status',
            invalidTableResult.status === 404 || invalidTableResult.status === 400,
            `Status: ${invalidTableResult.status}, Correctly handles invalid ID: ${invalidTableResult.status >= 400}`,
            invalidTableResult.responseTime
        );

        // Test 30: Malformed request body
        const malformedResult = await this.makeRequest('/api/tables/1/add-payment', {
            method: 'POST',
            body: 'invalid json'
        });
        this.logTest(
            'POST with malformed JSON',
            malformedResult.status >= 400,
            `Status: ${malformedResult.status}, Correctly rejects malformed data: ${malformedResult.status >= 400}`,
            malformedResult.responseTime
        );
    }

    // === PERFORMANCE ANALYSIS ===
    calculatePerformanceMetrics() {
        const metrics = {};

        for (const [endpoint, times] of Object.entries(this.testResults.performance)) {
            const validTimes = times.filter(t => t > 0);
            if (validTimes.length > 0) {
                metrics[endpoint] = {
                    avg: Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length),
                    min: Math.min(...validTimes),
                    max: Math.max(...validTimes),
                    count: validTimes.length
                };
            }
        }

        return metrics;
    }

    // === MAIN TEST RUNNER ===
    async runAllTests() {
        console.log('🚀 Starting Comprehensive Table Management System Tests...\n');

        try {
            await this.testConfigurationEndpoints();
            await this.testTableManagementEndpoints();
            await this.testTableSessionEndpoints();
            await this.testBillingAndPaymentEndpoints();
            await this.testPrintingEndpoints();
            await this.testAdvancedFeatures();
            await this.testErrorConditions();

            const totalTime = Date.now() - this.testStartTime;
            const performanceMetrics = this.calculatePerformanceMetrics();

            // Generate final report
            console.log('\n' + '='.repeat(70));
            console.log('📊 TABLE MANAGEMENT SYSTEM TEST REPORT');
            console.log('='.repeat(70));
            console.log(`Total Tests: ${this.testResults.total}`);
            console.log(`Passed: ${this.testResults.passed} (${Math.round(this.testResults.passed/this.testResults.total*100)}%)`);
            console.log(`Failed: ${this.testResults.failed} (${Math.round(this.testResults.failed/this.testResults.total*100)}%)`);
            console.log(`Total Test Time: ${totalTime}ms`);
            console.log(`Average Test Time: ${Math.round(totalTime/this.testResults.total)}ms`);

            console.log('\n📈 PERFORMANCE METRICS:');
            for (const [endpoint, metrics] of Object.entries(performanceMetrics)) {
                console.log(`${endpoint}: avg=${metrics.avg}ms, min=${metrics.min}ms, max=${metrics.max}ms (${metrics.count} calls)`);
            }

            if (this.testResults.errors.length > 0) {
                console.log('\n🚨 ERRORS ENCOUNTERED:');
                this.testResults.errors.forEach(error => {
                    console.log(`${error.endpoint}: ${error.error}`);
                });
            }

            console.log('\n📋 DETAILED TEST RESULTS:');
            this.testResults.details.forEach(detail => {
                console.log(`${detail.status} | ${detail.test} | ${detail.responseTime} | ${detail.details}`);
            });

            // Overall system assessment
            const passRate = this.testResults.passed / this.testResults.total;
            const avgResponseTime = Object.values(performanceMetrics).reduce((sum, m) => sum + m.avg, 0) / Object.keys(performanceMetrics).length;

            console.log('\n🎯 PRODUCTION READINESS ASSESSMENT:');
            console.log(`Pass Rate: ${Math.round(passRate * 100)}% ${passRate >= 0.95 ? '✓ EXCELLENT' : passRate >= 0.85 ? '⚠ GOOD' : '❌ NEEDS IMPROVEMENT'}`);
            console.log(`Avg Response Time: ${Math.round(avgResponseTime)}ms ${avgResponseTime <= 200 ? '✓ EXCELLENT' : avgResponseTime <= 500 ? '⚠ ACCEPTABLE' : '❌ SLOW'}`);
            console.log(`Error Rate: ${Math.round(this.testResults.errors.length / this.testResults.total * 100)}% ${this.testResults.errors.length === 0 ? '✓ EXCELLENT' : this.testResults.errors.length <= 2 ? '⚠ ACCEPTABLE' : '❌ HIGH'}`);

            const overallStatus = passRate >= 0.95 && avgResponseTime <= 500 && this.testResults.errors.length <= 2;
            console.log(`\n🏆 OVERALL STATUS: ${overallStatus ? '✓ PRODUCTION READY' : '⚠ NEEDS ATTENTION'}`);

            return {
                success: true,
                results: this.testResults,
                performance: performanceMetrics,
                productionReady: overallStatus,
                summary: {
                    passRate: Math.round(passRate * 100),
                    avgResponseTime: Math.round(avgResponseTime),
                    errorCount: this.testResults.errors.length,
                    totalTime: totalTime
                }
            };

        } catch (error) {
            console.error('❌ Test suite failed:', error);
            return {
                success: false,
                error: error.message,
                results: this.testResults
            };
        }
    }
}

// Export for Node.js or run directly in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TableManagementTester;
} else {
    // Run tests immediately if in browser
    window.runTableManagementTests = async function() {
        const tester = new TableManagementTester();
        return await tester.runAllTests();
    };

    // Auto-run if page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('Table Management Tester loaded. Run window.runTableManagementTests() to start.');
        });
    } else {
        console.log('Table Management Tester loaded. Run window.runTableManagementTests() to start.');
    }
}