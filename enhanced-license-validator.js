/**
 * Enhanced License Validation for POSPal
 * Integrates with new /api/validate-license endpoint with fallback mechanisms
 */

class POSPalLicenseValidator {
    constructor() {
        this.validationCache = new Map();
        this.cacheTimeout = 60000; // 1 minute cache
        this.retryAttempts = 3;
        this.retryDelay = 1000; // Start with 1 second
        this.offlineMode = false;
        
        // Bind methods
        this.validateLicense = this.validateLicense.bind(this);
        this.checkLicenseStatus = this.checkLicenseStatus.bind(this);
        this.enableOfflineMode = this.enableOfflineMode.bind(this);
    }

    /**
     * Main license validation method with enhanced error handling
     */
    async validateLicense(email, token, machineFingerprint, useCache = true) {
        // Check cache first
        const cacheKey = `${email}-${token}-${machineFingerprint}`;
        if (useCache && this.validationCache.has(cacheKey)) {
            const cached = this.validationCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.result;
            }
        }

        // Try validation with retry logic
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                const result = await this.performValidation(email, token, machineFingerprint);
                
                // Cache successful result
                this.validationCache.set(cacheKey, {
                    result,
                    timestamp: Date.now()
                });
                
                // Update UI with success
                this.updateLicenseStatus(result);
                return result;
                
            } catch (error) {
                console.warn(`License validation attempt ${attempt} failed:`, error);
                
                if (attempt === this.retryAttempts) {
                    // All attempts failed, try fallback
                    return await this.handleValidationFailure(email, token, error);
                }
                
                // Exponential backoff
                await this.delay(this.retryDelay * Math.pow(2, attempt - 1));
            }
        }
    }

    /**
     * Perform the actual API validation call
     */
    async performValidation(email, token, machineFingerprint) {
        const response = await fetch('/api/validate-license', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email,
                token,
                machineFingerprint
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const error = new Error(errorData.message || 'Validation failed');
            error.code = errorData.code;
            error.status = response.status;
            throw error;
        }

        return await response.json();
    }

    /**
     * Handle validation failure with fallback mechanisms
     */
    async handleValidationFailure(email, token, error) {
        console.error('All validation attempts failed:', error);

        // Try local/cached validation first
        const fallbackResult = this.performLocalValidation(email, token);
        if (fallbackResult.valid) {
            this.showFallbackNotice('Using cached license validation');
            return fallbackResult;
        }

        // Handle specific error codes
        if (error.code) {
            this.handleSpecificError(error);
        } else if (error.status >= 500) {
            // Server error - enable offline mode
            this.enableOfflineMode();
            return { 
                valid: true, 
                mode: 'offline',
                message: 'Operating in offline mode due to server issues'
            };
        } else {
            // Client error - show appropriate message
            this.showLicenseError(error.message || 'License validation failed');
        }

        return { valid: false, error: error.message };
    }

    /**
     * Perform local validation using stored credentials
     */
    performLocalValidation(email, token) {
        const storedEmail = localStorage.getItem('pospal_customer_email');
        const storedToken = localStorage.getItem('pospal_unlock_token');
        const storedStatus = localStorage.getItem('pospal_license_status');
        const lastValidated = localStorage.getItem('pospal_last_validated');

        // Check if stored credentials match and are recent
        if (storedEmail === email && 
            storedToken === token && 
            storedStatus === 'active' &&
            lastValidated && 
            Date.now() - parseInt(lastValidated) < 86400000) { // 24 hours
            
            return {
                valid: true,
                mode: 'local',
                customerName: localStorage.getItem('pospal_customer_name'),
                message: 'Using local validation'
            };
        }

        return { valid: false };
    }

    /**
     * Check license status periodically
     */
    async checkLicenseStatus() {
        if (this.offlineMode) return;

        const email = localStorage.getItem('pospal_customer_email');
        const token = localStorage.getItem('pospal_unlock_token');
        
        if (!email || !token) {
            this.showUnlicensedStatus();
            return;
        }

        try {
            const machineFingerprint = await this.generateMachineFingerprint();
            const result = await this.validateLicense(email, token, machineFingerprint);
            
            if (result.valid) {
                localStorage.setItem('pospal_last_validated', Date.now().toString());
            }
        } catch (error) {
            console.warn('Background license check failed:', error);
        }
    }

    /**
     * Handle specific error codes from backend
     */
    handleSpecificError(error) {
        switch (error.code) {
            case 'INVALID_LICENSE':
                this.showLicenseExpiredDialog();
                break;
            case 'HARDWARE_ID_ERROR':
                this.showHardwareIdMismatch();
                break;
            case 'RATE_LIMIT':
                this.showRateLimitMessage();
                break;
            case 'SUBSCRIPTION_REQUIRED':
                this.showSubscriptionRequired();
                break;
            default:
                this.showLicenseError(error.message);
        }
    }

    /**
     * Update license status in UI
     */
    updateLicenseStatus(result) {
        if (!result.valid) return;

        const statusElement = document.getElementById('license-status-display');
        const badgeElement = document.getElementById('license-status-badge');
        
        let statusHTML = '';
        let badgeText = '';
        let statusClass = '';

        if (result.mode === 'offline') {
            statusHTML = `
                <div class="offline-license-status">
                    <i class="fas fa-wifi-slash text-yellow-600"></i>
                    <span>License valid - Offline mode</span>
                </div>
            `;
            badgeText = 'Offline';
            statusClass = 'status-offline';
        } else if (result.mode === 'local') {
            statusHTML = `
                <div class="local-license-status">
                    <i class="fas fa-shield-alt text-blue-600"></i>
                    <span>License valid - Cached validation</span>
                </div>
            `;
            badgeText = 'Valid';
            statusClass = 'status-valid';
        } else {
            statusHTML = `
                <div class="active-license-status">
                    <i class="fas fa-check-circle text-green-600"></i>
                    <span>License active - ${result.customerName || 'Customer'}</span>
                </div>
            `;
            badgeText = 'Active';
            statusClass = 'status-active';
        }

        if (statusElement) statusElement.innerHTML = statusHTML;
        if (badgeElement) {
            badgeElement.textContent = badgeText;
            badgeElement.className = `license-badge ${statusClass}`;
        }
    }

    /**
     * Show fallback notice
     */
    showFallbackNotice(message) {
        const notice = document.createElement('div');
        notice.className = 'fallback-notice';
        notice.innerHTML = `
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <div class="flex items-center">
                    <i class="fas fa-exclamation-triangle text-yellow-600 mr-2"></i>
                    <span class="text-yellow-800">${message}</span>
                </div>
            </div>
        `;
        
        const container = document.querySelector('.main-content') || document.body;
        container.insertBefore(notice, container.firstChild);
        
        setTimeout(() => notice.remove(), 10000); // Remove after 10 seconds
    }

    /**
     * Enable offline mode
     */
    enableOfflineMode() {
        this.offlineMode = true;
        
        // Show offline indicator
        let offlineIndicator = document.getElementById('offline-indicator');
        if (!offlineIndicator) {
            offlineIndicator = document.createElement('div');
            offlineIndicator.id = 'offline-indicator';
            offlineIndicator.className = 'fixed top-4 right-4 bg-yellow-500 text-white px-3 py-2 rounded-lg shadow-lg z-50';
            offlineIndicator.innerHTML = `
                <i class="fas fa-wifi-slash mr-2"></i>
                <span>Offline Mode</span>
            `;
            document.body.appendChild(offlineIndicator);
        }
        
        console.log('POSPal is now running in offline mode');
    }

    /**
     * Show various license status dialogs
     */
    showLicenseExpiredDialog() {
        const modal = this.createStatusModal(
            'License Expired',
            'Your POSPal license has expired. Please renew to continue using all features.',
            [{
                text: 'Renew License',
                action: () => window.open('/buy-license.html', '_blank'),
                primary: true
            }, {
                text: 'Continue in Trial',
                action: () => this.enableOfflineMode()
            }]
        );
        modal.show();
    }

    showHardwareIdMismatch() {
        const modal = this.createStatusModal(
            'Hardware ID Mismatch',
            'Your license is registered to a different computer. Please contact support if you\'ve upgraded your hardware.',
            [{
                text: 'Contact Support',
                action: () => window.open('mailto:support@pospal.gr', '_blank'),
                primary: true
            }, {
                text: 'Continue Anyway',
                action: () => this.enableOfflineMode()
            }]
        );
        modal.show();
    }

    showRateLimitMessage() {
        this.showFallbackNotice('Too many validation requests. Please wait before trying again.');
    }

    showSubscriptionRequired() {
        const modal = this.createStatusModal(
            'Subscription Required',
            'This feature requires an active POSPal subscription.',
            [{
                text: 'Subscribe Now',
                action: () => window.open('/unlock-pospal.html', '_blank'),
                primary: true
            }]
        );
        modal.show();
    }

    showLicenseError(message) {
        this.showFallbackNotice(`License Error: ${message}`);
    }

    showUnlicensedStatus() {
        this.updateLicenseStatus({ 
            valid: false,
            message: 'No license found - Trial mode'
        });
    }

    /**
     * Create modal dialog
     */
    createStatusModal(title, message, buttons = []) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        const buttonsHTML = buttons.map(btn => 
            `<button class="px-4 py-2 rounded ${btn.primary ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-700'} hover:opacity-80"
                     onclick="this.closest('.fixed').remove(); (${btn.action.toString()})()">
                ${btn.text}
             </button>`
        ).join('');

        modal.innerHTML = `
            <div class="bg-white rounded-lg max-w-md mx-4 p-6">
                <h3 class="text-lg font-semibold mb-4">${title}</h3>
                <p class="text-gray-600 mb-6">${message}</p>
                <div class="flex space-x-3 justify-end">
                    ${buttonsHTML}
                </div>
            </div>
        `;

        return {
            element: modal,
            show: () => document.body.appendChild(modal),
            hide: () => modal.remove()
        };
    }

    /**
     * Generate machine fingerprint
     */
    async generateMachineFingerprint() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('POSPal fingerprint', 2, 2);
        
        const fingerprint = [
            navigator.userAgent,
            navigator.language,
            screen.width + 'x' + screen.height,
            new Date().getTimezoneOffset(),
            canvas.toDataURL()
        ].join('|');
        
        const encoder = new TextEncoder();
        const data = encoder.encode(fingerprint);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Start periodic license checking
     */
    startPeriodicCheck(intervalMinutes = 30) {
        // Initial check
        this.checkLicenseStatus();
        
        // Set up periodic checking
        setInterval(() => {
            this.checkLicenseStatus();
        }, intervalMinutes * 60 * 1000);
    }

    /**
     * Clean up validation cache
     */
    cleanupCache() {
        const now = Date.now();
        for (const [key, value] of this.validationCache.entries()) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.validationCache.delete(key);
            }
        }
    }
}

// Global license validator instance
window.pospalLicenseValidator = new POSPalLicenseValidator();

// Auto-start periodic checking when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.pospalLicenseValidator.startPeriodicCheck(30); // Check every 30 minutes
});