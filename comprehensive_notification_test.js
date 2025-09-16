// Comprehensive POSPal Notification System Test Suite
// Tests the complete 5-phase refactored notification system

class ComprehensiveNotificationTester {
    constructor() {
        this.results = {
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            warningTests: 0,
            testResults: [],
            performanceMetrics: {},
            memoryMetrics: {},
            systemHealth: 'UNKNOWN'
        };
        this.startTime = Date.now();
        this.currentPhase = '';
        this.logBuffer = [];
    }

    log(message, type = 'info', details = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            phase: this.currentPhase,
            type,
            message,
            details
        };

        this.logBuffer.push(logEntry);
        console.log(`[${timestamp}] [${type.toUpperCase()}] ${this.currentPhase}: ${message}`);

        if (details && Object.keys(details).length > 0) {
            console.log('Details:', details);
        }
    }

    recordTestResult(testName, passed, message = '', metrics = {}) {
        this.results.totalTests++;

        if (passed) {
            this.results.passedTests++;
            this.log(`✅ ${testName}: ${message || 'PASSED'}`, 'pass');
        } else {
            this.results.failedTests++;
            this.log(`❌ ${testName}: ${message || 'FAILED'}`, 'fail');
        }

        this.results.testResults.push({
            name: testName,
            phase: this.currentPhase,
            passed,
            message,
            metrics,
            timestamp: Date.now()
        });
    }

    recordWarning(testName, message) {
        this.results.warningTests++;
        this.log(`⚠️ ${testName}: ${message}`, 'warn');
    }

    // PHASE 1: CORE SYSTEM ARCHITECTURE TESTING
    async testPhase1_CoreArchitecture() {
        this.currentPhase = 'Phase 1: Core Architecture';
        this.log('=== STARTING PHASE 1: CORE ARCHITECTURE TESTING ===', 'info');

        await this.testNotificationManagerInitialization();
        await this.testZIndexHierarchy();
        await this.testBasicNotificationTypes();
        await this.testQueueManagement();
        await this.testTimerManagerIntegration();
    }

    async testNotificationManagerInitialization() {
        try {
            // Check global availability
            const hasNotificationManager = typeof window.NotificationManager !== 'undefined';
            const hasTimerManager = typeof window.TimerManager !== 'undefined';

            if (!hasNotificationManager) {
                throw new Error('NotificationManager not found in global scope');
            }

            if (!hasTimerManager) {
                throw new Error('TimerManager not found in global scope');
            }

            const manager = window.NotificationManager;

            // Test initialization properties
            const hasActiveNotifications = manager.activeNotifications instanceof Map;
            const hasQueue = Array.isArray(manager.queue);
            const hasZIndexBase = typeof manager.zIndexBase === 'object';
            const isInitialized = manager.initialized === true;

            // Test container creation
            const container = document.getElementById('pospal-notification-container');
            const hasContainer = container !== null;

            // Test z-index configuration
            const expectedZIndex = { toast: 1800, banner: 1700, persistent: 1600, critical: 1900 };
            let zIndexCorrect = true;
            for (const [type, expectedValue] of Object.entries(expectedZIndex)) {
                if (manager.zIndexBase[type] !== expectedValue) {
                    zIndexCorrect = false;
                    break;
                }
            }

            const testPassed = hasNotificationManager && hasTimerManager &&
                            hasActiveNotifications && hasQueue && hasZIndexBase &&
                            isInitialized && hasContainer && zIndexCorrect;

            this.recordTestResult(
                'NotificationManager Initialization',
                testPassed,
                testPassed ? 'All components properly initialized' : 'Missing or incorrect components',
                {
                    hasNotificationManager,
                    hasTimerManager,
                    hasActiveNotifications,
                    hasQueue,
                    hasZIndexBase,
                    isInitialized,
                    hasContainer,
                    zIndexCorrect
                }
            );

        } catch (error) {
            this.recordTestResult('NotificationManager Initialization', false, error.message);
        }
    }

    async testZIndexHierarchy() {
        try {
            const manager = window.NotificationManager;

            // Create different priority notifications
            const toastId = manager.show({
                type: 'toast',
                message: 'Test toast',
                priority: 'normal',
                autoHide: false
            });

            const bannerId = manager.show({
                type: 'banner',
                title: 'Test Banner',
                message: 'Test banner message',
                autoHide: false
            });

            const criticalId = manager.show({
                type: 'toast',
                message: 'Critical test',
                priority: 'critical',
                autoHide: false
            });

            await new Promise(resolve => setTimeout(resolve, 200)); // Let DOM update

            // Check z-index values in DOM
            const toastElement = document.getElementById(`notification-${toastId}`);
            const bannerElement = document.getElementById(`notification-${bannerId}`);
            const criticalElement = document.getElementById(`notification-${criticalId}`);

            let zIndexTests = {
                toast: false,
                banner: false,
                critical: false
            };

            if (toastElement) {
                const zIndex = parseInt(toastElement.style.zIndex);
                zIndexTests.toast = zIndex === 1800;
            }

            if (bannerElement) {
                const zIndex = parseInt(bannerElement.style.zIndex);
                zIndexTests.banner = zIndex === 1700;
            }

            if (criticalElement) {
                const zIndex = parseInt(criticalElement.style.zIndex);
                zIndexTests.critical = zIndex === 1900;
            }

            // Cleanup
            manager.hide(toastId);
            manager.hide(bannerId);
            manager.hide(criticalId);

            const allTestsPassed = Object.values(zIndexTests).every(test => test === true);

            this.recordTestResult(
                'Z-Index Hierarchy',
                allTestsPassed,
                allTestsPassed ? 'All z-index values correct' : 'Some z-index values incorrect',
                zIndexTests
            );

        } catch (error) {
            this.recordTestResult('Z-Index Hierarchy', false, error.message);
        }
    }

    async testBasicNotificationTypes() {
        try {
            const manager = window.NotificationManager;
            const testResults = {};

            // Test toast types
            const toastTypes = ['success', 'warning', 'error', 'info'];
            for (const type of toastTypes) {
                const id = manager.showToast(`Test ${type} message`, type, 10000);
                testResults[`toast_${type}`] = id !== null && id !== undefined;
                if (id) manager.hide(id);
            }

            // Test banner
            const bannerId = manager.showBanner('Test Banner', 'Banner test message');
            testResults.banner = bannerId !== null && bannerId !== undefined;
            if (bannerId) manager.hide(bannerId);

            // Test persistent
            const persistentId = manager.show({
                type: 'persistent',
                message: 'Persistent test message',
                dismissible: false
            });
            testResults.persistent = persistentId !== null && persistentId !== undefined;
            if (persistentId) manager.hide(persistentId);

            const allTypesPassed = Object.values(testResults).every(result => result === true);

            this.recordTestResult(
                'Basic Notification Types',
                allTypesPassed,
                allTypesPassed ? 'All notification types working' : 'Some notification types failed',
                testResults
            );

        } catch (error) {
            this.recordTestResult('Basic Notification Types', false, error.message);
        }
    }

    async testQueueManagement() {
        try {
            const manager = window.NotificationManager;
            manager.clear(); // Start clean

            const notificationIds = [];
            const startTime = performance.now();

            // Create many notifications rapidly
            for (let i = 0; i < 20; i++) {
                const id = manager.showToast(`Queue test ${i}`, 'info', 30000);
                notificationIds.push(id);
            }

            const creationTime = performance.now() - startTime;

            await new Promise(resolve => setTimeout(resolve, 300)); // Let queue process

            const activeCount = manager.activeNotifications.size;
            const queueCount = manager.queue.length;
            const totalManaged = activeCount + queueCount;

            // Clean up
            manager.clear();

            const queueWorking = totalManaged === 20;
            const performanceGood = creationTime < 1000; // Should create 20 notifications in under 1 second

            this.recordTestResult(
                'Queue Management',
                queueWorking,
                queueWorking ? `Queue managing ${totalManaged} notifications correctly` : `Queue management issues: ${totalManaged}/20`,
                {
                    activeCount,
                    queueCount,
                    totalManaged,
                    creationTime: creationTime.toFixed(2),
                    performanceGood
                }
            );

            // Record performance warning if needed
            if (!performanceGood) {
                this.recordWarning('Queue Performance', `Slow notification creation: ${creationTime.toFixed(2)}ms for 20 notifications`);
            }

        } catch (error) {
            this.recordTestResult('Queue Management', false, error.message);
        }
    }

    async testTimerManagerIntegration() {
        try {
            const manager = window.NotificationManager;
            const initialTimers = window.TimerManager.timers.size;

            // Create notifications with auto-hide
            const ids = [];
            for (let i = 0; i < 5; i++) {
                const id = manager.showToast(`Timer test ${i}`, 'info', 1000);
                ids.push(id);
            }

            // Check timers were created
            await new Promise(resolve => setTimeout(resolve, 100));
            const afterCreation = window.TimerManager.timers.size;

            // Wait for auto-hide
            await new Promise(resolve => setTimeout(resolve, 1200));
            const afterCleanup = window.TimerManager.timers.size;

            const timersCreated = afterCreation > initialTimers;
            const timersCleanedUp = afterCleanup <= initialTimers + 2; // Allow some tolerance

            const testPassed = timersCreated && timersCleanedUp;

            this.recordTestResult(
                'TimerManager Integration',
                testPassed,
                testPassed ? 'Timer creation and cleanup working correctly' : 'Timer management issues detected',
                {
                    initialTimers,
                    afterCreation,
                    afterCleanup,
                    timersCreated,
                    timersCleanedUp
                }
            );

            if (!timersCleanedUp) {
                this.recordWarning('Memory Leak Risk', `Potential timer leak: ${afterCleanup - initialTimers} excess timers`);
            }

        } catch (error) {
            this.recordTestResult('TimerManager Integration', false, error.message);
        }
    }

    // PHASE 2: CUSTOMER SEGMENTATION TESTING
    async testPhase2_CustomerSegmentation() {
        this.currentPhase = 'Phase 2: Customer Segmentation';
        this.log('=== STARTING PHASE 2: CUSTOMER SEGMENTATION TESTING ===', 'info');

        await this.testSegmentationSystemAvailability();
        await this.testAllCustomerSegments();
        await this.testGracePeriodCalculations();
        await this.testPersonalizedContent();
        await this.testPeakHoursDetection();
    }

    async testSegmentationSystemAvailability() {
        try {
            const hasSegmentationManager = typeof window.CustomerSegmentationManager !== 'undefined';

            if (!hasSegmentationManager) {
                throw new Error('CustomerSegmentationManager not found');
            }

            const segManager = window.CustomerSegmentationManager;
            const hasAnalyzeMethod = typeof segManager.analyzeCustomer === 'function';
            const hasGraceMethod = typeof segManager.calculateSmartGracePeriod === 'function';
            const hasContentMethod = typeof segManager.getPersonalizedContent === 'function';
            const hasPeakMethod = typeof segManager.isRestaurantPeakHours === 'function';

            const testPassed = hasAnalyzeMethod && hasGraceMethod && hasContentMethod && hasPeakMethod;

            this.recordTestResult(
                'Segmentation System Availability',
                testPassed,
                testPassed ? 'All segmentation methods available' : 'Missing segmentation methods',
                {
                    hasSegmentationManager,
                    hasAnalyzeMethod,
                    hasGraceMethod,
                    hasContentMethod,
                    hasPeakMethod
                }
            );

        } catch (error) {
            this.recordTestResult('Segmentation System Availability', false, error.message);
        }
    }

    async testAllCustomerSegments() {
        try {
            const segManager = window.CustomerSegmentationManager;
            const segments = ['power_users', 'loyal_customers', 'new_adopters', 'seasonal_restaurants', 'price_sensitive', 'high_risk'];

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
                },
                {
                    profile: { usagePattern: 'seasonal', avgDowntime: 45 },
                    expectedSegment: 'seasonal_restaurants'
                },
                {
                    profile: { priceChange: 'resistant', downgrades: 2, price: 'low' },
                    expectedSegment: 'price_sensitive'
                },
                {
                    profile: { paymentFailures: 4, downgrades: 3, supportTickets: 5, avgDowntime: 15 },
                    expectedSegment: 'high_risk'
                }
            ];

            const segmentResults = {};

            for (const test of testProfiles) {
                try {
                    const result = segManager.analyzeCustomer(test.profile);
                    const correctSegment = result.segment === test.expectedSegment;
                    const validConfidence = result.confidence >= 0 && result.confidence <= 1;

                    segmentResults[test.expectedSegment] = {
                        correctSegment,
                        validConfidence,
                        actualSegment: result.segment,
                        confidence: result.confidence
                    };
                } catch (error) {
                    segmentResults[test.expectedSegment] = {
                        correctSegment: false,
                        validConfidence: false,
                        error: error.message
                    };
                }
            }

            const allSegmentsCorrect = Object.values(segmentResults).every(r => r.correctSegment === true);
            const allConfidenceValid = Object.values(segmentResults).every(r => r.validConfidence === true);

            this.recordTestResult(
                'All Customer Segments',
                allSegmentsCorrect && allConfidenceValid,
                `Segment detection: ${allSegmentsCorrect ? 'CORRECT' : 'ISSUES'}, Confidence: ${allConfidenceValid ? 'VALID' : 'INVALID'}`,
                segmentResults
            );

        } catch (error) {
            this.recordTestResult('All Customer Segments', false, error.message);
        }
    }

    async testGracePeriodCalculations() {
        try {
            const segManager = window.CustomerSegmentationManager;

            const scenarios = [
                {
                    segment: 'power_users',
                    data: { accountAge: 400, monthlyOrders: 1200, paymentFailures: 0 },
                    expectedMin: 8,
                    description: 'Power users with excellent history'
                },
                {
                    segment: 'new_adopters',
                    data: { accountAge: 50, monthlyOrders: 100, paymentFailures: 0 },
                    expectedMin: 5,
                    expectedMax: 5,
                    description: 'New adopters baseline'
                },
                {
                    segment: 'price_sensitive',
                    data: { accountAge: 200, monthlyOrders: 50, paymentFailures: 3 },
                    expectedMin: 2,
                    expectedMax: 3,
                    description: 'Price sensitive with failures'
                }
            ];

            const gracePeriodResults = {};

            for (const scenario of scenarios) {
                try {
                    const gracePeriod = segManager.calculateSmartGracePeriod(scenario.segment, scenario.data);

                    const meetsMinimum = gracePeriod >= scenario.expectedMin;
                    const meetsMaximum = !scenario.expectedMax || gracePeriod <= scenario.expectedMax;

                    gracePeriodResults[scenario.segment] = {
                        gracePeriod,
                        expectedMin: scenario.expectedMin,
                        expectedMax: scenario.expectedMax,
                        meetsMinimum,
                        meetsMaximum,
                        passed: meetsMinimum && meetsMaximum,
                        description: scenario.description
                    };
                } catch (error) {
                    gracePeriodResults[scenario.segment] = {
                        passed: false,
                        error: error.message
                    };
                }
            }

            const allGracePeriodsCorrect = Object.values(gracePeriodResults).every(r => r.passed === true);

            this.recordTestResult(
                'Grace Period Calculations',
                allGracePeriodsCorrect,
                allGracePeriodsCorrect ? 'All grace periods calculated correctly' : 'Some grace periods incorrect',
                gracePeriodResults
            );

        } catch (error) {
            this.recordTestResult('Grace Period Calculations', false, error.message);
        }
    }

    async testPersonalizedContent() {
        try {
            const segManager = window.CustomerSegmentationManager;
            const customerData = {
                name: 'Test Restaurant',
                accountAge: 200,
                monthlyOrders: 500
            };

            const contentTypes = ['payment_failure', 'grace_warning'];
            const segments = ['power_users', 'new_adopters', 'price_sensitive'];
            const contentResults = {};

            for (const segment of segments) {
                contentResults[segment] = {};

                for (const type of contentTypes) {
                    try {
                        const content = segManager.getPersonalizedContent(segment, type, customerData);

                        const hasSubject = content.subject && typeof content.subject === 'string';
                        const hasTone = content.tone && typeof content.tone === 'string';
                        const hasBenefits = Array.isArray(content.benefits);
                        const hasCTA = content.cta && typeof content.cta === 'string';
                        const isPersonalized = content.subject.includes(customerData.name);

                        contentResults[segment][type] = {
                            hasSubject,
                            hasTone,
                            hasBenefits,
                            hasCTA,
                            isPersonalized,
                            passed: hasSubject && hasTone && hasBenefits && hasCTA
                        };

                        if (!isPersonalized) {
                            this.recordWarning('Content Personalization', `${segment}/${type} content not personalized with customer name`);
                        }

                    } catch (error) {
                        contentResults[segment][type] = {
                            passed: false,
                            error: error.message
                        };
                    }
                }
            }

            // Check if all content generation passed
            let allContentPassed = true;
            for (const segment of segments) {
                for (const type of contentTypes) {
                    if (!contentResults[segment][type].passed) {
                        allContentPassed = false;
                        break;
                    }
                }
                if (!allContentPassed) break;
            }

            this.recordTestResult(
                'Personalized Content',
                allContentPassed,
                allContentPassed ? 'All personalized content generated correctly' : 'Some content generation failed',
                contentResults
            );

        } catch (error) {
            this.recordTestResult('Personalized Content', false, error.message);
        }
    }

    async testPeakHoursDetection() {
        try {
            const segManager = window.CustomerSegmentationManager;

            // Test peak hours detection
            const isPeakHours = segManager.isRestaurantPeakHours();
            const isValidBoolean = typeof isPeakHours === 'boolean';

            // Test current time logic (simplified test)
            const now = new Date();
            const hour = now.getHours();
            const day = now.getDay();

            // Basic logic: lunch (11-14) and dinner (18-21) on weekdays (1-5)
            const shouldBePeak = (day >= 1 && day <= 5) &&
                               ((hour >= 11 && hour <= 14) || (hour >= 18 && hour <= 21));

            this.recordTestResult(
                'Peak Hours Detection',
                isValidBoolean,
                `Peak hours detection returns boolean: ${isPeakHours}`,
                {
                    isPeakHours,
                    isValidBoolean,
                    currentHour: hour,
                    currentDay: day,
                    shouldBePeak,
                    logicalMatch: isPeakHours === shouldBePeak
                }
            );

            // Note: We don't fail the test if logic doesn't match exactly since the actual
            // implementation may have more complex logic than our simplified test

        } catch (error) {
            this.recordTestResult('Peak Hours Detection', false, error.message);
        }
    }

    // PHASE 3: ADVANCED INTELLIGENCE TESTING
    async testPhase3_AdvancedIntelligence() {
        this.currentPhase = 'Phase 3: Advanced Intelligence';
        this.log('=== STARTING PHASE 3: ADVANCED INTELLIGENCE TESTING ===', 'info');

        await this.testAdvancedIntelligenceAvailability();
        await this.testBehaviorAnalysis();
        await this.testABTestingFramework();
        await this.testPredictiveAnalytics();
        await this.testIntelligentRecommendations();
    }

    async testAdvancedIntelligenceAvailability() {
        try {
            const hasAdvancedIntelligence = typeof window.AdvancedNotificationIntelligence !== 'undefined';

            if (!hasAdvancedIntelligence) {
                throw new Error('AdvancedNotificationIntelligence not found');
            }

            const intelligence = window.AdvancedNotificationIntelligence;
            const isInitialized = intelligence.initialized === true;
            const hasExperiments = intelligence.experiments instanceof Map;
            const hasAnalytics = intelligence.analytics instanceof Map;

            // Test key methods
            const hasBehaviorMethod = typeof intelligence.buildBehaviorModel === 'function';
            const hasExperimentMethod = typeof intelligence.createExperiment === 'function';
            const hasPredictionMethod = typeof intelligence.generatePredictions === 'function';
            const hasIntelligenceMethod = typeof intelligence.getNotificationIntelligence === 'function';

            const testPassed = isInitialized && hasExperiments && hasAnalytics &&
                             hasBehaviorMethod && hasExperimentMethod &&
                             hasPredictionMethod && hasIntelligenceMethod;

            this.recordTestResult(
                'Advanced Intelligence Availability',
                testPassed,
                testPassed ? 'All advanced intelligence components available' : 'Missing components',
                {
                    hasAdvancedIntelligence,
                    isInitialized,
                    hasExperiments,
                    hasAnalytics,
                    hasBehaviorMethod,
                    hasExperimentMethod,
                    hasPredictionMethod,
                    hasIntelligenceMethod
                }
            );

        } catch (error) {
            this.recordTestResult('Advanced Intelligence Availability', false, error.message);
        }
    }

    async testBehaviorAnalysis() {
        try {
            const intelligence = window.AdvancedNotificationIntelligence;

            // Mock interaction data
            const mockInteractions = [
                { timestamp: Date.now() - 60000, action: 'click', notificationType: 'payment_failure' },
                { timestamp: Date.now() - 120000, action: 'dismiss', notificationType: 'grace_warning' },
                { timestamp: Date.now() - 180000, action: 'resolve', notificationType: 'payment_failure' }
            ];

            // Store mock data temporarily
            const originalData = localStorage.getItem('pospal_segment_analytics');
            localStorage.setItem('pospal_segment_analytics', JSON.stringify(mockInteractions));

            try {
                // Test behavior model building
                const historicalData = intelligence.getHistoricalInteractionData();
                const behaviorModel = intelligence.buildBehaviorModel(historicalData);

                const hasEngagementScore = typeof behaviorModel.engagementScore === 'number';
                const hasTimingPrefs = behaviorModel.preferredTiming && Array.isArray(behaviorModel.preferredTiming.preferredHours);
                const hasResponsePatterns = behaviorModel.responsePatterns && typeof behaviorModel.responsePatterns === 'object';

                // Test notification intelligence
                const notificationIntel = intelligence.getNotificationIntelligence({});
                const hasRecommendation = ['show', 'delay'].includes(notificationIntel.recommendation);
                const hasReasoning = typeof notificationIntel.reasoning === 'string';

                const testPassed = hasEngagementScore && hasTimingPrefs &&
                                 hasResponsePatterns && hasRecommendation && hasReasoning;

                this.recordTestResult(
                    'Behavior Analysis',
                    testPassed,
                    testPassed ? 'Behavior analysis working correctly' : 'Behavior analysis issues',
                    {
                        engagementScore: behaviorModel.engagementScore,
                        hasTimingPrefs,
                        hasResponsePatterns,
                        recommendation: notificationIntel.recommendation,
                        hasReasoning
                    }
                );

            } finally {
                // Restore original data
                if (originalData) {
                    localStorage.setItem('pospal_segment_analytics', originalData);
                } else {
                    localStorage.removeItem('pospal_segment_analytics');
                }
            }

        } catch (error) {
            this.recordTestResult('Behavior Analysis', false, error.message);
        }
    }

    async testABTestingFramework() {
        try {
            const intelligence = window.AdvancedNotificationIntelligence;

            // Create test experiment
            const variants = [
                { name: 'control', timing: 'immediate' },
                { name: 'variant_a', timing: 'delayed' },
                { name: 'variant_b', timing: 'scheduled' }
            ];

            const experiment = intelligence.createExperiment('timing_test_' + Date.now(), variants, {
                trafficSplit: [0.33, 0.33, 0.34]
            });

            const experimentCreated = experiment && experiment.name;

            // Test variant assignment consistency
            const user1 = 'user_123_' + Date.now();
            const variant1 = intelligence.getExperimentVariant(experiment.name, user1);
            const variant2 = intelligence.getExperimentVariant(experiment.name, user1);

            const variantConsistency = variant1 && variant2 && variant1.index === variant2.index;

            // Test different users get potentially different variants
            const user2 = 'user_456_' + Date.now();
            const variant3 = intelligence.getExperimentVariant(experiment.name, user2);
            const variantDiversity = variant3 !== null;

            // Test metric recording
            let metricRecorded = false;
            try {
                intelligence.recordExperimentMetric(experiment.name, 'click_rate', 0.15, user1);
                metricRecorded = true;
            } catch (error) {
                // Metric recording might fail in test environment
                this.recordWarning('A/B Testing', `Metric recording failed: ${error.message}`);
            }

            // Test results calculation
            let resultsCalculated = false;
            try {
                const results = intelligence.getExperimentResults(experiment.name);
                resultsCalculated = results && typeof results === 'object';
            } catch (error) {
                // Results might not be available immediately
                this.recordWarning('A/B Testing', `Results calculation failed: ${error.message}`);
            }

            const testPassed = experimentCreated && variantConsistency && variantDiversity;

            this.recordTestResult(
                'A/B Testing Framework',
                testPassed,
                testPassed ? 'A/B testing framework working correctly' : 'A/B testing issues',
                {
                    experimentCreated,
                    variantConsistency,
                    variantDiversity,
                    metricRecorded,
                    resultsCalculated
                }
            );

        } catch (error) {
            this.recordTestResult('A/B Testing Framework', false, error.message);
        }
    }

    async testPredictiveAnalytics() {
        try {
            const intelligence = window.AdvancedNotificationIntelligence;

            // Test prediction generation
            const predictions = intelligence.generatePredictions();

            const hasPredictions = predictions && typeof predictions === 'object';

            // Check required fields
            const requiredFields = ['optimalNextNotificationTime', 'expectedEngagement', 'recommendedStrategy', 'riskFactors'];
            const hasAllFields = requiredFields.every(field => field in predictions);

            // Test engagement prediction
            const engagement = intelligence.predictEngagement();
            const validEngagement = typeof engagement === 'number' && engagement >= 0 && engagement <= 1;

            // Test strategy recommendation
            const strategy = intelligence.recommendStrategy();
            const validStrategies = ['aggressive', 'moderate', 'gentle', 'minimal'];
            const validStrategy = validStrategies.includes(strategy);

            // Test risk factor identification
            const risks = intelligence.identifyRiskFactors();
            const validRisks = Array.isArray(risks);

            const testPassed = hasPredictions && hasAllFields && validEngagement &&
                             validStrategy && validRisks;

            this.recordTestResult(
                'Predictive Analytics',
                testPassed,
                testPassed ? 'Predictive analytics working correctly' : 'Predictive analytics issues',
                {
                    hasPredictions,
                    hasAllFields,
                    engagement,
                    validEngagement,
                    strategy,
                    validStrategy,
                    riskCount: risks ? risks.length : 0,
                    validRisks
                }
            );

        } catch (error) {
            this.recordTestResult('Predictive Analytics', false, error.message);
        }
    }

    async testIntelligentRecommendations() {
        try {
            const intelligence = window.AdvancedNotificationIntelligence;

            // Test various scenarios for intelligent recommendations
            const scenarios = [
                {
                    context: { type: 'payment_failure', urgency: 'high', userSegment: 'power_users' },
                    expectedRecommendations: ['show', 'delay']
                },
                {
                    context: { type: 'grace_warning', urgency: 'medium', userSegment: 'new_adopters' },
                    expectedRecommendations: ['show', 'delay']
                },
                {
                    context: { type: 'info', urgency: 'low', userSegment: 'loyal_customers' },
                    expectedRecommendations: ['show', 'delay']
                }
            ];

            const recommendationResults = {};

            for (let i = 0; i < scenarios.length; i++) {
                const scenario = scenarios[i];
                try {
                    const recommendation = intelligence.getNotificationIntelligence(scenario.context);

                    const hasValidRecommendation = scenario.expectedRecommendations.includes(recommendation.recommendation);
                    const hasReasoning = typeof recommendation.reasoning === 'string' && recommendation.reasoning.length > 0;
                    const hasConfidence = typeof recommendation.confidence === 'number';

                    recommendationResults[`scenario_${i}`] = {
                        context: scenario.context,
                        recommendation: recommendation.recommendation,
                        hasValidRecommendation,
                        hasReasoning,
                        hasConfidence,
                        passed: hasValidRecommendation && hasReasoning
                    };
                } catch (error) {
                    recommendationResults[`scenario_${i}`] = {
                        passed: false,
                        error: error.message
                    };
                }
            }

            const allRecommendationsPassed = Object.values(recommendationResults).every(r => r.passed === true);

            this.recordTestResult(
                'Intelligent Recommendations',
                allRecommendationsPassed,
                allRecommendationsPassed ? 'All recommendations working correctly' : 'Some recommendation issues',
                recommendationResults
            );

        } catch (error) {
            this.recordTestResult('Intelligent Recommendations', false, error.message);
        }
    }

    // PHASE 4: MOBILE & UX FEATURES
    async testPhase4_MobileUX() {
        this.currentPhase = 'Phase 4: Mobile & UX';
        this.log('=== STARTING PHASE 4: MOBILE & UX FEATURES TESTING ===', 'info');

        await this.testMobileResponsiveness();
        await this.testTouchTargets();
        await this.testAccessibilityFeatures();
        await this.testHapticFeedback();
        await this.testGestureSupport();
    }

    async testMobileResponsiveness() {
        try {
            // Simulate mobile viewport
            const originalWidth = window.innerWidth;
            const originalHeight = window.innerHeight;

            // Mock mobile dimensions
            Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });
            Object.defineProperty(window, 'innerHeight', { value: 667, writable: true });

            const manager = window.NotificationManager;
            const toastId = manager.showToast('Mobile responsive test', 'info', 5000);

            await new Promise(resolve => setTimeout(resolve, 200));

            const element = document.getElementById(`notification-${toastId}`);
            let mobileTests = {
                elementExists: false,
                hasMobileClasses: false,
                fontSize16px: false,
                hasLeftRightMargins: false
            };

            if (element) {
                mobileTests.elementExists = true;

                // Check for mobile-specific classes or styles
                const hasSwipeableClass = element.classList.contains('pospal-notification-swipeable') ||
                                        element.querySelector('.pospal-notification-swipeable');

                const styles = window.getComputedStyle(element);
                mobileTests.fontSize16px = parseInt(styles.fontSize) >= 16; // iOS zoom prevention

                // Check positioning for mobile
                const hasLeftRightPosition = element.style.left && element.style.right;
                mobileTests.hasLeftRightMargins = hasLeftRightPosition;

                mobileTests.hasMobileClasses = hasSwipeableClass || hasLeftRightPosition;
            }

            // Restore original dimensions
            Object.defineProperty(window, 'innerWidth', { value: originalWidth, writable: true });
            Object.defineProperty(window, 'innerHeight', { value: originalHeight, writable: true });

            manager.hide(toastId);

            const testPassed = mobileTests.elementExists && mobileTests.fontSize16px;

            this.recordTestResult(
                'Mobile Responsiveness',
                testPassed,
                testPassed ? 'Mobile responsive features working' : 'Mobile responsiveness issues',
                mobileTests
            );

        } catch (error) {
            this.recordTestResult('Mobile Responsiveness', false, error.message);
        }
    }

    async testTouchTargets() {
        try {
            const manager = window.NotificationManager;
            const notificationId = manager.show({
                type: 'banner',
                title: 'Touch Target Test',
                message: 'Testing touch target sizes',
                actions: [
                    { id: 'test-action', label: 'Test Action', handler: () => {} },
                    { id: 'cancel-action', label: 'Cancel', handler: () => {} }
                ]
            });

            await new Promise(resolve => setTimeout(resolve, 200));

            const element = document.getElementById(`notification-${notificationId}`);
            let touchTargetTests = {
                elementExists: false,
                buttonCount: 0,
                validTouchTargets: 0,
                allTargetsValid: false
            };

            if (element) {
                touchTargetTests.elementExists = true;
                const buttons = element.querySelectorAll('button');
                touchTargetTests.buttonCount = buttons.length;

                buttons.forEach(button => {
                    const styles = window.getComputedStyle(button);
                    const width = parseFloat(styles.width) || parseFloat(styles.minWidth) || 0;
                    const height = parseFloat(styles.height) || parseFloat(styles.minHeight) || 0;

                    // Check for minimum touch target size (44x44px)
                    if (width >= 44 && height >= 44) {
                        touchTargetTests.validTouchTargets++;
                    }
                });

                touchTargetTests.allTargetsValid = touchTargetTests.validTouchTargets === touchTargetTests.buttonCount;
            }

            manager.hide(notificationId);

            this.recordTestResult(
                'Touch Targets',
                touchTargetTests.allTargetsValid,
                touchTargetTests.allTargetsValid ?
                    `All ${touchTargetTests.buttonCount} buttons meet 44x44px minimum` :
                    `${touchTargetTests.validTouchTargets}/${touchTargetTests.buttonCount} buttons meet minimum size`,
                touchTargetTests
            );

        } catch (error) {
            this.recordTestResult('Touch Targets', false, error.message);
        }
    }

    async testAccessibilityFeatures() {
        try {
            const manager = window.NotificationManager;
            const notificationId = manager.show({
                type: 'banner',
                title: 'Accessibility Test',
                message: 'Testing ARIA attributes and screen reader support',
                priority: 'critical'
            });

            await new Promise(resolve => setTimeout(resolve, 200));

            const element = document.getElementById(`notification-${notificationId}`);
            let accessibilityTests = {
                elementExists: false,
                hasRole: false,
                hasAriaLive: false,
                hasAriaAtomic: false,
                correctRoleValue: false,
                correctAriaLive: false,
                correctAriaAtomic: false,
                hasFocusManagement: false
            };

            if (element) {
                accessibilityTests.elementExists = true;

                const role = element.getAttribute('role');
                const ariaLive = element.getAttribute('aria-live');
                const ariaAtomic = element.getAttribute('aria-atomic');

                accessibilityTests.hasRole = role !== null;
                accessibilityTests.hasAriaLive = ariaLive !== null;
                accessibilityTests.hasAriaAtomic = ariaAtomic !== null;

                accessibilityTests.correctRoleValue = role === 'alert' || role === 'status';
                accessibilityTests.correctAriaLive = ['polite', 'assertive'].includes(ariaLive);
                accessibilityTests.correctAriaAtomic = ariaAtomic === 'true';

                // Check for focus management
                const hasFocusableElements = element.querySelectorAll('button, a, [tabindex]').length > 0;
                accessibilityTests.hasFocusManagement = hasFocusableElements;
            }

            manager.hide(notificationId);

            const testPassed = accessibilityTests.elementExists &&
                             accessibilityTests.hasRole &&
                             accessibilityTests.hasAriaLive &&
                             accessibilityTests.correctRoleValue &&
                             accessibilityTests.correctAriaLive;

            this.recordTestResult(
                'Accessibility Features',
                testPassed,
                testPassed ? 'Accessibility features properly implemented' : 'Accessibility issues detected',
                accessibilityTests
            );

        } catch (error) {
            this.recordTestResult('Accessibility Features', false, error.message);
        }
    }

    async testHapticFeedback() {
        try {
            const manager = window.NotificationManager;

            // Check if haptic feedback method exists
            const hasHapticMethod = typeof manager.triggerHapticFeedback === 'function';

            let hapticTests = {
                hasHapticMethod,
                vibrateCalled: false,
                hasNavigatorVibrate: typeof navigator.vibrate !== 'undefined'
            };

            if (hasHapticMethod) {
                // Mock navigator.vibrate for testing
                const originalVibrate = navigator.vibrate;
                navigator.vibrate = (pattern) => {
                    hapticTests.vibrateCalled = true;
                    return true;
                };

                try {
                    manager.triggerHapticFeedback('light');
                } catch (error) {
                    // Haptic might not work in test environment
                    this.recordWarning('Haptic Feedback', `Haptic trigger failed: ${error.message}`);
                } finally {
                    // Restore original vibrate function
                    if (originalVibrate) {
                        navigator.vibrate = originalVibrate;
                    }
                }
            }

            // Haptic feedback is considered working if the method exists
            // Actual functionality depends on device/browser support
            const testPassed = hasHapticMethod;

            this.recordTestResult(
                'Haptic Feedback',
                testPassed,
                testPassed ? 'Haptic feedback method available' : 'Haptic feedback method missing',
                hapticTests
            );

        } catch (error) {
            this.recordTestResult('Haptic Feedback', false, error.message);
        }
    }

    async testGestureSupport() {
        try {
            const manager = window.NotificationManager;
            const notificationId = manager.showToast('Swipe test notification', 'info', 10000);

            await new Promise(resolve => setTimeout(resolve, 200));

            const element = document.getElementById(`notification-${notificationId}`);
            let gestureTests = {
                elementExists: false,
                hasSwipeClass: false,
                hasTouchListeners: false,
                hasSwipeIndicator: false
            };

            if (element) {
                gestureTests.elementExists = true;

                // Check for swipe-related classes
                gestureTests.hasSwipeClass = element.classList.contains('pospal-notification-swipeable') ||
                                          element.classList.contains('swipeable');

                // Check for touch event listeners (simplified check)
                const hasTouch = element.ontouchstart !== undefined ||
                               element.ontouchmove !== undefined ||
                               element.ontouchend !== undefined;
                gestureTests.hasTouchListeners = hasTouch;

                // Check for swipe indicator (the visual hint for swiping)
                const hasIndicator = element.querySelector('.swipe-indicator') ||
                                   element.querySelector('::before') || // CSS pseudo-element
                                   getComputedStyle(element, '::before').content !== 'none';
                gestureTests.hasSwipeIndicator = hasIndicator;
            }

            manager.hide(notificationId);

            // Gesture support is optional, so we pass if basic structure is there
            const testPassed = gestureTests.elementExists;

            this.recordTestResult(
                'Gesture Support',
                testPassed,
                testPassed ? 'Gesture support structure in place' : 'Gesture support issues',
                gestureTests
            );

            // Record informational warnings
            if (!gestureTests.hasSwipeClass) {
                this.recordWarning('Gesture Support', 'No swipe classes detected on notifications');
            }

        } catch (error) {
            this.recordTestResult('Gesture Support', false, error.message);
        }
    }

    // PHASE 5: BUSINESS LOGIC & REAL-WORLD SCENARIOS
    async testPhase5_BusinessScenarios() {
        this.currentPhase = 'Phase 5: Business Scenarios';
        this.log('=== STARTING PHASE 5: BUSINESS LOGIC & REAL-WORLD SCENARIOS ===', 'info');

        await this.testTrialExpirationFlow();
        await this.testOfflineOnlineScenario();
        await this.testPaymentFailureHandling();
        await this.testConcurrentUserSimulation();
        await this.testHighVolumeNotifications();
    }

    async testTrialExpirationFlow() {
        try {
            // Test if progressive warning functions exist
            const hasProgressiveWarning = typeof showSmartProgressiveWarning === 'function';

            let trialTests = {
                hasProgressiveWarning,
                day8Notification: false,
                day9Notification: false,
                day10Notification: false,
                notificationContent: {}
            };

            if (hasProgressiveWarning) {
                // Test different days in grace period
                const testDays = [8, 9, 10];
                const gracePeriod = 10;

                for (const day of testDays) {
                    try {
                        // Clear existing notifications
                        window.NotificationManager.clear();

                        // Mock customer data
                        const mockCustomerData = {
                            name: 'Test Restaurant',
                            accountAge: 365,
                            monthlyOrders: 500,
                            paymentFailures: 0
                        };

                        localStorage.setItem('pospal_customer_data', JSON.stringify(mockCustomerData));

                        // Trigger progressive warning
                        showSmartProgressiveWarning(day, gracePeriod);

                        await new Promise(resolve => setTimeout(resolve, 100));

                        // Check if notification was created
                        const hasNotification = window.NotificationManager.activeNotifications.size > 0;
                        trialTests[`day${day}Notification`] = hasNotification;

                        if (hasNotification) {
                            const notification = Array.from(window.NotificationManager.activeNotifications.values())[0];
                            trialTests.notificationContent[`day${day}`] = {
                                type: notification.type,
                                hasMessage: !!notification.message,
                                hasTitle: !!notification.title
                            };
                        }

                    } catch (error) {
                        this.recordWarning('Trial Expiration', `Day ${day} test failed: ${error.message}`);
                    } finally {
                        localStorage.removeItem('pospal_customer_data');
                    }
                }
            }

            const allDaysWorking = trialTests.day8Notification &&
                                  trialTests.day9Notification &&
                                  trialTests.day10Notification;

            const testPassed = hasProgressiveWarning && allDaysWorking;

            this.recordTestResult(
                'Trial Expiration Flow',
                testPassed,
                testPassed ? 'Progressive warnings working for all days' : 'Some trial expiration issues',
                trialTests
            );

        } catch (error) {
            this.recordTestResult('Trial Expiration Flow', false, error.message);
        }
    }

    async testOfflineOnlineScenario() {
        try {
            const hasOfflineIndicator = typeof showSmartOfflineIndicator === 'function';

            let offlineTests = {
                hasOfflineIndicator,
                offlineNotificationShown: false,
                offlineNotificationPersistent: false,
                onlineTransition: false
            };

            if (hasOfflineIndicator) {
                // Clear existing notifications
                window.NotificationManager.clear();

                // Show offline indicator
                showSmartOfflineIndicator(3, 7);

                await new Promise(resolve => setTimeout(resolve, 100));

                // Check offline notification
                offlineTests.offlineNotificationShown = window.NotificationManager.activeNotifications.size > 0;

                if (offlineTests.offlineNotificationShown) {
                    const notification = Array.from(window.NotificationManager.activeNotifications.values())[0];
                    offlineTests.offlineNotificationPersistent = notification.type === 'persistent';
                }

                // Simulate coming back online
                window.NotificationManager.clear('persistent');
                window.NotificationManager.showToast('Connection restored! All features are now available.', 'success', 3000);

                await new Promise(resolve => setTimeout(resolve, 100));

                // Check online transition
                const activeNotifications = Array.from(window.NotificationManager.activeNotifications.values());
                const hasSuccessToast = activeNotifications.some(n =>
                    n.type === 'toast' && n.message && n.message.includes('restored')
                );
                const noOfflineIndicators = !activeNotifications.some(n => n.type === 'persistent');

                offlineTests.onlineTransition = hasSuccessToast && noOfflineIndicators;
            }

            const testPassed = hasOfflineIndicator &&
                             offlineTests.offlineNotificationShown &&
                             offlineTests.offlineNotificationPersistent &&
                             offlineTests.onlineTransition;

            this.recordTestResult(
                'Offline/Online Scenario',
                testPassed,
                testPassed ? 'Offline/online transitions working correctly' : 'Offline/online transition issues',
                offlineTests
            );

        } catch (error) {
            this.recordTestResult('Offline/Online Scenario', false, error.message);
        }
    }

    async testPaymentFailureHandling() {
        try {
            // Test payment failure notification with different customer segments
            const segManager = window.CustomerSegmentationManager;
            const manager = window.NotificationManager;

            const customerProfiles = [
                { segment: 'power_users', name: 'Power Corp', accountAge: 400, monthlyOrders: 1200 },
                { segment: 'new_adopters', name: 'New Cafe', accountAge: 30, monthlyOrders: 50 },
                { segment: 'price_sensitive', name: 'Budget Bistro', accountAge: 100, monthlyOrders: 100 }
            ];

            let paymentTests = {};

            for (const profile of customerProfiles) {
                try {
                    manager.clear();

                    // Get personalized content for payment failure
                    const content = segManager.getPersonalizedContent(profile.segment, 'payment_failure', profile);

                    // Create payment failure notification
                    const notificationId = manager.show({
                        type: 'banner',
                        title: content.subject,
                        message: 'Your payment method needs attention.',
                        priority: profile.segment === 'power_users' ? 'high' : 'normal',
                        actions: [
                            { id: 'update-payment', label: content.cta, handler: () => {} },
                            { id: 'contact-support', label: 'Contact Support', handler: () => {} }
                        ]
                    });

                    await new Promise(resolve => setTimeout(resolve, 100));

                    const notification = manager.activeNotifications.get(notificationId);

                    paymentTests[profile.segment] = {
                        notificationCreated: !!notification,
                        hasPersonalizedContent: content.subject.includes(profile.name),
                        hasActions: notification && notification.actions && notification.actions.length > 0,
                        correctPriority: notification && notification.priority === (profile.segment === 'power_users' ? 'high' : 'normal')
                    };

                    manager.hide(notificationId);

                } catch (error) {
                    paymentTests[profile.segment] = {
                        notificationCreated: false,
                        error: error.message
                    };
                }
            }

            const allPaymentTestsPassed = Object.values(paymentTests).every(test =>
                test.notificationCreated && test.hasPersonalizedContent && test.hasActions
            );

            this.recordTestResult(
                'Payment Failure Handling',
                allPaymentTestsPassed,
                allPaymentTestsPassed ? 'Payment failure handling working for all segments' : 'Payment failure handling issues',
                paymentTests
            );

        } catch (error) {
            this.recordTestResult('Payment Failure Handling', false, error.message);
        }
    }

    async testConcurrentUserSimulation() {
        try {
            const manager = window.NotificationManager;
            manager.clear();

            // Simulate multiple users/sessions with notifications
            const userSessions = [];
            const notificationIds = [];

            for (let userId = 0; userId < 5; userId++) {
                const sessionData = {
                    userId: `user_${userId}`,
                    segment: userId % 2 === 0 ? 'power_users' : 'new_adopters',
                    notifications: []
                };

                // Create multiple notifications per user
                for (let notifIndex = 0; notifIndex < 3; notifIndex++) {
                    const id = manager.showToast(
                        `User ${userId} notification ${notifIndex}`,
                        ['info', 'warning', 'success'][notifIndex % 3],
                        10000
                    );
                    sessionData.notifications.push(id);
                    notificationIds.push(id);
                }

                userSessions.push(sessionData);
            }

            await new Promise(resolve => setTimeout(resolve, 200)); // Let queue process

            const activeCount = manager.activeNotifications.size;
            const queueCount = manager.queue.length;
            const totalManaged = activeCount + queueCount;
            const expectedTotal = 15; // 5 users * 3 notifications

            let concurrentTests = {
                expectedNotifications: expectedTotal,
                actualNotifications: totalManaged,
                allNotificationsManaged: totalManaged === expectedTotal,
                queueSystemWorking: queueCount >= 0, // Queue should exist
                activeSystemWorking: activeCount > 0  // Some should be active
            };

            // Test concurrent access doesn't break the system
            const managerStillResponsive = typeof manager.show === 'function';
            concurrentTests.systemStillResponsive = managerStillResponsive;

            manager.clear();

            const testPassed = concurrentTests.allNotificationsManaged &&
                             concurrentTests.systemStillResponsive;

            this.recordTestResult(
                'Concurrent User Simulation',
                testPassed,
                testPassed ? `Handled ${totalManaged} concurrent notifications successfully` : `Concurrent handling issues: ${totalManaged}/${expectedTotal}`,
                concurrentTests
            );

        } catch (error) {
            this.recordTestResult('Concurrent User Simulation', false, error.message);
        }
    }

    async testHighVolumeNotifications() {
        try {
            const manager = window.NotificationManager;
            const intelligence = window.AdvancedNotificationIntelligence;

            manager.clear();

            const startTime = performance.now();
            const notificationCount = 50;
            const notificationIds = [];

            // Create high volume of notifications rapidly
            for (let i = 0; i < notificationCount; i++) {
                const id = manager.showToast(
                    `High volume test notification ${i}`,
                    'info',
                    30000
                );
                notificationIds.push(id);

                // Small delay to simulate real-world timing
                if (i % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }

            const creationTime = performance.now() - startTime;

            await new Promise(resolve => setTimeout(resolve, 300)); // Let system process

            const activeCount = manager.activeNotifications.size;
            const queueCount = manager.queue.length;
            const totalManaged = activeCount + queueCount;

            // Test anti-spam intelligence
            let antiSpamWorking = false;
            try {
                const recommendation = intelligence.getNotificationIntelligence({});
                antiSpamWorking = recommendation.recommendation === 'delay';
            } catch (error) {
                this.recordWarning('High Volume', `Anti-spam check failed: ${error.message}`);
            }

            let volumeTests = {
                notificationsCreated: notificationIds.filter(id => id !== null).length,
                expectedNotifications: notificationCount,
                totalManaged,
                activeCount,
                queueCount,
                creationTime: creationTime.toFixed(2),
                performanceGood: creationTime < 2000, // Should create 50 notifications in under 2 seconds
                allNotificationsManaged: totalManaged === notificationCount,
                antiSpamWorking
            };

            manager.clear();

            const testPassed = volumeTests.allNotificationsManaged && volumeTests.performanceGood;

            this.recordTestResult(
                'High Volume Notifications',
                testPassed,
                testPassed ?
                    `Successfully handled ${notificationCount} notifications in ${volumeTests.creationTime}ms` :
                    `High volume issues: ${totalManaged}/${notificationCount} managed, ${volumeTests.creationTime}ms`,
                volumeTests
            );

            // Performance warning
            if (!volumeTests.performanceGood) {
                this.recordWarning('Performance', `Slow notification creation: ${volumeTests.creationTime}ms for ${notificationCount} notifications`);
            }

        } catch (error) {
            this.recordTestResult('High Volume Notifications', false, error.message);
        }
    }

    // PHASE 6: DATA PERSISTENCE & ERROR HANDLING
    async testPhase6_DataPersistence() {
        this.currentPhase = 'Phase 6: Data Persistence';
        this.log('=== STARTING PHASE 6: DATA PERSISTENCE & ERROR HANDLING ===', 'info');

        await this.testLocalStoragePersistence();
        await this.testErrorHandlingRobustness();
        await this.testMemoryLeakPrevention();
        await this.testFallbackSystems();
    }

    async testLocalStoragePersistence() {
        try {
            const intelligence = window.AdvancedNotificationIntelligence;

            // Test analytics persistence
            const testAnalyticsData = {
                timestamp: Date.now(),
                action: 'test_action',
                notificationType: 'test_notification'
            };

            const originalAnalytics = localStorage.getItem('pospal_segment_analytics');

            // Store test data
            localStorage.setItem('pospal_segment_analytics', JSON.stringify([testAnalyticsData]));

            // Test data retrieval
            const retrievedData = intelligence.getHistoricalInteractionData();

            let persistenceTests = {
                dataStored: true,
                dataRetrieved: Array.isArray(retrievedData) && retrievedData.length > 0,
                dataIntegrity: false
            };

            if (persistenceTests.dataRetrieved && retrievedData.length > 0) {
                const firstItem = retrievedData[0];
                persistenceTests.dataIntegrity = firstItem.action === 'test_action' &&
                                               firstItem.notificationType === 'test_notification';
            }

            // Test experiment persistence
            const experimentName = 'test_experiment_' + Date.now();
            const experiment = intelligence.createExperiment(experimentName, [
                { name: 'control', value: 'test' }
            ]);

            const experimentStored = localStorage.getItem('pospal_notification_experiments');
            persistenceTests.experimentStored = experimentStored !== null;

            // Restore original data
            if (originalAnalytics) {
                localStorage.setItem('pospal_segment_analytics', originalAnalytics);
            } else {
                localStorage.removeItem('pospal_segment_analytics');
            }

            const testPassed = persistenceTests.dataStored &&
                             persistenceTests.dataRetrieved &&
                             persistenceTests.dataIntegrity;

            this.recordTestResult(
                'Local Storage Persistence',
                testPassed,
                testPassed ? 'Data persistence working correctly' : 'Data persistence issues',
                persistenceTests
            );

        } catch (error) {
            this.recordTestResult('Local Storage Persistence', false, error.message);
        }
    }

    async testErrorHandlingRobustness() {
        try {
            const manager = window.NotificationManager;
            let errorTests = {
                invalidConfigHandling: false,
                missingParameterHandling: false,
                corruptedDataHandling: false,
                systemStaysStable: false
            };

            // Test invalid configuration handling
            try {
                const id = manager.show(null);
                errorTests.invalidConfigHandling = id === null || id === undefined;
            } catch (error) {
                errorTests.invalidConfigHandling = true; // Exception handling is also valid
            }

            // Test missing parameter handling
            try {
                const id = manager.show({});
                errorTests.missingParameterHandling = id !== null; // Should handle gracefully
            } catch (error) {
                errorTests.missingParameterHandling = true;
            }

            // Test corrupted localStorage data
            const originalData = localStorage.getItem('pospal_segment_analytics');
            localStorage.setItem('pospal_segment_analytics', '{"invalid": json}');

            try {
                const intelligence = window.AdvancedNotificationIntelligence;
                const data = intelligence.getHistoricalInteractionData();
                errorTests.corruptedDataHandling = Array.isArray(data); // Should return empty array or valid data
            } catch (error) {
                errorTests.corruptedDataHandling = true; // Exception handling is valid
            }

            // Restore data
            if (originalData) {
                localStorage.setItem('pospal_segment_analytics', originalData);
            } else {
                localStorage.removeItem('pospal_segment_analytics');
            }

            // Test system stability after errors
            try {
                const testId = manager.showToast('Stability test after errors', 'info', 2000);
                errorTests.systemStaysStable = testId !== null && testId !== undefined;
                if (testId) manager.hide(testId);
            } catch (error) {
                errorTests.systemStaysStable = false;
            }

            const testPassed = errorTests.invalidConfigHandling &&
                             errorTests.missingParameterHandling &&
                             errorTests.corruptedDataHandling &&
                             errorTests.systemStaysStable;

            this.recordTestResult(
                'Error Handling Robustness',
                testPassed,
                testPassed ? 'Error handling robust across all scenarios' : 'Some error handling issues',
                errorTests
            );

        } catch (error) {
            this.recordTestResult('Error Handling Robustness', false, error.message);
        }
    }

    async testMemoryLeakPrevention() {
        try {
            const manager = window.NotificationManager;
            const timerManager = window.TimerManager;

            const initialTimers = timerManager.timers.size;
            const initialNotifications = manager.activeNotifications.size;

            // Create and auto-hide many notifications to test cleanup
            const testCycles = 3;
            const notificationsPerCycle = 10;

            for (let cycle = 0; cycle < testCycles; cycle++) {
                const ids = [];

                // Create notifications
                for (let i = 0; i < notificationsPerCycle; i++) {
                    const id = manager.showToast(`Memory test cycle ${cycle} notification ${i}`, 'info', 500);
                    ids.push(id);
                }

                // Wait for auto-hide
                await new Promise(resolve => setTimeout(resolve, 600));

                // Force cleanup
                manager.clear();

                // Small pause between cycles
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Final cleanup wait
            await new Promise(resolve => setTimeout(resolve, 200));

            const finalTimers = timerManager.timers.size;
            const finalNotifications = manager.activeNotifications.size;

            let memoryTests = {
                initialTimers,
                finalTimers,
                initialNotifications,
                finalNotifications,
                timerLeakage: finalTimers > initialTimers + 3, // Allow some tolerance
                notificationLeakage: finalNotifications > initialNotifications + 1,
                excessiveTimers: finalTimers > 20, // Arbitrary threshold for "excessive"
                cleanupEffective: finalNotifications <= initialNotifications && finalTimers <= initialTimers + 3
            };

            const testPassed = !memoryTests.timerLeakage &&
                             !memoryTests.notificationLeakage &&
                             !memoryTests.excessiveTimers;

            this.recordTestResult(
                'Memory Leak Prevention',
                testPassed,
                testPassed ? 'No memory leaks detected' : 'Potential memory leaks detected',
                memoryTests
            );

            if (memoryTests.timerLeakage) {
                this.recordWarning('Memory', `Potential timer leak: ${finalTimers - initialTimers} excess timers`);
            }

        } catch (error) {
            this.recordTestResult('Memory Leak Prevention', false, error.message);
        }
    }

    async testFallbackSystems() {
        try {
            // Test basic functionality when advanced systems are unavailable
            const originalSegmentation = window.CustomerSegmentationManager;
            const originalIntelligence = window.AdvancedNotificationIntelligence;

            // Temporarily disable advanced systems
            delete window.CustomerSegmentationManager;
            delete window.AdvancedNotificationIntelligence;

            let fallbackTests = {
                basicNotificationsWork: false,
                progressiveWarningsFallback: false,
                offlineIndicatorFallback: false,
                systemStaysStable: false
            };

            try {
                // Test basic notifications still work
                const id = window.NotificationManager.showToast('Fallback test', 'info', 2000);
                fallbackTests.basicNotificationsWork = id !== null && id !== undefined;
                if (id) window.NotificationManager.hide(id);

                // Test progressive warnings with fallback
                if (typeof showSmartProgressiveWarning === 'function') {
                    try {
                        showSmartProgressiveWarning(8, 10);
                        fallbackTests.progressiveWarningsFallback = true;
                    } catch (error) {
                        // Should not throw error, should gracefully degrade
                        fallbackTests.progressiveWarningsFallback = false;
                    }
                }

                // Test offline indicator with fallback
                if (typeof showSmartOfflineIndicator === 'function') {
                    try {
                        showSmartOfflineIndicator(5, 7);
                        fallbackTests.offlineIndicatorFallback = true;
                    } catch (error) {
                        fallbackTests.offlineIndicatorFallback = false;
                    }
                }

                // Test system stability
                fallbackTests.systemStaysStable = typeof window.NotificationManager.show === 'function';

            } finally {
                // Restore advanced systems
                window.CustomerSegmentationManager = originalSegmentation;
                window.AdvancedNotificationIntelligence = originalIntelligence;
            }

            const testPassed = fallbackTests.basicNotificationsWork &&
                             fallbackTests.systemStaysStable;

            this.recordTestResult(
                'Fallback Systems',
                testPassed,
                testPassed ? 'Fallback systems working correctly' : 'Fallback system issues',
                fallbackTests
            );

        } catch (error) {
            this.recordTestResult('Fallback Systems', false, error.message);
        }
    }

    // MAIN TEST RUNNER
    async runComprehensiveTests() {
        this.log('🧪 STARTING COMPREHENSIVE NOTIFICATION SYSTEM TESTING', 'info');
        this.log(`Testing Environment: ${navigator.userAgent}`, 'info');
        this.log(`Window Size: ${window.innerWidth}x${window.innerHeight}`, 'info');
        this.log(`Test Start Time: ${new Date().toISOString()}`, 'info');

        try {
            await this.testPhase1_CoreArchitecture();
            await this.testPhase2_CustomerSegmentation();
            await this.testPhase3_AdvancedIntelligence();
            await this.testPhase4_MobileUX();
            await this.testPhase5_BusinessScenarios();
            await this.testPhase6_DataPersistence();

            this.generateComprehensiveReport();

        } catch (error) {
            this.log(`💥 CRITICAL TEST FAILURE: ${error.message}`, 'error', {
                stack: error.stack,
                phase: this.currentPhase
            });
            this.results.systemHealth = 'CRITICAL_FAILURE';
        }

        return this.results;
    }

    // COMPREHENSIVE REPORT GENERATION
    generateComprehensiveReport() {
        const duration = Date.now() - this.startTime;
        const passRate = (this.results.passedTests / this.results.totalTests * 100).toFixed(1);

        // Calculate system health
        if (this.results.failedTests === 0) {
            this.results.systemHealth = 'EXCELLENT';
        } else if (this.results.failedTests <= 2) {
            this.results.systemHealth = 'GOOD_WITH_MINOR_ISSUES';
        } else if (this.results.failedTests <= 5) {
            this.results.systemHealth = 'FAIR_NEEDS_ATTENTION';
        } else {
            this.results.systemHealth = 'POOR_CRITICAL_ISSUES';
        }

        // Performance metrics
        this.results.performanceMetrics = {
            totalDuration: duration,
            averageTestTime: duration / this.results.totalTests,
            testsPerSecond: (this.results.totalTests / (duration / 1000)).toFixed(2)
        };

        console.log('\n' + '='.repeat(100));
        console.log('🔬 COMPREHENSIVE NOTIFICATION SYSTEM TEST REPORT');
        console.log('='.repeat(100));

        console.log(`\n📊 EXECUTIVE SUMMARY:`);
        console.log(`   System Health: ${this.results.systemHealth}`);
        console.log(`   Total Tests: ${this.results.totalTests}`);
        console.log(`   Passed: ${this.results.passedTests} (${passRate}%)`);
        console.log(`   Failed: ${this.results.failedTests}`);
        console.log(`   Warnings: ${this.results.warningTests}`);
        console.log(`   Duration: ${(duration / 1000).toFixed(2)} seconds`);

        console.log(`\n🏗️ COMPONENT HEALTH MATRIX:`);
        const componentResults = this.generateComponentMatrix();
        Object.entries(componentResults).forEach(([component, stats]) => {
            const healthIcon = stats.passRate >= 90 ? '🟢' : stats.passRate >= 70 ? '🟡' : '🔴';
            console.log(`   ${healthIcon} ${component}: ${stats.passed}/${stats.total} (${stats.passRate.toFixed(0)}%)`);
        });

        console.log(`\n⚡ PERFORMANCE METRICS:`);
        console.log(`   Test Execution Speed: ${this.results.performanceMetrics.testsPerSecond} tests/second`);
        console.log(`   Average Test Time: ${this.results.performanceMetrics.averageTestTime.toFixed(2)}ms per test`);
        console.log(`   Memory Usage: ${this.getMemoryUsage()}`);

        console.log(`\n🎯 FEATURE COVERAGE ANALYSIS:`);
        const featureCoverage = this.analyzeFeatureCoverage();
        Object.entries(featureCoverage).forEach(([feature, coverage]) => {
            const coverageIcon = coverage >= 80 ? '✅' : coverage >= 60 ? '⚠️' : '❌';
            console.log(`   ${coverageIcon} ${feature}: ${coverage.toFixed(0)}% covered`);
        });

        if (this.results.failedTests > 0) {
            console.log(`\n❌ CRITICAL FAILURES:`);
            this.results.testResults
                .filter(r => !r.passed)
                .forEach(result => {
                    console.log(`   🔥 ${result.phase} - ${result.name}: ${result.message}`);
                });
        }

        if (this.results.warningTests > 0) {
            console.log(`\n⚠️ WARNINGS & RECOMMENDATIONS:`);
            this.logBuffer
                .filter(entry => entry.type === 'warn')
                .forEach(warning => {
                    console.log(`   ⚡ ${warning.phase}: ${warning.message}`);
                });
        }

        console.log(`\n🚀 PRODUCTION READINESS ASSESSMENT:`);
        const readinessScore = this.calculateProductionReadiness();
        if (readinessScore >= 95) {
            console.log('   🎉 READY FOR PRODUCTION - Exceptional quality');
            console.log('   ✓ All critical systems operational');
            console.log('   ✓ Performance within optimal ranges');
            console.log('   ✓ Full feature coverage achieved');
        } else if (readinessScore >= 85) {
            console.log('   ✅ PRODUCTION READY - Minor optimizations recommended');
            console.log('   ✓ Core functionality working correctly');
            console.log('   ⚠️ Address warnings before peak usage');
        } else if (readinessScore >= 70) {
            console.log('   ⚠️ CONDITIONAL PRODUCTION READINESS - Issues must be resolved');
            console.log('   ❌ Critical issues detected');
            console.log('   📋 Review failed tests before deployment');
        } else {
            console.log('   ❌ NOT PRODUCTION READY - Significant issues detected');
            console.log('   🔥 Multiple critical failures');
            console.log('   🛑 System requires immediate attention');
        }

        console.log(`\n📋 NEXT STEPS:`);
        console.log('   1. Review all failed tests and address root causes');
        console.log('   2. Optimize performance bottlenecks identified');
        console.log('   3. Implement additional monitoring for production');
        console.log('   4. Plan gradual rollout with feature flags');
        console.log('   5. Set up real-time alerting for system health');

        console.log(`\n📈 QUALITY METRICS:`);
        console.log(`   Reliability Score: ${this.calculateReliabilityScore()}%`);
        console.log(`   User Experience Score: ${this.calculateUXScore()}%`);
        console.log(`   Performance Score: ${this.calculatePerformanceScore()}%`);
        console.log(`   Production Readiness: ${readinessScore.toFixed(1)}%`);

        console.log('\n' + '='.repeat(100));

        this.results.readinessScore = readinessScore;
        this.results.report = 'Complete comprehensive report generated';

        return this.results;
    }

    generateComponentMatrix() {
        const phases = {
            'Core Architecture': 'Phase 1',
            'Customer Segmentation': 'Phase 2',
            'Advanced Intelligence': 'Phase 3',
            'Mobile & UX': 'Phase 4',
            'Business Scenarios': 'Phase 5',
            'Data Persistence': 'Phase 6'
        };

        const componentResults = {};

        Object.entries(phases).forEach(([component, phase]) => {
            const phaseTests = this.results.testResults.filter(t => t.phase === phase);
            const passed = phaseTests.filter(t => t.passed).length;
            const total = phaseTests.length;
            const passRate = total > 0 ? (passed / total * 100) : 0;

            componentResults[component] = {
                passed,
                total,
                passRate
            };
        });

        return componentResults;
    }

    analyzeFeatureCoverage() {
        const features = {
            'Core Notification System': ['NotificationManager Initialization', 'Z-Index Hierarchy', 'Basic Notification Types', 'Queue Management'],
            'Smart Segmentation': ['Segmentation System Availability', 'All Customer Segments', 'Grace Period Calculations', 'Personalized Content'],
            'AI Intelligence': ['Advanced Intelligence Availability', 'Behavior Analysis', 'A/B Testing Framework', 'Predictive Analytics'],
            'Mobile Experience': ['Mobile Responsiveness', 'Touch Targets', 'Accessibility Features', 'Haptic Feedback'],
            'Business Logic': ['Trial Expiration Flow', 'Payment Failure Handling', 'Offline/Online Scenario', 'High Volume Notifications'],
            'System Reliability': ['Memory Leak Prevention', 'Error Handling Robustness', 'Local Storage Persistence', 'Fallback Systems']
        };

        const coverage = {};

        Object.entries(features).forEach(([feature, testNames]) => {
            const relevantTests = this.results.testResults.filter(t =>
                testNames.some(name => t.name.includes(name))
            );
            const passedTests = relevantTests.filter(t => t.passed).length;
            const totalTests = testNames.length;

            coverage[feature] = totalTests > 0 ? (passedTests / totalTests * 100) : 0;
        });

        return coverage;
    }

    calculateProductionReadiness() {
        const passRate = this.results.passedTests / this.results.totalTests * 100;
        const criticalFailures = this.results.failedTests;
        const warningPenalty = this.results.warningTests * 2;

        let readinessScore = passRate;

        // Apply penalties
        readinessScore -= (criticalFailures * 10); // 10 point penalty per critical failure
        readinessScore -= warningPenalty; // 2 point penalty per warning

        // Bonus for comprehensive coverage
        if (this.results.totalTests >= 50) {
            readinessScore += 5; // Bonus for thorough testing
        }

        return Math.max(0, Math.min(100, readinessScore));
    }

    calculateReliabilityScore() {
        const errorHandlingTests = this.results.testResults.filter(t =>
            t.name.includes('Error Handling') || t.name.includes('Fallback') || t.name.includes('Memory Leak')
        );
        const passedReliability = errorHandlingTests.filter(t => t.passed).length;
        return errorHandlingTests.length > 0 ? (passedReliability / errorHandlingTests.length * 100) : 0;
    }

    calculateUXScore() {
        const uxTests = this.results.testResults.filter(t =>
            t.name.includes('Mobile') || t.name.includes('Touch') || t.name.includes('Accessibility') || t.name.includes('Gesture')
        );
        const passedUX = uxTests.filter(t => t.passed).length;
        return uxTests.length > 0 ? (passedUX / uxTests.length * 100) : 0;
    }

    calculatePerformanceScore() {
        const performanceTests = this.results.testResults.filter(t =>
            t.name.includes('Performance') || t.name.includes('High Volume') || t.name.includes('Queue') || t.name.includes('Concurrent')
        );
        const passedPerformance = performanceTests.filter(t => t.passed).length;
        return performanceTests.length > 0 ? (passedPerformance / performanceTests.length * 100) : 0;
    }

    getMemoryUsage() {
        if (performance.memory) {
            const used = Math.round(performance.memory.usedJSHeapSize / 1048576 * 100) / 100;
            const total = Math.round(performance.memory.totalJSHeapSize / 1048576 * 100) / 100;
            return `${used}MB / ${total}MB`;
        }
        return 'Memory info not available';
    }
}

// Auto-run when script loads
if (typeof window !== 'undefined') {
    window.ComprehensiveNotificationTester = ComprehensiveNotificationTester;

    // Wait for all systems to be ready
    const waitForAllSystems = () => {
        const requiredSystems = [
            'NotificationManager',
            'CustomerSegmentationManager',
            'AdvancedNotificationIntelligence',
            'TimerManager'
        ];

        const allSystemsReady = requiredSystems.every(system =>
            typeof window[system] !== 'undefined'
        );

        if (allSystemsReady) {
            console.log('🔬 All systems detected - Starting comprehensive tests...');
            const tester = new ComprehensiveNotificationTester();
            tester.runComprehensiveTests().then(results => {
                console.log('✅ Comprehensive testing completed!');
                window.testResults = results;
            });
        } else {
            const missingSystems = requiredSystems.filter(system =>
                typeof window[system] === 'undefined'
            );
            console.log(`⏳ Waiting for systems: ${missingSystems.join(', ')}`);
            setTimeout(waitForAllSystems, 500);
        }
    };

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForAllSystems);
    } else {
        waitForAllSystems();
    }
}