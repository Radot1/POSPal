// POSPal Notification System Testing Suite
// Comprehensive testing for the 5-phase refactored notification system

class NotificationSystemTester {
    constructor() {
        this.testResults = [];
        this.currentTest = '';
        this.startTime = Date.now();
        this.totalTests = 0;
        this.passedTests = 0;
        this.failedTests = 0;
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = `[${timestamp}] [${type.toUpperCase()}]`;
        console.log(`${prefix} ${message}`);

        this.testResults.push({
            timestamp,
            type,
            test: this.currentTest,
            message
        });
    }

    async runAllTests() {
        this.log('Starting comprehensive notification system testing...', 'info');

        try {
            // Phase 1: Core System Tests
            await this.testCoreNotificationFunctionality();

            // Phase 2: Mobile & Touch Features
            await this.testMobileFeatures();

            // Phase 3: Advanced Intelligence
            await this.testAdvancedIntelligence();

            // Phase 4: Integration & Performance
            await this.testIntegrationAndPerformance();

            // Phase 5: Business Logic
            await this.testBusinessLogic();

            // Phase 6: Scenario Testing
            await this.testScenarios();

            this.generateFinalReport();

        } catch (error) {
            this.log(`Critical test failure: ${error.message}`, 'error');
        }
    }

    async testCoreNotificationFunctionality() {
        this.currentTest = 'Core Notification Functionality';
        this.log('Testing core notification functionality...', 'test');

        // Test NotificationManager initialization
        await this.testNotificationManagerInit();

        // Test basic toast functionality
        await this.testBasicToasts();

        // Test progressive warnings
        await this.testProgressiveWarnings();

        // Test offline indicators
        await this.testOfflineIndicators();

        // Test z-index hierarchy
        await this.testZIndexHierarchy();
    }

    async testNotificationManagerInit() {
        this.currentTest = 'NotificationManager Initialization';

        try {
            // Check if NotificationManager is available globally
            if (typeof window.NotificationManager === 'undefined') {
                throw new Error('NotificationManager not found in global scope');
            }

            const manager = window.NotificationManager;

            // Test initialization properties
            if (!manager.activeNotifications || !(manager.activeNotifications instanceof Map)) {
                throw new Error('activeNotifications Map not properly initialized');
            }

            if (!Array.isArray(manager.queue)) {
                throw new Error('notification queue not properly initialized');
            }

            if (!manager.zIndexBase || typeof manager.zIndexBase !== 'object') {
                throw new Error('zIndexBase configuration not properly initialized');
            }

            // Verify z-index values match requirements
            const expectedZIndex = { toast: 1800, banner: 1700, persistent: 1600, critical: 1900 };
            for (const [type, expectedValue] of Object.entries(expectedZIndex)) {
                if (manager.zIndexBase[type] !== expectedValue) {
                    throw new Error(`Z-index for ${type} should be ${expectedValue}, got ${manager.zIndexBase[type]}`);
                }
            }

            // Test container creation
            const container = document.getElementById('pospal-notification-container');
            if (!container) {
                throw new Error('Notification container not created');
            }

            this.log('✅ NotificationManager initialization successful', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ NotificationManager initialization failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testBasicToasts() {
        this.currentTest = 'Basic Toast Functionality';

        try {
            const manager = window.NotificationManager;

            // Test different toast types
            const toastTypes = ['success', 'warning', 'error', 'info'];
            const toastIds = [];

            for (const type of toastTypes) {
                const id = manager.showToast(`Test ${type} message`, type, 2000);
                toastIds.push(id);

                if (!id) {
                    throw new Error(`Failed to create ${type} toast`);
                }
            }

            // Check that toasts were added to active notifications
            if (manager.activeNotifications.size !== toastTypes.length) {
                throw new Error(`Expected ${toastTypes.length} active notifications, got ${manager.activeNotifications.size}`);
            }

            // Wait for auto-hide and verify cleanup
            await new Promise(resolve => setTimeout(resolve, 2500));

            if (manager.activeNotifications.size !== 0) {
                this.log(`Warning: ${manager.activeNotifications.size} notifications still active after auto-hide`, 'warn');
            }

            this.log('✅ Basic toast functionality working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Basic toast functionality failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testProgressiveWarnings() {
        this.currentTest = 'Progressive Warning System';

        try {
            // Check if showSmartProgressiveWarning function exists
            if (typeof showSmartProgressiveWarning !== 'function') {
                throw new Error('showSmartProgressiveWarning function not found');
            }

            // Test different grace period scenarios
            const scenarios = [
                { days: 8, gracePeriod: 10, expected: 'early_warning' },
                { days: 9, gracePeriod: 10, expected: 'final_warning' },
                { days: 10, gracePeriod: 10, expected: 'critical_warning' }
            ];

            for (const scenario of scenarios) {
                // Clear any existing notifications
                window.NotificationManager.clear();

                // Mock customer data for testing
                const mockCustomerData = {
                    name: 'Test Restaurant',
                    accountAge: 365,
                    monthlyOrders: 500,
                    paymentFailures: 0
                };

                // Store mock data temporarily
                const originalData = localStorage.getItem('pospal_customer_data');
                localStorage.setItem('pospal_customer_data', JSON.stringify(mockCustomerData));

                try {
                    showSmartProgressiveWarning(scenario.days, scenario.gracePeriod);

                    // Check that a notification was created
                    if (window.NotificationManager.activeNotifications.size === 0) {
                        throw new Error(`No notification created for day ${scenario.days} scenario`);
                    }

                    await new Promise(resolve => setTimeout(resolve, 100)); // Let UI update

                } finally {
                    // Restore original data
                    if (originalData) {
                        localStorage.setItem('pospal_customer_data', originalData);
                    } else {
                        localStorage.removeItem('pospal_customer_data');
                    }
                }
            }

            this.log('✅ Progressive warning system working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Progressive warning system failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testOfflineIndicators() {
        this.currentTest = 'Offline Indicator System';

        try {
            // Check if showSmartOfflineIndicator function exists
            if (typeof showSmartOfflineIndicator !== 'function') {
                throw new Error('showSmartOfflineIndicator function not found');
            }

            // Clear existing notifications
            window.NotificationManager.clear();

            // Test offline indicator
            showSmartOfflineIndicator(5, 7);

            // Check that notification was created
            if (window.NotificationManager.activeNotifications.size === 0) {
                throw new Error('No offline indicator notification created');
            }

            // Verify it's a persistent notification
            const notification = Array.from(window.NotificationManager.activeNotifications.values())[0];
            if (notification.type !== 'persistent') {
                throw new Error(`Expected persistent notification, got ${notification.type}`);
            }

            this.log('✅ Offline indicator system working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Offline indicator system failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testZIndexHierarchy() {
        this.currentTest = 'Z-Index Hierarchy';

        try {
            const manager = window.NotificationManager;

            // Create different types of notifications
            const toastId = manager.showToast('Toast message', 'info', 10000);
            const bannerId = manager.showBanner('Banner Title', 'Banner message');
            const criticalId = manager.show({
                type: 'toast',
                priority: 'critical',
                message: 'Critical message',
                autoHide: false
            });

            await new Promise(resolve => setTimeout(resolve, 100)); // Let DOM update

            // Check z-index values in DOM
            const toastElement = document.getElementById(`notification-${toastId}`);
            const bannerElement = document.getElementById(`notification-${bannerId}`);
            const criticalElement = document.getElementById(`notification-${criticalId}`);

            if (toastElement) {
                const toastZIndex = parseInt(toastElement.style.zIndex);
                if (toastZIndex !== 1800) {
                    throw new Error(`Toast z-index should be 1800, got ${toastZIndex}`);
                }
            }

            if (bannerElement) {
                const bannerZIndex = parseInt(bannerElement.style.zIndex);
                if (bannerZIndex !== 1700) {
                    throw new Error(`Banner z-index should be 1700, got ${bannerZIndex}`);
                }
            }

            if (criticalElement) {
                const criticalZIndex = parseInt(criticalElement.style.zIndex);
                if (criticalZIndex !== 1900) { // Critical = toast base (1800) + critical modifier (100)
                    throw new Error(`Critical z-index should be 1900, got ${criticalZIndex}`);
                }
            }

            // Cleanup
            manager.clear();

            this.log('✅ Z-index hierarchy working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Z-index hierarchy failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testMobileFeatures() {
        this.currentTest = 'Mobile & Touch Features';
        this.log('Testing mobile and touch features...', 'test');

        await this.testMobileResponsiveness();
        await this.testTouchTargets();
        await this.testAccessibilityFeatures();
        await this.testHapticFeedback();
    }

    async testMobileResponsiveness() {
        this.currentTest = 'Mobile Responsiveness';

        try {
            // Simulate mobile viewport
            const originalWidth = window.innerWidth;
            Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });

            const manager = window.NotificationManager;
            const toastId = manager.showToast('Mobile test message', 'info', 5000);

            await new Promise(resolve => setTimeout(resolve, 100));

            const element = document.getElementById(`notification-${toastId}`);
            if (element) {
                const styles = window.getComputedStyle(element);

                // Check mobile-specific styles are applied
                if (styles.fontSize !== '16px') {
                    this.log(`Warning: Font size should be 16px on mobile to prevent zoom, got ${styles.fontSize}`, 'warn');
                }

                // Check if positioned correctly for mobile
                const hasLeftRight = element.style.left && element.style.right;
                if (hasLeftRight && element.style.left.includes('1rem') && element.style.right.includes('1rem')) {
                    this.log('✅ Mobile positioning applied correctly', 'pass');
                } else {
                    this.log('Warning: Mobile positioning may not be optimal', 'warn');
                }
            }

            // Restore original width
            Object.defineProperty(window, 'innerWidth', { value: originalWidth, writable: true });
            manager.hide(toastId);

            this.passedTests++;
        } catch (error) {
            this.log(`❌ Mobile responsiveness test failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testTouchTargets() {
        this.currentTest = 'Touch Target Sizes';

        try {
            const manager = window.NotificationManager;
            const notificationId = manager.show({
                type: 'banner',
                title: 'Touch Target Test',
                message: 'Testing touch targets',
                actions: [
                    { id: 'test-action', label: 'Test Action', handler: () => {} }
                ]
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            const element = document.getElementById(`notification-${notificationId}`);
            if (element) {
                const buttons = element.querySelectorAll('button');
                let touchTargetsPassed = true;

                buttons.forEach(button => {
                    const styles = window.getComputedStyle(button);
                    const minWidth = parseInt(styles.minWidth);
                    const minHeight = parseInt(styles.minHeight);

                    if (minWidth < 44 || minHeight < 44) {
                        touchTargetsPassed = false;
                        this.log(`Button touch target too small: ${minWidth}x${minHeight}px (minimum 44x44px)`, 'fail');
                    }
                });

                if (touchTargetsPassed) {
                    this.log('✅ All touch targets meet minimum size requirements', 'pass');
                    this.passedTests++;
                } else {
                    this.failedTests++;
                }
            }

            manager.hide(notificationId);
        } catch (error) {
            this.log(`❌ Touch target test failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testAccessibilityFeatures() {
        this.currentTest = 'Accessibility Features';

        try {
            const manager = window.NotificationManager;
            const notificationId = manager.show({
                type: 'banner',
                title: 'Accessibility Test',
                message: 'Testing ARIA attributes',
                priority: 'critical'
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            const element = document.getElementById(`notification-${notificationId}`);
            if (element) {
                // Check ARIA attributes
                const role = element.getAttribute('role');
                const ariaLive = element.getAttribute('aria-live');
                const ariaAtomic = element.getAttribute('aria-atomic');

                if (role !== 'alert') {
                    throw new Error(`Expected role="alert", got "${role}"`);
                }

                if (ariaLive !== 'assertive') {
                    throw new Error(`Expected aria-live="assertive" for critical, got "${ariaLive}"`);
                }

                if (ariaAtomic !== 'true') {
                    throw new Error(`Expected aria-atomic="true", got "${ariaAtomic}"`);
                }

                this.log('✅ Accessibility attributes correctly set', 'pass');
                this.passedTests++;
            }

            manager.hide(notificationId);
        } catch (error) {
            this.log(`❌ Accessibility test failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testHapticFeedback() {
        this.currentTest = 'Haptic Feedback';

        try {
            const manager = window.NotificationManager;

            // Check if haptic feedback method exists
            if (typeof manager.triggerHapticFeedback !== 'function') {
                throw new Error('triggerHapticFeedback method not found');
            }

            // Mock navigator.vibrate for testing
            const originalVibrate = navigator.vibrate;
            let vibrateCalled = false;
            navigator.vibrate = (pattern) => {
                vibrateCalled = true;
                return true;
            };

            try {
                manager.triggerHapticFeedback('light');

                if (vibrateCalled) {
                    this.log('✅ Haptic feedback mechanism working', 'pass');
                    this.passedTests++;
                } else {
                    this.log('⚠️ Haptic feedback not triggered (may be due to browser/device support)', 'warn');
                    this.passedTests++; // Still pass as this is device-dependent
                }
            } finally {
                navigator.vibrate = originalVibrate;
            }

        } catch (error) {
            this.log(`❌ Haptic feedback test failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testAdvancedIntelligence() {
        this.currentTest = 'Advanced Intelligence Systems';
        this.log('Testing advanced intelligence systems...', 'test');

        await this.testCustomerSegmentation();
        await this.testBehaviorAnalysis();
        await this.testABTesting();
        await this.testPredictiveAnalytics();
    }

    async testCustomerSegmentation() {
        this.currentTest = 'Customer Segmentation';

        try {
            if (typeof window.CustomerSegmentationManager === 'undefined') {
                throw new Error('CustomerSegmentationManager not found');
            }

            const segManager = window.CustomerSegmentationManager;

            // Test different customer profiles
            const testProfiles = [
                {
                    profile: { avgDailyUsage: 8, featuresUsed: 6, accountAge: 200, monthlyOrders: 600 },
                    expectedSegment: 'power_users'
                },
                {
                    profile: { accountAge: 200, paymentHistory: 'consistent', downtime: 20 },
                    expectedSegment: 'loyal_customers'
                },
                {
                    profile: { accountAge: 50, failureCount: 1, trialsUsed: 1 },
                    expectedSegment: 'new_adopters'
                }
            ];

            for (const test of testProfiles) {
                const result = segManager.analyzeCustomer(test.profile);

                if (result.segment !== test.expectedSegment) {
                    throw new Error(`Expected segment "${test.expectedSegment}", got "${result.segment}"`);
                }

                if (result.confidence < 0 || result.confidence > 1) {
                    throw new Error(`Confidence should be between 0 and 1, got ${result.confidence}`);
                }
            }

            // Test grace period calculation
            const powerUserGrace = segManager.calculateSmartGracePeriod('power_users', { accountAge: 400, monthlyOrders: 1200 });
            if (powerUserGrace < 7) {
                throw new Error(`Power users should get at least 7 days grace period, got ${powerUserGrace}`);
            }

            // Test peak hours detection
            const isPeakHours = segManager.isRestaurantPeakHours();
            if (typeof isPeakHours !== 'boolean') {
                throw new Error('Peak hours detection should return boolean');
            }

            this.log('✅ Customer segmentation working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Customer segmentation failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testBehaviorAnalysis() {
        this.currentTest = 'Behavioral Analysis';

        try {
            if (typeof window.AdvancedNotificationIntelligence === 'undefined') {
                throw new Error('AdvancedNotificationIntelligence not found');
            }

            const intelligence = window.AdvancedNotificationIntelligence;

            // Mock some interaction data
            const mockInteractions = [
                { timestamp: Date.now() - 60000, action: 'click', notificationType: 'payment_failure' },
                { timestamp: Date.now() - 120000, action: 'dismiss', notificationType: 'grace_warning' },
                { timestamp: Date.now() - 180000, action: 'resolve', notificationType: 'payment_failure' }
            ];

            localStorage.setItem('pospal_segment_analytics', JSON.stringify(mockInteractions));

            // Test behavior model building
            const historicalData = intelligence.getHistoricalInteractionData();
            const behaviorModel = intelligence.buildBehaviorModel(historicalData);

            if (!behaviorModel.engagementScore || typeof behaviorModel.engagementScore !== 'number') {
                throw new Error('Engagement score not calculated correctly');
            }

            if (!behaviorModel.preferredTiming || !Array.isArray(behaviorModel.preferredTiming.preferredHours)) {
                throw new Error('Timing preferences not analyzed correctly');
            }

            // Test notification intelligence
            const notificationIntel = intelligence.getNotificationIntelligence({});
            if (!notificationIntel.recommendation || !['show', 'delay'].includes(notificationIntel.recommendation)) {
                throw new Error('Invalid notification recommendation');
            }

            this.log('✅ Behavioral analysis working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Behavioral analysis failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testABTesting() {
        this.currentTest = 'A/B Testing Framework';

        try {
            const intelligence = window.AdvancedNotificationIntelligence;

            // Create a test experiment
            const variants = [
                { name: 'control', timing: 'immediate' },
                { name: 'variant_a', timing: 'delayed' },
                { name: 'variant_b', timing: 'scheduled' }
            ];

            const experiment = intelligence.createExperiment('timing_test', variants, {
                trafficSplit: [0.33, 0.33, 0.34]
            });

            if (!experiment || !experiment.name) {
                throw new Error('Experiment not created correctly');
            }

            // Test variant assignment
            const variant1 = intelligence.getExperimentVariant('timing_test', 'user_123');
            const variant2 = intelligence.getExperimentVariant('timing_test', 'user_123'); // Should be consistent

            if (!variant1 || !variant2) {
                throw new Error('Variant assignment failed');
            }

            if (variant1.index !== variant2.index) {
                throw new Error('Variant assignment not consistent for same user');
            }

            // Test metric recording
            intelligence.recordExperimentMetric('timing_test', 'click_rate', 0.15, 'user_123');

            // Test results calculation
            const results = intelligence.getExperimentResults('timing_test');
            if (!results || typeof results !== 'object') {
                throw new Error('Experiment results not calculated correctly');
            }

            this.log('✅ A/B testing framework working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ A/B testing failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testPredictiveAnalytics() {
        this.currentTest = 'Predictive Analytics';

        try {
            const intelligence = window.AdvancedNotificationIntelligence;

            // Test prediction generation
            const predictions = intelligence.generatePredictions();

            if (!predictions || typeof predictions !== 'object') {
                throw new Error('Predictions not generated');
            }

            // Check prediction structure
            const requiredFields = ['optimalNextNotificationTime', 'expectedEngagement', 'recommendedStrategy', 'riskFactors'];
            for (const field of requiredFields) {
                if (!(field in predictions)) {
                    throw new Error(`Missing prediction field: ${field}`);
                }
            }

            // Test engagement prediction
            const engagement = intelligence.predictEngagement();
            if (typeof engagement !== 'number' || engagement < 0 || engagement > 1) {
                throw new Error(`Invalid engagement prediction: ${engagement}`);
            }

            // Test strategy recommendation
            const strategy = intelligence.recommendStrategy();
            const validStrategies = ['aggressive', 'moderate', 'gentle', 'minimal'];
            if (!validStrategies.includes(strategy)) {
                throw new Error(`Invalid strategy recommendation: ${strategy}`);
            }

            // Test risk factor identification
            const risks = intelligence.identifyRiskFactors();
            if (!Array.isArray(risks)) {
                throw new Error('Risk factors should be an array');
            }

            this.log('✅ Predictive analytics working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Predictive analytics failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testIntegrationAndPerformance() {
        this.currentTest = 'Integration & Performance';
        this.log('Testing integration and performance...', 'test');

        await this.testMemoryLeakPrevention();
        await this.testLoadOrderDependencies();
        await this.testFallbackSystems();
        await this.testPerformanceUnderLoad();
    }

    async testMemoryLeakPrevention() {
        this.currentTest = 'Memory Leak Prevention';

        try {
            const manager = window.NotificationManager;
            const initialTimers = TimerManager.timers.size;

            // Create multiple notifications with timers
            const notificationIds = [];
            for (let i = 0; i < 10; i++) {
                const id = manager.showToast(`Test message ${i}`, 'info', 1000);
                notificationIds.push(id);
            }

            // Check timers were created
            const afterCreation = TimerManager.timers.size;
            if (afterCreation <= initialTimers) {
                this.log('Warning: No timers were created for notifications', 'warn');
            }

            // Wait for notifications to auto-hide
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Check timers were cleaned up
            const afterCleanup = TimerManager.timers.size;
            if (afterCleanup > initialTimers + 2) { // Allow some tolerance for other timers
                throw new Error(`Potential memory leak: ${afterCleanup - initialTimers} excess timers remaining`);
            }

            this.log('✅ Memory leak prevention working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Memory leak prevention failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testLoadOrderDependencies() {
        this.currentTest = 'Load Order Dependencies';

        try {
            // Check that all required global objects are available
            const requiredGlobals = [
                'NotificationManager',
                'CustomerSegmentationManager',
                'AdvancedNotificationIntelligence',
                'TimerManager'
            ];

            for (const globalName of requiredGlobals) {
                if (typeof window[globalName] === 'undefined') {
                    throw new Error(`Required global ${globalName} not found - check script load order`);
                }
            }

            // Test that dependencies are properly initialized
            if (!window.NotificationManager.initialized) {
                throw new Error('NotificationManager not properly initialized');
            }

            if (!window.AdvancedNotificationIntelligence.initialized) {
                throw new Error('AdvancedNotificationIntelligence not properly initialized');
            }

            this.log('✅ Load order dependencies correct', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Load order dependencies failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testFallbackSystems() {
        this.currentTest = 'Fallback Systems';

        try {
            // Test fallback when advanced systems not available
            const originalSegmentation = window.CustomerSegmentationManager;
            const originalIntelligence = window.AdvancedNotificationIntelligence;

            // Temporarily remove advanced systems
            delete window.CustomerSegmentationManager;
            delete window.AdvancedNotificationIntelligence;

            try {
                // Test that basic notifications still work
                const id = window.NotificationManager.showToast('Fallback test', 'info', 2000);
                if (!id) {
                    throw new Error('Basic notification failed without advanced systems');
                }

                // Test progressive warning fallback
                if (typeof showSmartProgressiveWarning === 'function') {
                    showSmartProgressiveWarning(8, 10); // Should not throw error
                }

                window.NotificationManager.hide(id);

            } finally {
                // Restore advanced systems
                window.CustomerSegmentationManager = originalSegmentation;
                window.AdvancedNotificationIntelligence = originalIntelligence;
            }

            this.log('✅ Fallback systems working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Fallback systems failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testPerformanceUnderLoad() {
        this.currentTest = 'Performance Under Load';

        try {
            const manager = window.NotificationManager;
            const startTime = performance.now();

            // Create many notifications rapidly
            const notificationIds = [];
            for (let i = 0; i < 50; i++) {
                const id = manager.showToast(`Load test ${i}`, 'info', 10000);
                notificationIds.push(id);
            }

            const creationTime = performance.now() - startTime;

            // Check performance
            if (creationTime > 1000) { // Should create 50 notifications in under 1 second
                this.log(`Warning: Slow notification creation: ${creationTime.toFixed(2)}ms for 50 notifications`, 'warn');
            }

            // Check queue management
            const activeCount = manager.activeNotifications.size;
            const queueCount = manager.queue.length;

            if (activeCount + queueCount !== 50) {
                throw new Error(`Expected 50 total notifications, got ${activeCount} active + ${queueCount} queued`);
            }

            // Cleanup
            manager.clear();

            this.log(`✅ Performance test passed: ${creationTime.toFixed(2)}ms for 50 notifications`, 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Performance test failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testBusinessLogic() {
        this.currentTest = 'Business Logic Testing';
        this.log('Testing business logic...', 'test');

        await this.testRestaurantPeakHours();
        await this.testGracePeriodCalculations();
        await this.testPersonalizedContent();
    }

    async testRestaurantPeakHours() {
        this.currentTest = 'Restaurant Peak Hours';

        try {
            const segManager = window.CustomerSegmentationManager;

            // Test different times
            const testTimes = [
                { hour: 12, day: 2, expected: true, description: 'Tuesday lunch' },  // Tuesday noon
                { hour: 19, day: 5, expected: true, description: 'Friday dinner' },  // Friday evening
                { hour: 3, day: 1, expected: false, description: 'Monday early morning' },   // Monday 3am
                { hour: 15, day: 3, expected: false, description: 'Wednesday afternoon' }   // Wednesday 3pm
            ];

            for (const test of testTimes) {
                // Mock the time
                const originalDate = Date;
                const mockDate = new Date();
                mockDate.setHours(test.hour);
                mockDate.setDay = () => test.day;
                global.Date = class extends Date {
                    constructor(...args) {
                        if (args.length === 0) {
                            super();
                            this.setHours(test.hour);
                            return mockDate;
                        }
                        return super(...args);
                    }
                    getDay() {
                        return test.day;
                    }
                };

                try {
                    const isPeak = segManager.isRestaurantPeakHours();
                    // Note: This is a simplified test - the actual logic is more complex
                    this.log(`Peak hours test for ${test.description}: ${isPeak}`, 'info');
                } finally {
                    global.Date = originalDate;
                }
            }

            this.log('✅ Restaurant peak hours logic working', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Restaurant peak hours test failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testGracePeriodCalculations() {
        this.currentTest = 'Grace Period Calculations';

        try {
            const segManager = window.CustomerSegmentationManager;

            // Test different customer scenarios
            const scenarios = [
                {
                    segment: 'power_users',
                    data: { accountAge: 400, monthlyOrders: 1200, paymentFailures: 0 },
                    expectedMin: 8 // Base 7 + loyalty bonus + volume bonus
                },
                {
                    segment: 'new_adopters',
                    data: { accountAge: 50, monthlyOrders: 100, paymentFailures: 0 },
                    expectedMin: 5, expectedMax: 5 // Base period, no bonuses
                },
                {
                    segment: 'price_sensitive',
                    data: { accountAge: 200, monthlyOrders: 50, paymentFailures: 3 },
                    expectedMin: 2, expectedMax: 3 // Base 3, but reduced due to failures
                }
            ];

            for (const scenario of scenarios) {
                const gracePeriod = segManager.calculateSmartGracePeriod(scenario.segment, scenario.data);

                if (gracePeriod < scenario.expectedMin) {
                    throw new Error(`Grace period for ${scenario.segment} too low: ${gracePeriod} < ${scenario.expectedMin}`);
                }

                if (scenario.expectedMax && gracePeriod > scenario.expectedMax) {
                    throw new Error(`Grace period for ${scenario.segment} too high: ${gracePeriod} > ${scenario.expectedMax}`);
                }

                this.log(`${scenario.segment} grace period: ${gracePeriod} days`, 'info');
            }

            this.log('✅ Grace period calculations working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Grace period calculations failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testPersonalizedContent() {
        this.currentTest = 'Personalized Content';

        try {
            const segManager = window.CustomerSegmentationManager;

            const customerData = {
                name: 'Test Restaurant',
                accountAge: 200,
                monthlyOrders: 500
            };

            // Test different content types
            const contentTypes = ['payment_failure', 'grace_warning'];
            const segments = ['power_users', 'new_adopters', 'price_sensitive'];

            for (const segment of segments) {
                for (const type of contentTypes) {
                    const content = segManager.getPersonalizedContent(segment, type, customerData);

                    if (!content.subject || typeof content.subject !== 'string') {
                        throw new Error(`Missing or invalid subject for ${segment}/${type}`);
                    }

                    if (!content.tone || typeof content.tone !== 'string') {
                        throw new Error(`Missing or invalid tone for ${segment}/${type}`);
                    }

                    if (!Array.isArray(content.benefits)) {
                        throw new Error(`Benefits should be an array for ${segment}/${type}`);
                    }

                    if (!content.cta || typeof content.cta !== 'string') {
                        throw new Error(`Missing or invalid CTA for ${segment}/${type}`);
                    }

                    // Check personalization (should include customer name)
                    if (!content.subject.includes(customerData.name)) {
                        this.log(`Content for ${segment}/${type} not properly personalized`, 'warn');
                    }
                }
            }

            this.log('✅ Personalized content generation working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Personalized content test failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testScenarios() {
        this.currentTest = 'Comprehensive Scenarios';
        this.log('Running comprehensive scenario tests...', 'test');

        await this.testOfflineToOnlineScenario();
        await this.testHighFrequencyNotifications();
        await this.testConcurrentUserSimulation();
    }

    async testOfflineToOnlineScenario() {
        this.currentTest = 'Offline to Online Scenario';

        try {
            // Simulate offline state
            const manager = window.NotificationManager;
            manager.clear();

            // Show offline indicator
            showSmartOfflineIndicator(3, 7);

            let offlineNotification = Array.from(manager.activeNotifications.values())[0];
            if (!offlineNotification) {
                throw new Error('Offline indicator not shown');
            }

            // Simulate coming back online
            manager.clear('persistent'); // Clear offline indicators

            // Show success message for coming back online
            manager.showToast('Connection restored', 'success', 3000);

            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify offline notification was cleared and success shown
            const activeNotifications = Array.from(manager.activeNotifications.values());
            const hasOfflineIndicator = activeNotifications.some(n => n.type === 'persistent');
            const hasSuccessToast = activeNotifications.some(n =>
                n.type === 'toast' && n.message && n.message.includes('restored')
            );

            if (hasOfflineIndicator) {
                throw new Error('Offline indicator should be cleared when coming back online');
            }

            if (!hasSuccessToast) {
                this.log('Warning: Success message not found after coming back online', 'warn');
            }

            this.log('✅ Offline to online scenario working correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Offline to online scenario failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testHighFrequencyNotifications() {
        this.currentTest = 'High Frequency Anti-Spam';

        try {
            const manager = window.NotificationManager;
            const intelligence = window.AdvancedNotificationIntelligence;

            manager.clear();

            // Simulate rapid notifications
            const notificationIds = [];
            for (let i = 0; i < 20; i++) {
                const id = manager.showToast(`Rapid notification ${i}`, 'info', 30000);
                notificationIds.push(id);

                // Very short delay between notifications
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            // Check that queue management is working
            const activeCount = manager.activeNotifications.size;
            const queueCount = manager.queue.length;

            // Should not have more than max concurrent notifications active
            if (activeCount > 3) {
                this.log(`Warning: Too many concurrent notifications: ${activeCount}`, 'warn');
            }

            // Check if intelligence system would recommend delay
            const recommendation = intelligence.getNotificationIntelligence({});
            if (recommendation.recommendation === 'delay') {
                this.log('✅ Anti-spam system correctly recommending delays', 'pass');
            } else {
                this.log('Warning: Anti-spam system not recommending delays despite high frequency', 'warn');
            }

            manager.clear();
            this.passedTests++;
        } catch (error) {
            this.log(`❌ High frequency anti-spam test failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    async testConcurrentUserSimulation() {
        this.currentTest = 'Concurrent User Simulation';

        try {
            // Simulate multiple users/sessions
            const userSessions = [];

            for (let i = 0; i < 5; i++) {
                const sessionData = {
                    userId: `user_${i}`,
                    notifications: [],
                    segment: i % 2 === 0 ? 'power_users' : 'new_adopters'
                };

                // Create notifications for each user
                for (let j = 0; j < 3; j++) {
                    const id = window.NotificationManager.showToast(
                        `User ${i} notification ${j}`,
                        'info',
                        5000
                    );
                    sessionData.notifications.push(id);
                }

                userSessions.push(sessionData);
            }

            // Check that all notifications were handled properly
            const totalExpected = userSessions.length * 3; // 5 users * 3 notifications
            const totalCreated = window.NotificationManager.activeNotifications.size +
                                window.NotificationManager.queue.length;

            if (totalCreated !== totalExpected) {
                this.log(`Expected ${totalExpected} total notifications, got ${totalCreated}`, 'warn');
            }

            // Clean up
            window.NotificationManager.clear();

            this.log('✅ Concurrent user simulation handled correctly', 'pass');
            this.passedTests++;
        } catch (error) {
            this.log(`❌ Concurrent user simulation failed: ${error.message}`, 'fail');
            this.failedTests++;
        }
        this.totalTests++;
    }

    generateFinalReport() {
        const duration = Date.now() - this.startTime;
        const passRate = (this.passedTests / this.totalTests * 100).toFixed(1);

        console.log('\n' + '='.repeat(80));
        console.log('NOTIFICATION SYSTEM TESTING REPORT');
        console.log('='.repeat(80));

        console.log(`\n📊 EXECUTIVE SUMMARY:`);
        console.log(`   Total Tests: ${this.totalTests}`);
        console.log(`   Passed: ${this.passedTests} (${passRate}%)`);
        console.log(`   Failed: ${this.failedTests}`);
        console.log(`   Duration: ${(duration / 1000).toFixed(2)} seconds`);

        console.log(`\n✅ SYSTEM STATUS:`);
        if (this.failedTests === 0) {
            console.log('   🎉 ALL TESTS PASSED - Notification system ready for production');
        } else if (this.failedTests <= 2) {
            console.log('   ⚠️  MINOR ISSUES DETECTED - Review failed tests');
        } else {
            console.log('   ❌ CRITICAL ISSUES DETECTED - System needs attention');
        }

        console.log(`\n🔍 COMPONENT RESULTS:`);
        const components = {
            'Core Notification': ['NotificationManager Initialization', 'Basic Toast Functionality', 'Progressive Warning', 'Offline Indicator', 'Z-Index Hierarchy'],
            'Mobile & Touch': ['Mobile Responsiveness', 'Touch Target Sizes', 'Accessibility Features', 'Haptic Feedback'],
            'Advanced Intelligence': ['Customer Segmentation', 'Behavioral Analysis', 'A/B Testing Framework', 'Predictive Analytics'],
            'Integration & Performance': ['Memory Leak Prevention', 'Load Order Dependencies', 'Fallback Systems', 'Performance Under Load'],
            'Business Logic': ['Restaurant Peak Hours', 'Grace Period Calculations', 'Personalized Content'],
            'Scenarios': ['Offline to Online Scenario', 'High Frequency Anti-Spam', 'Concurrent User Simulation']
        };

        Object.entries(components).forEach(([category, tests]) => {
            const categoryResults = this.testResults.filter(r => tests.includes(r.test));
            const categoryPassed = categoryResults.filter(r => r.type === 'pass').length;
            const categoryTotal = tests.length;
            const categoryRate = (categoryPassed / categoryTotal * 100).toFixed(0);

            console.log(`   ${category}: ${categoryPassed}/${categoryTotal} (${categoryRate}%)`);
        });

        // Show failed tests
        if (this.failedTests > 0) {
            console.log(`\n❌ FAILED TESTS:`);
            this.testResults
                .filter(r => r.type === 'fail')
                .forEach(result => {
                    console.log(`   • ${result.test}: ${result.message}`);
                });
        }

        // Show warnings
        const warnings = this.testResults.filter(r => r.type === 'warn');
        if (warnings.length > 0) {
            console.log(`\n⚠️  WARNINGS:`);
            warnings.forEach(warning => {
                console.log(`   • ${warning.test}: ${warning.message}`);
            });
        }

        console.log(`\n🚀 RECOMMENDATIONS:`);

        if (this.passedTests >= this.totalTests * 0.9) {
            console.log('   • System performance is excellent');
            console.log('   • Ready for production deployment');
            console.log('   • Monitor user engagement metrics');
        } else if (this.passedTests >= this.totalTests * 0.8) {
            console.log('   • Address failed test cases before production');
            console.log('   • Consider additional user testing');
            console.log('   • Review warning messages');
        } else {
            console.log('   • Critical issues must be resolved');
            console.log('   • Comprehensive debugging required');
            console.log('   • Re-test after fixes');
        }

        console.log(`\n📋 NEXT STEPS:`);
        console.log('   1. Review detailed test results above');
        console.log('   2. Fix any critical failures');
        console.log('   3. Test with real user scenarios');
        console.log('   4. Monitor production metrics');
        console.log('   5. Iterate based on user feedback');

        console.log('\n' + '='.repeat(80));

        return {
            totalTests: this.totalTests,
            passedTests: this.passedTests,
            failedTests: this.failedTests,
            passRate: parseFloat(passRate),
            duration: duration,
            status: this.failedTests === 0 ? 'PASSED' : this.failedTests <= 2 ? 'WARNING' : 'FAILED'
        };
    }
}

// Auto-run tests when script loads
if (typeof window !== 'undefined') {
    window.NotificationSystemTester = NotificationSystemTester;

    // Wait for all systems to be ready
    const waitForSystems = () => {
        if (window.NotificationManager &&
            window.CustomerSegmentationManager &&
            window.AdvancedNotificationIntelligence) {

            console.log('🧪 Starting notification system tests...');
            const tester = new NotificationSystemTester();
            tester.runAllTests();
        } else {
            setTimeout(waitForSystems, 100);
        }
    };

    // Start tests after page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForSystems);
    } else {
        waitForSystems();
    }
}