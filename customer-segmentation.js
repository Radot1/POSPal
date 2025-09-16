// POSPal Customer Segmentation & Smart Conversion System
// Optimizes notification timing and messaging for different customer types

class CustomerSegmentationManager {
    constructor() {
        this.segments = {
            power_users: {
                criteria: {
                    dailyUsage: 6,     // >6 hours daily
                    featuresUsed: 5,   // >5 features
                    accountAge: 180,   // >180 days
                    orderVolume: 500   // >500 orders/month
                },
                gracePeriod: 7,
                retentionPriority: 'high',
                supportEscalation: 'immediate',
                notificationTiming: 'off_peak_priority',
                conversionStrategy: 'partnership_focused'
            },

            loyal_customers: {
                criteria: {
                    accountAge: 180,   // >6 months
                    paymentHistory: 'consistent',
                    downtime: 30       // <30 days downtime
                },
                gracePeriod: 5,
                retentionPriority: 'high',
                supportEscalation: 'priority',
                notificationTiming: 'morning_preferred',
                conversionStrategy: 'relationship_focused'
            },

            new_adopters: {
                criteria: {
                    accountAge: 90,    // <90 days
                    failureCount: 1,   // First payment failure
                    trialsUsed: 1      // Recent trial conversion
                },
                gracePeriod: 5,
                retentionPriority: 'medium',
                supportEscalation: 'onboarding_call',
                notificationTiming: 'supportive_guidance',
                conversionStrategy: 'education_focused'
            },

            seasonal_restaurants: {
                criteria: {
                    usagePattern: 'seasonal',
                    avgDowntime: 30,   // >30 days avg downtime
                    peakSeasons: true
                },
                gracePeriod: 14,
                retentionPriority: 'medium',
                supportEscalation: 'pause_offer',
                notificationTiming: 'season_aware',
                conversionStrategy: 'flexibility_focused'
            },

            price_sensitive: {
                criteria: {
                    downgradeCarts: 2, // >2 downgrade attempts
                    supportTickets: 'pricing',
                    paymentDeclines: 3 // >3 declines
                },
                gracePeriod: 3,
                retentionPriority: 'low',
                supportEscalation: 'discount_offer',
                notificationTiming: 'value_focused',
                conversionStrategy: 'cost_benefit_focused'
            },

            high_risk: {
                criteria: {
                    failureCount: 3,   // >3 payment failures
                    supportTickets: 'many',
                    usageDecline: true
                },
                gracePeriod: 1,
                retentionPriority: 'low',
                supportEscalation: 'immediate',
                notificationTiming: 'urgent_only',
                conversionStrategy: 'last_chance_focused'
            },

            default: {
                criteria: {},
                gracePeriod: 3,
                retentionPriority: 'medium',
                supportEscalation: 'standard',
                notificationTiming: 'standard',
                conversionStrategy: 'generic'
            }
        };

        this.restaurantPeakHours = {
            lunch: { start: 11, end: 14 },
            dinner: { start: 18, end: 21 },
            weekend: {
                friday: { start: 17, end: 23 },
                saturday: { start: 12, end: 23 },
                sunday: { start: 12, end: 22 }
            }
        };
    }

    // Determine customer segment based on usage data
    analyzeCustomer(customerData) {
        const segments = Object.keys(this.segments).filter(key => key !== 'default');

        for (const segmentName of segments) {
            if (this.matchesSegmentCriteria(customerData, this.segments[segmentName].criteria)) {
                return {
                    segment: segmentName,
                    config: this.segments[segmentName],
                    confidence: this.calculateConfidence(customerData, this.segments[segmentName].criteria)
                };
            }
        }

        return {
            segment: 'default',
            config: this.segments.default,
            confidence: 1.0
        };
    }

    matchesSegmentCriteria(customerData, criteria) {
        if (criteria.dailyUsage && customerData.avgDailyUsage < criteria.dailyUsage) return false;
        if (criteria.featuresUsed && customerData.featuresUsed < criteria.featuresUsed) return false;
        if (criteria.accountAge && customerData.accountAge < criteria.accountAge) return false;
        if (criteria.orderVolume && customerData.monthlyOrders < criteria.orderVolume) return false;
        if (criteria.failureCount && customerData.paymentFailures < criteria.failureCount) return false;
        if (criteria.downgradeCarts && customerData.downgradeCarts < criteria.downgradeCarts) return false;

        return true;
    }

    calculateConfidence(customerData, criteria) {
        let matchedCriteria = 0;
        let totalCriteria = Object.keys(criteria).length;

        if (totalCriteria === 0) return 1.0;

        Object.keys(criteria).forEach(key => {
            if (customerData[key] !== undefined) {
                matchedCriteria++;
            }
        });

        return matchedCriteria / totalCriteria;
    }

    // Get optimal notification timing for segment
    getOptimalNotificationTime(segment, notificationType) {
        const config = this.segments[segment] || this.segments.default;
        const now = new Date();

        switch (config.notificationTiming) {
            case 'off_peak_priority':
                return this.getOffPeakTime(now, true); // Priority scheduling

            case 'morning_preferred':
                return this.getMorningTime(now);

            case 'supportive_guidance':
                return this.getSupportiveTime(now);

            case 'season_aware':
                return this.getSeasonAwareTime(now);

            case 'value_focused':
                return this.getValueFocusedTime(now);

            case 'urgent_only':
                return notificationType === 'critical' ? now : null;

            default:
                return this.getStandardTime(now);
        }
    }

    getOffPeakTime(now, priority = false) {
        const hour = now.getHours();
        const isCurrentlyPeak = this.isRestaurantPeakHours();

        if (!isCurrentlyPeak) {
            return now; // Show immediately if not peak hours
        }

        // Schedule for next off-peak window
        if (hour < 11) {
            return now; // Morning is usually OK
        } else if (hour >= 14 && hour < 18) {
            return now; // Afternoon break
        } else {
            // Schedule for tomorrow morning
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            return tomorrow;
        }
    }

    getMorningTime(now) {
        const hour = now.getHours();

        if (hour >= 8 && hour <= 10) {
            return now; // Ideal morning window
        }

        // Schedule for next morning
        const nextMorning = new Date(now);
        if (hour > 10) {
            nextMorning.setDate(nextMorning.getDate() + 1);
        }
        nextMorning.setHours(9, 0, 0, 0);
        return nextMorning;
    }

    getSupportiveTime(now) {
        const hour = now.getHours();

        // New customers get gentle timing
        if (hour >= 10 && hour <= 16) {
            return now;
        }

        // Schedule for next business hours
        const nextBusiness = new Date(now);
        if (hour > 16) {
            nextBusiness.setDate(nextBusiness.getDate() + 1);
        }
        nextBusiness.setHours(10, 0, 0, 0);
        return nextBusiness;
    }

    getSeasonAwareTime(now) {
        const month = now.getMonth();
        const isWinterSeason = month >= 11 || month <= 2; // Dec, Jan, Feb

        if (isWinterSeason) {
            // More lenient timing during slow season
            return this.getOffPeakTime(now);
        } else {
            // Standard timing during busy season
            return this.getStandardTime(now);
        }
    }

    getValueFocusedTime(now) {
        const hour = now.getHours();
        const day = now.getDay();

        // Avoid expensive hours for price-sensitive customers
        if (day >= 1 && day <= 4 && hour >= 9 && hour <= 11) { // Tue-Fri morning
            return now;
        }

        // Schedule for next low-cost window
        const nextSlot = new Date(now);
        nextSlot.setDate(nextSlot.getDate() + 1);
        nextSlot.setHours(9, 0, 0, 0);
        return nextSlot;
    }

    getStandardTime(now) {
        if (!this.isRestaurantPeakHours()) {
            return now;
        }

        // Schedule for next available non-peak slot
        return this.getOffPeakTime(now);
    }

    isRestaurantPeakHours() {
        const now = new Date();
        const hour = now.getHours();
        const day = now.getDay();

        // Standard restaurant peak hours
        const lunchRush = hour >= this.restaurantPeakHours.lunch.start &&
                          hour <= this.restaurantPeakHours.lunch.end;
        const dinnerRush = hour >= this.restaurantPeakHours.dinner.start &&
                           hour <= this.restaurantPeakHours.dinner.end;

        // Weekend variations
        const isWeekend = day === 0 || day === 6;
        const weekendExtended = isWeekend && hour >= 12 && hour <= 23;

        return lunchRush || dinnerRush || weekendExtended;
    }

    // Generate personalized notification content
    getPersonalizedContent(segment, notificationType, customerData) {
        const templates = {
            power_users: {
                payment_failure: {
                    subject: `${customerData.name || 'Valued Partner'}, let's keep your POSPal running smoothly`,
                    tone: 'partner_focused',
                    urgency: 'medium',
                    benefits: ['No service disruption for high-volume operations', 'Priority support included'],
                    cta: 'Update Payment Method'
                },
                grace_warning: {
                    subject: `${customerData.name || 'Partner'}, brief payment update needed`,
                    tone: 'professional_partnership',
                    urgency: 'low',
                    benefits: ['Continue uninterrupted service', 'Maintain priority support'],
                    cta: 'Resolve Payment'
                }
            },

            new_adopters: {
                payment_failure: {
                    subject: `${customerData.name || 'Welcome'}, we're here to help with your POSPal payment`,
                    tone: 'supportive_guidance',
                    urgency: 'low',
                    benefits: ['Setup support available', 'We want your success', 'Free onboarding assistance'],
                    cta: 'Get Help with Payment'
                },
                grace_warning: {
                    subject: `${customerData.name || 'Friend'}, let's get your POSPal back on track`,
                    tone: 'encouraging_support',
                    urgency: 'low',
                    benefits: ['Personal setup assistance', 'Success guarantee'],
                    cta: 'Contact Support'
                }
            },

            price_sensitive: {
                payment_failure: {
                    subject: `${customerData.name || 'Valued Customer'}, special payment assistance available`,
                    tone: 'value_focused',
                    urgency: 'medium',
                    benefits: ['Payment plan options', 'Discount opportunities', 'No service interruption'],
                    cta: 'Explore Payment Options'
                },
                grace_warning: {
                    subject: `${customerData.name || 'Customer'}, flexible payment solutions available`,
                    tone: 'understanding_helpful',
                    urgency: 'low',
                    benefits: ['Flexible payment terms', 'Loyalty discount available'],
                    cta: 'View Payment Options'
                }
            },

            default: {
                payment_failure: {
                    subject: `${customerData.name || 'Customer'}, payment update needed for POSPal`,
                    tone: 'professional_direct',
                    urgency: 'medium',
                    benefits: ['Continue seamless operations', 'Maintain service access'],
                    cta: 'Update Payment'
                },
                grace_warning: {
                    subject: `${customerData.name || 'Customer'}, payment attention required`,
                    tone: 'professional_reminder',
                    urgency: 'medium',
                    benefits: ['Avoid service interruption'],
                    cta: 'Resolve Payment'
                }
            }
        };

        const segmentTemplates = templates[segment] || templates.default;
        return segmentTemplates[notificationType] || segmentTemplates.payment_failure;
    }

    // Smart grace period calculation
    calculateSmartGracePeriod(segment, customerData) {
        const baseGracePeriod = this.segments[segment]?.gracePeriod || this.segments.default.gracePeriod;

        // Adjust based on customer history and value
        let adjustedGracePeriod = baseGracePeriod;

        // Loyalty bonus
        if (customerData.accountAge > 365) {
            adjustedGracePeriod += 2; // Extra 2 days for year+ customers
        }

        // Volume bonus
        if (customerData.monthlyOrders > 1000) {
            adjustedGracePeriod += 1; // Extra day for high-volume
        }

        // Payment history penalty
        if (customerData.paymentFailures > 2) {
            adjustedGracePeriod = Math.max(1, adjustedGracePeriod - 1); // Reduce but minimum 1 day
        }

        return Math.min(adjustedGracePeriod, 14); // Maximum 14 days
    }

    // Generate customer insights for notifications
    generateCustomerInsights(customerData) {
        const segment = this.analyzeCustomer(customerData);

        return {
            segment: segment.segment,
            confidence: segment.confidence,
            gracePeriod: this.calculateSmartGracePeriod(segment.segment, customerData),
            retentionPriority: segment.config.retentionPriority,
            supportEscalation: segment.config.supportEscalation,
            conversionStrategy: segment.config.conversionStrategy,
            optimalTiming: this.getOptimalNotificationTime(segment.segment, 'payment_failure'),
            personalizedContent: this.getPersonalizedContent(segment.segment, 'payment_failure', customerData),
            isPeakHours: this.isRestaurantPeakHours(),
            recommendations: this.getRetentionRecommendations(segment.segment, customerData)
        };
    }

    getRetentionRecommendations(segment, customerData) {
        const recommendations = {
            power_users: [
                'Offer dedicated account manager',
                'Priority technical support',
                'Feature preview access',
                'Volume discount review'
            ],

            loyal_customers: [
                'Loyalty reward program',
                'Referral bonus opportunity',
                'Service anniversary recognition',
                'Exclusive feature access'
            ],

            new_adopters: [
                'Personal onboarding call',
                'Tutorial video series',
                'Setup assistance offer',
                'Success milestone tracking'
            ],

            seasonal_restaurants: [
                'Seasonal pause option',
                'Flexible billing cycles',
                'Off-season discount',
                'Pre-season setup assistance'
            ],

            price_sensitive: [
                'Payment plan options',
                'Loyalty discount program',
                'Cost-benefit analysis',
                'Feature optimization guidance'
            ],

            default: [
                'Standard retention offer',
                'Feature utilization review',
                'Customer success check-in',
                'Service value demonstration'
            ]
        };

        return recommendations[segment] || recommendations.default;
    }
}

// Create global instance
window.CustomerSegmentationManager = new CustomerSegmentationManager();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CustomerSegmentationManager;
}