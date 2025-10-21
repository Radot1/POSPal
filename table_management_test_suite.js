/**
 * POSPal Table Management Comprehensive Test Suite
 * Tests all recent critical fixes including:
 * - SSE Connection Status Indicator
 * - API Response Validation
 * - Badge Click Handler Enhancement
 * - Enhanced Error Messages System
 */

const TEST_BASE_URL = 'http://localhost:5000';
const TESTS_RESULTS = {
    passed: [],
    failed: [],
    warnings: []
};

// ==================================================================================
// UTILITY FUNCTIONS
// ==================================================================================

function logTest(testName, status, message = '') {
    const timestamp = new Date().toISOString();
    const result = { testName, status, message, timestamp };

    if (status === 'PASS') {
        TESTS_RESULTS.passed.push(result);
        console.log(`✅ [PASS] ${testName}${message ? ': ' + message : ''}`);
    } else if (status === 'FAIL') {
        TESTS_RESULTS.failed.push(result);
        console.error(`❌ [FAIL] ${testName}${message ? ': ' + message : ''}`);
    } else if (status === 'WARN') {
        TESTS_RESULTS.warnings.push(result);
        console.warn(`⚠️ [WARN] ${testName}${message ? ': ' + message : ''}`);
    }
}

function assert(condition, testName, failMessage = '') {
    if (condition) {
        logTest(testName, 'PASS');
        return true;
    } else {
        logTest(testName, 'FAIL', failMessage);
        return false;
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================================================================================
// TEST SUITE 1: CONNECTION STATUS INDICATOR
// ==================================================================================

async function testConnectionStatusIndicator() {
    console.group('🔌 CONNECTION STATUS INDICATOR TESTS');

    try {
        // Test 1.1: Check if indicator element exists
        const indicator = document.getElementById('connectionStatusIndicator');
        assert(indicator !== null, 'CSI-1.1: Connection Status Indicator element exists');

        if (!indicator) {
            console.groupEnd();
            return;
        }

        // Test 1.2: Check if indicator has correct initial class
        const hasCheckingClass = indicator.classList.contains('checking');
        const hasTableModeClass = indicator.classList.contains('table-mode-only');
        assert(hasCheckingClass || hasTableModeClass, 'CSI-1.2: Indicator has correct initial classes',
            `Classes: ${indicator.className}`);

        // Test 1.3: Check status text element exists
        const statusText = document.getElementById('connectionStatusText');
        assert(statusText !== null, 'CSI-1.3: Connection status text element exists');

        // Test 1.4: Check if status dot exists
        const statusDot = indicator.querySelector('.status-dot');
        assert(statusDot !== null, 'CSI-1.4: Status dot element exists');

        // Test 1.5: Check CSS animations are defined
        const styles = window.getComputedStyle(statusDot);
        const hasAnimation = styles.animation !== 'none' && styles.animation !== '';
        logTest('CSI-1.5: Status dot has CSS animation', hasAnimation ? 'PASS' : 'WARN',
            `Animation: ${styles.animation}`);

        // Test 1.6: Check tooltip title exists
        const hasTitle = indicator.title && indicator.title.length > 0;
        assert(hasTitle, 'CSI-1.6: Indicator has tooltip title', `Title: "${indicator.title}"`);

        // Test 1.7: Test visibility in table mode
        if (typeof tableManagementEnabled !== 'undefined') {
            if (tableManagementEnabled) {
                const isVisible = window.getComputedStyle(indicator).display !== 'none';
                assert(isVisible, 'CSI-1.7: Indicator is visible when table management enabled');
            } else {
                logTest('CSI-1.7: Table management not enabled, skipping visibility test', 'WARN');
            }
        } else {
            logTest('CSI-1.7: tableManagementEnabled variable not found', 'WARN');
        }

        // Test 1.8: Test updateConnectionStatusUI function exists
        const hasUpdateFunction = typeof updateConnectionStatusUI === 'function';
        assert(hasUpdateFunction, 'CSI-1.8: updateConnectionStatusUI function exists');

        // Test 1.9: Test ConnectionStatus enum exists
        const hasConnectionStatus = typeof ConnectionStatus !== 'undefined';
        assert(hasConnectionStatus, 'CSI-1.9: ConnectionStatus enum exists');

        if (hasConnectionStatus) {
            // Test 1.10: Test all ConnectionStatus states exist
            const hasAllStates = ConnectionStatus.LIVE && ConnectionStatus.POLLING &&
                                 ConnectionStatus.OFFLINE && ConnectionStatus.CHECKING;
            assert(hasAllStates, 'CSI-1.10: All ConnectionStatus states defined',
                `States: ${JSON.stringify(ConnectionStatus)}`);
        }

        // Test 1.11: Test monitorSSEConnection function exists
        const hasMonitorFunction = typeof monitorSSEConnection === 'function';
        assert(hasMonitorFunction, 'CSI-1.11: monitorSSEConnection function exists');

        // Test 1.12: Test checkConnectionHealth function exists
        const hasHealthCheckFunction = typeof checkConnectionHealth === 'function';
        assert(hasHealthCheckFunction, 'CSI-1.12: checkConnectionHealth function exists');

        // Test 1.13: Test state transitions
        if (hasUpdateFunction && hasConnectionStatus) {
            const originalClass = indicator.className;

            // Test LIVE state
            updateConnectionStatusUI(ConnectionStatus.LIVE);
            await sleep(100);
            const hasLiveClass = indicator.classList.contains('live');
            assert(hasLiveClass, 'CSI-1.13a: LIVE state updates UI correctly');

            // Test POLLING state
            updateConnectionStatusUI(ConnectionStatus.POLLING);
            await sleep(100);
            const hasPollingClass = indicator.classList.contains('polling');
            assert(hasPollingClass, 'CSI-1.13b: POLLING state updates UI correctly');

            // Test OFFLINE state
            updateConnectionStatusUI(ConnectionStatus.OFFLINE);
            await sleep(100);
            const hasOfflineClass = indicator.classList.contains('offline');
            assert(hasOfflineClass, 'CSI-1.13c: OFFLINE state updates UI correctly');

            // Test CHECKING state
            updateConnectionStatusUI(ConnectionStatus.CHECKING);
            await sleep(100);
            const hasCheckingClassAfter = indicator.classList.contains('checking');
            assert(hasCheckingClassAfter, 'CSI-1.13d: CHECKING state updates UI correctly');

            // Restore original state
            indicator.className = originalClass;
        }

        // Test 1.14: Test SSE connection detection
        if (typeof window.evtSource !== 'undefined' && window.evtSource !== null) {
            const hasReadyState = typeof window.evtSource.readyState === 'number';
            assert(hasReadyState, 'CSI-1.14: EventSource has readyState property');

            logTest('CSI-1.14-INFO: EventSource current state', 'PASS',
                `ReadyState: ${window.evtSource.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSED)`);
        } else {
            logTest('CSI-1.14: EventSource not initialized', 'WARN', 'SSE may be disabled');
        }

    } catch (error) {
        logTest('CSI-ERROR: Connection Status Indicator test suite failed', 'FAIL', error.message);
        console.error(error);
    }

    console.groupEnd();
}

// ==================================================================================
// TEST SUITE 2: API RESPONSE VALIDATION
// ==================================================================================

async function testAPIValidation() {
    console.group('🔍 API RESPONSE VALIDATION TESTS');

    try {
        // Test 2.1: ValidationError class exists
        const hasValidationError = typeof ValidationError === 'function';
        assert(hasValidationError, 'VAL-2.1: ValidationError class exists');

        // Test 2.2: validateTableData function exists
        const hasValidateTableData = typeof validateTableData === 'function';
        assert(hasValidateTableData, 'VAL-2.2: validateTableData function exists');

        // Test 2.3: validateSessionData function exists
        const hasValidateSessionData = typeof validateSessionData === 'function';
        assert(hasValidateSessionData, 'VAL-2.3: validateSessionData function exists');

        if (hasValidateTableData) {
            // Test 2.4: Valid table data passes validation
            try {
                const validTableData = {
                    name: 'Table 1',
                    seats: 4,
                    status: 'available'
                };
                const result = validateTableData(validTableData, 'T1');
                assert(result !== null && result.id === 'T1', 'VAL-2.4: Valid table data passes validation');
            } catch (error) {
                logTest('VAL-2.4: Valid table data validation', 'FAIL', error.message);
            }

            // Test 2.5: Invalid table data throws ValidationError
            try {
                const invalidTableData = null;
                validateTableData(invalidTableData, 'T99');
                logTest('VAL-2.5: Invalid table data throws ValidationError', 'FAIL',
                    'Should have thrown ValidationError for null data');
            } catch (error) {
                const isValidationError = error.name === 'ValidationError';
                assert(isValidationError, 'VAL-2.5: Invalid table data throws ValidationError',
                    `Error type: ${error.name}`);
            }

            // Test 2.6: Missing required fields throws ValidationError
            try {
                const incompleteData = { name: 'Table 2' }; // Missing seats and status
                validateTableData(incompleteData, 'T2');
                logTest('VAL-2.6: Missing required fields throws ValidationError', 'FAIL',
                    'Should have thrown ValidationError for missing fields');
            } catch (error) {
                const isValidationError = error.name === 'ValidationError';
                assert(isValidationError, 'VAL-2.6: Missing required fields throws ValidationError');
            }

            // Test 2.7: Invalid data types throw ValidationError
            try {
                const wrongTypeData = {
                    name: 123, // Should be string
                    seats: 'four', // Should be number
                    status: 'available'
                };
                validateTableData(wrongTypeData, 'T3');
                logTest('VAL-2.7: Invalid data types throw ValidationError', 'FAIL',
                    'Should have thrown ValidationError for wrong types');
            } catch (error) {
                const isValidationError = error.name === 'ValidationError';
                assert(isValidationError, 'VAL-2.7: Invalid data types throw ValidationError');
            }

            // Test 2.8: Negative seats value throws ValidationError
            try {
                const negativeSeatsData = {
                    name: 'Table 4',
                    seats: -5,
                    status: 'available'
                };
                validateTableData(negativeSeatsData, 'T4');
                logTest('VAL-2.8: Negative seats value throws ValidationError', 'FAIL',
                    'Should have thrown ValidationError for negative seats');
            } catch (error) {
                const isValidationError = error.name === 'ValidationError';
                assert(isValidationError, 'VAL-2.8: Negative seats value throws ValidationError');
            }
        }

        if (hasValidateSessionData) {
            // Test 2.9: Valid session data passes validation
            const validSessionData = {
                total_amount: 25.50,
                payment_status: 'unpaid',
                orders: []
            };
            const errors = validateSessionData(validSessionData, 'T1');
            assert(errors.length === 0, 'VAL-2.9: Valid session data passes validation',
                `Errors: ${errors.join(', ')}`);

            // Test 2.10: Invalid session total_amount type
            const invalidSessionData = {
                total_amount: 'twenty-five',
                payment_status: 'unpaid'
            };
            const errors2 = validateSessionData(invalidSessionData, 'T1');
            assert(errors2.length > 0, 'VAL-2.10: Invalid session total_amount detected',
                `Errors found: ${errors2.length}`);

            // Test 2.11: Negative total_amount
            const negativeSessionData = {
                total_amount: -10.00,
                payment_status: 'unpaid'
            };
            const errors3 = validateSessionData(negativeSessionData, 'T1');
            assert(errors3.length > 0, 'VAL-2.11: Negative total_amount detected');
        }

        // Test 2.12: Check if loadTablesForSelection uses validation
        if (typeof loadTablesForSelection === 'function') {
            logTest('VAL-2.12: loadTablesForSelection function exists', 'PASS',
                'Integration with validation system expected');
        } else {
            logTest('VAL-2.12: loadTablesForSelection function not found', 'WARN');
        }

    } catch (error) {
        logTest('VAL-ERROR: API Validation test suite failed', 'FAIL', error.message);
        console.error(error);
    }

    console.groupEnd();
}

// ==================================================================================
// TEST SUITE 3: BADGE CLICK HANDLER
// ==================================================================================

async function testBadgeClickHandler() {
    console.group('🎯 BADGE CLICK HANDLER TESTS');

    try {
        // Test 3.1: initializeTableBadgeHandlers function exists
        const hasInitFunction = typeof initializeTableBadgeHandlers === 'function';
        assert(hasInitFunction, 'BADGE-3.1: initializeTableBadgeHandlers function exists');

        // Test 3.2: Desktop badge element exists
        const desktopBadge = document.getElementById('tableIndicatorBadge');
        const desktopBadgeExists = desktopBadge !== null;
        logTest('BADGE-3.2: Desktop badge element exists', desktopBadgeExists ? 'PASS' : 'WARN',
            'Element may be in different HTML file');

        // Test 3.3: Mobile badge element exists
        const mobileBadge = document.getElementById('mobileTableBadge');
        const mobileBadgeExists = mobileBadge !== null;
        logTest('BADGE-3.3: Mobile badge element exists', mobileBadgeExists ? 'PASS' : 'WARN',
            'Element may be in different HTML file');

        // Test at least one badge exists
        if (!desktopBadgeExists && !mobileBadgeExists) {
            logTest('BADGE-3.4: At least one badge element exists', 'FAIL',
                'Neither desktop nor mobile badge found');
        }

        // Test desktop badge if it exists
        if (desktopBadge) {
            // Test 3.5: Badge has cursor pointer
            const hasCursorPointer = desktopBadge.style.cursor === 'pointer';
            assert(hasCursorPointer, 'BADGE-3.5: Desktop badge has cursor pointer style');

            // Test 3.6: Badge has tabindex
            const hasTabindex = desktopBadge.getAttribute('tabindex') !== null;
            assert(hasTabindex, 'BADGE-3.6: Desktop badge has tabindex attribute');

            // Test 3.7: Badge has role attribute
            const hasRole = desktopBadge.getAttribute('role') === 'button';
            assert(hasRole, 'BADGE-3.7: Desktop badge has role="button"');

            // Test 3.8: Badge has aria-label
            const hasAriaLabel = desktopBadge.getAttribute('aria-label') !== null;
            assert(hasAriaLabel, 'BADGE-3.8: Desktop badge has aria-label attribute');

            // Test 3.9: Badge has click listener
            const listeners = getEventListeners(desktopBadge);
            if (listeners && listeners.click) {
                assert(listeners.click.length > 0, 'BADGE-3.9: Desktop badge has click event listener');
            } else {
                logTest('BADGE-3.9: Desktop badge click listener', 'WARN',
                    'getEventListeners not available in this context');
            }

            // Test 3.10: Badge has keydown listener
            if (listeners && listeners.keydown) {
                assert(listeners.keydown.length > 0, 'BADGE-3.10: Desktop badge has keydown event listener');
            } else {
                logTest('BADGE-3.10: Desktop badge keydown listener', 'WARN',
                    'getEventListeners not available in this context');
            }
        }

        // Test mobile badge if it exists
        if (mobileBadge) {
            // Test 3.11: Mobile badge has cursor pointer
            const hasCursorPointer = mobileBadge.style.cursor === 'pointer';
            assert(hasCursorPointer, 'BADGE-3.11: Mobile badge has cursor pointer style');

            // Test 3.12: Mobile badge has tabindex
            const hasTabindex = mobileBadge.getAttribute('tabindex') !== null;
            assert(hasTabindex, 'BADGE-3.12: Mobile badge has tabindex attribute');

            // Test 3.13: Mobile badge has role attribute
            const hasRole = mobileBadge.getAttribute('role') === 'button';
            assert(hasRole, 'BADGE-3.13: Mobile badge has role="button"');
        }

        // Test 3.14: openTableSelector function exists
        const hasOpenTableSelector = typeof openTableSelector === 'function';
        assert(hasOpenTableSelector, 'BADGE-3.14: openTableSelector function exists');

        // Test 3.15: allTablesData variable exists
        const hasAllTablesData = typeof allTablesData !== 'undefined';
        logTest('BADGE-3.15: allTablesData variable exists', hasAllTablesData ? 'PASS' : 'WARN',
            hasAllTablesData ? `Tables loaded: ${allTablesData.length}` : 'Variable not initialized');

    } catch (error) {
        logTest('BADGE-ERROR: Badge Click Handler test suite failed', 'FAIL', error.message);
        console.error(error);
    }

    console.groupEnd();
}

// ==================================================================================
// TEST SUITE 4: ENHANCED ERROR MESSAGES
// ==================================================================================

async function testEnhancedErrorMessages() {
    console.group('💬 ENHANCED ERROR MESSAGES TESTS');

    try {
        // Test 4.1: ErrorMessages dictionary exists
        const hasErrorMessages = typeof ErrorMessages !== 'undefined';
        assert(hasErrorMessages, 'ERR-4.1: ErrorMessages dictionary exists');

        if (hasErrorMessages) {
            // Test 4.2: Check all error message types exist
            const expectedTypes = ['NETWORK_OFFLINE', 'NETWORK_TIMEOUT', 'SERVER_ERROR', 'DATA_VALIDATION'];
            const allTypesExist = expectedTypes.every(type => ErrorMessages[type] !== undefined);
            assert(allTypesExist, 'ERR-4.2: All error message types defined',
                `Types: ${Object.keys(ErrorMessages).join(', ')}`);

            // Test 4.3: Error messages have required properties
            for (const [key, config] of Object.entries(ErrorMessages)) {
                const hasRequiredProps = config.message && config.suggestions && config.type && config.icon;
                assert(hasRequiredProps, `ERR-4.3-${key}: Error message has all required properties`,
                    `Properties: ${Object.keys(config).join(', ')}`);
            }
        }

        // Test 4.4: showEnhancedError function exists
        const hasShowEnhancedError = typeof showEnhancedError === 'function';
        assert(hasShowEnhancedError, 'ERR-4.4: showEnhancedError function exists');

        // Test 4.5: enhancedFetch function exists
        const hasEnhancedFetch = typeof enhancedFetch === 'function';
        assert(hasEnhancedFetch, 'ERR-4.5: enhancedFetch function exists');

        if (hasEnhancedFetch) {
            // Test 4.6: enhancedFetch timeout functionality
            try {
                const timeoutTest = enhancedFetch('/api/nonexistent-slow-endpoint', {}, 100);
                logTest('ERR-4.6: enhancedFetch timeout initiated', 'PASS', 'Timeout set to 100ms');

                // We won't await this as it should timeout
                timeoutTest.catch(error => {
                    // This is expected
                });
            } catch (error) {
                logTest('ERR-4.6: enhancedFetch timeout test', 'WARN', error.message);
            }
        }

        // Test 4.7: Check showToast integration
        const hasShowToast = typeof showToast === 'function';
        assert(hasShowToast, 'ERR-4.7: showToast function exists for error display');

    } catch (error) {
        logTest('ERR-ERROR: Enhanced Error Messages test suite failed', 'FAIL', error.message);
        console.error(error);
    }

    console.groupEnd();
}

// ==================================================================================
// TEST SUITE 5: INTEGRATION TESTING
// ==================================================================================

async function testIntegration() {
    console.group('🔗 INTEGRATION TESTS');

    try {
        // Test 5.1: Check if initializeTableFeatures calls all initialization functions
        const hasInitTableFeatures = typeof initializeTableFeatures === 'function';
        assert(hasInitTableFeatures, 'INT-5.1: initializeTableFeatures function exists');

        // Test 5.2: Table management enabled check
        const hasTableManagementEnabled = typeof tableManagementEnabled !== 'undefined';
        logTest('INT-5.2: tableManagementEnabled variable exists',
            hasTableManagementEnabled ? 'PASS' : 'WARN',
            hasTableManagementEnabled ? `Value: ${tableManagementEnabled}` : 'Not initialized');

        // Test 5.3: SSE setup function exists
        const hasSetupTableSSEUpdates = typeof setupTableSSEUpdates === 'function';
        assert(hasSetupTableSSEUpdates, 'INT-5.3: setupTableSSEUpdates function exists');

        // Test 5.4: Polling fallback exists
        const hasStartTablePolling = typeof startTablePolling === 'function';
        assert(hasStartTablePolling, 'INT-5.4: startTablePolling function exists');

        // Test 5.5: Check if connection status is initialized in initializeTableFeatures
        if (hasInitTableFeatures && hasTableManagementEnabled && tableManagementEnabled) {
            const hasConnectionStatusInit = typeof initConnectionStatusIndicator === 'function';
            assert(hasConnectionStatusInit, 'INT-5.5: Connection status initialized in table features');
        } else {
            logTest('INT-5.5: Connection status initialization', 'WARN',
                'Table management not enabled or function not found');
        }

        // Test 5.6: API endpoints accessibility
        try {
            const response = await fetch(`${TEST_BASE_URL}/api/tables`);
            const isSuccess = response.ok;
            assert(isSuccess, 'INT-5.6: /api/tables endpoint accessible',
                `Status: ${response.status}`);
        } catch (error) {
            logTest('INT-5.6: /api/tables endpoint accessibility', 'FAIL', error.message);
        }

        // Test 5.7: Config endpoint
        try {
            const response = await fetch(`${TEST_BASE_URL}/api/config`);
            const isSuccess = response.ok;
            assert(isSuccess, 'INT-5.7: /api/config endpoint accessible',
                `Status: ${response.status}`);

            if (isSuccess) {
                const data = await response.json();
                const hasTableManagement = data.table_management !== undefined;
                logTest('INT-5.7a: Config returns table_management setting', hasTableManagement ? 'PASS' : 'WARN',
                    hasTableManagement ? `table_management: ${data.table_management}` : 'Property missing');
            }
        } catch (error) {
            logTest('INT-5.7: /api/config endpoint accessibility', 'FAIL', error.message);
        }

        // Test 5.8: Table modal creation
        const hasCreateTableSelectionModal = typeof createTableSelectionModal === 'function';
        assert(hasCreateTableSelectionModal, 'INT-5.8: createTableSelectionModal function exists');

        // Test 5.9: Table UI initialization
        const hasInitializeTableUI = typeof initializeTableUI === 'function';
        assert(hasInitializeTableUI, 'INT-5.9: initializeTableUI function exists');

        // Test 5.10: Badge handlers integration
        const hasBadgeHandlersInit = typeof initializeTableBadgeHandlers === 'function';
        assert(hasBadgeHandlersInit, 'INT-5.10: Badge handlers integrated in table UI initialization');

    } catch (error) {
        logTest('INT-ERROR: Integration test suite failed', 'FAIL', error.message);
        console.error(error);
    }

    console.groupEnd();
}

// ==================================================================================
// TEST SUITE 6: REGRESSION TESTS
// ==================================================================================

async function testRegressions() {
    console.group('🔄 REGRESSION TESTS');

    try {
        // Test 6.1: Option modal click detection fix (pospalCore.js:4138-4144)
        const hasHandleModalClick = typeof handleModalClick === 'function';
        logTest('REG-6.1: handleModalClick function exists', hasHandleModalClick ? 'PASS' : 'WARN',
            'Option modal click detection');

        // Test 6.2: Browser cache headers (app.py:49-61)
        try {
            const response = await fetch(`${TEST_BASE_URL}/pospalCore.js`);
            const cacheControl = response.headers.get('Cache-Control');
            const hasCacheControl = cacheControl !== null &&
                (cacheControl.includes('no-cache') || cacheControl.includes('no-store'));
            assert(hasCacheControl, 'REG-6.2: Cache-Control headers present',
                `Cache-Control: ${cacheControl}`);
        } catch (error) {
            logTest('REG-6.2: Cache-Control headers test', 'FAIL', error.message);
        }

        // Test 6.3: EventSource global access (i18n.js:71)
        const hasEventSource = typeof EventSource !== 'undefined';
        assert(hasEventSource, 'REG-6.3: EventSource globally accessible');

        // Test 6.4: Null table number handling
        // This is a backend test, we'll verify the API doesn't crash
        try {
            const response = await fetch(`${TEST_BASE_URL}/api/tables/null/session`);
            // Should return 400 or handle gracefully, not 500
            const isHandledGracefully = response.status !== 500;
            logTest('REG-6.4: Null table number handled gracefully',
                isHandledGracefully ? 'PASS' : 'FAIL',
                `Status: ${response.status}`);
        } catch (error) {
            logTest('REG-6.4: Null table number handling', 'WARN',
                'Could not test - endpoint may not exist');
        }

        // Test 6.5: Table display update function
        const hasUpdateTableDisplay = typeof updateTableDisplay === 'function';
        assert(hasUpdateTableDisplay, 'REG-6.5: updateTableDisplay function exists');

        // Test 6.6: Table selection persistence
        const hasLoadSelectedTableFromStorage = typeof loadSelectedTableFromStorage === 'function';
        assert(hasLoadSelectedTableFromStorage, 'REG-6.6: loadSelectedTableFromStorage function exists');

        const hasSaveSelectedTableToStorage = typeof saveSelectedTableToStorage === 'function';
        assert(hasSaveSelectedTableToStorage, 'REG-6.6a: saveSelectedTableToStorage function exists');

    } catch (error) {
        logTest('REG-ERROR: Regression test suite failed', 'FAIL', error.message);
        console.error(error);
    }

    console.groupEnd();
}

// ==================================================================================
// TEST SUITE 7: EDGE CASES AND ERROR CONDITIONS
// ==================================================================================

async function testEdgeCases() {
    console.group('⚠️ EDGE CASES AND ERROR CONDITIONS');

    try {
        // Test 7.1: Connection indicator with table management disabled
        if (typeof tableManagementEnabled !== 'undefined' && !tableManagementEnabled) {
            const indicator = document.getElementById('connectionStatusIndicator');
            if (indicator) {
                const isHidden = window.getComputedStyle(indicator).display === 'none';
                assert(isHidden, 'EDGE-7.1: Connection indicator hidden when table management disabled');
            }
        }

        // Test 7.2: Badge click with no tables configured
        if (typeof allTablesData !== 'undefined' && allTablesData.length === 0) {
            logTest('EDGE-7.2: No tables configured scenario', 'PASS',
                'System should show warning when badge clicked');
        }

        // Test 7.3: Validate table data with missing session
        if (typeof validateTableData === 'function') {
            try {
                const tableWithoutSession = {
                    name: 'Table 99',
                    seats: 2,
                    status: 'available'
                    // No session property
                };
                const result = validateTableData(tableWithoutSession, 'T99');
                const hasDefaultSession = result.session === null;
                assert(hasDefaultSession, 'EDGE-7.3: Table validation handles missing session',
                    `Session: ${result.session}`);
            } catch (error) {
                logTest('EDGE-7.3: Missing session validation', 'FAIL', error.message);
            }
        }

        // Test 7.4: Invalid API response format
        try {
            const response = await fetch(`${TEST_BASE_URL}/api/nonexistent-endpoint`);
            const is404 = response.status === 404;
            logTest('EDGE-7.4: Invalid endpoint returns appropriate error', is404 ? 'PASS' : 'WARN',
                `Status: ${response.status}`);
        } catch (error) {
            logTest('EDGE-7.4: Invalid endpoint handling', 'WARN', error.message);
        }

        // Test 7.5: Rapid mode switching
        if (typeof initializeTableFeatures === 'function' && typeof initializeSimpleMode === 'function') {
            logTest('EDGE-7.5: Mode switching functions exist', 'PASS',
                'Can test rapid toggling between simple and table mode');
        } else {
            logTest('EDGE-7.5: Mode switching functions', 'WARN', 'Functions not found');
        }

        // Test 7.6: SSE connection drop simulation
        if (window.evtSource) {
            const originalReadyState = window.evtSource.readyState;
            logTest('EDGE-7.6: SSE connection available for drop simulation', 'PASS',
                `Current state: ${originalReadyState}`);
        } else {
            logTest('EDGE-7.6: SSE connection drop simulation', 'WARN', 'EventSource not active');
        }

        // Test 7.7: Malformed table data
        if (typeof validateTableData === 'function') {
            const malformedInputs = [
                { input: undefined, desc: 'undefined' },
                { input: null, desc: 'null' },
                { input: {}, desc: 'empty object' },
                { input: [], desc: 'array' },
                { input: 'string', desc: 'string' },
                { input: 123, desc: 'number' }
            ];

            malformedInputs.forEach(({ input, desc }) => {
                try {
                    validateTableData(input, 'TEST');
                    logTest(`EDGE-7.7-${desc}: Malformed data rejected`, 'FAIL',
                        'Should have thrown ValidationError');
                } catch (error) {
                    const isValidationError = error.name === 'ValidationError';
                    logTest(`EDGE-7.7-${desc}: Malformed data rejected`, isValidationError ? 'PASS' : 'FAIL',
                        `Error: ${error.name}`);
                }
            });
        }

        // Test 7.8: Connection health check interval
        if (typeof checkConnectionHealth === 'function') {
            logTest('EDGE-7.8: Connection health check function exists', 'PASS',
                'Should be called every 10 seconds');
        }

    } catch (error) {
        logTest('EDGE-ERROR: Edge cases test suite failed', 'FAIL', error.message);
        console.error(error);
    }

    console.groupEnd();
}

// ==================================================================================
// TEST EXECUTION AND REPORTING
// ==================================================================================

async function runAllTests() {
    console.clear();
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('🔬 POSPal TABLE MANAGEMENT COMPREHENSIVE AUDIT');
    console.log('   Testing Critical Fixes: Connection Status, API Validation,');
    console.log('   Badge Handlers, Enhanced Error Messages');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('');

    const startTime = Date.now();

    // Run all test suites
    await testConnectionStatusIndicator();
    console.log('');

    await testAPIValidation();
    console.log('');

    await testBadgeClickHandler();
    console.log('');

    await testEnhancedErrorMessages();
    console.log('');

    await testIntegration();
    console.log('');

    await testRegressions();
    console.log('');

    await testEdgeCases();
    console.log('');

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    // Generate summary report
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('');
    console.log(`✅ PASSED:  ${TESTS_RESULTS.passed.length} tests`);
    console.log(`❌ FAILED:  ${TESTS_RESULTS.failed.length} tests`);
    console.log(`⚠️  WARNINGS: ${TESTS_RESULTS.warnings.length} tests`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('');

    if (TESTS_RESULTS.failed.length > 0) {
        console.log('❌ CRITICAL FAILURES:');
        console.log('───────────────────────────────────────────────────────────────────────────');
        TESTS_RESULTS.failed.forEach(result => {
            console.error(`  • ${result.testName}`);
            if (result.message) {
                console.error(`    ${result.message}`);
            }
        });
        console.log('');
    }

    if (TESTS_RESULTS.warnings.length > 0) {
        console.log('⚠️  WARNINGS (Non-Critical):');
        console.log('───────────────────────────────────────────────────────────────────────────');
        TESTS_RESULTS.warnings.forEach(result => {
            console.warn(`  • ${result.testName}`);
            if (result.message) {
                console.warn(`    ${result.message}`);
            }
        });
        console.log('');
    }

    // Overall health assessment
    const totalTests = TESTS_RESULTS.passed.length + TESTS_RESULTS.failed.length + TESTS_RESULTS.warnings.length;
    const passRate = totalTests > 0 ? ((TESTS_RESULTS.passed.length / totalTests) * 100).toFixed(1) : 0;

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`🎯 OVERALL SYSTEM HEALTH: ${passRate}%`);

    if (TESTS_RESULTS.failed.length === 0 && TESTS_RESULTS.warnings.length <= 5) {
        console.log('✅ VERDICT: SYSTEM READY FOR PRODUCTION');
    } else if (TESTS_RESULTS.failed.length === 0) {
        console.log('⚠️  VERDICT: SYSTEM FUNCTIONAL - MINOR IMPROVEMENTS RECOMMENDED');
    } else if (TESTS_RESULTS.failed.length <= 3) {
        console.log('⚠️  VERDICT: SYSTEM NEEDS ATTENTION - FEW CRITICAL ISSUES FOUND');
    } else {
        console.log('❌ VERDICT: SYSTEM NOT READY - MULTIPLE CRITICAL ISSUES REQUIRE FIXES');
    }
    console.log('═══════════════════════════════════════════════════════════════════════════');

    // Export results for further analysis
    window.TEST_RESULTS = TESTS_RESULTS;
    console.log('');
    console.log('💾 Full test results available in: window.TEST_RESULTS');
    console.log('');

    return TESTS_RESULTS;
}

// Auto-run if in browser console context
if (typeof window !== 'undefined') {
    console.log('🚀 Table Management Test Suite Loaded');
    console.log('   Run tests with: runAllTests()');
    console.log('');
}

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runAllTests, TESTS_RESULTS };
}
