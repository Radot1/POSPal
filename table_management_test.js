const API_BASE = 'http://localhost:5000';

// Test Results Collector
const testResults = {
    passed: 0,
    failed: 0,
    errors: [],
    details: []
};

// Helper function to make API requests
async function apiRequest(method, endpoint, data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const result = await response.json();

    return {
        status: response.status,
        ok: response.ok,
        data: result
    };
}

// Test function wrapper
async function runTest(testName, testFunction) {
    try {
        console.log(`\n🧪 Running test: ${testName}`);
        const result = await testFunction();

        if (result.success) {
            testResults.passed++;
            console.log(`✅ PASSED: ${testName}`);
            testResults.details.push({
                test: testName,
                status: 'PASSED',
                message: result.message || 'Test completed successfully'
            });
        } else {
            testResults.failed++;
            console.log(`❌ FAILED: ${testName} - ${result.message}`);
            testResults.details.push({
                test: testName,
                status: 'FAILED',
                message: result.message,
                error: result.error
            });
            testResults.errors.push(`${testName}: ${result.message}`);
        }
    } catch (error) {
        testResults.failed++;
        console.log(`💥 ERROR: ${testName} - ${error.message}`);
        testResults.details.push({
            test: testName,
            status: 'ERROR',
            message: error.message,
            error: error.stack
        });
        testResults.errors.push(`${testName}: ${error.message}`);
    }
}

// Test Suite: API Endpoint Tests
async function testGetTables() {
    const response = await apiRequest('GET', '/api/tables');

    if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}: ${response.data.message}` };
    }

    if (!response.data.status || response.data.status !== 'success') {
        return { success: false, message: 'Invalid response structure' };
    }

    if (!response.data.tables) {
        return { success: false, message: 'No tables data returned' };
    }

    const tableCount = Object.keys(response.data.tables).length;
    return {
        success: true,
        message: `Successfully retrieved ${tableCount} tables`
    };
}

async function testGetTableStatus() {
    const response = await apiRequest('GET', '/api/tables/1/status');

    if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}: ${response.data.message}` };
    }

    if (!response.data.table) {
        return { success: false, message: 'No table data returned' };
    }

    return { success: true, message: 'Table status retrieved successfully' };
}

async function testOpenTable() {
    const response = await apiRequest('POST', '/api/tables/3/open', { party_size: 4 });

    if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}: ${response.data.message}` };
    }

    if (response.data.status !== 'success') {
        return { success: false, message: 'Table opening failed' };
    }

    return { success: true, message: 'Table opened successfully' };
}

async function testCloseTable() {
    const response = await apiRequest('POST', '/api/tables/3/close');

    if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}: ${response.data.message}` };
    }

    if (response.data.status !== 'success') {
        return { success: false, message: 'Table closing failed' };
    }

    return { success: true, message: 'Table closed successfully' };
}

async function testClearTable() {
    const response = await apiRequest('POST', '/api/tables/3/clear');

    if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}: ${response.data.message}` };
    }

    if (response.data.status !== 'success') {
        return { success: false, message: 'Table clearing failed' };
    }

    return { success: true, message: 'Table cleared successfully' };
}

async function testGetTableBill() {
    const response = await apiRequest('GET', '/api/tables/1/bill');

    if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}: ${response.data.message}` };
    }

    if (response.data.status !== 'success') {
        return { success: false, message: 'Bill generation failed' };
    }

    return {
        success: true,
        message: `Bill generated - Total: ${response.data.total}, Orders: ${response.data.total_orders}`
    };
}

async function testTableSuggestions() {
    const response = await apiRequest('GET', '/api/tables/suggest?party_size=4');

    if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}: ${response.data.message}` };
    }

    if (response.data.status !== 'success') {
        return { success: false, message: 'Table suggestions failed' };
    }

    return {
        success: true,
        message: `Suggestions generated: ${response.data.suggestions ? response.data.suggestions.length : 0} tables`
    };
}

async function testHealthCheck() {
    const response = await apiRequest('GET', '/api/tables/health');

    if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}: ${response.data.message}` };
    }

    if (response.data.status !== 'healthy') {
        return { success: false, message: 'System not healthy' };
    }

    return {
        success: true,
        message: `System healthy - ${response.data.total_tables} tables, ${response.data.active_sessions} active sessions`
    };
}

async function testTableSummary() {
    const response = await apiRequest('GET', '/api/tables/summary');

    if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}: ${response.data.message}` };
    }

    if (response.data.status !== 'success') {
        return { success: false, message: 'Summary generation failed' };
    }

    return { success: true, message: 'Table summary generated successfully' };
}

async function testConfigureTable() {
    const response = await apiRequest('PUT', '/api/tables/1/configure', {
        name: 'Table 1 Updated',
        seats: 6
    });

    if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}: ${response.data.message}` };
    }

    if (response.data.status !== 'success') {
        return { success: false, message: 'Table configuration failed' };
    }

    return { success: true, message: 'Table configuration updated successfully' };
}

// Run all tests
async function runAllTests() {
    console.log('🚀 Starting Comprehensive Table Management API Tests\n');
    console.log('='.repeat(60));

    // Basic functionality tests
    await runTest('Get All Tables', testGetTables);
    await runTest('Get Table Status', testGetTableStatus);
    await runTest('Open Table', testOpenTable);
    await runTest('Close Table', testCloseTable);
    await runTest('Clear Table', testClearTable);
    await runTest('Get Table Bill', testGetTableBill);
    await runTest('Table Suggestions', testTableSuggestions);
    await runTest('Health Check', testHealthCheck);
    await runTest('Table Summary', testTableSummary);
    await runTest('Configure Table', testConfigureTable);

    // Print final results
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ PASSED: ${testResults.passed}`);
    console.log(`❌ FAILED: ${testResults.failed}`);
    console.log(`📈 SUCCESS RATE: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);

    if (testResults.errors.length > 0) {
        console.log('\n🚨 ERRORS ENCOUNTERED:');
        testResults.errors.forEach((error, index) => {
            console.log(`${index + 1}. ${error}`);
        });
    }

    console.log('\n📋 DETAILED RESULTS:');
    testResults.details.forEach((detail, index) => {
        const status = detail.status === 'PASSED' ? '✅' :
                      detail.status === 'FAILED' ? '❌' : '💥';
        console.log(`${index + 1}. ${status} ${detail.test}: ${detail.message}`);
    });

    return testResults;
}

// Execute if running in Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runAllTests, testResults };

    // If this file is run directly
    if (require.main === module) {
        runAllTests();
    }
} else {
    // Running in browser - expose to global
    window.runTableTests = runAllTests;
}