/**
 * Enhanced UX Manager for POSPal
 * Manages rate limiting feedback, fallback modes, and progressive enhancement
 */

class POSPalUXManager {
    constructor() {
        this.connectionStatus = 'online';
        this.rateLimitTimers = new Map();
        this.retryAttempts = new Map();
        this.maxRetryAttempts = 3;
        
        this.initializeConnectionMonitoring();
        this.initializeUXComponents();
    }

    /**
     * Initialize connection monitoring
     */
    initializeConnectionMonitoring() {
        // Monitor online/offline status
        window.addEventListener('online', () => {
            this.updateConnectionStatus('online');
            this.showConnectionRestored();
        });

        window.addEventListener('offline', () => {
            this.updateConnectionStatus('offline');
            this.showOfflineBanner();
        });

        // Test connection periodically
        setInterval(() => this.testConnection(), 30000); // Every 30 seconds
    }

    /**
     * Initialize UX components
     */
    initializeUXComponents() {
        // Legacy connection status indicator removed in favor of gear-based status
        // this.createConnectionStatusIndicator();
        
        // Create notification container
        this.createNotificationContainer();
        
        // Load enhanced CSS
        this.loadEnhancedCSS();
    }

    /**
     * Load enhanced CSS
     */
    loadEnhancedCSS() {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'enhanced-ux-components.css';
        document.head.appendChild(link);
    }

    /**
     * Create connection status indicator
     */
    createConnectionStatusIndicator() {
        // No-op: UI migrated to gear-based dot + micro-label
        return;
    }

    /**
     * Create notification container
     */
    createNotificationContainer() {
        const container = document.createElement('div');
        container.id = 'notification-container';
        container.style.position = 'fixed';
        container.style.top = '20px';
        container.style.right = '20px';
        container.style.zIndex = '1000';
        document.body.appendChild(container);
    }

    /**
     * Test connection to backend
     */
    async testConnection() {
        try {
            const response = await fetch('/api/health', { 
                method: 'HEAD',
                timeout: 5000 
            });
            
            if (response.ok) {
                this.updateConnectionStatus('online');
            } else {
                this.updateConnectionStatus('limited');
            }
        } catch (error) {
            this.updateConnectionStatus('offline');
        }
    }

    /**
     * Update connection status
     */
    updateConnectionStatus(status) {
        if (this.connectionStatus === status) return;
        
        this.connectionStatus = status;
        // UI handled elsewhere; emit event only
        
        // Emit custom event
        window.dispatchEvent(new CustomEvent('connectionStatusChanged', {
            detail: { status }
        }));
    }

    /**
     * Show rate limit notification
     */
    showRateLimitNotification(endpoint, retryAfter = 300) {
        const notification = document.createElement('div');
        notification.className = 'rate-limit-notice';
        notification.innerHTML = `
            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                <i class="fas fa-hourglass-half" style="margin-right: 12px; font-size: 18px;"></i>
                <div>
                    <div style="font-weight: 600;">Rate limit reached</div>
                    <div style="opacity: 0.9; font-size: 13px;">Too many requests to ${endpoint}</div>
                </div>
            </div>
            <div class="rate-limit-countdown">
                <i class="fas fa-clock"></i>
                <span>Please wait:</span>
                <span class="countdown-timer" id="countdown-${endpoint}">${this.formatTime(retryAfter)}</span>
            </div>
        `;

        // Add to notification container
        const container = document.getElementById('notification-container');
        container.appendChild(notification);

        // Start countdown
        this.startRateLimitCountdown(endpoint, retryAfter, notification);

        return notification;
    }

    /**
     * Start rate limit countdown
     */
    startRateLimitCountdown(endpoint, seconds, notification) {
        const countdownElement = document.getElementById(`countdown-${endpoint}`);
        let remaining = seconds;
        
        const interval = setInterval(() => {
            remaining--;
            
            if (countdownElement) {
                countdownElement.textContent = this.formatTime(remaining);
            }
            
            if (remaining <= 0) {
                clearInterval(interval);
                this.rateLimitTimers.delete(endpoint);
                
                // Remove notification
                if (notification && notification.parentNode) {
                    notification.style.animation = 'slideInRight 0.5s ease-out reverse';
                    setTimeout(() => notification.remove(), 500);
                }
                
                // Show retry available notification
                this.showNotification('Rate limit cleared - you can try again', 'info', 3000);
            }
        }, 1000);
        
        this.rateLimitTimers.set(endpoint, interval);
    }

    /**
     * Show offline banner
     */
    showOfflineBanner() {
        let banner = document.getElementById('offline-banner');
        
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'offline-banner';
            banner.className = 'offline-mode-banner';
            banner.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center;">
                    <i class="fas fa-wifi-slash" style="margin-right: 12px;"></i>
                    <span>You're offline - Some features may be limited</span>
                    <button class="reconnect-btn" onclick="window.pospalUXManager.testConnection()">
                        Try to reconnect
                    </button>
                </div>
            `;
            document.body.appendChild(banner);
        }
    }

    /**
     * Show connection restored notification
     */
    showConnectionRestored() {
        // Remove offline banner
        const banner = document.getElementById('offline-banner');
        if (banner) {
            banner.remove();
        }
        
        // Show success notification
        this.showNotification('Connection restored', 'success', 3000);
    }

    /**
     * Show fallback mode card
     */
    showFallbackMode(title, description, actions = []) {
        const card = document.createElement('div');
        card.className = 'fallback-mode-card';
        
        const actionsHTML = actions.map(action => 
            `<button class="${action.type || 'secondary'}" onclick="(${action.callback.toString()})()">
                ${action.text}
             </button>`
        ).join('');
        
        card.innerHTML = `
            <div class="card-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <div class="card-title">${title}</div>
            <div class="card-description">${description}</div>
            <div class="fallback-actions">
                ${actionsHTML}
                <button class="secondary" onclick="this.closest('.fallback-mode-card').remove()">
                    Dismiss
                </button>
            </div>
        `;
        
        // Insert at the beginning of main content
        const mainContent = document.querySelector('.main-content') || document.body;
        mainContent.insertBefore(card, mainContent.firstChild);
        
        return card;
    }

    /**
     * Show retry interface
     */
    showRetryInterface(operation, callback, maxAttempts = 3) {
        const currentAttempt = this.retryAttempts.get(operation) || 0;
        
        if (currentAttempt >= maxAttempts) {
            this.showFallbackMode(
                'Maximum retries exceeded',
                `We've tried ${maxAttempts} times but couldn't complete this operation. You can try again later or use offline mode.`,
                [
                    {
                        text: 'Try Again',
                        type: 'primary',
                        callback: () => {
                            this.retryAttempts.delete(operation);
                            callback();
                        }
                    },
                    {
                        text: 'Enable Offline Mode',
                        type: 'secondary',
                        callback: () => this.enableOfflineMode()
                    }
                ]
            );
            return;
        }

        const container = document.createElement('div');
        container.className = 'retry-container';
        container.innerHTML = `
            <div class="retry-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <div class="retry-title">Operation Failed</div>
            <div class="retry-message">
                Something went wrong. This was attempt ${currentAttempt + 1} of ${maxAttempts}.
            </div>
            <button class="retry-button" onclick="this.parentNode.remove(); window.pospalUXManager.executeRetry('${operation}', arguments[0])">
                <i class="fas fa-redo-alt"></i>
                <span>Try Again</span>
            </button>
        `;

        // Replace main content temporarily
        const mainContent = document.querySelector('.main-content') || document.body;
        mainContent.appendChild(container);
        
        // Store callback for retry
        this.retryCallbacks = this.retryCallbacks || {};
        this.retryCallbacks[operation] = callback;
    }

    /**
     * Execute retry
     */
    executeRetry(operation, callback) {
        const currentAttempt = this.retryAttempts.get(operation) || 0;
        this.retryAttempts.set(operation, currentAttempt + 1);
        
        const storedCallback = this.retryCallbacks?.[operation] || callback;
        if (storedCallback) {
            storedCallback();
        }
    }

    /**
     * Show progressive loading
     */
    showProgressiveLoader(text = 'Loading...') {
        const loader = document.createElement('div');
        loader.className = 'progressive-loader';
        loader.innerHTML = `
            <div class="loading-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
            <span>${text}</span>
        `;
        return loader;
    }

    /**
     * Show smart error message
     */
    showSmartError(type, title, message, actions = []) {
        const card = document.createElement('div');
        card.className = `smart-error-card ${type}`;
        
        const iconMap = {
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };
        
        const actionsHTML = actions.map(action => 
            `<button class="${action.type || 'secondary'}" onclick="(${action.callback.toString()})()">
                ${action.text}
             </button>`
        ).join('');
        
        card.innerHTML = `
            <div class="smart-error-header">
                <i class="${iconMap[type] || iconMap.error} error-icon"></i>
                <div class="error-title">${title}</div>
            </div>
            <div class="smart-error-body">${message}</div>
            ${actions.length > 0 ? `<div class="smart-error-actions">${actionsHTML}</div>` : ''}
        `;
        
        return card;
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.style.cssText = `
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            margin-bottom: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            animation: slideInRight 0.5s ease-out;
        `;
        notification.textContent = message;
        
        const container = document.getElementById('notification-container');
        container.appendChild(notification);
        
        // Auto remove
        setTimeout(() => {
            notification.style.animation = 'slideInRight 0.5s ease-out reverse';
            setTimeout(() => notification.remove(), 500);
        }, duration);
    }

    /**
     * Enable offline mode
     */
    enableOfflineMode() {
        this.updateConnectionStatus('offline');
        this.showOfflineBanner();
        
        // Emit offline mode event
        window.dispatchEvent(new CustomEvent('offlineModeEnabled'));
        
        this.showNotification('Offline mode enabled - Limited functionality', 'warning', 5000);
    }

    /**
     * Handle API errors with UX improvements
     */
    handleApiError(error, context = {}) {
        console.error('API Error:', error);
        
        if (error.code) {
            switch (error.code) {
                case 'RATE_LIMIT':
                    this.showRateLimitNotification(
                        context.endpoint || 'API',
                        error.retryAfter || 300
                    );
                    break;
                    
                case 'SERVER_ERROR':
                    this.showRetryInterface(
                        context.operation || 'api-call',
                        context.retryCallback
                    );
                    break;
                    
                case 'NETWORK_ERROR':
                    this.showFallbackMode(
                        'Network Connection Issue',
                        'We\'re having trouble connecting to our servers. You can continue in offline mode or try again.',
                        [
                            {
                                text: 'Try Again',
                                type: 'primary',
                                callback: context.retryCallback
                            },
                            {
                                text: 'Go Offline',
                                type: 'secondary',
                                callback: () => this.enableOfflineMode()
                            }
                        ]
                    );
                    break;
                    
                default:
                    this.showSmartError(
                        'error',
                        'Operation Failed',
                        error.message || 'An unexpected error occurred',
                        context.retryCallback ? [{
                            text: 'Try Again',
                            type: 'primary',
                            callback: context.retryCallback
                        }] : []
                    );
            }
        } else {
            // Generic error handling
            this.showSmartError(
                'error',
                'Something went wrong',
                error.message || 'Please try again or contact support',
                context.retryCallback ? [{
                    text: 'Retry',
                    type: 'primary',
                    callback: context.retryCallback
                }] : []
            );
        }
    }

    /**
     * Format time in MM:SS
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Clean up resources
     */
    cleanup() {
        // Clear all timers
        this.rateLimitTimers.forEach(timer => clearInterval(timer));
        this.rateLimitTimers.clear();
        
        // Clear retry attempts
        this.retryAttempts.clear();
        
        // Remove event listeners
        window.removeEventListener('online', this.handleOnline);
        window.removeEventListener('offline', this.handleOffline);
    }
}

// Global UX manager instance
window.pospalUXManager = new POSPalUXManager();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = POSPalUXManager;
}
