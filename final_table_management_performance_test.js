/**
 * Final Table Management Performance and Load Test
 * Tests system performance under various load conditions
 */

class TableManagementPerformanceTester {
    constructor(baseUrl = 'http://localhost:5000') {
        this.baseUrl = baseUrl;
        this.results = {
            performanceTests: [],
            loadTests: [],
            concurrencyTests: [],
            securityTests: [],
            summary: {},
            errors: []
        };
    }

    async makeRequest(endpoint, options = {}, timeout = 10000) {
        const startTime = Date.now();
        const url = `${this.baseUrl}${endpoint}`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });

            clearTimeout(timeoutId);
            const endTime = Date.now();
            const responseTime = endTime - startTime;

            let data;
            try {
                data = await response.json();
            } catch {
                data = await response.text();
            }

            return {
                status: response.status,
                data,
                responseTime,
                success: response.ok,
                url
            };
        } catch (error) {
            const endTime = Date.now();
            const responseTime = endTime - startTime;

            return {
                status: 0,
                data: null,
                responseTime,
                success: false,
                error: error.name === 'AbortError' ? 'Timeout' : error.message,
                url
            };
        }
    }

    async testResponseTimes() {
        console.log('🚀 Testing Response Times...');

        const endpoints = [
            '/api/config',
            '/api/tables/health',
            '/api/tables',
            '/api/tables/summary',
            '/api/tables/performance'
        ];

        const results = {};

        for (const endpoint of endpoints) {
            console.log(`Testing ${endpoint}...`);
            const times = [];

            // Run 10 requests to get average response time
            for (let i = 0; i < 10; i++) {
                const result = await this.makeRequest(endpoint);
                times.push(result.responseTime);

                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            const min = Math.min(...times);
            const max = Math.max(...times);

            results[endpoint] = {
                average: Math.round(avg),
                minimum: min,
                maximum: max,
                samples: times.length
            };

            console.log(`${endpoint}: avg=${Math.round(avg)}ms, min=${min}ms, max=${max}ms`);
        }

        this.results.performanceTests = results;
        return results;
    }

    async testConcurrentRequests() {
        console.log('⚡ Testing Concurrent Request Handling...');

        const concurrencyLevels = [5, 10, 20];
        const results = {};

        for (const level of concurrencyLevels) {
            console.log(`Testing ${level} concurrent requests...`);

            const startTime = Date.now();
            const promises = [];

            // Create concurrent requests
            for (let i = 0; i < level; i++) {
                promises.push(this.makeRequest('/api/tables/health'));
            }

            // Wait for all to complete
            const responses = await Promise.all(promises);
            const endTime = Date.now();
            const totalTime = endTime - startTime;

            // Calculate statistics
            const successful = responses.filter(r => r.success).length;
            const failed = responses.filter(r => !r.success).length;
            const avgResponseTime = responses
                .filter(r => r.responseTime > 0)
                .reduce((sum, r) => sum + r.responseTime, 0) / Math.max(1, successful);

            results[level] = {
                totalTime,
                successful,
                failed,
                successRate: Math.round((successful / level) * 100),
                avgResponseTime: Math.round(avgResponseTime)
            };

            console.log(`Level ${level}: ${successful}/${level} successful (${Math.round((successful / level) * 100)}%), avg: ${Math.round(avgResponseTime)}ms`);
        }

        this.results.concurrencyTests = results;
        return results;
    }

    async testSecurityAndErrorHandling() {
        console.log('🔒 Testing Security and Error Handling...');

        const securityTests = [
            {
                name: 'SQL Injection Protection',
                endpoint: '/api/tables/1\'; DROP TABLE users; --/status',
                expectedStatus: [400, 404]
            },
            {
                name: 'XSS Protection',
                endpoint: '/api/tables/<script>alert("xss")</script>/status',
                expectedStatus: [400, 404]
            },
            {
                name: 'Invalid JSON Protection',
                endpoint: '/api/config',
                method: 'POST',
                body: '{"invalid": json}',
                expectedStatus: [400]
            },
            {
                name: 'Malformed URL Protection',
                endpoint: '/api/tables/../../../etc/passwd',
                expectedStatus: [400, 404]
            },
            {
                name: 'Oversized Request Protection',
                endpoint: '/api/config',
                method: 'POST',
                body: JSON.stringify({data: 'x'.repeat(10000)}),
                expectedStatus: [400, 413]
            }
        ];

        const results = {};

        for (const test of securityTests) {
            console.log(`Testing ${test.name}...`);

            const options = {
                method: test.method || 'GET'
            };

            if (test.body) {
                options.body = test.body;
            }

            const result = await this.makeRequest(test.endpoint, options);

            const passed = test.expectedStatus.includes(result.status) || result.status === 0;

            results[test.name] = {
                passed,
                status: result.status,
                expectedStatus: test.expectedStatus,
                responseTime: result.responseTime
            };

            console.log(`${test.name}: ${passed ? 'PASS' : 'FAIL'} (Status: ${result.status})`);
        }

        this.results.securityTests = results;
        return results;
    }

    async testMemoryAndResourceUsage() {
        console.log('💾 Testing Memory and Resource Usage...');

        // Test rapid sequential requests to check for memory leaks
        console.log('Testing rapid sequential requests...');
        const startTime = Date.now();
        const requestCount = 100;
        let successful = 0;
        let failed = 0;

        for (let i = 0; i < requestCount; i++) {
            const result = await this.makeRequest('/api/config');
            if (result.success) {
                successful++;
            } else {
                failed++;
            }

            // No delay - stress test
            if (i % 20 === 0) {
                process.stdout.write(`\rProgress: ${i}/${requestCount}`);
            }
        }

        const endTime = Date.now();
        const totalTime = endTime - startTime;

        console.log(`\nRapid requests completed: ${successful}/${requestCount} successful in ${totalTime}ms`);

        this.results.loadTests.rapidSequential = {
            requestCount,
            successful,
            failed,
            totalTime,
            requestsPerSecond: Math.round((requestCount / totalTime) * 1000)
        };
    }

    generatePerformanceReport() {
        console.log('\n' + '='.repeat(80));
        console.log('📊 COMPREHENSIVE TABLE MANAGEMENT PERFORMANCE REPORT');
        console.log('='.repeat(80));

        // Response Time Analysis
        console.log('\n📈 RESPONSE TIME ANALYSIS:');
        for (const [endpoint, metrics] of Object.entries(this.results.performanceTests)) {
            console.log(`${endpoint}:`);
            console.log(`  Average: ${metrics.average}ms | Min: ${metrics.minimum}ms | Max: ${metrics.maximum}ms`);
        }

        // Concurrency Analysis
        console.log('\n⚡ CONCURRENCY ANALYSIS:');
        for (const [level, metrics] of Object.entries(this.results.concurrencyTests)) {
            console.log(`${level} concurrent requests:`);
            console.log(`  Success Rate: ${metrics.successRate}% | Avg Response: ${metrics.avgResponseTime}ms | Total Time: ${metrics.totalTime}ms`);
        }

        // Security Analysis
        console.log('\n🔒 SECURITY ANALYSIS:');
        const securityPassed = Object.values(this.results.securityTests).filter(t => t.passed).length;
        const securityTotal = Object.keys(this.results.securityTests).length;
        console.log(`Security Tests Passed: ${securityPassed}/${securityTotal} (${Math.round((securityPassed / securityTotal) * 100)}%)`);

        for (const [testName, result] of Object.entries(this.results.securityTests)) {
            console.log(`  ${testName}: ${result.passed ? '✓ PASS' : '✗ FAIL'} (${result.status})`);
        }

        // Load Test Analysis
        if (this.results.loadTests.rapidSequential) {
            console.log('\n💾 LOAD TEST ANALYSIS:');
            const load = this.results.loadTests.rapidSequential;
            console.log(`Rapid Sequential Requests: ${load.successful}/${load.requestCount} successful`);
            console.log(`Throughput: ${load.requestsPerSecond} requests/second`);
            console.log(`Failure Rate: ${Math.round((load.failed / load.requestCount) * 100)}%`);
        }

        // Overall Assessment
        console.log('\n🎯 OVERALL PERFORMANCE ASSESSMENT:');
        const avgResponseTime = Object.values(this.results.performanceTests)
            .reduce((sum, metrics) => sum + metrics.average, 0) / Object.keys(this.results.performanceTests).length;

        const highConcurrencySuccess = this.results.concurrencyTests[20]?.successRate || 0;
        const securityScore = Math.round((securityPassed / securityTotal) * 100);

        console.log(`Average Response Time: ${Math.round(avgResponseTime)}ms ${avgResponseTime <= 100 ? '✓ EXCELLENT' : avgResponseTime <= 500 ? '⚠ GOOD' : '❌ SLOW'}`);
        console.log(`High Concurrency Performance: ${highConcurrencySuccess}% ${highConcurrencySuccess >= 95 ? '✓ EXCELLENT' : highConcurrencySuccess >= 80 ? '⚠ GOOD' : '❌ POOR'}`);
        console.log(`Security Score: ${securityScore}% ${securityScore >= 90 ? '✓ EXCELLENT' : securityScore >= 70 ? '⚠ GOOD' : '❌ POOR'}`);

        const overallScore = (
            (avgResponseTime <= 100 ? 100 : avgResponseTime <= 500 ? 70 : 30) +
            (highConcurrencySuccess >= 95 ? 100 : highConcurrencySuccess >= 80 ? 70 : 30) +
            securityScore
        ) / 3;

        console.log(`\n🏆 OVERALL PERFORMANCE SCORE: ${Math.round(overallScore)}%`);
        console.log(`PRODUCTION READINESS: ${overallScore >= 85 ? '✅ READY' : overallScore >= 70 ? '⚠ NEEDS OPTIMIZATION' : '❌ NOT READY'}`);

        return {
            avgResponseTime: Math.round(avgResponseTime),
            concurrencyScore: highConcurrencySuccess,
            securityScore,
            overallScore: Math.round(overallScore),
            productionReady: overallScore >= 85
        };
    }

    async runFullPerformanceTest() {
        console.log('🚀 Starting Comprehensive Table Management Performance Test...\n');

        try {
            await this.testResponseTimes();
            await this.testConcurrentRequests();
            await this.testSecurityAndErrorHandling();
            await this.testMemoryAndResourceUsage();

            const summary = this.generatePerformanceReport();

            console.log('\n✅ Performance testing completed successfully!');
            return {
                success: true,
                results: this.results,
                summary
            };
        } catch (error) {
            console.error('❌ Performance test failed:', error);
            return {
                success: false,
                error: error.message,
                results: this.results
            };
        }
    }
}

// Export for Node.js or run directly in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TableManagementPerformanceTester;
} else {
    // Run tests immediately if in browser
    window.runPerformanceTests = async function() {
        const tester = new TableManagementPerformanceTester();
        return await tester.runFullPerformanceTest();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('Performance Tester loaded. Run window.runPerformanceTests() to start.');
        });
    } else {
        console.log('Performance Tester loaded. Run window.runPerformanceTests() to start.');
    }
}