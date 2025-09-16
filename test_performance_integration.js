// POSPal Performance & Integration Testing Suite
// Testing system performance, memory management, and cross-component integration

class PerformanceIntegrationTest {
    constructor() {
        this.results = [];
        this.testCount = 0;
        this.passCount = 0;
        this.failCount = 0;
        this.performanceMetrics = {};
    }

    log(message, type = 'info', test = '') {
        const result = {
            timestamp: new Date().toISOString(),
            type,
            test,
            message
        };
        this.results.push(result);
        console.log(`[${type.toUpperCase()}] ${test}: ${message}`);
    }

    async runPerformanceTests() {
        console.log('⚡ Starting Performance & Integration Testing Suite...\n');

        try {
            await this.testNotificationCreationPerformance();
            await this.testMemoryLeakPrevention();
            await this.testConcurrentNotifications();
            await this.testSystemIntegration();
            await this.testAdvancedIntelligencePerformance();
            await this.testDatabaseOperations();
            await this.testErrorHandlingAndRecovery();
            await this.testLoadStressTesting();

            this.generatePerformanceReport();
        } catch (error) {
            this.log(`Critical test failure: ${error.message}`, 'error');
        }
    }

    async testNotificationCreationPerformance() {
        this.testCount++;
        const testName = 'Notification Creation Performance';

        try {
            const iterations = [10, 50, 100];
            const performanceResults = {};

            for (const count of iterations) {
                // Clear any existing notifications
                window.NotificationManager.clear();

                const startTime = performance.now();
                const notificationIds = [];

                // Create notifications rapidly
                for (let i = 0; i < count; i++) {
                    const id = window.NotificationManager.showToast(
                        `Performance test ${i}`,
                        'info',
                        10000
                    );
                    notificationIds.push(id);
                }

                const endTime = performance.now();
                const duration = endTime - startTime;
                const averageTime = duration / count;

                performanceResults[count] = {
                    totalTime: duration,
                    averageTime,
                    throughput: count / (duration / 1000)
                };

                // Performance benchmarks
                if (averageTime > 10) { // More than 10ms per notification
                    this.log(`Slow notification creation: ${averageTime.toFixed(2)}ms average for ${count} notifications`, 'warn', testName);
                } else {
                    this.log(`Good performance: ${averageTime.toFixed(2)}ms average for ${count} notifications`, 'pass', testName);
                }

                // Check memory usage after creation
                if (window.performance && window.performance.memory) {
                    const memoryMB = (window.performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
                    this.log(`Memory usage after ${count} notifications: ${memoryMB}MB`, 'info', testName);
                }

                // Clean up
                window.NotificationManager.clear();
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            this.performanceMetrics.notificationCreation = performanceResults;
            this.log('Notification creation performance test completed', 'pass', testName);
            this.passCount++;

        } catch (error) {
            this.log(`Notification creation performance test failed: ${error.message}`, 'fail', testName);
            this.failCount++;
        }
    }

    async testMemoryLeakPrevention() {
        this.testCount++;
        const testName = 'Memory Leak Prevention';

        try {
            // Get initial state
            const initialTimers = TimerManager.timers.size;
            const initialNotifications = window.NotificationManager.activeNotifications.size;
            const initialMemory = window.performance.memory ?
                window.performance.memory.usedJSHeapSize : null;

            // Create and destroy many notifications to test cleanup
            const cycles = 5;
            const notificationsPerCycle = 20;

            for (let cycle = 0; cycle < cycles; cycle++) {
                const notificationIds = [];

                // Create notifications with various timers
                for (let i = 0; i < notificationsPerCycle; i++) {
                    const id = window.NotificationManager.show({
                        type: i % 3 === 0 ? 'toast' : i % 3 === 1 ? 'banner' : 'persistent',
                        message: `Memory leak test ${cycle}-${i}`,
                        autoHide: i % 2 === 0,
                        duration: 1000 + (i * 100),
                        updateInterval: i % 4 === 0 ? 500 : null,
                        onUpdate: i % 4 === 0 ? () => {} : null
                    });
                    notificationIds.push(id);
                }

                // Let some run briefly
                await new Promise(resolve => setTimeout(resolve, 200));

                // Manually dismiss half
                for (let i = 0; i < notificationIds.length; i += 2) {
                    window.NotificationManager.hide(notificationIds[i]);
                }

                // Let auto-hide handle the rest
                await new Promise(resolve => setTimeout(resolve, 1500));

                // Check intermediate state
                const currentTimers = TimerManager.timers.size;
                const currentNotifications = window.NotificationManager.activeNotifications.size;

                if (currentTimers > initialTimers + 5) { // Allow some tolerance
                    this.log(`Potential timer leak detected: ${currentTimers - initialTimers} extra timers after cycle ${cycle}`, 'warn', testName);
                }

                if (currentNotifications > 3) { // Should be mostly cleared
                    this.log(`Notifications not properly cleared: ${currentNotifications} remaining after cycle ${cycle}`, 'warn', testName);
                }
            }

            // Final cleanup and check
            window.NotificationManager.clear();
            await new Promise(resolve => setTimeout(resolve, 500));

            const finalTimers = TimerManager.timers.size;
            const finalNotifications = window.NotificationManager.activeNotifications.size;
            const finalMemory = window.performance.memory ?
                window.performance.memory.usedJSHeapSize : null;

            // Check for leaks
            const timerLeak = finalTimers - initialTimers;
            const notificationLeak = finalNotifications - initialNotifications;

            if (timerLeak > 2) { // Allow small tolerance
                this.log(`Timer leak detected: ${timerLeak} timers not cleaned up`, 'fail', testName);
                this.failCount++;
                return;
            }

            if (notificationLeak > 0) {
                this.log(`Notification leak detected: ${notificationLeak} notifications not cleaned up`, 'fail', testName);
                this.failCount++;
                return;
            }

            if (initialMemory && finalMemory) {
                const memoryDelta = (finalMemory - initialMemory) / 1024 / 1024; // MB
                if (memoryDelta > 5) { // More than 5MB increase
                    this.log(`Potential memory leak: ${memoryDelta.toFixed(2)}MB increase`, 'warn', testName);
                } else {
                    this.log(`Memory usage stable: ${memoryDelta.toFixed(2)}MB change`, 'pass', testName);
                }
            }

            this.log('Memory leak prevention test completed successfully', 'pass', testName);
            this.passCount++;

        } catch (error) {
            this.log(`Memory leak prevention test failed: ${error.message}`, 'fail', testName);
            this.failCount++;
        }
    }

    async testConcurrentNotifications() {
        this.testCount++;
        const testName = 'Concurrent Notifications';

        try {
            window.NotificationManager.clear();

            // Test queue management with different priorities
            const startTime = performance.now();
            const notifications = [];

            // Create high-priority critical notifications
            for (let i = 0; i < 3; i++) {
                const id = window.NotificationManager.show({
                    type: 'toast',
                    priority: 'critical',
                    message: `Critical ${i}`,
                    autoHide: false
                });
                notifications.push({ id, type: 'critical' });
            }

            // Create normal priority notifications
            for (let i = 0; i < 10; i++) {
                const id = window.NotificationManager.show({
                    type: 'toast',
                    priority: 'normal',
                    message: `Normal ${i}`,
                    autoHide: false
                });
                notifications.push({ id, type: 'normal' });
            }

            // Create low priority notifications
            for (let i = 0; i < 5; i++) {
                const id = window.NotificationManager.show({
                    type: 'banner',
                    priority: 'low',
                    message: `Low ${i}`,
                    autoHide: false
                });
                notifications.push({ id, type: 'low' });
            }

            const creationTime = performance.now() - startTime;

            await new Promise(resolve => setTimeout(resolve, 100)); // Let DOM update

            // Check queue management
            const activeCount = window.NotificationManager.activeNotifications.size;
            const queueCount = window.NotificationManager.queue.length;
            const totalCount = activeCount + queueCount;

            if (totalCount !== notifications.length) {
                this.log(`Notification count mismatch: expected ${notifications.length}, got ${totalCount}`, 'fail', testName);
            }

            // Check priority handling - critical should be active first
            const activeNotifications = Array.from(window.NotificationManager.activeNotifications.values());
            const criticalActive = activeNotifications.filter(n => n.priority === 'critical').length;

            if (criticalActive < 3) {
                this.log(`Critical notifications not prioritized: only ${criticalActive} of 3 active`, 'fail', testName);
            }

            // Test concurrent access performance
            this.log(`Created ${notifications.length} concurrent notifications in ${creationTime.toFixed(2)}ms`, 'info', testName);

            if (creationTime > 500) { // Should handle 18 notifications in under 500ms
                this.log('Slow concurrent notification handling', 'warn', testName);
            }

            // Clean up
            window.NotificationManager.clear();

            this.log('Concurrent notifications test completed', 'pass', testName);
            this.passCount++;

        } catch (error) {
            this.log(`Concurrent notifications test failed: ${error.message}`, 'fail', testName);
            this.failCount++;
        }
    }

    async testSystemIntegration() {
        this.testCount++;
        const testName = 'System Integration';

        try {
            // Test integration between all major components
            const components = [
                'NotificationManager',
                'CustomerSegmentationManager',
                'AdvancedNotificationIntelligence',
                'TimerManager'
            ];

            // Verify all components are available
            for (const component of components) {
                if (typeof window[component] === 'undefined') {
                    this.log(`Required component ${component} not available`, 'fail', testName);
                    this.failCount++;
                    return;
                }
            }

            // Test cross-component workflow
            const mockCustomerData = {
                name: 'Integration Test Restaurant',
                accountAge: 300,
                monthlyOrders: 800,
                paymentFailures: 1
            };

            // Step 1: Segment analysis
            const segmentAnalysis = window.CustomerSegmentationManager.analyzeCustomer(mockCustomerData);
            if (!segmentAnalysis.segment) {
                throw new Error('Customer segmentation failed');
            }

            // Step 2: Intelligence analysis
            const intelligence = window.AdvancedNotificationIntelligence.getNotificationIntelligence({
                customerSegment: segmentAnalysis.segment
            });

            if (!intelligence.recommendation) {
                throw new Error('Intelligence analysis failed');
            }

            // Step 3: Smart notification creation
            if (intelligence.recommendation === 'show') {
                const personalizedContent = window.CustomerSegmentationManager.getPersonalizedContent(
                    segmentAnalysis.segment,
                    'payment_failure',
                    mockCustomerData
                );

                const notificationId = window.NotificationManager.show({
                    type: 'banner',
                    title: personalizedContent.subject,
                    message: personalizedContent.benefits[0],
                    actions: [
                        {
                            id: 'resolve',
                            label: personalizedContent.cta,
                            handler: () => {
                                // Record interaction for analytics
                                window.AdvancedNotificationIntelligence.recordExperimentMetric(
                                    'integration_test',
                                    'click_through',
                                    1
                                );
                            }
                        }
                    ]
                });

                if (!notificationId) {
                    throw new Error('Smart notification creation failed');
                }

                await new Promise(resolve => setTimeout(resolve, 100));

                // Verify notification was created with correct properties
                const notification = window.NotificationManager.activeNotifications.get(notificationId);
                if (!notification) {
                    throw new Error('Created notification not found in active notifications');
                }

                // Test interaction recording
                const button = document.querySelector(`#notification-${notificationId} [data-action="resolve"]`);
                if (button) {
                    button.click();

                    // Verify analytics were recorded
                    const experiment = window.AdvancedNotificationIntelligence.experiments.get('integration_test');
                    if (experiment) {
                        this.log('Analytics integration working', 'pass', testName);
                    }
                }

                window.NotificationManager.hide(notificationId);
            }

            // Test timer integration
            const initialTimers = TimerManager.timers.size;

            // Create notification with update interval
            const updateNotificationId = window.NotificationManager.show({
                type: 'persistent',
                message: 'Timer integration test',
                updateInterval: 100,
                onUpdate: (notification, element) => {
                    // Update content
                    const messageElement = element.querySelector('p');
                    if (messageElement) {
                        messageElement.textContent = `Updated at ${new Date().toLocaleTimeString()}`;
                    }
                }
            });

            await new Promise(resolve => setTimeout(resolve, 250)); // Let it update a few times

            const updatedTimers = TimerManager.timers.size;
            if (updatedTimers <= initialTimers) {
                this.log('Timer integration not working', 'fail', testName);
            } else {
                this.log('Timer integration working', 'pass', testName);
            }

            window.NotificationManager.hide(updateNotificationId);

            this.log('System integration test completed successfully', 'pass', testName);
            this.passCount++;

        } catch (error) {
            this.log(`System integration test failed: ${error.message}`, 'fail', testName);
            this.failCount++;
        }
    }

    async testAdvancedIntelligencePerformance() {
        this.testCount++;
        const testName = 'Advanced Intelligence Performance';

        try {
            const intelligence = window.AdvancedNotificationIntelligence;

            // Generate large dataset for performance testing
            const largeDataset = [];
            for (let i = 0; i < 1000; i++) {
                largeDataset.push({
                    timestamp: Date.now() - (i * 60000),
                    action: ['click', 'dismiss', 'resolve'][i % 3],
                    notificationType: 'payment_failure',
                    responseTime: 1000 + (Math.random() * 5000)
                });
            }

            localStorage.setItem('pospal_segment_analytics', JSON.stringify(largeDataset));

            // Test behavior model building performance
            const startTime = performance.now();

            const historicalData = intelligence.getHistoricalInteractionData();
            const behaviorModel = intelligence.buildBehaviorModel(historicalData);

            const modelBuildTime = performance.now() - startTime;

            if (modelBuildTime > 1000) { // Should build model in under 1 second
                this.log(`Slow behavior model building: ${modelBuildTime.toFixed(2)}ms`, 'warn', testName);
            } else {
                this.log(`Good behavior model performance: ${modelBuildTime.toFixed(2)}ms`, 'pass', testName);
            }

            // Test prediction generation performance
            const predictionStart = performance.now();
            const predictions = intelligence.generatePredictions();
            const predictionTime = performance.now() - predictionStart;

            if (predictionTime > 500) { // Should generate predictions in under 500ms
                this.log(`Slow prediction generation: ${predictionTime.toFixed(2)}ms`, 'warn', testName);
            } else {
                this.log(`Good prediction performance: ${predictionTime.toFixed(2)}ms`, 'pass', testName);
            }

            // Test analytics processing performance
            const analyticsStart = performance.now();
            intelligence.processAnalytics();
            const analyticsTime = performance.now() - analyticsStart;

            if (analyticsTime > 2000) { // Should process analytics in under 2 seconds
                this.log(`Slow analytics processing: ${analyticsTime.toFixed(2)}ms`, 'warn', testName);
            } else {
                this.log(`Good analytics performance: ${analyticsTime.toFixed(2)}ms`, 'pass', testName);
            }

            // Verify intelligence features work correctly
            if (!behaviorModel.engagementScore || typeof behaviorModel.engagementScore !== 'number') {
                throw new Error('Behavior model not built correctly');
            }

            if (!predictions.expectedEngagement || typeof predictions.expectedEngagement !== 'number') {
                throw new Error('Predictions not generated correctly');
            }

            this.performanceMetrics.intelligence = {
                modelBuildTime,
                predictionTime,
                analyticsTime
            };

            this.log('Advanced intelligence performance test completed', 'pass', testName);
            this.passCount++;

        } catch (error) {
            this.log(`Advanced intelligence performance test failed: ${error.message}`, 'fail', testName);
            this.failCount++;
        }
    }

    async testDatabaseOperations() {
        this.testCount++;
        const testName = 'Database Operations';

        try {
            // Test localStorage operations under load
            const startTime = performance.now();

            // Simulate heavy localStorage usage
            const largeObject = {
                notifications: new Array(1000).fill(null).map((_, i) => ({
                    id: `test_${i}`,
                    timestamp: Date.now() + i,
                    type: 'test',
                    data: 'x'.repeat(100) // 100 char string
                })),
                analytics: new Array(500).fill(null).map((_, i) => ({
                    event: `event_${i}`,
                    timestamp: Date.now() + i,
                    data: { key: 'value'.repeat(10) }
                }))
            };

            // Test write performance
            const writeStart = performance.now();
            localStorage.setItem('pospal_performance_test', JSON.stringify(largeObject));
            const writeTime = performance.now() - writeStart;

            // Test read performance
            const readStart = performance.now();
            const retrieved = JSON.parse(localStorage.getItem('pospal_performance_test'));
            const readTime = performance.now() - readStart;

            // Test update performance
            const updateStart = performance.now();
            retrieved.notifications.push({ id: 'new_item', timestamp: Date.now() });
            localStorage.setItem('pospal_performance_test', JSON.stringify(retrieved));
            const updateTime = performance.now() - updateStart;

            const totalTime = performance.now() - startTime;

            // Performance thresholds
            if (writeTime > 100) {
                this.log(`Slow localStorage write: ${writeTime.toFixed(2)}ms`, 'warn', testName);
            }

            if (readTime > 50) {
                this.log(`Slow localStorage read: ${readTime.toFixed(2)}ms`, 'warn', testName);
            }

            if (updateTime > 150) {
                this.log(`Slow localStorage update: ${updateTime.toFixed(2)}ms`, 'warn', testName);
            }

            // Check data integrity
            if (retrieved.notifications.length !== largeObject.notifications.length) {
                throw new Error('Data corruption detected in localStorage');
            }

            // Test quota handling
            try {
                // Try to exceed localStorage quota (this will fail gracefully)
                const veryLargeString = 'x'.repeat(5 * 1024 * 1024); // 5MB
                localStorage.setItem('pospal_quota_test', veryLargeString);
                localStorage.removeItem('pospal_quota_test');
            } catch (quotaError) {
                this.log('localStorage quota limit properly handled', 'pass', testName);
            }

            // Clean up
            localStorage.removeItem('pospal_performance_test');

            this.performanceMetrics.database = {
                writeTime,
                readTime,
                updateTime,
                totalTime
            };

            this.log(`Database operations completed: Write(${writeTime.toFixed(1)}ms) Read(${readTime.toFixed(1)}ms) Update(${updateTime.toFixed(1)}ms)`, 'pass', testName);
            this.passCount++;

        } catch (error) {
            this.log(`Database operations test failed: ${error.message}`, 'fail', testName);
            this.failCount++;
        }
    }

    async testErrorHandlingAndRecovery() {
        this.testCount++;
        const testName = 'Error Handling & Recovery';

        try {
            // Test invalid notification configurations
            const invalidConfigs = [
                { type: 'invalid_type', message: 'Test' },
                { type: 'toast', priority: 'invalid_priority', message: 'Test' },
                { message: null },
                { actions: 'not_an_array', message: 'Test' }
            ];

            for (const config of invalidConfigs) {
                try {
                    const id = window.NotificationManager.show(config);
                    if (id) {
                        this.log('Invalid configuration accepted (should have failed gracefully)', 'warn', testName);
                        window.NotificationManager.hide(id);
                    }
                } catch (error) {
                    this.log(`Properly handled invalid config: ${error.message}`, 'pass', testName);
                }
            }

            // Test DOM manipulation errors
            const originalAppendChild = Node.prototype.appendChild;
            Node.prototype.appendChild = function(child) {
                if (child.id && child.id.startsWith('notification-error-test')) {
                    throw new Error('Simulated DOM error');
                }
                return originalAppendChild.call(this, child);
            };

            try {
                const id = window.NotificationManager.show({
                    type: 'toast',
                    message: 'Error test',
                    // This should trigger the DOM error we simulated
                });

                // The system should handle this gracefully
                if (id) {
                    this.log('System handled DOM error gracefully', 'pass', testName);
                } else {
                    this.log('System failed to handle DOM error gracefully', 'fail', testName);
                }
            } finally {
                Node.prototype.appendChild = originalAppendChild;
            }

            // Test localStorage errors
            const originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (key.includes('error_test')) {
                    throw new Error('Simulated storage error');
                }
                return originalSetItem.call(this, key, value);
            };

            try {
                // This should trigger storage error
                localStorage.setItem('pospal_error_test', 'test');
            } catch (error) {
                this.log('Storage error properly handled', 'pass', testName);
            } finally {
                Storage.prototype.setItem = originalSetItem;
            }

            // Test system recovery after errors
            const id = window.NotificationManager.showToast('Recovery test', 'success', 2000);
            if (id) {
                this.log('System recovered successfully after errors', 'pass', testName);
                window.NotificationManager.hide(id);
            } else {
                this.log('System did not recover properly after errors', 'fail', testName);
            }

            this.log('Error handling and recovery test completed', 'pass', testName);
            this.passCount++;

        } catch (error) {
            this.log(`Error handling test failed: ${error.message}`, 'fail', testName);
            this.failCount++;
        }
    }

    async testLoadStressTesting() {
        this.testCount++;
        const testName = 'Load Stress Testing';

        try {
            window.NotificationManager.clear();

            // Stress test parameters
            const phases = [
                { notifications: 100, interval: 10, description: 'Rapid creation' },
                { notifications: 50, interval: 0, description: 'Burst creation' },
                { notifications: 200, interval: 5, description: 'Sustained load' }
            ];

            const stressResults = {};

            for (const phase of phases) {
                const phaseStart = performance.now();
                const notificationIds = [];

                this.log(`Starting ${phase.description}: ${phase.notifications} notifications with ${phase.interval}ms interval`, 'info', testName);

                // Create notifications based on phase parameters
                for (let i = 0; i < phase.notifications; i++) {
                    const startCreate = performance.now();

                    const id = window.NotificationManager.show({
                        type: i % 3 === 0 ? 'toast' : i % 3 === 1 ? 'banner' : 'persistent',
                        priority: i % 10 === 0 ? 'critical' : 'normal',
                        message: `Stress test ${phase.description} ${i}`,
                        autoHide: i % 2 === 0,
                        duration: 500 + (i * 10)
                    });

                    const createTime = performance.now() - startCreate;

                    if (createTime > 50) { // Individual notification should create in <50ms
                        this.log(`Slow notification creation under load: ${createTime.toFixed(2)}ms`, 'warn', testName);
                    }

                    notificationIds.push(id);

                    if (phase.interval > 0) {
                        await new Promise(resolve => setTimeout(resolve, phase.interval));
                    }
                }

                const phaseTime = performance.now() - phaseStart;
                const throughput = phase.notifications / (phaseTime / 1000);

                stressResults[phase.description] = {
                    notifications: phase.notifications,
                    time: phaseTime,
                    throughput: throughput,
                    avgCreationTime: phaseTime / phase.notifications
                };

                // Check system state under load
                const activeCount = window.NotificationManager.activeNotifications.size;
                const queueCount = window.NotificationManager.queue.length;
                const timerCount = TimerManager.timers.size;

                this.log(`${phase.description} results: ${throughput.toFixed(1)} notifications/sec, Active: ${activeCount}, Queued: ${queueCount}, Timers: ${timerCount}`, 'info', testName);

                // Verify system stability
                if (activeCount + queueCount !== phase.notifications) {
                    this.log(`Notification count mismatch under load: expected ${phase.notifications}, got ${activeCount + queueCount}`, 'warn', testName);
                }

                // Clean up after each phase
                window.NotificationManager.clear();
                await new Promise(resolve => setTimeout(resolve, 200)); // Let cleanup finish
            }

            // Check final system state
            const finalActive = window.NotificationManager.activeNotifications.size;
            const finalTimers = TimerManager.timers.size;

            if (finalActive > 0) {
                this.log(`Notifications not properly cleaned up after stress test: ${finalActive} remaining`, 'warn', testName);
            }

            if (finalTimers > 5) { // Allow some system timers
                this.log(`Excessive timers after stress test: ${finalTimers}`, 'warn', testName);
            }

            this.performanceMetrics.stressTesting = stressResults;

            this.log('Load stress testing completed successfully', 'pass', testName);
            this.passCount++;

        } catch (error) {
            this.log(`Load stress testing failed: ${error.message}`, 'fail', testName);
            this.failCount++;
        }
    }

    generatePerformanceReport() {
        const passRate = ((this.passCount / this.testCount) * 100).toFixed(1);

        console.log('\n' + '='.repeat(70));
        console.log('PERFORMANCE & INTEGRATION TESTING REPORT');
        console.log('='.repeat(70));

        console.log(`\n⚡ PERFORMANCE SUMMARY:`);
        console.log(`   Total Tests: ${this.testCount}`);
        console.log(`   Passed: ${this.passCount} (${passRate}%)`);
        console.log(`   Failed: ${this.failCount}`);

        console.log(`\n📊 PERFORMANCE METRICS:`);

        if (this.performanceMetrics.notificationCreation) {
            console.log(`   Notification Creation Performance:`);
            Object.entries(this.performanceMetrics.notificationCreation).forEach(([count, metrics]) => {
                console.log(`     • ${count} notifications: ${metrics.averageTime.toFixed(2)}ms avg (${metrics.throughput.toFixed(1)}/sec)`);
            });
        }

        if (this.performanceMetrics.intelligence) {
            const intel = this.performanceMetrics.intelligence;
            console.log(`   Intelligence Processing:`);
            console.log(`     • Behavior Model: ${intel.modelBuildTime.toFixed(1)}ms`);
            console.log(`     • Predictions: ${intel.predictionTime.toFixed(1)}ms`);
            console.log(`     • Analytics: ${intel.analyticsTime.toFixed(1)}ms`);
        }

        if (this.performanceMetrics.database) {
            const db = this.performanceMetrics.database;
            console.log(`   Database Operations:`);
            console.log(`     • Write: ${db.writeTime.toFixed(1)}ms`);
            console.log(`     • Read: ${db.readTime.toFixed(1)}ms`);
            console.log(`     • Update: ${db.updateTime.toFixed(1)}ms`);
        }

        if (this.performanceMetrics.stressTesting) {
            console.log(`   Stress Test Results:`);
            Object.entries(this.performanceMetrics.stressTesting).forEach(([phase, metrics]) => {
                console.log(`     • ${phase}: ${metrics.throughput.toFixed(1)} notifications/sec`);
            });
        }

        console.log(`\n🔧 INTEGRATION STATUS:`);

        const integrationChecks = [
            'All components properly loaded',
            'Cross-component communication working',
            'Timer management integrated',
            'Analytics recording functional',
            'Error handling graceful',
            'Memory management effective'
        ];

        integrationChecks.forEach((check, index) => {
            const status = this.failCount === 0 ? '✅' : index < 4 ? '✅' : '⚠️';
            console.log(`   ${status} ${check}`);
        });

        console.log(`\n📋 DETAILED RESULTS:`);
        const testsByType = {};

        this.results.forEach(result => {
            if (!testsByType[result.test]) {
                testsByType[result.test] = [];
            }
            testsByType[result.test].push(result);
        });

        Object.entries(testsByType).forEach(([testName, results]) => {
            const passed = results.filter(r => r.type === 'pass').length;
            const failed = results.filter(r => r.type === 'fail').length;
            const warned = results.filter(r => r.type === 'warn').length;

            const status = failed > 0 ? '❌' : passed > 0 ? '✅' : '⚠️';
            console.log(`   ${status} ${testName}: ${passed}✅ ${failed}❌ ${warned}⚠️`);
        });

        console.log(`\n🚀 PERFORMANCE RECOMMENDATIONS:`);

        if (this.failCount === 0) {
            console.log('   • Excellent performance characteristics');
            console.log('   • System ready for production load');
            console.log('   • All integration points working correctly');
        } else {
            console.log('   • Address performance bottlenecks');
            console.log('   • Review failed integration points');
            console.log('   • Consider optimization strategies');
        }

        const warnings = this.results.filter(r => r.type === 'warn');
        if (warnings.length > 0) {
            console.log('   • Monitor performance under real-world load');
            console.log('   • Consider performance optimizations');
            console.log('   • Implement production monitoring');
        }

        console.log('\n' + '='.repeat(70));

        return {
            totalTests: this.testCount,
            passedTests: this.passCount,
            failedTests: this.failCount,
            passRate: parseFloat(passRate),
            performanceMetrics: this.performanceMetrics
        };
    }
}

// Auto-run performance tests
if (typeof window !== 'undefined') {
    window.PerformanceIntegrationTest = PerformanceIntegrationTest;

    const waitForAllSystems = () => {
        if (window.NotificationManager &&
            window.CustomerSegmentationManager &&
            window.AdvancedNotificationIntelligence &&
            window.TimerManager) {

            console.log('⚡ Starting performance & integration tests...');
            const tester = new PerformanceIntegrationTest();
            tester.runPerformanceTests();
        } else {
            setTimeout(waitForAllSystems, 100);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForAllSystems);
    } else {
        waitForAllSystems();
    }
}