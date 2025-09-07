/**
 * Enhanced Error Handler for POSPal Frontend
 * Handles structured error codes from enhanced backend
 */

class POSPalErrorHandler {
    constructor() {
        this.errorMessages = {
            'SUBSCRIPTION_REQUIRED': {
                title: 'Subscription Required',
                message: 'Your POSPal subscription is required to access this feature.',
                action: 'upgrade',
                actionText: 'Upgrade Now'
            },
            'INVALID_EMAIL': {
                title: 'Invalid Email',
                message: 'Please enter a valid email address.',
                action: 'highlight-field',
                fieldId: 'email'
            },
            'RATE_LIMIT': {
                title: 'Too Many Requests',
                message: 'Please wait before trying again.',
                action: 'show-countdown',
                retryAfter: 300 // 5 minutes default
            },
            'HARDWARE_ID_ERROR': {
                title: 'Hardware ID Issue',
                message: 'There\'s an issue with your hardware ID. Please check the troubleshooting guide.',
                action: 'show-troubleshooting'
            },
            'INVALID_LICENSE': {
                title: 'Invalid License',
                message: 'Your license is invalid or expired.',
                action: 'show-renewal'
            },
            'SERVER_ERROR': {
                title: 'Server Error',
                message: 'We\'re experiencing technical difficulties. Please try again later.',
                action: 'show-fallback'
            }
        };
        
        this.createErrorModal();
    }

    createErrorModal() {
        // Create error modal if it doesn't exist
        if (!document.getElementById('pospal-error-modal')) {
            const modal = document.createElement('div');
            modal.id = 'pospal-error-modal';
            modal.innerHTML = `
                <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden">
                    <div class="bg-white rounded-lg max-w-md mx-4 p-6">
                        <div class="flex items-center mb-4">
                            <div class="flex-shrink-0">
                                <div class="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                                    <i class="fas fa-exclamation-triangle text-red-600"></i>
                                </div>
                            </div>
                            <div class="ml-4">
                                <h3 class="text-lg font-semibold text-gray-900" id="error-title"></h3>
                            </div>
                        </div>
                        <div class="mb-6">
                            <p class="text-gray-600" id="error-message"></p>
                            <div id="error-countdown" class="hidden mt-4">
                                <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                    <p class="text-yellow-800 text-sm">
                                        <i class="fas fa-clock mr-2"></i>
                                        Please wait <span id="countdown-timer">5:00</span> before trying again.
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div class="flex justify-end space-x-3">
                            <button id="error-cancel" class="px-4 py-2 text-gray-600 hover:text-gray-800">
                                Cancel
                            </button>
                            <button id="error-action" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 hidden">
                                Action
                            </button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
    }

    async handleApiResponse(response, originalRequest) {
        if (response.ok) {
            return await response.json();
        }

        let errorData;
        try {
            errorData = await response.json();
        } catch {
            errorData = { 
                code: 'SERVER_ERROR', 
                message: 'Network error occurred' 
            };
        }

        return this.handleError(errorData, originalRequest);
    }

    handleError(errorData, originalRequest = null) {
        const errorCode = errorData.code || 'SERVER_ERROR';
        const errorConfig = this.errorMessages[errorCode];
        
        if (!errorConfig) {
            this.showGenericError(errorData.message || 'An unknown error occurred');
            return;
        }

        switch (errorConfig.action) {
            case 'upgrade':
                this.showUpgradePrompt();
                break;
            case 'highlight-field':
                this.highlightField(errorConfig.fieldId);
                break;
            case 'show-countdown':
                this.showRateLimitError(errorData.retryAfter || 300);
                break;
            case 'show-troubleshooting':
                this.showTroubleshootingGuide();
                break;
            case 'show-renewal':
                this.showLicenseRenewal();
                break;
            case 'show-fallback':
                this.showFallbackOptions(originalRequest);
                break;
            default:
                this.showErrorModal(errorConfig.title, errorConfig.message);
        }
    }

    showErrorModal(title, message, actionText = null, actionCallback = null) {
        const modal = document.getElementById('pospal-error-modal');
        const titleEl = document.getElementById('error-title');
        const messageEl = document.getElementById('error-message');
        const actionBtn = document.getElementById('error-action');
        const cancelBtn = document.getElementById('error-cancel');

        titleEl.textContent = title;
        messageEl.textContent = message;

        if (actionText && actionCallback) {
            actionBtn.textContent = actionText;
            actionBtn.classList.remove('hidden');
            actionBtn.onclick = actionCallback;
        } else {
            actionBtn.classList.add('hidden');
        }

        cancelBtn.onclick = () => this.hideErrorModal();
        modal.querySelector('.fixed').classList.remove('hidden');
    }

    hideErrorModal() {
        const modal = document.getElementById('pospal-error-modal');
        modal.querySelector('.fixed').classList.add('hidden');
        this.clearCountdown();
    }

    showRateLimitError(retryAfterSeconds) {
        this.showErrorModal('Rate Limit Exceeded', 'Too many requests. Please wait before trying again.');
        
        const countdownEl = document.getElementById('error-countdown');
        const timerEl = document.getElementById('countdown-timer');
        
        countdownEl.classList.remove('hidden');
        
        let remaining = retryAfterSeconds;
        this.countdownInterval = setInterval(() => {
            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;
            timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            if (remaining <= 0) {
                this.clearCountdown();
                this.hideErrorModal();
            }
            remaining--;
        }, 1000);
    }

    clearCountdown() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        const countdownEl = document.getElementById('error-countdown');
        if (countdownEl) countdownEl.classList.add('hidden');
    }

    highlightField(fieldId) {
        const field = document.getElementById(fieldId);
        if (field) {
            field.classList.add('border-red-500', 'ring-red-500');
            field.focus();
            setTimeout(() => {
                field.classList.remove('border-red-500', 'ring-red-500');
            }, 3000);
        }
        this.showErrorModal('Invalid Input', 'Please check the highlighted field and try again.');
    }

    showUpgradePrompt() {
        this.showErrorModal(
            'Upgrade Required', 
            'This feature requires a POSPal Pro subscription.',
            'Upgrade Now',
            () => window.location.href = '/unlock-pospal.html'
        );
    }

    showTroubleshootingGuide() {
        this.showErrorModal(
            'Hardware ID Issue',
            'Please visit the Management → License section in POSPal to copy the correct Hardware ID.',
            'Open POSPal',
            () => alert('Please open POSPal desktop app and go to Management → License')
        );
    }

    showLicenseRenewal() {
        this.showErrorModal(
            'License Issue',
            'Your license needs to be renewed or is invalid.',
            'Renew License',
            () => window.location.href = '/buy-license.html'
        );
    }

    showFallbackOptions(originalRequest) {
        this.showErrorModal(
            'Connection Issue',
            'We\'re experiencing connectivity issues. You can continue in offline mode.',
            'Continue Offline',
            () => {
                this.hideErrorModal();
                this.enableOfflineMode();
            }
        );
    }

    showGenericError(message) {
        this.showErrorModal('Error', message);
    }

    enableOfflineMode() {
        // Show offline indicator
        const offlineIndicator = document.createElement('div');
        offlineIndicator.id = 'offline-indicator';
        offlineIndicator.className = 'fixed top-4 right-4 bg-yellow-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
        offlineIndicator.innerHTML = '<i class="fas fa-wifi-slash mr-2"></i>Offline Mode';
        document.body.appendChild(offlineIndicator);
    }

    // Utility method for making API calls with enhanced error handling
    async apiCall(url, options = {}) {
        const loadingIndicator = this.showLoadingIndicator();
        
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            
            return await this.handleApiResponse(response, { url, options });
        } catch (error) {
            this.handleError({ 
                code: 'SERVER_ERROR', 
                message: error.message 
            });
            throw error;
        } finally {
            this.hideLoadingIndicator(loadingIndicator);
        }
    }

    showLoadingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-40';
        indicator.innerHTML = `
            <div class="bg-white rounded-lg p-6 flex items-center space-x-3">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span class="text-gray-700">Processing...</span>
            </div>
        `;
        document.body.appendChild(indicator);
        return indicator;
    }

    hideLoadingIndicator(indicator) {
        if (indicator && indicator.parentNode) {
            indicator.parentNode.removeChild(indicator);
        }
    }
}

// Global error handler instance
window.pospalErrorHandler = new POSPalErrorHandler();

// Enhanced fetch wrapper
window.pospalFetch = (url, options) => window.pospalErrorHandler.apiCall(url, options);