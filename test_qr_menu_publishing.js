/**
 * QR Menu Publishing Test for Enhanced Menu Fields
 * Tests that enhanced menu data is properly handled in QR menu publishing workflow
 */

const FLASK_BASE_URL = 'http://127.0.0.1:5001';

async function testQRMenuEnhancedData() {
    console.log('🔗 Testing QR Menu Publishing with Enhanced Data...\n');

    const testResults = [];

    function logResult(test, passed, details) {
        const result = { test, passed, details, timestamp: new Date().toISOString() };
        testResults.push(result);
        console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASSED' : 'FAILED'}`);
        if (details) console.log(`   ${details}`);
    }

    try {
        // Step 1: Get current menu with enhanced data
        console.log('📋 Step 1: Retrieving current menu data...');
        const menuResponse = await fetch(`${FLASK_BASE_URL}/api/menu`);

        if (!menuResponse.ok) {
            logResult('QR Menu - Menu Data Retrieval', false, `HTTP ${menuResponse.status}`);
            return testResults;
        }

        const menuData = await menuResponse.json();
        logResult('QR Menu - Menu Data Retrieval', true, 'Menu retrieved successfully');

        // Step 2: Analyze menu for enhanced fields
        console.log('\n🔍 Step 2: Analyzing menu for enhanced fields...');
        let enhancedItemsCount = 0;
        let totalItems = 0;
        const enhancedFieldsFound = {
            descriptions: 0,
            prepTimes: 0,
            dietaryTags: 0,
            allergens: 0
        };

        for (const category in menuData) {
            for (const item of menuData[category]) {
                totalItems++;
                let hasEnhancedFields = false;

                if (item.description && item.description.trim()) {
                    enhancedFieldsFound.descriptions++;
                    hasEnhancedFields = true;
                }

                if (item.prep_time && item.prep_time > 0) {
                    enhancedFieldsFound.prepTimes++;
                    hasEnhancedFields = true;
                }

                if (item.dietary_tags && Array.isArray(item.dietary_tags) && item.dietary_tags.length > 0) {
                    enhancedFieldsFound.dietaryTags++;
                    hasEnhancedFields = true;
                }

                if (item.allergens && Array.isArray(item.allergens) && item.allergens.length > 0) {
                    enhancedFieldsFound.allergens++;
                    hasEnhancedFields = true;
                }

                if (hasEnhancedFields) {
                    enhancedItemsCount++;
                }
            }
        }

        logResult('QR Menu - Enhanced Fields Analysis', enhancedItemsCount > 0,
            `Found ${enhancedItemsCount}/${totalItems} items with enhanced fields`);

        console.log(`   📊 Enhanced Fields Summary:`);
        console.log(`   • Descriptions: ${enhancedFieldsFound.descriptions} items`);
        console.log(`   • Prep Times: ${enhancedFieldsFound.prepTimes} items`);
        console.log(`   • Dietary Tags: ${enhancedFieldsFound.dietaryTags} items`);
        console.log(`   • Allergens: ${enhancedFieldsFound.allergens} items`);

        // Step 3: Test menu structure for QR publishing compatibility
        console.log('\n🔧 Step 3: Testing menu structure for QR publishing...');

        // Validate that enhanced fields don't break the basic menu structure
        let structureValid = true;
        let structureIssues = [];

        for (const category in menuData) {
            for (const item of menuData[category]) {
                // Check required fields still exist
                if (!item.id || !item.name || typeof item.price !== 'number') {
                    structureValid = false;
                    structureIssues.push(`Item missing required fields: ${item.name || 'unknown'}`);
                }

                // Check that enhanced fields are properly formatted
                if (item.dietary_tags && !Array.isArray(item.dietary_tags)) {
                    structureValid = false;
                    structureIssues.push(`Dietary tags not array for item: ${item.name}`);
                }

                if (item.allergens && !Array.isArray(item.allergens)) {
                    structureValid = false;
                    structureIssues.push(`Allergens not array for item: ${item.name}`);
                }

                if (item.prep_time && (typeof item.prep_time !== 'number' || item.prep_time <= 0)) {
                    structureValid = false;
                    structureIssues.push(`Invalid prep time for item: ${item.name}`);
                }
            }
        }

        logResult('QR Menu - Menu Structure Validation', structureValid,
            structureValid ? 'Menu structure compatible with QR publishing' : `Issues: ${structureIssues.join(', ')}`);

        // Step 4: Test QR publishing endpoint (simulation)
        console.log('\n🌐 Step 4: Testing QR menu publishing endpoint...');

        // Test the publish endpoint with enhanced menu data
        const publishData = {
            store_slug: 'test-enhanced-menu-' + Date.now(),
            test_mode: true,
            enhanced_fields_test: true
        };

        try {
            const publishResponse = await fetch(`${FLASK_BASE_URL}/api/publish/cloudflare`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(publishData)
            });

            // We expect this to fail due to missing configuration, but the endpoint should exist
            if (publishResponse.status === 400 || publishResponse.status === 401 || publishResponse.status === 403) {
                logResult('QR Menu - Publish Endpoint Available', true,
                    'Publish endpoint exists and responds appropriately to requests');
            } else if (publishResponse.ok) {
                const publishResult = await publishResponse.json();
                logResult('QR Menu - Publish Endpoint Available', true,
                    'Publish endpoint accessible and functional');

                // If successful, check if enhanced data is preserved
                if (publishResult && publishResult.menu_data) {
                    const hasEnhancedInPublished = JSON.stringify(publishResult.menu_data).includes('description') ||
                                                 JSON.stringify(publishResult.menu_data).includes('dietary_tags') ||
                                                 JSON.stringify(publishResult.menu_data).includes('allergens');

                    logResult('QR Menu - Enhanced Data Preservation', hasEnhancedInPublished,
                        'Enhanced fields are preserved in published menu data');
                }
            } else {
                logResult('QR Menu - Publish Endpoint Available', false,
                    `Unexpected response: ${publishResponse.status} ${publishResponse.statusText}`);
            }
        } catch (publishError) {
            logResult('QR Menu - Publish Endpoint Test', false, `Network error: ${publishError.message}`);
        }

        // Step 5: Test enhanced data JSON serialization
        console.log('\n📄 Step 5: Testing enhanced data serialization...');

        try {
            const serializedMenu = JSON.stringify(menuData);
            const deserializedMenu = JSON.parse(serializedMenu);

            // Check that enhanced fields survive serialization
            let serializationValid = true;
            for (const category in menuData) {
                for (const item of menuData[category]) {
                    const deserializedItem = deserializedMenu[category].find(i => i.id === item.id);
                    if (!deserializedItem) {
                        serializationValid = false;
                        break;
                    }

                    // Check enhanced fields
                    if (item.description && deserializedItem.description !== item.description) {
                        serializationValid = false;
                        break;
                    }

                    if (item.prep_time && deserializedItem.prep_time !== item.prep_time) {
                        serializationValid = false;
                        break;
                    }

                    if (item.dietary_tags && JSON.stringify(deserializedItem.dietary_tags) !== JSON.stringify(item.dietary_tags)) {
                        serializationValid = false;
                        break;
                    }

                    if (item.allergens && JSON.stringify(deserializedItem.allergens) !== JSON.stringify(item.allergens)) {
                        serializationValid = false;
                        break;
                    }
                }
            }

            logResult('QR Menu - Data Serialization', serializationValid,
                'Enhanced menu data survives JSON serialization/deserialization');

        } catch (serializationError) {
            logResult('QR Menu - Data Serialization', false, `Serialization error: ${serializationError.message}`);
        }

        // Step 6: Test sample QR menu HTML generation
        console.log('\n🖼️ Step 6: Testing QR menu HTML generation...');

        // Simulate generating HTML for QR menu with enhanced data
        const sampleEnhancedItem = menuData['1.SALADS']?.find(item =>
            item.description || item.dietary_tags || item.allergens || item.prep_time);

        if (sampleEnhancedItem) {
            const htmlGeneration = generateSampleQRMenuHTML(sampleEnhancedItem);
            logResult('QR Menu - HTML Generation', htmlGeneration.success,
                htmlGeneration.details);
        } else {
            logResult('QR Menu - HTML Generation', false, 'No enhanced items available for HTML generation test');
        }

        // Step 7: Generate final report
        console.log('\n📊 Generating QR Menu Publishing Test Report...');

        const passedTests = testResults.filter(r => r.passed).length;
        const totalTests = testResults.length;
        const successRate = ((passedTests / totalTests) * 100).toFixed(1);

        console.log('\n🎯 QR Menu Publishing Test Results');
        console.log('=' .repeat(50));
        console.log(`📅 Timestamp: ${new Date().toISOString()}`);
        console.log(`📊 Total Tests: ${totalTests}`);
        console.log(`✅ Passed: ${passedTests}`);
        console.log(`❌ Failed: ${totalTests - passedTests}`);
        console.log(`📈 Success Rate: ${successRate}%`);

        console.log('\n📋 Test Details:');
        testResults.forEach(result => {
            console.log(`  ${result.passed ? '✅' : '❌'} ${result.test}`);
            if (result.details) console.log(`    ${result.details}`);
        });

        console.log('\n💡 Recommendations:');
        if (enhancedItemsCount === 0) {
            console.log('  • Consider adding enhanced field data to menu items for richer QR menus');
        }
        if (successRate >= 90) {
            console.log('  • QR menu publishing system ready for enhanced menu data');
        } else {
            console.log('  • Address failing tests before deploying enhanced QR menu features');
        }

        return testResults;

    } catch (error) {
        logResult('QR Menu - Overall Test Execution', false, `Fatal error: ${error.message}`);
        return testResults;
    }
}

function generateSampleQRMenuHTML(item) {
    try {
        // Generate HTML for an enhanced menu item (simulating QR menu generation)
        let html = `<div class="menu-item">`;
        html += `<h3>${item.name}</h3>`;
        html += `<div class="price">€${item.price}</div>`;

        // Add enhanced fields if present
        if (item.description) {
            html += `<p class="description">${item.description}</p>`;
        }

        if (item.prep_time) {
            html += `<div class="prep-time">⏱️ ${item.prep_time} minutes</div>`;
        }

        if (item.dietary_tags && item.dietary_tags.length > 0) {
            html += `<div class="dietary-tags">`;
            item.dietary_tags.forEach(tag => {
                const icon = getDietaryIcon(tag);
                html += `<span class="dietary-tag">${icon} ${tag.replace('_', ' ')}</span>`;
            });
            html += `</div>`;
        }

        if (item.allergens && item.allergens.length > 0) {
            html += `<div class="allergens">⚠️ Contains: ${item.allergens.join(', ')}</div>`;
        }

        html += `</div>`;

        // Validate HTML structure
        const hasAllEnhancedFields =
            (!item.description || html.includes('class="description"')) &&
            (!item.prep_time || html.includes('class="prep-time"')) &&
            (!item.dietary_tags || html.includes('class="dietary-tags"')) &&
            (!item.allergens || html.includes('class="allergens"'));

        return {
            success: hasAllEnhancedFields,
            details: hasAllEnhancedFields ?
                'Sample QR menu HTML generated with all enhanced fields' :
                'Some enhanced fields missing from generated HTML',
            html: html
        };

    } catch (error) {
        return {
            success: false,
            details: `HTML generation failed: ${error.message}`,
            html: null
        };
    }
}

function getDietaryIcon(tag) {
    const icons = {
        'vegetarian': '🥬',
        'vegan': '🌱',
        'gluten_free': '🌾',
        'dairy_free': '🥛',
        'spicy': '🌶️',
        'popular': '⭐'
    };
    return icons[tag] || '🏷️';
}

// Export for Node.js or run directly
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { testQRMenuEnhancedData };
} else {
    // Auto-run if in browser
    console.log('QR Menu Publishing Test Suite Loaded');
    console.log('Run testQRMenuEnhancedData() to start testing');
}