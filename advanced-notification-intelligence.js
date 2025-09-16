// POSPal Advanced Notification Intelligence System
// Provides A/B testing, predictive analytics, and intelligent scheduling

class AdvancedNotificationIntelligence {
    constructor() {
        this.experiments = new Map();
        this.analytics = new Map();
        this.userBehaviorModel = null;
        this.predictionCache = new Map();
        this.initialized = false;

        this.init();
    }

    init() {
        if (this.initialized) return;

        // Load existing experiments and analytics
        this.loadStoredData();

        // Initialize behavioral model
        this.initializeBehaviorModel();

        // Set up periodic analytics processing
        this.setupAnalyticsProcessing();

        this.initialized = true;
    }

    loadStoredData() {
        // Load experiments
        const experimentsData = localStorage.getItem('pospal_notification_experiments');
        if (experimentsData) {
            try {
                const experiments = JSON.parse(experimentsData);
                Object.entries(experiments).forEach(([key, value]) => {
                    this.experiments.set(key, value);
                });
            } catch (error) {
                console.warn('Failed to load notification experiments:', error);
            }
        }

        // Load analytics
        const analyticsData = localStorage.getItem('pospal_notification_analytics');
        if (analyticsData) {
            try {
                const analytics = JSON.parse(analyticsData);
                Object.entries(analytics).forEach(([key, value]) => {
                    this.analytics.set(key, value);
                });
            } catch (error) {
                console.warn('Failed to load notification analytics:', error);
            }
        }
    }

    saveData() {
        // Save experiments
        const experimentsObj = Object.fromEntries(this.experiments);
        localStorage.setItem('pospal_notification_experiments', JSON.stringify(experimentsObj));

        // Save analytics
        const analyticsObj = Object.fromEntries(this.analytics);
        localStorage.setItem('pospal_notification_analytics', JSON.stringify(analyticsObj));
    }

    initializeBehaviorModel() {
        const historicalData = this.getHistoricalInteractionData();
        this.userBehaviorModel = this.buildBehaviorModel(historicalData);
    }

    getHistoricalInteractionData() {
        const interactions = JSON.parse(localStorage.getItem('pospal_segment_analytics') || '[]');
        const sessionData = JSON.parse(localStorage.getItem('pospal_session_data') || '[]');

        return {
            interactions: interactions.slice(-1000), // Last 1000 interactions
            sessions: sessionData.slice(-100), // Last 100 sessions
            preferences: this.extractUserPreferences()
        };
    }

    extractUserPreferences() {
        const dismissalData = localStorage.getItem('pospal_dismissal_patterns');
        const actionData = localStorage.getItem('pospal_action_patterns');
        const timingData = localStorage.getItem('pospal_timing_patterns');

        return {
            dismissalPatterns: dismissalData ? JSON.parse(dismissalData) : {},
            actionPatterns: actionData ? JSON.parse(actionData) : {},
            timingPreferences: timingData ? JSON.parse(timingData) : {}
        };
    }

    buildBehaviorModel(historicalData) {
        const model = {
            engagementScore: this.calculateEngagementScore(historicalData),
            preferredTiming: this.analyzeTimingPreferences(historicalData),
            actionProbabilities: this.calculateActionProbabilities(historicalData),
            dismissalTriggers: this.identifyDismissalTriggers(historicalData),
            responsiveness: this.calculateResponsiveness(historicalData)
        };

        return model;
    }

    calculateEngagementScore(data) {
        const { interactions } = data;
        if (interactions.length === 0) return 0.5; // Default neutral score

        const actionInteractions = interactions.filter(i => i.action !== 'dismiss');
        const totalInteractions = interactions.length;

        const engagementRatio = actionInteractions.length / totalInteractions;
        const recencyWeight = this.calculateRecencyWeight(interactions);

        return Math.min(1.0, engagementRatio * recencyWeight);
    }

    calculateRecencyWeight(interactions) {
        if (interactions.length === 0) return 1.0;

        const now = Date.now();
        const recentInteractions = interactions.filter(i =>
            now - i.timestamp < 7 * 24 * 60 * 60 * 1000 // Last 7 days
        );

        return Math.min(1.0, recentInteractions.length / 10); // Max weight at 10+ recent interactions
    }

    analyzeTimingPreferences(data) {
        const { interactions } = data;
        const hourCounts = new Array(24).fill(0);
        const dayOfWeekCounts = new Array(7).fill(0);

        interactions.forEach(interaction => {
            const date = new Date(interaction.timestamp);
            const hour = date.getHours();
            const dayOfWeek = date.getDay();

            if (interaction.action !== 'dismiss') {
                hourCounts[hour] += 1;
                dayOfWeekCounts[dayOfWeek] += 1;
            }
        });

        return {
            preferredHours: this.findPeakHours(hourCounts),
            preferredDays: this.findPeakDays(dayOfWeekCounts),
            avoidHours: this.findLowHours(hourCounts)
        };
    }

    findPeakHours(hourCounts) {
        const maxCount = Math.max(...hourCounts);
        const threshold = maxCount * 0.8;

        return hourCounts
            .map((count, hour) => ({ hour, count }))
            .filter(item => item.count >= threshold)
            .map(item => item.hour);
    }

    findPeakDays(dayOfWeekCounts) {
        const maxCount = Math.max(...dayOfWeekCounts);
        const threshold = maxCount * 0.8;

        return dayOfWeekCounts
            .map((count, day) => ({ day, count }))
            .filter(item => item.count >= threshold)
            .map(item => item.day);
    }

    findLowHours(hourCounts) {
        const avgCount = hourCounts.reduce((sum, count) => sum + count, 0) / hourCounts.length;
        const threshold = avgCount * 0.3;

        return hourCounts
            .map((count, hour) => ({ hour, count }))
            .filter(item => item.count <= threshold)
            .map(item => item.hour);
    }

    calculateActionProbabilities(data) {
        const { interactions } = data;
        const actionCounts = {};

        interactions.forEach(interaction => {
            const action = interaction.action;
            actionCounts[action] = (actionCounts[action] || 0) + 1;
        });

        const total = interactions.length || 1;
        const probabilities = {};

        Object.keys(actionCounts).forEach(action => {
            probabilities[action] = actionCounts[action] / total;
        });

        return probabilities;
    }

    identifyDismissalTriggers(data) {
        const { interactions } = data;
        const dismissalInteractions = interactions.filter(i => i.action === 'dismiss');

        const triggers = {
            timeOfDay: this.analyzeDismissalByTime(dismissalInteractions),
            messageType: this.analyzeDismissalByType(dismissalInteractions),
            frequency: this.analyzeDismissalByFrequency(dismissalInteractions)
        };

        return triggers;
    }

    analyzeDismissalByTime(dismissalInteractions) {
        const hourCounts = new Array(24).fill(0);
        dismissalInteractions.forEach(interaction => {
            const hour = new Date(interaction.timestamp).getHours();
            hourCounts[hour] += 1;
        });

        const maxCount = Math.max(...hourCounts);
        return hourCounts.map((count, hour) => ({
            hour,
            dismissalRate: maxCount > 0 ? count / maxCount : 0
        }));
    }

    analyzeDismissalByType(dismissalInteractions) {
        const typeCounts = {};
        dismissalInteractions.forEach(interaction => {
            const type = interaction.notificationType || 'unknown';
            typeCounts[type] = (typeCounts[type] || 0) + 1;
        });

        return typeCounts;
    }

    analyzeDismissalByFrequency(dismissalInteractions) {
        // Analyze dismissal patterns based on notification frequency
        const timeWindows = [
            { name: 'immediate', duration: 5 * 60 * 1000 }, // 5 minutes
            { name: 'short', duration: 30 * 60 * 1000 }, // 30 minutes
            { name: 'medium', duration: 2 * 60 * 60 * 1000 }, // 2 hours
            { name: 'long', duration: 24 * 60 * 60 * 1000 } // 24 hours
        ];

        const frequencyPatterns = {};
        timeWindows.forEach(window => {
            frequencyPatterns[window.name] = this.calculateDismissalInWindow(dismissalInteractions, window.duration);
        });

        return frequencyPatterns;
    }

    calculateDismissalInWindow(dismissalInteractions, windowDuration) {
        let count = 0;
        for (let i = 1; i < dismissalInteractions.length; i++) {
            const timeDiff = dismissalInteractions[i].timestamp - dismissalInteractions[i - 1].timestamp;
            if (timeDiff <= windowDuration) {
                count++;
            }
        }
        return count;
    }

    calculateResponsiveness(data) {
        const { interactions } = data;
        const responseTimes = [];

        interactions.forEach(interaction => {
            if (interaction.responseTime) {
                responseTimes.push(interaction.responseTime);
            }
        });

        if (responseTimes.length === 0) return { average: 10000, category: 'normal' };

        const average = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;

        let category = 'normal';
        if (average < 2000) category = 'fast';
        else if (average > 15000) category = 'slow';

        return { average, category };
    }

    setupAnalyticsProcessing() {
        // Process analytics every 5 minutes
        setInterval(() => {
            this.processAnalytics();
            this.updateBehaviorModel();
            this.saveData();
        }, 5 * 60 * 1000);
    }

    processAnalytics() {
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

        const analytics = {
            daily: this.getAnalyticsInRange(oneDayAgo, now),
            weekly: this.getAnalyticsInRange(oneWeekAgo, now),
            trends: this.calculateTrends(),
            predictions: this.generatePredictions()
        };

        this.analytics.set('processed_analytics', analytics);
    }

    getAnalyticsInRange(startTime, endTime) {
        const interactions = JSON.parse(localStorage.getItem('pospal_segment_analytics') || '[]');
        const rangeInteractions = interactions.filter(i =>
            i.timestamp >= startTime && i.timestamp <= endTime
        );

        return {
            totalInteractions: rangeInteractions.length,
            actionTypes: this.groupBy(rangeInteractions, 'action'),
            segments: this.groupBy(rangeInteractions, 'segment'),
            peakHours: this.calculatePeakHours(rangeInteractions),
            conversionRate: this.calculateConversionRate(rangeInteractions)
        };
    }

    groupBy(array, key) {
        return array.reduce((groups, item) => {
            const value = item[key] || 'unknown';
            groups[value] = (groups[value] || 0) + 1;
            return groups;
        }, {});
    }

    calculatePeakHours(interactions) {
        const hourCounts = new Array(24).fill(0);
        interactions.forEach(interaction => {
            const hour = new Date(interaction.timestamp).getHours();
            hourCounts[hour] += 1;
        });

        const maxCount = Math.max(...hourCounts);
        return hourCounts
            .map((count, hour) => ({ hour, count, percentage: maxCount > 0 ? count / maxCount : 0 }))
            .filter(item => item.percentage > 0.7)
            .sort((a, b) => b.count - a.count);
    }

    calculateConversionRate(interactions) {
        const actionInteractions = interactions.filter(i =>
            i.action && !['dismiss', 'view'].includes(i.action)
        );
        const totalInteractions = interactions.length || 1;

        return {
            rate: actionInteractions.length / totalInteractions,
            total: totalInteractions,
            conversions: actionInteractions.length
        };
    }

    calculateTrends() {
        const currentWeek = this.getAnalyticsInRange(
            Date.now() - 7 * 24 * 60 * 60 * 1000,
            Date.now()
        );
        const previousWeek = this.getAnalyticsInRange(
            Date.now() - 14 * 24 * 60 * 60 * 1000,
            Date.now() - 7 * 24 * 60 * 60 * 1000
        );

        return {
            engagementTrend: this.calculateTrend(
                currentWeek.totalInteractions,
                previousWeek.totalInteractions
            ),
            conversionTrend: this.calculateTrend(
                currentWeek.conversionRate.rate,
                previousWeek.conversionRate.rate
            )
        };
    }

    calculateTrend(current, previous) {
        if (previous === 0) return current > 0 ? 'up' : 'stable';

        const change = (current - previous) / previous;
        if (change > 0.05) return 'up';
        if (change < -0.05) return 'down';
        return 'stable';
    }

    generatePredictions() {
        if (!this.userBehaviorModel) return {};

        const model = this.userBehaviorModel;
        const now = Date.now();

        return {
            optimalNextNotificationTime: this.predictOptimalTiming(now),
            expectedEngagement: this.predictEngagement(),
            recommendedStrategy: this.recommendStrategy(),
            riskFactors: this.identifyRiskFactors()
        };
    }

    predictOptimalTiming(baseTime) {
        const model = this.userBehaviorModel;
        const currentHour = new Date(baseTime).getHours();

        // Find next optimal hour based on preferences
        const preferredHours = model.preferredTiming.preferredHours;
        const avoidHours = model.preferredTiming.avoidHours;

        let nextOptimalTime = baseTime;

        // If current hour is not preferred, find next preferred hour
        if (!preferredHours.includes(currentHour) || avoidHours.includes(currentHour)) {
            const nextHour = preferredHours.find(hour => hour > currentHour) || preferredHours[0];
            const targetTime = new Date(baseTime);
            targetTime.setHours(nextHour, 0, 0, 0);

            if (targetTime.getTime() <= baseTime) {
                targetTime.setDate(targetTime.getDate() + 1);
            }

            nextOptimalTime = targetTime.getTime();
        }

        return new Date(nextOptimalTime);
    }

    predictEngagement() {
        const model = this.userBehaviorModel;
        const baseEngagement = model.engagementScore;
        const timingBonus = this.isOptimalTiming() ? 0.1 : 0;
        const frequencyPenalty = this.getFrequencyPenalty();

        return Math.min(1.0, Math.max(0.0, baseEngagement + timingBonus - frequencyPenalty));
    }

    isOptimalTiming() {
        const now = new Date();
        const hour = now.getHours();
        const preferredHours = this.userBehaviorModel?.preferredTiming?.preferredHours || [];
        const avoidHours = this.userBehaviorModel?.preferredTiming?.avoidHours || [];

        return preferredHours.includes(hour) && !avoidHours.includes(hour);
    }

    getFrequencyPenalty() {
        const recentNotifications = this.getRecentNotificationCount();
        if (recentNotifications === 0) return 0;
        if (recentNotifications <= 2) return 0.1;
        if (recentNotifications <= 5) return 0.2;
        return 0.4; // Heavy penalty for too many notifications
    }

    getRecentNotificationCount() {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const interactions = JSON.parse(localStorage.getItem('pospal_segment_analytics') || '[]');
        return interactions.filter(i => i.timestamp > oneHourAgo).length;
    }

    recommendStrategy() {
        const model = this.userBehaviorModel;
        const engagement = model.engagementScore;
        const responsiveness = model.responsiveness.category;

        if (engagement > 0.8) {
            return 'aggressive'; // User is highly engaged
        } else if (engagement > 0.5) {
            return 'moderate'; // User is moderately engaged
        } else if (responsiveness === 'slow') {
            return 'gentle'; // User needs more time
        } else {
            return 'minimal'; // User shows low engagement
        }
    }

    identifyRiskFactors() {
        const model = this.userBehaviorModel;
        const risks = [];

        // High dismissal rate
        const dismissalRate = model.actionProbabilities.dismiss || 0;
        if (dismissalRate > 0.7) {
            risks.push({
                type: 'high_dismissal_rate',
                severity: 'high',
                description: 'User dismisses most notifications'
            });
        }

        // Recent frequency spike
        const recentCount = this.getRecentNotificationCount();
        if (recentCount > 5) {
            risks.push({
                type: 'notification_fatigue',
                severity: 'medium',
                description: 'Too many recent notifications'
            });
        }

        // Low engagement trend
        const trends = this.analytics.get('processed_analytics')?.trends;
        if (trends?.engagementTrend === 'down') {
            risks.push({
                type: 'declining_engagement',
                severity: 'medium',
                description: 'Engagement is trending downward'
            });
        }

        return risks;
    }

    updateBehaviorModel() {
        const historicalData = this.getHistoricalInteractionData();
        this.userBehaviorModel = this.buildBehaviorModel(historicalData);
    }

    // A/B Testing Methods
    createExperiment(name, variants, config = {}) {
        const experiment = {
            name,
            variants,
            active: true,
            startTime: Date.now(),
            endTime: config.endTime || Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days default
            trafficSplit: config.trafficSplit || this.equalSplit(variants.length),
            metrics: {},
            participants: new Set(),
            results: {}
        };

        this.experiments.set(name, experiment);
        this.saveData();
        return experiment;
    }

    equalSplit(variantCount) {
        const splitSize = 1.0 / variantCount;
        return new Array(variantCount).fill(splitSize);
    }

    getExperimentVariant(experimentName, userId = null) {
        const experiment = this.experiments.get(experimentName);
        if (!experiment || !experiment.active) {
            return null;
        }

        // Check if experiment has ended
        if (Date.now() > experiment.endTime) {
            experiment.active = false;
            this.saveData();
            return null;
        }

        // Generate consistent user assignment
        const user = userId || this.getUserId();
        const variantIndex = this.hashUserToVariant(user, experiment.variants.length);

        // Record participation
        experiment.participants.add(user);

        return {
            variant: experiment.variants[variantIndex],
            index: variantIndex
        };
    }

    getUserId() {
        let userId = localStorage.getItem('pospal_user_id');
        if (!userId) {
            userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('pospal_user_id', userId);
        }
        return userId;
    }

    hashUserToVariant(userId, variantCount) {
        // Simple hash function for consistent user assignment
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            const char = userId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash) % variantCount;
    }

    recordExperimentMetric(experimentName, metricName, value, userId = null) {
        const experiment = this.experiments.get(experimentName);
        if (!experiment || !experiment.active) return;

        const user = userId || this.getUserId();
        const variantAssignment = this.getExperimentVariant(experimentName, user);

        if (!variantAssignment) return;

        if (!experiment.metrics[variantAssignment.index]) {
            experiment.metrics[variantAssignment.index] = {};
        }

        if (!experiment.metrics[variantAssignment.index][metricName]) {
            experiment.metrics[variantAssignment.index][metricName] = [];
        }

        experiment.metrics[variantAssignment.index][metricName].push({
            value,
            timestamp: Date.now(),
            userId: user
        });

        this.saveData();
    }

    getExperimentResults(experimentName) {
        const experiment = this.experiments.get(experimentName);
        if (!experiment) return null;

        const results = {};
        experiment.variants.forEach((variant, index) => {
            const metrics = experiment.metrics[index] || {};
            results[variant.name || `variant_${index}`] = {
                participants: Array.from(experiment.participants).filter(userId =>
                    this.hashUserToVariant(userId, experiment.variants.length) === index
                ).length,
                metrics: this.calculateMetricSummaries(metrics)
            };
        });

        experiment.results = results;
        return results;
    }

    calculateMetricSummaries(metrics) {
        const summaries = {};

        Object.keys(metrics).forEach(metricName => {
            const values = metrics[metricName].map(m => m.value);
            summaries[metricName] = {
                count: values.length,
                sum: values.reduce((a, b) => a + b, 0),
                avg: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
                min: values.length > 0 ? Math.min(...values) : 0,
                max: values.length > 0 ? Math.max(...values) : 0
            };
        });

        return summaries;
    }

    // Intelligence API for notification system
    shouldShowNotification(context) {
        const intelligence = this.getNotificationIntelligence(context);
        return intelligence.recommendation === 'show';
    }

    getNotificationIntelligence(context) {
        const predictions = this.generatePredictions();
        const riskFactors = predictions.riskFactors || [];
        const expectedEngagement = predictions.expectedEngagement || 0.5;

        // High-risk situations
        const highRiskFactors = riskFactors.filter(r => r.severity === 'high');
        if (highRiskFactors.length > 0) {
            return {
                recommendation: 'delay',
                reason: 'High risk factors detected',
                suggestedDelay: 2 * 60 * 60 * 1000, // 2 hours
                riskFactors: highRiskFactors
            };
        }

        // Optimal timing
        if (this.isOptimalTiming() && expectedEngagement > 0.6) {
            return {
                recommendation: 'show',
                reason: 'Optimal timing and high expected engagement',
                confidence: expectedEngagement
            };
        }

        // Frequency concerns
        if (this.getFrequencyPenalty() > 0.3) {
            return {
                recommendation: 'delay',
                reason: 'Recent notification frequency too high',
                suggestedDelay: 60 * 60 * 1000 // 1 hour
            };
        }

        // Default recommendation based on engagement
        if (expectedEngagement > 0.4) {
            return {
                recommendation: 'show',
                reason: 'Acceptable expected engagement',
                confidence: expectedEngagement
            };
        } else {
            return {
                recommendation: 'delay',
                reason: 'Low expected engagement',
                suggestedDelay: 30 * 60 * 1000, // 30 minutes
                confidence: expectedEngagement
            };
        }
    }

    getOptimalNotificationConfig(segment, context) {
        const strategy = this.recommendStrategy();
        const intelligence = this.getNotificationIntelligence(context);

        const baseConfig = {
            segment,
            strategy,
            confidence: intelligence.confidence || 0.5
        };

        // Adjust based on strategy
        switch (strategy) {
            case 'aggressive':
                return {
                    ...baseConfig,
                    priority: 'high',
                    persistence: true,
                    followUpDelay: 2 * 60 * 60 * 1000 // 2 hours
                };

            case 'moderate':
                return {
                    ...baseConfig,
                    priority: 'normal',
                    persistence: true,
                    followUpDelay: 4 * 60 * 60 * 1000 // 4 hours
                };

            case 'gentle':
                return {
                    ...baseConfig,
                    priority: 'low',
                    persistence: false,
                    followUpDelay: 24 * 60 * 60 * 1000 // 24 hours
                };

            case 'minimal':
                return {
                    ...baseConfig,
                    priority: 'low',
                    persistence: false,
                    followUpDelay: 48 * 60 * 60 * 1000 // 48 hours
                };

            default:
                return baseConfig;
        }
    }
}

// Create global instance
window.AdvancedNotificationIntelligence = new AdvancedNotificationIntelligence();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdvancedNotificationIntelligence;
}