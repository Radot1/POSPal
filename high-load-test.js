/**
 * High-Load Testing for POSPal System
 * Tests system behavior under extreme load conditions
 */

const FLASK_BASE_URL = 'http://localhost:5000';

class HighLoadTester {
    constructor() {
        this.results = {
            load_tests: {},
            stress_tests: {},
            endurance_tests: {},
            breaking_point: null,
            performance_degradation: []
        };
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const colors = {
            info: '\x1b[36m',    
            success: '\x1b[32m', 
            error: '\x1b[31m',   
            warning: '\x1b[33m', 
            load: '\x1b[95m',    // Bright Magenta
            reset: '\x1b[0m'     
        };
        console.log(`${colors[type]}[${timestamp}] ${message}${colors.reset}`);
    }

    async sendConcurrentRequests(url, concurrency, duration = 10000) {
        const results = {
            total_requests: 0,
            successful_requests: 0,
            failed_requests: 0,
            response_times: [],
            errors: [],
            requests_per_second: 0,
            start_time: Date.now(),
            end_time: null
        };

        const requests = [];
        const startTime = Date.now();
        
        // Generate requests for the duration
        while (Date.now() - startTime < duration) {
            // Launch concurrent requests
            for (let i = 0; i < concurrency; i++) {
                const requestStart = Date.now();
                const promise = fetch(url)
                    .then(response => {
                        const responseTime = Date.now() - requestStart;
                        results.response_times.push(responseTime);
                        
                        if (response.ok) {
                            results.successful_requests++;
                        } else {
                            results.failed_requests++;
                        }
                        results.total_requests++;
                    })
                    .catch(error => {
                        results.errors.push(error.message);
                        results.failed_requests++;
                        results.total_requests++;
                    });
                
                requests.push(promise);
            }
            
            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Wait for all requests to complete
        await Promise.allSettled(requests);
        
        results.end_time = Date.now();
        const totalDuration = (results.end_time - results.start_time) / 1000;
        results.requests_per_second = results.total_requests / totalDuration;
        
        // Calculate response time statistics
        if (results.response_times.length > 0) {
            results.response_times.sort((a, b) => a - b);
            results.min_response_time = results.response_times[0];
            results.max_response_time = results.response_times[results.response_times.length - 1];
            results.avg_response_time = results.response_times.reduce((a, b) => a + b) / results.response_times.length;
            results.p50_response_time = results.response_times[Math.floor(results.response_times.length * 0.5)];
            results.p95_response_time = results.response_times[Math.floor(results.response_times.length * 0.95)];
            results.p99_response_time = results.response_times[Math.floor(results.response_times.length * 0.99)];
        }

        return results;
    }

    async testLoadScenarios() {
        this.log('🔥 Testing High-Load Scenarios', 'load');
        
        const scenarios = [
            { name: 'Normal Load', concurrency: 10, duration: 5000 },
            { name: 'Heavy Load', concurrency: 50, duration: 8000 },
            { name: 'Extreme Load', concurrency: 100, duration: 10000 },
            { name: 'Stress Test', concurrency: 200, duration: 12000 }
        ];

        const testUrl = `${FLASK_BASE_URL}/api/config`;

        for (const scenario of scenarios) {
            this.log(`Testing ${scenario.name}: ${scenario.concurrency} concurrent for ${scenario.duration/1000}s`, 'info');
            
            const results = await this.sendConcurrentRequests(
                testUrl,
                scenario.concurrency,
                scenario.duration
            );
            
            this.results.load_tests[scenario.name] = results;
            
            // Log results
            this.log(`✓ ${scenario.name} Results:`, 'success');
            this.log(`  Total: ${results.total_requests} req, Success: ${results.successful_requests}, Failed: ${results.failed_requests}`, 'info');
            this.log(`  RPS: ${results.requests_per_second.toFixed(2)}, Avg: ${results.avg_response_time?.toFixed(2)}ms, P95: ${results.p95_response_time?.toFixed(2)}ms`, 'info');
            
            // Check for performance degradation
            if (results.avg_response_time > 1000) {
                this.results.performance_degradation.push({
                    scenario: scenario.name,
                    issue: 'High average response time',
                    value: `${results.avg_response_time.toFixed(2)}ms`,
                    severity: results.avg_response_time > 2000 ? 'critical' : 'high'
                });
            }
            
            if (results.failed_requests / results.total_requests > 0.05) {
                this.results.performance_degradation.push({
                    scenario: scenario.name,
                    issue: 'High failure rate',
                    value: `${((results.failed_requests / results.total_requests) * 100).toFixed(2)}%`,
                    severity: 'critical'
                });
            }
            
            // Brief pause between tests
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    async findBreakingPoint() {
        this.log('💥 Finding System Breaking Point', 'load');
        
        const testUrl = `${FLASK_BASE_URL}/api/config`;
        let concurrency = 50;
        let maxSuccessfulConcurrency = 0;
        
        while (concurrency <= 500) {
            this.log(`Testing breaking point at ${concurrency} concurrent requests`, 'info');
            
            const results = await this.sendConcurrentRequests(testUrl, concurrency, 5000);
            
            const errorRate = results.failed_requests / results.total_requests;
            const avgResponseTime = results.avg_response_time || 0;
            
            // Define "breaking point" as >10% error rate or >5s avg response time
            if (errorRate > 0.1 || avgResponseTime > 5000) {
                this.results.breaking_point = {
                    concurrency: concurrency,
                    error_rate: (errorRate * 100).toFixed(2),
                    avg_response_time: avgResponseTime.toFixed(2),
                    total_requests: results.total_requests,
                    failed_requests: results.failed_requests
                };
                
                this.log(`💥 Breaking point found at ${concurrency} concurrent requests`, 'warning');
                this.log(`  Error rate: ${(errorRate * 100).toFixed(2)}%, Avg response: ${avgResponseTime.toFixed(2)}ms`, 'warning');
                break;
            } else {
                maxSuccessfulConcurrency = concurrency;
                this.log(`✓ Handled ${concurrency} concurrent successfully`, 'success');
            }
            
            concurrency += 50;
            
            // Brief pause
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (!this.results.breaking_point) {
            this.log(`✅ No breaking point found up to ${concurrency - 50} concurrent requests`, 'success');
            this.results.breaking_point = {
                concurrency: `${maxSuccessfulConcurrency}+`,
                note: 'System handled maximum tested load without breaking'
            };
        }
    }

    async testEnduranceScenario() {
        this.log('⏰ Testing System Endurance (Sustained Load)', 'load');
        
        const testUrl = `${FLASK_BASE_URL}/api/config`;
        const concurrency = 25;
        const duration = 30000; // 30 seconds of sustained load
        
        this.log(`Running sustained load: ${concurrency} concurrent for ${duration/1000} seconds`, 'info');
        
        const results = await this.sendConcurrentRequests(testUrl, concurrency, duration);
        
        this.results.endurance_tests['sustained_load'] = results;
        
        // Analyze endurance performance
        const timeChunks = this.analyzePerformanceOverTime(results.response_times);
        
        this.log(`✓ Endurance Test Results:`, 'success');
        this.log(`  Total: ${results.total_requests} requests over ${duration/1000}s`, 'info');
        this.log(`  Average RPS: ${results.requests_per_second.toFixed(2)}`, 'info');
        this.log(`  Performance consistency: ${this.analyzeConsistency(timeChunks)}`, 'info');
        
        return results;
    }

    analyzePerformanceOverTime(responseTimes) {
        // Split response times into chunks to analyze performance over time
        const chunkSize = Math.floor(responseTimes.length / 10);
        const chunks = [];
        
        for (let i = 0; i < responseTimes.length; i += chunkSize) {
            const chunk = responseTimes.slice(i, i + chunkSize);
            if (chunk.length > 0) {
                const avg = chunk.reduce((a, b) => a + b) / chunk.length;
                chunks.push(avg);
            }
        }
        
        return chunks;
    }

    analyzeConsistency(performanceChunks) {
        if (performanceChunks.length < 2) return 'Insufficient data';
        
        const firstHalf = performanceChunks.slice(0, Math.floor(performanceChunks.length / 2));
        const secondHalf = performanceChunks.slice(Math.floor(performanceChunks.length / 2));
        
        const firstAvg = firstHalf.reduce((a, b) => a + b) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b) / secondHalf.length;
        
        const degradation = ((secondAvg - firstAvg) / firstAvg) * 100;
        
        if (Math.abs(degradation) < 10) {
            return 'Stable performance';
        } else if (degradation > 10) {
            return `Performance degraded by ${degradation.toFixed(1)}%`;
        } else {
            return `Performance improved by ${Math.abs(degradation).toFixed(1)}%`;
        }
    }

    async runHighLoadTests() {
        this.log('🎯 Starting High-Load Testing Suite', 'load');
        this.log('=' .repeat(60), 'info');
        
        const startTime = Date.now();
        
        try {
            await this.testLoadScenarios();
            await this.findBreakingPoint();
            await this.testEnduranceScenario();
            
            this.generateLoadReport();
            
        } catch (error) {
            this.log(`❌ High-load testing failed: ${error.message}`, 'error');
            throw error;
        }
        
        const duration = (Date.now() - startTime) / 1000;
        this.log(`⏱️ High-load testing completed in ${duration.toFixed(2)} seconds`, 'success');
        
        return this.results;
    }

    generateLoadReport() {
        this.log('📊 High-Load Test Report', 'load');
        this.log('=' .repeat(60), 'info');
        
        // Load test summary
        const loadTests = Object.entries(this.results.load_tests);
        this.log(`📈 LOAD TEST SUMMARY:`, 'info');
        
        loadTests.forEach(([name, results]) => {
            const successRate = ((results.successful_requests / results.total_requests) * 100).toFixed(1);
            this.log(`  ${name}: ${results.requests_per_second.toFixed(1)} RPS, ${successRate}% success, ${results.avg_response_time?.toFixed(1)}ms avg`, 'info');
        });
        
        // Breaking point analysis
        if (this.results.breaking_point) {
            this.log(`\n💥 BREAKING POINT ANALYSIS:`, 'warning');
            if (typeof this.results.breaking_point.concurrency === 'number') {
                this.log(`  System breaks at: ${this.results.breaking_point.concurrency} concurrent requests`, 'warning');
                this.log(`  Error rate at breaking point: ${this.results.breaking_point.error_rate}%`, 'warning');
                this.log(`  Response time at breaking point: ${this.results.breaking_point.avg_response_time}ms`, 'warning');
            } else {
                this.log(`  ✅ ${this.results.breaking_point.note}`, 'success');
            }
        }
        
        // Performance degradation issues
        if (this.results.performance_degradation.length > 0) {
            this.log(`\n⚠️ PERFORMANCE ISSUES FOUND:`, 'warning');
            this.results.performance_degradation.forEach((issue, index) => {
                const severity = issue.severity === 'critical' ? '🔴' : '🟡';
                this.log(`  ${index + 1}. ${severity} ${issue.scenario}: ${issue.issue} (${issue.value})`, 'warning');
            });
        } else {
            this.log(`\n✅ NO CRITICAL PERFORMANCE ISSUES FOUND`, 'success');
        }
        
        // Final verdict
        this.log(`\n🎯 HIGH-LOAD VERDICT:`, 'load');
        const criticalIssues = this.results.performance_degradation.filter(i => i.severity === 'critical').length;
        const highIssues = this.results.performance_degradation.filter(i => i.severity === 'high').length;
        
        if (criticalIssues === 0 && highIssues === 0) {
            this.log(`   ✅ EXCELLENT LOAD HANDLING - System performs well under high load`, 'success');
        } else if (criticalIssues === 0) {
            this.log(`   ⚠️ GOOD WITH OPTIMIZATIONS - Address high priority issues for best performance`, 'warning');
        } else {
            this.log(`   ❌ LOAD HANDLING ISSUES - Critical performance problems under high load`, 'error');
        }
    }
}

// Export and auto-run
if (typeof module !== 'undefined') {
    module.exports = HighLoadTester;
}

if (typeof require !== 'undefined' && require.main === module) {
    const tester = new HighLoadTester();
    tester.runHighLoadTests().catch(console.error);
}