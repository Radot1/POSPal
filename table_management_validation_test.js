/**
 * Table Management System Validation Test
 * This test validates table management functionality and reports current status
 */

class TableValidationTester {
    constructor(baseUrl = 'http://localhost:5000') {
        this.baseUrl = baseUrl;
        this.results = {
            configurationStatus: 'unknown',
            tableManagementEnabled: false,
            functionalEndpoints: [],
            nonFunctionalEndpoints: [],
            performanceMetrics: {},
            errors: []
        };
    }

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

            let data;
            try {
                data = await response.json();
            } catch {
                data = { message: 'Non-JSON response' };
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
                error: error.message,
                url
            };
        }
    }

    async validateConfiguration() {
        console.log('🔍 Validating Table Management Configuration...');

        // Check main config endpoint
        const configResult = await this.makeRequest('/api/config');
        console.log(`Config API Status: ${configResult.status}`);

        if (configResult.success) {
            this.results.configurationStatus = 'accessible';
            this.results.tableManagementEnabled = configResult.data?.table_management_enabled || false;
            console.log(`Table Management in Config: ${this.results.tableManagementEnabled}`);
        } else {
            this.results.configurationStatus = 'error';
            console.log(`❌ Config API Error: ${configResult.error || configResult.status}`);
        }

        // Check table health endpoint
        const healthResult = await this.makeRequest('/api/tables/health');
        console.log(`Table Health API Status: ${healthResult.status}`);

        if (healthResult.success) {
            const healthData = healthResult.data;
            console.log(`Table Health Status: ${healthData.status}`);
            console.log(`Table Management Enabled (Health): ${healthData.table_management_enabled}`);

            if (healthData.table_management_enabled) {
                this.results.tableManagementEnabled = true;
            }
        }

        return this.results.tableManagementEnabled;
    }

    async validateTableEndpoints() {
        console.log('\n🧪 Testing Table Management Endpoints...');

        const endpoints = [
            { path: '/api/tables', method: 'GET', description: 'Get all tables' },
            { path: '/api/tables/health', method: 'GET', description: 'Table health check' },
            { path: '/api/tables/1/status', method: 'GET', description: 'Get table status' },
            { path: '/api/tables/1/session', method: 'GET', description: 'Get table session' },
            { path: '/api/tables/1/bill', method: 'GET', description: 'Get table bill' },
            { path: '/api/tables/1/payments', method: 'GET', description: 'Get table payments' },
            { path: '/api/tables/summary', method: 'GET', description: 'Get table summary' },
            { path: '/api/tables/integrity-check', method: 'GET', description: 'Integrity check' },
            { path: '/api/tables/performance', method: 'GET', description: 'Performance metrics' },
            { path: '/api/tables/suggest?party_size=4', method: 'GET', description: 'Table suggestions' },
            { path: '/api/tables/history/2025-09-28', method: 'GET', description: 'Table history' }
        ];

        for (const endpoint of endpoints) {
            const result = await this.makeRequest(endpoint.path, { method: endpoint.method });

            console.log(`${endpoint.method} ${endpoint.path}: ${result.status} (${result.responseTime}ms)`);

            if (result.success) {
                this.results.functionalEndpoints.push({
                    ...endpoint,
                    status: result.status,
                    responseTime: result.responseTime
                });
            } else {
                this.results.nonFunctionalEndpoints.push({
                    ...endpoint,
                    status: result.status,
                    error: result.error || result.data?.message || 'Unknown error',
                    responseTime: result.responseTime
                });
            }

            // Track performance
            if (!this.results.performanceMetrics[endpoint.path]) {
                this.results.performanceMetrics[endpoint.path] = result.responseTime;
            }
        }
    }

    async validateTableOperations() {
        console.log('\n🔧 Testing Table Operations...');

        if (!this.results.tableManagementEnabled) {
            console.log('⚠️ Table management not enabled - skipping operations tests');
            return;
        }

        // Test write operations
        const writeOperations = [
            {
                path: '/api/tables/2/open',
                method: 'POST',
                body: { party_size: 2 },
                description: 'Open table'
            },
            {
                path: '/api/tables/2/status',
                method: 'POST',
                body: { status: 'occupied' },
                description: 'Update table status'
            },
            {
                path: '/api/tables/2/add-payment',
                method: 'POST',
                body: { amount: 25.00, method: 'cash' },
                description: 'Add payment'
            },
            {
                path: '/api/tables/2/close',
                method: 'POST',
                body: {},
                description: 'Close table'
            },
            {
                path: '/api/tables/2/clear',
                method: 'POST',
                body: {},
                description: 'Clear table'
            }
        ];

        for (const operation of writeOperations) {
            const result = await this.makeRequest(operation.path, {
                method: operation.method,
                body: JSON.stringify(operation.body)
            });

            console.log(`${operation.method} ${operation.path}: ${result.status} (${result.responseTime}ms)`);

            if (result.success) {
                this.results.functionalEndpoints.push({
                    ...operation,
                    status: result.status,
                    responseTime: result.responseTime
                });
            } else {
                this.results.nonFunctionalEndpoints.push({
                    ...operation,
                    status: result.status,
                    error: result.error || result.data?.message || 'Unknown error',
                    responseTime: result.responseTime
                });
            }
        }
    }

    generateReport() {
        console.log('\n' + '='.repeat(70));
        console.log('📊 TABLE MANAGEMENT VALIDATION REPORT');
        console.log('='.repeat(70));

        console.log(`Configuration Status: ${this.results.configurationStatus}`);
        console.log(`Table Management Enabled: ${this.results.tableManagementEnabled}`);
        console.log(`Functional Endpoints: ${this.results.functionalEndpoints.length}`);
        console.log(`Non-Functional Endpoints: ${this.results.nonFunctionalEndpoints.length}`);

        const totalEndpoints = this.results.functionalEndpoints.length + this.results.nonFunctionalEndpoints.length;
        const successRate = totalEndpoints > 0 ? Math.round((this.results.functionalEndpoints.length / totalEndpoints) * 100) : 0;
        console.log(`Success Rate: ${successRate}%`);

        if (this.results.functionalEndpoints.length > 0) {
            console.log('\n✅ FUNCTIONAL ENDPOINTS:');
            this.results.functionalEndpoints.forEach(ep => {
                console.log(`  ${ep.method} ${ep.path} - ${ep.description} (${ep.responseTime}ms)`);
            });
        }

        if (this.results.nonFunctionalEndpoints.length > 0) {
            console.log('\n❌ NON-FUNCTIONAL ENDPOINTS:');
            this.results.nonFunctionalEndpoints.forEach(ep => {
                console.log(`  ${ep.method} ${ep.path} - ${ep.description} | Error: ${ep.error} (${ep.responseTime}ms)`);
            });
        }

        // Performance summary
        const avgResponseTime = Object.values(this.results.performanceMetrics).reduce((a, b) => a + b, 0) / Object.values(this.results.performanceMetrics).length;
        console.log(`\n📈 Average Response Time: ${Math.round(avgResponseTime)}ms`);

        // Overall assessment
        console.log('\n🎯 ASSESSMENT:');
        if (!this.results.tableManagementEnabled) {
            console.log('❌ Table management is DISABLED - Configuration issue detected');
            console.log('🔧 RECOMMENDATION: Fix get_app_config() function in app.py line 2069');
        } else if (successRate >= 80) {
            console.log('✅ Table management system is FUNCTIONAL');
        } else {
            console.log('⚠️  Table management system has ISSUES - Some endpoints failing');
        }

        return {
            tableManagementEnabled: this.results.tableManagementEnabled,
            successRate,
            avgResponseTime: Math.round(avgResponseTime),
            functionalCount: this.results.functionalEndpoints.length,
            issues: this.results.nonFunctionalEndpoints.length
        };
    }

    async runValidation() {
        console.log('🚀 Starting Table Management Validation...\n');

        try {
            await this.validateConfiguration();
            await this.validateTableEndpoints();
            await this.validateTableOperations();

            return this.generateReport();
        } catch (error) {
            console.error('❌ Validation failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Export for Node.js or run directly in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TableValidationTester;
} else {
    // Run tests immediately if in browser
    window.runTableValidation = async function() {
        const tester = new TableValidationTester();
        return await tester.runValidation();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('Table Validation Tester loaded. Run window.runTableValidation() to start.');
        });
    } else {
        console.log('Table Validation Tester loaded. Run window.runTableValidation() to start.');
    }
}