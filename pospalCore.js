// --- Global State & Configuration ---
let menu = {};
let selectedCategory = null;
let editingItem = null;

// --- Printer Session State ---
let printerVerificationStatus = 'unknown'; // 'unknown', 'verified', 'failed'

// --- Constants ---
const SELECTED_TABLE_KEY = 'pospal_selected_table';
const UNIVERSAL_COMMENT_KEY = 'pospal_universal_comment';
const WORKER_URL = 'https://pospal-licensing-v2-production.bzoumboulis.workers.dev';

// --- NEW: Centralized State Management ---
// Generate unique device ID for this session
const DEVICE_ID = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
let currentOrder = [];
let currentOrderLineItemCounter = 0;
let orderNumber = 1;
let universalOrderComment = "";
let selectedTableNumber = "";
let isPaidByCard = false;

// --- State for Mobile UI (POSPal) ---
let isMobileOrderPanelOpen = false;
let itemForNumpad = null;
let numpadCurrentInput = "";

// --- State for Option Selection ---
let itemBeingConfigured = null;
let currentOptionSelectionStep = null;

// --- State for Desktop UI ---
let selectedItemId_desktop = null;
let numpadInput_desktop = "";

// --- Table Management State ---
let tableManagementEnabled = false;
let tableConfig = null;
let tableSessions = {};
let selectedTableForAction = null;

// --- Centralized Timer Management System ---
const TimerManager = {
    timers: new Map(),
    
    set(name, callback, delay, type = 'timeout') {
        this.clear(name);
        const id = type === 'timeout' ? setTimeout(callback, delay) : setInterval(callback, delay);
        this.timers.set(name, { id, type });
        return id;
    },
    
    clear(name) {
        const timer = this.timers.get(name);
        if (timer) {
            if (timer.type === 'timeout') {
                clearTimeout(timer.id);
            } else {
                clearInterval(timer.id);
            }
            this.timers.delete(name);
        }
    },
    
    clearAll() {
        this.timers.forEach((timer, name) => {
            this.clear(name);
        });
    },
    
    has(name) {
        return this.timers.has(name);
    },
    
    // Cleanup on page unload
    setupCleanup() {
        window.addEventListener('beforeunload', () => {
            this.clearAll();
        });
    }
};

// Essential validation timers only
const ValidationTimers = {
    SUBSCRIPTION_CHECK: 4 * 60 * 60 * 1000, // 4 hours
    HEARTBEAT_INTERVAL: 30 * 1000, // 30 seconds
    
    scheduleSubscriptionCheck() {
        TimerManager.set('subscriptionCheck', this.performSubscriptionCheck.bind(this), this.SUBSCRIPTION_CHECK, 'interval');
    },
    
    async performSubscriptionCheck() {
        const unlockToken = localStorage.getItem('pospal_unlock_token');
        const customerEmail = localStorage.getItem('pospal_customer_email');
        
        if (unlockToken && customerEmail) {
            console.log('Performing scheduled subscription validation');
            await validateSubscriptionInBackground(customerEmail, unlockToken);
        }
    }
};

// Initialize timer cleanup
TimerManager.setupCleanup();

// --- Unified Status Display System ---
const StatusDisplayManager = {
    elements: null,
    
    init() {
        this.elements = {
            statusDisplay: document.getElementById('license-status-display'),
            statusBadge: document.getElementById('license-status-badge'),
            footerStatus: document.getElementById('footer-trial-status'),
            subscriptionDetails: document.getElementById('subscription-details'),
            trialActions: document.getElementById('trial-actions'),
            nextBillingDate: document.getElementById('next-billing-date')
        };
    },
    
    updateLicenseStatus(statusType, options = {}) {
        if (!this.elements) this.init();
        
        const { 
            isOnline = true, 
            customerName = '', 
            validUntil = '', 
            daysLeft = 0,
            remainingDays = 0 
        } = options;
        
        let statusConfig = this.getStatusConfig(statusType, { isOnline, customerName, validUntil, daysLeft, remainingDays });
        
        // Update all status elements consistently
        this.updateStatusDisplay(statusConfig.html);
        this.updateStatusBadge(statusConfig.badge, statusConfig.badgeClass);
        this.updateFooterStatus(statusConfig.footer);
        this.toggleUIElements(statusConfig.showSubscription, statusConfig.showTrialActions);
        
        // Add visual feedback for important changes
        if (statusConfig.animate) {
            this.animateStatusChange();
        }
    },
    
    getStatusConfig(statusType, options) {
        const { isOnline, customerName, validUntil, daysLeft, remainingDays } = options;
        
        switch (statusType) {
            case 'active':
                return {
                    html: `
                        <div class="flex items-center space-x-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                            <div class="flex-shrink-0">
                                <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                </svg>
                            </div>
                            <div class="flex-1">
                                <h3 class="text-lg font-semibold text-green-800">Welcome to POSPal Pro!</h3>
                                <p class="text-green-700">Your subscription is active and ready to use.</p>
                                ${customerName ? `<p class="text-sm text-green-600">Licensed to: ${customerName}</p>` : ''}
                            </div>
                        </div>
                    `,
                    badge: isOnline ? 'Active & Verified' : 'Active (Offline)',
                    badgeClass: isOnline ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800',
                    footer: customerName ? `<i class="fas fa-star text-yellow-500 mr-1"></i>Licensed to: ${customerName}` : '',
                    showSubscription: true,
                    showTrialActions: false,
                    animate: true
                };
                
            case 'trial':
                return {
                    html: `
                        <div class="flex items-center space-x-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                            <div class="flex-shrink-0">
                                <svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                </svg>
                            </div>
                            <div class="flex-1">
                                <h3 class="text-lg font-semibold text-blue-800">Free Trial Active</h3>
                                <p class="text-blue-700">You're using POSPal in trial mode with full features.</p>
                                ${daysLeft > 0 ? `<p class="text-sm text-blue-600">${daysLeft} days remaining</p>` : ''}
                            </div>
                        </div>
                    `,
                    badge: 'Trial Mode',
                    badgeClass: 'bg-blue-100 text-blue-800',
                    footer: `<i class="fas fa-clock text-blue-500 mr-1"></i>Trial Mode${daysLeft > 0 ? ` (${daysLeft} days left)` : ''}`,
                    showSubscription: false,
                    showTrialActions: true,
                    animate: false
                };
                
            case 'warning':
                return {
                    html: `
                        <div class="flex items-center space-x-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <div class="flex-shrink-0">
                                <svg class="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 15c-.77.833.192 2.5 1.732 2.5z"></path>
                                </svg>
                            </div>
                            <div class="flex-1">
                                <h3 class="text-lg font-semibold text-yellow-800">Verification Needed</h3>
                                <p class="text-yellow-700">License verification required!</p>
                                <p class="text-sm text-yellow-600">${remainingDays} days remaining before trial mode.</p>
                            </div>
                        </div>
                    `,
                    badge: 'Verification Needed',
                    badgeClass: 'bg-yellow-100 text-yellow-800',
                    footer: `<i class="fas fa-exclamation-triangle text-yellow-500 mr-1"></i>Verification needed`,
                    showSubscription: false,
                    showTrialActions: true,
                    animate: false
                };
                
            case 'loading':
                return {
                    html: `
                        <div class="flex items-center space-x-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                            <div class="flex-shrink-0">
                                <svg class="w-8 h-8 text-gray-600 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            </div>
                            <div class="flex-1">
                                <h3 class="text-lg font-semibold text-gray-800">Validating License</h3>
                                <p class="text-gray-600">Checking your subscription status...</p>
                            </div>
                        </div>
                    `,
                    badge: 'Validating...',
                    badgeClass: 'bg-gray-100 text-gray-600',
                    footer: '<i class="fas fa-spinner fa-spin text-gray-500 mr-1"></i>Validating license...',
                    showSubscription: false,
                    showTrialActions: false,
                    animate: false
                };

            case 'offline':
                const lastSuccessful = localStorage.getItem('pospal_last_successful_validation');
                const daysSince = lastSuccessful ?
                    ((Date.now() - parseInt(lastSuccessful)) / (1000 * 60 * 60 * 24)).toFixed(1) : 'unknown';

                return {
                    html: `
                        <div class="flex items-center space-x-3 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                            <div class="flex-shrink-0">
                                <svg class="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4"></path>
                                </svg>
                            </div>
                            <div class="flex-1">
                                <h3 class="text-lg font-semibold text-orange-800">Grace Period</h3>
                                <p class="text-orange-700">Running in offline grace period.</p>
                                <p class="text-sm text-orange-600">${daysSince} days since last verification</p>
                            </div>
                        </div>
                    `,
                    badge: 'Grace Period',
                    badgeClass: 'bg-orange-100 text-orange-800',
                    footer: `<i class="fas fa-wifi-slash text-orange-500 mr-1"></i>Offline mode`,
                    showSubscription: false,
                    showTrialActions: true,
                    animate: false
                };
                
            default:
                return {
                    html: '<p class="text-gray-600">Loading license status...</p>',
                    badge: 'Loading...',
                    badgeClass: 'bg-gray-100 text-gray-600',
                    footer: '',
                    showSubscription: false,
                    showTrialActions: false,
                    animate: false
                };
        }
    },
    
    updateStatusDisplay(html) {
        if (this.elements.statusDisplay) {
            this.elements.statusDisplay.innerHTML = html;
        }
    },
    
    updateStatusBadge(text, className) {
        if (this.elements.statusBadge) {
            this.elements.statusBadge.textContent = text;
            this.elements.statusBadge.className = `px-3 py-1 text-sm font-semibold rounded-full ${className}`;
        }
    },
    
    updateFooterStatus(html) {
        if (this.elements.footerStatus) {
            this.elements.footerStatus.innerHTML = html;
        }
    },
    
    toggleUIElements(showSubscription, showTrialActions) {
        if (this.elements.subscriptionDetails) {
            this.elements.subscriptionDetails.classList.toggle('hidden', !showSubscription);
        }
        if (this.elements.trialActions) {
            this.elements.trialActions.classList.toggle('hidden', !showTrialActions);
        }
    },
    
    animateStatusChange() {
        if (this.elements.statusDisplay) {
            this.elements.statusDisplay.style.opacity = '0';
            this.elements.statusDisplay.style.transform = 'translateY(10px)';
            setTimeout(() => {
                this.elements.statusDisplay.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                this.elements.statusDisplay.style.opacity = '1';
                this.elements.statusDisplay.style.transform = 'translateY(0)';
            }, 100);
        }
    }
};

// --- Centralized License Storage Management ---
const LicenseStorage = {
    // License data keys
    KEYS: {
        UNLOCK_TOKEN: 'pospal_unlock_token',
        CUSTOMER_EMAIL: 'pospal_customer_email',
        CUSTOMER_NAME: 'pospal_customer_name',
        LICENSE_STATUS: 'pospal_license_status',
        NEXT_BILLING_DATE: 'pospal_next_billing_date',
        LAST_VALIDATED: 'pospal_last_validated',
        LAST_SUCCESSFUL_VALIDATION: 'pospal_last_successful_validation',
        CACHED_STATUS: 'pospal_cached_status',
        PAYMENT_SUCCESS: 'pospal_payment_success',
        PAYMENT_TIMESTAMP: 'pospal_payment_timestamp',
        ACTIVATION_METHOD: 'pospal_activation_method',
        DAILY_RETRY_COUNT: 'pospal_daily_retry_count',
        LAST_DAILY_CHECK: 'pospal_last_daily_check'
    },
    
    // Get license data
    getLicenseData() {
        return {
            unlockToken: localStorage.getItem(this.KEYS.UNLOCK_TOKEN),
            customerEmail: localStorage.getItem(this.KEYS.CUSTOMER_EMAIL),
            customerName: localStorage.getItem(this.KEYS.CUSTOMER_NAME),
            licenseStatus: localStorage.getItem(this.KEYS.LICENSE_STATUS),
            nextBillingDate: localStorage.getItem(this.KEYS.NEXT_BILLING_DATE),
            lastValidated: localStorage.getItem(this.KEYS.LAST_VALIDATED),
            lastSuccessfulValidation: localStorage.getItem(this.KEYS.LAST_SUCCESSFUL_VALIDATION),
            cachedStatus: localStorage.getItem(this.KEYS.CACHED_STATUS)
        };
    },
    
    // Set license data
    setLicenseData(data) {
        if (data.unlockToken) localStorage.setItem(this.KEYS.UNLOCK_TOKEN, data.unlockToken);
        if (data.customerEmail) localStorage.setItem(this.KEYS.CUSTOMER_EMAIL, data.customerEmail);
        if (data.customerName) localStorage.setItem(this.KEYS.CUSTOMER_NAME, data.customerName);
        if (data.licenseStatus) localStorage.setItem(this.KEYS.LICENSE_STATUS, data.licenseStatus);
        if (data.nextBillingDate) localStorage.setItem(this.KEYS.NEXT_BILLING_DATE, data.nextBillingDate);
        if (data.lastValidated) localStorage.setItem(this.KEYS.LAST_VALIDATED, data.lastValidated);
        if (data.lastSuccessfulValidation) localStorage.setItem(this.KEYS.LAST_SUCCESSFUL_VALIDATION, data.lastSuccessfulValidation);
        if (data.cachedStatus) localStorage.setItem(this.KEYS.CACHED_STATUS, data.cachedStatus);
    },
    
    // Clear all license data
    clearLicenseData() {
        Object.values(this.KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
        console.log('All license data cleared from localStorage');
    },
    
    // Check if user has valid cached license
    hasValidCachedLicense() {
        const data = this.getLicenseData();
        return !!(data.unlockToken && data.customerEmail && data.licenseStatus === 'active');
    },
    
    // Get payment success data
    getPaymentData() {
        return {
            paymentSuccess: localStorage.getItem(this.KEYS.PAYMENT_SUCCESS),
            paymentTimestamp: localStorage.getItem(this.KEYS.PAYMENT_TIMESTAMP),
            activationMethod: localStorage.getItem(this.KEYS.ACTIVATION_METHOD)
        };
    },
    
    // Clear payment data
    clearPaymentData() {
        localStorage.removeItem(this.KEYS.PAYMENT_SUCCESS);
        localStorage.removeItem(this.KEYS.PAYMENT_TIMESTAMP);
        localStorage.removeItem(this.KEYS.ACTIVATION_METHOD);
    },
    
    // Update validation timestamps
    updateValidationTimestamp() {
        const now = Date.now().toString();
        localStorage.setItem(this.KEYS.LAST_VALIDATED, now);
        localStorage.setItem(this.KEYS.LAST_SUCCESSFUL_VALIDATION, now);
    },
    
    // Get/set retry tracking
    getDailyRetryData() {
        return {
            retryCount: parseInt(localStorage.getItem(this.KEYS.DAILY_RETRY_COUNT) || '0'),
            lastDailyCheck: localStorage.getItem(this.KEYS.LAST_DAILY_CHECK)
        };
    },
    
    setDailyRetryData(retryCount, lastCheck) {
        localStorage.setItem(this.KEYS.DAILY_RETRY_COUNT, retryCount.toString());
        localStorage.setItem(this.KEYS.LAST_DAILY_CHECK, lastCheck.toString());
    }
};

// --- PHASE 3B: Frontend License Manager - Unified Validation System ---
const FrontendLicenseManager = {
    // State management
    isInitialized: false,
    currentValidationState: null,
    isValidating: false,
    lastUIUpdate: 0,
    gracePeriodDays: 7,
    
    // Cache management
    cache: {
        licenseData: null,
        lastValidation: 0,
        isOnline: navigator.onLine
    },
    
    // Initialize the manager
    init() {
        if (this.isInitialized) return;
        
        console.log('Initializing FrontendLicenseManager...');
        
        // Initialize sub-managers
        StatusDisplayManager.init();
        
        // Setup online/offline detection
        this.setupNetworkDetection();
        
        // Setup validation timer
        this.setupValidationTimer();
        
        this.isInitialized = true;
        console.log('FrontendLicenseManager initialized successfully');
    },
    
    // Setup network state detection
    setupNetworkDetection() {
        window.addEventListener('online', () => {
            console.log('Network connection restored');
            this.cache.isOnline = true;
            this.performValidation(true); // Force validation when back online
        });
        
        window.addEventListener('offline', () => {
            console.log('Network connection lost');
            this.cache.isOnline = false;
            this.updateUIBasedOnCache();
        });
        
        this.cache.isOnline = navigator.onLine;
    },
    
    // Setup centralized validation timer
    setupValidationTimer() {
        // Clear any existing timers
        TimerManager.clear('licenseValidation');
        
        // Set up periodic validation (every 4 hours when online)
        TimerManager.set('licenseValidation', () => {
            if (this.cache.isOnline && !this.isValidating) {
                this.performValidation(false);
            }
        }, ValidationTimers.SUBSCRIPTION_CHECK, 'interval');
    },
    
    // Main validation entry point - replaces scattered calls
    async validateLicense(forceValidation = false) {
        if (!this.isInitialized) this.init();
        
        // Prevent multiple simultaneous validations
        if (this.isValidating && !forceValidation) {
            console.log('Validation already in progress, skipping duplicate call');
            return this.currentValidationState;
        }
        
        this.isValidating = true;
        
        try {
            console.log('Starting unified license validation...');
            
            // Check payment success first
            const paymentData = LicenseStorage.getPaymentData();
            if (paymentData.paymentSuccess) {
                const processed = await this.handlePaymentActivation(paymentData);
                if (processed) {
                    this.isValidating = false;
                    return this.currentValidationState;
                }
            }
            
            // Check cached license data
            const licenseData = LicenseStorage.getLicenseData();
            
            if (licenseData.unlockToken && licenseData.customerEmail && licenseData.licenseStatus === 'active') {
                console.log('Valid cached license found');
                
                // Show active status immediately from cache
                this.updateUIForActiveStatus(licenseData);
                
                // Validate in background if online
                if (this.cache.isOnline) {
                    this.performBackgroundValidation(licenseData);
                } else {
                    this.handleOfflineGracePeriod(licenseData);
                }
                
            } else {
                // No valid cached license, check trial status
                await this.checkTrialStatus();
            }
            
        } catch (error) {
            console.error('License validation error:', error);
            this.handleValidationError(error);
        } finally {
            this.isValidating = false;
        }
        
        return this.currentValidationState;
    },
    
    // Handle payment activation
    async handlePaymentActivation(paymentData) {
        try {
            const response = await fetch(`${WORKER_URL}/license-recovery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recovery_code: paymentData.paymentSuccess })
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.success && data.license && data.license.email && data.license.unlockToken) {
                    console.log('Payment activation successful');
                    
                    // Store license data
                    LicenseStorage.setLicenseData({
                        unlockToken: data.license.unlockToken,
                        customerEmail: data.license.email,
                        customerName: data.license.customerName || data.license.email,
                        licenseStatus: 'active',
                        nextBillingDate: data.license.nextBillingDate
                    });
                    
                    LicenseStorage.updateValidationTimestamp();
                    
                    // Clear payment data
                    LicenseStorage.clearPaymentData();
                    
                    // Update UI
                    this.updateUIForActiveStatus(LicenseStorage.getLicenseData());
                    
                    // Show success message
                    const customerName = data.license.customerName || data.license.email;
                    showToast(`Welcome ${customerName}! Your POSPal license has been automatically activated.`, 'success', 8000);
                    
                    return true;
                }
            }
        } catch (error) {
            console.error('Payment activation error:', error);
        }
        
        // Clear invalid payment data
        LicenseStorage.clearPaymentData();
        return false;
    },
    
    // Perform background validation for active licenses using unified endpoint
    async performBackgroundValidation(licenseData) {
        try {
            const validationRequest = {
                operation: 'validate',
                credentials: {
                    email: licenseData.customerEmail,
                    token: licenseData.unlockToken
                },
                device: {
                    machineFingerprint: await this.getDeviceFingerprint(),
                    deviceInfo: {
                        hostname: 'POSPal-Browser',
                        platform: 'web'
                    }
                },
                options: {
                    skipMachineUpdate: false,
                    performanceMode: 'background'
                }
            };
            
            const response = await fetch(`${WORKER_URL}/validate-unified`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(validationRequest)
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.success && data.validation.valid) {
                    console.log(`Unified background validation successful in ${data.performance?.responseTime || 0}ms - subscription confirmed active`);
                    
                    // Store enhanced license data from unified response
                    LicenseStorage.setLicenseData({
                        unlockToken: licenseData.unlockToken,
                        customerEmail: licenseData.customerEmail,
                        customerName: data.validation.customer?.name || licenseData.customerName,
                        licenseStatus: 'active',
                        nextBillingDate: data.subscription?.nextBillingDate,
                        subscriptionId: data.subscription?.id,
                        validationType: data.validation.validationType,
                        cacheStrategy: data.caching?.strategy,
                        cacheValidUntil: data.caching?.validUntil
                    });
                    
                    LicenseStorage.updateValidationTimestamp();
                    
                    // Log performance metrics
                    if (data.performance) {
                        console.log(`Unified validation performance: ${data.performance.responseTime}ms, cache strategy: ${data.caching?.strategy}`);
                    }

                    // Update UI to show active status after successful background validation
                    this.updateUIForActiveStatus(LicenseStorage.getLicenseData());
                } else {
                    const errorInfo = data.error || {};
                    console.log(`Unified background validation failed: ${errorInfo.code} - ${errorInfo.message}`);
                    
                    // Only invalidate license if error indicates authentication issue
                    if (errorInfo.category === 'authentication' || errorInfo.code === 'SUBSCRIPTION_INACTIVE') {
                        this.handleInvalidLicense();
                    } else {
                        console.log('Keeping current license due to non-authentication error');
                    }
                }
            } else {
                console.log('Unified background validation failed - server error');
                // Don't invalidate on server errors, could be temporary
            }
        } catch (error) {
            console.log('Unified background validation error:', error.message);
            // Don't invalidate on network errors
        }
    },
    
    // Handle offline grace period
    handleOfflineGracePeriod(licenseData) {
        const lastSuccessful = parseInt(licenseData.lastSuccessfulValidation || '0');
        const daysSinceValidation = (Date.now() - lastSuccessful) / (1000 * 60 * 60 * 24);
        
        if (daysSinceValidation > this.gracePeriodDays) {
            console.log('Grace period expired, switching to trial');
            this.handleInvalidLicense();
        } else {
            console.log(`Running in offline grace period (${daysSinceValidation.toFixed(1)} days since validation)`);
            this.updateUIForOfflineStatus(daysSinceValidation);
        }
    },
    
    // Check trial status when no valid license
    async checkTrialStatus() {
        if (!this.cache.isOnline) {
            this.updateUIForOfflineStatus(0);
            return;
        }
        
        try {
            const response = await fetch('/api/trial_status');
            const data = await response.json();
            
            if (response.ok) {
                this.handleTrialResponse(data);
            } else {
                console.error('Trial status check failed:', data.message);
                this.updateUIForTrialStatus(0, false);
            }
        } catch (error) {
            console.error('Trial status error:', error);
            this.updateUIForTrialStatus(0, false);
        }
    },
    
    // Handle trial status response
    handleTrialResponse(data) {
        const { days_left: daysLeft, expired } = data;
        
        if (expired) {
            console.log('Trial expired');
            this.updateUIForExpiredTrial();
        } else {
            console.log(`Trial active with ${daysLeft} days remaining`);
            this.updateUIForTrialStatus(daysLeft, true);
        }
    },
    
    // Handle invalid license - clear data and show trial
    handleInvalidLicense() {
        console.log('Clearing invalid license data');
        LicenseStorage.clearLicenseData();
        this.checkTrialStatus();
    },
    
    // Handle validation errors
    handleValidationError(error) {
        console.error('Validation error:', error);
        
        // Show loading state or cached state
        if (this.currentValidationState) {
            // Keep current state if we have one
            return;
        }
        
        // Show loading state
        StatusDisplayManager.updateLicenseStatus('loading');
        this.currentValidationState = { status: 'loading', error: error.message };
    },
    
    // Unified UI update methods
    updateUIForActiveStatus(licenseData) {
        console.log('Updating UI for active license status');

        this.currentValidationState = {
            status: 'active',
            isOnline: this.cache.isOnline,
            customerName: licenseData.customerName || licenseData.customerEmail,
            timestamp: Date.now()
        };

        // Prevent UI flicker by throttling updates
        this.throttledUIUpdate(() => {
            StatusDisplayManager.updateLicenseStatus('active', {
                isOnline: this.cache.isOnline,
                customerName: licenseData.customerName || licenseData.customerEmail
            });

            // Update billing date display
            this.updateBillingDateDisplay(licenseData);

            // Show portal access buttons
            this.showPortalButtons();

            // Update license status badge if it exists
            const statusBadge = document.getElementById('license-status-badge');
            if (statusBadge) {
                statusBadge.textContent = 'Active License';
                statusBadge.className = 'px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800';
            }
        });
    },
    
    updateUIForTrialStatus(daysLeft, isActive) {
        console.log(`Updating UI for trial status: ${daysLeft} days left, active: ${isActive}`);
        
        this.currentValidationState = {
            status: 'trial',
            daysLeft: daysLeft,
            isActive: isActive,
            timestamp: Date.now()
        };
        
        this.throttledUIUpdate(() => {
            StatusDisplayManager.updateLicenseStatus('trial', { daysLeft });
            this.hidePortalButtons();
        });
    },
    
    updateUIForExpiredTrial() {
        console.log('Updating UI for expired trial');
        
        this.currentValidationState = {
            status: 'expired',
            timestamp: Date.now()
        };
        
        this.throttledUIUpdate(() => {
            StatusDisplayManager.updateLicenseStatus('warning', { remainingDays: 0 });
            this.hidePortalButtons();
        });
    },
    
    updateUIForOfflineStatus(daysSince) {
        console.log('Updating UI for offline status');
        
        this.currentValidationState = {
            status: 'offline',
            daysSince: daysSince,
            timestamp: Date.now()
        };
        
        this.throttledUIUpdate(() => {
            StatusDisplayManager.updateLicenseStatus('offline', { daysSince });
        });
    },
    
    // Update UI based on cached data when offline
    updateUIBasedOnCache() {
        const licenseData = LicenseStorage.getLicenseData();
        
        if (licenseData.unlockToken && licenseData.customerEmail && licenseData.licenseStatus === 'active') {
            this.handleOfflineGracePeriod(licenseData);
        } else {
            this.updateUIForOfflineStatus(0);
        }
    },
    
    // Throttle UI updates to prevent flicker
    throttledUIUpdate(updateFunction) {
        const now = Date.now();
        if (now - this.lastUIUpdate < 500) { // Minimum 500ms between UI updates
            return;
        }
        
        this.lastUIUpdate = now;
        updateFunction();
    },
    
    // Helper methods for UI elements
    updateBillingDateDisplay(licenseData) {
        console.log('Updating billing date display with data:', licenseData);

        // Update next payment date
        const nextBillingDate = document.getElementById('next-billing-date');
        if (nextBillingDate) {
            if (licenseData.nextBillingDate) {
                try {
                    const billingDate = new Date(licenseData.nextBillingDate);
                    nextBillingDate.textContent = billingDate.toLocaleDateString();

                    // Calculate and update days until renewal
                    const daysUntilRenewal = document.getElementById('days-until-renewal');
                    if (daysUntilRenewal) {
                        const now = new Date();
                        const daysLeft = Math.ceil((billingDate - now) / (1000 * 60 * 60 * 24));
                        daysUntilRenewal.textContent = daysLeft > 0 ? `${daysLeft} days` : 'Overdue';
                    }
                } catch (error) {
                    console.error('Error parsing billing date:', error);
                    nextBillingDate.textContent = 'Next month';
                    const daysUntilRenewal = document.getElementById('days-until-renewal');
                    if (daysUntilRenewal) {
                        daysUntilRenewal.textContent = '~30 days';
                    }
                }
            } else {
                nextBillingDate.textContent = 'Not available';
                const daysUntilRenewal = document.getElementById('days-until-renewal');
                if (daysUntilRenewal) {
                    daysUntilRenewal.textContent = 'Unknown';
                }
            }
        }

        // Hide loading state and show subscription details if we have valid license data
        if (licenseData.licenseStatus === 'active' || licenseData.unlockToken) {
            const loadingElement = document.getElementById('license-loading');
            const detailsElement = document.getElementById('subscription-details');

            if (loadingElement) {
                loadingElement.style.display = 'none';
            }
            if (detailsElement) {
                detailsElement.classList.remove('hidden');
                detailsElement.style.display = 'block';
            }
        }
    },
    
    showPortalButtons() {
        const quickPortalBtn = document.getElementById('quick-portal-btn');
        // Note: footer-portal-btn removed - only using quick access button in license modal

        if (quickPortalBtn) quickPortalBtn.classList.remove('hidden');
    },
    
    hidePortalButtons() {
        const quickPortalBtn = document.getElementById('quick-portal-btn');
        // Note: footer-portal-btn removed - only using quick access button in license modal

        if (quickPortalBtn) quickPortalBtn.classList.add('hidden');
    },
    
    // Force validation (for manual refresh)
    async forceValidation() {
        console.log('Forcing license validation...');
        this.cache.lastValidation = 0; // Reset cache
        return await this.validateLicense(true);
    },
    
    // Get current status (for external queries)
    getCurrentStatus() {
        return this.currentValidationState;
    },
    
    // Generate device fingerprint for unified validation
    async getDeviceFingerprint() {
        try {
            // Use consistent backend hardware ID (same as generateMachineFingerprint)
            if (typeof generateMachineFingerprint === 'function') {
                return await generateMachineFingerprint();
            }

            // Direct backend API call for hardware ID
            const response = await fetch('/api/hardware_id');
            if (response.ok) {
                const data = await response.json();
                return data.hardware_id || 'fallback-fingerprint';
            }

            throw new Error('Failed to fetch hardware ID from backend');
        } catch (error) {
            console.error('Error generating device fingerprint:', error);
            // Last resort fallback - should be avoided
            console.warn('Using timestamp-based fallback fingerprint - this may cause security email issues');
            return 'fallback-' + Date.now();
        }
    },
    
    // Cleanup method
    cleanup() {
        TimerManager.clear('licenseValidation');
        this.isInitialized = false;
        console.log('FrontendLicenseManager cleaned up');
    }
};

// --- COMPATIBILITY LAYER: Maintain existing function signatures ---
// This ensures existing code continues to work while using the unified system
async function checkAndDisplayTrialStatus() {
    console.log('checkAndDisplayTrialStatus() called - delegating to FrontendLicenseManager');
    return await FrontendLicenseManager.validateLicense();
}

function showActiveLicenseStatus() {
    console.log('showActiveLicenseStatus() called - delegating to FrontendLicenseManager');
    // This function is now handled internally by FrontendLicenseManager
    // but we maintain the signature for compatibility
    const licenseData = LicenseStorage.getLicenseData();
    if (licenseData.unlockToken && licenseData.customerEmail && licenseData.licenseStatus === 'active') {
        FrontendLicenseManager.updateUIForActiveStatus(licenseData);
    }
}

async function validateSubscriptionInBackground(customerEmail, unlockToken) {
    console.log('validateSubscriptionInBackground() called - delegating to FrontendLicenseManager');
    // This is now handled internally by FrontendLicenseManager's performBackgroundValidation
    // but we maintain the signature for compatibility
    const licenseData = { customerEmail, unlockToken };
    return await FrontendLicenseManager.performBackgroundValidation(licenseData);
}

// Legacy function - now uses unified validation
async function performValidationCheck() {
    return await FrontendLicenseManager.validateLicense();
}

// --- NEW: Centralized State Management Functions ---
async function loadCentralizedState() {
    try {
        const response = await fetch(`/api/state?device_id=${DEVICE_ID}`);
        const data = await response.json();
        
        if (data.success) {
            currentOrder = data.state.current_order || [];
            currentOrderLineItemCounter = data.state.order_line_counter || 0;
            universalOrderComment = data.state.universal_comment || "";
            selectedTableNumber = data.state.selected_table || "";
            
            console.log('Centralized state loaded:', data.state);
            return true;
        } else {
            console.error('Failed to load centralized state:', data.message);
            return false;
        }
    } catch (error) {
        console.error('Error loading centralized state:', error);
        return false;
    }
}

async function saveCentralizedState(stateKey, value) {
    try {
        const response = await fetch(`/api/state/${stateKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ [stateKey]: value })
        });
        
        const data = await response.json();
        if (data.success) {
            console.log(`Centralized state saved: ${stateKey} =`, value);
            return true;
        } else {
            console.error(`Failed to save centralized state ${stateKey}:`, data.message);
            return false;
        }
    } catch (error) {
        console.error(`Error saving centralized state ${stateKey}:`, error);
        return false;
    }
}

async function updateCurrentOrder() {
    return await saveCentralizedState('current_order', currentOrder);
}

async function updateOrderLineCounter() {
    return await saveCentralizedState('order_line_counter', currentOrderLineItemCounter);
}

async function updateUniversalComment() {
    return await saveCentralizedState('universal_comment', universalOrderComment);
}

async function updateSelectedTable() {
    return await saveCentralizedState('selected_table', selectedTableNumber);
}

async function clearCentralizedOrder() {
    try {
        const response = await fetch('/api/state/clear_order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const data = await response.json();
        if (data.success) {
            currentOrder = [];
            currentOrderLineItemCounter = 0;
            console.log('Centralized order cleared');
            return true;
        } else {
            console.error('Failed to clear centralized order:', data.message);
            return false;
        }
    } catch (error) {
        console.error('Error clearing centralized order:', error);
        return false;
    }
}

// --- Shared Management Component Loading ---
// Management modals are now included directly in HTML files
function loadManagementComponent() {
    console.log('Management component is included directly in HTML');
    return true;
}

// --- DOM Element Cache ---
const elements = {};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM Content Loaded - Starting initialization...');

    // Load centralized state first
    console.log('Loading centralized state...');
    const stateLoaded = await loadCentralizedState();
    console.log('Centralized state loaded:', stateLoaded);

    // Initialize table management mode detection
    console.log('Initializing app mode...');
    await initializeAppMode();

    // Management component is included directly in HTML
    const componentLoaded = loadManagementComponent();
    console.log('Management component loaded:', componentLoaded);
    
    // Cache DOM elements after component is loaded
    console.log('Caching DOM elements...');
    cacheDOMElements();
    console.log('DOM elements cached. Checking critical elements:');
    console.log('categoriesContainer:', elements.categoriesContainer);
    console.log('productsContainer:', elements.productsContainer);
    console.log('Is desktop-ui class present:', document.body.classList.contains('desktop-ui'));
    
    // Re-cache modal elements specifically to ensure they're found
    if (componentLoaded) {
        console.log('Re-caching modal elements...');
        // Re-cache all login modal elements
        elements.loginModal = document.getElementById('loginModal');
        elements.loginForm = document.getElementById('loginForm');
        elements.passwordInput = document.getElementById('passwordInput');
        elements.loginError = document.getElementById('loginError');
        elements.loginSubmitBtn = document.getElementById('loginSubmitBtn');
        
        // Re-cache all management modal elements
        elements.managementModal = document.getElementById('managementModal');
        elements.itemFormModal = document.getElementById('itemFormModal');
        elements.itemFormModalTitle = document.getElementById('itemFormModalTitle');
        elements.daySummaryModal = document.getElementById('daySummaryModal');
        elements.daySummaryContent = document.getElementById('daySummaryContent');
        elements.itemOptionSelectModal = document.getElementById('itemOptionSelectModal');
        elements.optionModalItemName = document.getElementById('optionModalItemName');
        elements.optionModalItemDescription = document.getElementById('optionModalItemDescription');
        elements.optionModalOptionsContainer = document.getElementById('optionModalOptionsContainer');
        elements.confirmOptionBtn = document.getElementById('confirmOptionBtn');
        elements.itemNameInput = document.getElementById('itemName');
        elements.itemPriceInput = document.getElementById('itemPrice');
        elements.itemCategorySelect = document.getElementById('itemCategory');
        elements.itemIdInput = document.getElementById('itemId');
        elements.saveItemBtn = document.getElementById('saveItemBtn');
        elements.existingItemsListModal = document.getElementById('existingItemsListModal');
        elements.itemHasOptionsCheckboxModal = document.getElementById('itemHasOptionsModal');
        elements.itemOptionsModalContainer = document.getElementById('itemOptionsModalContainer');
        elements.itemOptionsListDisplayModal = document.getElementById('itemOptionsListDisplayModal');
        elements.newOptionNameInputModal = document.getElementById('newOptionNameInputModal');
        elements.newOptionPriceInputModal = document.getElementById('newOptionPriceInputModal');
        elements.categoryNameInput = document.getElementById('categoryName');
        elements.existingCategoriesListModal = document.getElementById('existingCategoriesListModal');
        elements.licenseStatusDisplay = document.getElementById('license-status-display');
        elements.hardwareIdDisplay = document.getElementById('hardware-id-display');
        elements.copyHwidBtn = document.getElementById('copy-hwid-btn');
        elements.footerTrialStatus = document.getElementById('footer-trial-status');
        // Language selector
        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            try {
                const res = await fetch('/api/settings/general');
                if (res.ok) {
                    const data = await res.json();
                    const lang = (data && (data.language === 'el' || data.language === 'en')) ? data.language : 'en';
                    languageSelect.value = lang;
                }
            } catch {}
            languageSelect.addEventListener('change', async (e) => {
                const val = e.target.value;
                await setLanguage(val);
            });
        }
        
        // Add event listener for login form after re-caching
        if (elements.loginForm) {
            elements.loginForm.addEventListener('submit', handleLogin);
        }
    }
    
    console.log('Initializing app state...');
    initializeAppState();
    console.log('Loading menu...');
    await loadMenu();
    console.log('Menu loaded. Current state:');
    console.log('menu:', menu);
    console.log('selectedCategory:', selectedCategory);
    console.log('Starting clock...');
    startClock();
    console.log('Initializing unified license validation...');
    FrontendLicenseManager.validateLicense();
    
    // Check for automatic activation after payment
    console.log('Checking for automatic license activation...');
    await checkAutomaticActivation();
    if (elements.universalOrderCommentInput) {
        elements.universalOrderCommentInput.addEventListener('input', async (e) => {
            universalOrderComment = e.target.value;
            await updateUniversalComment();
        });
    }
    if (elements.paidByCardCheckbox) {
        elements.paidByCardCheckbox.addEventListener('change', (e) => {
            isPaidByCard = e.target.checked;
        });
    }
    if (elements.headerTableInput) {
        elements.headerTableInput.addEventListener('change', handleTableNumberChange);
        elements.headerTableInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleTableNumberChange(e);
                e.target.blur();
            }
        });
    }
    if(document.getElementById('universalOrderCommentInput_desktop')) {
         document.getElementById('universalOrderCommentInput_desktop').addEventListener('input', async (e) => {
            universalOrderComment = e.target.value;
            await updateUniversalComment();
        });
    }
    console.log('Updating order display...');
    updateOrderDisplay();
    
    // Initialize portal return handling
    console.log('Initializing portal return handling...');
    initializePortalReturnHandling();
    
    console.log('Initialization complete!');
});


function cacheDOMElements() {
    console.log('cacheDOMElements called');
    
    // --- POSPal UI Elements ---
    elements.headerOrderNumber = document.getElementById('header-order-number');
    elements.headerTableInput = document.getElementById('header-table-input');
    elements.headerTableContainer = document.getElementById('header-table-container');
    elements.realtimeClock = document.getElementById('realtime-clock');
    elements.mobileOrderToggle = document.getElementById('mobile-order-toggle');
    elements.mobileOrderCountBadge = document.getElementById('mobile-order-count-badge');
    elements.orderPanel = document.getElementById('order-panel');
    elements.orderPanelBackdrop = document.getElementById('order-panel-backdrop');
    elements.numpadContainer = document.getElementById('numpad-container');
    elements.numpadItemNameDisplay = document.getElementById('numpad-item-name');
    elements.paidByCardCheckbox = document.getElementById('paidByCardCheckbox');

    // --- Desktop UI Elements ---
    elements.orderNumber_desktop = document.getElementById('order-number-desktop');

    // --- Universal/Shared Elements (must have same IDs in both HTML files) ---
    elements.categoriesContainer = document.getElementById('categories');
    elements.productsContainer = document.getElementById('products');
    elements.orderItemsContainer = document.getElementById('order-items-container');
    elements.emptyOrderMessage = document.getElementById('empty-order-message');
    elements.orderTotalDisplay = document.getElementById('order-total');
    elements.universalOrderCommentInput = document.getElementById('universalOrderCommentInput');
    elements.sendOrderBtn = document.getElementById('sendOrderBtn');
    elements.settingsGearContainer = document.getElementById('settings-gear-container');
    elements.toast = document.getElementById('toast');
    elements.toastMessage = document.getElementById('toast-message');
    elements.todaysOrdersList = document.getElementById('todaysOrdersList');
    elements.appVersionContainer = document.getElementById('appVersionContainer');
    elements.appVersion = document.getElementById('appVersion');

    // --- Modals (must have same structure and IDs in both HTML files) ---
    elements.loginModal = document.getElementById('loginModal');
    elements.loginForm = document.getElementById('loginForm');
    elements.passwordInput = document.getElementById('passwordInput');
    elements.loginError = document.getElementById('loginError');
    elements.loginSubmitBtn = document.getElementById('loginSubmitBtn');
    

    elements.managementModal = document.getElementById('managementModal');
    elements.itemFormModal = document.getElementById('itemFormModal');
    elements.itemFormModalTitle = document.getElementById('itemFormModalTitle');
    elements.daySummaryModal = document.getElementById('daySummaryModal');
    elements.daySummaryContent = document.getElementById('daySummaryContent');
    elements.itemOptionSelectModal = document.getElementById('itemOptionSelectModal');
    elements.optionModalItemName = document.getElementById('optionModalItemName');
    elements.optionModalItemDescription = document.getElementById('optionModalItemDescription');
    elements.optionModalOptionsContainer = document.getElementById('optionModalOptionsContainer');
    elements.confirmOptionBtn = document.getElementById('confirmOptionBtn');
    elements.itemNameInput = document.getElementById('itemName');
    elements.itemPriceInput = document.getElementById('itemPrice');
    elements.itemCategorySelect = document.getElementById('itemCategory');
    elements.itemIdInput = document.getElementById('itemId');
    elements.saveItemBtn = document.getElementById('saveItemBtn');
    elements.existingItemsListModal = document.getElementById('existingItemsListModal');
    elements.itemHasOptionsCheckboxModal = document.getElementById('itemHasOptionsModal');
    elements.itemOptionsModalContainer = document.getElementById('itemOptionsModalContainer');
    elements.itemOptionsListDisplayModal = document.getElementById('itemOptionsListDisplayModal');
    elements.newOptionNameInputModal = document.getElementById('newOptionNameInputModal');
    elements.newOptionPriceInputModal = document.getElementById('newOptionPriceInputModal');
    elements.categoryNameInput = document.getElementById('categoryName');
    elements.existingCategoriesListModal = document.getElementById('existingCategoriesListModal');
    elements.licenseStatusDisplay = document.getElementById('license-status-display');
    elements.hardwareIdDisplay = document.getElementById('hardware-id-display');
    elements.copyHwidBtn = document.getElementById('copy-hwid-btn');
    elements.footerTrialStatus = document.getElementById('footer-trial-status');
    
    console.log('Critical elements found:');
    console.log('categoriesContainer:', elements.categoriesContainer);
    console.log('productsContainer:', elements.productsContainer);
    console.log('orderItemsContainer:', elements.orderItemsContainer);
}

// ==================================================================================
// TABLE MANAGEMENT SYSTEM - Phase 3 Implementation
// ==================================================================================

/**
 * Initialize app mode detection and table management features
 */
async function initializeAppMode() {
    try {
        // Fetch configuration from backend
        const response = await fetch('/api/config');
        const config = await response.json();

        tableManagementEnabled = config.table_management_enabled || false;

        console.log('App mode initialized:', tableManagementEnabled ? 'Table Mode' : 'Simple Mode');

        if (tableManagementEnabled) {
            // Enable table mode
            document.body.classList.add('table-mode');
            document.body.classList.remove('simple-mode');
            await initializeTableFeatures();
        } else {
            // Enable simple mode
            document.body.classList.add('simple-mode');
            document.body.classList.remove('table-mode');
            initializeSimpleMode();
        }

        // Update UI based on mode
        updateModeSpecificUI();

    } catch (error) {
        console.error('Failed to initialize app mode:', error);
        // Default to simple mode on error
        document.body.classList.add('simple-mode');
        document.body.classList.remove('table-mode');
        initializeSimpleMode();
    }
}

/**
 * Initialize table management features
 */
async function initializeTableFeatures() {
    console.log('Initializing table management features...');

    try {
        // Load initial table data
        await loadTableConfiguration();
        await loadTableSessions();

        // Set up real-time updates
        setupTableSSEUpdates();

        // Initialize table UI components
        initializeTableUI();

        // Initialize mobile navigation
        updateMobileTabDisplay();

        console.log('Table management features initialized successfully');

    } catch (error) {
        console.error('Failed to initialize table features:', error);
        showToast('Failed to load table management. Some features may not work.', 'error');
    }
}

/**
 * Initialize simple mode (no table management)
 */
function initializeSimpleMode() {
    console.log('Initializing simple mode...');
    // Hide all table-related UI elements
    const tableElements = document.querySelectorAll('.table-mode-only');
    tableElements.forEach(el => el.style.display = 'none');

    // Show simple mode elements
    const simpleElements = document.querySelectorAll('.simple-mode-only');
    simpleElements.forEach(el => el.style.display = 'block');
}

/**
 * Load table configuration from backend
 */
async function loadTableConfiguration() {
    try {
        const response = await fetch('/api/tables');
        const data = await response.json();

        if (data.status === 'success') {
            tableConfig = data.tables;
            console.log('Table configuration loaded:', tableConfig);
        } else {
            throw new Error(data.message || 'Failed to load table configuration');
        }
    } catch (error) {
        console.error('Error loading table configuration:', error);
        throw error;
    }
}

/**
 * Load current table sessions
 */
async function loadTableSessions() {
    try {
        const response = await fetch('/api/tables');
        const data = await response.json();

        if (data.status === 'success') {
            tableSessions = data.sessions || {};
            console.log('Table sessions loaded:', tableSessions);
        } else {
            throw new Error(data.message || 'Failed to load table sessions');
        }
    } catch (error) {
        console.error('Error loading table sessions:', error);
        throw error;
    }
}

/**
 * Initialize table UI components
 */
function initializeTableUI() {
    // Create table selection modal if it doesn't exist
    createTableSelectionModal();

    // Create table management modal if it doesn't exist
    createTableManagementModal();

    // Update table display
    updateTableDisplay();

    // Replace simple table input with visual selector
    setupTableSelectionUI();
}

/**
 * Create table selection modal
 */
function createTableSelectionModal() {
    // Check if modal already exists
    if (document.getElementById('tableSelectionModal')) return;

    const modalHTML = `
        <div id="tableSelectionModal" class="table-mode-only fixed inset-0 bg-black bg-opacity-70 z-[90] hidden items-center justify-center p-4">
            <div class="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[95vh] flex flex-col">
                <!-- Enhanced Header with Party Size Selector -->
                <div class="p-4 border-b border-gray-300">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-semibold">Select Table</h2>
                        <button onclick="closeTableSelectionModal()" class="text-gray-500 hover:text-black transition-colors">
                            <i class="fas fa-times text-2xl"></i>
                        </button>
                    </div>

                    <!-- Party Size Selector -->
                    <div class="flex items-center space-x-4 mb-4">
                        <label class="text-sm font-medium text-gray-700">Party Size:</label>
                        <div class="flex items-center bg-gray-100 rounded-lg overflow-hidden">
                            <button onclick="adjustPartySize(-1)" class="px-3 py-2 bg-gray-200 hover:bg-gray-300 transition-colors" id="partySizeDecrement">
                                <i class="fas fa-minus text-sm"></i>
                            </button>
                            <input type="number" id="partySizeInput" value="2" min="1" max="20"
                                   class="w-16 text-center py-2 bg-gray-100 border-none focus:outline-none font-medium"
                                   onchange="updateTableSuggestions()">
                            <button onclick="adjustPartySize(1)" class="px-3 py-2 bg-gray-200 hover:bg-gray-300 transition-colors" id="partySizeIncrement">
                                <i class="fas fa-plus text-sm"></i>
                            </button>
                        </div>
                        <div id="suggestionStatus" class="text-sm text-gray-600"></div>
                    </div>

                    <!-- Filter and Search Bar -->
                    <div class="flex flex-wrap gap-3 items-center">
                        <div class="flex-1 min-w-60">
                            <div class="relative">
                                <input type="text" id="tableSearchInput" placeholder="Search tables by number or name..."
                                       class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                       oninput="filterTables()">
                                <i class="fas fa-search absolute left-3 top-3 text-gray-400"></i>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="filterTablesByStatus('all')" class="px-3 py-2 text-xs border rounded-lg transition-colors"
                                    id="filterAll" data-filter="all">All</button>
                            <button onclick="filterTablesByStatus('available')" class="px-3 py-2 text-xs border rounded-lg transition-colors"
                                    id="filterAvailable" data-filter="available">Available</button>
                            <button onclick="filterTablesByStatus('occupied')" class="px-3 py-2 text-xs border rounded-lg transition-colors"
                                    id="filterOccupied" data-filter="occupied">Occupied</button>
                        </div>
                    </div>
                </div>

                <!-- Loading State -->
                <div id="tableLoadingState" class="hidden p-8 text-center">
                    <div class="inline-flex items-center space-x-3">
                        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                        <span class="text-gray-600">Loading table suggestions...</span>
                    </div>
                </div>

                <!-- Table Grid Container -->
                <div class="flex-grow overflow-y-auto p-4">
                    <!-- Suggestions Section -->
                    <div id="suggestionsSection" class="hidden mb-6">
                        <h3 class="text-lg font-medium mb-3 text-green-700">
                            <i class="fas fa-lightbulb mr-2"></i>Recommended Tables
                        </h3>
                        <div id="suggestedTables" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-4">
                            <!-- Suggested table cards will be populated here -->
                        </div>
                        <hr class="border-gray-200 mb-4">
                    </div>

                    <!-- All Tables Section -->
                    <div>
                        <h3 id="allTablesHeader" class="text-lg font-medium mb-3 text-gray-700">All Tables</h3>
                        <div id="tableGrid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            <!-- Table cards will be populated here -->
                        </div>
                    </div>

                    <!-- No Results Message -->
                    <div id="noTablesMessage" class="hidden text-center py-8 text-gray-500">
                        <i class="fas fa-search text-3xl mb-3 opacity-50"></i>
                        <p>No tables found matching your criteria</p>
                    </div>
                </div>

                <!-- Footer with Quick Actions -->
                <div class="p-4 border-t border-gray-200 bg-gray-50">
                    <div class="flex justify-between items-center text-sm text-gray-600">
                        <div id="tableStats" class="flex space-x-4">
                            <span>Total: <span id="totalTables">0</span></span>
                            <span>Available: <span id="availableTables">0</span></span>
                            <span>Occupied: <span id="occupiedTables">0</span></span>
                        </div>
                        <button onclick="refreshTableDisplay()" class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                            <i class="fas fa-sync-alt mr-1"></i>Refresh
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Initialize filter state
    setActiveFilter('all');
}

/**
 * Create table management modal
 */
function createTableManagementModal() {
    // Check if modal already exists
    if (document.getElementById('tableManagementModal')) return;

    const modalHTML = `
        <div id="tableManagementModal" class="table-mode-only fixed inset-0 bg-black bg-opacity-70 z-[90] hidden items-center justify-center p-4">
            <div class="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col">
                <div class="p-4 border-b border-gray-300 flex justify-between items-center">
                    <h2 class="text-xl font-semibold">Table <span id="tableManagementNumber"></span></h2>
                    <button onclick="closeTableManagementModal()" class="text-gray-500 hover:text-black">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="p-4 space-y-4">
                    <div id="tableManagementInfo" class="bg-gray-50 p-3 rounded-md">
                        <div class="text-sm text-gray-600">Status: <span id="tableStatusDisplay"></span></div>
                        <div class="text-sm text-gray-600">Current Total: <span id="tableCurrentTotal">€0.00</span></div>
                        <div class="text-sm text-gray-600">Active Orders: <span id="tableActiveOrders">0</span></div>
                    </div>
                    <div class="space-y-2">
                        <button onclick="addOrderToTable()" class="w-full py-2 px-4 btn-primary">
                            <i class="fas fa-plus mr-2"></i>Add Order
                        </button>
                        <button onclick="viewTableBill()" class="w-full py-2 px-4 btn-secondary">
                            <i class="fas fa-receipt mr-2"></i>View Bill
                        </button>
                        <button onclick="closeTable()" class="w-full py-2 px-4 btn-success">
                            <i class="fas fa-check mr-2"></i>Close Table
                        </button>
                        <button onclick="clearTable()" class="w-full py-2 px-4 btn-danger">
                            <i class="fas fa-eraser mr-2"></i>Clear Table
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Add event listeners for escape key and backdrop click
    const modal = document.getElementById('tableManagementModal');
    if (modal) {
        // Escape key support
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                closeTableManagementModal();
            }
        });

        // Backdrop click support - click on the modal overlay, not the content
        modal.addEventListener('click', function(e) {
            if (e.target === modal) { // Only if clicking the backdrop, not modal content
                closeTableManagementModal();
            }
        });
    }
}

/**
 * Update table status summary in header
 */
function updateTableStatusSummary() {
    if (!tableManagementEnabled || !tableConfig) return;

    const totalTables = Object.keys(tableConfig).length;
    let occupiedCount = 0;
    let totalRevenue = 0;

    Object.keys(tableConfig).forEach(tableId => {
        const session = tableSessions[tableId] || {};
        if (session.total && session.total > 0) {
            occupiedCount++;
            totalRevenue += session.total;
        }
    });

    const availableCount = totalTables - occupiedCount;

    // Update header summary
    const summaryEl = document.getElementById('tableStatusSummary');
    if (summaryEl) {
        summaryEl.innerHTML = `${occupiedCount}/${totalTables} occupied • €${totalRevenue.toFixed(2)} total`;
    }

    // Update modal stats
    const totalTablesEl = document.getElementById('totalTables');
    const availableTablesEl = document.getElementById('availableTables');
    const occupiedTablesEl = document.getElementById('occupiedTables');

    if (totalTablesEl) totalTablesEl.textContent = totalTables;
    if (availableTablesEl) availableTablesEl.textContent = availableCount;
    if (occupiedTablesEl) occupiedTablesEl.textContent = occupiedCount;
}

/**
 * Update table display with current table data
 */
function updateTableDisplay(searchTerm = '') {
    if (!tableManagementEnabled || !tableConfig) return;

    const tableGrid = document.getElementById('tableGrid');
    if (!tableGrid) return;

    tableGrid.innerHTML = '';

    const currentFilter = window.currentTableFilter || 'all';
    const partySize = parseInt(document.getElementById('partySizeInput')?.value) || 2;
    let visibleTables = 0;

    Object.keys(tableConfig).forEach(tableId => {
        const table = tableConfig[tableId];
        const session = tableSessions[tableId] || {};
        const status = session.total > 0 ? 'occupied' : 'available';

        // Apply filters
        if (currentFilter !== 'all' && currentFilter !== status) return;

        // Apply search filter
        if (searchTerm && !tableId.toLowerCase().includes(searchTerm) &&
            !(table.name && table.name.toLowerCase().includes(searchTerm))) {
            return;
        }

        visibleTables++;
        const card = createTableCard(tableId, table, session, false);
        tableGrid.appendChild(card);
    });

    // Show/hide no results message
    const noResultsMsg = document.getElementById('noTablesMessage');
    if (noResultsMsg) {
        if (visibleTables === 0) {
            noResultsMsg.classList.remove('hidden');
        } else {
            noResultsMsg.classList.add('hidden');
        }
    }

    // Update status summary
    updateTableStatusSummary();
}

/**
 * Create enhanced table card with match quality indicators
 */
function createTableCard(tableId, table, session, isSuggestion = false, matchQuality = null, reason = '') {
    const total = session.total || 0;
    const orderCount = session.orders ? session.orders.length : 0;
    const status = total > 0 ? 'occupied' : 'available';
    const capacity = table.capacity || table.seats || 4;
    const lastActivity = session.lastActivity ? new Date(session.lastActivity) : null;

    const tableCard = document.createElement('div');
    tableCard.className = `table-card ${status} p-4 rounded-lg border-2 cursor-pointer hover:shadow-lg transition-all`;
    tableCard.dataset.tableId = tableId;
    tableCard.setAttribute('tabindex', '0');

    // Apply base styling
    if (status === 'available') {
        tableCard.classList.add('border-green-300', 'bg-green-50', 'hover:bg-green-100');
    } else {
        tableCard.classList.add('border-red-300', 'bg-red-50', 'hover:bg-red-100');
    }

    // Apply match quality styling for suggestions
    if (isSuggestion && matchQuality) {
        tableCard.classList.remove('border-green-300', 'bg-green-50', 'hover:bg-green-100');

        switch (matchQuality) {
            case 'perfect':
                tableCard.classList.add('border-green-500', 'bg-green-100', 'hover:bg-green-200', 'ring-2', 'ring-green-200');
                break;
            case 'good':
                tableCard.classList.add('border-yellow-400', 'bg-yellow-50', 'hover:bg-yellow-100', 'ring-1', 'ring-yellow-200');
                break;
            case 'acceptable':
                tableCard.classList.add('border-orange-400', 'bg-orange-50', 'hover:bg-orange-100', 'ring-1', 'ring-orange-200');
                break;
        }
    }

    // Calculate occupancy percentage for visual indicator
    const occupancyPercent = status === 'occupied' && capacity > 0 ? Math.min(100, (orderCount / capacity) * 100) : 0;

    tableCard.innerHTML = `
        <div class="text-center relative">
            ${isSuggestion && matchQuality ? `
                <div class="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                    matchQuality === 'perfect' ? 'bg-green-500' :
                    matchQuality === 'good' ? 'bg-yellow-500' : 'bg-orange-500'
                }">
                    ${matchQuality === 'perfect' ? '🎯' : matchQuality === 'good' ? '👍' : '✓'}
                </div>
            ` : ''}

            <div class="text-2xl font-bold text-gray-800 mb-1">${tableId}</div>

            ${table.name ? `<div class="text-xs text-gray-500 mb-1">${table.name}</div>` : ''}

            <div class="text-sm font-medium ${status === 'available' ? 'text-green-700' : 'text-red-700'} mb-1">
                ${status === 'available' ? 'Available' : `€${total.toFixed(2)}`}
            </div>

            <!-- Capacity and Activity Info -->
            <div class="text-xs text-gray-600 space-y-1">
                <div class="flex items-center justify-center space-x-1">
                    <i class="fas fa-users text-gray-400"></i>
                    <span>${capacity} seats</span>
                    ${status === 'occupied' ? `<span class="text-gray-400">•</span><span>${orderCount} order${orderCount !== 1 ? 's' : ''}</span>` : ''}
                </div>

                ${status === 'occupied' && capacity > 0 ? `
                    <div class="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                        <div class="bg-red-400 h-1.5 rounded-full transition-all" style="width: ${occupancyPercent}%"></div>
                    </div>
                ` : ''}

                ${lastActivity ? `
                    <div class="text-gray-400">
                        <i class="fas fa-clock text-xs"></i>
                        <span>${formatLastActivity(lastActivity)}</span>
                    </div>
                ` : ''}

                ${isSuggestion && reason ? `
                    <div class="text-xs font-medium mt-2 ${
                        matchQuality === 'perfect' ? 'text-green-700' :
                        matchQuality === 'good' ? 'text-yellow-700' : 'text-orange-700'
                    }">
                        ${reason}
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    // Add click handler
    tableCard.addEventListener('click', () => {
        if (status === 'available') {
            selectTableForNewOrder(tableId);
        } else {
            showTableManagementModal(tableId);
        }
    });

    // Add keyboard support
    tableCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            tableCard.click();
        }
    });

    return tableCard;
}

/**
 * Format last activity time
 */
function formatLastActivity(date) {
    const now = new Date();
    const diffMinutes = Math.floor((now - date) / 60000);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString();
}

/**
 * Setup table selection UI to replace simple input
 */
function setupTableSelectionUI() {
    if (!tableManagementEnabled) return;

    const headerTableContainer = document.getElementById('header-table-container');
    if (headerTableContainer) {
        headerTableContainer.addEventListener('click', () => {
            showTableSelectionModal();
        });

        // Make it look more like a button
        headerTableContainer.style.cursor = 'pointer';
        headerTableContainer.title = 'Click to select table';

        // Hide the input cursor
        const headerTableInput = document.getElementById('header-table-input');
        if (headerTableInput) {
            headerTableInput.style.cursor = 'pointer';
            headerTableInput.readOnly = true;
        }
    }
}

/**
 * Setup Server-Sent Events for real-time table updates
 */
function setupTableSSEUpdates() {
    if (!tableManagementEnabled) return;

    // Listen for table updates through existing SSE connection
    if (window.evtSource) {
        window.evtSource.addEventListener('table_updated', function(e) {
            try {
                const data = JSON.parse(e.data);
                handleTableUpdate(data);
            } catch (error) {
                console.error('Error parsing table update:', error);
            }
        });

        console.log('Table SSE updates configured');
    }
}

/**
 * Handle real-time table updates
 */
function handleTableUpdate(data) {
    const { table_id, total, orders, status } = data;

    // Update local table sessions
    if (!tableSessions[table_id]) {
        tableSessions[table_id] = {};
    }
    tableSessions[table_id].total = total;
    tableSessions[table_id].orders = orders;
    tableSessions[table_id].status = status;

    // Update table display
    updateTableCardDisplay(table_id, total, orders);

    // Update status summary
    updateTableStatusSummary();

    console.log(`Table ${table_id} updated: €${total.toFixed(2)}, ${orders.length} orders`);
}

/**
 * Update specific table card in real-time
 */
function updateTableCardDisplay(tableId, total, orders) {
    const tableCard = document.querySelector(`[data-table-id="${tableId}"]`);
    if (!tableCard) return;

    const status = total > 0 ? 'occupied' : 'available';
    const orderCount = orders.length;

    // Update classes
    tableCard.className = `table-card ${status} p-4 rounded-lg border-2 cursor-pointer hover:shadow-lg transition-all`;
    if (status === 'available') {
        tableCard.classList.add('border-green-300', 'bg-green-50', 'hover:bg-green-100');
    } else {
        tableCard.classList.add('border-red-300', 'bg-red-50', 'hover:bg-red-100');
    }

    // Update content
    const statusDisplay = tableCard.querySelector('.text-sm.font-medium');
    const infoDisplay = tableCard.querySelector('.text-xs.text-gray-600');

    if (statusDisplay) {
        statusDisplay.textContent = status === 'available' ? 'Available' : `€${total.toFixed(2)}`;
        statusDisplay.className = `text-sm font-medium ${status === 'available' ? 'text-green-700' : 'text-red-700'} mb-1`;
    }

    if (infoDisplay) {
        const table = tableConfig[tableId];
        infoDisplay.textContent = status === 'available' ?
            `${table?.seats || 4} seats` :
            `${orderCount} order${orderCount !== 1 ? 's' : ''}`;
    }
}

/**
 * Update mode-specific UI elements
 */
function updateModeSpecificUI() {
    // Show/hide elements based on mode
    const tableOnlyElements = document.querySelectorAll('.table-mode-only');
    const simpleOnlyElements = document.querySelectorAll('.simple-mode-only');

    if (tableManagementEnabled) {
        tableOnlyElements.forEach(el => {
            // Skip modals - they should be controlled by their own show/hide functions
            if (el.classList.contains('fixed') && el.classList.contains('inset-0')) {
                return; // This is likely a modal, don't override its display
            }
            el.style.display = 'block';
        });
        simpleOnlyElements.forEach(el => el.style.display = 'none');
    } else {
        tableOnlyElements.forEach(el => {
            // Skip modals - they should be controlled by their own show/hide functions
            if (el.classList.contains('fixed') && el.classList.contains('inset-0')) {
                return; // This is likely a modal, don't override its display
            }
            el.style.display = 'none';
        });
        simpleOnlyElements.forEach(el => el.style.display = 'block');
    }
}

// ==================================================================================
// TABLE MANAGEMENT UI FUNCTIONS
// ==================================================================================

/**
 * Show table selection modal
 */
function showTableSelectionModal() {
    if (!tableManagementEnabled) return;

    updateTableDisplay();
    const modal = document.getElementById('tableSelectionModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

/**
 * Close table selection modal
 */
function closeTableSelectionModal() {
    const modal = document.getElementById('tableSelectionModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

/**
 * Adjust party size in table selection modal
 */
function adjustPartySize(increment) {
    const input = document.getElementById('partySizeInput');
    if (!input) return;

    const currentValue = parseInt(input.value) || 2;
    const newValue = Math.max(1, Math.min(20, currentValue + increment));

    input.value = newValue;
    updateTableSuggestions();
}

/**
 * Update table suggestions based on party size
 */
async function updateTableSuggestions() {
    const partySize = parseInt(document.getElementById('partySizeInput')?.value) || 2;
    const statusElement = document.getElementById('suggestionStatus');
    const loadingElement = document.getElementById('tableLoadingState');
    const suggestionsSection = document.getElementById('suggestionsSection');
    const suggestedTablesGrid = document.getElementById('suggestedTables');

    if (!tableManagementEnabled || !tableConfig) return;

    // Show loading state
    if (loadingElement) loadingElement.classList.remove('hidden');
    if (statusElement) statusElement.textContent = 'Finding best tables...';

    try {
        // Simulate API call to get suggestions
        const suggestions = await getTableSuggestions(partySize);

        if (suggestions && suggestions.length > 0) {
            // Display suggestions
            displayTableSuggestions(suggestions);
            if (statusElement) statusElement.textContent = `${suggestions.length} recommended table${suggestions.length > 1 ? 's' : ''} found`;
            if (suggestionsSection) suggestionsSection.classList.remove('hidden');
        } else {
            if (statusElement) statusElement.textContent = 'No specific recommendations';
            if (suggestionsSection) suggestionsSection.classList.add('hidden');
        }

        // Update all tables display with match indicators
        updateTableDisplay();

    } catch (error) {
        console.error('Error getting table suggestions:', error);
        if (statusElement) statusElement.textContent = 'Unable to load suggestions';
        if (suggestionsSection) suggestionsSection.classList.add('hidden');
    } finally {
        if (loadingElement) loadingElement.classList.add('hidden');
    }
}

/**
 * Get table suggestions for party size
 */
async function getTableSuggestions(partySize) {
    if (!tableConfig) return [];

    const suggestions = [];

    Object.keys(tableConfig).forEach(tableId => {
        const table = tableConfig[tableId];
        const session = tableSessions[tableId] || {};
        const isAvailable = !session.total || session.total === 0;

        if (!isAvailable) return; // Only suggest available tables

        const capacity = table.capacity || 4;
        let matchQuality = 'none';
        let score = 0;

        // Calculate match quality
        if (capacity === partySize) {
            matchQuality = 'perfect';
            score = 100;
        } else if (capacity >= partySize && capacity <= partySize + 2) {
            matchQuality = 'good';
            score = 80 - Math.abs(capacity - partySize) * 5;
        } else if (capacity >= partySize) {
            matchQuality = 'acceptable';
            score = 60 - Math.abs(capacity - partySize) * 2;
        }

        if (matchQuality !== 'none') {
            suggestions.push({
                table_id: tableId,
                table: table,
                match_quality: matchQuality,
                score: score,
                capacity: capacity,
                reason: getMatchReason(partySize, capacity, matchQuality)
            });
        }
    });

    // Sort by score (best matches first)
    suggestions.sort((a, b) => b.score - a.score);

    return suggestions.slice(0, 8); // Return top 8 suggestions
}

/**
 * Get reason text for match quality
 */
function getMatchReason(partySize, capacity, matchQuality) {
    switch (matchQuality) {
        case 'perfect': return `Perfect fit for ${partySize} people`;
        case 'good': return `Good option (${capacity} seats)`;
        case 'acceptable': return `Available (${capacity} seats)`;
        default: return '';
    }
}

/**
 * Display table suggestions in the suggestions grid
 */
function displayTableSuggestions(suggestions) {
    const grid = document.getElementById('suggestedTables');
    if (!grid) return;

    grid.innerHTML = '';

    suggestions.forEach(suggestion => {
        const { table_id, table, match_quality, reason } = suggestion;
        const session = tableSessions[table_id] || {};

        const card = createTableCard(table_id, table, session, true, match_quality, reason);
        grid.appendChild(card);
    });
}

/**
 * Filter tables by search term
 */
function filterTables() {
    const searchTerm = document.getElementById('tableSearchInput')?.value.toLowerCase() || '';
    updateTableDisplay(searchTerm);
}

/**
 * Filter tables by status
 */
function filterTablesByStatus(status) {
    setActiveFilter(status);
    updateTableDisplay();
}

/**
 * Set active filter button
 */
function setActiveFilter(status) {
    // Remove active class from all filter buttons
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'text-white');
        btn.classList.add('bg-white', 'text-gray-700', 'border-gray-300');
    });

    // Add active class to selected filter
    const activeButton = document.getElementById(`filter${status.charAt(0).toUpperCase() + status.slice(1)}`);
    if (activeButton) {
        activeButton.classList.remove('bg-white', 'text-gray-700', 'border-gray-300');
        activeButton.classList.add('bg-blue-600', 'text-white');
    }

    // Store current filter
    window.currentTableFilter = status;
}

/**
 * Refresh table display
 */
async function refreshTableDisplay() {
    const refreshBtn = document.querySelector('[onclick="refreshTableDisplay()"]');
    if (refreshBtn) {
        const icon = refreshBtn.querySelector('i');
        if (icon) icon.classList.add('fa-spin');
    }

    try {
        // Refresh table data from server
        await loadTableData();
        updateTableDisplay();
        updateTableSuggestions();
        showToast('Tables refreshed', 'success');
    } catch (error) {
        console.error('Error refreshing tables:', error);
        showToast('Failed to refresh tables', 'error');
    } finally {
        if (refreshBtn) {
            const icon = refreshBtn.querySelector('i');
            if (icon) icon.classList.remove('fa-spin');
        }
    }
}

/**
 * Select table for new order
 */
function selectTableForNewOrder(tableId) {
    selectedTableNumber = tableId;

    // Update header input
    const headerTableInput = document.getElementById('header-table-input');
    if (headerTableInput) {
        headerTableInput.value = tableId;
    }

    // Save to state
    updateSelectedTable();

    // Close modal
    closeTableSelectionModal();

    console.log(`Selected table ${tableId} for new order`);
}

/**
 * Show table management modal
 */
function showTableManagementModal(tableId) {
    selectedTableForAction = tableId;
    const session = tableSessions[tableId] || {};

    // Update modal content
    document.getElementById('tableManagementNumber').textContent = tableId;
    document.getElementById('tableStatusDisplay').textContent = session.total > 0 ? 'Occupied' : 'Available';
    document.getElementById('tableCurrentTotal').textContent = `€${(session.total || 0).toFixed(2)}`;
    document.getElementById('tableActiveOrders').textContent = session.orders ? session.orders.length : 0;

    // Show modal
    const modal = document.getElementById('tableManagementModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

/**
 * Close table management modal
 */
function closeTableManagementModal() {
    selectedTableForAction = null;
    const modal = document.getElementById('tableManagementModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        // Remove any inline styles that might interfere with hiding
        modal.style.display = '';
    }
}

/**
 * Add order to selected table
 */
function addOrderToTable() {
    if (!selectedTableForAction) return;

    // Set the table for the current order
    selectedTableNumber = selectedTableForAction;
    const headerTableInput = document.getElementById('header-table-input');
    if (headerTableInput) {
        headerTableInput.value = selectedTableForAction;
    }
    updateSelectedTable();

    // Close modals
    closeTableManagementModal();
    closeTableSelectionModal();

    showToast(`Ready to add order to Table ${selectedTableForAction}`, 'success');
}

/**
 * View table bill
 */
async function viewTableBill() {
    if (!selectedTableForAction) return;

    try {
        const response = await fetch(`/api/tables/${selectedTableForAction}/bill`);
        const data = await response.json();

        if (data.status === 'success') {
            showTableBillModal(data.bill);
        } else {
            showToast(data.message || 'Failed to load table bill', 'error');
        }
    } catch (error) {
        console.error('Error loading table bill:', error);
        showToast('Failed to load table bill', 'error');
    }
}

/**
 * Close table (mark as paid)
 */
async function closeTable() {
    if (!selectedTableForAction) return;

    if (!confirm(`Close Table ${selectedTableForAction}? This will mark it as paid.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/tables/${selectedTableForAction}/close`, {
            method: 'POST'
        });
        const data = await response.json();

        if (data.status === 'success') {
            showToast(`Table ${selectedTableForAction} closed successfully`, 'success');
            closeTableManagementModal();
            // Refresh table display
            await loadTableSessions();
            updateTableDisplay();
        } else {
            showToast(data.message || 'Failed to close table', 'error');
        }
    } catch (error) {
        console.error('Error closing table:', error);
        showToast('Failed to close table', 'error');
    }
}

/**
 * Clear table for next customers
 */
async function clearTable() {
    if (!selectedTableForAction) return;

    if (!confirm(`Clear Table ${selectedTableForAction}? This will remove all orders and reset the table.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/tables/${selectedTableForAction}/clear`, {
            method: 'POST'
        });
        const data = await response.json();

        if (data.status === 'success') {
            showToast(`Table ${selectedTableForAction} cleared successfully`, 'success');
            closeTableManagementModal();
            // Refresh table display
            await loadTableSessions();
            updateTableDisplay();
        } else {
            showToast(data.message || 'Failed to clear table', 'error');
        }
    } catch (error) {
        console.error('Error clearing table:', error);
        showToast('Failed to clear table', 'error');
    }
}

/**
 * Show table bill in modal
 */
function showTableBillModal(billData) {
    // Create bill modal if it doesn't exist
    if (!document.getElementById('tableBillModal')) {
        const modalHTML = `
            <div id="tableBillModal" class="fixed inset-0 bg-black bg-opacity-70 z-[95] hidden items-center justify-center p-4">
                <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                    <div class="p-4 border-b border-gray-300 flex justify-between items-center">
                        <h2 class="text-xl font-semibold">Table Bill</h2>
                        <button onclick="closeTableBillModal()" class="text-gray-500 hover:text-black">
                            <i class="fas fa-times text-2xl"></i>
                        </button>
                    </div>
                    <div class="flex-grow overflow-y-auto p-4" id="tableBillContent">
                        <!-- Bill content will be populated here -->
                    </div>
                    <div class="p-4 border-t border-gray-300">
                        <button onclick="closeTableBillModal()" class="w-full py-2 px-4 btn-secondary">Close</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    // Populate bill content
    const billContent = document.getElementById('tableBillContent');
    if (billContent) {
        billContent.innerHTML = `
            <div class="space-y-4">
                <div class="text-center border-b pb-4">
                    <h3 class="text-lg font-bold">Table ${billData.table_id}</h3>
                    <p class="text-gray-600">${new Date().toLocaleDateString()}</p>
                </div>

                <div class="space-y-3">
                    ${billData.orders.map(order => `
                        <div class="border-b pb-3">
                            <div class="flex justify-between items-center mb-2">
                                <span class="font-medium">Order #${order.order_number}</span>
                                <span class="text-sm text-gray-600">${order.timestamp}</span>
                            </div>
                            <div class="space-y-1 ml-4">
                                ${order.items.map(item => `
                                    <div class="flex justify-between text-sm">
                                        <span>${item.quantity}x ${item.name}${item.options ? ` (${item.options})` : ''}</span>
                                        <span>€${(item.quantity * item.price).toFixed(2)}</span>
                                    </div>
                                `).join('')}
                            </div>
                            <div class="flex justify-between font-medium mt-2 pt-2 border-t">
                                <span>Order Total:</span>
                                <span>€${order.total.toFixed(2)}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div class="border-t pt-4">
                    <div class="flex justify-between text-xl font-bold">
                        <span>Table Total:</span>
                        <span>€${billData.total.toFixed(2)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    // Show modal
    const modal = document.getElementById('tableBillModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

/**
 * Close table bill modal
 */
function closeTableBillModal() {
    const modal = document.getElementById('tableBillModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// ==================================================================================
// TABLE MOBILE NAVIGATION SYSTEM
// ==================================================================================

let currentMobileTab = 'menu'; // 'menu', 'tables', 'orders'

/**
 * Switch to menu tab on mobile
 */
function switchToMenuTab() {
    if (!tableManagementEnabled) return;

    currentMobileTab = 'menu';
    updateMobileTabDisplay();

    // Show main content, hide table selection
    document.getElementById('main-content').style.display = 'block';
    const tableModal = document.getElementById('tableSelectionModal');
    if (tableModal) {
        tableModal.classList.add('hidden');
        tableModal.classList.remove('flex');
    }

    // Hide order panel
    const orderPanel = document.getElementById('order-panel');
    if (orderPanel) {
        orderPanel.classList.remove('translate-y-0');
        orderPanel.classList.add('translate-y-full');
    }
    const backdrop = document.getElementById('order-panel-backdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
    }
}

/**
 * Switch to tables tab on mobile
 */
function switchToTablesTab() {
    if (!tableManagementEnabled) return;

    currentMobileTab = 'tables';
    updateMobileTabDisplay();

    // Hide main content, show table selection
    showTableSelectionModal();
}

/**
 * Switch to orders tab on mobile
 */
function switchToOrdersTab() {
    if (!tableManagementEnabled) return;

    currentMobileTab = 'orders';
    updateMobileTabDisplay();

    // Show order panel
    toggleMobileOrderPanel(true);
}

/**
 * Update mobile tab visual state
 */
function updateMobileTabDisplay() {
    const tabs = ['menuTabBtn', 'tablesTabBtn', 'ordersTabBtn'];

    tabs.forEach(tabId => {
        const tab = document.getElementById(tabId);
        if (tab) {
            tab.classList.remove('text-black', 'bg-gray-100', 'font-semibold');
            tab.classList.add('text-gray-600');
        }
    });

    // Highlight active tab
    const activeTabId = currentMobileTab + 'TabBtn';
    const activeTab = document.getElementById(activeTabId);
    if (activeTab) {
        activeTab.classList.remove('text-gray-600');
        activeTab.classList.add('text-black', 'bg-gray-100', 'font-semibold');
    }
}


// ==================================================================================
// END TABLE MOBILE NAVIGATION SYSTEM
// ==================================================================================

// ==================================================================================
// END TABLE MANAGEMENT SYSTEM
// ==================================================================================

function startClock() {
    if (!elements.realtimeClock) return;
    const update = () => {
        elements.realtimeClock.textContent = new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };
    update();
    setInterval(update, 1000 * 60);
}

async function fetchAndUpdateOrderNumber() {
    try {
        const response = await fetch('/api/order_status');
        if (!response.ok) throw new Error(`Server responded with status ${response.status}`);
        const data = await response.json();
        if (data && typeof data.next_order_number !== 'undefined') {
            orderNumber = data.next_order_number;
            // Update UI based on which element is present
            if (elements.headerOrderNumber) elements.headerOrderNumber.textContent = orderNumber;
            if (elements.orderNumber_desktop) elements.orderNumber_desktop.textContent = orderNumber;
        }
    } catch (error) {
        console.error("Could not fetch next order number:", error);
        if (elements.headerOrderNumber) elements.headerOrderNumber.textContent = "Err";
        if (elements.orderNumber_desktop) elements.orderNumber_desktop.textContent = "Err";
        showToast("Could not sync order number with server.", "error");
    }
}

async function autoVerifyPrinter() {
    console.log('Auto-verifying printer on startup...');
    try {
        // First check if we have a printer configured and if it's accessible
        const response = await fetch('/api/printers');
        const data = await response.json();
        
        if (!data.selected) {
            console.log('No printer selected, skipping auto-verification');
            printerVerificationStatus = 'failed';
            return;
        }

        // Check printer status
        const statusResp = await fetch(`/api/printer/status?name=${encodeURIComponent(data.selected)}`);
        const statusInfo = await statusResp.json();
        
        // If printer has error or is not accessible, skip auto-test
        if (statusInfo.error || (typeof statusInfo.status_code === 'number' && statusInfo.status_code !== 0)) {
            console.log('Printer not ready for auto-verification:', statusInfo);
            printerVerificationStatus = 'failed';
            return;
        }

        // Perform silent test print
        const testResp = await fetch('/api/printer/test', { method: 'POST' });
        const testResult = await testResp.json();
        
        if (testResult.success) {
            printerVerificationStatus = 'verified';
            console.log('Printer auto-verification successful');
            
            // Update the UI status dot if it exists (for settings page)
            const dot = document.getElementById('printerStatusDot');
            if (dot) {
                dot.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:9999px;background:#16a34a"></span><span>Ready</span></span>`;
            }
        } else {
            printerVerificationStatus = 'failed';
            console.log('Printer auto-verification failed:', testResult.message);
        }
    } catch (error) {
        printerVerificationStatus = 'failed';
        console.log('Error during printer auto-verification:', error);
    }
}

function initializeAppState() {
    console.log('initializeAppState called');
    fetchAndUpdateOrderNumber();
    selectedTableNumber = localStorage.getItem(SELECTED_TABLE_KEY) || "";
    console.log('Selected table number:', selectedTableNumber);
    if (elements.headerTableInput) {
        elements.headerTableInput.value = selectedTableNumber;
        console.log('Set header table input value');
    } else {
        console.log('headerTableInput not found');
    }
    const savedComment = localStorage.getItem(UNIVERSAL_COMMENT_KEY) || "";
    console.log('Saved comment:', savedComment);
    if (elements.universalOrderCommentInput) {
        elements.universalOrderCommentInput.value = savedComment;
        console.log('Set universal order comment input value');
    } else {
        console.log('universalOrderCommentInput not found');
    }
    const desktopCommentInput = document.getElementById('universalOrderCommentInput_desktop');
     if (desktopCommentInput) {
        desktopCommentInput.value = savedComment;
        console.log('Set desktop comment input value');
    } else {
        console.log('universalOrderCommentInput_desktop not found');
    }
    
    // Auto-verify printer on startup
    autoVerifyPrinter();
    
    console.log('initializeAppState completed');
}


async function loadMenu() {
    console.log('loadMenu called');
    try {
        const response = await fetch('/api/menu');
        console.log('API response status:', response.status);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        menu = await response.json() || {};
        console.log('Menu loaded:', menu);

        if (Object.keys(menu).length > 0 && (!selectedCategory || !menu[selectedCategory])) {
            selectedCategory = Object.keys(menu)[0];
        } else if (Object.keys(menu).length === 0) {
            selectedCategory = null;
        }
        renderCategories();
        populateManagementCategorySelect();
        // Ensure products are rendered for the initial category
        if (selectedCategory) {
            renderProductsForSelectedCategory();
        }
    } catch (error) {
        console.warn('API unavailable – menu data not loaded');
        console.log('Error details:', error);
        menu = {};
        selectedCategory = null;
        renderCategories();
        populateManagementCategorySelect();
    }
}

async function saveMenuToServer() {
    try {
        const response = await fetch('/api/menu', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(menu)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                message: `HTTP ${response.status} - ${response.statusText}`
            }));
            throw new Error(`Failed to save menu: ${errorData.message}`);
        }
        return true;
    } catch (error) {
        showToast(error.message, 'error');
        console.error("Save menu error:", error);
        return false;
    }
}

function renderCategories() {
    console.log('renderCategories called');
    console.log('categoriesContainer:', elements.categoriesContainer);
    if (!elements.categoriesContainer) {
        console.error('categoriesContainer not found');
        return;
    }
    elements.categoriesContainer.innerHTML = '';

    console.log('Menu keys:', Object.keys(menu));
    if (Object.keys(menu).length === 0) {
        console.log('No categories in menu');
        elements.categoriesContainer.innerHTML = '<p class="text-gray-500 italic">No categories defined.</p>';
        if (elements.productsContainer) {
            elements.productsContainer.innerHTML = '<p class="text-gray-600 italic col-span-full text-center py-8">Please add categories and items in Management.</p>';
        }
        return;
    }

    // Detect which UI is active by checking for a unique element
    const isDesktopUI = document.body.classList.contains('desktop-ui');

    if (isDesktopUI) {
        // Render tabs for Desktop UI
        Object.keys(menu).forEach(category => {
            const btn = document.createElement('button');
            btn.className = `category-tab ${category === selectedCategory ? 'active' : ''}`;
            btn.textContent = category;
            btn.onclick = () => {
                selectedCategory = category;
                // Update active state of all tabs
                elements.categoriesContainer.querySelectorAll('.category-tab').forEach(tab => {
                    tab.classList.remove('active');
                });
                btn.classList.add('active');
                // Render products for the selected category
                renderProductsForSelectedCategory();
            };
            elements.categoriesContainer.appendChild(btn);
        });
    } else {
        // Render dropdown for POSPal UI
        const selectEl = document.createElement('select');
        selectEl.className = 'w-full p-2.5 border border-gray-400 rounded-md shadow-sm bg-white text-sm';
        selectEl.id = 'categorySelectorDropdown';

        Object.keys(menu).forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            if (category === selectedCategory) {
                option.selected = true;
            }
            selectEl.appendChild(option);
        });

        selectEl.onchange = (event) => {
            selectedCategory = event.target.value;
            renderProductsForSelectedCategory();
        };
        elements.categoriesContainer.appendChild(selectEl);
    }
    
    // Initial render of products
    if (selectedCategory) {
        renderProductsForSelectedCategory();
    }
}


function renderProductsForSelectedCategory() {
    console.log('renderProductsForSelectedCategory called');
    console.log('selectedCategory:', selectedCategory);
    console.log('menu:', menu);
    console.log('elements.productsContainer:', elements.productsContainer);
    
    if (!elements.productsContainer) {
        console.error('productsContainer not found');
        return;
    }
    elements.productsContainer.innerHTML = '';
    if (!selectedCategory || !menu[selectedCategory] || menu[selectedCategory].length === 0) {
        console.log('No items in category:', selectedCategory);
        elements.productsContainer.innerHTML = `<p class="text-gray-600 italic col-span-full text-center py-8">No items in "${selectedCategory || 'this'}" category.</p>`;
        return;
    }

    const isDesktopUI = document.body.classList.contains('desktop-ui');
    console.log('Rendering products for category:', selectedCategory);
    console.log('Items in category:', menu[selectedCategory]);
    console.log('Is Desktop UI:', isDesktopUI);

    menu[selectedCategory].forEach(item => {
        const card = document.createElement('div');
        card.onclick = () => addToOrder(item.id);

        if (isDesktopUI) {
            // Desktop card rendering (parity with mobile)
            card.className = 'product-card bg-white rounded-lg shadow hover:shadow-md transition-shadow overflow-hidden flex flex-col cursor-pointer border border-gray-200 h-full';
            const hasGenOptions = item.hasGeneralOptions && item.generalOptions && item.generalOptions.length > 0;
            const badgeIconsHTML = hasGenOptions ? `
                    <div class="absolute bottom-2 right-2 flex flex-col space-y-1">
                        <span class="options-badge inline-flex items-center justify-center p-1 w-6 h-6 rounded"><i class="fas fa-cogs text-sm"></i></span>
                    </div>
                ` : '';
            card.innerHTML = `
                <div class="relative p-3 flex-grow flex flex-col h-full">
                    <div class="flex-grow flex flex-col pr-8">
                        <div class="flex-grow">
                            <h3 class="text-sm font-semibold text-gray-800 mb-1">${item.name}</h3>
                        </div>
                        <div class="mt-auto">
                           <p class="text-lg font-bold text-black">€${(item.price || 0).toFixed(2)}</p>
                        </div>
                    </div>
                    ${badgeIconsHTML}
                </div>
            `;
        } else {
            // POSPal card rendering
            card.className = 'product-card bg-white rounded-lg shadow hover:shadow-md transition-shadow overflow-hidden flex flex-col cursor-pointer border border-gray-200';
            let badgeIconsHTML = '';
            const hasGenOptions = item.hasGeneralOptions && item.generalOptions && item.generalOptions.length > 0;

            if (hasGenOptions) {
                badgeIconsHTML = `
                    <div class="absolute bottom-2 right-2 flex flex-col space-y-1">
                        <span class="options-badge inline-flex items-center justify-center p-1 w-6 h-6 rounded"><i class="fas fa-cogs text-sm"></i></span>
                    </div>
                `;
            }
            card.innerHTML = `
                <div class="relative p-3 flex-grow flex flex-col h-full">
                    <div class="flex-grow flex flex-col pr-8">
                        <div class="flex-grow">
                            <h3 class="text-sm font-semibold text-gray-800 mb-1">${item.name}</h3>
                        </div>
                        <div class="mt-auto">
                           <p class="text-lg font-bold text-black">€${(item.price || 0).toFixed(2)}</p>
                        </div>
                    </div>
                    ${badgeIconsHTML}
                </div>
            `;
        }
        console.log('Created card for item:', item.name);
        elements.productsContainer.appendChild(card);
    });
    console.log('Finished rendering products');
}

async function addToOrder(itemId) {
    let menuItem;
    for (const categoryKey in menu) {
        const found = (menu[categoryKey] || []).find(i => i.id === itemId);
        if (found) {
            menuItem = found;
            break;
        }
    }

    if (!menuItem) {
        console.error("Menu item not found for ID:", itemId);
        showToast("Error: Item not found.", 'error');
        return;
    }

    itemBeingConfigured = { ...menuItem };
    currentOptionSelectionStep = null;

    const hasGenOpts = (itemBeingConfigured.hasGeneralOptions && itemBeingConfigured.generalOptions && Array.isArray(itemBeingConfigured.generalOptions) && itemBeingConfigured.generalOptions.length > 0);

    if (hasGenOpts) {
        currentOptionSelectionStep = 'general';
        openItemOptionSelectModal(itemBeingConfigured, 'general_item_option');
    } else {
        await finalizeAndAddOrderItem(itemBeingConfigured, []);
        resetMultiStepSelection();
    }
}

async function finalizeAndAddOrderItem(baseItem, generalChoicesWithOptions) {
    currentOrderLineItemCounter++;
    await updateOrderLineCounter();

    let uniqueSuffixParts = [];
    if (generalChoicesWithOptions && generalChoicesWithOptions.length > 0) {
        uniqueSuffixParts.push(...generalChoicesWithOptions.map(opt => opt.name.replace(/\s+/g, '_')));
    }

    const uniqueLineIdSuffix = uniqueSuffixParts.length > 0 ? uniqueSuffixParts.join('-') : 'noopts';
    const uniqueLineId = `${baseItem.id}-${uniqueLineIdSuffix}-line-${currentOrderLineItemCounter}`;

    let itemPriceWithModifiers = parseFloat(baseItem.price || 0);
    if (generalChoicesWithOptions && generalChoicesWithOptions.length > 0) {
        generalChoicesWithOptions.forEach(opt => {
            itemPriceWithModifiers += parseFloat(opt.priceChange || 0);
        });
    }

    const orderItem = {
        ...baseItem,
        quantity: 1,
        comment: "",
        orderId: uniqueLineId,
        generalSelectedOptions: generalChoicesWithOptions || [],
        itemPriceWithModifiers: itemPriceWithModifiers
    };
    currentOrder.push(orderItem);
    updateOrderDisplay();
}

function resetMultiStepSelection() {
    itemBeingConfigured = null;
    currentOptionSelectionStep = null;
}

function updateOrderDisplay() {
    if (!elements.orderItemsContainer) return;
    elements.orderItemsContainer.innerHTML = '';
    let total = 0;

    const isDesktopUI = document.body.classList.contains('desktop-ui');

    if (currentOrder.length === 0) {
        if (elements.emptyOrderMessage) elements.emptyOrderMessage.style.display = 'block';
    } else {
        if (elements.emptyOrderMessage) elements.emptyOrderMessage.style.display = 'none';
        currentOrder.forEach(item => {
            const pricePerUnit = typeof item.itemPriceWithModifiers === 'number' ? item.itemPriceWithModifiers : parseFloat(item.price || 0);
            const itemTotal = pricePerUnit * item.quantity;
            total += itemTotal;

            const div = document.createElement('div');
            let optionDisplayHTML = '';
            let commentText = item.comment ? `<span class="block text-xs text-gray-600 ml-4 break-all"><em>Note: ${item.comment}</em></span>` : '';
            
            if (isDesktopUI) {
                 // Desktop order item rendering
                div.className = `order-item p-2 border border-gray-200 rounded ${item.orderId === selectedItemId_desktop ? 'selected-for-numpad bg-blue-50 border-blue-300' : 'bg-white hover:bg-gray-50'} cursor-pointer transition-colors`;
                div.onclick = () => selectItemByOrderId_desktop(item.orderId);

                if (item.generalSelectedOptions && item.generalSelectedOptions.length > 0) {
                    item.generalSelectedOptions.forEach(opt => {
                        const priceChangeDisplay = parseFloat(opt.priceChange || 0) !== 0 ? ` (${parseFloat(opt.priceChange || 0) > 0 ? '+' : ''}€${parseFloat(opt.priceChange || 0).toFixed(2)})` : '';
                        optionDisplayHTML += `<div style="font-size: 0.8em; color: #777; margin-left: 10px;">↳ ${opt.name}${priceChangeDisplay}</div>`;
                    });
                }
                 commentText = item.comment ? `<div style="font-size: 0.8em; color: #555; margin-left: 10px;"><em>Note: ${item.comment}</em></div>` : '';

                div.innerHTML = `
                    <div class="flex justify-between items-start">
                        <div class="flex-1">
                            <div class="flex items-center space-x-2">
                                <span class="font-semibold text-gray-800">${item.quantity}x ${item.name}</span>
                            </div>
                            ${optionDisplayHTML}
                            ${commentText}
                        </div>
                        <div class="flex flex-col items-end">
                            <span class="font-bold text-gray-900 mb-1">€${itemTotal.toFixed(2)}</span>
                            <div class="flex items-center space-x-1">
                                <button onclick="event.stopPropagation(); decrementQuantity('${item.orderId}')" class="p-1 text-gray-500 hover:text-red-600 transition-colors" title="Decrease Quantity">
                                    <i class="fas fa-minus-circle text-sm"></i>
                                </button>
                                <span class="font-semibold text-gray-800 w-8 text-center">${item.quantity}</span>
                                <button onclick="event.stopPropagation(); incrementQuantity('${item.orderId}')" class="p-1 text-gray-500 hover:text-green-600 transition-colors" title="Increase Quantity">
                                    <i class="fas fa-plus-circle text-sm"></i>
                                </button>
                                <button onclick="event.stopPropagation(); promptForItemComment('${item.orderId}')" class="p-1 text-gray-500 hover:text-blue-600 transition-colors" title="Add Note">
                                    <i class="fas fa-comment-dots text-sm"></i>
                                </button>
                                <button onclick="event.stopPropagation(); removeItemByOrderId('${item.orderId}')" class="p-1 text-red-500 hover:text-red-700 transition-colors" title="Remove Item">
                                    <i class="fas fa-trash-alt text-sm"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;

            } else {
                // POSPal order item rendering
                div.className = `order-item p-2 border-b border-gray-200 flex items-center justify-between text-sm ${item.orderId === itemForNumpad?.orderId ? 'selected-for-numpad' : ''}`;
                if (item.generalSelectedOptions && item.generalSelectedOptions.length > 0) {
                    item.generalSelectedOptions.forEach(opt => {
                        const priceChangeDisplay = parseFloat(opt.priceChange || 0) !== 0 ? ` (${parseFloat(opt.priceChange || 0) > 0 ? '+' : ''}€${parseFloat(opt.priceChange || 0).toFixed(2)})` : '';
                        optionDisplayHTML += `<span class="block text-xs text-gray-600 ml-4">↳ ${opt.name}${priceChangeDisplay}</span>`;
                    });
                }

                div.innerHTML = `
                    <div class="flex-grow pr-2">
                        <span class="font-medium text-gray-800">${item.name}</span>
                        <span class="text-xs text-gray-500 ml-1">(Base: €${parseFloat(item.price || 0).toFixed(2)})</span>
                        ${optionDisplayHTML}
                        ${commentText}
                    </div>
                    <div class="flex flex-col items-end space-y-1 flex-shrink-0">
                         <span class="font-semibold text-gray-800">€${pricePerUnit.toFixed(2)} x ${item.quantity} = €${itemTotal.toFixed(2)}</span>
                        <div class="flex items-center space-x-1">
                            <button onclick="decrementQuantity('${item.orderId}')" class="p-1 text-gray-500 hover:text-red-600"><i class="fas fa-minus-circle"></i></button>
                            <span class="font-semibold text-gray-800 w-6 text-center cursor-pointer" onclick="openNumpadForOrderItem('${item.orderId}', ${item.quantity}, '${item.name.replace(/'/g, "\\'")}')">${item.quantity}</span>
                            <button onclick="incrementQuantity('${item.orderId}')" class="p-1 text-gray-500 hover:text-green-600"><i class="fas fa-plus-circle"></i></button>
                            <button onclick="promptForItemComment('${item.orderId}')" class="p-1 text-gray-500 hover:text-black" title="Add Note"><i class="fas fa-comment-dots"></i></button>
                            <button onclick="removeItemByOrderId('${item.orderId}')" class="p-1 text-red-500 hover:text-red-700" title="Remove Item"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    </div>
                `;
            }
            elements.orderItemsContainer.appendChild(div);
        });
    }

    if (elements.orderTotalDisplay) elements.orderTotalDisplay.textContent = `€${total.toFixed(2)}`;
    
    // Save to centralized state
    updateCurrentOrder();
    
    // UI-specific updates
    if (elements.mobileOrderCountBadge) {
        updateMobileOrderBadge();
    }
}


function incrementQuantity(orderId) {
    const item = currentOrder.find(i => i.orderId === orderId);
    if (item) {
        item.quantity++;
        updateOrderDisplay();
    }
}

function decrementQuantity(orderId) {
    const item = currentOrder.find(i => i.orderId === orderId);
    if (item) {
        item.quantity--;
        if (item.quantity <= 0) removeItemByOrderId(orderId);
        else updateOrderDisplay();
    }
}

function removeItemByOrderId(orderId) {
    currentOrder = currentOrder.filter(item => item.orderId !== orderId);
    // Hide numpad if the removed item was selected (for both UIs)
    if (itemForNumpad && itemForNumpad.orderId === orderId) hideNumpad();
    if (selectedItemId_desktop === orderId) selectedItemId_desktop = null;
    
    updateOrderDisplay();
    showToast('Item removed from order.', 'info');
}

function promptForItemComment(orderId) {
    const item = currentOrder.find(i => String(i.orderId) === orderId);
    if (item) {
        let currentSelectionDisplay = "";
        if (item.generalSelectedOptions && item.generalSelectedOptions.length > 0) {
            currentSelectionDisplay += ` (Opt: ${item.generalSelectedOptions.map(opt => opt.name + (parseFloat(opt.priceChange || 0) !== 0 ? ` ${parseFloat(opt.priceChange || 0) > 0 ? '+' : ''}€${parseFloat(opt.priceChange || 0).toFixed(2)}` : '')).join(', ')})`;
        }
        const newComment = prompt("Enter note for " + item.name + currentSelectionDisplay.trim() + ":", item.comment || "");
        if (newComment !== null) {
            item.comment = newComment.trim();
            updateOrderDisplay();
        }
    }
}

async function clearOrderData() {
    currentOrder = [];
    universalOrderComment = "";
    if (elements.universalOrderCommentInput) elements.universalOrderCommentInput.value = "";
    const desktopCommentInput = document.getElementById('universalOrderCommentInput_desktop');
    if (desktopCommentInput) desktopCommentInput.value = "";

    currentOrderLineItemCounter = 0;
    isPaidByCard = false;
    if (elements.paidByCardCheckbox) elements.paidByCardCheckbox.checked = false;

    hideNumpad();
    selectedItemId_desktop = null;
    numpadInput_desktop = "";

    // Clear centralized state
    await clearCentralizedOrder();
    await updateUniversalComment();

    updateOrderDisplay();
    fetchAndUpdateOrderNumber();

    // Refresh table data if table management is enabled
    if (tableManagementEnabled) {
        try {
            await loadTableSessions();
            updateTableDisplay();
        } catch (error) {
            console.error('Failed to refresh table data after order clear:', error);
        }
    }
}

async function newOrder() {
    if (currentOrder.length > 0 && !confirm("Clear current order and start a new one? This will clear all items and notes.")) {
        return;
    }
    await clearOrderData();
    showToast('Order cleared. Ready for the next order.', 'info');
}

async function sendOrder() {
    if (!elements.sendOrderBtn) return;

    if (!currentOrder.length) {
        showToast('Order is empty!', 'warning');
        return;
    }
    
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    let tableNumberForOrder = selectedTableNumber;

    // Require a table number on all UIs; no browser prompts
    if (!tableNumberForOrder || tableNumberForOrder.trim() === "") {
        showToast('Please select a table.', 'warning');
        if (elements.headerTableContainer) {
            elements.headerTableContainer.classList.add('ring-2', 'ring-red-500');
            setTimeout(() => {
                elements.headerTableContainer.classList.remove('ring-2', 'ring-red-500');
            }, 2000);
        }
        return;
    }


    // Preflight: block if printer not verified this session
    if (printerVerificationStatus !== 'verified') {
        if (printerVerificationStatus === 'failed') {
            showToast('Printer verification failed at startup. Open Settings to test and retry.', 'error', 7000);
        } else {
            showToast('Printer not verified yet. Open Settings to test and retry.', 'error', 7000);
        }
        return;
    }

    elements.sendOrderBtn.disabled = true;
    elements.sendOrderBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Sending...';

    const orderData = {
        tableNumber: tableNumberForOrder,
        items: currentOrder.map(item => ({
            id: item.id,
            name: item.name,
            basePrice: parseFloat(item.price || 0),
            quantity: item.quantity,
            generalSelectedOptions: item.generalSelectedOptions || [],
            itemPriceWithModifiers: item.itemPriceWithModifiers,
            comment: item.comment || "",
        })),
        universalComment: universalOrderComment.trim(),
        paymentMethod: isPaidByCard ? 'Card' : 'Cash'
    };

    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderData)
        });

        const result = await response.json().catch(() => ({}));

        if (response.ok) {
            if (result.status === "success") {
                const tableMessage = tableManagementEnabled && tableNumberForOrder ? ` for Table ${tableNumberForOrder}` : '';
                showToast(result.message || `Order #${result.order_number}${tableMessage} sent, all copies printed, and logged!`, 'success');
            } else if (result.status === "warning_print_copy2_failed" || result.status === "warning_print_partial_failed") {
                showToast(result.message || `Order #${result.order_number}: Some copies FAILED.`, 'warning', 7000);
            } else if (result.status === "error_print_failed_copy1") {
                showToast(result.message || `Order #${result.order_number} - COPY 1 FAILED. Order NOT saved.`, 'error', 7000);
            } else if (result.status === "error_log_failed_after_print") {
                showToast(result.message || `Order #${result.order_number} - PRINTED but LOGGING FAILED. Notify staff!`, 'error', 10000);
            } else {
                showToast(result.message || `Order #${result.order_number} processed with issues: ${result.status}`, 'warning', 7000);
            }

            if (result.status === "success" || result.status === "warning_print_copy2_failed" || result.status === "warning_print_partial_failed" || result.status === "error_log_failed_after_print") {
                clearOrderData();
            }

        } else {
            if (response.status === 403 && result.status === 'error_trial_expired') {
                showToast(result.message, 'error', 10000);
                openManagementModal();
                const licensingTabButton = document.querySelector('.management-tab[onclick*="\'licensing\'"]');
                if (licensingTabButton) {
                    switchManagementTab('licensing', licensingTabButton);
                }
            } else {
                const errorMsg = result.message || `Server error: ${response.status}. Please check server logs.`;
                showToast(errorMsg, 'error', 7000);
            }
            fetchAndUpdateOrderNumber();
        }
    } catch (error) {
        console.error('Send order network/parse error:', error);
        let detailedErrorMsg = 'Network error or invalid server response. Could not send order.';
        if (error instanceof TypeError) {
            detailedErrorMsg = 'Server returned an unexpected response format. Check server logs.';
        } else if (error.message) {
            detailedErrorMsg = `Error: ${error.message}. Could not send order.`;
        }
        showToast(detailedErrorMsg + ' Order remains on screen.', 'error', 7000);
        fetchAndUpdateOrderNumber();
    } finally {
        if (elements.sendOrderBtn) {
            elements.sendOrderBtn.disabled = false;
            elements.sendOrderBtn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Send Order';
        }
    }
}

// --- UI-Specific Functions ---

// POSPal UI Functions
function toggleMobileOrderPanel() {
    if (!elements.orderPanel) return; // Only run on POSPal UI
    isMobileOrderPanelOpen = !isMobileOrderPanelOpen;
    if (isMobileOrderPanelOpen) {
        elements.orderPanel.classList.remove('translate-y-full');
        elements.orderPanelBackdrop.classList.remove('hidden');
        if (elements.settingsGearContainer) elements.settingsGearContainer.classList.add('hidden');
        document.body.style.overflow = 'hidden';

        // Update table mode mobile navigation
        if (tableManagementEnabled) {
            currentMobileTab = 'orders';
            updateMobileTabDisplay();
        }
    } else {
        elements.orderPanel.classList.add('translate-y-full');
        elements.orderPanelBackdrop.classList.add('hidden');
        if (elements.settingsGearContainer) elements.settingsGearContainer.classList.remove('hidden');
        document.body.style.overflow = '';
        hideNumpad();

        // Update table mode mobile navigation
        if (tableManagementEnabled && currentMobileTab === 'orders') {
            currentMobileTab = 'menu';
            updateMobileTabDisplay();
        }
    }
}

function updateMobileOrderBadge() {
    const count = currentOrder.reduce((sum, item) => sum + item.quantity, 0);

    // Update simple mode badge
    if (elements.mobileOrderCountBadge) {
        if (count > 0) {
            elements.mobileOrderCountBadge.textContent = count;
            elements.mobileOrderCountBadge.classList.remove('hidden');
        } else {
            elements.mobileOrderCountBadge.classList.add('hidden');
        }
    }

    // Update table mode badge
    const tableModeBadge = document.getElementById('mobile-order-count-badge-table');
    if (tableModeBadge) {
        if (count > 0) {
            tableModeBadge.textContent = count;
            tableModeBadge.classList.remove('hidden');
        } else {
            tableModeBadge.classList.add('hidden');
        }
    }
}

function openNumpadForOrderItem(orderId, currentQuantity, itemName) {
    if (!elements.numpadContainer) return;
    itemForNumpad = {
        orderId,
        currentQuantity,
        itemName
    };
    numpadCurrentInput = currentQuantity.toString();
    if (elements.numpadItemNameDisplay) elements.numpadItemNameDisplay.innerHTML = `Quantity for: <span class="font-bold">${itemName}</span>`;
    if (elements.numpadContainer) elements.numpadContainer.classList.remove('hidden');
    updateOrderDisplay();
}

function hideNumpad() {
    if (elements.numpadContainer) elements.numpadContainer.classList.add('hidden');
    itemForNumpad = null;
    numpadCurrentInput = "";
    updateOrderDisplay(); // To remove selection highlight
}

function handleNumpadInput(value) {
    if (!itemForNumpad) return;
    if (value === 'clear') {
        numpadCurrentInput = "";
    } else if (value === 'backspace') {
        numpadCurrentInput = numpadCurrentInput.slice(0, -1);
    } else if (numpadCurrentInput.length < 3) {
        numpadCurrentInput += value;
    }
}

function confirmNumpadInput() {
    if (!itemForNumpad) return;
    const newQuantity = parseInt(numpadCurrentInput);
    const item = currentOrder.find(i => i.orderId === itemForNumpad.orderId);

    if (item) {
        if (!isNaN(newQuantity) && newQuantity > 0) {
            item.quantity = newQuantity;
        } else if (numpadCurrentInput === "" || newQuantity === 0) {
            removeItemByOrderId(item.orderId);
        } else {
            showToast("Invalid quantity. Please enter a number greater than 0.", "warning");
        }
    }
    hideNumpad();
}

function toggleDesktopNumpad() {
    if (!document.body.classList.contains('desktop-ui')) return;
    const full = document.getElementById('desktopNumpad');
    const mini = document.getElementById('desktopNumpadMini');
    if (!full || !mini) return;
    const isFullVisible = !full.classList.contains('hidden');
    if (isFullVisible) {
        full.classList.add('hidden');
        mini.classList.remove('hidden');
    } else {
        mini.classList.add('hidden');
        full.classList.remove('hidden');
    }
}

function toggleDesktopNotes() {
    if (!document.body.classList.contains('desktop-ui')) return;
    const el = document.getElementById('desktopNotesCard');
    if (!el) return;
    el.classList.toggle('hidden');
}

function expandDesktopNumpad() {
    if (!document.body.classList.contains('desktop-ui')) return;
    const full = document.getElementById('desktopNumpad');
    const mini = document.getElementById('desktopNumpadMini');
    if (!full || !mini) return;
    mini.classList.add('hidden');
    full.classList.remove('hidden');
}

async function handleTableNumberChange(event) {
    const inputValue = event.target.value.trim();
    
    // Check if input contains only numbers
    if (inputValue && !/^\d+$/.test(inputValue)) {
        // Show notification to user
        showToast("Table number must contain only numbers. Letters and special characters are not allowed.", "warning");
        
        // Clear the input field
        event.target.value = "";
        selectedTableNumber = "";
        await updateSelectedTable();
        return;
    }
    
    const newTableNumber = inputValue;
    if (selectedTableNumber !== newTableNumber) {
        selectedTableNumber = newTableNumber;
        await updateSelectedTable();
    }
}

// Desktop UI Functions
function selectItemByOrderId_desktop(orderId) {
    if (selectedItemId_desktop === orderId) {
        selectedItemId_desktop = null; // Deselect if clicked again
        numpadInput_desktop = "";
    } else {
        selectedItemId_desktop = orderId;
        numpadInput_desktop = "";
    }
    updateOrderDisplay();
}

function handleNumpad_desktop(digit) {
    // Case 1: An order line item is currently selected – adjust its quantity
    if (selectedItemId_desktop) {
        const item = currentOrder.find(i => String(i.orderId) === selectedItemId_desktop);
        if (!item) {
            showToast('Error: Selected item not found.', 'error');
            numpadInput_desktop = "";
            return;
        }

        numpadInput_desktop += String(digit);
        let newQuantity = Number(numpadInput_desktop);

        if (isNaN(newQuantity) || newQuantity <= 0) {
            item.quantity = 1;
            numpadInput_desktop = newQuantity > 0 ? newQuantity.toString() : "1";
        } else {
            item.quantity = newQuantity;
        }
        updateOrderDisplay();
    } else {
        // Case 2: No line item selected – treat the numpad input as the TABLE number
        numpadInput_desktop += String(digit);
        selectedTableNumber = numpadInput_desktop;
        if (elements.headerTableInput) elements.headerTableInput.value = selectedTableNumber;
        updateSelectedTable();
    }
}

function handleNumpadClear_desktop() {
    if (selectedItemId_desktop) {
        const item = currentOrder.find(i => String(i.orderId) === selectedItemId_desktop);
        if (item) {
            numpadInput_desktop = "";
            item.quantity = 1;
            updateOrderDisplay();
        }
    } else {
        // Clear the table number
        numpadInput_desktop = "";
        selectedTableNumber = "";
        if (elements.headerTableInput) elements.headerTableInput.value = "";
        updateSelectedTable();
    }
}

function handleNumpadBackspace_desktop() {
    if (selectedItemId_desktop) {
        const item = currentOrder.find(i => String(i.orderId) === selectedItemId_desktop);
        if (item) {
            if (numpadInput_desktop.length > 0) {
                numpadInput_desktop = numpadInput_desktop.slice(0, -1);
            }
            item.quantity = Number(numpadInput_desktop) > 0 ? Number(numpadInput_desktop) : 1;
            updateOrderDisplay();
        }
    } else {
        if (numpadInput_desktop.length > 0) {
            numpadInput_desktop = numpadInput_desktop.slice(0, -1);
        }
        selectedTableNumber = numpadInput_desktop;
        if (elements.headerTableInput) elements.headerTableInput.value = selectedTableNumber;
        updateSelectedTable();
    }
}


// --- Universal Modal & Management Logic ---

let currentItemOptionContext = null;

function openItemOptionSelectModal(itemForModal, context) {
    // Reset previous selections
    const container = elements.optionModalOptionsContainer;
    if (container) {
        container.querySelectorAll('input').forEach(input => {
            input.checked = false;
            const parentDiv = input.closest('.option-selectable');
            if (parentDiv) parentDiv.classList.remove('selected', 'border-black', 'bg-gray-100');
        });
    }

    currentItemOptionContext = context;
    if (!elements.itemOptionSelectModal || !elements.optionModalItemName || !elements.optionModalOptionsContainer) return;

    elements.optionModalItemName.textContent = `Options for: ${itemForModal.name}`;
    elements.optionModalOptionsContainer.innerHTML = '';
    elements.confirmOptionBtn.disabled = true;

    let optionsToShow = [];
    let description = "";
    let inputType = 'checkbox'; // Default to checkbox for general options

    if (context === 'general_item_option') {
        optionsToShow = itemForModal.generalOptions || [];
        description = `Select option(s) for ${itemForModal.name}. (Multiple selections allowed)`;
    } else {
        console.warn("Modal opened with unexpected context:", context);
        elements.optionModalOptionsContainer.innerHTML = `<p class="text-sm text-gray-500">No options for this step.</p>`;
        elements.itemOptionSelectModal.classList.remove('hidden');
        elements.itemOptionSelectModal.classList.add('flex');
        return;
    }
    elements.optionModalItemDescription.textContent = description;

    if (optionsToShow.length > 0) {
        elements.confirmOptionBtn.disabled = false;
        optionsToShow.forEach((optionData, index) => {
            const optionName = (typeof optionData === 'object' && optionData.name) ? optionData.name : optionData;
            const priceChange = (typeof optionData === 'object' && typeof optionData.priceChange === 'number') ? optionData.priceChange : 0;

            const optionId = `modal_item_opt_${itemForModal.id}_${context}_${optionName.replace(/\s+/g, '_')}_${index}`;
            const div = document.createElement('div');
            // This class is from POSPal's CSS, but we'll add it for consistency.
            // It should be defined in POSPalDesktop.html's style block if needed.
            div.className = "option-selectable p-3 border border-gray-300 rounded-md hover:bg-gray-100 cursor-pointer group focus-within:ring-2";

            const inputElement = document.createElement('input');
            inputElement.type = inputType;
            inputElement.name = `item_option_for_${itemForModal.id}_${context}`;
            if (inputType === 'checkbox') inputElement.name = optionId;
            inputElement.id = optionId;
            inputElement.value = optionName;
            inputElement.dataset.priceChange = priceChange;
            inputElement.className = `form-${inputType} h-4 w-4 text-black border-gray-300 focus:ring-black accent-black`;

            let labelText = optionName;
            if (priceChange !== 0) {
                labelText += ` (${priceChange > 0 ? '+' : ''}€${priceChange.toFixed(2)})`;
            }

            const label = document.createElement('label');
            label.htmlFor = optionId;
            label.textContent = labelText;
            label.className = "ml-2 text-sm text-gray-700 cursor-pointer flex-grow";

            const innerFlex = document.createElement('div');
            innerFlex.className = "flex items-center w-full";
            innerFlex.appendChild(inputElement);
            innerFlex.appendChild(label);
            div.appendChild(innerFlex);

            div.onclick = function(event) {
                if (event.target !== inputElement) {
                    inputElement.click();
                }
            };

            inputElement.addEventListener('change', function() {
                const parentDiv = this.closest('.option-selectable');
                if (!parentDiv) return;
                if (this.checked) {
                    parentDiv.classList.add('selected', 'border-black', 'bg-gray-100');
                } else {
                    parentDiv.classList.remove('selected', 'border-black', 'bg-gray-100');
                }
            });

            elements.optionModalOptionsContainer.appendChild(div);
        });
    } else {
        elements.optionModalOptionsContainer.innerHTML = `<p class="text-sm text-gray-500">No specific options defined for this item.</p>`;
    }
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.itemOptionSelectModal.style.display = 'flex';
    } else {
        elements.itemOptionSelectModal.classList.remove('hidden');
        elements.itemOptionSelectModal.classList.add('flex');
    }
}

function cancelOptionSelection() {
    if (elements.itemOptionSelectModal) {
        // Handle different UI variants
        const isDesktopUI = document.body.classList.contains('desktop-ui');
        if (isDesktopUI) {
            elements.itemOptionSelectModal.style.display = 'none';
        } else {
            elements.itemOptionSelectModal.classList.add('hidden');
            elements.itemOptionSelectModal.classList.remove('flex');
        }
    }
    currentItemOptionContext = null;
    resetMultiStepSelection();
}

function confirmOptionSelection() {
    if (!itemBeingConfigured || !elements.optionModalOptionsContainer || !currentItemOptionContext) {
        console.error("State missing for confirmOptionSelection", itemBeingConfigured, currentItemOptionContext);
        return;
    }

    if (currentItemOptionContext === 'general_item_option') {
        const checkedBoxes = elements.optionModalOptionsContainer.querySelectorAll('input[type="checkbox"]:checked');
        const generalSelectionsWithOptions = Array.from(checkedBoxes).map(cb => {
            return {
                name: cb.value,
                priceChange: parseFloat(cb.dataset.priceChange || 0)
            };
        });

        finalizeAndAddOrderItem(itemBeingConfigured, generalSelectionsWithOptions);
        resetMultiStepSelection();
        cancelOptionSelection();
    }
}


// --- Management Modal, Login & Data Logic ---
let currentManagementTab = 'analytics';
let tempItemOptionsModal = [];

function openLoginModal() {
    console.log('Opening login modal...');
    
    // If loginModal is not found, try to find it again
    if (!elements.loginModal) {
        console.log('Login modal not found, searching for elements...');
        elements.loginModal = document.getElementById('loginModal');
        elements.loginForm = document.getElementById('loginForm');
        elements.passwordInput = document.getElementById('passwordInput');
        elements.loginError = document.getElementById('loginError');
        elements.loginSubmitBtn = document.getElementById('loginSubmitBtn');
        
        if (!elements.loginModal) {
            console.log('Login modal still not found, creating fallback...');
            createFallbackLoginModal();
            return;
        } else {
            console.log('Login modal elements found and cached');
        }
    }
    
    elements.passwordInput.value = '';
    elements.loginError.classList.add('hidden');
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.loginModal.style.display = 'flex';
    } else {
        elements.loginModal.classList.remove('hidden');
        elements.loginModal.classList.add('flex');
    }
    elements.passwordInput.focus();
    console.log('Login modal opened successfully');
}

function createFallbackLoginModal() {
    const modalHTML = `
        <div id="loginModal" class="fixed inset-0 bg-black bg-opacity-70 z-[90] flex items-center justify-center p-4">
            <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-gray-800">
                <h3 class="text-xl font-semibold mb-4 text-center">Management Access</h3>
                <form id="loginForm">
                    <div class="space-y-4">
                        <div>
                            <label for="passwordInput" class="block text-sm font-medium text-gray-700">Password</label>
                            <input type="password" id="passwordInput" name="password" class="mt-1 block w-full px-3 py-2 border border-gray-400 rounded-md shadow-sm sm:text-sm" required>
                        </div>
                        <p id="loginError" class="text-sm text-red-600 text-center hidden"></p>
                        <div class="flex gap-2 pt-2">
                            <button type="button" class="w-full py-2 px-4 btn-secondary" onclick="closeLoginModal()">Cancel</button>
                            <button type="submit" id="loginSubmitBtn" class="w-full py-2 px-4 btn-primary">Login</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Cache the new elements
    elements.loginModal = document.getElementById('loginModal');
    elements.loginForm = document.getElementById('loginForm');
    elements.passwordInput = document.getElementById('passwordInput');
    elements.loginError = document.getElementById('loginError');
    elements.loginSubmitBtn = document.getElementById('loginSubmitBtn');
    
    // Add event listener for the form
    if (elements.loginForm) {
        elements.loginForm.addEventListener('submit', handleLogin);
    }
    
}

function createFallbackManagementModal() {
    const modalHTML = `
        <div id="managementModal" class="fixed inset-0 bg-black bg-opacity-50 z-[70] flex flex-col justify-end sm:justify-center sm:items-center">
            <div class="bg-white shadow-xl w-full h-[90vh] sm:h-auto sm:max-h-[90vh] sm:max-w-6xl flex flex-col text-gray-800 rounded-t-2xl sm:rounded-lg">
                <div class="p-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
                    <h2 class="text-xl font-semibold">Management</h2>
                    <button onclick="closeManagementModal()" class="text-gray-500 hover:text-black"><i class="fas fa-times text-2xl"></i></button>
                </div>
                <div class="p-2 border-b border-gray-200 management-tab-container flex-shrink-0">
                    <div class="flex flex-wrap gap-1 rounded-md bg-gray-100 p-1">
                        <button onclick="switchManagementTab('analytics', this)" class="management-tab flex-1 py-2 px-2 text-xs sm:text-sm font-medium rounded-md bg-white shadow-sm text-gray-800">Analytics</button>
                        <button onclick="switchManagementTab('items', this)" class="management-tab flex-1 py-2 px-2 text-xs sm:text-sm font-medium rounded-md text-gray-600 hover:bg-gray-200">Items</button>
                        <button onclick="switchManagementTab('categories', this)" class="management-tab flex-1 py-2 px-2 text-xs sm:text-sm font-medium rounded-md text-gray-600 hover:bg-gray-200">Categories</button>
                        <button onclick="switchManagementTab('orderHistory', this)" class="management-tab flex-1 py-2 px-2 text-xs sm:text-sm font-medium rounded-md text-gray-600 hover:bg-gray-200">Order History</button>
                        <button onclick="openDaySummaryModal()" class="flex-1 py-2 px-2 text-xs sm:text-sm font-medium rounded-md text-gray-600 hover:bg-gray-200 bg-blue-100">Day Summary</button>
                    </div>
                </div>
                <div class="flex-grow overflow-y-auto p-4 management-content">
                    <div id="analyticsManagement">
                        <h3 class="text-xl font-semibold text-gray-800 mb-4">Analytics Dashboard</h3>
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                            <div class="flex items-center">
                                <i class="fas fa-exclamation-triangle text-yellow-600 mr-2"></i>
                                <span class="text-yellow-800 font-medium">Limited Functionality</span>
                            </div>
                            <p class="text-yellow-700 text-sm mt-2">
                                The management component could not be loaded. This may be due to browser security restrictions when opening files directly.
                                <br><br>
                                <strong>Solution:</strong> Serve the files through a local server:
                                <br>
                                <code class="bg-yellow-100 px-2 py-1 rounded text-xs">python -m http.server 8000</code>
                                <br>
                                Then access via: <code class="bg-yellow-100 px-2 py-1 rounded text-xs">http://localhost:8000</code>
                            </p>
                        </div>
                        <p class="text-gray-600">Analytics content would be loaded here.</p>
                    </div>
                    <div id="itemsManagement" class="hidden">
                        <h3 class="text-xl font-semibold text-gray-800 mb-4">Items Management</h3>
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                            <p class="text-yellow-700 text-sm">
                                Items management functionality requires the full management component to be loaded.
                            </p>
                        </div>
                        <p class="text-gray-600">Items management content would be loaded here.</p>
                    </div>
                    <div id="categoriesManagement" class="hidden">
                        <h3 class="text-xl font-semibold text-gray-800 mb-4">Categories Management</h3>
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                            <p class="text-yellow-700 text-sm">
                                Categories management functionality requires the full management component to be loaded.
                            </p>
                        </div>
                        <p class="text-gray-600">Categories management content would be loaded here.</p>
                    </div>
                    <div id="orderHistoryManagement" class="hidden">
                        <h3 class="text-xl font-semibold text-gray-800 mb-4">Order History</h3>
                        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                            <p class="text-yellow-700 text-sm">
                                Order history functionality requires the full management component to be loaded.
                            </p>
                        </div>
                        <p class="text-gray-600">Order history content would be loaded here.</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Cache the new element
    elements.managementModal = document.getElementById('managementModal');
    
}

function closeLoginModal() {
    if (!elements.loginModal) return;
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.loginModal.style.display = 'none';
    } else {
        elements.loginModal.classList.add('hidden');
        elements.loginModal.classList.remove('flex');
    }
}

async function handleLogin(event) {
    event.preventDefault();
    if (!elements.passwordInput || !elements.loginSubmitBtn || !elements.loginError) return;

    const password = elements.passwordInput.value;
    elements.loginSubmitBtn.disabled = true;
    elements.loginSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    elements.loginError.classList.add('hidden');

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                password: password
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            closeLoginModal();
            openManagementModal();
        } else {
            elements.loginError.textContent = result.message || t('ui.login.loginFailed','Login failed. Please try again.');
            elements.loginError.classList.remove('hidden');
            elements.passwordInput.select();
        }
    } catch (error) {
        console.error('Login error:', error);
        elements.loginError.textContent = t('ui.login.networkError','A network error occurred. Please try again.');
        elements.loginError.classList.remove('hidden');
    } finally {
        elements.loginSubmitBtn.disabled = false;
        elements.loginSubmitBtn.textContent = 'Login';
    }
}

async function loadAppVersion() {
    if (!elements.appVersion) return;
    try {
        const response = await fetch('/api/version');
        if (!response.ok) throw new Error('Failed to fetch version');
        const data = await response.json();
        elements.appVersion.textContent = data.version;
    } catch (error) {
        console.error("Error fetching app version:", error);
        elements.appVersion.textContent = 'N/A';
    }
}

// Function to handle settings gear click - provides direct access to management modal
function handleSettingsGearClick() {
    console.log('Settings gear clicked - opening management modal directly');
    
    // Add debugging
    console.log('Elements object:', elements);
    console.log('Management modal element:', elements.managementModal);
    
    // Try to find the modal directly if not cached
    const modalElement = document.getElementById('managementModal');
    console.log('Direct getElementById result:', modalElement);
    
    if (!modalElement) {
        console.error('Management modal element not found!');
        alert('Error: Management modal not found. Please refresh the page.');
        return;
    }
    
    // For business use, provide direct access to management features
    // This bypasses the login modal for better user experience
    openManagementModal();
}

function openManagementModal() {
    // If managementModal is not found, try to find it again
    if (!elements.managementModal) {
        elements.managementModal = document.getElementById('managementModal');
        
        if (!elements.managementModal) {
            createFallbackManagementModal();
            return;
        }
    }
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.managementModal.style.display = 'flex';
    } else {
        elements.managementModal.classList.remove('hidden');
        elements.managementModal.classList.add('flex');
    }

    document.body.style.overflow = 'hidden';
    loadManagementData();
    loadAppVersion();
    checkAndDisplayTrialStatus();

    // Default to licensing dashboard for better UX
    const licensingTabButton = document.querySelector('.management-tab[onclick*="\'licensing\'"]');
    if (licensingTabButton) {
        switchManagementTab('licensing', licensingTabButton);
    } else {
        // Fallback to analytics if licensing tab not found
        const analyticsTabButton = document.querySelector('.management-tab[onclick*="\'analytics\'"]');
        if (analyticsTabButton) {
            switchManagementTab('analytics', analyticsTabButton);
        }
    }
}

function closeManagementModal() {
    if (!elements.managementModal) return;
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.managementModal.style.display = 'none';
    } else {
        elements.managementModal.classList.add('hidden');
        elements.managementModal.classList.remove('flex');
    }
    document.body.style.overflow = '';
}


function switchManagementTab(tabName, clickedButton) {
    currentManagementTab = tabName;
    
    const isDesktopUI = document.body.classList.contains('desktop-ui');

    if (isDesktopUI) {
        document.querySelectorAll('.management-tab').forEach(t => t.classList.remove('active'));
        if(clickedButton) clickedButton.classList.add('active');
    } else {
        document.querySelectorAll('.management-tab').forEach(btn => {
            btn.classList.remove('bg-white', 'shadow-sm', 'text-gray-800');
            btn.classList.add('text-gray-600', 'hover:bg-gray-200');
        });
        if (clickedButton) {
            clickedButton.classList.add('bg-white', 'shadow-sm', 'text-gray-800');
            clickedButton.classList.remove('text-gray-600', 'hover:bg-gray-200');
        }
    }

    const views = ['licensingManagement', 'analyticsManagement', 'itemsManagement', 'categoriesManagement', 'orderHistoryManagement', 'licenseManagement', 'hardwarePrintingManagement', 'onlineMenuManagement'];
    views.forEach(id => {
        const view = document.getElementById(id);
        if (view) view.style.display = 'none';
    });

    const activeView = document.getElementById(`${tabName}Management`);
    if (activeView) activeView.style.display = 'block';

    if (tabName === 'licensing') {
        loadLicensingDashboard();
    } else if (tabName === 'analytics') {
        const todayButton = document.querySelector('.date-range-btn[onclick*="\'today\'"]');
        loadAnalyticsData('today', todayButton);
    } else if (tabName === 'categories') {
        if (elements.categoryNameInput) elements.categoryNameInput.value = '';
    } else if (tabName === 'orderHistory') {
        loadTodaysOrdersForReprint();
    } else if (tabName === 'license') {
        loadHardwareId();
        // Load and display license information
        loadLicenseInfo();
    } else if (tabName === 'hardwarePrinting') {
        initializeHardwarePrintingUI();
    } else if (tabName === 'onlineMenu') {
        initializeCloudflareUI();
    }
}

async function initializeCloudflareUI() {
    try {
        const resp = await fetch('/api/settings/cloudflare');
        const cfg = await resp.json();
        const slugEl = document.getElementById('cfStoreSlug');
        const urlEl = document.getElementById('cfMenuUrl');
        const publishBtn = document.querySelector('button[onclick="publishOnlineMenu()"]');
        const msgEl = document.getElementById('cfSettingsMsg');
        
        // CRITICAL: If machine has persisted slug, immediately lock everything
        const isLocked = cfg.cloudflare_store_slug_locked || cfg.persisted_slug;
        const effectiveSlug = cfg.cloudflare_store_slug || cfg.persisted_slug || '';
        
        if (slugEl) slugEl.value = effectiveSlug;
        
        // Show URL if available
        const persistedUrl = cfg.persisted_public_url || '';
        const computedUrl = (cfg.cloudflare_public_base && effectiveSlug)
          ? `${cfg.cloudflare_public_base.replace(/\/$/,'')}/s/${effectiveSlug}`
          : '';
        const urlToShow = persistedUrl || computedUrl;
        if (urlToShow) {
            if (urlEl) urlEl.value = urlToShow;
            renderCloudflareQr(urlToShow);
        }
        
        // SECURITY: Lock UI if website exists on this machine
        if (isLocked) {
            if (slugEl) {
                slugEl.disabled = true;
                slugEl.style.backgroundColor = '#f3f4f6';
                slugEl.style.cursor = 'not-allowed';
            }
            if (msgEl) {
                msgEl.textContent = 'Website is published and locked to this machine. You can update menu content only.';
                msgEl.className = 'text-xs text-green-600 mt-1 font-medium';
            }
            if (publishBtn) {
                publishBtn.innerHTML = '<i class="fas fa-sync mr-2"></i>Update Menu';
                publishBtn.title = 'Update existing menu content';
            }
            
            // If config slug is missing but persisted exists, restore it
            if (!cfg.cloudflare_store_slug && cfg.persisted_slug) {
                console.log('Restoring missing slug from persistence:', cfg.persisted_slug);
                await fetch('/api/settings/cloudflare', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        cloudflare_store_slug: cfg.persisted_slug,
                        cloudflare_store_slug_locked: true 
                    })
                });
            }
        } else {
            if (msgEl) {
                msgEl.textContent = 'Enter a unique store name (e.g., cafe-olive). This will become part of your permanent URL.';
                msgEl.className = 'text-xs text-gray-600 mt-1';
            }
            if (publishBtn) {
                publishBtn.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i>Publish Menu';
                publishBtn.title = 'Publish menu online';
            }
        }
    } catch (e) {
        console.error('Failed to init Cloudflare UI:', e);
        const msg = document.getElementById('cfSettingsMsg');
        if (msg) msg.textContent = 'Could not load Cloudflare settings.';
    }
}

// Auto-publish helper: only publish if website is already locked (published)
async function maybeAutoPublishMenu() {
    console.log('maybeAutoPublishMenu() called');
    try {
        const resp = await fetch('/api/settings/cloudflare');
        const cfg = await resp.json();
        console.log('Cloudflare config:', cfg);
        console.log('Slug locked:', cfg.cloudflare_store_slug_locked);
        console.log('Store slug:', cfg.cloudflare_store_slug);
        
        const isLocked = cfg.cloudflare_store_slug_locked || cfg.persisted_slug;
        const effectiveSlug = cfg.cloudflare_store_slug || cfg.persisted_slug;
        
        if (isLocked && effectiveSlug) {
            console.log('Conditions met, auto-publishing...');
            // Website exists, auto-update it
            const publishResp = await fetch('/api/publish/cloudflare', { method: 'POST' });
            console.log('Publish response status:', publishResp.status);
            const publishResult = await publishResp.json();
            console.log('Publish result:', publishResult);
            console.log('Menu auto-published to website');
        } else {
            console.log('Auto-publish skipped: website not locked or no slug');
            console.log('Locked:', isLocked, 'Slug:', effectiveSlug);
        }
    } catch (e) {
        console.warn('Auto-publish failed:', e);
    }
}

function getCloudflareUrlFromInputs() {
    const publicBase = (document.getElementById('cfPublicBase')||{}).value || '';
    const slug = (document.getElementById('cfStoreSlug')||{}).value || '';
    if (!publicBase || !slug) return '';
    const base = publicBase.replace(/\/$/, '');
    return `${base}/s/${slug}`;
}

function renderCloudflareQr(url) {
    const container = document.getElementById('cfQrContainer');
    if (!container) return;
    container.innerHTML = '';
    try {
        if (typeof QRCode === 'function') {
            // 144px square QR
            new QRCode(container, { text: url, width: 144, height: 144, correctLevel: (window.QRCode && window.QRCode.CorrectLevel && window.QRCode.CorrectLevel.M) || 1 });
        } else {
            container.textContent = 'QR library not loaded';
        }
    } catch (e) {
        container.textContent = 'QR generation failed';
    }
}

async function saveCloudflareSettings() {
    const apiBase = (document.getElementById('cfApiBase')||{}).value || '';
    const apiKey = (document.getElementById('cfApiKey')||{}).value || '';
    const storeSlug = (document.getElementById('cfStoreSlug')||{}).value || '';
    const publicBase = (document.getElementById('cfPublicBase')||{}).value || '';
    const msg = document.getElementById('cfSettingsMsg');
    try {
        const resp = await fetch('/api/settings/cloudflare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cloudflare_api_base: apiBase,
                cloudflare_api_key: apiKey,
                cloudflare_store_slug: storeSlug,
                cloudflare_public_base: publicBase
            })
        });
        const res = await resp.json();
        if (res && res.success) {
            if (msg) { msg.textContent = 'Settings saved.'; }
            const url = getCloudflareUrlFromInputs();
            if (url) {
                const urlEl = document.getElementById('cfMenuUrl');
                if (urlEl) urlEl.value = url;
                renderCloudflareQr(url);
            }
            showToast('Cloudflare settings saved.', 'success');
        } else {
            const err = (res && res.message) || 'Failed to save settings';
            if (msg) { msg.textContent = err; }
            showToast(err, 'error');
        }
    } catch (e) {
        if (msg) { msg.textContent = 'Network error saving settings.'; }
        showToast('Network error saving settings.', 'error');
    }
}

async function publishOnlineMenu() {
    const btn = event && event.target && event.target.closest('button');
    const msg = document.getElementById('cfPublishMsg');
    try {
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Publishing...'; }
        if (msg) msg.textContent = '';
        // 1) Save slug to server (normalized server-side)
        const slugEl = document.getElementById('cfStoreSlug');
        const slugRaw = slugEl ? (slugEl.value || '') : '';
        const slug = (slugRaw || '').trim();
        if (!slug) {
            if (msg) msg.textContent = 'Please enter a store slug (e.g., cafetest).';
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i>Publish Menu'; }
            return;
        }
        const saveResp = await fetch('/api/settings/cloudflare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cloudflare_store_slug: slug })
        });
        const saveRes = await saveResp.json().catch(()=>({}));
        if (!saveResp.ok || !saveRes.success) {
            const err = (saveRes && saveRes.message) || `Failed to save slug (HTTP ${saveResp.status})`;
            if (msg) msg.textContent = err;
            showToast(err, 'error');
            return;
        }
        // 2) Publish
        const resp = await fetch('/api/publish/cloudflare', { method: 'POST' });
        const res = await resp.json();
        if (res && res.success) {
            const urlEl = document.getElementById('cfMenuUrl');
            let url = res.url || '';
            if (urlEl) urlEl.value = url || '';
            if (url) renderCloudflareQr(url);
            showToast('Menu published online.', 'success');
            if (msg) msg.textContent = 'Published successfully.';
        } else {
            const err = (res && (res.message || (res.details && (res.details.message || res.details.text)))) || 'Publish failed';
            showToast(err, 'error');
            if (msg) msg.textContent = err;
        }
    } catch (e) {
        showToast('Network error during publish.', 'error');
        if (msg) msg.textContent = 'Network error during publish.';
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i>Publish Menu'; }
    }
}

async function copyCloudflareUrl() {
    try {
        const urlEl = document.getElementById('cfMenuUrl');
        const val = urlEl ? (urlEl.value || '') : '';
        if (!val) { showToast('No URL to copy.', 'warning'); return; }
        await navigator.clipboard.writeText(val);
        showToast('URL copied to clipboard.', 'success');
    } catch (e) {
        showToast('Could not copy URL.', 'error');
    }
}

function populateManagementCategorySelect() {
    if (!elements.itemCategorySelect) return;
    const currentCategoryValue = elements.itemCategorySelect.value;
    elements.itemCategorySelect.innerHTML = Object.keys(menu)
        .map(c => `<option value="${c}">${c}</option>`)
        .join('');
    if (Object.keys(menu).length === 0) {
        elements.itemCategorySelect.innerHTML = '<option value="">Create a category first</option>';
    } else if (currentCategoryValue && menu[currentCategoryValue]) {
        elements.itemCategorySelect.value = currentCategoryValue;
    } else if (elements.itemCategorySelect.options.length > 0) {
        elements.itemCategorySelect.selectedIndex = 0;
    }
}

function loadManagementData() {
    populateManagementCategorySelect();
    renderExistingItemsInModal();
    renderExistingCategoriesInModal();
}

async function initializeHardwarePrintingUI() {
    try {
        // Load settings
        const settingsResp = await fetch('/api/settings/printing');
        const settings = await settingsResp.json();
        const cutToggle = document.getElementById('cutAfterPrintToggle');
        if (cutToggle) cutToggle.checked = !!settings.cut_after_print;
        const copiesInput = document.getElementById('copiesPerOrderInput');
        if (copiesInput) {
            const val = parseInt(settings.copies_per_order);
            copiesInput.value = isNaN(val) ? 2 : Math.max(1, Math.min(10, val));
        }
        await refreshPrinters();
        
        // Load network settings
        await loadNetworkSettings();
        
    } catch (e) {
        console.error('Failed to initialize Hardware & Printing UI:', e);
    }
}

async function refreshPrinters() {
    try {
        const resp = await fetch('/api/printers');
        const data = await resp.json();
        const sel = document.getElementById('printerSelect');
        if (!sel) return;
        sel.innerHTML = '';
        (data.printers || []).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            if (name === data.selected) opt.selected = true;
            sel.appendChild(opt);
        });
        updatePrinterStatusDot();
    } catch (e) {
        console.error('Failed to load printers:', e);
    }
}

async function updatePrinterStatusDot() {
    try {
        const sel = document.getElementById('printerSelect');
        const dot = document.getElementById('printerStatusDot');
        if (!sel || !dot) return;
        const name = encodeURIComponent(sel.value || '');
        const resp = await fetch(`/api/printer/status?name=${name}`);
        const info = await resp.json();
        let statusText = 'Unknown';
        let color = '#6b7280';
        
        // Check session verification status first
        if (printerVerificationStatus === 'verified') {
            statusText = 'Ready'; color = '#16a34a';
        } else if (info && typeof info.status_code === 'number') {
            const code = info.status_code;
            // Map 0 to Unknown (gray) instead of Ready; Ready will be set only after verification
            if (code !== 0) { statusText = 'Attention'; color = '#f59e0b'; }
            else { statusText = 'Unknown'; color = '#6b7280'; }
        } else if (info && info.error) {
            statusText = 'Offline'; color = '#ef4444';
        }
        dot.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:9999px;background:${color}"></span><span>${statusText}</span></span>`;
    } catch (e) {
        console.error('Failed to update printer status:', e);
    }
}

async function saveSelectedPrinter() {
    try {
        const sel = document.getElementById('printerSelect');
        if (!sel) return;
        const resp = await fetch('/api/printer/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ printer_name: sel.value })
        });
        const res = await resp.json();
        if (res.success) {
            showToast('Default printer saved.', 'success');
            updatePrinterStatusDot();
        } else {
            showToast(res.message || 'Failed to save printer.', 'error');
        }
    } catch (e) {
        showToast('Error saving printer.', 'error');
    }
}

async function testPrint() {
    const btn = event && event.target && event.target.closest('button');
    const resultEl = document.getElementById('lastTestPrintResult');
    try {
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Testing...'; }
        const resp = await fetch('/api/printer/test', { method: 'POST' });
        const res = await resp.json();
        if (res.success) {
            printerVerificationStatus = 'verified'; // Update session status
            if (resultEl) { resultEl.textContent = `Last test: Success (Printed) ${new Date().toLocaleTimeString()}`; resultEl.className = 'text-xs text-green-600'; }
            const dot = document.getElementById('printerStatusDot');
            if (dot) dot.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px"><span style=\"width:10px;height:10px;border-radius:9999px;background:#16a34a\"></span><span>Ready</span></span>`;
        } else {
            printerVerificationStatus = 'failed'; // Update session status
            if (resultEl) { resultEl.textContent = `Last test: Failed (${new Date().toLocaleTimeString()})`; resultEl.className = 'text-xs text-red-600'; }
            showToast(res.message || 'Test print failed.', 'error');
        }
    } catch (e) {
        printerVerificationStatus = 'failed'; // Update session status
        if (resultEl) { resultEl.textContent = `Last test: Error (${new Date().toLocaleTimeString()})`; resultEl.className = 'text-xs text-red-600'; }
        showToast('Error performing test print.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Test Print'; }
    }
}

async function openPdfFolder() {
    try {
        const resp = await fetch('/api/open_pdf_folder', { method: 'POST' });
        const res = await resp.json();
        if (!res.success) {
            showToast(res.message || 'Could not open PDF folder.', 'error');
        }
    } catch (e) {
        showToast('Error opening PDF folder.', 'error');
    }
}

async function changeManagementPassword() {
    try {
        const currentEl = document.getElementById('currentPasswordInput');
        const newEl = document.getElementById('newPasswordInput');
        const confirmEl = document.getElementById('confirmPasswordInput');
        const current = currentEl ? currentEl.value : '';
        const next = newEl ? newEl.value : '';
        const confirm = confirmEl ? confirmEl.value : '';
        if (next !== confirm) {
            showToast('New and confirm do not match.', 'warning');
            return;
        }
        const resp = await fetch('/api/settings/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_password: current, new_password: next })
        });
        const res = await resp.json();
        if (res.success) {
            showToast('Password updated.', 'success');
            if (currentEl) currentEl.value = '';
            if (newEl) newEl.value = '';
            if (confirmEl) confirmEl.value = '';
        } else {
            showToast(res.message || 'Failed to update password.', 'error');
        }
    } catch (e) {
        showToast('Error updating password.', 'error');
    }
}

// Network Settings Functions
async function loadNetworkSettings() {
    // Check if network settings UI elements exist (mobile version doesn't have them)
    const currentPortDisplay = document.getElementById('currentPortDisplay');
    const adminStatus = document.getElementById('adminStatus');
    const portSelectionArea = document.getElementById('portSelectionArea');
    
    if (!currentPortDisplay || !adminStatus || !portSelectionArea) {
        // Mobile version - skip network settings loading
        return;
    }
    
    try {
        const response = await fetch('/api/settings/network');
        const settings = await response.json();
        
        // Update current port display
        currentPortDisplay.textContent = settings.port;
        
        // Show admin status
        updateAdminStatus(settings.is_admin);
        
        // Disable port selection if not admin
        if (!settings.is_admin) {
            portSelectionArea.style.opacity = '0.5';
            portSelectionArea.style.pointerEvents = 'none';
        }
        
    } catch (error) {
        console.error('Error loading network settings:', error);
        showToast('Error loading network settings.', 'error');
    }
}

function updateAdminStatus(isAdmin) {
    const statusDiv = document.getElementById('adminStatus');
    const statusText = document.getElementById('adminStatusText');
    
    if (isAdmin) {
        statusDiv.className = 'p-2 rounded text-sm bg-green-50 border border-green-200 mb-3';
        statusText.innerHTML = '<i class="fas fa-check-circle text-green-600 mr-1"></i>Running as Administrator - Port changes available';
    } else {
        statusDiv.className = 'p-2 rounded text-sm bg-red-50 border border-red-200 mb-3';
        statusText.innerHTML = '<i class="fas fa-times-circle text-red-600 mr-1"></i>Not Administrator - Must restart as Administrator to change ports';
    }
}

function toggleInstructions() {
    const panel = document.getElementById('instructionsPanel');
    const arrow = document.getElementById('instructionsArrow');
    
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        arrow.classList.add('rotate-90');
    } else {
        panel.classList.add('hidden');
        arrow.classList.remove('rotate-90');
    }
}

async function changePort() {
    const selectedPort = document.querySelector('input[name="selectedPort"]:checked');
    if (!selectedPort) {
        showToast('Please select a port first.', 'error');
        return;
    }
    
    const newPort = parseInt(selectedPort.value);
    const resultSpan = document.getElementById('portChangeResult');
    const changeBtn = document.getElementById('changePortBtn');
    
    // Disable button and show loading
    changeBtn.disabled = true;
    changeBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Changing Port...';
    resultSpan.textContent = 'Updating configuration and firewall...';
    resultSpan.className = 'text-sm text-blue-600';
    
    try {
        // Change the port in config
        const response = await fetch('/api/settings/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: newPort })
        });
        
        if (!response.ok) {
            throw new Error('Failed to update port configuration');
        }
        
        // Setup firewall rule for new port
        const firewallResponse = await fetch('/api/windows_firewall/open_port', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: newPort })
        });
        
        const firewallResult = await firewallResponse.json();
        
        // Update UI
        document.getElementById('currentPortDisplay').textContent = newPort;
        
        if (firewallResult.success) {
            resultSpan.textContent = `✅ Port changed to ${newPort} and firewall configured! Restart POSPal to use new port.`;
            resultSpan.className = 'text-sm text-green-600';
            showToast(`Port changed to ${newPort}! Please restart POSPal.`, 'success');
        } else {
            resultSpan.textContent = `⚠️ Port changed to ${newPort} but firewall setup failed. You may need to manually allow port ${newPort}.`;
            resultSpan.className = 'text-sm text-orange-600';
            showToast(`Port changed but firewall setup failed: ${firewallResult.message}`, 'warning');
        }
        
        // Clear radio selection
        selectedPort.checked = false;
        
    } catch (error) {
        console.error('Error changing port:', error);
        resultSpan.textContent = `❌ Failed to change port: ${error.message}`;
        resultSpan.className = 'text-sm text-red-600';
        showToast('Error changing port.', 'error');
    } finally {
        // Re-enable button
        changeBtn.disabled = false;
        changeBtn.innerHTML = '<i class="fas fa-exchange-alt mr-2"></i>Change Port';
        
        // Auto-hide result message
        setTimeout(() => {
            resultSpan.textContent = '';
        }, 8000);
    }
}

// Persist settings when toggles change
document.addEventListener('change', async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.id;
    if (id === 'cutAfterPrintToggle') {
        try {
            const payload = {};
            payload.cut_after_print = target.checked;
            const resp = await fetch('/api/settings/printing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const res = await resp.json();
            if (!res.success) showToast(res.message || 'Failed to save setting.', 'error');
        } catch (err) {
            showToast('Error saving setting.', 'error');
        }
    } else if (id === 'copiesPerOrderInput') {
        try {
            const n = parseInt(target.value);
            const safe = isNaN(n) ? 2 : Math.max(1, Math.min(10, n));
            target.value = safe;
            const resp = await fetch('/api/settings/printing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ copies_per_order: safe })
            });
            const res = await resp.json();
            if (!res.success) showToast(res.message || 'Failed to save copies per order.', 'error');
            else showToast('Saved.', 'success');
        } catch (err) {
            showToast('Error saving copies per order.', 'error');
        }
    } else if (id === 'printerSelect') {
        updatePrinterStatusDot();
    }
});

// Handle radio button changes for port selection
document.addEventListener('change', (e) => {
    if (e.target.name === 'selectedPort') {
        const changeBtn = document.getElementById('changePortBtn');
        const helpText = changeBtn.nextElementSibling;
        
        changeBtn.disabled = false;
        helpText.textContent = `Ready to change to port ${e.target.value}`;
        helpText.classList.remove('text-gray-500');
        helpText.classList.add('text-blue-600');
    }
});


function renderExistingItemsInModal() {
    if (!elements.existingItemsListModal) return;
    elements.existingItemsListModal.innerHTML = '';
    let itemCount = 0;
    
    Object.entries(menu).forEach(([category, items]) => {
        if (!items || items.length === 0) return;

        // Category header (shown on both UIs for consistent grouping)
        const categoryHeader = document.createElement('h5');
        categoryHeader.className = "font-bold text-gray-700 mt-3 mb-1 pb-1 border-b border-gray-300";
        categoryHeader.textContent = category;
        elements.existingItemsListModal.appendChild(categoryHeader);

        (items || []).forEach((item, index) => {
            itemCount++;
            const div = document.createElement('div');
            div.className = `p-2 border border-gray-300 rounded-md flex justify-between items-center text-sm bg-white hover:bg-gray-50`;

            let itemDetails = `<span class="font-medium text-gray-800">${item.name}</span>
                               <span class="text-xs text-gray-500 ml-1">- €${(item.price || 0).toFixed(2)}</span>`;
            if (item.hasGeneralOptions && item.generalOptions && item.generalOptions.length > 0) {
                itemDetails += `<span class="text-xs text-blue-600 ml-2">(+ Options)</span>`;
            }

            const isFirst = index === 0;
            const isLast = index === items.length - 1;
            const reorderButtons = `
                <div class="flex items-center">
                    <button onclick="moveItemPosition(${item.id}, 'up')" class="px-2 py-1 text-gray-500 hover:text-black ${isFirst ? 'opacity-25 cursor-not-allowed' : ''}" ${isFirst ? 'disabled' : ''} title="Move Up"><i class="fas fa-arrow-up"></i></button>
                    <button onclick="moveItemPosition(${item.id}, 'down')" class="px-2 py-1 text-gray-500 hover:text-black ${isLast ? 'opacity-25 cursor-not-allowed' : ''}" ${isLast ? 'disabled' : ''} title="Move Down"><i class="fas fa-arrow-down"></i></button>
                </div>`;

            div.innerHTML = `
                <div class="flex items-center">
                    ${reorderButtons}
                    <div class="ml-2">${itemDetails}</div>
                </div>
                <div class="space-x-1 flex-shrink-0">
                    <button onclick=\"openItemFormModal(${item.id})\" class=\"px-2 py-1 text-xs btn-warning text-white rounded hover:opacity-80\" data-i18n=\"ui.items.edit\">Edit</button>
                    <button onclick=\"deleteItem(${item.id})\" class=\"px-2 py-1 text-xs btn-danger text-white rounded hover:opacity-80\" data-i18n=\"ui.items.delete\">Delete</button>
                </div>`;

            elements.existingItemsListModal.appendChild(div);
        });
    });
    if (itemCount === 0) {
        elements.existingItemsListModal.innerHTML = '<p class="text-xs text-gray-500 italic">No items created yet.</p>';
    }
}


async function moveItemPosition(itemIdToMove, direction) {
    let categoryKey = null;
    let itemIndex = -1;

    for (const cat in menu) {
        const index = (menu[cat] || []).findIndex(i => i.id === itemIdToMove);
        if (index !== -1) {
            categoryKey = cat;
            itemIndex = index;
            break;
        }
    }

    if (categoryKey === null || itemIndex === -1) {
        showToast("Could not find item to move.", "error");
        return;
    }

    const itemsArray = menu[categoryKey];
    const itemToMove = itemsArray[itemIndex];

    if (direction === 'up' && itemIndex > 0) {
        itemsArray.splice(itemIndex, 1);
        itemsArray.splice(itemIndex - 1, 0, itemToMove);
    } else if (direction === 'down' && itemIndex < itemsArray.length - 1) {
        itemsArray.splice(itemIndex, 1);
        itemsArray.splice(itemIndex + 1, 0, itemToMove);
    } else {
        return;
    }

    const success = await saveMenuToServer();
    if (success) {
        showToast('Item order updated.', 'success');
        await maybeAutoPublishMenu();
        await loadMenu();
        loadManagementData();
    } else {
        showToast('Failed to save new item order. Reverting.', 'error');
        await loadMenu();
        loadManagementData();
    }
}

function renderExistingCategoriesInModal() {
    if (!elements.existingCategoriesListModal) return;
    elements.existingCategoriesListModal.innerHTML = '';
    const categoryKeys = Object.keys(menu);

    if (categoryKeys.length === 0) {
        elements.existingCategoriesListModal.innerHTML = '<p class="text-xs text-gray-500 italic">No categories created yet.</p>';
        return;
    }

    categoryKeys.forEach((categoryName, index) => {
        const div = document.createElement('div');
        const isFirst = index === 0;
        const isLast = index === categoryKeys.length - 1;
        const reorderButtons = `
            <div class="flex items-center">
                <button onclick="moveCategoryPosition('${categoryName}', 'up')" class="px-2 py-1 text-gray-500 hover:text-black ${isFirst ? 'opacity-25 cursor-not-allowed' : ''}" ${isFirst ? 'disabled' : ''} title="Move Up"><i class="fas fa-arrow-up"></i></button>
                <button onclick="moveCategoryPosition('${categoryName}', 'down')" class="px-2 py-1 text-gray-500 hover:text-black ${isLast ? 'opacity-25 cursor-not-allowed' : ''}" ${isLast ? 'disabled' : ''} title="Move Down"><i class="fas fa-arrow-down"></i></button>
            </div>`;
        div.className = "p-2 border border-gray-300 rounded-md flex justify-between items-center text-sm bg-white hover:bg-gray-50";
        div.innerHTML = `
            <div class="flex items-center">
                ${reorderButtons}
                <span class="font-medium text-gray-800 ml-2">${categoryName}</span>
            </div>
            <button onclick="deleteCategory('${categoryName}')" class="px-2 py-1 text-xs btn-danger text-white rounded hover:opacity-80">Delete</button>
        `;
        elements.existingCategoriesListModal.appendChild(div);
    });
}

async function moveCategoryPosition(categoryNameToMove, direction) {
    const keys = Object.keys(menu);
    const index = keys.indexOf(categoryNameToMove);

    if (index === -1) {
        showToast("Could not find category to move.", "error");
        return;
    }

    let newIndex;
    if (direction === 'up') {
        if (index === 0) return;
        newIndex = index - 1;
    } else {
        if (index === keys.length - 1) return;
        newIndex = index + 1;
    }

    [keys[index], keys[newIndex]] = [keys[newIndex], keys[index]];

    const newMenu = {};
    keys.forEach(key => {
        newMenu[key] = menu[key];
    });
    menu = newMenu;

    const success = await saveMenuToServer();
    if (success) {
        showToast('Category order updated.', 'success');
        await maybeAutoPublishMenu();
        renderCategories();
        loadManagementData();
    } else {
        showToast('Failed to save new category order. Reverting.', 'error');
        await loadMenu();
        loadManagementData();
    }
}


function generateItemId() {
    const allItems = [].concat(...Object.values(menu).map(categoryItems => categoryItems || []));
    return allItems.length > 0 ? Math.max(0, ...allItems.map(i => i.id || 0)) + 1 : 1;
}

function resetItemForm() {
    editingItem = null;
    if (elements.itemNameInput) elements.itemNameInput.value = '';
    if (elements.itemPriceInput) elements.itemPriceInput.value = '';
    if (elements.itemIdInput) elements.itemIdInput.value = '';
    if (elements.itemCategorySelect && elements.itemCategorySelect.options.length > 0) elements.itemCategorySelect.selectedIndex = 0;

    if (elements.itemHasOptionsCheckboxModal) elements.itemHasOptionsCheckboxModal.checked = false;
    tempItemOptionsModal = [];

    if (elements.newOptionNameInputModal) elements.newOptionNameInputModal.value = '';
    if (elements.newOptionPriceInputModal) elements.newOptionPriceInputModal.value = '';

    // Reset enhanced menu fields
    resetEnhancedMenuFields();

    toggleItemOptionsUIInModal();
}

function openItemFormModal(itemIdToEdit = null) {
    resetItemForm();
    if (itemIdToEdit !== null) {
        elements.itemFormModalTitle.textContent = t('ui.items.editItem', 'Edit Item');
        populateItemFormForEdit(itemIdToEdit);
    } else {
        elements.itemFormModalTitle.textContent = t('ui.items.editItem', 'Add New Item');
        if (elements.saveItemBtn) elements.saveItemBtn.innerHTML = '💾 ' + t('ui.items.saveNewItem', 'Save New Item');
    }
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.itemFormModal.style.display = 'flex';
    } else {
        elements.itemFormModal.classList.remove('hidden');
        elements.itemFormModal.classList.add('flex');
    }
}

function closeItemFormModal() {
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.itemFormModal.style.display = 'none';
    } else {
        elements.itemFormModal.classList.add('hidden');
        elements.itemFormModal.classList.remove('flex');
    }
    resetItemForm();
}

function populateItemFormForEdit(itemIdToEdit) {
    let foundItem;
    let itemCategoryName;
    Object.entries(menu).forEach(([category, items]) => {
        const item = (items || []).find(i => i.id === itemIdToEdit);
        if (item) {
            foundItem = item;
            itemCategoryName = category;
        }
    });

    if (foundItem) {
        editingItem = { ...foundItem };
        if (elements.itemNameInput) elements.itemNameInput.value = foundItem.name;
        if (elements.itemPriceInput) elements.itemPriceInput.value = foundItem.price;
        if (elements.itemCategorySelect) elements.itemCategorySelect.value = itemCategoryName;
        if (elements.itemIdInput) elements.itemIdInput.value = foundItem.id;

        if (foundItem.hasGeneralOptions && foundItem.generalOptions && Array.isArray(foundItem.generalOptions)) {
            tempItemOptionsModal = [...foundItem.generalOptions];
        } else {
            tempItemOptionsModal = [];
        }
        if (elements.itemHasOptionsCheckboxModal) {
            elements.itemHasOptionsCheckboxModal.checked = (foundItem.hasGeneralOptions && tempItemOptionsModal.length > 0);
        }
        toggleItemOptionsUIInModal();

        // Populate enhanced menu data
        populateEnhancedMenuData(foundItem);

        if (elements.saveItemBtn) elements.saveItemBtn.innerHTML = '🔄 Update Item';
    }
}

// Enhanced Menu Data Collection Functions
function collectEnhancedMenuData() {
    const enhancedData = {};

    // Description
    const descriptionField = document.getElementById('itemDescription');
    if (descriptionField && descriptionField.value.trim()) {
        enhancedData.description = descriptionField.value.trim();
    }

    // Preparation time
    const prepTimeField = document.getElementById('itemPrepTime');
    if (prepTimeField && prepTimeField.value && parseInt(prepTimeField.value) > 0) {
        enhancedData.prep_time = parseInt(prepTimeField.value);
    }

    // Dietary tags
    const dietaryTags = [];
    const dietaryCheckboxes = [
        'dietary-vegetarian', 'dietary-vegan', 'dietary-gluten-free',
        'dietary-dairy-free', 'dietary-spicy', 'dietary-popular'
    ];

    dietaryCheckboxes.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox && checkbox.checked) {
            const tag = id.replace('dietary-', '').replace('-', '_');
            dietaryTags.push(tag);
        }
    });

    if (dietaryTags.length > 0) {
        enhancedData.dietary_tags = dietaryTags;
    }

    // Allergen information
    const allergens = [];
    const allergenCheckboxes = [
        'allergen-nuts', 'allergen-dairy', 'allergen-gluten',
        'allergen-seafood', 'allergen-eggs', 'allergen-soy'
    ];

    allergenCheckboxes.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox && checkbox.checked) {
            const allergen = id.replace('allergen-', '');
            allergens.push(allergen);
        }
    });

    if (allergens.length > 0) {
        enhancedData.allergens = allergens;
    }

    return enhancedData;
}

function populateEnhancedMenuData(item) {
    // Reset all enhanced fields first
    resetEnhancedMenuFields();

    // Populate description
    const descriptionField = document.getElementById('itemDescription');
    if (descriptionField && item.description) {
        descriptionField.value = item.description;
    }

    // Populate preparation time
    const prepTimeField = document.getElementById('itemPrepTime');
    if (prepTimeField && item.prep_time) {
        prepTimeField.value = item.prep_time;
    }

    // Populate dietary tags
    if (item.dietary_tags && Array.isArray(item.dietary_tags)) {
        item.dietary_tags.forEach(tag => {
            const checkbox = document.getElementById(`dietary-${tag.replace('_', '-')}`);
            if (checkbox) {
                checkbox.checked = true;
            }
        });
    }

    // Populate allergens
    if (item.allergens && Array.isArray(item.allergens)) {
        item.allergens.forEach(allergen => {
            const checkbox = document.getElementById(`allergen-${allergen}`);
            if (checkbox) {
                checkbox.checked = true;
            }
        });
    }
}

function resetEnhancedMenuFields() {
    // Reset description
    const descriptionField = document.getElementById('itemDescription');
    if (descriptionField) descriptionField.value = '';

    // Reset preparation time
    const prepTimeField = document.getElementById('itemPrepTime');
    if (prepTimeField) prepTimeField.value = '';

    // Reset all checkboxes
    const allCheckboxes = [
        'dietary-vegetarian', 'dietary-vegan', 'dietary-gluten-free',
        'dietary-dairy-free', 'dietary-spicy', 'dietary-popular',
        'allergen-nuts', 'allergen-dairy', 'allergen-gluten',
        'allergen-seafood', 'allergen-eggs', 'allergen-soy'
    ];

    allCheckboxes.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.checked = false;
    });
}

async function saveItem() {
    console.log('saveItem() called');
    if (!elements.itemNameInput || !elements.itemPriceInput || !elements.itemCategorySelect) {
        console.log('Missing form elements:', {
            nameInput: !!elements.itemNameInput,
            priceInput: !!elements.itemPriceInput, 
            categorySelect: !!elements.itemCategorySelect
        });
        return;
    }

    const itemName = elements.itemNameInput.value.trim();
    const itemPrice = parseFloat(elements.itemPriceInput.value);
    const itemCategory = elements.itemCategorySelect.value;

    let itemIdVal = editingItem ? editingItem.id : generateItemId();

    if (isNaN(itemIdVal)) {
        showToast('Error: Invalid Item ID.', 'error');
        return;
    }
    if (!itemName || isNaN(itemPrice) || itemPrice < 0) {
        showToast('Item Name and a valid Base Price are required.', 'warning');
        return;
    }
    if (!itemCategory && Object.keys(menu).length > 0) {
        showToast('Please select a category.', 'warning');
        return;
    }
    if (Object.keys(menu).length === 0 && !itemCategory) {
        showToast('Please create a category first.', 'warning');
        return;
    }

    // Collect enhanced menu data safely
    const enhancedData = collectEnhancedMenuData();

    const itemData = {
        id: itemIdVal,
        name: itemName,
        price: itemPrice,
        hasGeneralOptions: elements.itemHasOptionsCheckboxModal.checked,
        generalOptions: (elements.itemHasOptionsCheckboxModal.checked && tempItemOptionsModal.length > 0) ? [...tempItemOptionsModal] : [],
        // Enhanced fields (all optional - safe backward compatibility)
        ...enhancedData
    };

    if (itemData.hasGeneralOptions && itemData.generalOptions.length === 0) {
        showToast('If "Has General Options" is checked, please add at least one option.', 'warning');
        return;
    }

    if (editingItem) {
        Object.keys(menu).forEach(cat => {
            const itemIndex = (menu[cat] || []).findIndex(i => i.id === editingItem.id);
            if (itemIndex > -1) {
                if (cat !== itemCategory) {
                    menu[cat].splice(itemIndex, 1);
                }
            }
        });
    }

    if (!menu[itemCategory]) menu[itemCategory] = [];

    const existingItemIndex = menu[itemCategory].findIndex(i => i.id === itemData.id);
    if (existingItemIndex > -1) {
        menu[itemCategory][existingItemIndex] = itemData;
    } else {
        menu[itemCategory].push(itemData);
    }

    console.log('About to call saveMenuToServer()');
    const success = await saveMenuToServer();
    console.log('saveMenuToServer() returned:', success);
    if (success) {
        console.log('Save successful, showing toast and auto-publishing');
        showToast(editingItem ? 'Item updated successfully!' : 'Item saved successfully!', 'success');
        console.log('About to call maybeAutoPublishMenu()');
        try {
            await maybeAutoPublishMenu();
            console.log('maybeAutoPublishMenu() completed');
        } catch (e) {
            console.error('Error in maybeAutoPublishMenu():', e);
        }
        closeItemFormModal();
        await loadMenu();
        loadManagementData();
    } else {
        showToast('Failed to save item to server. Reverting.', 'error');
        await loadMenu();
    }
}

async function deleteItem(itemIdToDelete) {
    if (!confirm(t('ui.items.confirmDeleteItem', 'Are you sure you want to delete this item? This cannot be undone.'))) return;

    let itemFoundAndDeletedLocally = false;
    Object.keys(menu).forEach(cat => {
        const itemIndex = (menu[cat] || []).findIndex(i => i.id === itemIdToDelete);
        if (itemIndex > -1) {
            menu[cat].splice(itemIndex, 1);
            itemFoundAndDeletedLocally = true;
        }
    });

    if (!itemFoundAndDeletedLocally) {
        showToast(t('ui.items.itemNotFoundDeletion', 'Item not found for deletion.'), 'warning');
        return;
    }

    const success = await saveMenuToServer();
    if (success) {
        showToast('Item deleted successfully.', 'success');
        await maybeAutoPublishMenu();
        await loadMenu();
        loadManagementData();
    } else {
        showToast('Failed to delete item on server. Reverting.', 'error');
        await loadMenu();
    }
}

async function saveCategory() {
    if (!elements.categoryNameInput) return;
    const categoryName = elements.categoryNameInput.value.trim();
    if (!categoryName) {
        showToast('Category name cannot be empty.', 'warning');
        return;
    }
    if (menu[categoryName]) {
        showToast('Category already exists.', 'warning');
        return;
    }

    const newMenu = { ...menu };
    newMenu[categoryName] = [];

    try {
        const response = await fetch('/api/menu', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newMenu)
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Invalid response: ${text.substring(0, 100)}`);
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to save category');
        }

        menu = newMenu;
        showToast(`Category "${categoryName}" added successfully.`, 'success');
        await maybeAutoPublishMenu();
        elements.categoryNameInput.value = '';
        await loadMenu();
        loadManagementData();

    } catch (error) {
        showToast(`Failed to save category: ${error.message}`, 'error');
    }

}

async function deleteCategory(categoryNameToDelete) {
    if (menu[categoryNameToDelete] && menu[categoryNameToDelete].length > 0) {
        if (!confirm(t('ui.items.confirmDeleteCategoryWithItems', `Category "${categoryNameToDelete}" contains items. Are you sure you want to delete the category AND ALL ITS ITEMS? This cannot be undone.`).replace('{name}', categoryNameToDelete))) return;
    } else {
        if (!confirm(t('ui.items.confirmDeleteCategory', `Are you sure you want to delete category "${categoryNameToDelete}"? This cannot be undone.`).replace('{name}', categoryNameToDelete))) return;
    }
    const backupMenu = JSON.parse(JSON.stringify(menu));
    delete menu[categoryNameToDelete];

    const success = await saveMenuToServer();
    if (success) {
        showToast(t('ui.items.deleteCategorySuccess', `Category "${categoryNameToDelete}" deleted successfully.`).replace('{name}', categoryNameToDelete), 'success');
        await maybeAutoPublishMenu();
        if (selectedCategory === categoryNameToDelete) {
            selectedCategory = Object.keys(menu)[0] || null;
        }
        await loadMenu();
        loadManagementData();
    } else {
        menu = backupMenu;
        showToast(t('ui.items.deleteCategoryFailed', `Failed to delete category "${categoryNameToDelete}" on server. Reverting.`).replace('{name}', categoryNameToDelete), 'error');
        await loadMenu();
        loadManagementData();
    }
}

function toggleItemOptionsUIInModal() {
    const hasOptions = document.getElementById('itemHasOptionsModal').checked;
    document.getElementById('itemOptionsModalContainer').style.display = hasOptions ? 'block' : 'none';

    if (!hasOptions) {
        tempItemOptionsModal = [];
    }
    renderTemporaryOptionsListModal();
}

function addOptionToItemFormTempModal() {
    if (!elements.newOptionNameInputModal || !elements.newOptionPriceInputModal) return;
    const optionName = elements.newOptionNameInputModal.value.trim();
    const priceChangeText = elements.newOptionPriceInputModal.value.trim();
    const priceChange = priceChangeText === "" ? 0 : parseFloat(priceChangeText);

    if (!optionName) {
        showToast('Option name cannot be empty.', 'warning');
        return;
    }
    if (isNaN(priceChange)) {
        showToast('Price change must be a valid number or empty (for 0).', 'warning');
        return;
    }

    if (tempItemOptionsModal.find(opt => opt.name === optionName)) {
        showToast('This general option name already exists for the item.', 'warning');
        return;
    }

    tempItemOptionsModal.push({
        name: optionName,
        priceChange: priceChange
    });
    renderTemporaryOptionsListModal();
    elements.newOptionNameInputModal.value = '';
    elements.newOptionPriceInputModal.value = '';
    elements.newOptionNameInputModal.focus();
}

function renderTemporaryOptionsListModal() {
    if (!elements.itemOptionsListDisplayModal) return;
    elements.itemOptionsListDisplayModal.innerHTML = '';
    if (tempItemOptionsModal.length === 0 && document.getElementById('itemHasOptionsModal').checked) {
        elements.itemOptionsListDisplayModal.innerHTML = '<p class="text-xs text-gray-500 italic w-full">No general options added yet.</p>';
        return;
    } else if (tempItemOptionsModal.length === 0 && !document.getElementById('itemHasOptionsModal').checked) {
        elements.itemOptionsListDisplayModal.innerHTML = '';
        return;
    }

    tempItemOptionsModal.forEach(opt => {
        const pillSpan = document.createElement('span');
        pillSpan.className = 'option-pill';
        const priceDisplay = parseFloat(opt.priceChange || 0) !== 0 ? ` (${parseFloat(opt.priceChange || 0) > 0 ? '+' : ''}€${parseFloat(opt.priceChange || 0).toFixed(2)})` : '';
        pillSpan.textContent = `${opt.name}${priceDisplay}`;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-option-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = `Remove option: ${opt.name}`;
        removeBtn.type = 'button';
        removeBtn.onclick = () => removeTemporaryOptionModal(opt.name);
        pillSpan.appendChild(removeBtn);
        elements.itemOptionsListDisplayModal.appendChild(pillSpan);
    });
}

function removeTemporaryOptionModal(optionNameToRemove) {
    tempItemOptionsModal = tempItemOptionsModal.filter(opt => opt.name !== optionNameToRemove);
    renderTemporaryOptionsListModal();
}

// Toast timeout now handled by TimerManager

function showToast(message, type = 'info', duration = 3000) {
    // Suppress licensing-related toasts during active order operations
    if (isActivelyTakingOrders() && isLicensingRelatedMessage(message)) {
        console.log('Licensing toast suppressed during operations:', message);
        return null;
    }

    // Use unified notification manager for better consistency and performance
    if (window.NotificationManager) {
        return window.NotificationManager.showToast(message, type, duration);
    }

    // Fallback to legacy toast system if NotificationManager not available
    if (!elements.toast || !elements.toastMessage) return;

    TimerManager.clear('toast');
    elements.toastMessage.textContent = message;

    // Reset classes
    elements.toast.className = 'fixed top-5 right-5 text-white px-4 py-2 rounded-md shadow-lg text-sm z-[1800] opacity-0 transition-opacity duration-300';
    const isDesktopUI = document.body.classList.contains('desktop-ui');

    if(isDesktopUI) {
        elements.toast.className = 'fixed top-5 right-5 text-white px-4 py-2 rounded-md shadow-lg text-sm z-[1800] transition-opacity duration-300';
        switch (type) {
            case 'success': elements.toast.style.backgroundColor = '#16a34a'; break;
            case 'warning': elements.toast.style.backgroundColor = '#f59e0b'; break;
            case 'error': elements.toast.style.backgroundColor = '#ef4444'; break;
            default: elements.toast.style.backgroundColor = '#1f2937';
        }
    } else {
        switch (type) {
            case 'success': elements.toast.classList.add('bg-green-600'); break;
            case 'warning': elements.toast.classList.add('bg-yellow-500'); break;
            case 'error': elements.toast.classList.add('bg-red-600'); break;
            default: elements.toast.classList.add('bg-gray-800');
        }
    }

    elements.toast.style.display = 'block';

    // Use TimerManager for initial opacity reveal
    TimerManager.set('toastReveal', () => {
        if(!isDesktopUI) elements.toast.classList.remove('opacity-0')
    }, 10, 'timeout');

    // Use TimerManager for toast hide with fade
    TimerManager.set('toast', () => {
        if(!isDesktopUI) elements.toast.classList.add('opacity-0');
        TimerManager.set('toastHide', () => elements.toast.style.display = 'none', 300, 'timeout');
    }, duration, 'timeout');
}

async function loadTodaysOrdersForReprint() {
    if (!elements.todaysOrdersList) return;
    elements.todaysOrdersList.innerHTML = '<p class="text-xs text-gray-500 italic">' + t('ui.orderHistory.loadingToday','Loading today\'s orders...') + '</p>';
    try {
        const dateEl = document.getElementById('ohDate');
        const rangeEl = document.getElementById('ohRange');
        const startEl = document.getElementById('ohStart');
        const endEl = document.getElementById('ohEnd');
        const searchEl = document.getElementById('ohSearch');
        const dateStr = (dateEl && dateEl.value) ? dateEl.value : new Date().toISOString().slice(0,10);
        const range = rangeEl ? (rangeEl.value || 'all') : 'all';
        let url = `/api/orders_by_date?date=${encodeURIComponent(dateStr)}&range=${encodeURIComponent(range)}`;
        if (range === 'custom' && startEl && endEl && startEl.value && endEl.value) {
            url += `&start=${encodeURIComponent(startEl.value)}&end=${encodeURIComponent(endEl.value)}`;
        }
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                message: `HTTP ${response.status}`
            }));
            throw new Error(errorData.message || `Failed to load orders: ${response.statusText}`);
        }
        let orders = await response.json();
        // Client-side search filter
        const q = (searchEl && (searchEl.value || '').trim().toLowerCase()) || '';
        if (q) {
            orders = orders.filter(o => String(o.order_number||'').toLowerCase().includes(q) || String(o.table_number||'').toLowerCase().includes(q));
        }
        renderTodaysOrdersList(orders);
    } catch (error) {
        console.error("Error loading today's orders for reprint:", error);
        elements.todaysOrdersList.innerHTML = `<p class="text-xs text-red-500 italic">${t('ui.orderHistory.errorLoading','Error loading orders:')} ${error.message}. ${t('ui.orderHistory.tryRefreshing','Try refreshing.')}</p>`;
        showToast(`${t('ui.orderHistory.errorLoading','Error loading orders:')} ${error.message}`, 'error');
    }
}

function renderTodaysOrdersList(orders) {
    if (!elements.todaysOrdersList) return;
    elements.todaysOrdersList.innerHTML = '';

    if (!orders || orders.length === 0) {
        elements.todaysOrdersList.innerHTML = '<p class="text-xs text-gray-500 italic">No orders found for today.</p>';
        return;
    }
    
    const isDesktopUI = document.body.classList.contains('desktop-ui');

    orders.forEach(order => {
        const div = document.createElement('div');
        let formattedTimestamp = order.timestamp;
        try {
            const dateObj = new Date(order.timestamp);
            if (!isNaN(dateObj)) {
                formattedTimestamp = dateObj.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
            }
        } catch (e) { /* keep original */ }

        // Unified mobile-style row for both UIs
        div.className = "p-2.5 border border-gray-300 rounded-md bg-white hover:bg-gray-50";
        div.innerHTML = `
            <div class="flex justify-between items-center text-sm">
                <div>
                    <span class="font-semibold text-gray-800">${t('ui.orderHistory.orderNumber','Order #')}${order.order_number}</span>
                    <span class="text-xs text-gray-600 ml-2">Table: ${order.table_number || 'N/A'}</span>
                    <span class="text-xs text-gray-500 ml-2">${t('ui.orderHistory.time','Time:')} ${formattedTimestamp}</span>
                    <span class="text-xs text-gray-500 ml-2">Total: €${order.order_total || '-'}</span>
                </div>
                <div class="flex items-center gap-1">
                    <button onclick=\"toggleOrderDetails('${order.order_number}')\" class=\"px-3 py-1.5 text-xs btn-secondary rounded hover:opacity-80 transition\">Details</button>
                    <button onclick=\"reprintOrder('${order.order_number}')\" class=\"px-3 py-1.5 text-xs btn-primary text-white rounded hover:opacity-80 transition\">
                        <i class=\"fas fa-print mr-1\"></i> ${t('ui.orderHistory.reprint','Reprint')}
                    </button>
                </div>
            </div>
            <div id="order-details-${order.order_number}" class="hidden mt-2 p-2 bg-gray-50 border border-gray-200 rounded"></div>
        `;
        elements.todaysOrdersList.appendChild(div);
    });
}

// Initialize default date and toggle custom time UI
document.addEventListener('DOMContentLoaded', () => {
    const dateEl = document.getElementById('ohDate');
    const rangeEl = document.getElementById('ohRange');
    const customBox = document.getElementById('ohCustomRange');
    if (dateEl) {
        dateEl.value = new Date().toISOString().slice(0,10);
    }
    if (rangeEl && customBox) {
        rangeEl.addEventListener('change', () => {
            if (rangeEl.value === 'custom') customBox.classList.remove('hidden');
            else customBox.classList.add('hidden');
        });
    }
});

async function toggleOrderDetails(orderNumber) {
    const container = document.getElementById(`order-details-${orderNumber}`);
    if (!container) return;
    const isHidden = container.classList.contains('hidden');
    if (!isHidden) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }
    container.classList.remove('hidden');
    container.innerHTML = '<p class="text-xs text-gray-500 italic">Loading details...</p>';
    try {
        const todayStr = new Date().toISOString().slice(0,10);
        const resp = await fetch(`/api/order_details?date=${todayStr}&order_number=${encodeURIComponent(orderNumber)}`);
        const data = await resp.json();
        if (!resp.ok || data.status === 'error') {
            throw new Error(data.message || `HTTP ${resp.status}`);
        }
        const itemsHtml = (data.items || []).map(it => {
            const opts = (it.generalSelectedOptions || []).map(o => `${o.name}${(o.priceChange||0)?` (+€${Number(o.priceChange).toFixed(2)})`:''}`).join(', ');
            const comment = (it.comment||'').trim();
            return `<li class="mb-1"><span class="font-medium">${it.quantity}x ${it.name}</span> - €${Number(it.itemPriceWithModifiers || it.basePrice || 0).toFixed(2)}${opts?`<div class='text-xs text-gray-600'>Options: ${opts}</div>`:''}${comment?`<div class='text-xs text-gray-600'>Note: ${comment}</div>`:''}</li>`;
        }).join('');
        container.innerHTML = `
            <div class="text-xs text-gray-700">
                <div class="flex flex-wrap gap-3 mb-2">
                    <span><span class="text-gray-500">Table:</span> ${data.table_number || 'N/A'}</span>
                    <span><span class="text-gray-500">Payment:</span> ${String(data.payment_method||'Cash').toUpperCase()}</span>
                    <span><span class="text-gray-500">Total:</span> €${Number(data.order_total||0).toFixed(2)}</span>
                </div>
                ${data.universal_comment ? `<div class="mb-2"><span class="text-gray-500">Order Notes:</span> ${data.universal_comment}</div>` : ''}
                <ul class="list-disc ml-5">
                    ${itemsHtml || '<li class="italic text-gray-500">No items.</li>'}
                </ul>
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<p class="text-xs text-red-600">Failed to load details: ${e.message}</p>`;
    }
}


async function reprintOrder(orderNumToReprint) {
    if (!orderNumToReprint) {
        showToast(t('ui.orderHistory.invalidOrderForReprint','Invalid order number for reprint.'), 'error');
        return;
    }

    const reprintButton = event.target.closest('button');
    if (reprintButton) {
        reprintButton.disabled = true;
        reprintButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> ' + t('ui.orderHistory.reprinting','Reprinting...');
    }

    try {
        const response = await fetch('/api/reprint_order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                order_number: orderNumToReprint
            })
        });
        const result = await response.json();

        if (response.ok) {
            if (result.status === "success") {
                showToast(result.message || `${t('ui.orderHistory.orderNumber','Order #')}${orderNumToReprint} ${t('ui.orderHistory.reprintedSuccess','REPRINTED successfully!')}`, 'success');
            } else if (result.status === "warning_reprint_copy2_failed") {
                showToast(result.message || `${t('ui.orderHistory.orderNumber','Order #')}${orderNumToReprint}${t('ui.orderHistory.kitchenReprintedCopy2Failed',': Kitchen REPRINTED. Copy 2 FAILED.')}`, 'warning', 7000);
            } else {
                showToast(result.message || `${t('ui.orderHistory.failedReprint','Failed to reprint')} ${t('ui.orderHistory.orderNumber','Order #')}${orderNumToReprint}.`, 'error', 7000);
            }
        } else {
            showToast(result.message || `${t('ui.orderHistory.serverErrorDuringReprint','Server error during reprint of')} ${t('ui.orderHistory.orderNumber','Order #')}${orderNumToReprint}: ${response.status}.`, 'error', 7000);
        }

    } catch (error) {
        console.error(`Error reprinting order ${orderNumToReprint}:`, error);
        showToast(`${t('ui.orderHistory.networkErrorDuringReprint','Network error or invalid response while reprinting')} ${t('ui.orderHistory.orderNumber','Order #')}${orderNumToReprint}.`, 'error', 7000);
    } finally {
        if (reprintButton) {
            reprintButton.disabled = false;
            reprintButton.innerHTML = '<i class="fas fa-print mr-1"></i> ' + t('ui.orderHistory.reprint','Reprint');
        }
    }
}

async function openDaySummaryModal() {
    if (!elements.daySummaryModal || !elements.daySummaryContent) {
        // Try to find them again
        elements.daySummaryModal = document.getElementById('daySummaryModal');
        elements.daySummaryContent = document.getElementById('daySummaryContent');
        
        if (!elements.daySummaryModal || !elements.daySummaryContent) {
            return;
        }
    }
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.daySummaryModal.style.display = 'flex';
    } else {
        elements.daySummaryModal.classList.remove('hidden');
        elements.daySummaryModal.classList.add('flex');
    }
    elements.daySummaryContent.innerHTML = '<p class="text-center italic">' + t('ui.daySummary.loading', 'Loading summary...') + '</p>';

    try {
        const response = await fetch('/api/daily_summary');
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Server error: ${response.status}`);
        }
        const summary = await response.json();
        renderDaySummary(summary);
    } catch (error) {
        elements.daySummaryContent.innerHTML = `<p class="text-center text-red-500">Error loading summary: ${error.message}</p>`;
    }
}

function closeDaySummaryModal() {
    if (!elements.daySummaryModal) return;
    
    // Handle different UI variants
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    if (isDesktopUI) {
        elements.daySummaryModal.style.display = 'none';
    } else {
        elements.daySummaryModal.classList.add('hidden');
        elements.daySummaryModal.classList.remove('flex');
    }
}

function renderDaySummary(summary) {
    if (!elements.daySummaryContent) return;

    if (summary.status === 'error') {
        elements.daySummaryContent.innerHTML = `<p class="text-center text-red-500">${summary.message}</p>`;
        return;
    }

    elements.daySummaryContent.innerHTML = `
        <div class="space-y-3 text-base">
            <div class="flex justify-between items-center py-2 border-b">
                <span class="font-medium text-gray-600">${t('ui.daySummary.totalOrders','Total Orders:')}</span>
                <span class="font-semibold text-gray-800">${summary.total_orders}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b">
                <span class="font-medium text-gray-600">${t('ui.daySummary.totalCash','Total Cash Payments:')}</span>
                <span class="font-semibold text-green-600">€${summary.cash_total.toFixed(2)}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b">
                <span class="font-medium text-gray-600">${t('ui.daySummary.totalCard','Total Card Payments:')}</span>
                <span class="font-semibold text-blue-600">€${summary.card_total.toFixed(2)}</span>
            </div>
            <div class="flex justify-between items-center pt-3 mt-2 border-t-2 border-black">
                <span class="text-lg font-bold text-gray-900">${t('ui.daySummary.grandTotal','Grand Total:')}</span>
                <span class="font-semibold text-gray-900">€${summary.grand_total.toFixed(2)}</span>
            </div>
        </div>
    `;
}

// --- Analytics Functions ---

function toggleCustomDateRangeUI(buttonEl) {
    const picker = document.getElementById('custom-date-range-picker');
    if (!picker) return;

    document.querySelectorAll('.date-range-btn').forEach(btn => btn.classList.remove('active'));
    buttonEl.classList.add('active');

    picker.classList.toggle('hidden');

    if (!picker.classList.contains('hidden')) {
        const endDateInput = document.getElementById('endDate');
        const startDateInput = document.getElementById('startDate');
        const today = new Date().toISOString().split('T')[0];
        endDateInput.value = today;
        if (!startDateInput.value) {
            startDateInput.value = today;
        }
    }
}

async function fetchAnalytics(url) {
    const analyticsContainer = document.getElementById('analyticsManagement');
    
    if (!analyticsContainer) {
        showToast('Analytics container not found', 'error');
        return;
    }
    
    analyticsContainer.querySelectorAll('.font-bold.text-gray-900').forEach(el => el.textContent = '...');
    analyticsContainer.querySelectorAll('.max-h-48, .max-h-64, #analytics-chart-container').forEach(el => el.innerHTML = '<p class="text-xs text-gray-500 italic p-4">Loading data...</p>');

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                message: `HTTP ${response.status}`
            }));
            throw new Error(errorData.message || 'Failed to load analytics data');
        }
        const data = await response.json();
        renderAnalytics(data);
        showToast(`Analytics loaded successfully.`, "success");
    } catch (error) {
        showToast(`Error loading analytics: ${error.message}`, 'error');
        console.error("Analytics load error:", error);
    }
}

function loadAnalyticsData(range = 'today', buttonEl = null) {
    document.querySelectorAll('.date-range-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonEl) buttonEl.classList.add('active');

    const picker = document.getElementById('custom-date-range-picker');
    if (picker) picker.classList.add('hidden');

    fetchAnalytics(`/api/analytics?range=${range}`);
}

function fetchCustomDateRangeAnalytics() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!startDate || !endDate) {
        showToast('Please select both a start and end date.', 'warning');
        return;
    }
    if (new Date(startDate) > new Date(endDate)) {
        showToast('Start date cannot be after the end date.', 'warning');
        return;
    }

    fetchAnalytics(`/api/analytics?range=custom&start=${startDate}&end=${endDate}`);
}


function renderAnalytics(data) {
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    
    document.getElementById('kpi-gross-revenue').textContent = `€${(data.grossRevenue || 0).toFixed(2)}`;
    document.getElementById('kpi-total-orders').textContent = data.totalOrders || 0;
    document.getElementById('kpi-atv').textContent = `€${(data.atv || 0).toFixed(2)}`;

    // No card/cash metrics or fees/net revenue required

    // Items per order
    const itemsPerOrder = (data.totalItems && data.totalOrders) ? (data.totalItems / data.totalOrders) : 0;
    const itemsPerOrderEl = document.getElementById('kpi-items-per-order');
    if (itemsPerOrderEl) itemsPerOrderEl.textContent = itemsPerOrder > 0 ? itemsPerOrder.toFixed(2) : '-';

    // Payment metrics removed per requirements

    // Dine-in only deployment: remove takeaway-related UI and logic

    if (isDesktopUI) {
        renderList('kpi-sales-by-category', data.salesByCategory, item => `
            <div style="display: flex; justify-content: space-between; font-size: 0.875rem;">
                <span style="color: #4b5563; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; padding-right: 0.5rem;">${item.category}</span>
                <span style="font-weight: 500; color: #1f2937; white-space: nowrap;">€${(item.total || 0).toFixed(2)}</span>
            </div>`, "No category sales yet.");

        renderList('kpi-top-revenue-items', data.topRevenueItems, item => `
            <div style="display: flex; justify-content: space-between; font-size: 0.875rem;">
                <span style="color: #4b5563; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; padding-right: 0.5rem;">${item.name}</span>
                <span style="font-weight: 500; color: #1f2937; white-space: nowrap;">€${(item.revenue || 0).toFixed(2)}</span>
            </div>`, "No items sold yet.");

        renderList('kpi-best-sellers', data.bestSellers, item => `
            <div style="display: flex; justify-content: space-between; font-size: 0.875rem;">
                <span style="color: #4b5563; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; padding-right: 0.5rem;">${item.name}</span>
                <span style="font-weight: 500; color: #1f2937; white-space: nowrap;">${item.quantity} sold</span>
            </div>`, "No items sold yet.");

        renderList('kpi-worst-sellers', data.worstSellers, item => `
            <div style="display: flex; justify-content: space-between; font-size: 0.875rem;">
                <span style="color: #4b5563; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; padding-right: 0.5rem;">${item.name}</span>
                <span style="font-weight: 500; color: #1f2937; white-space: nowrap;">${item.quantity} sold</span>
            </div>`, "No underperforming items found.");
    } else {
        renderList('kpi-sales-by-category', data.salesByCategory, item => `
            <div class="flex justify-between text-sm">
                <span class="text-gray-600 truncate pr-2">${item.category}</span>
                <span class="font-medium text-gray-800 whitespace-nowrap">€${(item.total || 0).toFixed(2)}</span>
            </div>`, "No category sales yet.");

        renderList('kpi-top-revenue-items', data.topRevenueItems, item => `
            <div class="flex justify-between text-sm">
                <span class="text-gray-600 truncate pr-2">${item.name}</span>
                <span class="font-medium text-gray-800 whitespace-nowrap">€${(item.revenue || 0).toFixed(2)}</span>
            </div>`, "No items sold yet.");

        renderList('kpi-best-sellers', data.bestSellers, item => `
            <div class="flex justify-between text-sm">
                <span class="text-gray-600 truncate pr-2">${item.name}</span>
                <span class="font-medium text-gray-800 whitespace-nowrap">${item.quantity} sold</span>
            </div>`, "No items sold yet.");

        renderList('kpi-worst-sellers', data.worstSellers, item => `
            <div class="flex justify-between text-sm">
                <span class="text-gray-600 truncate pr-2">${item.name}</span>
                <span class="font-medium text-gray-800 whitespace-nowrap">${item.quantity} sold</span>
            </div>`, "No underperforming items found.");
    }

    renderSalesByHourChart(data.salesByHour);

    // Top add-ons/options
    const addonsContainer = document.getElementById('kpi-top-addons');
    if (addonsContainer) {
        const items = data.topAddons || [];
        if (items.length === 0) {
            addonsContainer.innerHTML = isDesktopUI ? '<p style="font-size: 0.75rem; color: #6b7280; font-style: italic; padding: 0.5rem;">No add‑on data.</p>' : '<p class="text-xs text-gray-500 italic p-2">No add‑on data.</p>';
        } else {
            addonsContainer.innerHTML = items.map(a => `
                <div class="flex justify-between text-sm">
                    <span class="text-gray-600 truncate pr-2">${a.name}</span>
                    <span class="font-medium text-gray-800 whitespace-nowrap">€${(a.revenue || 0).toFixed(2)} • ${a.attachRate ? Math.round(a.attachRate*100) : 0}%</span>
                </div>
            `).join('');
        }
    }
}

function renderList(containerId, items, templateFn, emptyMessage) {
    const container = document.getElementById(containerId);
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    container.innerHTML = '';
    
    if (items && items.length > 0) {
        items.forEach(item => {
            container.innerHTML += templateFn(item);
        });
    } else {
        if (isDesktopUI) {
            container.innerHTML = `<p style="font-size: 0.75rem; color: #6b7280; font-style: italic; padding: 0.5rem;">${emptyMessage}</p>`;
        } else {
            container.innerHTML = `<p class="text-xs text-gray-500 italic p-2">${emptyMessage}</p>`;
        }
    }
}

function renderSalesByHourChart(salesByHour) {
    const container = document.getElementById('analytics-chart-container');
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    container.innerHTML = '';

    if (!salesByHour || salesByHour.length === 0) {
        if (isDesktopUI) {
            container.innerHTML = '<p style="font-size: 0.75rem; color: #6b7280; font-style: italic; width: 100%; text-align: center; align-self: center;">No sales data for this period.</p>';
        } else {
            container.innerHTML = '<p class="text-xs text-gray-500 italic w-full text-center self-center">No sales data for this period.</p>';
        }
        container.style.minWidth = 'auto';
        return;
    }

    const barWidth = 40;
    const spaceWidth = 16;
    container.style.minWidth = `${salesByHour.length * (barWidth + spaceWidth) + 60}px`;
    container.style.maxHeight = '100%';
    container.style.overflowY = 'hidden';
    container.style.position = 'relative';

    const maxRevenue = Math.max(...salesByHour.map(h => h.total), 0);

    // Create global tooltip
    const tooltip = document.createElement('div');
    tooltip.id = 'chart-tooltip';
    tooltip.style.cssText = `
        position: absolute;
        background: #1f2937;
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        pointer-events: none;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        opacity: 0;
        transition: opacity 0.2s ease;
        white-space: nowrap;
    `;
    container.appendChild(tooltip);

    // Y-axis (5 ticks)
    const yAxis = document.createElement('div');
    if (isDesktopUI) {
        yAxis.style.cssText = 'display:flex; flex-direction:column; justify-content:space-between; height:100%; margin-right:8px; color:#6b7280; font-size:12px;';
    } else {
        yAxis.className = 'flex flex-col justify-between h-full mr-2 text-gray-500 text-xs';
    }
    const ticks = 5;
    for (let i = ticks; i >= 0; i--) {
        const val = (maxRevenue / ticks) * i;
        const lbl = document.createElement('div');
        lbl.textContent = `€${val.toFixed(0)}`;
        if (isDesktopUI) {
            lbl.style.cssText = 'height:1px; transform:translateY(6px)';
        }
        yAxis.appendChild(lbl);
    }
    container.appendChild(yAxis);

    salesByHour.forEach(hourData => {
        const barHeight = maxRevenue > 0 ? (hourData.total / maxRevenue) * 100 : 0;
        const barWrapper = document.createElement('div');
        
        if (isDesktopUI) {
            barWrapper.style.cssText = 'width: 2.5rem; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%;';
        } else {
            barWrapper.className = 'w-10 flex flex-col items-center justify-end h-full';
        }

        // Create bar container
        const barContainer = document.createElement('div');
        if (isDesktopUI) {
            barContainer.style.cssText = 'width: 100%; height: 100%; display: flex; align-items: flex-end; justify-content: center; position: relative;';
        } else {
            barContainer.className = 'w-full h-full flex items-end justify-center relative';
        }

        // Create the bar
        const bar = document.createElement('div');
        if (isDesktopUI) {
            bar.style.cssText = `
                background-color: #4f46e5;
                width: 75%;
                border-radius: 2px 2px 0 0;
                transition: all 0.3s ease;
                height: ${barHeight}%;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                cursor: pointer;
            `;
        } else {
            bar.className = 'bg-indigo-600 w-3/4 rounded-t-sm transition-all duration-300 shadow-sm cursor-pointer';
            bar.style.height = `${barHeight}%`;
        }

        // Add event listeners
        bar.addEventListener('mouseenter', function(e) {
            // Update tooltip
            tooltip.textContent = `€${hourData.total.toFixed(2)}`;
            tooltip.style.opacity = '1';
            
            // Position tooltip inside the chart area - to the right of the bar
            const rect = this.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            
            let left = rect.right - containerRect.left + 10; // Position to the right of the bar
            let top = rect.top - containerRect.top + (rect.height / 2) - 12; // Center vertically on the bar
            
            // If tooltip would go outside right edge, position it to the left of the bar
            if (left + tooltipRect.width > container.offsetWidth - 5) {
                left = rect.left - containerRect.left - tooltipRect.width - 10;
            }
            
            // Keep tooltip within vertical bounds
            if (top < 5) top = 5;
            if (top + tooltipRect.height > container.offsetHeight - 5) top = container.offsetHeight - tooltipRect.height - 5;
            
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            
            // Style bar
            if (isDesktopUI) {
                this.style.backgroundColor = '#6366f1';
                this.style.transform = 'scale(1.05)';
            } else {
                this.classList.add('bg-indigo-500', 'scale-105');
                this.classList.remove('bg-indigo-600');
            }
        });

        bar.addEventListener('mouseleave', function(e) {
            // Hide tooltip
            tooltip.style.opacity = '0';
            
            // Reset bar
            if (isDesktopUI) {
                this.style.backgroundColor = '#4f46e5';
                this.style.transform = 'scale(1)';
            } else {
                this.classList.remove('bg-indigo-500', 'scale-105');
                this.classList.add('bg-indigo-600');
            }
        });

        // Create hour label
        const hourLabel = document.createElement('span');
        if (isDesktopUI) {
            hourLabel.style.cssText = 'font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem;';
        } else {
            hourLabel.className = 'text-xs text-gray-500 mt-1';
        }
        hourLabel.textContent = String(hourData.hour).padStart(2, '0');

        // Assemble
        barContainer.appendChild(bar);
        barWrapper.appendChild(barContainer);
        barWrapper.appendChild(hourLabel);
        container.appendChild(barWrapper);
    });
}

function renderDaypartChart(dayparts) {
    const container = document.getElementById('analytics-daypart-container');
    if (!container) return;
    const isDesktopUI = document.body.classList.contains('desktop-ui');
    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    const data = dayparts && dayparts.length ? dayparts : [
        { label: 'Morning', total: 0 },
        { label: 'Lunch', total: 0 },
        { label: 'Afternoon', total: 0 },
        { label: 'Evening', total: 0 }
    ];

    const max = Math.max(...data.map(d => d.total), 0) || 1;

    // Y-axis (5 ticks)
    const yAxis = document.createElement('div');
    if (isDesktopUI) {
        yAxis.style.cssText = 'display:flex; flex-direction:column; justify-content:space-between; height:100%; margin-right:8px; color:#6b7280; font-size:12px;';
    } else {
        yAxis.className = 'flex flex-col justify-between h-full mr-2 text-gray-500 text-xs';
    }
    const ticks = 5;
    for (let i = ticks; i >= 0; i--) {
        const val = (max / ticks) * i;
        const lbl = document.createElement('div');
        lbl.textContent = `€${val.toFixed(0)}`;
        if (isDesktopUI) {
            lbl.style.cssText = 'height:1px; transform:translateY(6px)';
        }
        yAxis.appendChild(lbl);
    }
    container.appendChild(yAxis);

    const bars = document.createElement('div');
    if (isDesktopUI) {
        bars.style.cssText = 'display:flex; align-items:flex-end; height:100%; gap:12px;';
    } else {
        bars.className = 'h-full flex items-end gap-3';
    }

    data.forEach(d => {
        const h = (d.total / max) * 100;
        const wrap = document.createElement('div');
        if (isDesktopUI) {
            wrap.style.cssText = 'width:56px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;';
            wrap.innerHTML = `
                <div style=\"width:100%; height:100%; display:flex; align-items:flex-end; justify-content:center; position:relative;\">
                    <div style=\"background-color:#111827; width:70%; height:${h}%; border-radius:2px; transition:background-color 0.2s;\" onmouseover=\"this.nextElementSibling.style.opacity='1'; this.style.backgroundColor='#3b82f6'\" onmouseout=\"this.nextElementSibling.style.opacity='0'; this.style.backgroundColor='#111827'\"></div>
                    <div style=\"position:absolute; bottom: 100%; margin-bottom: 0.25rem; width: max-content; padding: 0.25rem 0.5rem; background-color: #1f2937; color: white; font-size: 0.75rem; border-radius: 0.25rem; opacity: 0; transition: opacity 0.2s; pointer-events: none; z-index: 10;\">€${(d.total || 0).toFixed(2)}</div>
                </div>
                <span style=\"font-size:12px; color:#6b7280; margin-top:4px;\">${d.label}</span>
            `;
        } else {
            wrap.className = 'w-14 flex flex-col items-center justify-end h-full';
            wrap.innerHTML = `
                <div class=\"w-full h-full flex items-end justify-center relative\">
                    <div class=\"bg-gray-900 w-3/4\" style=\"height:${h}%; border-radius:2px\" onmouseover=\"this.nextElementSibling.classList.remove('opacity-0'); this.classList.add('bg-indigo-600')\" onmouseout=\"this.nextElementSibling.classList.add('opacity-0'); this.classList.remove('bg-indigo-600')\"></div>
                    <div class=\"absolute bottom-full mb-1 w-max px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 transition-opacity pointer-events-none z-10\">€${(d.total || 0).toFixed(2)}</div>
                </div>
                <span class=\"text-xs text-gray-500 mt-1\">${d.label}</span>
            `;
        }
        bars.appendChild(wrap);
    });

    container.appendChild(bars);

    // X-axis line just above labels area
    const xAxis = document.createElement('div');
    if (isDesktopUI) {
        xAxis.style.cssText = 'position:absolute; left:0; right:0; bottom:22px; height:1px; background:#e5e7eb;';
    } else {
        xAxis.className = 'absolute left-0 right-0';
        xAxis.style.bottom = '22px';
        xAxis.style.height = '1px';
        xAxis.style.background = '#e5e7eb';
    }
    container.appendChild(xAxis);
}

async function shutdownApplication() {
    if (!confirm('Are you sure you want to shut down the POSPal application? This will close the server for all users.')) {
        return;
    }

    try {
        const response = await fetch('/api/shutdown', {
            method: 'POST',
        });
        const result = await response.json();
        if (result.status === 'success') {
            showToast('Server is shutting down...', 'info', 5000);
            document.body.innerHTML = `
                <div class="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center text-white p-8">
                    <h1 class="text-4xl font-bold mb-4">POSPal is Shutting Down</h1>
                    <p class="text-lg text-gray-300">You can now safely close this window.</p>
                </div>
            `;
            setTimeout(() => {
                window.close();
            }, 3000);
        } else {
            showToast(result.message || 'Failed to initiate shutdown.', 'error');
        }
    } catch (error) {
        console.log('Shutdown command sent. The server is likely closing the connection, which is normal.');
        showToast('Shutdown command sent. The server is closing.', 'info', 5000);
        document.body.innerHTML = `
            <div class="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center text-white p-8">
                <h1 class="text-4xl font-bold mb-4">POSPal is Shutting Down</h1>
                <p class="text-lg text-gray-300">You can now safely close this window.</p>
            </div>
        `;
        setTimeout(() => {
            window.close();
        }, 3000);
    }
}

// OLD IMPLEMENTATIONS REMOVED - Now using FrontendLicenseManager unified system

/**
 * Check for automatic license activation after payment
 * This function runs on startup to detect if a payment was recently completed
 * and the license should be automatically activated
 */
async function checkAutomaticActivation() {
    try {
        // Check if there's a payment success flag in localStorage
        const paymentSuccess = localStorage.getItem('pospal_payment_success');
        const paymentTimestamp = localStorage.getItem('pospal_payment_timestamp');
        const activationMethod = localStorage.getItem('pospal_activation_method');
        
        // Only check for automatic activation if payment was recent (within last 10 minutes)
        if (paymentSuccess === 'true' && paymentTimestamp && activationMethod === 'automatic') {
            const paymentTime = parseInt(paymentTimestamp);
            const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
            
            if (paymentTime > tenMinutesAgo) {
                console.log('Recent automatic activation detected, checking license status...');
                
                // Check if we have all the required license data
                const unlockToken = localStorage.getItem('pospal_unlock_token');
                const customerEmail = localStorage.getItem('pospal_customer_email');
                const customerName = localStorage.getItem('pospal_customer_name');
                const licenseStatus = localStorage.getItem('pospal_license_status');
                
                if (unlockToken && customerEmail && licenseStatus === 'active') {
                    console.log('Automatic activation successful! License data found:', {
                        email: customerEmail,
                        name: customerName,
                        status: licenseStatus,
                        activatedAt: new Date(paymentTime).toISOString()
                    });
                    
                    // Show success notification
                    showToast(`Welcome ${customerName || customerEmail}! Your POSPal license has been automatically activated.`, 'success', 8000);
                    
                    // Update license display immediately
                    showActiveLicenseStatus();
                    
                    // Clear the payment success flag since we've processed it
                    localStorage.removeItem('pospal_payment_success');
                    localStorage.removeItem('pospal_payment_timestamp');
                    
                } else {
                    console.log('Automatic activation incomplete - missing license data');
                    showToast('Payment successful! Please check your email for activation instructions.', 'info', 6000);
                }
            } else {
                console.log('Payment success flag is too old, ignoring...');
                // Clean up old flags
                localStorage.removeItem('pospal_payment_success');
                localStorage.removeItem('pospal_payment_timestamp');
            }
        }
        
    } catch (error) {
        console.error('Error checking automatic activation:', error);
        // Don't show error to user for this background check
    }
}

// OLD checkAndDisplayTrialStatus IMPLEMENTATION REMOVED - Now using FrontendLicenseManager unified system

async function loadHardwareId() {
    if (!elements.hardwareIdDisplay) return;
    elements.hardwareIdDisplay.textContent = "Loading...";
    try {
        const response = await fetch('/api/hardware_id');
        if (!response.ok) throw new Error('Failed to fetch Hardware ID');
        const data = await response.json();
        elements.hardwareIdDisplay.textContent = data.hardware_id || 'Not Available';
    } catch (error) {
        console.error("Error fetching hardware ID:", error);
        elements.hardwareIdDisplay.textContent = 'Error loading ID.';
    }
}

async function loadLicenseInfo() {
    console.log('Loading license information for display...');

    try {
        // Get license data from storage
        const licenseData = LicenseStorage.getLicenseData();
        console.log('License data retrieved:', licenseData);

        // Update license status badge
        const statusBadge = document.getElementById('license-status-badge');
        if (statusBadge) {
            if (licenseData.licenseStatus === 'active') {
                statusBadge.textContent = 'Active License';
                statusBadge.className = 'px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800';
            } else {
                // Check trial status
                const trialData = TrialManager.getTrialStatus();
                if (trialData.isActive) {
                    statusBadge.textContent = `Trial (${trialData.daysLeft} days left)`;
                    statusBadge.className = 'px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800';
                } else {
                    statusBadge.textContent = 'Trial Expired';
                    statusBadge.className = 'px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800';
                }
            }
        }

        // If we have active license data, populate the billing information
        if (licenseData.licenseStatus === 'active' && licenseData.unlockToken) {
            console.log('Active license found, updating billing display...');

            // Use the enhanced updateBillingDateDisplay function
            FrontendLicenseManager.updateBillingDateDisplay(licenseData);

            // Show portal buttons
            FrontendLicenseManager.showPortalButtons();

        } else {
            console.log('No active license found, showing default state');

            // Hide subscription details and show loading message
            const loadingElement = document.getElementById('license-loading');
            const detailsElement = document.getElementById('subscription-details');

            if (detailsElement) {
                detailsElement.classList.add('hidden');
                detailsElement.style.display = 'none';
            }

            if (loadingElement) {
                loadingElement.style.display = 'block';
                // Update the loading message to be more informative
                const loadingSpan = loadingElement.querySelector('span');
                if (loadingSpan) {
                    const trialData = TrialManager.getTrialStatus();
                    if (trialData.isActive) {
                        loadingSpan.textContent = `Trial active (${trialData.daysLeft} days remaining)`;
                    } else {
                        loadingSpan.textContent = 'No active subscription found. Please purchase a license.';
                    }
                }
            }
        }

    } catch (error) {
        console.error('Error loading license information:', error);

        // Show error state
        const statusBadge = document.getElementById('license-status-badge');
        if (statusBadge) {
            statusBadge.textContent = 'Error Loading';
            statusBadge.className = 'px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800';
        }
    }
}

function copyHardwareId() {
    const hwid = elements.hardwareIdDisplay.textContent;
    if (hwid && hwid !== 'Loading...' && hwid !== 'Error loading ID.') {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(hwid).then(() => {
                showToast('Hardware ID copied to clipboard!', 'success');
            }).catch(err => {
                showToast('Failed to copy.', 'error');
            });
        } else {
            const textArea = document.createElement("textarea");
            textArea.value = hwid;
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                showToast('Hardware ID copied to clipboard!', 'success');
            } catch (err) {
                showToast('Failed to copy.', 'error');
            }
            document.body.removeChild(textArea);
        }
    } else {
        showToast('Hardware ID not available to copy.', 'warning');
    }
}

// --- Auto-publish helper ---
let _autoPublishBusy = false;
async function maybeAutoPublishMenu() {
    try {
        if (_autoPublishBusy) return;
        const cfgResp = await fetch('/api/settings/cloudflare');
        if (!cfgResp.ok) return;
        const cfg = await cfgResp.json();
        const hasCfg = (cfg.cloudflare_api_base && cfg.cloudflare_store_slug);
        if (!hasCfg) return;
        _autoPublishBusy = true;
        const resp = await fetch('/api/publish/cloudflare', { method: 'POST' });
        const res = await resp.json().catch(() => ({}));
        if (res && res.success) {
            const url = res.url || getCloudflareUrlFromInputs();
            const urlEl = document.getElementById('cfMenuUrl');
            if (urlEl) urlEl.value = url || '';
            if (url) renderCloudflareQr(url);
            showToast('Online menu updated.', 'success');
        }
    } catch (_) {
        // Silent failure
    } finally {
        _autoPublishBusy = false;
    }
}

// --- Trial Lock Screen Functions ---
let lockScreenShown = false;

async function showTrialLockScreen(type = 'trial') {
    if (lockScreenShown) return; // Prevent multiple overlays
    
    const lockScreen = document.getElementById('trialLockScreen');
    if (!lockScreen) {
        console.warn('Trial lock screen element not found');
        return;
    }
    
    // Load and display usage analytics
    try {
        const response = await fetch('/api/usage_analytics');
        if (response.ok) {
            const analytics = await response.json();
            updateLockScreenData(analytics);
        }
    } catch (error) {
        console.error('Failed to load analytics for lock screen:', error);
        // Show default values
        updateLockScreenData({
            total_orders: 0,
            total_revenue: 0,
            days_used: 30
        });
    }
    
    // Update the header based on expiration type
    if (type === 'subscription') {
        const header = lockScreen.querySelector('h2');
        if (header) header.textContent = 'Subscription Expired';
        
        const subtitle = lockScreen.querySelector('p');
        if (subtitle) subtitle.textContent = 'Your monthly subscription has expired, but all your data is safe';
    }
    
    // Show the lock screen
    lockScreen.classList.remove('hidden');
    lockScreen.classList.add('flex');
    lockScreenShown = true;
    
    // Disable body scrolling
    document.body.style.overflow = 'hidden';
}

function updateLockScreenData(analytics) {
    // Update orders count
    const ordersElement = document.getElementById('lockscreen-orders-count');
    if (ordersElement) {
        ordersElement.textContent = analytics.total_orders || '0';
    }
    
    // Update revenue amount
    const revenueElement = document.getElementById('lockscreen-revenue-amount');
    if (revenueElement) {
        const revenue = analytics.total_revenue || 0;
        revenueElement.textContent = `€${revenue.toFixed(2)}`;
    }
    
    // Update days used
    const daysElement = document.getElementById('lockscreen-days-used');
    if (daysElement) {
        daysElement.textContent = analytics.days_used || '30';
    }
}

function showUnlockRedirect(type = 'trial') {
    // Show unlock options instead of lock screen
    const message = type === 'subscription' ? 
        'Your subscription has expired. Choose an option to continue:' :
        'Your 30-day trial has ended. Choose an option to continue:';
    
    if (confirm(message + '\n\n✅ Already paid? Click OK to enter unlock code\n❌ Need to pay? Click Cancel to subscribe')) {
        showUnlockDialog();
    } else {
        showEmbeddedPayment();
    }
}

function redirectToSubscription() {
    // Show embedded payment modal instead of external page
    showEmbeddedPayment();
}

function hideLockScreen() {
    const lockScreen = document.getElementById('trialLockScreen');
    if (lockScreen) {
        lockScreen.classList.add('hidden');
        lockScreen.classList.remove('flex');
    }
    
    lockScreenShown = false;
    document.body.style.overflow = 'auto';
}

// --- License Management Functions ---
function clearLicenseCache() {
    localStorage.removeItem('pospal_unlock_token');
    localStorage.removeItem('pospal_customer_email');
    localStorage.removeItem('pospal_customer_name');
    localStorage.removeItem('pospal_license_status');
    console.log('License cache cleared');
    location.reload(); // Reload to refresh UI
}

// Debug function to test customer validation
async function debugCustomerValidation(email) {
    try {
        console.log('Testing customer validation for:', email);
        
        const response = await fetch(`${WORKER_URL}/customer-portal`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                unlockToken: 'test' // We'll get the actual token from response
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('Customer data:', data);
            if (data.customer && data.customer.unlock_token) {
                console.log('Found customer! Unlock token:', data.customer.unlock_token);
                console.log('Subscription status:', data.subscription?.status);
                
                // Auto-unlock if subscription is active
                if (data.subscription?.status === 'active') {
                    unlockPOSPal(data.customer.unlock_token, email, data.customer.name);
                }
            } else {
                console.log('No valid customer found');
            }
        } else {
            const error = await response.text();
            console.error('Validation failed:', error);
        }
    } catch (error) {
        console.error('Debug validation error:', error);
    }
}

// --- Subscription Management Functions ---

// Function to manage portal loading states
function showPortalLoading(isLoading, message = 'Loading...') {
    const portalButtons = document.querySelectorAll('#manage-subscription-btn, #update-payment-btn, .portal-access-btn');
    
    portalButtons.forEach(button => {
        if (isLoading) {
            button.disabled = true;
            button.style.opacity = '0.6';
            button.style.cursor = 'not-allowed';
            
            // Store original content if not already stored
            if (!button.dataset.originalContent) {
                button.dataset.originalContent = button.innerHTML;
            }
            
            // Show loading spinner and message
            button.innerHTML = `
                <i class="fas fa-spinner fa-spin mr-2"></i>
                ${message}
            `;
        } else {
            button.disabled = false;
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
            
            // Restore original content
            if (button.dataset.originalContent) {
                button.innerHTML = button.dataset.originalContent;
            }
        }
    });
}

// Enhanced error handling for portal access
function handlePortalError(error) {
    const errorMessage = error.message || error.toString();
    
    // Network-related errors
    if (error.name === 'TypeError' && errorMessage.includes('fetch')) {
        return {
            message: 'Connection failed. Please check your internet connection and try again.',
            duration: 6000,
            showGuidance: true,
            guidanceType: 'network'
        };
    }
    
    // Authentication errors
    if (errorMessage.includes('Invalid credentials') || errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        return {
            message: 'Authentication failed. Your session may have expired.',
            duration: 8000,
            showGuidance: true,
            guidanceType: 'auth'
        };
    }
    
    // Stripe customer setup errors
    if (errorMessage.includes('No Stripe customer found') || errorMessage.includes('STRIPE_CUSTOMER_CREATION_FAILED')) {
        return {
            message: 'Your billing account needs to be set up. This usually happens automatically.',
            duration: 10000,
            showGuidance: true,
            guidanceType: 'setup'
        };
    }
    
    // Portal creation errors
    if (errorMessage.includes('STRIPE_PORTAL_CREATION_FAILED') || errorMessage.includes('Failed to create portal session')) {
        return {
            message: 'Customer portal is temporarily unavailable. Please try again in a few minutes.',
            duration: 8000,
            showGuidance: true,
            guidanceType: 'retry'
        };
    }
    
    // Subscription status errors
    if (errorMessage.includes('No active subscription') || errorMessage.includes('subscription not found')) {
        return {
            message: 'No active subscription found. You may need to subscribe or reactivate your account.',
            duration: 8000,
            showGuidance: true,
            guidanceType: 'subscription'
        };
    }
    
    // Server errors (5xx)
    if (errorMessage.includes('500') || errorMessage.includes('502') || errorMessage.includes('503')) {
        return {
            message: 'Our servers are temporarily unavailable. Please try again in a few minutes.',
            duration: 8000,
            showGuidance: true,
            guidanceType: 'server'
        };
    }
    
    // Generic fallback
    return {
        message: 'Unable to access customer portal. Please try again or contact support if the problem persists.',
        duration: 8000,
        showGuidance: true,
        guidanceType: 'generic'
    };
}

// Show contextual guidance based on error type
function showPortalErrorGuidance(guidanceType, error) {
    let guidanceMessage = '';
    let actions = [];
    
    switch (guidanceType) {
        case 'network':
            guidanceMessage = 'Network Connection Issue';
            actions = [
                '• Check your internet connection',
                '• Try refreshing the page',
                '• If using a VPN, try disconnecting temporarily'
            ];
            break;
            
        case 'auth':
            guidanceMessage = 'Authentication Problem';
            actions = [
                '• Try validating your license again',
                '• Clear browser cache and cookies for this site',
                '• Contact support@pospal.gr if the issue persists'
            ];
            break;
            
        case 'setup':
            guidanceMessage = 'Account Setup Required';
            actions = [
                '• This usually resolves automatically within a few minutes',
                '• Try again in 2-3 minutes',
                '• Contact support@pospal.gr if you continue having issues'
            ];
            break;
            
        case 'retry':
            guidanceMessage = 'Service Temporarily Unavailable';
            actions = [
                '• Wait 2-3 minutes and try again',
                '• Check our status page for known issues',
                '• Contact support@pospal.gr if the problem continues'
            ];
            break;
            
        case 'subscription':
            guidanceMessage = 'Subscription Issue';
            actions = [
                '• Verify your subscription is active',
                '• Try validating your license again',
                '• Check your email for subscription notifications',
                '• Contact support@pospal.gr for assistance'
            ];
            break;
            
        case 'server':
            guidanceMessage = 'Server Maintenance';
            actions = [
                '• Our servers are being updated',
                '• Please try again in 5-10 minutes',
                '• No action required from you'
            ];
            break;
            
        default:
            guidanceMessage = 'Need Help?';
            actions = [
                '• Try refreshing the page and attempting again',
                '• Clear your browser cache',
                '• Contact support@pospal.gr with error details'
            ];
    }
    
    const fullMessage = `${guidanceMessage}\n\n${actions.join('\n')}`;
    
    // Show as a confirm dialog for better visibility
    if (confirm(fullMessage + '\n\nWould you like to try again now?')) {
        // Give a brief moment before retry
        setTimeout(() => {
            openCustomerPortal();
        }, 500);
    }
}

// Handle return from Stripe Customer Portal
function handlePortalReturn() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // Check for portal return parameter
    if (urlParams.has('portal') || urlParams.has('stripe_portal')) {
        const returnType = urlParams.get('portal') || urlParams.get('stripe_portal');
        
        // Show appropriate success message based on return type
        let successMessage = 'Welcome back! Your billing session has completed.';
        let toastDuration = 5000;
        
        switch (returnType) {
            case 'payment_updated':
            case 'payment_method_updated':
                successMessage = 'Payment method updated successfully! Your subscription will continue uninterrupted.';
                toastDuration = 6000;
                break;
                
            case 'subscription_updated':
            case 'subscription_changed':
                successMessage = 'Subscription updated successfully! Changes will take effect at your next billing cycle.';
                toastDuration = 6000;
                break;
                
            case 'invoice_paid':
                successMessage = 'Payment processed successfully! Thank you for your payment.';
                toastDuration = 6000;
                break;
                
            case 'cancelled':
            case 'canceled':
                successMessage = 'Billing session cancelled. No changes were made to your account.';
                toastDuration = 4000;
                break;
                
            case 'return':
            default:
                // Generic return - could be from any portal action
                successMessage = 'Billing portal session completed. Any changes you made have been saved.';
                toastDuration = 5000;
        }
        
        // Show success message
        setTimeout(() => {
            showToast(successMessage, 'success', toastDuration);
        }, 500);
        
        // Clean up URL parameters
        cleanPortalReturnUrl();
        
        // Optionally refresh license status after portal return
        setTimeout(() => {
            if (typeof refreshLicenseStatus === 'function') {
                refreshLicenseStatus();
            }
        }, 2000);
        
        return true;
    }
    
    return false;
}

// Clean portal-related URL parameters
function cleanPortalReturnUrl() {
    const url = new URL(window.location);
    const paramsToRemove = ['portal', 'stripe_portal', 'session_id', 'payment_intent'];
    
    paramsToRemove.forEach(param => {
        url.searchParams.delete(param);
    });
    
    // Update URL without reloading the page
    window.history.replaceState({}, document.title, url.pathname + url.search);
}

// Initialize portal return handling when page loads
function initializePortalReturnHandling() {
    // Handle return immediately if URL indicates portal return
    if (handlePortalReturn()) {
        console.log('Handled portal return successfully');
    }
    
    // Also listen for hash changes in case of SPA routing
    window.addEventListener('hashchange', () => {
        handlePortalReturn();
    });
}

async function openCustomerPortal() {
    try {
        const customerEmail = localStorage.getItem('pospal_customer_email');
        const unlockToken = localStorage.getItem('pospal_unlock_token');
        
        if (!customerEmail || !unlockToken) {
            showToast('No active subscription found. Please subscribe first.', 'warning');
            return;
        }
        
        // Show loading state and disable portal buttons
        showPortalLoading(true, 'Connecting to POSPal Customer Portal...');
        
        showToast('Opening POSPal Customer Portal...', 'info');
        
        const response = await fetch(`${WORKER_URL}/create-portal-session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: customerEmail,
                unlockToken: unlockToken
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create portal session');
        }
        
        const data = await response.json();
        
        if (data.url) {
            // Open Stripe Customer Portal in new tab with enhanced user experience and proper branding
            const portalWindow = window.open(
                data.url, 
                'POSPalCustomerPortal', // Named window for better branding
                'width=1200,height=800,scrollbars=yes,resizable=yes,toolbar=no,menubar=no,status=yes'
            );
            
            // Check if popup was blocked
            if (!portalWindow || portalWindow.closed || typeof portalWindow.closed == 'undefined') {
                // Fallback: show a modal with instructions to manually open the link
                const fallbackMessage = `Your browser blocked the POSPal Customer Portal popup.\n\nClick "OK" to open it in this tab instead.`;
                if (confirm(fallbackMessage)) {
                    // Try opening again with better messaging
                    showToast('Redirecting to POSPal Customer Portal...', 'info');
                    window.location.href = data.url;
                }
            } else {
                showPortalLoading(false); // Hide loading state
                showToast('POSPal Customer Portal opened successfully - manage your subscription in the new window', 'success');
                
                // Optional: Focus the new window after a brief delay
                setTimeout(() => {
                    try {
                        portalWindow.focus();
                    } catch (e) {
                        // Ignore focus errors
                    }
                }, 500);
                
                // Add window title update attempt (may not work due to cross-origin, but worth trying)
                setTimeout(() => {
                    try {
                        if (!portalWindow.closed && portalWindow.document) {
                            portalWindow.document.title = 'POSPal Customer Portal - Manage Subscription';
                        }
                    } catch (e) {
                        // Cross-origin restrictions prevent this, but that's expected
                    }
                }, 2000);
            }
        } else {
            throw new Error('No portal URL received');
        }
        
    } catch (error) {
        console.error('Customer portal error:', error);
        
        showPortalLoading(false); // Hide loading state on error
        
        // Enhanced error handling with specific messages and guidance
        const errorResult = handlePortalError(error);
        showToast(errorResult.message, 'error', errorResult.duration);
        
        // Show additional guidance if provided
        if (errorResult.showGuidance) {
            setTimeout(() => {
                showPortalErrorGuidance(errorResult.guidanceType, error);
            }, 1000);
        }
    }
}

async function updatePaymentMethod() {
    // For now, redirect to customer portal for payment updates
    openCustomerPortal();
}

async function loadUsageStatistics() {
    try {
        const response = await fetch('/api/usage_analytics');
        if (response.ok) {
            const analytics = await response.json();
            updateUsageStatsDisplay(analytics);
        }
    } catch (error) {
        console.error('Failed to load usage statistics:', error);
    }
}

function updateUsageStatsDisplay(analytics) {
    // Update total orders
    const ordersElement = document.getElementById('stats-total-orders');
    if (ordersElement) {
        ordersElement.textContent = analytics.total_orders || '0';
    }
    
    // Update total revenue
    const revenueElement = document.getElementById('stats-total-revenue');
    if (revenueElement) {
        const revenue = analytics.total_revenue || 0;
        revenueElement.textContent = `€${revenue.toFixed(2)}`;
    }
    
    // Update days used
    const daysElement = document.getElementById('stats-days-used');
    if (daysElement) {
        daysElement.textContent = analytics.days_used || '0';
    }
}

// --- Unlock Dialog Functions ---
function showUnlockDialog() {
    const dialog = document.getElementById('unlockTokenDialog');
    if (dialog) {
        dialog.classList.remove('hidden');
        dialog.classList.add('flex');
        
        // Reset button state when opening modal
        resetUnlockButtonState();
        
        // Clear any previous errors
        hideUnlockError();
        
        // Focus on email input
        const emailInput = document.getElementById('unlockEmail');
        if (emailInput) {
            setTimeout(() => emailInput.focus(), 100);
        }
        
        // Disable body scrolling
        document.body.style.overflow = 'hidden';
    }
}

function hideUnlockDialog() {
    const dialog = document.getElementById('unlockTokenDialog');
    if (dialog) {
        dialog.classList.add('hidden');
        dialog.classList.remove('flex');
        
        // Reset button state when closing modal
        resetUnlockButtonState();
        
        // Clear form
        const form = document.getElementById('unlockTokenForm');
        if (form) form.reset();
        
        // Hide error
        hideUnlockError();
        
        // Re-enable body scrolling
        document.body.style.overflow = 'auto';
    }
}

function showUnlockError(message) {
    const errorDiv = document.getElementById('unlockError');
    if (errorDiv) {
        // Check if this is a license-related error that could benefit from recovery
        if (message.includes('Invalid email or unlock token') || message.includes('License not found')) {
            errorDiv.innerHTML = `${message} <br><br><button onclick="hideLicenseRecoveryModal(); showLicenseRecoveryModal();" class="text-blue-600 hover:text-blue-700 underline text-sm">Forgot your license key? Click here to recover it</button>`;
        } else {
            errorDiv.textContent = message;
        }
        errorDiv.classList.remove('hidden');
    }
}

function hideUnlockError() {
    const errorDiv = document.getElementById('unlockError');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
    }
}

function setUnlockLoading(loading) {
    const btn = document.getElementById('unlockSubmitBtn');
    
    if (btn) {
        btn.disabled = loading;
        if (loading) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i><span>Validating...</span>';
        } else {
            // Reset to original state
            btn.innerHTML = '<i class="fas fa-unlock mr-2"></i><span>Unlock POSPal</span>';
        }
    }
}

// Enhanced function to reset unlock button state
function resetUnlockButtonState() {
    // Timer clearing now handled by TimerManager
    
    const btn = document.getElementById('unlockSubmitBtn');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-unlock mr-2"></i><span>Unlock POSPal</span>';
    }
}

// Auto-recovery mechanism to prevent permanently stuck button states
// Now handled by TimerManager

function setUnlockLoadingWithAutoReset(loading) {
    setUnlockLoading(loading);
    
    // Clear any existing timer
    TimerManager.clear('buttonReset');
    
    // If setting to loading state, create a safety timer to auto-reset after 45 seconds
    if (loading) {
        TimerManager.set('buttonReset', () => {
            console.warn('Auto-recovering stuck validation button');
            resetUnlockButtonState();
            showUnlockError('Validation took too long. Please try again.');
        }, 45000);
    }
}

async function generateMachineFingerprint() {
    // Get enhanced hardware ID (same as existing system)
    try {
        const response = await fetch('/api/hardware_id');
        if (response.ok) {
            const data = await response.json();
            return data.hardware_id || 'fallback-fingerprint';
        }
    } catch (error) {
        console.error('Failed to get hardware ID:', error);
    }

    // Fallback fingerprint
    return 'fallback-' + Date.now();
}

// Alias for backward compatibility - both functions now use same backend source
async function generateDeviceFingerprint() {
    return await generateMachineFingerprint();
}

async function validateUnlockToken(email, token, machineFingerprint) {
    const response = await fetch(`${WORKER_URL}/validate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email: email,
            token: token,
            machineFingerprint: machineFingerprint
        })
    });
    
    const result = await response.json();
    return result;
}


// Handle unlock form submission and page load events
document.addEventListener('DOMContentLoaded', function() {
    // Set up unlock form handler
    const unlockForm = document.getElementById('unlockTokenForm');
    if (unlockForm) {
        unlockForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('unlockEmail').value.trim();
            const token = document.getElementById('unlockToken').value.trim().toUpperCase();
            
            if (!email || !token) {
                showUnlockError('Please fill in all fields.');
                return;
            }
            
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showUnlockError('Please enter a valid email address.');
                return;
            }
            
            setUnlockLoadingWithAutoReset(true);
            hideUnlockError();
            
            try {
                // Generate machine fingerprint
                const machineFingerprint = await generateMachineFingerprint();
                
                // Validate with server with timeout protection
                const result = await Promise.race([
                    validateUnlockToken(email, token, machineFingerprint),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Request timeout')), 30000)
                    )
                ]);
                
                if (result.valid) {
                    // Store token locally for validation
                    localStorage.setItem('pospal_unlock_token', token);
                    localStorage.setItem('pospal_customer_email', email);
                    localStorage.setItem('pospal_customer_name', result.customerName);
                    localStorage.setItem('pospal_license_status', 'active');
                    
                    // Turn off loading state
                    setUnlockLoading(false);
                    
                    // Show success message with customer portal option
                    const welcomeMessage = `🎉 Welcome to POSPal Pro, ${result.customerName}!\n\nYour subscription has been successfully activated.\n\nYou now have access to all premium features including:\n• Advanced analytics and reporting\n• Priority customer support\n• Enhanced customization options\n• Automatic data backup\n\nWould you like to access your customer portal to manage your subscription and billing?`;
                    
                    // Hide dialog first
                    hideUnlockDialog();
                    
                    // Immediately update UI to show active license
                    showActiveLicenseStatus();
                    
                    // Add a brief celebration effect
                    setTimeout(() => {
                        showToast('🎉 POSPal Pro activated successfully! All premium features are now available.', 'success', 5000);
                    }, 500);
                    
                    // Show welcome message and offer customer portal access
                    setTimeout(() => {
                        if (confirm(welcomeMessage)) {
                            openCustomerPortal();
                        }
                    }, 1000);
                    
                } else {
                    showUnlockError(result.error || 'Invalid email or unlock token. Please check and try again.');
                }
                
            } catch (error) {
                console.error('Unlock validation error:', error);
                if (error.message === 'Request timeout') {
                    showUnlockError('Request timed out. Please check your internet connection and try again.');
                } else {
                    showUnlockError('Connection failed. Please check your internet connection and try again.');
                }
            } finally {
                // Clear timer and reset button state
                TimerManager.clear('buttonReset');
                setUnlockLoading(false);
            }
        });
    }
    
    // Format token input as user types
    const tokenInput = document.getElementById('unlockToken');
    if (tokenInput) {
        tokenInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/[^A-Z0-9]/g, '').toUpperCase();
            
            // Format as POSPAL-XXXX-XXXX-XXXX
            if (value.startsWith('POSPAL')) {
                value = value.substring(6); // Remove POSPAL prefix
            }
            
            // Add dashes every 4 characters
            const segments = [];
            for (let i = 0; i < value.length; i += 4) {
                segments.push(value.substring(i, i + 4));
            }
            
            let formatted = 'POSPAL-' + segments.join('-');
            
            // Limit length
            if (formatted.length > 35) { // POSPAL-XXXX-XXXX-XXXX-XXXX = up to 35 chars
                formatted = formatted.substring(0, 35);
            }
            
            e.target.value = formatted;
        });
    }
    
    // Load usage statistics
    loadUsageStatistics();
    
    // Start session management and check subscription status on startup
    setTimeout(async () => {
        const sessionStarted = await startSession();
        if (sessionStarted) {
            await FrontendLicenseManager.validateLicense();
        }
    }, 1000);
    
    // Subscription checks now handled by ValidationTimers and TimerManager
    // No separate interval needed - unified timer system manages all validation
    
    // End session when page is closed
    window.addEventListener('beforeunload', () => {
        endSession();
    });
});

// --- License Recovery Functions ---
let lastRecoveryRequest = 0;
const RECOVERY_RATE_LIMIT_MS = 60000; // 1 minute between requests

function showLicenseRecoveryModal() {
    const modal = document.getElementById('licenseRecoveryModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        
        // Reset form and messages
        const form = document.getElementById('licenseRecoveryForm');
        if (form) form.reset();
        hideRecoveryMessages();
        resetRecoveryButtonState();
        
        // Focus on email input
        const emailInput = document.getElementById('recoveryEmail');
        if (emailInput) {
            setTimeout(() => emailInput.focus(), 100);
        }
        
        // Disable body scrolling
        document.body.style.overflow = 'hidden';
    }
}

function hideLicenseRecoveryModal() {
    const modal = document.getElementById('licenseRecoveryModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        
        // Clear any active countdown
        clearRecoveryCountdown();
        
        // Reset form and messages
        const form = document.getElementById('licenseRecoveryForm');
        if (form) form.reset();
        hideRecoveryMessages();
        resetRecoveryButtonState();
        
        // Re-enable body scrolling
        document.body.style.overflow = 'auto';
    }
}

function showRecoveryError(message) {
    hideRecoveryMessages();
    const errorDiv = document.getElementById('recoveryError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }
}

// Global variable to track countdown interval
// Now handled by TimerManager

function showRecoverySuccess(message) {
    hideRecoveryMessages();
    const successDiv = document.getElementById('recoverySuccess');
    if (successDiv) {
        successDiv.innerHTML = `
            <div>${message}</div>
            <div id="recoveryCountdown" class="mt-2 text-sm text-green-600 font-medium"></div>
        `;
        successDiv.classList.remove('hidden');
    }
}

function startRecoveryCountdown(seconds = 8) {
    // Clear any existing countdown
    TimerManager.clear('recoveryCountdown');
    
    let timeLeft = seconds;
    const countdownElement = document.getElementById('recoveryCountdown');
    
    // Update countdown display immediately
    updateCountdownDisplay(timeLeft);
    
    // Start the countdown interval
    TimerManager.set('recoveryCountdown', () => {
        timeLeft--;
        
        if (timeLeft <= 0) {
            TimerManager.clear('recoveryCountdown');
            hideLicenseRecoveryModal();
        } else {
            updateCountdownDisplay(timeLeft);
        }
    }, 1000, 'interval');
}

function updateCountdownDisplay(seconds) {
    const countdownElement = document.getElementById('recoveryCountdown');
    if (countdownElement) {
        countdownElement.textContent = `Modal will close in ${seconds} second${seconds !== 1 ? 's' : ''}...`;
    }
}

function clearRecoveryCountdown() {
    TimerManager.clear('recoveryCountdown');
}

function showRecoveryWarning(message) {
    hideRecoveryMessages();
    const warningDiv = document.getElementById('recoveryWarning');
    if (warningDiv) {
        warningDiv.textContent = message;
        warningDiv.classList.remove('hidden');
    }
}

function hideRecoveryMessages() {
    // Clear any active countdown when hiding messages
    clearRecoveryCountdown();
    
    const errorDiv = document.getElementById('recoveryError');
    const successDiv = document.getElementById('recoverySuccess');
    const warningDiv = document.getElementById('recoveryWarning');
    
    if (errorDiv) errorDiv.classList.add('hidden');
    if (successDiv) successDiv.classList.add('hidden');
    if (warningDiv) warningDiv.classList.add('hidden');
}

function setRecoveryLoading(loading) {
    const btn = document.getElementById('recoverySubmitBtn');
    const btnText = document.getElementById('recoveryBtnText');
    
    if (btn && btnText) {
        btn.disabled = loading;
        if (loading) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i><span>Sending...</span>';
        } else {
            btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i><span>Send License Key</span>';
        }
    }
}

function resetRecoveryButtonState() {
    setRecoveryLoading(false);
}

async function submitLicenseRecovery(email) {
    try {
        // Check rate limiting
        const now = Date.now();
        if (now - lastRecoveryRequest < RECOVERY_RATE_LIMIT_MS) {
            const remainingSeconds = Math.ceil((RECOVERY_RATE_LIMIT_MS - (now - lastRecoveryRequest)) / 1000);
            throw new Error(`Please wait ${remainingSeconds} seconds before requesting another recovery.`);
        }
        
        const response = await fetch('https://pospal-licensing-v2-production.bzoumboulis.workers.dev/recover-license', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email
            }),
        });
        
        const result = await response.json();
        
        if (response.ok) {
            lastRecoveryRequest = now;
            return {
                success: true,
                message: result.message || 'License key has been sent to your email address.'
            };
        } else {
            throw new Error(result.error || 'Failed to process recovery request.');
        }
        
    } catch (error) {
        console.error('License recovery error:', error);
        
        if (error.message.includes('wait')) {
            // Rate limiting error
            return {
                success: false,
                isRateLimit: true,
                message: error.message
            };
        } else if (error.name === 'TypeError' || error.message.includes('fetch')) {
            // Network error
            return {
                success: false,
                message: 'Network error. Please check your internet connection and try again.'
            };
        } else {
            // Server error
            return {
                success: false,
                message: error.message
            };
        }
    }
}

// Set up recovery form handler
document.addEventListener('DOMContentLoaded', function() {
    const recoveryForm = document.getElementById('licenseRecoveryForm');
    if (recoveryForm) {
        recoveryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('recoveryEmail').value.trim();
            
            // Validation
            if (!email) {
                showRecoveryError('Please enter your email address.');
                return;
            }
            
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showRecoveryError('Please enter a valid email address.');
                return;
            }
            
            // Show loading state
            setRecoveryLoading(true);
            hideRecoveryMessages();
            
            // Submit recovery request
            const result = await submitLicenseRecovery(email);
            
            setRecoveryLoading(false);
            
            if (result.success) {
                showRecoverySuccess(result.message);
                // Start countdown timer for better user experience
                startRecoveryCountdown(8);
            } else if (result.isRateLimit) {
                showRecoveryWarning(result.message);
            } else {
                showRecoveryError(result.message);
            }
        });
    }
});

// Support contact function (used in recovery modal)
function contactSupport() {
    const subject = encodeURIComponent('POSPal License Recovery Support');
    const body = encodeURIComponent(`Hi,

I need help recovering my POSPal license key.

Issue: [Please describe your issue here]

Thank you!`);
    
    window.open(`mailto:support@pospal.gr?subject=${subject}&body=${body}`, '_self');
}

// --- Subscription Validation Functions ---

async function checkSubscriptionStatus() {
    try {
        const unlockToken = localStorage.getItem('pospal_unlock_token');
        const customerEmail = localStorage.getItem('pospal_customer_email');
        
        // Check if we have a trial or subscription to validate
        if (!unlockToken || !customerEmail) {
            return handleTrialValidation();
        }
        
        // Check if we're in a valid offline grace period first
        if (isInOfflineGracePeriod()) {
            console.log('Using offline grace period - skipping server validation');
            return; // Continue using app offline
        }
        
        // Check cached status (avoid too frequent API calls when online)
        const lastCheck = localStorage.getItem('pospal_last_validation_check');
        const cacheValid = lastCheck && (Date.now() - parseInt(lastCheck)) < (1000 * 60 * 60); // 1 hour cache
        
        if (cacheValid) {
            const cachedStatus = localStorage.getItem('pospal_cached_status');
            if (cachedStatus === 'active') {
                return; // Still active based on cache
            }
        }
        
        // Try to validate with server
        const isOnline = await attemptServerValidation(customerEmail, unlockToken);
        
        if (!isOnline) {
            // Server unreachable - start offline grace period
            handleOfflineMode();
        }
        
    } catch (error) {
        console.error('Failed to validate subscription:', error);
        handleOfflineMode();
    }
}

// Handle trial users (local validation only)
function handleTrialValidation() {
    const trialStarted = localStorage.getItem('pospal_trial_started');
    if (trialStarted) {
        const trialDays = 30;
        const daysSinceStart = (Date.now() - parseInt(trialStarted)) / (1000 * 60 * 60 * 24);
        
        // Trial users get 1 day offline grace
        const offlineGraceDays = 1;
        const lastOnlineCheck = localStorage.getItem('pospal_last_online_check');
        
        if (lastOnlineCheck) {
            const daysSinceLastOnline = (Date.now() - parseInt(lastOnlineCheck)) / (1000 * 60 * 60 * 24);
            if (daysSinceLastOnline > offlineGraceDays && daysSinceStart > trialDays) {
                showUnlockRedirect('trial');
                return;
            }
        } else if (daysSinceStart > trialDays) {
            showUnlockRedirect('trial');
            return;
        }
    }
}

// Check if user is within offline grace period with progressive warnings
function isInOfflineGracePeriod() {
    const lastSuccessfulCheck = localStorage.getItem('pospal_last_successful_validation');
    const customerType = localStorage.getItem('pospal_cached_status');
    
    if (!lastSuccessfulCheck) {
        return false; // No previous successful validation
    }
    
    const daysSinceLastValidation = (Date.now() - parseInt(lastSuccessfulCheck)) / (1000 * 60 * 60 * 24);
    
    // Extended grace period: 7 days normal + 3 days warning period
    const normalGraceDays = customerType === 'active' ? 7 : 1;
    const warningPeriodDays = 3; // Days 8, 9, 10
    const totalGraceDays = normalGraceDays + warningPeriodDays;
    
    const inGracePeriod = daysSinceLastValidation <= totalGraceDays;
    const inWarningPeriod = daysSinceLastValidation > normalGraceDays && daysSinceLastValidation <= totalGraceDays;
    const remainingDays = Math.max(0, totalGraceDays - daysSinceLastValidation);
    
    if (inGracePeriod) {
        console.log(`Offline status: ${daysSinceLastValidation.toFixed(1)}/${totalGraceDays} days`);
        
        if (inWarningPeriod) {
            // Show progressive warnings for days 8, 9, 10 - use smart system if available
            if (window.CustomerSegmentationManager && window.NotificationManager) {
                showSmartProgressiveWarning(daysSinceLastValidation, totalGraceDays);
            } else {
                showProgressiveWarning(daysSinceLastValidation, normalGraceDays, totalGraceDays);
            }
            StatusDisplayManager.updateLicenseStatus('warning', { remainingDays });
        } else {
            // Normal grace period - update status indicator only (no popups during operations)
            StatusDisplayManager.updateLicenseStatus('offline');
            // Store offline info for management modal display
            localStorage.setItem('pospal_offline_info', JSON.stringify({
                daysSinceLastValidation,
                gracePeriodDays: normalGraceDays,
                remainingDays: Math.max(0, normalGraceDays - daysSinceLastValidation)
            }));
        }
    } else {
        console.log('Grace period expired - entering trial mode');
        showTrialModeNotification();
    }
    
    return inGracePeriod;
}

// Attempt server validation with timeout and enhanced UI feedback
async function attemptServerValidation(customerEmail, unlockToken, timeout = 10000) {
    try {
        console.log('Attempting server validation...');
        
        // Show checking status
        showConnectivityStatus(true, 'checking');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const machineFingerprint = await generateMachineFingerprint();
        
        const response = await fetch(`${WORKER_URL}/validate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: customerEmail,
                token: unlockToken,
                machineFingerprint: machineFingerprint
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        const result = await response.json();
        
        // Update successful validation timestamp
        localStorage.setItem('pospal_last_validation_check', Date.now().toString());
        localStorage.setItem('pospal_last_online_check', Date.now().toString());
        
        if (result.valid && result.subscriptionStatus === 'active') {
            // Validation successful
            localStorage.setItem('pospal_cached_status', 'active');
            localStorage.setItem('pospal_last_successful_validation', Date.now().toString());
            console.log('Server validation: ACTIVE');
            
            // Hide all warning indicators and show success
            // hideOfflineIndicator(); // Removed invasive popup
            hideProgressiveWarning();
            showConnectivityStatus(true, 'active');
            StatusDisplayManager.updateLicenseStatus('active', { isOnline: true });
            
            return true;
        } else {
            // License issues detected online
            localStorage.setItem('pospal_cached_status', 'inactive');
            console.log('Server validation failed:', result.error || 'Unknown error');
            
            // Show online but license issue
            showConnectivityStatus(true, 'invalid');
            StatusDisplayManager.updateLicenseStatus('inactive', { isOnline: true });
            
            if (result.error && result.error.includes('Subscription is not active')) {
                showUnlockRedirect('subscription');
            } else if (result.error && result.error.includes('Invalid email or unlock token')) {
                showUnlockDialog();
            }
            
            return true; // We connected to server (validation failed but connection succeeded)
        }
        
    } catch (error) {
        console.log('Server validation failed (likely offline):', error.name);
        
        // Show offline status
        showConnectivityStatus(false);
        StatusDisplayManager.updateLicenseStatus('offline');
        
        return false; // Assume offline
    }
}

// Handle offline mode gracefully with enhanced UI feedback
function handleOfflineMode() {
    const lastOnlineCheck = localStorage.getItem('pospal_last_online_check');
    if (!lastOnlineCheck) {
        // First time offline - start grace period
        localStorage.setItem('pospal_last_online_check', Date.now().toString());
    }
    
    // Update UI to show offline status
    showConnectivityStatus(false);
    
    if (!isInOfflineGracePeriod()) {
        // Grace period expired - show trial mode
        StatusDisplayManager.updateLicenseStatus('trial');
        showTrialModeNotification();
    } else {
        // Still in grace period - update status accordingly
        const lastSuccessful = localStorage.getItem('pospal_last_successful_validation');
        const daysSince = lastSuccessful ? 
            (Date.now() - parseInt(lastSuccessful)) / (1000 * 60 * 60 * 24) : 0;
        
        const normalGraceDays = 7;
        
        if (daysSince > normalGraceDays) {
            // In warning period
            StatusDisplayManager.updateLicenseStatus('warning');
        } else {
            // Normal grace period
            StatusDisplayManager.updateLicenseStatus('offline');
        }
    }
}

// NOTE: Removed duplicate generateMachineFingerprint() function
// All fingerprinting now uses the async version that calls backend hardware ID
// to ensure consistency and prevent false machine change detections

// --- Session Management Functions ---

let currentSessionId = null;
// Heartbeat interval now unified with ValidationTimers.HEARTBEAT_INTERVAL
// Remove duplicate constant to prevent conflicts

// Generate unique session ID
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Get device information for session tracking
function getDeviceInfo() {
    return {
        screen: `${screen.width}x${screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        platform: navigator.platform,
        userAgent: navigator.userAgent.substring(0, 200),
        browser: getBrowserInfo()
    };
}

function getBrowserInfo() {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown';
}

// Start session with server
async function startSession() {
    try {
        const unlockToken = localStorage.getItem('pospal_unlock_token');
        const customerEmail = localStorage.getItem('pospal_customer_email');
        
        if (!unlockToken || !customerEmail) {
            console.log('No license info found, skipping session management');
            return true; // Don't block app for trial users
        }
        
        // Check if we're in offline grace period first
        if (isInOfflineGracePeriod()) {
            console.log('Starting session in offline mode (using grace period)');
            startOfflineSession();
            return true;
        }

        currentSessionId = generateSessionId();
        const machineFingerprint = await generateMachineFingerprint();
        const deviceInfo = getDeviceInfo();
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
            
            const response = await fetch(`${WORKER_URL}/session/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: customerEmail,
                    token: unlockToken,
                    machineFingerprint: machineFingerprint,
                    sessionId: currentSessionId,
                    deviceInfo: deviceInfo
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            const result = await response.json();
            
            if (result.success) {
                console.log('Session started successfully:', currentSessionId);
                startHeartbeat();
                localStorage.setItem('pospal_last_online_check', Date.now().toString());
                return true;
            } else if (result.conflict) {
                // Another device is using this license
                console.log('Session conflict detected:', result.error);
                const shouldTakeover = await showSessionConflictDialog(result.conflictInfo);
                
                if (shouldTakeover) {
                    return await takeoverSession();
                } else {
                    // User chose not to takeover, check if they can use offline mode
                    if (isInOfflineGracePeriod()) {
                        console.log('Starting in offline mode instead');
                        startOfflineSession();
                        return true;
                    } else {
                        showSessionConflictLock(result.conflictInfo);
                        return false;
                    }
                }
            } else {
                console.error('Failed to start session:', result.error);
                // Try offline mode if available
                if (isInOfflineGracePeriod()) {
                    startOfflineSession();
                    return true;
                }
                return true; // Don't block app for other server errors
            }
            
        } catch (error) {
            console.log('Session start failed (likely offline):', error.name);
            
            // Try offline mode
            if (isInOfflineGracePeriod()) {
                startOfflineSession();
                return true;
            } else {
                // No offline grace - handle as network error
                handleOfflineMode();
                return false;
            }
        }
        
    } catch (error) {
        console.error('Session start error:', error);
        return true; // Don't block app for unexpected errors
    }
}

// Start offline session (no server communication)
function startOfflineSession() {
    currentSessionId = generateSessionId();
    console.log('Started offline session:', currentSessionId);
    
    // Start modified heartbeat that doesn't communicate with server
    startOfflineHeartbeat();
    
    // Show offline indicator
    const daysSinceLastValidation = (Date.now() - parseInt(localStorage.getItem('pospal_last_successful_validation') || '0')) / (1000 * 60 * 60 * 24);
    const gracePeriodDays = localStorage.getItem('pospal_cached_status') === 'active' ? 7 : 1;
    // showOfflineIndicator(daysSinceLastValidation, gracePeriodDays); // Removed invasive popup
}

// Modified heartbeat for offline mode
function startOfflineHeartbeat() {
    TimerManager.clear('heartbeat');
    
    // Daily reconnection check with persistence
    const DAILY_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    const RETRY_INTERVAL = 10 * 60 * 1000; // 10 minutes for retries
    const MAX_RETRIES_PER_DAY = 6; // Max 6 retries (1 hour of attempts)
    
    let dailyRetryCount = 0;
    let lastDailyCheck = localStorage.getItem('pospal_last_daily_check') || '0';
    
    const attemptReconnection = async (isRetry = false) => {
        try {
            console.log(isRetry ? 'Retrying connection...' : 'Daily connection check...');
            const unlockToken = localStorage.getItem('pospal_unlock_token');
            const customerEmail = localStorage.getItem('pospal_customer_email');
            
            if (unlockToken && customerEmail) {
                const isOnline = await attemptServerValidation(customerEmail, unlockToken, 8000); // 8 second timeout
                
                if (isOnline) {
                    console.log('Connection successful! Switching to online session management...');
                    localStorage.setItem('pospal_last_daily_check', Date.now().toString());
                    dailyRetryCount = 0;
                    // Restart full session management
                    await startSession();
                    return;
                } else {
                    // Server not responding - retry if we haven't exceeded retry limit
                    if (!isRetry) {
                        dailyRetryCount = 0; // Reset counter for new daily check
                    }
                    
                    if (dailyRetryCount < MAX_RETRIES_PER_DAY) {
                        dailyRetryCount++;
                        console.log(`Server not responding, retry ${dailyRetryCount}/${MAX_RETRIES_PER_DAY} in 10 minutes`);
                        TimerManager.set('heartbeat', () => attemptReconnection(true), RETRY_INTERVAL);
                        return;
                    } else {
                        console.log('Max retries reached, will try again in 24 hours');
                    }
                }
            }
            
        } catch (error) {
            console.log('Connection failed:', error.name);
            
            // Retry logic for network errors too
            if (dailyRetryCount < MAX_RETRIES_PER_DAY) {
                dailyRetryCount++;
                console.log(`Connection error, retry ${dailyRetryCount}/${MAX_RETRIES_PER_DAY} in 10 minutes`);
                TimerManager.set('heartbeat', () => attemptReconnection(true), RETRY_INTERVAL);
                return;
            }
        }
        
        // Check if offline grace period has expired
        if (!isInOfflineGracePeriod()) {
            console.log('Offline grace period expired');
            handleOfflineMode();
            return;
        }
        
        // Schedule next daily check
        const nextCheck = DAILY_CHECK_INTERVAL;
        console.log(`Next connection check in 24 hours`);
        TimerManager.set('heartbeat', () => attemptReconnection(false), nextCheck);
    };
    
    // Determine when to start first check
    const timeSinceLastCheck = Date.now() - parseInt(lastDailyCheck);
    let initialDelay;
    
    if (timeSinceLastCheck >= DAILY_CHECK_INTERVAL) {
        // It's been over 24 hours, check now
        initialDelay = 5000; // 5 seconds to let app settle
    } else {
        // Schedule next check based on when last check was
        initialDelay = DAILY_CHECK_INTERVAL - timeSinceLastCheck;
        console.log(`Next connection check in ${Math.round(initialDelay / (1000 * 60 * 60))} hours`);
    }
    
    TimerManager.set('heartbeat', () => attemptReconnection(false), initialDelay);
}

// Start heartbeat to keep session alive
function startHeartbeat() {
    TimerManager.clear('heartbeat');
    
    TimerManager.set('heartbeat', async () => {
        try {
            if (!currentSessionId) return;
            
            const response = await fetch(`${WORKER_URL}/session/heartbeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: currentSessionId
                }),
            });
            
            const result = await response.json();
            
            if (!result.success) {
                console.warn('Heartbeat failed:', result.error);
                if (result.error.includes('Session not found')) {
                    // Session was terminated, try to restart
                    console.log('Session was terminated, attempting to restart...');
                    await startSession();
                }
            }
            
        } catch (error) {
            console.error('Heartbeat error:', error);
        }
    }, ValidationTimers.HEARTBEAT_INTERVAL, 'interval');
}

// End session when app closes
async function endSession() {
    try {
        if (currentSessionId) {
            await fetch(`${WORKER_URL}/session/end`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: currentSessionId
                }),
            });
            
            console.log('Session ended:', currentSessionId);
        }
        
        TimerManager.clear('heartbeat');
        
        currentSessionId = null;
        
    } catch (error) {
        console.error('End session error:', error);
    }
}

// Takeover session from another device
async function takeoverSession() {
    try {
        const unlockToken = localStorage.getItem('pospal_unlock_token');
        const customerEmail = localStorage.getItem('pospal_customer_email');
        
        if (!unlockToken || !customerEmail) {
            return false;
        }

        currentSessionId = generateSessionId();
        const machineFingerprint = await generateMachineFingerprint();
        const deviceInfo = getDeviceInfo();
        
        const response = await fetch(`${WORKER_URL}/session/takeover`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: customerEmail,
                token: unlockToken,
                machineFingerprint: machineFingerprint,
                sessionId: currentSessionId,
                deviceInfo: deviceInfo
            }),
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log('Session takeover successful:', currentSessionId);
            startHeartbeat();
            return true;
        } else {
            console.error('Session takeover failed:', result.error);
            return false;
        }
        
    } catch (error) {
        console.error('Session takeover error:', error);
        return false;
    }
}

// Show session conflict dialog
async function showSessionConflictDialog(conflictInfo) {
    return new Promise((resolve) => {
        const deviceInfo = conflictInfo?.deviceInfo || {};
        const lastSeen = conflictInfo?.lastSeen || 'Unknown';
        const deviceDesc = `${deviceInfo.browser || 'Unknown Browser'} on ${deviceInfo.platform || 'Unknown OS'}`;
        
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-90 z-[120] flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                <div class="p-6 text-center border-b border-gray-200">
                    <div class="text-4xl text-orange-500 mb-3">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h2 class="text-2xl font-bold text-gray-900 mb-2">Device Conflict</h2>
                    <p class="text-gray-600">Another device is currently using your POSPal license</p>
                </div>
                
                <div class="p-6">
                    <div class="bg-gray-50 rounded-lg p-4 mb-4">
                        <h3 class="font-semibold text-gray-800 mb-2">Currently Active Device:</h3>
                        <div class="text-sm text-gray-600">
                            <p><i class="fas fa-desktop mr-2"></i>${deviceDesc}</p>
                            <p><i class="fas fa-clock mr-2"></i>Last seen: ${new Date(lastSeen).toLocaleString()}</p>
                            <p><i class="fas fa-screen mr-2"></i>Screen: ${deviceInfo.screen || 'Unknown'}</p>
                        </div>
                    </div>
                    
                    <p class="text-sm text-gray-600 mb-6">
                        Your POSPal license allows only one active device at a time. You can take over this license, which will immediately disconnect the other device.
                    </p>
                    
                    <div class="space-y-3">
                        <button id="takeoverBtn" class="w-full bg-orange-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-orange-700 transition-colors">
                            <i class="fas fa-laptop mr-2"></i>
                            Use POSPal on This Device
                        </button>
                        
                        <button id="cancelBtn" class="w-full bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors">
                            Cancel
                        </button>
                    </div>
                    
                    <div class="mt-4 text-center">
                        <p class="text-xs text-gray-500">
                            The other device will be disconnected immediately and can reconnect later when this device is closed.
                        </p>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        const takeoverBtn = modal.querySelector('#takeoverBtn');
        const cancelBtn = modal.querySelector('#cancelBtn');
        
        const cleanup = () => {
            document.body.removeChild(modal);
            document.body.style.overflow = 'auto';
        };
        
        takeoverBtn.onclick = () => {
            cleanup();
            resolve(true);
        };
        
        cancelBtn.onclick = () => {
            cleanup();
            resolve(false);
        };
    });
}

// Show session conflict lock screen
function showSessionConflictLock(conflictInfo) {
    const deviceInfo = conflictInfo?.deviceInfo || {};
    const deviceDesc = `${deviceInfo.browser || 'Unknown Browser'} on ${deviceInfo.platform || 'Unknown OS'}`;
    
    const lockScreen = document.createElement('div');
    lockScreen.id = 'sessionConflictLock';
    lockScreen.className = 'fixed inset-0 bg-gray-900 z-[100] flex items-center justify-center p-4';
    lockScreen.innerHTML = `
        <div class="text-center text-white max-w-md">
            <div class="text-6xl text-orange-500 mb-6">
                <i class="fas fa-ban"></i>
            </div>
            <h2 class="text-3xl font-bold mb-4">License In Use</h2>
            <p class="text-gray-300 mb-6">
                Your POSPal license is currently being used on another device (${deviceDesc}).
            </p>
            <p class="text-sm text-gray-400 mb-8">
                Only one device can use POSPal at a time. Close POSPal on the other device or refresh this page to try again.
            </p>
            <button onclick="window.location.reload()" 
                    class="bg-orange-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-orange-700 transition-colors">
                <i class="fas fa-refresh mr-2"></i>
                Try Again
            </button>
        </div>
    `;
    
    document.body.appendChild(lockScreen);
}

// --- Offline Mode UI Functions ---
// Note: Offline indicator popup removed - status is now shown only in License Info modal

// Manual reconnection attempt (user-triggered)
async function attemptReconnect() {
    const unlockToken = localStorage.getItem('pospal_unlock_token');
    const customerEmail = localStorage.getItem('pospal_customer_email');
    
    if (unlockToken && customerEmail) {
        showToast('Checking connection...', 'info', 2000);
        
        const isOnline = await attemptServerValidation(customerEmail, unlockToken, 10000); // 10 second timeout for manual attempts
        
        if (isOnline) {
            showToast('✅ Reconnected successfully!', 'success', 3000);
            // hideOfflineIndicator(); // Removed invasive popup
            // Update last daily check timestamp to reset daily schedule
            localStorage.setItem('pospal_last_daily_check', Date.now().toString());
            // Restart session management
            setTimeout(() => {
                startSession();
            }, 1000);
        } else {
            showToast('❌ Still offline - automatic check once per day', 'error', 4000);
        }
    }
}

// Show offline expired dialog for paid customers
function showOfflineExpiredDialog() {
    const customerType = localStorage.getItem('pospal_cached_status');
    const gracePeriodDays = customerType === 'active' ? 7 : 1;
    
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-90 z-[120] flex items-center justify-center p-4';
    
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div class="p-6 text-center border-b border-gray-200">
                <div class="text-4xl text-red-500 mb-3">
                    <i class="fas fa-exclamation-circle"></i>
                </div>
                <h2 class="text-2xl font-bold text-gray-900 mb-2">Connection Required</h2>
                <p class="text-gray-600">Your offline grace period has expired</p>
            </div>
            
            <div class="p-6">
                <div class="bg-red-50 rounded-lg p-4 mb-4">
                    <p class="text-sm text-red-700 mb-2">
                        <i class="fas fa-clock mr-2"></i>
                        You've been offline for more than ${gracePeriodDays} days
                    </p>
                    <p class="text-sm text-red-600">
                        POSPal needs to verify your subscription status with our servers to continue.
                    </p>
                </div>
                
                <p class="text-sm text-gray-600 mb-6">
                    Please check your internet connection and try again. Your subscription and data are safe.
                </p>
                
                <div class="space-y-3">
                    <button onclick="attemptReconnect()" class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                        <i class="fas fa-wifi mr-2"></i>
                        Check Connection
                    </button>
                    
                    <button onclick="window.location.reload()" class="w-full bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors">
                        <i class="fas fa-refresh mr-2"></i>
                        Refresh Page
                    </button>
                </div>
                
                <div class="mt-4 text-center">
                    <p class="text-xs text-gray-500">
                        If you continue having connection issues, please contact support.
                    </p>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
}

// Expose global functions
window.attemptReconnect = attemptReconnect;

// --- Progressive Warning System ---

let warningNotificationElement = null;
let connectivityStatusElement = null;

// Show progressive warnings for days 8, 9, 10
function showProgressiveWarning(daysSinceLastValidation, normalGraceDays, totalGraceDays) {
    const warningDay = Math.floor(daysSinceLastValidation - normalGraceDays) + 1;
    const remainingDays = Math.max(0, totalGraceDays - daysSinceLastValidation);
    
    // Check if warning is temporarily dismissed
    const dismissedUntil = localStorage.getItem('pospal_warning_dismissed_until');
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil)) {
        return; // Warning is dismissed, don't show
    }
    
    // Check if we've already shown this warning today to avoid spam
    const lastShownKey = `pospal_warning_shown_day_${warningDay}`;
    const lastShown = localStorage.getItem(lastShownKey);
    const hoursAgo = lastShown ? (Date.now() - parseInt(lastShown)) / (1000 * 60 * 60) : 25;
    
    if (hoursAgo < 8) {
        return; // Don't spam - wait at least 8 hours between same-level warnings
    }
    
    // Hide any existing warning first
    hideProgressiveWarning();
    
    let warningLevel, warningTitle, warningMessage, warningIcon, warningColors;
    
    if (warningDay === 1) {
        // Day 8: Soft warning
        warningLevel = 'soft';
        warningTitle = 'Connection Notice';
        warningMessage = `POSPal hasn't been able to verify your license for ${daysSinceLastValidation.toFixed(1)} days. Please check your internet connection when convenient.`;
        warningIcon = 'fa-info-circle';
        warningColors = 'bg-blue-50 border-blue-200 text-blue-800';
    } else if (warningDay === 2) {
        // Day 9: More prominent warning
        warningLevel = 'moderate';
        warningTitle = 'License Verification Needed';
        warningMessage = `Your license needs verification. ${remainingDays.toFixed(1)} days remaining before entering trial mode. Please reconnect to the internet.`;
        warningIcon = 'fa-exclamation-triangle';
        warningColors = 'bg-yellow-50 border-yellow-300 text-yellow-800';
    } else {
        // Day 10: Final warning
        warningLevel = 'urgent';
        warningTitle = 'FINAL DAY - Action Required';
        warningMessage = `This is your final day! License verification required within ${remainingDays.toFixed(1)} days or POSPal will enter trial mode. Please connect to the internet immediately.`;
        warningIcon = 'fa-exclamation-circle';
        warningColors = 'bg-red-50 border-red-300 text-red-800';
    }
    
    // Create warning notification
    warningNotificationElement = document.createElement('div');
    warningNotificationElement.id = 'progressiveWarning';
    warningNotificationElement.className = `fixed top-4 left-1/2 transform -translate-x-1/2 ${warningColors} border-2 px-6 py-4 rounded-lg shadow-lg z-[1700] max-w-2xl mx-auto warning-notification progressive-warning`;
    
    warningNotificationElement.innerHTML = `
        <div class="flex items-start space-x-3">
            <div class="flex-shrink-0 pt-1">
                <i class="fas ${warningIcon} text-xl"></i>
            </div>
            <div class="flex-1">
                <h3 class="font-bold text-lg mb-2">${warningTitle}</h3>
                <p class="text-sm mb-3">${warningMessage}</p>
                <div class="flex flex-wrap gap-2">
                    <button onclick="attemptReconnect()" class="bg-white hover:bg-gray-50 text-gray-800 px-4 py-3 rounded border text-sm font-medium transition-colors min-h-[44px] touch-manipulation">
                        <i class="fas fa-wifi mr-2"></i>Try Reconnect
                    </button>
                    <button onclick="showConnectivityHelp()" class="bg-white hover:bg-gray-50 text-gray-800 px-4 py-3 rounded border text-sm font-medium transition-colors min-h-[44px] touch-manipulation">
                        <i class="fas fa-question-circle mr-2"></i>Connection Help
                    </button>
                    ${warningDay >= 2 ? `<button onclick="dismissWarningTemporarily()" class="bg-white hover:bg-gray-50 text-gray-600 px-4 py-3 rounded border text-sm transition-colors min-h-[44px] touch-manipulation">Dismiss (1hr)</button>` : ''}
                </div>
            </div>
            <button onclick="dismissWarningTemporarily()" class="flex-shrink-0 text-gray-400 hover:text-gray-600 p-3 min-w-[44px] min-h-[44px] touch-manipulation flex items-center justify-center">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(warningNotificationElement);
    
    // Show appropriate notification only if not actively taking orders
    if (!isActivelyTakingOrders()) {
        if (warningDay === 1) {
            showToast('License verification needed - please check your connection when convenient', 'info', 3000);
        } else if (warningDay === 2) {
            showToast(`Warning: ${remainingDays.toFixed(1)} days remaining for license verification`, 'warning', 4000);
        } else {
            showToast(`URGENT: Final day for license verification! ${remainingDays.toFixed(1)} days remaining`, 'error', 5000);
        }
    } else {
        // During operations, just update the status display without popups
        console.log(`License warning suppressed during operations: ${remainingDays.toFixed(1)} days remaining`);
        updateLicenseStatusIndicator('warning', remainingDays);
    }
    
    // Store warning display to avoid spam
    localStorage.setItem(`pospal_warning_shown_day_${warningDay}`, Date.now().toString());
}

// Hide progressive warning
function hideProgressiveWarning() {
    if (warningNotificationElement) {
        document.body.removeChild(warningNotificationElement);
        warningNotificationElement = null;
    }
}

// Dismiss warning temporarily (1 hour)
function dismissWarningTemporarily() {
    hideProgressiveWarning();
    localStorage.setItem('pospal_warning_dismissed_until', (Date.now() + (60 * 60 * 1000)).toString());
    showToast('Warning dismissed for 1 hour', 'info', 3000);
}

// Show trial mode notification for day 11+
function showTrialModeNotification() {
    // Hide other indicators
    // hideOfflineIndicator(); // Removed invasive popup
    hideProgressiveWarning();
    
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-90 z-[120] flex items-center justify-center p-4';
    modal.id = 'trialModeModal';
    
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div class="p-6 text-center border-b border-gray-200">
                <div class="text-4xl text-orange-500 mb-3 trial-mode-indicator">
                    <i class="fas fa-clock"></i>
                </div>
                <h2 class="text-2xl font-bold text-gray-900 mb-2">Trial Mode Active</h2>
                <p class="text-gray-600">License verification required</p>
            </div>
            
            <div class="p-6">
                <div class="bg-orange-50 rounded-lg p-4 mb-4">
                    <p class="text-sm text-orange-700 mb-2">
                        <i class="fas fa-info-circle mr-2"></i>
                        POSPal is now running in trial mode due to extended offline period
                    </p>
                    <p class="text-sm text-orange-600">
                        Your subscription is still active! Simply reconnect to the internet to restore full functionality.
                    </p>
                </div>
                
                <div class="bg-blue-50 rounded-lg p-4 mb-6">
                    <h4 class="font-semibold text-blue-800 mb-2">What this means:</h4>
                    <ul class="text-sm text-blue-700 space-y-1">
                        <li>• Basic POS functions continue to work</li>
                        <li>• Some advanced features are temporarily limited</li>
                        <li>• Your data and settings are completely safe</li>
                        <li>• Full functionality resumes once connected</li>
                    </ul>
                </div>
                
                <div class="space-y-3">
                    <button onclick="attemptReconnect()" class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                        <i class="fas fa-wifi mr-2"></i>
                        Check Connection Now
                    </button>
                    
                    <button onclick="showConnectivityHelp()" class="w-full bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors">
                        <i class="fas fa-question-circle mr-2"></i>
                        Connection Troubleshooting
                    </button>
                    
                    <button onclick="closeTrialModeModal()" class="w-full bg-gray-100 text-gray-600 py-2 px-4 rounded-lg hover:bg-gray-200 transition-colors">
                        Continue in Trial Mode
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    showToast('Running in trial mode - reconnect to restore full functionality', 'warning', 8000);
}

// Close trial mode modal
function closeTrialModeModal() {
    const modal = document.getElementById('trialModeModal');
    if (modal) {
        document.body.removeChild(modal);
    }
}

// Show connectivity help dialog
function showConnectivityHelp() {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-90 z-[130] flex items-center justify-center p-4 connection-help-modal';
    modal.id = 'connectivityHelpModal';
    
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-screen overflow-y-auto">
            <div class="p-6 border-b border-gray-200">
                <div class="flex items-center justify-between">
                    <h2 class="text-xl font-bold text-gray-900">Connection Troubleshooting</h2>
                    <button onclick="closeConnectivityHelp()" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
            </div>
            
            <div class="p-6">
                <div class="space-y-6">
                    <div class="bg-blue-50 rounded-lg p-4">
                        <h3 class="font-semibold text-blue-800 mb-2">Quick Check</h3>
                        <p class="text-sm text-blue-700 mb-3">First, verify your internet connection:</p>
                        <button onclick="testInternetConnection()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 transition-colors">
                            <i class="fas fa-globe mr-2"></i>Test Internet Connection
                        </button>
                    </div>
                    
                    <div class="bg-gray-50 rounded-lg p-4">
                        <h3 class="font-semibold text-gray-800 mb-3">Common Solutions</h3>
                        <ul class="space-y-2 text-sm text-gray-700">
                            <li class="flex items-start space-x-2">
                                <i class="fas fa-wifi text-blue-500 mt-0.5"></i>
                                <span>Check that your device is connected to WiFi or ethernet</span>
                            </li>
                            <li class="flex items-start space-x-2">
                                <i class="fas fa-shield-alt text-green-500 mt-0.5"></i>
                                <span>Temporarily disable firewall/antivirus and try again</span>
                            </li>
                            <li class="flex items-start space-x-2">
                                <i class="fas fa-router text-orange-500 mt-0.5"></i>
                                <span>Restart your router/modem and wait 2 minutes</span>
                            </li>
                            <li class="flex items-start space-x-2">
                                <i class="fas fa-sync text-purple-500 mt-0.5"></i>
                                <span>Try refreshing the page or restarting POSPal</span>
                            </li>
                        </ul>
                    </div>
                    
                    <div class="bg-yellow-50 rounded-lg p-4">
                        <h3 class="font-semibold text-yellow-800 mb-2">Still Having Issues?</h3>
                        <p class="text-sm text-yellow-700 mb-3">POSPal needs to reach our license servers occasionally. If you continue having problems:</p>
                        <ul class="space-y-1 text-sm text-yellow-700">
                            <li>• Contact your IT administrator about firewall settings</li>
                            <li>• Check if your network blocks external connections</li>
                            <li>• Try connecting from a different network (mobile hotspot)</li>
                        </ul>
                    </div>
                </div>
                
                <div class="mt-6 flex space-x-3">
                    <button onclick="attemptReconnect()" class="flex-1 bg-blue-600 text-white py-2 px-4 rounded font-medium hover:bg-blue-700 transition-colors">
                        <i class="fas fa-sync mr-2"></i>Try Again
                    </button>
                    <button onclick="closeConnectivityHelp()" class="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded font-medium hover:bg-gray-300 transition-colors">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Close connectivity help modal
function closeConnectivityHelp() {
    const modal = document.getElementById('connectivityHelpModal');
    if (modal) {
        document.body.removeChild(modal);
    }
}

// Test internet connection
async function testInternetConnection() {
    showToast('Testing internet connection...', 'info', 2000);
    
    try {
        const response = await fetch('https://www.google.com/favicon.ico', {
            method: 'HEAD',
            mode: 'no-cors',
            cache: 'no-cache'
        });
        showToast('Internet connection: OK', 'success', 3000);
        return true;
    } catch (error) {
        showToast('No internet connection detected', 'error', 4000);
        return false;
    }
}

// Enhanced connectivity status indicator
function showConnectivityStatus(isOnline, validationStatus = null) {
    hideConnectivityStatus(); // Remove existing indicator
    
    connectivityStatusElement = document.createElement('div');
    connectivityStatusElement.id = 'connectivityStatus';
    connectivityStatusElement.className = 'fixed bottom-4 right-4 px-3 py-2 rounded-lg shadow-lg text-sm z-40 connectivity-status';
    
    let statusIcon, statusText, statusColor;
    
    if (isOnline && validationStatus === 'active') {
        statusIcon = 'fa-check-circle';
        statusText = 'Online & Licensed';
        statusColor = 'bg-green-100 border border-green-300 text-green-800';
    } else if (isOnline && validationStatus === 'checking') {
        statusIcon = 'fa-spinner fa-spin';
        statusText = 'Verifying License...';
        statusColor = 'bg-blue-100 border border-blue-300 text-blue-800';
    } else if (isOnline && validationStatus === 'invalid') {
        statusIcon = 'fa-exclamation-triangle';
        statusText = 'Online - License Issue';
        statusColor = 'bg-red-100 border border-red-300 text-red-800';
    } else if (isOnline) {
        statusIcon = 'fa-wifi';
        statusText = 'Online';
        statusColor = 'bg-blue-100 border border-blue-300 text-blue-800';
    } else {
        statusIcon = 'fa-wifi-slash';
        statusText = 'Offline Mode';
        statusColor = 'bg-orange-100 border border-orange-300 text-orange-800';
    }
    
    connectivityStatusElement.className += ` ${statusColor}`;
    connectivityStatusElement.innerHTML = `
        <div class="flex items-center space-x-2">
            <i class="fas ${statusIcon}"></i>
            <span class="font-medium">${statusText}</span>
        </div>
    `;
    
    document.body.appendChild(connectivityStatusElement);
    
    // Auto-hide online status after 5 seconds (but keep license issues and offline status)
    if (isOnline && validationStatus === 'active') {
        setTimeout(() => {
            if (connectivityStatusElement && connectivityStatusElement.id === 'connectivityStatus') {
                connectivityStatusElement.style.opacity = '0';
                setTimeout(() => hideConnectivityStatus(), 300);
            }
        }, 5000);
    }
}

// Hide connectivity status
function hideConnectivityStatus() {
    if (connectivityStatusElement) {
        document.body.removeChild(connectivityStatusElement);
        connectivityStatusElement = null;
    }
}

// Legacy updateLicenseStatusDisplay function removed - now handled by StatusDisplayManager
// All status updates consolidated into unified system to prevent UI conflicts

// Expose new global functions
window.dismissWarningTemporarily = dismissWarningTemporarily;
window.closeTrialModeModal = closeTrialModeModal;
window.showConnectivityHelp = showConnectivityHelp;
window.closeConnectivityHelp = closeConnectivityHelp;
window.testInternetConnection = testInternetConnection;


// --- Embedded Payment Functions ---

function showEmbeddedPayment() {
    // Reset email validation state when opening modal
    resetEmailValidationState();
    // Show the subscription modal
    document.getElementById('subscriptionModal').style.display = 'flex';
}

function closeSubscriptionModal() {
    // Reset email validation state when closing modal
    resetEmailValidationState();
    
    // Clear all input boxes
    document.getElementById('sub-restaurant-name').value = '';
    document.getElementById('sub-customer-name').value = '';
    document.getElementById('sub-customer-email').value = '';
    document.getElementById('sub-customer-phone').value = '';
    
    // Hide modal
    document.getElementById('subscriptionModal').style.display = 'none';
}

// Duplicate validation state
let emailValidationState = {
    isValidating: false,
    isDuplicate: false,
    isReturningCustomer: false,
    lastValidatedEmail: null,
    validationTimeout: null
};

// Reset email validation state
function resetEmailValidationState() {
    TimerManager.clear('emailValidation');
    emailValidationState = {
        isValidating: false,
        isDuplicate: false,
        isReturningCustomer: false,
        lastValidatedEmail: null,
        validationTimeout: null
    };
    showEmailValidationMessage('clear');
}

// Email duplicate validation function
async function checkEmailDuplicate(email) {
    if (!email || !email.includes('@')) return null;
    
    try {
        const response = await fetch(`${WORKER_URL}/check-duplicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase() })
        });

        if (!response.ok) {
            console.warn('Duplicate check failed:', response.status);
            return null;
        }

        const result = await response.json();
        return {
            isDuplicate: result.isDuplicate || false,
            isReturningCustomer: result.isReturningCustomer || false,
            portalUrl: result.portalUrl || null
        };
    } catch (error) {
        console.warn('Email validation error:', error);
        return null;
    }
}

// Show/hide email validation messages
function showEmailValidationMessage(type, portalUrl = null) {
    const loadingDiv = document.getElementById('email-validation-loading');
    const activeDiv = document.getElementById('email-duplicate-active');
    const returningDiv = document.getElementById('email-duplicate-returning');
    const errorDiv = document.getElementById('email-validation-error');
    const successDiv = document.getElementById('email-validation-success');
    
    // Hide all messages first
    [loadingDiv, activeDiv, returningDiv, errorDiv, successDiv].forEach(div => {
        if (div) div.style.display = 'none';
    });
    
    switch (type) {
        case 'loading':
            if (loadingDiv) loadingDiv.style.display = 'block';
            break;
        case 'active':
            if (activeDiv) {
                activeDiv.style.display = 'block';
                const portalLink = activeDiv.querySelector('#redirect-to-portal');
                if (portalLink && portalUrl) {
                    portalLink.onclick = (e) => {
                        e.preventDefault();
                        window.open(portalUrl, '_blank');
                    };
                }
            }
            break;
        case 'returning':
            if (returningDiv) returningDiv.style.display = 'block';
            break;
        case 'error':
            if (errorDiv) errorDiv.style.display = 'block';
            break;
        case 'success':
            if (successDiv) successDiv.style.display = 'block';
            break;
        case 'clear':
            // All messages already hidden
            break;
    }
}

// Handle email blur validation
function handleEmailBlur(email) {
    TimerManager.clear('emailValidation');
    
    if (!email || !email.includes('@') || email === emailValidationState.lastValidatedEmail) {
        showEmailValidationMessage('clear');
        return;
    }
    
    TimerManager.set('emailValidation', async () => {
        emailValidationState.isValidating = true;
        emailValidationState.lastValidatedEmail = email;
        
        showEmailValidationMessage('loading');
        
        const result = await checkEmailDuplicate(email);
        emailValidationState.isValidating = false;
        
        if (result === null) {
            showEmailValidationMessage('error');
            emailValidationState.isDuplicate = false;
            emailValidationState.isReturningCustomer = false;
        } else if (result.isDuplicate) {
            showEmailValidationMessage('active', result.portalUrl);
            emailValidationState.isDuplicate = true;
            emailValidationState.isReturningCustomer = false;
        } else if (result.isReturningCustomer) {
            showEmailValidationMessage('returning');
            emailValidationState.isDuplicate = false;
            emailValidationState.isReturningCustomer = true;
        } else {
            showEmailValidationMessage('success');
            emailValidationState.isDuplicate = false;
            emailValidationState.isReturningCustomer = false;
        }
    }, 500); // 500ms delay to avoid too many API calls
}

// Handle subscription form submission
document.addEventListener('DOMContentLoaded', function() {
    // Set up email validation
    const emailInput = document.getElementById('sub-customer-email');
    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            handleEmailBlur(this.value.trim().toLowerCase());
        });
        
        // Clear validation when user starts typing
        emailInput.addEventListener('input', function() {
            if (emailValidationState.validationTimeout) {
                clearTimeout(emailValidationState.validationTimeout);
            }
            if (this.value.trim() !== emailValidationState.lastValidatedEmail) {
                showEmailValidationMessage('clear');
                emailValidationState.isDuplicate = false;
                emailValidationState.isReturningCustomer = false;
            }
        });
    }
    
    const subscriptionForm = document.getElementById('subscriptionForm');
    if (subscriptionForm) {
        subscriptionForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const errorDiv = document.getElementById('subscription-error');
            const loadingDiv = document.getElementById('subscription-loading');
            const submitBtn = e.target.querySelector('button[type="submit"]');
            const email = document.getElementById('sub-customer-email').value.trim().toLowerCase();
            
            // Check if user has active duplicate and prevent submission
            if (emailValidationState.isDuplicate && !emailValidationState.isReturningCustomer) {
                showEmailValidationMessage('active');
                errorDiv.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i>You already have an active subscription. Please manage your existing subscription instead.';
                errorDiv.style.display = 'block';
                return;
            }
            
            // Wait for any ongoing validation to complete
            if (emailValidationState.isValidating) {
                showToast('Please wait for email validation to complete', 'info');
                return;
            }
            
            // Show loading state
            submitBtn.disabled = true;
            loadingDiv.style.display = 'block';
            errorDiv.style.display = 'none';
            showEmailValidationMessage('clear');
            
            try {
                const customerData = {
                    restaurantName: document.getElementById('sub-restaurant-name').value,
                    name: document.getElementById('sub-customer-name').value,
                    email: email,
                    phone: document.getElementById('sub-customer-phone').value
                };
                
                const response = await fetch(`${WORKER_URL}/create-checkout-session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(customerData)
                });
                
                if (response.status === 409) {
                    // Handle duplicate customer response from backend
                    const duplicateData = await response.json();
                    if (duplicateData.redirectToPortal && duplicateData.portalUrl) {
                        errorDiv.innerHTML = `<i class="fas fa-info-circle mr-2"></i>You already have an active subscription. <a href="${duplicateData.portalUrl}" target="_blank" class="underline font-semibold">Manage your subscription here</a>.`;
                        errorDiv.className = 'bg-blue-50 border-l-4 border-blue-400 p-3 text-blue-700 text-sm rounded';
                        errorDiv.style.display = 'block';
                    } else {
                        errorDiv.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i>This email is already associated with an active subscription.';
                        errorDiv.style.display = 'block';
                    }
                    return;
                }
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP ${response.status}: Failed to create checkout session`);
                }
                
                const session = await response.json();
                
                if (!session.checkoutUrl) {
                    throw new Error('Invalid checkout session response');
                }
                
                // Redirect to Stripe Checkout
                window.location.href = session.checkoutUrl;
                
            } catch (error) {
                console.error('Subscription error:', error);
                
                // Provide user-friendly error messages
                let userMessage = 'Something went wrong. Please try again.';
                
                if (error.message.includes('fetch')) {
                    userMessage = 'Network error. Please check your connection and try again.';
                } else if (error.message.includes('Invalid checkout')) {
                    userMessage = 'Unable to create checkout session. Please try again.';
                } else if (error.message.includes('HTTP 4')) {
                    userMessage = 'Invalid information provided. Please check your details.';
                } else if (error.message.includes('HTTP 5')) {
                    userMessage = 'Server error. Please try again in a moment.';
                }
                
                errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle mr-2"></i>${userMessage}`;
                errorDiv.className = 'bg-red-50 border-l-4 border-red-400 p-3 text-red-700 text-sm rounded';
                errorDiv.style.display = 'block';
                
                // Reset button state
                submitBtn.disabled = false;
                loadingDiv.style.display = 'none';
            }
        });
    }
});

// Function to unlock POSPal after successful payment
function unlockPOSPal(unlockToken, customerEmail = null, customerName = null) {
    console.log('POSPal unlocked with token:', unlockToken);
    
    // Hide the trial/expired UI elements
    const trialActions = document.getElementById('trial-actions');
    if (trialActions) {
        trialActions.classList.add('hidden');
    }
    
    const expiredOverlay = document.getElementById('expired-overlay');
    if (expiredOverlay) {
        expiredOverlay.classList.add('hidden');
    }
    
    // Close payment modal
    closeEmbeddedPayment();
    
    // Store the unlock token and customer info locally for future validation
    localStorage.setItem('pospal_unlock_token', unlockToken);
    localStorage.setItem('pospal_license_status', 'active');
    localStorage.setItem('pospal_license_validated', new Date().getTime());
    localStorage.setItem('pospal_cached_status', 'active');
    localStorage.setItem('pospal_last_validation_check', Date.now().toString());
    
    // Store customer info if provided (for future validation calls)
    if (customerEmail) {
        localStorage.setItem('pospal_customer_email', customerEmail);
    }
    if (customerName) {
        localStorage.setItem('pospal_customer_name', customerName);
    }
    
    // Show success message
    showToast('🎉 Welcome to POSPal Pro! Your app is now unlocked.', 'success', 5000);
    
    // Refresh the page to ensure all locked features are enabled
    setTimeout(() => {
        window.location.reload();
    }, 2000);
}

// Listen for messages from the payment modal iframe
window.addEventListener('message', function(event) {
    if (event.data && event.data.action) {
        switch (event.data.action) {
            case 'closeModal':
                closeEmbeddedPayment();
                break;
            case 'paymentSuccess':
                if (event.data.unlockToken) {
                    unlockPOSPal(event.data.unlockToken, event.data.customerEmail, event.data.customerName);
                }
                break;
            default:
                console.log('Unknown message from payment modal:', event.data);
        }
    }
});

// --- UNIFIED NOTIFICATION SYSTEM INTEGRATION ---

// Enhanced notification functions using the unified manager
function showUnifiedProgressiveWarning(daysSinceLastValidation, normalGraceDays, totalGraceDays) {
    if (!window.NotificationManager) {
        return showProgressiveWarning(daysSinceLastValidation, normalGraceDays, totalGraceDays);
    }

    const warningDay = Math.floor(daysSinceLastValidation - normalGraceDays) + 1;
    const remainingDays = Math.max(0, totalGraceDays - daysSinceLastValidation);

    // Check if warning is temporarily dismissed
    const dismissedUntil = localStorage.getItem('pospal_warning_dismissed_until');
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil)) {
        return;
    }

    // Determine warning level and content
    let warningLevel, warningTitle, warningMessage, warningIcon, priority;

    if (warningDay === 1) {
        warningLevel = 'info';
        warningTitle = 'Connection Notice';
        warningMessage = `License verification recommended. ${remainingDays.toFixed(1)} days remaining before entering trial mode.`;
        warningIcon = 'fa-info-circle';
        priority = 'normal';
    } else if (warningDay === 2) {
        warningLevel = 'warning';
        warningTitle = 'License Verification Needed';
        warningMessage = `Your license needs verification. ${remainingDays.toFixed(1)} days remaining before entering trial mode. Please reconnect to the internet.`;
        warningIcon = 'fa-exclamation-triangle';
        priority = 'high';
    } else {
        warningLevel = 'urgent';
        warningTitle = 'FINAL DAY - Action Required';
        warningMessage = `This is your final day! License verification required within ${remainingDays.toFixed(1)} days or POSPal will enter trial mode. Please connect to the internet immediately.`;
        warningIcon = 'fa-exclamation-circle';
        priority = 'critical';
    }

    const actions = [
        {
            id: 'reconnect',
            label: 'Try Reconnect',
            icon: 'fa-wifi',
            handler: () => attemptReconnect()
        },
        {
            id: 'help',
            label: 'Connection Help',
            icon: 'fa-question-circle',
            handler: () => showConnectivityHelp()
        }
    ];

    if (warningDay >= 2) {
        actions.push({
            id: 'dismiss',
            label: 'Dismiss (1hr)',
            handler: () => dismissWarningTemporarily()
        });
    }

    // Show unified banner notification
    const notificationId = window.NotificationManager.showBanner(
        warningTitle,
        warningMessage,
        actions,
        priority
    );

    // Show appropriate notification only if not actively taking orders
    if (!isActivelyTakingOrders()) {
        if (warningDay === 1) {
            showToast('License verification needed - please check your connection when convenient', 'info', 3000);
        } else if (warningDay === 2) {
            showToast(`Warning: ${remainingDays.toFixed(1)} days remaining for license verification`, 'warning', 4000);
        } else {
            showToast(`URGENT: Final day for license verification! ${remainingDays.toFixed(1)} days remaining`, 'error', 5000);
        }
    } else {
        // During operations, just update the status display without popups
        console.log(`License warning suppressed during operations: ${remainingDays.toFixed(1)} days remaining`);
        updateLicenseStatusIndicator('warning', remainingDays);
    }

    // Store warning display to avoid spam
    localStorage.setItem(`pospal_warning_shown_day_${warningDay}`, Date.now().toString());

    return notificationId;
}

function showUnifiedOfflineIndicator(daysSinceLastValidation, gracePeriodDays) {
    if (!window.NotificationManager) {
        // return showOfflineIndicator(daysSinceLastValidation, gracePeriodDays); // Removed invasive popup
        return; // Just update status silently
    }

    const remainingDays = Math.max(0, gracePeriodDays - daysSinceLastValidation);
    const percentRemaining = (remainingDays / gracePeriodDays) * 100;

    // Create enhanced message with progress bar
    const progressBarHTML = `
        <div class="w-full bg-orange-200 rounded-full h-1.5 mt-1">
            <div class="bg-orange-500 h-1.5 rounded-full transition-all duration-300"
                 style="width: ${percentRemaining}%"></div>
        </div>
    `;

    const message = `
        <div class="flex items-center space-x-2">
            <div class="flex-shrink-0">
                <i class="fas fa-wifi-slash text-orange-500"></i>
            </div>
            <div class="flex-1 text-sm">
                <div class="font-medium">Offline Mode</div>
                <div class="text-orange-600" data-remaining-days>
                    ${remainingDays.toFixed(1)} days remaining
                </div>
                ${progressBarHTML}
            </div>
        </div>
    `;

    const actions = [{
        id: 'reconnect',
        label: '',
        icon: 'fa-refresh',
        handler: () => attemptReconnect()
    }];

    const notificationId = window.NotificationManager.show({
        type: 'persistent',
        message: message,
        actions: actions,
        dismissible: false,
        autoHide: false,
        updateInterval: 60000, // Update every minute
        onUpdate: (notification, element) => {
            const newDaysSince = (Date.now() - parseInt(localStorage.getItem('pospal_last_successful_validation') || '0')) / (1000 * 60 * 60 * 24);
            const newRemainingDays = Math.max(0, gracePeriodDays - newDaysSince);
            const newPercentRemaining = (newRemainingDays / gracePeriodDays) * 100;

            // Update remaining days display
            const remainingElement = element.querySelector('[data-remaining-days]');
            if (remainingElement) {
                remainingElement.textContent = `${newRemainingDays.toFixed(1)} days remaining`;
            }

            // Update progress bar
            const progressElement = element.querySelector('.bg-orange-500');
            if (progressElement) {
                progressElement.style.width = `${newPercentRemaining}%`;
            }

            // Change color as grace period runs out
            if (newPercentRemaining < 20) {
                element.className = element.className.replace('bg-orange-100 border-orange-300 text-orange-800', 'bg-red-100 border-red-300 text-red-800');
            }

            // Auto-hide if grace period expired
            if (!isInOfflineGracePeriod()) {
                window.NotificationManager.hide(notification.id);
            }
        }
    });

    return notificationId;
}

// Restaurant hours awareness
function isRestaurantPeakHours() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday

    // Standard restaurant peak hours
    const lunchRush = hour >= 11 && hour <= 14; // 11am-2pm
    const dinnerRush = hour >= 18 && hour <= 21; // 6pm-9pm

    // Weekend variations
    const isWeekend = day === 0 || day === 6; // Sunday or Saturday
    const weekendExtended = isWeekend && (
        (hour >= 12 && hour <= 23) // Extended weekend hours
    );

    return lunchRush || dinnerRush || weekendExtended;
}

// Customer data collection for segmentation
function collectCustomerData() {
    const now = Date.now();
    const installDate = localStorage.getItem('pospal_install_date') || now;
    const accountAge = Math.floor((now - parseInt(installDate)) / (1000 * 60 * 60 * 24));

    // Usage analytics
    const sessionStart = localStorage.getItem('pospal_session_start') || now;
    const totalSessions = parseInt(localStorage.getItem('pospal_total_sessions') || '1');
    const avgSessionTime = parseInt(localStorage.getItem('pospal_avg_session_time') || '0');

    // Order and feature usage
    const totalOrders = getTotalOrdersCount();
    const featuresUsed = getActiveFeaturesCount();
    const monthlyOrders = getMonthlyOrdersCount();

    // Payment history
    const paymentFailures = parseInt(localStorage.getItem('pospal_payment_failures') || '0');
    const downgradeCarts = parseInt(localStorage.getItem('pospal_downgrade_attempts') || '0');
    const lastPaymentDate = localStorage.getItem('pospal_last_payment_date');

    // Support interactions
    const supportTickets = parseInt(localStorage.getItem('pospal_support_tickets') || '0');
    const lastSupportDate = localStorage.getItem('pospal_last_support_date');

    // Calculate derived metrics
    const avgDailyUsage = accountAge > 0 ? (avgSessionTime * totalSessions) / accountAge / (1000 * 60 * 60) : 0;
    const paymentHistory = paymentFailures === 0 ? 'consistent' : paymentFailures > 3 ? 'problematic' : 'occasional_issues';
    const usagePattern = detectUsagePattern(totalSessions, accountAge);

    return {
        accountAge,
        avgDailyUsage,
        featuresUsed,
        monthlyOrders,
        paymentFailures,
        downgradeCarts,
        paymentHistory,
        supportTickets: supportTickets > 5 ? 'many' : 'few',
        usagePattern,
        usageDecline: detectUsageDecline(),
        trialsUsed: parseInt(localStorage.getItem('pospal_trials_used') || '0'),
        name: getCustomerName() || 'Valued Customer'
    };
}

function getTotalOrdersCount() {
    const orders = JSON.parse(localStorage.getItem('pospal_order_history') || '[]');
    return orders.length || parseInt(localStorage.getItem('pospal_total_orders') || '0');
}

function getActiveFeaturesCount() {
    const features = [
        'table_management', 'inventory', 'reporting', 'multi_location',
        'custom_menu', 'payment_integration', 'staff_management'
    ];
    return features.filter(feature =>
        localStorage.getItem(`pospal_feature_${feature}_used`) === 'true'
    ).length;
}

function getMonthlyOrdersCount() {
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const orders = JSON.parse(localStorage.getItem('pospal_order_history') || '[]');
    return orders.filter(order => order.timestamp > oneMonthAgo).length;
}

function detectUsagePattern(totalSessions, accountAge) {
    if (accountAge < 30) return 'new';

    const avgSessionsPerWeek = (totalSessions / accountAge) * 7;
    if (avgSessionsPerWeek > 20) return 'heavy';
    if (avgSessionsPerWeek > 10) return 'regular';
    if (avgSessionsPerWeek > 3) return 'moderate';

    // Check for seasonal patterns
    const lastQuarterSessions = parseInt(localStorage.getItem('pospal_last_quarter_sessions') || '0');
    const previousQuarterSessions = parseInt(localStorage.getItem('pospal_previous_quarter_sessions') || '0');

    if (Math.abs(lastQuarterSessions - previousQuarterSessions) > (previousQuarterSessions * 0.5)) {
        return 'seasonal';
    }

    return 'light';
}

function detectUsageDecline() {
    const currentWeekSessions = parseInt(localStorage.getItem('pospal_current_week_sessions') || '0');
    const lastWeekSessions = parseInt(localStorage.getItem('pospal_last_week_sessions') || '0');
    const avgWeeklySessions = parseInt(localStorage.getItem('pospal_avg_weekly_sessions') || '0');

    return currentWeekSessions < (avgWeeklySessions * 0.6);
}

function getCustomerName() {
    return localStorage.getItem('pospal_customer_name') ||
           localStorage.getItem('pospal_business_name') ||
           sessionStorage.getItem('user_name');
}

// Smart notification system with customer segmentation and advanced intelligence
function showSmartProgressiveWarning(daysSinceLastValidation, gracePeriodDays) {
    if (!window.CustomerSegmentationManager || !window.NotificationManager) {
        return showProgressiveWarning(daysSinceLastValidation, gracePeriodDays);
    }

    // Suppress intrusive notifications during active order taking
    if (isActivelyTakingOrders()) {
        console.log('Smart progressive warning suppressed during order operations');
        const remainingDays = Math.max(0, gracePeriodDays - daysSinceLastValidation);
        updateLicenseStatusIndicator('warning', remainingDays);
        return null;
    }

    const customerData = collectCustomerData();
    const insights = window.CustomerSegmentationManager.generateCustomerInsights(customerData);

    // Use advanced intelligence if available
    if (window.AdvancedNotificationIntelligence) {
        const intelligence = window.AdvancedNotificationIntelligence.getNotificationIntelligence({
            type: 'payment_warning',
            segment: insights.segment,
            urgency: gracePeriodDays - daysSinceLastValidation <= 1 ? 'high' : 'medium',
            context: { daysSinceLastValidation, gracePeriodDays }
        });

        // Check if we should delay the notification
        if (intelligence.recommendation === 'delay') {
            const delay = intelligence.suggestedDelay || 60 * 60 * 1000; // 1 hour default
            TimerManager.set('smart-warning-delayed', () => {
                showSmartProgressiveWarning(daysSinceLastValidation, gracePeriodDays);
            }, delay, 'timeout');

            // Record the delay decision
            window.AdvancedNotificationIntelligence.recordExperimentMetric(
                'notification_timing',
                'delay_decision',
                1
            );

            // Show a minimal indication that notification was delayed
            if (intelligence.reason) {
                console.log(`Notification delayed: ${intelligence.reason}`);
            }
            return;
        }

        // Record the show decision
        window.AdvancedNotificationIntelligence.recordExperimentMetric(
            'notification_timing',
            'show_decision',
            1
        );
    }

    // Check if we should show notification now based on optimal timing
    const optimalTime = insights.optimalTiming;
    if (optimalTime && optimalTime.getTime() > Date.now()) {
        // Schedule for later
        const delay = optimalTime.getTime() - Date.now();
        TimerManager.set('smart-warning-delayed', () => {
            showSmartProgressiveWarning(daysSinceLastValidation, gracePeriodDays);
        }, delay, 'timeout');
        return;
    }

    // Use smart grace period
    const adjustedGracePeriod = insights.gracePeriod || gracePeriodDays;
    const remainingDays = Math.max(0, adjustedGracePeriod - daysSinceLastValidation);

    // Determine warning stage
    const warningStage = remainingDays <= 1 ? 3 : remainingDays <= 3 ? 2 : 1;

    // Get personalized content
    const contentType = warningStage === 3 ? 'payment_failure' : 'grace_warning';
    const personalizedContent = insights.personalizedContent;

    // Customize title and message
    let warningTitle = personalizedContent.subject || 'License Verification Needed';
    let warningMessage = `
        <div class="space-y-3">
            <div class="flex items-center justify-between">
                <span class="text-sm font-medium">${remainingDays.toFixed(1)} days remaining</span>
                <span class="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">
                    ${insights.segment.replace('_', ' ').toUpperCase()}
                </span>
            </div>
            <div class="text-sm text-gray-600">
                ${getSegmentSpecificMessage(insights.segment, remainingDays)}
            </div>
        </div>
    `;

    // Segment-specific actions
    const actions = getSegmentSpecificActions(insights, remainingDays);

    // Priority based on segment and urgency
    const priority = insights.retentionPriority === 'high' ? 'high' :
                    remainingDays <= 1 ? 'critical' : 'normal';

    // Check for recent dismissals with segment-aware timing
    const dismissKey = `pospal_warning_dismissed_until_${insights.segment}`;
    const dismissedUntil = parseInt(localStorage.getItem(dismissKey) || '0');
    if (Date.now() < dismissedUntil) {
        return null;
    }

    // Show unified banner notification
    const notificationId = window.NotificationManager.show({
        type: 'banner',
        title: warningTitle,
        message: warningMessage,
        actions: actions,
        priority: priority,
        dismissible: warningStage < 3,
        autoHide: false,
        className: `bg-gradient-to-r ${getSegmentGradient(insights.segment)} border-2 border-orange-300 text-gray-800 p-4 rounded-lg shadow-lg`
    });

    // Segment-specific toast follow-up
    showSegmentSpecificToast(insights.segment, remainingDays, warningStage);

    // Store display timestamp for segment tracking
    localStorage.setItem(`pospal_last_warning_${insights.segment}`, Date.now().toString());

    return notificationId;
}

function getSegmentSpecificMessage(segment, remainingDays) {
    const messages = {
        power_users: `As a valued partner, we want to ensure your high-volume operations continue smoothly. Let's resolve this quickly.`,
        loyal_customers: `We appreciate your continued trust in POSPal. A quick update will keep everything running perfectly.`,
        new_adopters: `Welcome! We're here to help you get the most out of POSPal. Our support team is ready to assist.`,
        seasonal_restaurants: `We understand seasonal operations. Flexible options are available to accommodate your business cycle.`,
        price_sensitive: `We value your business and have payment options available. Let's find a solution that works for you.`,
        high_risk: `Immediate attention required to maintain service access.`,
        default: `License verification needed to continue seamless operations.`
    };
    return messages[segment] || messages.default;
}

function getSegmentSpecificActions(insights, remainingDays) {
    const baseActions = [{
        id: 'fix_payment',
        label: 'Update Payment',
        icon: 'fa-credit-card',
        handler: () => {
            trackSegmentAction(insights.segment, 'payment_update');
            window.open('/payment-update', '_blank');
        }
    }];

    // Segment-specific additional actions
    const segmentActions = {
        power_users: [{
            id: 'priority_support',
            label: 'Priority Support',
            icon: 'fa-headset',
            handler: () => {
                trackSegmentAction(insights.segment, 'priority_support');
                window.open('mailto:priority@pospal.com?subject=Priority Support Request', '_blank');
            }
        }],

        new_adopters: [{
            id: 'get_help',
            label: 'Get Setup Help',
            icon: 'fa-user-graduate',
            handler: () => {
                trackSegmentAction(insights.segment, 'onboarding_help');
                window.open('/onboarding-help', '_blank');
            }
        }],

        price_sensitive: [{
            id: 'payment_options',
            label: 'Payment Plans',
            icon: 'fa-calendar-alt',
            handler: () => {
                trackSegmentAction(insights.segment, 'payment_plans');
                window.open('/payment-plans', '_blank');
            }
        }],

        seasonal_restaurants: [{
            id: 'seasonal_pause',
            label: 'Seasonal Options',
            icon: 'fa-pause',
            handler: () => {
                trackSegmentAction(insights.segment, 'seasonal_pause');
                window.open('/seasonal-billing', '_blank');
            }
        }]
    };

    const additionalActions = segmentActions[insights.segment] || [];

    // Add dismissal option for non-critical stages
    if (remainingDays > 1) {
        baseActions.push({
            id: 'dismiss_smart',
            label: 'Later',
            handler: () => dismissSmartWarning(insights)
        });
    }

    return [...baseActions, ...additionalActions];
}

function getSegmentGradient(segment) {
    const gradients = {
        power_users: 'from-purple-100 to-indigo-100',
        loyal_customers: 'from-green-100 to-emerald-100',
        new_adopters: 'from-blue-100 to-cyan-100',
        seasonal_restaurants: 'from-yellow-100 to-amber-100',
        price_sensitive: 'from-orange-100 to-red-100',
        high_risk: 'from-red-100 to-pink-100',
        default: 'from-gray-100 to-slate-100'
    };
    return gradients[segment] || gradients.default;
}

function showSegmentSpecificToast(segment, remainingDays, warningStage) {
    const toastMessages = {
        power_users: `Partnership renewal needed - ${remainingDays.toFixed(1)} days remaining`,
        loyal_customers: `Quick payment update needed - ${remainingDays.toFixed(1)} days left`,
        new_adopters: `We're here to help with your payment setup`,
        seasonal_restaurants: `Flexible billing options available`,
        price_sensitive: `Payment assistance available`,
        high_risk: `URGENT: Service suspension imminent`,
        default: `License verification needed`
    };

    const toastType = warningStage === 3 ? 'error' : warningStage === 2 ? 'warning' : 'info';
    const duration = warningStage === 3 ? 10000 : warningStage === 2 ? 7000 : 5000;

    showToast(toastMessages[segment] || toastMessages.default, toastType, duration);
}

function dismissSmartWarning(insights) {
    const segment = insights.segment;
    const isHighValue = ['power_users', 'loyal_customers'].includes(segment);
    const isPeakHours = insights.isPeakHours;

    // Smart dismissal duration based on segment and timing
    let dismissDuration;
    if (isHighValue && isPeakHours) {
        dismissDuration = 4 * 60 * 60 * 1000; // 4 hours for high-value during peak
    } else if (isHighValue) {
        dismissDuration = 2 * 60 * 60 * 1000; // 2 hours for high-value off-peak
    } else if (isPeakHours) {
        dismissDuration = 3 * 60 * 60 * 1000; // 3 hours for others during peak
    } else {
        dismissDuration = 1 * 60 * 60 * 1000; // 1 hour standard
    }

    const dismissUntil = Date.now() + dismissDuration;
    localStorage.setItem(`pospal_warning_dismissed_until_${segment}`, dismissUntil.toString());

    // Hide active notifications
    if (window.NotificationManager) {
        window.NotificationManager.clear('banner');
    }

    // Track dismissal
    trackSegmentAction(segment, 'dismiss', { duration: dismissDuration });

    const hoursText = Math.round(dismissDuration / (60 * 60 * 1000));
    showToast(`Notifications paused for ${hoursText} hour${hoursText > 1 ? 's' : ''} (${segment.replace('_', ' ')})`, 'info', 3000);
}

function trackSegmentAction(segment, action, metadata = {}) {
    const trackingData = {
        segment,
        action,
        timestamp: Date.now(),
        isPeakHours: isRestaurantPeakHours(),
        responseTime: metadata.responseTime || null,
        notificationType: metadata.notificationType || 'unknown',
        ...metadata
    };

    // Store in analytics
    const analytics = JSON.parse(localStorage.getItem('pospal_segment_analytics') || '[]');
    analytics.push(trackingData);

    // Keep only last 100 actions
    if (analytics.length > 100) {
        analytics.splice(0, analytics.length - 100);
    }

    localStorage.setItem('pospal_segment_analytics', JSON.stringify(analytics));

    // Record in advanced intelligence system if available
    if (window.AdvancedNotificationIntelligence) {
        window.AdvancedNotificationIntelligence.recordExperimentMetric(
            'user_behavior',
            action,
            action === 'payment_update' ? 1 : // Conversion action
            action === 'dismiss' ? 0 : // Non-conversion action
            0.5 // Neutral action
        );

        // Record engagement metrics
        if (action !== 'dismiss') {
            window.AdvancedNotificationIntelligence.recordExperimentMetric(
                'engagement',
                'action_taken',
                1
            );
        }

        // Record timing metrics
        if (trackingData.responseTime) {
            window.AdvancedNotificationIntelligence.recordExperimentMetric(
                'response_time',
                'action_response',
                trackingData.responseTime
            );
        }
    }
}

// Smart offline indicator with customer segmentation
function showSmartOfflineIndicator(daysSinceLastValidation, gracePeriodDays) {
    if (!window.CustomerSegmentationManager || !window.NotificationManager) {
        // return showOfflineIndicator(daysSinceLastValidation, gracePeriodDays); // Removed invasive popup
        return; // Just update status silently
    }

    const customerData = collectCustomerData();
    const insights = window.CustomerSegmentationManager.generateCustomerInsights(customerData);

    // Use smart grace period
    const adjustedGracePeriod = insights.gracePeriod || gracePeriodDays;
    const remainingDays = Math.max(0, adjustedGracePeriod - daysSinceLastValidation);
    const percentRemaining = (remainingDays / adjustedGracePeriod) * 100;

    // Segment-specific styling and messaging
    const segmentConfig = getSegmentOfflineConfig(insights.segment);

    // Create enhanced message with segment awareness
    const progressBarHTML = `
        <div class="w-full ${segmentConfig.progressBg} rounded-full h-1.5 mt-1">
            <div class="${segmentConfig.progressBar} h-1.5 rounded-full transition-all duration-300"
                 style="width: ${percentRemaining}%"></div>
        </div>
    `;

    const message = `
        <div class="flex items-center space-x-3">
            <div class="flex-shrink-0">
                <i class="fas fa-wifi-slash ${segmentConfig.iconColor}"></i>
            </div>
            <div class="flex-1 text-sm">
                <div class="font-medium flex items-center justify-between">
                    <span>Offline Mode</span>
                    <span class="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">
                        ${insights.segment.replace('_', ' ').toUpperCase()}
                    </span>
                </div>
                <div class="${segmentConfig.textColor}" data-remaining-days>
                    ${remainingDays.toFixed(1)} days remaining
                </div>
                <div class="text-xs text-gray-500 mt-1">
                    ${segmentConfig.message}
                </div>
                ${progressBarHTML}
            </div>
        </div>
    `;

    // Segment-specific actions
    const actions = [{
        id: 'reconnect',
        label: '',
        icon: 'fa-refresh',
        handler: () => {
            trackSegmentAction(insights.segment, 'reconnect_attempt');
            attemptReconnect();
        }
    }];

    // Add segment-specific action
    if (segmentConfig.additionalAction) {
        actions.push(segmentConfig.additionalAction);
    }

    const notificationId = window.NotificationManager.show({
        type: 'persistent',
        message: message,
        actions: actions,
        dismissible: false,
        autoHide: false,
        className: `${segmentConfig.styling} p-3 rounded-lg shadow-md`,
        updateInterval: 60000, // Update every minute
        onUpdate: (notification, element) => {
            const newDaysSince = (Date.now() - parseInt(localStorage.getItem('pospal_last_successful_validation') || '0')) / (1000 * 60 * 60 * 24);
            const newRemainingDays = Math.max(0, adjustedGracePeriod - newDaysSince);
            const newPercentRemaining = (newRemainingDays / adjustedGracePeriod) * 100;

            // Update remaining days display
            const remainingElement = element.querySelector('[data-remaining-days]');
            if (remainingElement) {
                remainingElement.textContent = `${newRemainingDays.toFixed(1)} days remaining`;
            }

            // Update progress bar
            const progressElement = element.querySelector(`.${segmentConfig.progressBar.split(' ')[0]}`);
            if (progressElement) {
                progressElement.style.width = `${newPercentRemaining}%`;
            }

            // Change color as grace period runs out
            if (newPercentRemaining < 20) {
                element.className = element.className.replace(segmentConfig.styling, 'bg-red-100 border-red-300 text-red-800');

                if (remainingElement) {
                    remainingElement.className = remainingElement.className.replace(segmentConfig.textColor, 'text-red-600');
                }
            }

            // Auto-hide if grace period expired or connection restored
            if (!isInOfflineGracePeriod() || window.isOnline) {
                window.NotificationManager.hide(notification.id);
            }
        }
    });

    // Track display
    trackSegmentAction(insights.segment, 'offline_indicator_shown', {
        remainingDays,
        gracePeriod: adjustedGracePeriod
    });

    return notificationId;
}

function getSegmentOfflineConfig(segment) {
    const configs = {
        power_users: {
            styling: 'bg-gradient-to-r from-purple-50 to-indigo-50 border-2 border-purple-200 text-gray-800',
            iconColor: 'text-purple-500',
            textColor: 'text-purple-600',
            progressBg: 'bg-purple-200',
            progressBar: 'bg-purple-500',
            message: 'Priority support available during connection issues',
            additionalAction: {
                id: 'priority_support',
                label: 'Support',
                icon: 'fa-headset',
                handler: () => window.open('mailto:priority@pospal.com?subject=Connection Issue', '_blank')
            }
        },

        loyal_customers: {
            styling: 'bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 text-gray-800',
            iconColor: 'text-green-500',
            textColor: 'text-green-600',
            progressBg: 'bg-green-200',
            progressBar: 'bg-green-500',
            message: 'Thank you for your loyalty - connection will restore automatically',
            additionalAction: null
        },

        new_adopters: {
            styling: 'bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-200 text-gray-800',
            iconColor: 'text-blue-500',
            textColor: 'text-blue-600',
            progressBg: 'bg-blue-200',
            progressBar: 'bg-blue-500',
            message: 'Need help? We\'re here to support your setup',
            additionalAction: {
                id: 'get_help',
                label: 'Help',
                icon: 'fa-question-circle',
                handler: () => window.open('/support/new-user', '_blank')
            }
        },

        seasonal_restaurants: {
            styling: 'bg-gradient-to-r from-yellow-50 to-amber-50 border-2 border-yellow-200 text-gray-800',
            iconColor: 'text-yellow-500',
            textColor: 'text-yellow-600',
            progressBg: 'bg-yellow-200',
            progressBar: 'bg-yellow-500',
            message: 'Seasonal billing options available if needed',
            additionalAction: {
                id: 'seasonal_pause',
                label: 'Options',
                icon: 'fa-calendar',
                handler: () => window.open('/seasonal-billing', '_blank')
            }
        },

        price_sensitive: {
            styling: 'bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-200 text-gray-800',
            iconColor: 'text-orange-500',
            textColor: 'text-orange-600',
            progressBg: 'bg-orange-200',
            progressBar: 'bg-orange-500',
            message: 'Flexible payment options available',
            additionalAction: {
                id: 'payment_help',
                label: 'Plans',
                icon: 'fa-dollar-sign',
                handler: () => window.open('/payment-assistance', '_blank')
            }
        },

        high_risk: {
            styling: 'bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-300 text-gray-800',
            iconColor: 'text-red-500',
            textColor: 'text-red-600',
            progressBg: 'bg-red-200',
            progressBar: 'bg-red-500',
            message: 'Immediate action required to maintain service',
            additionalAction: {
                id: 'urgent_support',
                label: 'Urgent',
                icon: 'fa-exclamation-triangle',
                handler: () => window.open('mailto:urgent@pospal.com?subject=Service Risk', '_blank')
            }
        },

        default: {
            styling: 'bg-gradient-to-r from-gray-50 to-slate-50 border-2 border-gray-200 text-gray-800',
            iconColor: 'text-gray-500',
            textColor: 'text-gray-600',
            progressBg: 'bg-gray-200',
            progressBar: 'bg-gray-500',
            message: 'System will reconnect automatically',
            additionalAction: null
        }
    };

    return configs[segment] || configs.default;
}

// Initialize A/B testing experiments for notification optimization
function initializeNotificationExperiments() {
    if (!window.AdvancedNotificationIntelligence) return;

    const intelligence = window.AdvancedNotificationIntelligence;

    // Experiment 1: Notification Timing Optimization
    if (!intelligence.experiments.has('timing_optimization')) {
        intelligence.createExperiment('timing_optimization', [
            { name: 'immediate', description: 'Show notifications immediately' },
            { name: 'delayed', description: 'Use intelligent delay based on behavior' },
            { name: 'scheduled', description: 'Schedule for optimal user hours' }
        ], {
            endTime: Date.now() + (14 * 24 * 60 * 60 * 1000) // 14 days
        });
    }

    // Experiment 2: Message Personalization
    if (!intelligence.experiments.has('message_personalization')) {
        intelligence.createExperiment('message_personalization', [
            { name: 'generic', description: 'Standard messages for all users' },
            { name: 'segment_based', description: 'Messages based on customer segment' },
            { name: 'behavior_based', description: 'Messages based on user behavior patterns' }
        ], {
            endTime: Date.now() + (21 * 24 * 60 * 60 * 1000) // 21 days
        });
    }

    // Experiment 3: Notification Frequency
    if (!intelligence.experiments.has('notification_frequency')) {
        intelligence.createExperiment('notification_frequency', [
            { name: 'standard', description: 'Standard frequency with fixed intervals' },
            { name: 'adaptive', description: 'Frequency adapts to user engagement' },
            { name: 'minimal', description: 'Reduced frequency for better experience' }
        ], {
            endTime: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
        });
    }

    // Experiment 4: Action Button Optimization
    if (!intelligence.experiments.has('action_button_optimization')) {
        intelligence.createExperiment('action_button_optimization', [
            { name: 'single_primary', description: 'One main action button' },
            { name: 'multiple_options', description: 'Multiple action choices' },
            { name: 'progressive_disclosure', description: 'Show options based on engagement' }
        ], {
            endTime: Date.now() + (14 * 24 * 60 * 60 * 1000) // 14 days
        });
    }

    console.log('Notification A/B testing experiments initialized');
}

// Apply experimental configurations to notifications
function applyExperimentalConfig(baseConfig, segment) {
    if (!window.AdvancedNotificationIntelligence) return baseConfig;

    const intelligence = window.AdvancedNotificationIntelligence;
    let config = { ...baseConfig };

    // Apply timing experiment
    const timingVariant = intelligence.getExperimentVariant('timing_optimization');
    if (timingVariant) {
        switch (timingVariant.variant.name) {
            case 'immediate':
                config.delayStrategy = 'none';
                break;
            case 'delayed':
                config.delayStrategy = 'intelligent';
                break;
            case 'scheduled':
                config.delayStrategy = 'optimal_timing';
                break;
        }

        // Record participation
        intelligence.recordExperimentMetric('timing_optimization', 'notification_shown', 1);
    }

    // Apply personalization experiment
    const personalizationVariant = intelligence.getExperimentVariant('message_personalization');
    if (personalizationVariant) {
        switch (personalizationVariant.variant.name) {
            case 'generic':
                config.personalizationLevel = 'none';
                break;
            case 'segment_based':
                config.personalizationLevel = 'segment';
                break;
            case 'behavior_based':
                config.personalizationLevel = 'behavior';
                break;
        }
    }

    // Apply frequency experiment
    const frequencyVariant = intelligence.getExperimentVariant('notification_frequency');
    if (frequencyVariant) {
        switch (frequencyVariant.variant.name) {
            case 'standard':
                config.frequencyMultiplier = 1.0;
                break;
            case 'adaptive':
                config.frequencyMultiplier = intelligence.userBehaviorModel?.engagementScore || 0.5;
                break;
            case 'minimal':
                config.frequencyMultiplier = 0.5;
                break;
        }
    }

    // Apply action button experiment
    const actionButtonVariant = intelligence.getExperimentVariant('action_button_optimization');
    if (actionButtonVariant) {
        switch (actionButtonVariant.variant.name) {
            case 'single_primary':
                config.maxActionButtons = 1;
                break;
            case 'multiple_options':
                config.maxActionButtons = 3;
                break;
            case 'progressive_disclosure':
                config.maxActionButtons = intelligence.userBehaviorModel?.engagementScore > 0.7 ? 3 : 1;
                break;
        }
    }

    return config;
}

// Initialize experiments when the page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeNotificationExperiments);
} else {
    initializeNotificationExperiments();
}

// Enhanced dismissal with restaurant-aware timing
function dismissWarningTemporarily() {
    const dismissDuration = isRestaurantPeakHours() ? 3 * 60 * 60 * 1000 : 60 * 60 * 1000; // 3hrs during peak, 1hr otherwise
    const dismissUntil = Date.now() + dismissDuration;
    localStorage.setItem('pospal_warning_dismissed_until', dismissUntil.toString());

    // Hide any active progressive warnings
    if (window.NotificationManager) {
        window.NotificationManager.clear('banner');
    } else if (warningNotificationElement) {
        document.body.removeChild(warningNotificationElement);
        warningNotificationElement = null;
    }

    const hoursText = dismissDuration / (60 * 60 * 1000);
    showToast(`Notifications dismissed for ${hoursText} hour${hoursText > 1 ? 's' : ''}`, 'info', 3000);
}

// =============================================================================
// NON-INTRUSIVE LICENSING NOTIFICATION SYSTEM
// Prevents popups during active order taking
// =============================================================================

// Track user activity to determine if actively taking orders
let lastOrderActivity = 0;
let currentOrderItems = [];
let isManagementModalOpen = false;

// Check if user is actively taking orders (to suppress intrusive notifications)
function isActivelyTakingOrders() {
    const now = Date.now();
    const recentActivity = (now - lastOrderActivity) < 5 * 60 * 1000; // 5 minutes
    const hasCurrentOrder = currentOrderItems && currentOrderItems.length > 0;
    const modalOpen = document.getElementById('managementModal')?.style.display !== 'none' &&
                     !document.getElementById('managementModal')?.classList.contains('hidden');

    // User is actively taking orders if:
    // 1. They've interacted with the POS recently AND have items in current order
    // 2. OR the management modal is open (they're doing admin work)
    return (recentActivity && hasCurrentOrder) || modalOpen;
}

// Check if a message is licensing-related and should be suppressed during operations
function isLicensingRelatedMessage(message) {
    if (!message || typeof message !== 'string') return false;

    const licensingKeywords = [
        'license', 'verification', 'days remaining', 'trial', 'expire',
        'subscription', 'payment', 'billing', 'grace period', 'offline mode',
        'connectivity', 'validation', 'authentication'
    ];

    const lowerMessage = message.toLowerCase();
    return licensingKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Update license status indicator without intrusive popups
function updateLicenseStatusIndicator(status, daysRemaining) {
    // Update the header status badge if it exists
    const statusBadge = document.querySelector('#license-status-badge, .license-status-indicator');
    if (statusBadge) {
        let statusText = '';
        let badgeClass = '';

        if (status === 'warning' && daysRemaining !== undefined) {
            statusText = `${Math.ceil(daysRemaining)} days`;
            if (daysRemaining <= 1) {
                badgeClass = 'bg-red-100 text-red-800';
            } else if (daysRemaining <= 3) {
                badgeClass = 'bg-orange-100 text-orange-800';
            } else {
                badgeClass = 'bg-yellow-100 text-yellow-800';
            }
        }

        if (statusText) {
            statusBadge.textContent = statusText;
            statusBadge.className = `px-2 py-1 text-xs rounded-full ${badgeClass}`;
        }
    }

    // Update footer status if it exists
    const footerStatus = document.getElementById('footer-trial-status');
    if (footerStatus && status === 'warning' && daysRemaining !== undefined) {
        footerStatus.textContent = `License: ${Math.ceil(daysRemaining)} days remaining`;
        footerStatus.className = 'font-medium text-orange-600';
    }
}

// Track order activity for non-intrusive notification system
function trackOrderActivity() {
    lastOrderActivity = Date.now();
}

// Enhanced add-to-order function that tracks activity
function addToOrderWithTracking(itemId, categoryName, forceOptionsCheck = false) {
    trackOrderActivity();
    return addToOrder(itemId, categoryName, forceOptionsCheck);
}

// Enhanced remove-from-order function that tracks activity
function removeFromOrderWithTracking(orderIndex) {
    trackOrderActivity();
    return removeFromOrder(orderIndex);
}

// Monitor management modal state
function trackManagementModalState() {
    const modal = document.getElementById('managementModal');
    if (modal) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    isManagementModalOpen = modal.style.display !== 'none';
                } else if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    isManagementModalOpen = !modal.classList.contains('hidden');
                }
            });
        });

        observer.observe(modal, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }
}

// Initialize non-intrusive notification system
function initializeNonIntrusiveNotifications() {
    // Track management modal state
    trackManagementModalState();

    // Override existing order functions to track activity
    if (typeof addToOrder === 'function') {
        const originalAddToOrder = addToOrder;
        addToOrder = function(itemId, categoryName, forceOptionsCheck = false) {
            trackOrderActivity();
            return originalAddToOrder.call(this, itemId, categoryName, forceOptionsCheck);
        };
    }

    if (typeof removeFromOrder === 'function') {
        const originalRemoveFromOrder = removeFromOrder;
        removeFromOrder = function(orderIndex) {
            trackOrderActivity();
            return originalRemoveFromOrder.call(this, orderIndex);
        };
    }

    // Track when current order changes
    if (typeof updateCurrentOrderDisplay === 'function') {
        const originalUpdateDisplay = updateCurrentOrderDisplay;
        updateCurrentOrderDisplay = function() {
            // Capture current order items for activity detection
            currentOrderItems = getCurrentOrder() || [];
            return originalUpdateDisplay.call(this);
        };
    }

    console.log('Non-intrusive notification system initialized');
}

// Initialize the system when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeNonIntrusiveNotifications);
} else {
    initializeNonIntrusiveNotifications();
}

// =============================================================================
// END NON-INTRUSIVE LICENSING NOTIFICATION SYSTEM
// =============================================================================

// =============================================================================
// TABLE MANAGEMENT TOGGLE FUNCTIONALITY
// =============================================================================

/**
 * Toggle table management feature on/off
 */
async function toggleTableManagement(enabled) {
    try {
        // Show loading indicator
        const toggle = document.getElementById('tableManagementToggle');
        if (toggle) {
            toggle.disabled = true;
        }

        // Send update to backend
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                table_management_enabled: enabled
            })
        });

        if (!response.ok) {
            throw new Error('Failed to update table management setting');
        }

        // Update global state
        tableManagementEnabled = enabled;

        // Show success message
        const message = enabled ?
            'Table management enabled! Please refresh the page to see table features.' :
            'Table management disabled! Please refresh the page to return to simple mode.';

        showToast(message, 'success', 5000);

        // Suggest page refresh for immediate effect
        setTimeout(() => {
            if (confirm('Would you like to refresh the page now to apply the changes?')) {
                window.location.reload();
            }
        }, 1000);

    } catch (error) {
        console.error('Error toggling table management:', error);

        // Revert toggle state
        const toggle = document.getElementById('tableManagementToggle');
        if (toggle) {
            toggle.checked = !enabled;
        }

        showToast('Failed to update table management setting. Please try again.', 'error', 4000);
    } finally {
        // Re-enable toggle
        const toggle = document.getElementById('tableManagementToggle');
        if (toggle) {
            toggle.disabled = false;
        }
    }
}

/**
 * Initialize table management toggle state
 */
async function initializeTableManagementToggle() {
    try {
        // Get current config
        const response = await fetch('/api/config');
        const config = await response.json();

        // Update toggle state
        const toggle = document.getElementById('tableManagementToggle');
        if (toggle) {
            toggle.checked = !!config.table_management_enabled;
        }

        // Update global state
        tableManagementEnabled = !!config.table_management_enabled;

    } catch (error) {
        console.error('Error initializing table management toggle:', error);
    }
}

// Initialize toggle on page load and when management modal opens
document.addEventListener('DOMContentLoaded', () => {
    // Initialize immediately on page load
    setTimeout(() => {
        initializeTableManagementToggle();
    }, 500);

    // Also initialize when settings panel is opened (for consistency)
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                if (target.id === 'hardwarePrintingManagement' &&
                    !target.classList.contains('hidden')) {
                    // Settings panel opened, re-initialize toggle to ensure consistency
                    initializeTableManagementToggle();
                }
            }
        });
    });

    const settingsPanel = document.getElementById('hardwarePrintingManagement');
    if (settingsPanel) {
        observer.observe(settingsPanel, { attributes: true });
    }
});

// =============================================================================
// END TABLE MANAGEMENT TOGGLE FUNCTIONALITY
// =============================================================================
