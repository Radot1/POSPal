/**
 * Performance Test Suite for POSPal System
 * Tests performance across Flask, Cloudflare Workers, and database operations
 */

const FLASK_BASE_URL = 'http://localhost:5000';
const WORKERS_BASE_URL = 'https://pospal-licensing-v2-production.bzoumboulis.workers.dev';

class PerformanceTester {
    constructor() {
        this.results = {
            flask_endpoints: {},
            workers_endpoints: {},
            database_operations: {},
            load_tests: {},
            bottlenecks: [],
            recommendations: []
        };
        this.startTime = Date.now();
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const colors = {
            info: '\x1b[36m',    // Cyan
            success: '\x1b[32m', // Green  
            error: '\x1b[31m',   // Red
            warning: '\x1b[33m', // Yellow
            perf: '\x1b[35m',    // Magenta
            reset: '\x1b[0m'     // Reset
        };
        console.log(`${colors[type]}[${timestamp}] ${message}${colors.reset}`);
    }

    async measureEndpointPerformance(url, method = 'GET', payload = null, samples = 10) {
        const times = [];
        const errors = [];
        
        for (let i = 0; i < samples; i++) {
            const start = performance.now();
            try {
                const options = {
                    method,
                    headers: { 'Content-Type': 'application/json' }
                };
                
                if (payload && method !== 'GET') {
                    options.body = JSON.stringify(payload);
                }
                
                const response = await fetch(url, options);
                const end = performance.now();
                const responseTime = end - start;
                
                times.push({
                    time: responseTime,
                    status: response.status,
                    size: parseInt(response.headers.get('content-length') || '0')
                });
                
                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                const end = performance.now();
                times.push({
                    time: end - start,
                    error: error.message
                });
                errors.push(error.message);
            }
        }
        
        // Calculate statistics
        const validTimes = times.filter(t => !t.error).map(t => t.time);
        const stats = {
            samples: samples,
            successful: validTimes.length,
            failed: errors.length,
            min: Math.min(...validTimes),
            max: Math.max(...validTimes),
            avg: validTimes.reduce((a, b) => a + b, 0) / validTimes.length,
            median: validTimes.sort()[Math.floor(validTimes.length / 2)],
            p95: validTimes.sort()[Math.floor(validTimes.length * 0.95)],
            p99: validTimes.sort()[Math.floor(validTimes.length * 0.99)],
            errors: errors
        };
        
        return stats;
    }

    async testFlaskEndpoints() {
        this.log('🚀 Testing Flask Endpoints Performance', 'perf');
        
        const endpoints = [
            { path: '/api/config', method: 'GET' },
            { path: '/api/trial_status', method: 'GET' },
            { path: '/api/usage_analytics', method: 'GET' },
            { 
                path: '/api/create-subscription-session', 
                method: 'POST',
                payload: {
                    customerName: 'Performance Test',
                    customerEmail: 'perf@test.com',
                    hardwareId: 'PERF-TEST-12345-ABCDE-67890'
                }
            },
            {
                path: '/api/create-portal-session',
                method: 'POST', 
                payload: { customerEmail: 'perf@test.com' }
            },
            {
                path: '/api/validate-license',
                method: 'POST',
                payload: {
                    unlockToken: 'perf-test-token',
                    hardwareId: 'PERF-TEST-12345-ABCDE-67890'
                }
            }
        ];
        
        for (const endpoint of endpoints) {
            const url = `${FLASK_BASE_URL}${endpoint.path}`;
            this.log(`Testing ${endpoint.method} ${endpoint.path}`, 'info');
            
            const stats = await this.measureEndpointPerformance(
                url, 
                endpoint.method, 
                endpoint.payload
            );
            
            this.results.flask_endpoints[endpoint.path] = stats;
            
            // Performance analysis
            if (stats.avg > 1000) {
                this.results.bottlenecks.push({
                    component: 'Flask',
                    endpoint: endpoint.path,
                    issue: 'High average response time',
                    value: `${stats.avg.toFixed(2)}ms`,
                    severity: stats.avg > 2000 ? 'high' : 'medium'
                });
            }
            
            this.log(`✓ ${endpoint.path}: avg=${stats.avg.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms`, 'success');
        }
    }

    async testWorkersEndpoints() {
        this.log('⚡ Testing Cloudflare Workers Performance', 'perf');
        
        const endpoints = [
            { path: '/health', method: 'GET' },
            {
                path: '/create-checkout-session',
                method: 'POST',
                payload: {
                    email: 'perf@test.com',
                    name: 'Performance Test',
                    restaurantName: 'Perf Test Restaurant',
                    machineFingerprint: 'PERF-TEST-12345-ABCDE-67890'
                }
            },
            {
                path: '/validate',
                method: 'POST',
                payload: {
                    unlockToken: 'perf-test-token',
                    machineFingerprint: 'PERF-TEST-12345-ABCDE-67890'
                }
            },
            {
                path: '/create-portal-session',
                method: 'POST',
                payload: { email: 'perf@test.com' }
            }
        ];
        
        for (const endpoint of endpoints) {
            const url = `${WORKERS_BASE_URL}${endpoint.path}`;
            this.log(`Testing ${endpoint.method} ${endpoint.path}`, 'info');
            
            const stats = await this.measureEndpointPerformance(
                url, 
                endpoint.method, 
                endpoint.payload
            );
            
            this.results.workers_endpoints[endpoint.path] = stats;
            
            // Performance analysis for Workers (should be faster)
            if (stats.avg > 500) {
                this.results.bottlenecks.push({
                    component: 'Workers',
                    endpoint: endpoint.path,
                    issue: 'High response time for edge function',
                    value: `${stats.avg.toFixed(2)}ms`,
                    severity: stats.avg > 1000 ? 'high' : 'medium'
                });
            }
            
            this.log(`✓ ${endpoint.path}: avg=${stats.avg.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms`, 'success');
        }
    }

    async testConcurrentLoad() {
        this.log('🔥 Testing Concurrent Load Performance', 'perf');
        
        const concurrencyLevels = [5, 10, 20];
        const testEndpoint = `${FLASK_BASE_URL}/api/config`;
        
        for (const concurrency of concurrencyLevels) {
            this.log(`Testing ${concurrency} concurrent requests`, 'info');
            
            const promises = [];
            const startTime = performance.now();
            
            for (let i = 0; i < concurrency; i++) {
                promises.push(fetch(testEndpoint));
            }
            
            try {
                const responses = await Promise.all(promises);
                const endTime = performance.now();
                const totalTime = endTime - startTime;
                
                const successful = responses.filter(r => r.ok).length;
                const failed = responses.length - successful;
                
                this.results.load_tests[`concurrent_${concurrency}`] = {
                    concurrency,
                    total_time: totalTime,
                    successful,
                    failed,
                    requests_per_second: (concurrency / (totalTime / 1000)).toFixed(2),
                    avg_response_time: (totalTime / concurrency).toFixed(2)
                };
                
                this.log(`✓ ${concurrency} concurrent: ${(concurrency / (totalTime / 1000)).toFixed(2)} RPS`, 'success');
                
                // Check for performance degradation
                if (totalTime / concurrency > 1000) {
                    this.results.bottlenecks.push({
                        component: 'System',
                        endpoint: 'concurrent_load',
                        issue: 'Performance degradation under load',
                        value: `${(totalTime / concurrency).toFixed(2)}ms avg response time`,
                        severity: 'medium'
                    });
                }
                
            } catch (error) {
                this.log(`❌ Concurrent load test failed: ${error.message}`, 'error');
            }
        }
    }

    async testDatabasePerformance() {
        this.log('💾 Testing Database Performance (via API)', 'perf');
        
        // Test operations that likely hit the database
        const dbOperations = [
            {
                name: 'License Validation',
                url: `${FLASK_BASE_URL}/api/validate-license`,
                payload: {
                    unlockToken: 'perf-test-token',
                    hardwareId: 'PERF-TEST-12345-ABCDE-67890'
                }
            },
            {
                name: 'Trial Status Check',
                url: `${FLASK_BASE_URL}/api/trial_status`,
                payload: null
            }
        ];
        
        for (const operation of dbOperations) {
            this.log(`Testing ${operation.name}`, 'info');
            
            const stats = await this.measureEndpointPerformance(
                operation.url,
                operation.payload ? 'POST' : 'GET',
                operation.payload,
                20 // More samples for database operations
            );
            
            this.results.database_operations[operation.name] = stats;
            
            // Database operations should be fast
            if (stats.avg > 100) {
                this.results.bottlenecks.push({
                    component: 'Database',
                    operation: operation.name,
                    issue: 'Slow database operation',
                    value: `${stats.avg.toFixed(2)}ms`,
                    severity: stats.avg > 500 ? 'high' : 'medium'
                });
            }
            
            this.log(`✓ ${operation.name}: avg=${stats.avg.toFixed(2)}ms`, 'success');
        }
    }

    async analyzeSystemBottlenecks() {
        this.log('🔍 Analyzing System Bottlenecks', 'perf');
        
        // Compare Flask vs Workers performance
        const flaskAvg = Object.values(this.results.flask_endpoints)
            .map(s => s.avg)
            .reduce((a, b) => a + b, 0) / Object.keys(this.results.flask_endpoints).length;
            
        const workersAvg = Object.values(this.results.workers_endpoints)
            .map(s => s.avg)
            .reduce((a, b) => a + b, 0) / Object.keys(this.results.workers_endpoints).length;
        
        this.log(`Flask average response time: ${flaskAvg.toFixed(2)}ms`, 'info');
        this.log(`Workers average response time: ${workersAvg.toFixed(2)}ms`, 'info');
        
        if (flaskAvg > workersAvg * 2) {
            this.results.bottlenecks.push({
                component: 'Architecture',
                issue: 'Flask significantly slower than Workers',
                value: `Flask: ${flaskAvg.toFixed(2)}ms vs Workers: ${workersAvg.toFixed(2)}ms`,
                severity: 'medium'
            });
        }
        
        // Generate recommendations
        this.generateRecommendations();
    }

    generateRecommendations() {
        this.log('💡 Generating Performance Recommendations', 'perf');
        
        const highSeverityBottlenecks = this.results.bottlenecks.filter(b => b.severity === 'high');
        const mediumSeverityBottlenecks = this.results.bottlenecks.filter(b => b.severity === 'medium');
        
        if (highSeverityBottlenecks.length > 0) {
            this.results.recommendations.push({
                priority: 'high',
                category: 'Critical Performance',
                action: 'Address high-severity bottlenecks immediately',
                details: highSeverityBottlenecks.map(b => `${b.component}: ${b.issue}`).join(', ')
            });
        }
        
        if (mediumSeverityBottlenecks.length > 0) {
            this.results.recommendations.push({
                priority: 'medium', 
                category: 'Performance Optimization',
                action: 'Optimize medium-severity bottlenecks',
                details: mediumSeverityBottlenecks.map(b => `${b.component}: ${b.issue}`).join(', ')
            });
        }
        
        // Database optimization recommendations
        const dbIssues = this.results.bottlenecks.filter(b => b.component === 'Database');
        if (dbIssues.length > 0) {
            this.results.recommendations.push({
                priority: 'high',
                category: 'Database Performance',
                action: 'Implement database optimizations',
                details: 'Add indexes, query optimization, connection pooling'
            });
        }
        
        // Caching recommendations
        const slowEndpoints = Object.entries(this.results.flask_endpoints)
            .filter(([_, stats]) => stats.avg > 500)
            .map(([endpoint, _]) => endpoint);
            
        if (slowEndpoints.length > 0) {
            this.results.recommendations.push({
                priority: 'medium',
                category: 'Caching',
                action: 'Implement response caching for slow endpoints',
                details: `Endpoints: ${slowEndpoints.join(', ')}`
            });
        }
        
        // Load balancing recommendations
        const loadIssues = this.results.bottlenecks.filter(b => b.endpoint === 'concurrent_load');
        if (loadIssues.length > 0) {
            this.results.recommendations.push({
                priority: 'medium',
                category: 'Scalability', 
                action: 'Consider load balancing and horizontal scaling',
                details: 'Performance degrades under concurrent load'
            });
        }
    }

    async runPerformanceTests() {
        this.log('🎯 Starting Performance Test Suite', 'perf');
        this.log('=' .repeat(60), 'info');
        
        try {
            await this.testFlaskEndpoints();
            await this.testWorkersEndpoints(); 
            await this.testConcurrentLoad();
            await this.testDatabasePerformance();
            await this.analyzeSystemBottlenecks();
            
            this.generateReport();
            
        } catch (error) {
            this.log(`❌ Performance testing failed: ${error.message}`, 'error');
            throw error;
        }
        
        const duration = (Date.now() - this.startTime) / 1000;
        this.log(`⏱️ Performance testing completed in ${duration.toFixed(2)} seconds`, 'success');
        
        return this.results;
    }

    generateReport() {
        this.log('📊 Performance Test Report', 'perf');
        this.log('=' .repeat(60), 'info');
        
        // Summary statistics
        const totalEndpoints = Object.keys(this.results.flask_endpoints).length + 
                             Object.keys(this.results.workers_endpoints).length;
        const totalBottlenecks = this.results.bottlenecks.length;
        const criticalIssues = this.results.bottlenecks.filter(b => b.severity === 'high').length;
        
        this.log(`📈 PERFORMANCE SUMMARY:`, 'info');
        this.log(`   Total endpoints tested: ${totalEndpoints}`, 'info');
        this.log(`   Performance bottlenecks found: ${totalBottlenecks}`, totalBottlenecks > 0 ? 'warning' : 'success');
        this.log(`   Critical performance issues: ${criticalIssues}`, criticalIssues > 0 ? 'error' : 'success');
        this.log(`   Recommendations generated: ${this.results.recommendations.length}`, 'info');
        
        // Top performance issues
        if (this.results.bottlenecks.length > 0) {
            this.log(`\n🚨 TOP PERFORMANCE ISSUES:`, 'warning');
            this.results.bottlenecks
                .sort((a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0))
                .slice(0, 5)
                .forEach((bottleneck, index) => {
                    const severity = bottleneck.severity === 'high' ? '🔴' : '🟡';
                    this.log(`   ${index + 1}. ${severity} ${bottleneck.component}: ${bottleneck.issue} (${bottleneck.value})`, 'warning');
                });
        }
        
        // Top recommendations  
        if (this.results.recommendations.length > 0) {
            this.log(`\n💡 TOP RECOMMENDATIONS:`, 'info');
            this.results.recommendations
                .sort((a, b) => (b.priority === 'high' ? 1 : 0) - (a.priority === 'high' ? 1 : 0))
                .forEach((rec, index) => {
                    const priority = rec.priority === 'high' ? '🔥' : '⚡';
                    this.log(`   ${index + 1}. ${priority} ${rec.category}: ${rec.action}`, 'info');
                });
        }
        
        // Performance verdict
        this.log(`\n🎯 PERFORMANCE VERDICT:`, 'perf');
        if (criticalIssues === 0 && totalBottlenecks < 3) {
            this.log(`   ✅ SYSTEM IS PRODUCTION READY - Good performance characteristics`, 'success');
        } else if (criticalIssues === 0) {
            this.log(`   ⚠️ SYSTEM READY WITH OPTIMIZATIONS - Address medium priority issues`, 'warning');
        } else {
            this.log(`   ❌ PERFORMANCE ISSUES FOUND - Address critical issues before production`, 'error');
        }
    }
}

// Export for use
if (typeof module !== 'undefined') {
    module.exports = PerformanceTester;
}

// Auto-run if called directly  
if (typeof require !== 'undefined' && require.main === module) {
    const tester = new PerformanceTester();
    tester.runPerformanceTests().catch(console.error);
}