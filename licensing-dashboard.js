// =============================================================================
// COMPREHENSIVE LICENSING DASHBOARD SYSTEM
// Consolidates all licensing intelligence into a management interface
// =============================================================================

// Dashboard state management
const LicensingDashboard = {
    data: {
        licenseStatus: 'loading',
        customerSegment: null,
        gracePeriodActive: false,
        daysRemaining: null,
        lastValidation: null,
        connectionStatus: 'offline',
        customerInfo: {},
        usageAnalytics: {},
        recentActivity: []
    },

    isLoaded: false,
    refreshInterval: null
};

// Main dashboard loading function
async function loadLicensingDashboard() {
    console.log('Loading comprehensive licensing dashboard...');

    try {
        // Show loading states
        updateDashboardLoadingState(true);

        // Load all dashboard data in parallel
        const [licenseData, customerData, analyticsData, activityData] = await Promise.all([
            loadLicenseStatusData(),
            loadCustomerIntelligenceData(),
            loadUsageAnalyticsData(),
            loadRecentActivityData()
        ]);

        // Update dashboard state
        LicensingDashboard.data = {
            ...LicensingDashboard.data,
            ...licenseData,
            customerSegment: customerData.segment,
            usageAnalytics: analyticsData,
            recentActivity: activityData
        };

        // Render all dashboard components
        renderDashboardOverview();
        renderLicenseDetails();
        renderCustomerIntelligence(customerData);
        renderUsageAnalytics(analyticsData);
        renderActionCenter();
        renderSupportSection(customerData);
        renderRecentActivity(activityData);

        // CRITICAL: Load real billing data from API
        await refreshLicenseStatus();

        // Setup auto-refresh
        if (LicensingDashboard.refreshInterval) {
            clearInterval(LicensingDashboard.refreshInterval);
        }
        LicensingDashboard.refreshInterval = setInterval(refreshLicensingDashboard, 5 * 60 * 1000); // 5 minutes

        updateDashboardLoadingState(false);
        LicensingDashboard.isLoaded = true;

        console.log('Licensing dashboard loaded successfully with billing data');

    } catch (error) {
        console.error('Failed to load licensing dashboard:', error);
        updateDashboardLoadingState(false);
        showDashboardError(error.message);
    }
}

// License status data loading
async function loadLicenseStatusData() {
    const licenseStatus = localStorage.getItem('pospal_license_status') || 'trial';
    const lastValidated = localStorage.getItem('pospal_last_validated');
    const cachedStatus = localStorage.getItem('pospal_cached_status');
    const customerEmail = localStorage.getItem('pospal_customer_email');
    const customerName = localStorage.getItem('pospal_customer_name');

    // Calculate days remaining based on trial or grace period
    let daysRemaining = 0;
    let gracePeriodActive = false;

    const trialStart = localStorage.getItem('pospal_trial_start');
    if (trialStart) {
        const startTime = parseInt(trialStart);
        const now = Date.now();
        const daysPassed = (now - startTime) / (24 * 60 * 60 * 1000);
        daysRemaining = Math.max(0, 30 - daysPassed); // 30-day trial
    }

    // Check for grace period
    const graceEnd = localStorage.getItem('pospal_grace_period_end');
    if (graceEnd) {
        const endTime = parseInt(graceEnd);
        const now = Date.now();
        if (now < endTime) {
            gracePeriodActive = true;
            daysRemaining = Math.max(0, (endTime - now) / (24 * 60 * 60 * 1000));
        }
    }

    return {
        licenseStatus,
        daysRemaining,
        gracePeriodActive,
        lastValidation: lastValidated ? new Date(parseInt(lastValidated)) : null,
        connectionStatus: cachedStatus === 'active' ? 'online' : 'offline',
        customerInfo: {
            email: customerEmail,
            name: customerName
        }
    };
}

// Customer intelligence data loading
async function loadCustomerIntelligenceData() {
    if (!window.CustomerSegmentationManager) {
        return { segment: 'default', confidence: 1.0, insights: {} };
    }

    // Gather customer data for segmentation
    const customerData = {
        accountAge: getAccountAge(),
        avgDailyUsage: getAverageDailyUsage(),
        featuresUsed: getFeaturesUsed(),
        monthlyOrders: getMonthlyOrders(),
        paymentFailures: getPaymentFailures(),
        paymentHistory: getPaymentHistory(),
        downtime: getDowntimeDays()
    };

    const segmentation = window.CustomerSegmentationManager.analyzeCustomer(customerData);
    const personalizedContent = window.CustomerSegmentationManager.getPersonalizedContent(
        segmentation.segment,
        'dashboard_view',
        customerData
    );

    return {
        segment: segmentation.segment,
        confidence: segmentation.confidence,
        config: segmentation.config,
        insights: personalizedContent,
        customerData
    };
}

// Usage analytics data loading
async function loadUsageAnalyticsData() {
    return {
        dailyUsage: getAverageDailyUsage(),
        featuresUsed: getFeaturesUsed(),
        monthlyOrders: getMonthlyOrders(),
        accountAge: getAccountAge()
    };
}

// Recent activity data loading
async function loadRecentActivityData() {
    const activities = [];

    // License validation history
    const lastValidation = localStorage.getItem('pospal_last_validated');
    if (lastValidation) {
        activities.push({
            type: 'validation',
            timestamp: new Date(parseInt(lastValidation)),
            description: 'License validation',
            status: 'success'
        });
    }

    // Payment activities
    const paymentSuccess = localStorage.getItem('pospal_payment_success');
    const paymentTimestamp = localStorage.getItem('pospal_payment_timestamp');
    if (paymentSuccess === 'true' && paymentTimestamp) {
        activities.push({
            type: 'payment',
            timestamp: new Date(parseInt(paymentTimestamp)),
            description: 'Payment processed',
            status: 'success'
        });
    }

    // Trial start
    const trialStart = localStorage.getItem('pospal_trial_start');
    if (trialStart) {
        activities.push({
            type: 'trial',
            timestamp: new Date(parseInt(trialStart)),
            description: 'Trial started',
            status: 'info'
        });
    }

    return activities.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
}

// Dashboard rendering functions
function renderDashboardOverview() {
    const data = LicensingDashboard.data;

    // Update connection indicator
    const connectionIndicator = document.getElementById('license-connection-indicator');
    if (connectionIndicator) {
        const isOnline = data.connectionStatus === 'online';
        connectionIndicator.className = `flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            isOnline ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
        }`;
        connectionIndicator.innerHTML = `
            <div class="w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-orange-500'}"></div>
            <span>${isOnline ? 'Connected' : 'Offline Mode'}</span>
        `;
    }

    // Update status card
    const statusElement = document.getElementById('dashboard-license-status');
    if (statusElement) {
        const statusConfig = getStatusDisplayConfig(data.licenseStatus);
        statusElement.innerHTML = `
            <span class="text-xl font-bold">${statusConfig.text}</span>
            <div class="w-3 h-3 rounded-full ${statusConfig.color}"></div>
        `;
    }

    // Update days remaining
    const daysElement = document.getElementById('dashboard-days-remaining');
    const graceElement = document.getElementById('dashboard-grace-period');
    const progressElement = document.getElementById('dashboard-days-progress');

    if (daysElement && data.daysRemaining !== null) {
        daysElement.textContent = `${Math.ceil(data.daysRemaining)} days`;

        if (graceElement) {
            if (data.gracePeriodActive) {
                graceElement.classList.remove('hidden');
                graceElement.textContent = 'Grace period active';
            } else {
                graceElement.classList.add('hidden');
            }
        }

        if (progressElement) {
            const maxDays = data.gracePeriodActive ? 14 : 30; // Adjust based on context
            const percentage = Math.max(0, Math.min(100, (data.daysRemaining / maxDays) * 100));
            progressElement.style.width = `${percentage}%`;

            // Update color based on urgency
            progressElement.className = `h-2 rounded-full transition-all duration-300 ${
                percentage > 50 ? 'bg-green-600' :
                percentage > 20 ? 'bg-yellow-600' : 'bg-red-600'
            }`;
        }
    }

    // Update customer segment
    const segmentElement = document.getElementById('dashboard-customer-segment');
    const confidenceElement = document.getElementById('dashboard-segment-confidence');

    if (segmentElement && data.customerSegment) {
        segmentElement.textContent = formatSegmentName(data.customerSegment);

        if (confidenceElement) {
            const confidence = Math.round((data.customerSegment.confidence || 1.0) * 100);
            confidenceElement.textContent = `Confidence: ${confidence}%`;
        }
    }

    // Update billing information
    const billingElement = document.getElementById('dashboard-next-billing');
    const billingMethodElement = document.getElementById('dashboard-billing-method');

    if (billingElement) {
        if (data.licenseStatus === 'trial') {
            billingElement.textContent = 'Trial period';
            if (billingMethodElement) {
                billingMethodElement.textContent = 'No payment required';
            }
        } else {
            // This would be populated from actual billing data
            billingElement.textContent = 'Not available';
            if (billingMethodElement) {
                billingMethodElement.textContent = 'Set up billing';
            }
        }
    }
}

function renderLicenseDetails() {
    const data = LicensingDashboard.data;

    // Update customer info
    const emailElement = document.getElementById('dashboard-customer-email');
    const nameElement = document.getElementById('dashboard-customer-name');
    const validationElement = document.getElementById('dashboard-last-validation');
    const connectionElement = document.getElementById('dashboard-connection-status');
    const hardwareIdElement = document.getElementById('dashboard-hardware-id');

    if (emailElement) {
        emailElement.textContent = data.customerInfo.email || 'Not registered';
    }

    if (nameElement) {
        nameElement.textContent = data.customerInfo.name || 'Not provided';
    }

    if (validationElement) {
        if (data.lastValidation) {
            validationElement.textContent = formatRelativeTime(data.lastValidation);
        } else {
            validationElement.textContent = 'Never validated';
        }
    }

    if (connectionElement) {
        connectionElement.textContent = data.connectionStatus === 'online' ? 'Connected' : 'Offline';
    }

    if (hardwareIdElement) {
        // Get hardware ID (this should come from the existing system)
        const hardwareId = document.getElementById('hardware-id-display')?.textContent || 'HW-ID-LOADING';
        hardwareIdElement.textContent = hardwareId;
    }
}

function renderCustomerIntelligence(customerData) {
    if (!customerData.segment) return;

    const analysisElement = document.getElementById('segment-analysis');
    const strategyElement = document.getElementById('retention-strategy');
    const insightsElement = document.getElementById('personalized-insights');

    if (analysisElement) {
        const segmentConfig = customerData.config || {};
        analysisElement.innerHTML = `
            <div class="text-sm font-medium text-blue-800 mb-1">${formatSegmentName(customerData.segment)}</div>
            <div class="text-xs text-blue-600">Priority: ${segmentConfig.retentionPriority || 'Standard'}</div>
            <div class="text-xs text-blue-600">Grace Period: ${segmentConfig.gracePeriod || 3} days</div>
        `;
    }

    if (strategyElement) {
        const strategy = customerData.config?.conversionStrategy || 'generic';
        strategyElement.innerHTML = `
            <div class="text-sm font-medium text-green-800 mb-1">${formatStrategyName(strategy)}</div>
            <div class="text-xs text-green-600">Support: ${customerData.config?.supportEscalation || 'Standard'}</div>
        `;
    }

    if (insightsElement) {
        const insights = generatePersonalizedInsights(customerData);
        insightsElement.innerHTML = insights.map(insight => `
            <div class="flex items-center gap-2 text-sm text-gray-600">
                <i class="${insight.icon} text-${insight.color}-500"></i>
                <span>${insight.text}</span>
            </div>
        `).join('');
    }
}

function renderUsageAnalytics(analyticsData) {
    const elements = {
        dailyUsage: document.getElementById('analytics-daily-usage'),
        featuresUsed: document.getElementById('analytics-features-used'),
        monthlyOrders: document.getElementById('analytics-monthly-orders'),
        accountAge: document.getElementById('analytics-account-age')
    };

    if (elements.dailyUsage) {
        elements.dailyUsage.textContent = `${analyticsData.dailyUsage.toFixed(1)}h`;
    }

    if (elements.featuresUsed) {
        elements.featuresUsed.textContent = analyticsData.featuresUsed.toString();
    }

    if (elements.monthlyOrders) {
        elements.monthlyOrders.textContent = analyticsData.monthlyOrders.toString();
    }

    if (elements.accountAge) {
        elements.accountAge.textContent = `${Math.ceil(analyticsData.accountAge)}d`;
    }
}

function renderActionCenter() {
    const data = LicensingDashboard.data;

    // Show/hide action buttons based on status
    const updatePaymentBtn = document.getElementById('action-update-payment');
    const validateBtn = document.getElementById('action-validate-license');
    const buyBtn = document.getElementById('action-buy-license');

    if (updatePaymentBtn) {
        if (data.licenseStatus === 'active' && data.customerInfo.email) {
            updatePaymentBtn.classList.remove('hidden');
        } else {
            updatePaymentBtn.classList.add('hidden');
        }
    }

    if (validateBtn) {
        validateBtn.disabled = data.connectionStatus === 'offline';
        if (data.connectionStatus === 'offline') {
            validateBtn.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            validateBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }

    if (buyBtn) {
        if (data.licenseStatus === 'trial' || data.licenseStatus === 'expired') {
            buyBtn.classList.remove('hidden');
        } else {
            buyBtn.classList.add('hidden');
        }
    }
}

function renderSupportSection(customerData) {
    const recommendedElement = document.getElementById('recommended-support');
    const emergencyElement = document.getElementById('emergency-contact-info');

    if (recommendedElement && customerData.config) {
        const supportLevel = customerData.config.supportEscalation;
        recommendedElement.textContent = formatSupportLevel(supportLevel);
    }

    if (emergencyElement) {
        const hasEmergencySupport = ['power_users', 'loyal_customers'].includes(customerData.segment);
        if (hasEmergencySupport) {
            emergencyElement.innerHTML = `
                <a href="mailto:emergency@pospal.gr" class="text-blue-600 hover:underline text-xs">
                    emergency@pospal.gr
                </a>
            `;
        } else {
            emergencyElement.textContent = 'Available for power users and loyal customers';
        }
    }
}

function renderRecentActivity(activities) {
    const container = document.getElementById('recent-activity-content');
    if (!container) return;

    if (activities.length === 0) {
        container.innerHTML = '<div class="text-sm text-gray-500 text-center py-4">No recent activity</div>';
        return;
    }

    container.innerHTML = activities.map(activity => `
        <div class="flex items-center gap-3 p-2 border-b border-gray-100 last:border-0">
            <div class="w-8 h-8 rounded-full flex items-center justify-center ${
                activity.status === 'success' ? 'bg-green-100' :
                activity.status === 'error' ? 'bg-red-100' : 'bg-blue-100'
            }">
                <i class="fas ${getActivityIcon(activity.type)} text-sm ${
                    activity.status === 'success' ? 'text-green-600' :
                    activity.status === 'error' ? 'text-red-600' : 'text-blue-600'
                }"></i>
            </div>
            <div class="flex-1">
                <div class="text-sm font-medium text-gray-900">${activity.description}</div>
                <div class="text-xs text-gray-500">${formatRelativeTime(activity.timestamp)}</div>
            </div>
        </div>
    `).join('');
}

// Dashboard utility functions
function updateDashboardLoadingState(isLoading) {
    const refreshBtn = document.getElementById('refresh-license-btn');
    if (refreshBtn) {
        if (isLoading) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>Loading...';
        } else {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt mr-1.5"></i>Refresh';
        }
    }
}

function showDashboardError(message) {
    showToast(`Dashboard Error: ${message}`, 'error', 5000);
}

function getStatusDisplayConfig(status) {
    const configs = {
        active: { text: 'Active', color: 'bg-green-500' },
        trial: { text: 'Trial', color: 'bg-blue-500' },
        expired: { text: 'Expired', color: 'bg-red-500' },
        grace: { text: 'Grace Period', color: 'bg-orange-500' },
        loading: { text: 'Loading...', color: 'bg-gray-500' }
    };

    return configs[status] || configs.loading;
}

function formatSegmentName(segment) {
    const names = {
        power_users: 'Power User',
        loyal_customers: 'Loyal Customer',
        new_adopters: 'New Adopter',
        seasonal_restaurants: 'Seasonal Restaurant',
        price_sensitive: 'Price Sensitive',
        high_risk: 'High Risk',
        default: 'Standard User'
    };

    return names[segment] || 'Unknown';
}

function formatStrategyName(strategy) {
    const names = {
        partnership_focused: 'Partnership Focus',
        relationship_focused: 'Relationship Focus',
        education_focused: 'Education Focus',
        flexibility_focused: 'Flexibility Focus',
        cost_benefit_focused: 'Cost-Benefit Focus',
        last_chance_focused: 'Last Chance Focus',
        generic: 'Standard Approach'
    };

    return names[strategy] || 'Standard';
}

function formatSupportLevel(level) {
    const levels = {
        immediate: 'Immediate Support',
        priority: 'Priority Support',
        onboarding_call: 'Onboarding Support',
        pause_offer: 'Pause Assistance',
        discount_offer: 'Discount Support',
        standard: 'Standard Support'
    };

    return levels[level] || 'Standard Support';
}

function generatePersonalizedInsights(customerData) {
    const insights = [];

    if (customerData.customerData.dailyUsage > 6) {
        insights.push({
            icon: 'fas fa-chart-line',
            color: 'green',
            text: 'High engagement - excellent usage patterns'
        });
    }

    if (customerData.customerData.paymentFailures === 0) {
        insights.push({
            icon: 'fas fa-check-circle',
            color: 'green',
            text: 'Perfect payment history'
        });
    }

    if (customerData.segment === 'new_adopters') {
        insights.push({
            icon: 'fas fa-graduation-cap',
            color: 'blue',
            text: 'Onboarding support available'
        });
    }

    if (customerData.segment === 'power_users') {
        insights.push({
            icon: 'fas fa-crown',
            color: 'purple',
            text: 'VIP support and features available'
        });
    }

    return insights;
}

function getActivityIcon(type) {
    const icons = {
        validation: 'fa-shield-alt',
        payment: 'fa-credit-card',
        trial: 'fa-calendar-plus',
        support: 'fa-headset',
        feature: 'fa-star'
    };

    return icons[type] || 'fa-info-circle';
}

function formatRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
}

// Dashboard action handlers
function refreshLicensingDashboard() {
    if (document.getElementById('licensingManagement').style.display !== 'none') {
        loadLicensingDashboard();
    }
}

// CRITICAL: Missing refreshLicenseStatus function - connects to billing date API
async function refreshLicenseStatus() {
    console.log('Refreshing license status and billing information...');

    try {
        // Get stored license credentials
        const customerEmail = localStorage.getItem('pospal_customer_email');
        const unlockToken = localStorage.getItem('pospal_unlock_token');

        if (!customerEmail || !unlockToken) {
            console.log('No license credentials found - using trial status');
            updateBillingDatesUI(null);
            return;
        }

        // Call the enhanced validate endpoint that includes billing dates
        const response = await fetch('https://pospal-licensing-v2-production.bzoumboulis.workers.dev/validate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: customerEmail,
                token: unlockToken,
                machineFingerprint: await generateMachineFingerprint()
            })
        });

        const result = await response.json();
        console.log('License validation response:', result);

        if (result.valid && result.subscriptionInfo) {
            // Update billing date UI with real data from API
            updateBillingDatesUI(result.subscriptionInfo);

            // Update localStorage with fresh data
            localStorage.setItem('pospal_last_validated', Date.now().toString());
            localStorage.setItem('pospal_cached_status', 'active');

            showToast('License and billing information updated', 'success');
        } else {
            console.log('License validation failed or no subscription info');
            updateBillingDatesUI(null);
        }

    } catch (error) {
        console.error('Failed to refresh license status:', error);
        showToast('Failed to update license information', 'error');
        updateBillingDatesUI(null);
    }
}

// Update billing date UI elements with real API data
function updateBillingDatesUI(subscriptionInfo) {
    const nextBillingElement = document.getElementById('next-billing-date');
    const daysUntilElement = document.getElementById('days-until-renewal');

    if (subscriptionInfo && subscriptionInfo.nextBillingDate) {
        // Parse and format the next billing date
        const nextBillingDate = new Date(subscriptionInfo.nextBillingDate);
        const formattedDate = nextBillingDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        // Calculate days until renewal
        const today = new Date();
        const daysUntil = Math.ceil((nextBillingDate - today) / (1000 * 60 * 60 * 24));

        // Update UI elements
        if (nextBillingElement) {
            nextBillingElement.textContent = formattedDate;
            nextBillingElement.classList.remove('text-gray-400');
            nextBillingElement.classList.add('text-blue-800');
        }

        if (daysUntilElement) {
            if (daysUntil > 0) {
                daysUntilElement.textContent = `${daysUntil} days`;
                daysUntilElement.classList.remove('text-gray-400');
                daysUntilElement.classList.add('text-purple-800');
            } else {
                daysUntilElement.textContent = 'Renewal due';
                daysUntilElement.classList.remove('text-gray-400');
                daysUntilElement.classList.add('text-red-600');
            }
        }

        console.log(`Updated billing UI: Next payment ${formattedDate}, ${daysUntil} days remaining`);
    } else {
        // No billing data available - show appropriate fallback
        if (nextBillingElement) {
            nextBillingElement.textContent = 'Not available';
            nextBillingElement.classList.add('text-gray-400');
        }

        if (daysUntilElement) {
            daysUntilElement.textContent = 'Unknown';
            daysUntilElement.classList.add('text-gray-400');
        }

        console.log('No billing data available - showing fallback messages');
    }
}

// Generate machine fingerprint for license validation
async function generateMachineFingerprint() {
    const components = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 'unknown'
    ];

    const fingerprint = components.join('|');

    // Simple hash function for fingerprint
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
        const char = fingerprint.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(16);
}

function openPaymentUpdate() {
    if (typeof openCustomerPortal === 'function') {
        openCustomerPortal();
    } else {
        window.open('https://pospal.gr/customer-portal', '_blank');
    }
}

function validateLicenseNow() {
    if (typeof refreshLicenseStatus === 'function') {
        refreshLicenseStatus();
    } else {
        showToast('Validating license...', 'info');
        setTimeout(() => {
            loadLicensingDashboard();
        }, 1000);
    }
}

function openLicensePurchase() {
    window.open('https://pospal.gr/buy-license.html', '_blank');
}

function copyHardwareIdFromDashboard() {
    const hardwareId = document.getElementById('dashboard-hardware-id')?.textContent;
    if (hardwareId) {
        navigator.clipboard.writeText(hardwareId).then(() => {
            showToast('Hardware ID copied to clipboard', 'success');
        }).catch(() => {
            showToast('Failed to copy Hardware ID', 'error');
        });
    }
}

function contactSupport() {
    const customerData = LicensingDashboard.data;
    const subject = `Support Request - ${customerData.customerInfo.email || 'Unknown'}`;
    const body = `Customer Segment: ${formatSegmentName(customerData.customerSegment)}\nLicense Status: ${customerData.licenseStatus}\nDays Remaining: ${Math.ceil(customerData.daysRemaining || 0)}`;

    window.open(`mailto:support@pospal.gr?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
}

function openDocumentation() {
    window.open('https://github.com/Radot1/POSPal/wiki', '_blank');
}

function reportIssue() {
    window.open('https://github.com/Radot1/POSPal/issues/new', '_blank');
}

function toggleAdvancedSettings() {
    const content = document.getElementById('advanced-settings-content');
    const icon = document.getElementById('advanced-settings-icon');

    if (content && icon) {
        const isHidden = content.classList.contains('hidden');

        if (isHidden) {
            content.classList.remove('hidden');
            icon.style.transform = 'rotate(180deg)';
        } else {
            content.classList.add('hidden');
            icon.style.transform = 'rotate(0deg)';
        }
    }
}

function forceLicenseRevalidation() {
    // Clear validation cache
    localStorage.removeItem('pospal_last_validated');
    localStorage.removeItem('pospal_cached_status');

    if (typeof refreshLicenseStatus === 'function') {
        refreshLicenseStatus();
    }

    showToast('License revalidation forced', 'info');
    setTimeout(loadLicensingDashboard, 1000);
}

function exportLicenseData() {
    const data = {
        licenseStatus: LicensingDashboard.data.licenseStatus,
        customerInfo: LicensingDashboard.data.customerInfo,
        lastValidation: LicensingDashboard.data.lastValidation,
        daysRemaining: LicensingDashboard.data.daysRemaining,
        customerSegment: LicensingDashboard.data.customerSegment,
        exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pospal-license-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// Helper functions for analytics data gathering
function getAccountAge() {
    const trialStart = localStorage.getItem('pospal_trial_start');
    if (trialStart) {
        return (Date.now() - parseInt(trialStart)) / (24 * 60 * 60 * 1000);
    }
    return 0;
}

function getAverageDailyUsage() {
    // This would be calculated from actual usage tracking
    // For now, return a reasonable estimate
    const orders = getTodaysOrders();
    return Math.min(12, Math.max(1, orders.length * 0.5));
}

function getFeaturesUsed() {
    let count = 0;

    // Check which features have been used
    if (localStorage.getItem('pospal_categories_used')) count++;
    if (localStorage.getItem('pospal_items_used')) count++;
    if (localStorage.getItem('pospal_orders_made')) count++;
    if (localStorage.getItem('pospal_analytics_viewed')) count++;
    if (localStorage.getItem('pospal_management_accessed')) count++;

    return Math.max(1, count);
}

function getMonthlyOrders() {
    // This would come from actual order tracking
    const dailyOrders = getTodaysOrders().length;
    return Math.max(1, dailyOrders * 30); // Simple estimation
}

function getPaymentFailures() {
    const failures = localStorage.getItem('pospal_payment_failures');
    return failures ? parseInt(failures) : 0;
}

function getPaymentHistory() {
    const failures = getPaymentFailures();
    return failures === 0 ? 'consistent' : failures > 3 ? 'problematic' : 'occasional_issues';
}

function getDowntimeDays() {
    const lastSeen = localStorage.getItem('pospal_last_seen');
    if (lastSeen) {
        return (Date.now() - parseInt(lastSeen)) / (24 * 60 * 60 * 1000);
    }
    return 0;
}

// =============================================================================
// END COMPREHENSIVE LICENSING DASHBOARD SYSTEM
// =============================================================================