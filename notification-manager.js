// POSPal Unified Notification Manager
// Consolidates toast, banner, and persistent notification systems

const BYTE_TO_HEX = Array.from({ length: 256 }, (_, index) =>
    (index + 0x100).toString(16).slice(1)
);

class NotificationManager {
    constructor() {
        this.activeNotifications = new Map();
        this.queue = [];
        this.zIndexBase = {
            toast: 1800,
            banner: 1700,
            persistent: 1600,
            critical: 1900
        };
        this.initialized = false;
        this.init();
    }

    init() {
        if (this.initialized) return;

        // Create notification container for better organization
        if (!document.getElementById('pospal-notification-container')) {
            const container = document.createElement('div');
            container.id = 'pospal-notification-container';
            container.className = 'fixed inset-0 pointer-events-none z-[1500]';
            document.body.appendChild(container);
        }

        // Add CSS styles for unified notifications
        this.addGlobalStyles();
        this.initialized = true;
    }

    addGlobalStyles() {
        const styleId = 'pospal-notification-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* Unified notification styles */
            .pospal-notification {
                pointer-events: auto;
                transition: all 0.3s ease-out;
                border-radius: 0.5rem;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            }

            .pospal-notification-enter {
                opacity: 0;
                transform: translateY(-10px) scale(0.95);
            }

            .pospal-notification-exit {
                opacity: 0;
                transform: translateY(-10px) scale(0.95);
                pointer-events: none;
            }

            /* Touch optimization */
            .pospal-touch-target {
                min-width: 44px;
                min-height: 44px;
                touch-action: manipulation;
                -webkit-tap-highlight-color: transparent;
            }

            /* Mobile responsive */
            @media (max-width: 768px) {
                .pospal-notification-banner {
                    left: 1rem !important;
                    right: 1rem !important;
                    transform: none !important;
                    max-width: none !important;
                    font-size: 16px !important; /* Prevent zoom on iOS */
                }

                .pospal-notification-toast {
                    left: 1rem !important;
                    right: 1rem !important;
                    max-width: none !important;
                    font-size: 16px !important;
                }

                .pospal-notification-persistent {
                    position: fixed !important;
                    bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem) !important;
                    left: 1rem !important;
                    right: 1rem !important;
                }

                /* Enhanced touch targets for mobile */
                .pospal-notification button {
                    min-height: 48px !important;
                    min-width: 48px !important;
                    padding: 12px 16px !important;
                    font-size: 16px !important;
                }

                /* Swipe gesture indicator */
                .pospal-notification-swipeable::before {
                    content: '';
                    position: absolute;
                    top: 8px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 40px;
                    height: 4px;
                    background-color: rgba(0, 0, 0, 0.2);
                    border-radius: 2px;
                }
            }

            /* High contrast mode support */
            @media (prefers-contrast: high) {
                .pospal-notification {
                    border: 2px solid !important;
                    font-weight: 600 !important;
                }
            }

            /* Reduced motion support */
            @media (prefers-reduced-motion: reduce) {
                .pospal-notification {
                    transition: none !important;
                }

                .pospal-notification-enter,
                .pospal-notification-exit {
                    opacity: 1 !important;
                    transform: none !important;
                }
            }

            /* Dark mode support */
            @media (prefers-color-scheme: dark) {
                .pospal-notification {
                    background: rgb(31, 41, 55) !important;
                    color: rgb(249, 250, 251) !important;
                    border-color: rgb(55, 65, 81) !important;
                }

                .pospal-notification button {
                    background: rgb(55, 65, 81) !important;
                    color: rgb(249, 250, 251) !important;
                    border-color: rgb(75, 85, 99) !important;
                }
            }

            /* Safe area support */
            @supports (padding: env(safe-area-inset-bottom)) {
                .pospal-notification-mobile {
                    padding-left: env(safe-area-inset-left);
                    padding-right: env(safe-area-inset-right);
                    padding-bottom: env(safe-area-inset-bottom);
                }
            }

            /* Focus management for accessibility */
            .pospal-notification:focus-within {
                outline: 2px solid #3b82f6;
                outline-offset: 2px;
            }

            .pospal-notification button:focus {
                outline: 2px solid #3b82f6;
                outline-offset: 2px;
                z-index: 1;
            }
        `;
        document.head.appendChild(style);
    }

    show(config) {
        const notification = this.createNotification(config);

        // Queue management for overlapping notifications
        if (config.priority === 'critical' || this.activeNotifications.size === 0) {
            this.displayNotification(notification);
        } else {
            this.queue.push(notification);
            this.processQueue();
        }

        return notification.id;
    }

    getCrypto() {
        if (typeof globalThis !== 'undefined' && globalThis.crypto) {
            return globalThis.crypto;
        }
        if (typeof window !== 'undefined' && window.crypto) {
            return window.crypto;
        }
        return null;
    }

    generateNotificationId() {
        const cryptoObj = this.getCrypto();
        if (cryptoObj) {
            if (typeof cryptoObj.randomUUID === 'function') {
                return cryptoObj.randomUUID();
            }
            if (typeof cryptoObj.getRandomValues === 'function') {
                const buffer = new Uint8Array(16);
                cryptoObj.getRandomValues(buffer);
                buffer[6] = (buffer[6] & 0x0f) | 0x40; // version 4
                buffer[8] = (buffer[8] & 0x3f) | 0x80; // variant 1
                const hex = Array.from(buffer, byte => BYTE_TO_HEX[byte]).join('');
                return (
                    hex.slice(0, 8) + '-' +
                    hex.slice(8, 12) + '-' +
                    hex.slice(12, 16) + '-' +
                    hex.slice(16, 20) + '-' +
                    hex.slice(20)
                );
            }
        }
        const entropy = Math.random().toString(36).slice(2, 10);
        return `pospal-notification-${Date.now().toString(36)}-${entropy}`;
    }

    createNotification(config) {
        const id = this.generateNotificationId();
        const isMobile = window.innerWidth <= 768;
        const baseClassName = this.getClassName(config.type, config.priority, isMobile);
        const additionalClassName = (config.className || '').toString().trim();
        const combinedClassName = additionalClassName
            ? `${baseClassName} ${additionalClassName}`
            : baseClassName;

        return {
            id,
            type: config.type || 'toast', // 'toast', 'banner', 'persistent'
            priority: config.priority || 'normal', // 'low', 'normal', 'high', 'critical'
            title: config.title || '',
            message: config.message || '',
            icon: config.icon || null,
            actions: config.actions || [],
            dismissible: config.dismissible !== false,
            autoHide: config.autoHide !== false,
            duration: config.duration || this.getDefaultDuration(config.type),
            position: this.getOptimalPosition(config.position, config.type, isMobile),
            className: combinedClassName,
            zIndex: this.getZIndex(config.type, config.priority),
            updateInterval: config.updateInterval || null,
            onUpdate: config.onUpdate || null,
            element: null,
            timers: new Set()
        };
    }

    getDefaultDuration(type) {
        const durations = {
            toast: 5000,
            banner: 0, // No auto-hide for banners
            persistent: 0, // No auto-hide for persistent
            critical: 0 // No auto-hide for critical
        };
        return durations[type] || 5000;
    }

    getOptimalPosition(requestedPosition, type, isMobile) {
        if (isMobile) {
            return type === 'banner' ? 'top-center-mobile' : 'bottom-mobile';
        }

        const defaultPositions = {
            toast: 'top-right',
            banner: 'top-center',
            persistent: 'top-right',
            critical: 'center'
        };

        return requestedPosition || defaultPositions[type] || 'top-right';
    }

    getClassName(type, priority, isMobile) {
        const baseClass = 'pospal-notification fixed';
        const typeClass = `pospal-notification-${type}`;
        const priorityClass = priority === 'critical' ? 'pospal-notification-critical' : '';
        const mobileClass = isMobile ? 'pospal-notification-mobile' : '';

        return `${baseClass} ${typeClass} ${priorityClass} ${mobileClass}`.trim();
    }

    getZIndex(type, priority) {
        const base = this.zIndexBase[type] || this.zIndexBase.toast;
        const modifier = priority === 'critical' ? 100 : 0;
        return base + modifier;
    }

    displayNotification(notification) {
        const element = this.createElement(notification);
        notification.element = element;

        // Add to active notifications
        this.activeNotifications.set(notification.id, notification);

        // Position the element
        this.positionElement(element, notification.position, notification.zIndex);

        // Append to container
        const container = document.getElementById('pospal-notification-container');
        container.appendChild(element);

        // Animate in
        setTimeout(() => {
            element.classList.remove('pospal-notification-enter');
        }, 10);

        // Auto-hide timer
        if (notification.autoHide && notification.duration > 0) {
            const hideTimer = setTimeout(() => {
                this.hide(notification.id);
            }, notification.duration);
            notification.timers.add(hideTimer);
        }

        // Update interval timer
        if (notification.updateInterval && notification.onUpdate) {
            const updateTimer = setInterval(() => {
                if (!this.activeNotifications.has(notification.id)) {
                    clearInterval(updateTimer);
                    return;
                }
                notification.onUpdate(notification, element);
            }, notification.updateInterval);
            notification.timers.add(updateTimer);
        }
    }

    createElement(notification) {
        const element = document.createElement('div');
        element.className = `${notification.className} pospal-notification-enter`;
        element.id = `notification-${notification.id}`;

        const content = this.generateContent(notification);
        element.innerHTML = content;

        // Add event listeners for actions
        this.attachEventListeners(element, notification);

        return element;
    }

    generateContent(notification) {
        const { type, title, message, icon, actions, dismissible } = notification;

        let iconHTML = '';
        if (icon) {
            iconHTML = `<div class="flex-shrink-0"><i class="fas ${icon} text-lg"></i></div>`;
        }

        let actionsHTML = '';
        if (actions.length > 0) {
            const actionButtons = actions.map(action =>
                `<button data-action="${action.id}" class="bg-white hover:bg-gray-50 text-gray-800 px-4 py-3 rounded border text-sm font-medium transition-colors min-h-[44px] touch-manipulation">
                    ${action.icon ? `<i class="fas ${action.icon} mr-2"></i>` : ''}${action.label}
                </button>`
            ).join('');
            actionsHTML = `<div class="flex flex-wrap gap-2 mt-3">${actionButtons}</div>`;
        }

        let dismissHTML = '';
        if (dismissible) {
            dismissHTML = `<button data-action="dismiss" class="flex-shrink-0 text-gray-400 hover:text-gray-600 p-3 min-w-[44px] min-h-[44px] touch-manipulation flex items-center justify-center pospal-touch-target">
                <i class="fas fa-times"></i>
            </button>`;
        }

        return `
            <div class="flex items-start space-x-3">
                ${iconHTML}
                <div class="flex-1 min-w-0">
                    ${title ? `<h3 class="font-bold text-lg mb-2">${title}</h3>` : ''}
                    ${message ? `<p class="text-sm mb-2">${message}</p>` : ''}
                    ${actionsHTML}
                </div>
                ${dismissHTML}
            </div>
        `;
    }

    positionElement(element, position, zIndex) {
        element.style.zIndex = zIndex;

        const positions = {
            'top-left': { top: '1rem', left: '1rem' },
            'top-center': { top: '1rem', left: '50%', transform: 'translateX(-50%)', maxWidth: '600px' },
            'top-right': { top: '1rem', right: '1rem', maxWidth: '400px' },
            'top-center-mobile': { top: '1rem', left: '1rem', right: '1rem' },
            'bottom-mobile': { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)', left: '1rem', right: '1rem' },
            'center': { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxWidth: '600px' }
        };

        const pos = positions[position] || positions['top-right'];
        Object.assign(element.style, pos);
    }

    attachEventListeners(element, notification) {
        // Touch and click handling with haptic feedback
        element.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]');
            if (!action) return;

            // Haptic feedback for mobile devices
            this.triggerHapticFeedback('light');

            const actionId = action.dataset.action;

            if (actionId === 'dismiss') {
                this.hide(notification.id);
                return;
            }

            // Find and execute custom action
            const actionConfig = notification.actions.find(a => a.id === actionId);
            if (actionConfig && actionConfig.handler) {
                actionConfig.handler(notification);
            }
        });

        // Enhanced keyboard support with ARIA
        element.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && notification.dismissible) {
                this.hide(notification.id);
                return;
            }

            // Arrow key navigation for action buttons
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                const buttons = element.querySelectorAll('button[data-action]');
                const currentIndex = Array.from(buttons).indexOf(document.activeElement);

                if (currentIndex >= 0) {
                    e.preventDefault();
                    const nextIndex = e.key === 'ArrowRight'
                        ? (currentIndex + 1) % buttons.length
                        : (currentIndex - 1 + buttons.length) % buttons.length;
                    buttons[nextIndex]?.focus();
                }
            }

            // Enter or Space to activate buttons
            if ((e.key === 'Enter' || e.key === ' ') && document.activeElement.matches('button[data-action]')) {
                e.preventDefault();
                document.activeElement.click();
            }
        });

        // Mobile swipe gesture support
        if (notification.dismissible && this.isMobileDevice()) {
            this.addSwipeGestureSupport(element, notification);
        }

        // Focus management for accessibility
        this.setupAccessibilityFeatures(element, notification);

        // Long press support for additional options
        this.addLongPressSupport(element, notification);
    }

    triggerHapticFeedback(intensity = 'light') {
        if ('vibrate' in navigator) {
            const patterns = {
                light: [10],
                medium: [20],
                heavy: [30, 10, 30]
            };
            navigator.vibrate(patterns[intensity] || patterns.light);
        }
    }

    isMobileDevice() {
        return window.innerWidth <= 768 || 'ontouchstart' in window;
    }

    addSwipeGestureSupport(element, notification) {
        let startX = 0;
        let startY = 0;
        let startTime = 0;
        const swipeThreshold = 100;
        const timeThreshold = 300;

        // Add swipe indicator class
        element.classList.add('pospal-notification-swipeable');

        element.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            startTime = Date.now();
        }, { passive: true });

        element.addEventListener('touchend', (e) => {
            if (!e.changedTouches[0]) return;

            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            const endTime = Date.now();

            const deltaX = endX - startX;
            const deltaY = endY - startY;
            const deltaTime = endTime - startTime;

            // Check for horizontal swipe
            if (Math.abs(deltaX) > swipeThreshold &&
                Math.abs(deltaY) < swipeThreshold / 2 &&
                deltaTime < timeThreshold) {

                // Swipe right to dismiss
                if (deltaX > 0) {
                    this.triggerHapticFeedback('medium');
                    element.style.transform = 'translateX(100%)';
                    setTimeout(() => this.hide(notification.id), 200);
                }
                // Swipe left for action menu (future feature)
                else if (deltaX < -swipeThreshold) {
                    this.triggerHapticFeedback('light');
                    // Could show action menu here
                }
            }
        }, { passive: true });
    }

    setupAccessibilityFeatures(element, notification) {
        // Set ARIA attributes
        element.setAttribute('role', 'alert');
        element.setAttribute('aria-live', notification.priority === 'critical' ? 'assertive' : 'polite');
        element.setAttribute('aria-atomic', 'true');

        if (notification.title) {
            element.setAttribute('aria-labelledby', `notification-title-${notification.id}`);
            const titleElement = element.querySelector('h3');
            if (titleElement) {
                titleElement.id = `notification-title-${notification.id}`;
            }
        }

        if (notification.message) {
            element.setAttribute('aria-describedby', `notification-message-${notification.id}`);
            const messageElement = element.querySelector('p');
            if (messageElement) {
                messageElement.id = `notification-message-${notification.id}`;
            }
        }

        // Focus management
        const firstButton = element.querySelector('button[data-action]');
        if (firstButton && notification.priority === 'critical') {
            setTimeout(() => firstButton.focus(), 100);
        }

        // Screen reader announcements
        if (notification.priority === 'critical') {
            this.announceToScreenReader(notification.title || notification.message || 'Critical notification');
        }
    }

    addLongPressSupport(element, notification) {
        let longPressTimer;
        const longPressDuration = 800;

        const startLongPress = (e) => {
            longPressTimer = setTimeout(() => {
                this.triggerHapticFeedback('heavy');
                this.showNotificationMenu(element, notification, e);
            }, longPressDuration);
        };

        const cancelLongPress = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        };

        element.addEventListener('mousedown', startLongPress);
        element.addEventListener('touchstart', startLongPress, { passive: true });
        element.addEventListener('mouseup', cancelLongPress);
        element.addEventListener('mouseleave', cancelLongPress);
        element.addEventListener('touchend', cancelLongPress);
        element.addEventListener('touchcancel', cancelLongPress);
    }

    showNotificationMenu(element, notification, event) {
        // Future feature: Show context menu with additional options
        console.log('Long press menu for notification:', notification.id);

        // For now, just show a toast with available actions
        const actions = notification.actions.map(a => a.label).join(', ');
        if (actions) {
            this.showToast(`Available actions: ${actions}`, 'info', 3000);
        }
    }

    announceToScreenReader(message) {
        const announcer = document.createElement('div');
        announcer.setAttribute('aria-live', 'assertive');
        announcer.setAttribute('aria-atomic', 'true');
        announcer.className = 'sr-only'; // Screen reader only class
        announcer.style.cssText = `
            position: absolute !important;
            width: 1px !important;
            height: 1px !important;
            padding: 0 !important;
            margin: -1px !important;
            overflow: hidden !important;
            clip: rect(0, 0, 0, 0) !important;
            border: 0 !important;
        `;

        document.body.appendChild(announcer);
        announcer.textContent = message;

        setTimeout(() => {
            if (announcer.parentNode) {
                announcer.parentNode.removeChild(announcer);
            }
        }, 1000);
    }

    hide(id) {
        const notification = this.activeNotifications.get(id);
        if (!notification) return;

        const element = notification.element;
        if (element) {
            // Clear all timers
            notification.timers.forEach(timer => {
                clearTimeout(timer);
                clearInterval(timer);
            });

            // Animate out
            element.classList.add('pospal-notification-exit');

            setTimeout(() => {
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            }, 300);
        }

        // Remove from active notifications
        this.activeNotifications.delete(id);

        // Process queue
        this.processQueue();
    }

    processQueue() {
        if (this.queue.length === 0) return;

        // Display next notification if we have capacity
        const maxConcurrent = 3;
        if (this.activeNotifications.size < maxConcurrent) {
            const nextNotification = this.queue.shift();
            this.displayNotification(nextNotification);
        }
    }

    clear(type = null) {
        const toRemove = [];

        this.activeNotifications.forEach((notification, id) => {
            if (!type || notification.type === type) {
                toRemove.push(id);
            }
        });

        toRemove.forEach(id => this.hide(id));

        // Clear queue if type specified
        if (type) {
            this.queue = this.queue.filter(n => n.type !== type);
        } else {
            this.queue = [];
        }
    }

    // Backward compatibility methods
    showToast(message, type = 'info', duration = 5000) {
        const typeMap = {
            success: { icon: 'fa-check-circle', color: 'bg-green-600' },
            warning: { icon: 'fa-exclamation-triangle', color: 'bg-yellow-500' },
            error: { icon: 'fa-times-circle', color: 'bg-red-600' },
            info: { icon: 'fa-info-circle', color: 'bg-blue-600' }
        };

        const config = typeMap[type] || typeMap.info;

        return this.show({
            type: 'toast',
            message,
            icon: config.icon,
            duration,
            className: `text-white px-4 py-2 rounded-md shadow-lg text-sm ${config.color}`
        });
    }

    showBanner(title, message, actions = [], priority = 'normal') {
        return this.show({
            type: 'banner',
            title,
            message,
            actions,
            priority,
            dismissible: true,
            autoHide: false
        });
    }

    showPersistent(message, updateCallback = null, updateInterval = null) {
        return this.show({
            type: 'persistent',
            message,
            onUpdate: updateCallback,
            updateInterval,
            dismissible: true,
            autoHide: false
        });
    }
}

// Create global instance
window.NotificationManager = new NotificationManager();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotificationManager;
}
