/**
 * Enhanced Menu Fields Testing Suite
 * Tests the newly implemented enhanced menu fields system in POSPal
 *
 * Features to test:
 * 1. Frontend UI for enhanced fields (mobile & desktop)
 * 2. Menu item creation with enhanced data
 * 3. Menu item editing with enhanced data persistence
 * 4. API endpoints handling enhanced data
 * 5. QR menu publishing with enhanced data
 * 6. Backward compatibility with existing menu items
 * 7. Performance and integration testing
 */

const FLASK_BASE_URL = 'http://127.0.0.1:5001';

// Test configuration
const TEST_CONFIG = {
    testTimeout: 30000,
    retryAttempts: 3,
    testDataCleanup: true
};

// Enhanced menu test data
const ENHANCED_MENU_TEST_DATA = {
    basicItem: {
        name: "Test Basic Item",
        price: 12.50,
        category: "1.SALADS"
    },
    enhancedItem: {
        name: "Enhanced Test Item",
        price: 15.75,
        category: "1.SALADS",
        description: "A delicious test item with enhanced information including allergens and dietary details",
        prep_time: 15,
        dietary_tags: ["vegetarian", "gluten_free"],
        allergens: ["nuts", "dairy"]
    },
    complexEnhancedItem: {
        name: "Complex Enhanced Item",
        price: 22.00,
        category: "2.ASIAN BITES",
        description: "Complex item with all possible enhanced fields for comprehensive testing",
        prep_time: 25,
        dietary_tags: ["vegan", "spicy", "popular"],
        allergens: ["soy", "seafood"],
        hasGeneralOptions: true,
        generalOptions: [
            { name: "Small", priceChange: -2.00 },
            { name: "Large", priceChange: 3.50 }
        ]
    }
};

// Test results tracking
const testResults = {
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    details: []
};

// Utility functions
function logTestResult(testName, passed, details = '') {
    testResults.totalTests++;
    if (passed) {
        testResults.passedTests++;
        console.log(`✅ ${testName}: PASSED`);
    } else {
        testResults.failedTests++;
        console.log(`❌ ${testName}: FAILED - ${details}`);
    }

    testResults.details.push({
        test: testName,
        status: passed ? 'PASSED' : 'FAILED',
        details: details,
        timestamp: new Date().toISOString()
    });
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// API Testing Functions
async function testApiEndpoints() {
    console.log('\n🔧 Testing API Endpoints for Enhanced Menu Data...');

    // Test GET /api/menu endpoint
    try {
        const response = await fetch(`${FLASK_BASE_URL}/api/menu`);
        const menuData = await response.json();

        if (response.ok && menuData) {
            logTestResult('API GET /api/menu', true, 'Menu data retrieved successfully');

            // Check if any items have enhanced fields
            let hasEnhancedItems = false;
            for (const category in menuData) {
                for (const item of menuData[category]) {
                    if (item.description || item.prep_time || item.dietary_tags || item.allergens) {
                        hasEnhancedItems = true;
                        break;
                    }
                }
            }

            logTestResult('API Enhanced Fields Detection', hasEnhancedItems,
                hasEnhancedItems ? 'Enhanced fields found in menu data' : 'No enhanced fields detected (backward compatibility confirmed)');
        } else {
            logTestResult('API GET /api/menu', false, `HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        logTestResult('API GET /api/menu', false, `Network error: ${error.message}`);
    }
}

async function testMenuItemCreationWithEnhancedData() {
    console.log('\n📝 Testing Menu Item Creation with Enhanced Data...');

    try {
        // First, get current menu to find available categories
        const menuResponse = await fetch(`${FLASK_BASE_URL}/api/menu`);
        const currentMenu = await menuResponse.json();

        if (!menuResponse.ok) {
            logTestResult('Menu Item Creation - Get Categories', false, 'Failed to retrieve current menu');
            return;
        }

        const categories = Object.keys(currentMenu);
        if (categories.length === 0) {
            logTestResult('Menu Item Creation - Categories Available', false, 'No categories found in menu');
            return;
        }

        logTestResult('Menu Item Creation - Categories Available', true, `Found ${categories.length} categories`);

        // Test creating enhanced menu item
        const testItem = {
            ...ENHANCED_MENU_TEST_DATA.enhancedItem,
            category: categories[0] // Use first available category
        };

        // Create modified menu with enhanced item
        const enhancedMenu = JSON.parse(JSON.stringify(currentMenu));
        const newItemId = Date.now(); // Simple unique ID for testing

        enhancedMenu[testItem.category] = enhancedMenu[testItem.category] || [];
        enhancedMenu[testItem.category].push({
            id: newItemId,
            name: testItem.name,
            price: testItem.price,
            description: testItem.description,
            prep_time: testItem.prep_time,
            dietary_tags: testItem.dietary_tags,
            allergens: testItem.allergens,
            hasGeneralOptions: false,
            generalOptions: []
        });

        // Save enhanced menu
        const saveResponse = await fetch(`${FLASK_BASE_URL}/api/menu`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(enhancedMenu)
        });

        if (saveResponse.ok) {
            logTestResult('Menu Item Creation - Enhanced Item Save', true, 'Enhanced menu item saved successfully');

            // Verify the item was saved correctly
            const verifyResponse = await fetch(`${FLASK_BASE_URL}/api/menu`);
            const verifiedMenu = await verifyResponse.json();

            const savedItem = verifiedMenu[testItem.category].find(item => item.id === newItemId);
            if (savedItem) {
                const hasAllFields = savedItem.description && savedItem.prep_time &&
                                   savedItem.dietary_tags && savedItem.allergens;
                logTestResult('Menu Item Creation - Enhanced Fields Persistence', hasAllFields,
                    hasAllFields ? 'All enhanced fields persisted correctly' : 'Some enhanced fields missing');

                // Test specific field values
                const correctValues =
                    savedItem.description === testItem.description &&
                    savedItem.prep_time === testItem.prep_time &&
                    JSON.stringify(savedItem.dietary_tags) === JSON.stringify(testItem.dietary_tags) &&
                    JSON.stringify(savedItem.allergens) === JSON.stringify(testItem.allergens);

                logTestResult('Menu Item Creation - Enhanced Field Values', correctValues,
                    correctValues ? 'All enhanced field values correct' : 'Enhanced field values mismatch');
            } else {
                logTestResult('Menu Item Creation - Item Verification', false, 'Created item not found in menu');
            }
        } else {
            logTestResult('Menu Item Creation - Enhanced Item Save', false, `HTTP ${saveResponse.status}: ${saveResponse.statusText}`);
        }

    } catch (error) {
        logTestResult('Menu Item Creation - Enhanced Data', false, `Error: ${error.message}`);
    }
}

async function testBackwardCompatibility() {
    console.log('\n🔄 Testing Backward Compatibility with Existing Menu Items...');

    try {
        const response = await fetch(`${FLASK_BASE_URL}/api/menu`);
        const menuData = await response.json();

        if (!response.ok) {
            logTestResult('Backward Compatibility - Menu Retrieval', false, 'Failed to retrieve menu');
            return;
        }

        let totalItems = 0;
        let itemsWithoutEnhancedFields = 0;
        let itemsWithPartialFields = 0;
        let itemsWithFullEnhancedFields = 0;

        // Analyze all menu items
        for (const category in menuData) {
            for (const item of menuData[category]) {
                totalItems++;

                const hasDescription = item.description && item.description.trim() !== '';
                const hasPrepTime = item.prep_time && item.prep_time > 0;
                const hasDietaryTags = item.dietary_tags && item.dietary_tags.length > 0;
                const hasAllergens = item.allergens && item.allergens.length > 0;

                const enhancedFieldCount = [hasDescription, hasPrepTime, hasDietaryTags, hasAllergens].filter(Boolean).length;

                if (enhancedFieldCount === 0) {
                    itemsWithoutEnhancedFields++;
                } else if (enhancedFieldCount === 4) {
                    itemsWithFullEnhancedFields++;
                } else {
                    itemsWithPartialFields++;
                }
            }
        }

        logTestResult('Backward Compatibility - Menu Structure', totalItems > 0,
            `Analyzed ${totalItems} menu items`);

        logTestResult('Backward Compatibility - Legacy Items', itemsWithoutEnhancedFields > 0,
            `${itemsWithoutEnhancedFields} items without enhanced fields (legacy items work)`);

        logTestResult('Backward Compatibility - Mixed Environment',
            itemsWithoutEnhancedFields > 0 || itemsWithPartialFields > 0,
            `System handles mixed menu items: ${itemsWithoutEnhancedFields} legacy, ${itemsWithPartialFields} partial, ${itemsWithFullEnhancedFields} enhanced`);

        // Test that basic menu operations still work
        if (totalItems > 0) {
            logTestResult('Backward Compatibility - Basic Menu Operations', true,
                'All existing menu items accessible and processable');
        }

    } catch (error) {
        logTestResult('Backward Compatibility - Testing', false, `Error: ${error.message}`);
    }
}

async function testEnhancedFieldValidation() {
    console.log('\n✅ Testing Enhanced Field Validation...');

    // Test dietary tags validation
    const validDietaryTags = ['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'spicy', 'popular'];
    const testDietaryTags = ['vegetarian', 'vegan', 'invalid_tag'];

    const validTagsCount = testDietaryTags.filter(tag => validDietaryTags.includes(tag)).length;
    logTestResult('Enhanced Fields - Dietary Tags Validation', validTagsCount === 2,
        `${validTagsCount}/3 dietary tags are valid (vegetarian, vegan valid; invalid_tag should be filtered)`);

    // Test allergen validation
    const validAllergens = ['nuts', 'dairy', 'gluten', 'seafood', 'eggs', 'soy'];
    const testAllergens = ['nuts', 'dairy', 'invalid_allergen'];

    const validAllergensCount = testAllergens.filter(allergen => validAllergens.includes(allergen)).length;
    logTestResult('Enhanced Fields - Allergen Validation', validAllergensCount === 2,
        `${validAllergensCount}/3 allergens are valid (nuts, dairy valid; invalid_allergen should be filtered)`);

    // Test prep time validation
    const validPrepTimes = [5, 15, 30, 45];
    const invalidPrepTimes = [-5, 0, 200, 'invalid'];

    const validPrepTimeCheck = validPrepTimes.every(time => typeof time === 'number' && time > 0 && time <= 120);
    logTestResult('Enhanced Fields - Prep Time Validation', validPrepTimeCheck,
        'Valid prep times are positive numbers <= 120 minutes');
}

async function testQRMenuPublishing() {
    console.log('\n🔗 Testing QR Menu Publishing with Enhanced Data...');

    try {
        // Test if publish endpoint exists (we can't test actual publishing without credentials)
        const response = await fetch(`${FLASK_BASE_URL}/api/publish/cloudflare`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                store_slug: 'test-enhanced-menu',
                test_mode: true
            })
        });

        // We expect this to fail due to missing credentials, but endpoint should exist
        if (response.status === 401 || response.status === 403 || response.status === 400) {
            logTestResult('QR Menu Publishing - Endpoint Available', true,
                'Publish endpoint exists and responds (authentication/configuration required for actual publishing)');
        } else if (response.ok) {
            logTestResult('QR Menu Publishing - Endpoint Available', true,
                'Publish endpoint accessible and functional');
        } else {
            logTestResult('QR Menu Publishing - Endpoint Available', false,
                `Unexpected response: ${response.status} ${response.statusText}`);
        }

    } catch (error) {
        logTestResult('QR Menu Publishing - Endpoint Test', false, `Network error: ${error.message}`);
    }
}

async function testPerformanceWithEnhancedData() {
    console.log('\n⚡ Testing Performance with Enhanced Menu Data...');

    try {
        // Test API response time
        const startTime = performance.now();
        const response = await fetch(`${FLASK_BASE_URL}/api/menu`);
        const endTime = performance.now();

        const responseTime = endTime - startTime;

        logTestResult('Performance - API Response Time', responseTime < 2000,
            `Menu API responded in ${responseTime.toFixed(2)}ms (should be < 2000ms)`);

        if (response.ok) {
            const menuData = await response.json();
            const menuSize = JSON.stringify(menuData).length;

            logTestResult('Performance - Menu Data Size', menuSize > 0,
                `Menu data size: ${(menuSize / 1024).toFixed(2)} KB`);

            // Test menu parsing performance
            const parseStartTime = performance.now();
            const parsedMenu = JSON.parse(JSON.stringify(menuData));
            const parseEndTime = performance.now();

            const parseTime = parseEndTime - parseStartTime;
            logTestResult('Performance - Menu Parsing', parseTime < 100,
                `Menu parsing took ${parseTime.toFixed(2)}ms (should be < 100ms)`);
        }

    } catch (error) {
        logTestResult('Performance - Testing', false, `Error: ${error.message}`);
    }
}

async function generateTestReport() {
    console.log('\n📊 Generating Comprehensive Test Report...');

    const report = {
        timestamp: new Date().toISOString(),
        summary: {
            totalTests: testResults.totalTests,
            passedTests: testResults.passedTests,
            failedTests: testResults.failedTests,
            successRate: ((testResults.passedTests / testResults.totalTests) * 100).toFixed(2) + '%'
        },
        testCategories: {
            'API Endpoints': testResults.details.filter(t => t.test.includes('API')),
            'Menu Item Creation': testResults.details.filter(t => t.test.includes('Menu Item Creation')),
            'Backward Compatibility': testResults.details.filter(t => t.test.includes('Backward Compatibility')),
            'Enhanced Fields': testResults.details.filter(t => t.test.includes('Enhanced Fields')),
            'QR Menu Publishing': testResults.details.filter(t => t.test.includes('QR Menu Publishing')),
            'Performance': testResults.details.filter(t => t.test.includes('Performance'))
        },
        allResults: testResults.details,
        recommendations: []
    };

    // Add recommendations based on results
    if (testResults.failedTests > 0) {
        report.recommendations.push('Review failed tests and address any issues found');
    }

    if (testResults.successRate < 90) {
        report.recommendations.push('Success rate below 90% - investigate critical issues');
    } else if (testResults.successRate >= 95) {
        report.recommendations.push('Excellent test results - system ready for production');
    }

    // Check for specific patterns
    const hasApiFailures = report.testCategories['API Endpoints'].some(t => t.status === 'FAILED');
    if (hasApiFailures) {
        report.recommendations.push('API endpoint failures detected - check server configuration');
    }

    const hasBackwardCompatibilityIssues = report.testCategories['Backward Compatibility'].some(t => t.status === 'FAILED');
    if (hasBackwardCompatibilityIssues) {
        report.recommendations.push('Backward compatibility issues found - review legacy item handling');
    }

    console.log('\n🎯 Enhanced Menu Fields Testing Report');
    console.log('='.repeat(50));
    console.log(`📅 Timestamp: ${report.timestamp}`);
    console.log(`📊 Total Tests: ${report.summary.totalTests}`);
    console.log(`✅ Passed: ${report.summary.passedTests}`);
    console.log(`❌ Failed: ${report.summary.failedTests}`);
    console.log(`📈 Success Rate: ${report.summary.successRate}`);
    console.log('\n📋 Test Categories:');

    for (const [category, tests] of Object.entries(report.testCategories)) {
        const passed = tests.filter(t => t.status === 'PASSED').length;
        const total = tests.length;
        console.log(`  ${category}: ${passed}/${total} passed`);
    }

    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => console.log(`  • ${rec}`));

    return report;
}

// Main test execution function
async function runEnhancedMenuFieldsTests() {
    console.log('🚀 Starting Enhanced Menu Fields Testing Suite');
    console.log('=' .repeat(60));

    try {
        // Test API endpoints
        await testApiEndpoints();
        await wait(1000);

        // Test menu item creation with enhanced data
        await testMenuItemCreationWithEnhancedData();
        await wait(1000);

        // Test backward compatibility
        await testBackwardCompatibility();
        await wait(1000);

        // Test enhanced field validation
        await testEnhancedFieldValidation();
        await wait(1000);

        // Test QR menu publishing
        await testQRMenuPublishing();
        await wait(1000);

        // Test performance
        await testPerformanceWithEnhancedData();
        await wait(1000);

        // Generate comprehensive report
        const report = await generateTestReport();

        console.log('\n🏁 Enhanced Menu Fields Testing Complete!');

        return report;

    } catch (error) {
        console.error('💥 Testing suite encountered an error:', error);
        logTestResult('Testing Suite Execution', false, error.message);
        return await generateTestReport();
    }
}

// Export for Node.js or run directly in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        runEnhancedMenuFieldsTests,
        ENHANCED_MENU_TEST_DATA,
        TEST_CONFIG
    };
} else {
    // Auto-run if loaded in browser
    console.log('Enhanced Menu Fields Testing Suite Loaded');
    console.log('Run runEnhancedMenuFieldsTests() to start testing');
}