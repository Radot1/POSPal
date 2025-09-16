# POSPal Unified Cloud Integration - Integration Guide
## Phase 2C: Master Controller Integration

### OVERVIEW

This guide provides detailed instructions for integrating POSPal's unified cloud validation service with the local master controller, ensuring seamless communication, optimal caching, and robust error handling.

## UNIFIED ENDPOINT INTEGRATION

### 1. Primary Endpoint

**URL:** `https://license.pospal.gr/validate-unified`
**Method:** `POST`
**Content-Type:** `application/json`

### 2. Request Examples

#### Standard License Validation
```javascript
const validateLicense = async (email, token, machineFingerprint, deviceInfo) => {
  const response = await fetch('https://license.pospal.gr/validate-unified', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Version': '1.2.1',
      'X-Client-OS': 'Windows'
    },
    body: JSON.stringify({
      operation: 'validate',
      credentials: {
        email,
        token
      },
      device: {
        machineFingerprint,
        deviceInfo: {
          hostname: deviceInfo.hostname,
          os: deviceInfo.os,
          version: deviceInfo.version
        }
      },
      options: {
        includeSubscriptionDetails: true,
        cachePreference: 'moderate',
        performanceMode: 'standard'
      }
    })
  });
  
  return await response.json();
};
```

#### Instant Validation (Post-Payment)
```javascript
const instantValidate = async (email, stripeSessionId, machineFingerprint, deviceInfo) => {
  const response = await fetch('https://license.pospal.gr/validate-unified', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Version': '1.2.1'
    },
    body: JSON.stringify({
      operation: 'instant',
      credentials: {
        email,
        stripeSessionId
      },
      device: {
        machineFingerprint,
        deviceInfo
      }
    })
  });
  
  return await response.json();
};
```

#### Session Management
```javascript
const startSession = async (email, token, sessionId, machineFingerprint, deviceInfo) => {
  const response = await fetch('https://license.pospal.gr/validate-unified', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'session',
      action: 'start',
      credentials: {
        email,
        token,
        sessionId
      },
      device: {
        machineFingerprint,
        deviceInfo
      }
    })
  });
  
  return await response.json();
};

const heartbeat = async (sessionId) => {
  const response = await fetch('https://license.pospal.gr/validate-unified', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'session',
      action: 'heartbeat',
      credentials: { sessionId }
    })
  });
  
  return await response.json();
};
```

## MASTER CONTROLLER INTEGRATION

### 1. Validation Service Class

```javascript
class UnifiedValidationService {
  constructor(options = {}) {
    this.endpoint = options.endpoint || 'https://license.pospal.gr/validate-unified';
    this.timeout = options.timeout || 5000;
    this.retryAttempts = options.retryAttempts || 3;
    this.cacheManager = new ValidationCacheManager();
    this.circuitBreaker = new ValidationCircuitBreaker();
  }
  
  async validate(credentials, deviceInfo, options = {}) {
    const startTime = Date.now();
    
    try {
      // Check local cache first
      if (options.allowCache !== false) {
        const cachedResult = await this.cacheManager.get(credentials.email);
        if (cachedResult && this.isCacheValid(cachedResult)) {
          console.log('Using cached validation result');
          return this.enrichCachedResult(cachedResult);
        }
      }
      
      // Perform cloud validation with circuit breaker
      const result = await this.circuitBreaker.execute(async () => {
        return await this.performCloudValidation(credentials, deviceInfo, options);
      });
      
      // Cache successful results
      if (result.success && result.validation.valid) {
        await this.cacheManager.set(
          credentials.email, 
          result, 
          result.caching?.duration || 300
        );
      }
      
      return this.processValidationResult(result, startTime);
      
    } catch (error) {
      console.error('Validation service error:', error);
      
      // Fallback to last known good state
      const fallbackResult = await this.cacheManager.getFallback(credentials.email);
      if (fallbackResult) {
        console.warn('Using fallback validation result');
        return this.createFallbackResponse(fallbackResult, error);
      }
      
      throw error;
    }
  }
  
  async performCloudValidation(credentials, deviceInfo, options) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Version': process.env.APP_VERSION || '1.2.1',
          'X-Client-OS': process.platform,
          'X-Request-ID': this.generateRequestId()
        },
        body: JSON.stringify({
          operation: 'validate',
          credentials,
          device: {
            machineFingerprint: deviceInfo.machineFingerprint,
            deviceInfo: {
              hostname: deviceInfo.hostname,
              os: process.platform,
              version: process.env.APP_VERSION
            }
          },
          options: {
            includeSubscriptionDetails: true,
            cachePreference: options.cachePreference || 'moderate',
            performanceMode: 'standard'
          }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
      
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
  
  processValidationResult(result, startTime) {
    const processedResult = {
      ...result,
      localMetadata: {
        processedAt: new Date().toISOString(),
        totalTime: Date.now() - startTime,
        source: 'cloud'
      }
    };
    
    // Apply local business rules if needed
    if (result.caching?.recommendation) {
      processedResult.localCacheStrategy = this.adaptCacheStrategy(result.caching);
    }
    
    return processedResult;
  }
  
  isCacheValid(cachedResult) {
    if (!cachedResult.cacheUntil) return false;
    return new Date(cachedResult.cacheUntil) > new Date();
  }
  
  adaptCacheStrategy(cloudCacheStrategy) {
    const strategies = {
      'aggressive': { localDuration: 3600, checkInterval: 2880 },
      'moderate': { localDuration: 1800, checkInterval: 1440 },
      'conservative': { localDuration: 900, checkInterval: 720 },
      'minimal': { localDuration: 300, checkInterval: 240 }
    };
    
    return strategies[cloudCacheStrategy.strategy] || strategies.moderate;
  }
  
  generateRequestId() {
    return 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
  }
}
```

### 2. Cache Management

```javascript
class ValidationCacheManager {
  constructor(options = {}) {
    this.storage = options.storage || new Map();
    this.maxSize = options.maxSize || 1000;
    this.fallbackTTL = options.fallbackTTL || 86400; // 24 hours
  }
  
  async set(key, value, ttl = 300) {
    const cacheEntry = {
      value,
      timestamp: Date.now(),
      ttl: ttl * 1000,
      expiresAt: Date.now() + (ttl * 1000)
    };
    
    // Store in memory cache
    this.storage.set(key, cacheEntry);
    
    // Also persist to disk for fallback scenarios
    await this.persistFallbackCache(key, value);
    
    // Cleanup old entries if needed
    this.cleanupIfNeeded();
  }
  
  async get(key) {
    const entry = this.storage.get(key);
    
    if (!entry) return null;
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.storage.delete(key);
      return null;
    }
    
    return entry.value;
  }
  
  async getFallback(key) {
    try {
      // Load from persistent storage
      const fallbackPath = path.join(process.cwd(), 'data', 'validation_fallback.json');
      if (!fs.existsSync(fallbackPath)) return null;
      
      const fallbackData = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
      const entry = fallbackData[key];
      
      if (!entry) return null;
      
      // Check if fallback is too old (24 hours)
      if (Date.now() - entry.timestamp > this.fallbackTTL * 1000) {
        return null;
      }
      
      return entry.value;
      
    } catch (error) {
      console.error('Error loading fallback cache:', error);
      return null;
    }
  }
  
  async persistFallbackCache(key, value) {
    try {
      const fallbackPath = path.join(process.cwd(), 'data', 'validation_fallback.json');
      
      // Ensure directory exists
      fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
      
      // Load existing fallback data
      let fallbackData = {};
      if (fs.existsSync(fallbackPath)) {
        fallbackData = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
      }
      
      // Update with new entry
      fallbackData[key] = {
        value,
        timestamp: Date.now()
      };
      
      // Write back to disk
      fs.writeFileSync(fallbackPath, JSON.stringify(fallbackData, null, 2));
      
    } catch (error) {
      console.error('Error persisting fallback cache:', error);
    }
  }
  
  cleanupIfNeeded() {
    if (this.storage.size <= this.maxSize) return;
    
    // Remove oldest entries
    const entries = Array.from(this.storage.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toRemove = entries.slice(0, Math.floor(this.maxSize * 0.2));
    toRemove.forEach(([key]) => this.storage.delete(key));
  }
}
```

### 3. Circuit Breaker Implementation

```javascript
class ValidationCircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.timeout = options.timeout || 30000;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
  }
  
  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
    console.log('Circuit breaker: Service recovered, state is CLOSED');
  }
  
  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
      console.warn(`Circuit breaker: OPENED after ${this.failureCount} failures. Next attempt at ${new Date(this.nextAttempt)}`);
    }
  }
  
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt
    };
  }
}
```

## ERROR HANDLING & RECOVERY

### 1. Error Response Processing

```javascript
class ValidationErrorHandler {
  static handle(error, context = {}) {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      context,
      originalError: error
    };
    
    // Network/timeout errors
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return {
        type: 'NETWORK_TIMEOUT',
        message: 'Validation service timeout',
        recoverable: true,
        retryAfter: 30,
        fallbackStrategy: 'USE_CACHE'
      };
    }
    
    // HTTP errors
    if (error.message.includes('HTTP')) {
      const status = parseInt(error.message.match(/HTTP (\d+)/)?.[1]);
      
      if (status >= 500) {
        return {
          type: 'SERVER_ERROR',
          message: 'Validation service unavailable',
          recoverable: true,
          retryAfter: 60,
          fallbackStrategy: 'USE_CACHE'
        };
      }
      
      if (status === 401 || status === 403) {
        return {
          type: 'AUTHENTICATION_ERROR',
          message: 'Invalid license credentials',
          recoverable: false,
          action: 'SHOW_ACTIVATION_DIALOG'
        };
      }
    }
    
    // Circuit breaker errors
    if (error.message.includes('Circuit breaker')) {
      return {
        type: 'CIRCUIT_BREAKER_OPEN',
        message: 'Service temporarily unavailable',
        recoverable: true,
        retryAfter: 120,
        fallbackStrategy: 'OFFLINE_MODE'
      };
    }
    
    // Generic errors
    return {
      type: 'UNKNOWN_ERROR',
      message: error.message,
      recoverable: false,
      action: 'LOG_AND_CONTINUE'
    };
  }
}
```

### 2. Graceful Degradation

```javascript
class GracefulDegradationManager {
  constructor(validationService) {
    this.validationService = validationService;
    this.offlineMode = false;
    this.lastKnownGoodState = null;
  }
  
  async attemptValidation(credentials, deviceInfo) {
    try {
      const result = await this.validationService.validate(credentials, deviceInfo);
      
      // Store last known good state
      if (result.success && result.validation.valid) {
        this.lastKnownGoodState = {
          ...result,
          timestamp: Date.now()
        };
        this.offlineMode = false;
      }
      
      return result;
      
    } catch (error) {
      const errorInfo = ValidationErrorHandler.handle(error, { credentials, deviceInfo });
      
      console.warn('Validation failed:', errorInfo);
      
      // Handle different error types
      switch (errorInfo.type) {
        case 'NETWORK_TIMEOUT':
        case 'SERVER_ERROR':
        case 'CIRCUIT_BREAKER_OPEN':
          return this.handleServiceUnavailable(credentials, errorInfo);
          
        case 'AUTHENTICATION_ERROR':
          return this.handleAuthenticationError(errorInfo);
          
        default:
          return this.handleUnknownError(error, errorInfo);
      }
    }
  }
  
  handleServiceUnavailable(credentials, errorInfo) {
    console.log('Service unavailable, attempting graceful degradation');
    
    // Try to use last known good state if recent enough
    if (this.lastKnownGoodState && this.isStateRecentEnough(this.lastKnownGoodState)) {
      console.log('Using last known good state for validation');
      
      return {
        success: true,
        validation: {
          valid: true,
          status: 'active',
          validationType: 'fallback'
        },
        fallback: {
          active: true,
          reason: errorInfo.type,
          originalTimestamp: this.lastKnownGoodState.timestamp,
          gracePeriod: this.calculateGracePeriod()
        },
        offline: true
      };
    }
    
    // Fallback to offline mode with limited functionality
    this.offlineMode = true;
    return {
      success: false,
      validation: {
        valid: false,
        status: 'offline'
      },
      error: {
        code: errorInfo.type,
        message: errorInfo.message,
        retryAfter: errorInfo.retryAfter
      },
      offline: true,
      action: 'SHOW_OFFLINE_NOTIFICATION'
    };
  }
  
  handleAuthenticationError(errorInfo) {
    return {
      success: false,
      validation: {
        valid: false,
        status: 'invalid_credentials'
      },
      error: {
        code: errorInfo.type,
        message: errorInfo.message
      },
      action: 'SHOW_ACTIVATION_DIALOG'
    };
  }
  
  handleUnknownError(originalError, errorInfo) {
    console.error('Unknown validation error:', originalError);
    
    return {
      success: false,
      validation: {
        valid: false,
        status: 'error'
      },
      error: {
        code: errorInfo.type,
        message: 'Validation service error'
      },
      action: 'LOG_AND_SHOW_GENERIC_ERROR'
    };
  }
  
  isStateRecentEnough(state, maxAgeHours = 24) {
    const ageMs = Date.now() - state.timestamp;
    return ageMs < (maxAgeHours * 60 * 60 * 1000);
  }
  
  calculateGracePeriod() {
    // Grace period based on subscription tier and history
    return {
      remaining: 72, // hours
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
    };
  }
}
```

## INTEGRATION EXAMPLES

### 1. Basic Integration

```javascript
// Initialize the unified validation service
const validationService = new UnifiedValidationService({
  endpoint: 'https://license.pospal.gr/validate-unified',
  timeout: 5000,
  retryAttempts: 3
});

const gracefulDegradation = new GracefulDegradationManager(validationService);

// Validate license on app startup
async function validateLicenseOnStartup(credentials, deviceInfo) {
  console.log('Validating POSPal license...');
  
  try {
    const result = await gracefulDegradation.attemptValidation(credentials, deviceInfo);
    
    if (result.success && result.validation.valid) {
      console.log('License validation successful');
      
      // Store caching recommendations
      if (result.caching) {
        await setCacheStrategy(result.caching);
      }
      
      // Initialize session if needed
      if (result.session) {
        await initializeSession(result.session);
      }
      
      return { valid: true, result };
      
    } else {
      console.warn('License validation failed:', result.error);
      
      // Handle different failure scenarios
      switch (result.action) {
        case 'SHOW_ACTIVATION_DIALOG':
          showActivationDialog();
          break;
        case 'SHOW_OFFLINE_NOTIFICATION':
          showOfflineNotification(result.error.retryAfter);
          break;
        case 'LOG_AND_SHOW_GENERIC_ERROR':
          showGenericErrorDialog();
          break;
      }
      
      return { valid: false, result };
    }
    
  } catch (error) {
    console.error('Critical validation error:', error);
    showCriticalErrorDialog();
    return { valid: false, error };
  }
}

// Periodic validation with intelligent caching
async function performPeriodicValidation() {
  const lastCheck = await getLastValidationTime();
  const cacheStrategy = await getCurrentCacheStrategy();
  
  // Check if we need to validate based on cache strategy
  const needsValidation = shouldValidateNow(lastCheck, cacheStrategy);
  
  if (!needsValidation) {
    console.log('Using cached validation result');
    return { valid: true, cached: true };
  }
  
  // Perform validation
  const credentials = await getStoredCredentials();
  const deviceInfo = await getDeviceInfo();
  
  return await gracefulDegradation.attemptValidation(credentials, deviceInfo);
}
```

### 2. Session Management Integration

```javascript
class SessionManager {
  constructor(validationService) {
    this.validationService = validationService;
    this.currentSession = null;
    this.heartbeatInterval = null;
  }
  
  async startSession(credentials, deviceInfo) {
    const sessionId = this.generateSessionId();
    
    try {
      const result = await fetch('https://license.pospal.gr/validate-unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'session',
          action: 'start',
          credentials: { ...credentials, sessionId },
          device: {
            machineFingerprint: deviceInfo.machineFingerprint,
            deviceInfo
          }
        })
      });
      
      const response = await result.json();
      
      if (response.success && response.session.allowed) {
        this.currentSession = {
          id: sessionId,
          startTime: Date.now(),
          deviceInfo
        };
        
        // Start heartbeat
        this.startHeartbeat();
        
        return { success: true, session: this.currentSession };
        
      } else if (response.error && response.error.code === 'SESSION_CONFLICT') {
        // Handle session conflict
        return this.handleSessionConflict(response, credentials, deviceInfo);
      } else {
        throw new Error(`Session start failed: ${response.error.message}`);
      }
      
    } catch (error) {
      console.error('Session start error:', error);
      throw error;
    }
  }
  
  async handleSessionConflict(conflictResponse, credentials, deviceInfo) {
    console.warn('Session conflict detected:', conflictResponse.conflictInfo);
    
    // Show conflict dialog to user
    const userChoice = await showSessionConflictDialog(conflictResponse.conflictInfo);
    
    if (userChoice === 'takeover') {
      return await this.takeoverSession(credentials, deviceInfo);
    } else {
      throw new Error('Session conflict - user declined takeover');
    }
  }
  
  async takeoverSession(credentials, deviceInfo) {
    const sessionId = this.generateSessionId();
    
    const result = await fetch('https://license.pospal.gr/validate-unified', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'session',
        action: 'takeover',
        credentials: { ...credentials, sessionId },
        device: {
          machineFingerprint: deviceInfo.machineFingerprint,
          deviceInfo
        }
      })
    });
    
    const response = await result.json();
    
    if (response.success) {
      this.currentSession = {
        id: sessionId,
        startTime: Date.now(),
        deviceInfo,
        takeover: true
      };
      
      this.startHeartbeat();
      return { success: true, session: this.currentSession };
    } else {
      throw new Error(`Session takeover failed: ${response.error.message}`);
    }
  }
  
  startHeartbeat() {
    // Send heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.sendHeartbeat();
      } catch (error) {
        console.error('Heartbeat failed:', error);
        this.handleHeartbeatFailure(error);
      }
    }, 30000);
  }
  
  async sendHeartbeat() {
    if (!this.currentSession) return;
    
    const result = await fetch('https://license.pospal.gr/validate-unified', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'session',
        action: 'heartbeat',
        credentials: { sessionId: this.currentSession.id }
      })
    });
    
    const response = await result.json();
    
    if (!response.success) {
      throw new Error(`Heartbeat failed: ${response.error.message}`);
    }
  }
  
  async endSession() {
    if (!this.currentSession) return;
    
    try {
      await fetch('https://license.pospal.gr/validate-unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'session',
          action: 'end',
          credentials: { sessionId: this.currentSession.id }
        })
      });
    } catch (error) {
      console.error('Session end error:', error);
    } finally {
      this.cleanup();
    }
  }
  
  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.currentSession = null;
  }
  
  generateSessionId() {
    return 'session_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8);
  }
}
```

## TESTING & VALIDATION

### 1. Integration Testing

```javascript
// Test suite for unified validation service
describe('Unified Validation Service Integration', () => {
  let validationService;
  let mockCredentials;
  let mockDeviceInfo;
  
  beforeEach(() => {
    validationService = new UnifiedValidationService({
      endpoint: 'https://license.pospal.gr/validate-unified'
    });
    
    mockCredentials = {
      email: 'test@restaurant.com',
      token: 'POSPAL-TEST-XXXX-XXXX'
    };
    
    mockDeviceInfo = {
      machineFingerprint: 'test_fingerprint_123',
      hostname: 'POS-TERMINAL-01',
      os: 'Windows',
      version: '1.2.1'
    };
  });
  
  test('should validate active license successfully', async () => {
    const result = await validationService.validate(mockCredentials, mockDeviceInfo);
    
    expect(result.success).toBe(true);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.status).toBe('active');
    expect(result.caching.strategy).toBeTruthy();
    expect(result.performance.responseTime).toBeGreaterThan(0);
  });
  
  test('should handle inactive subscription', async () => {
    const inactiveCredentials = { ...mockCredentials, email: 'inactive@test.com' };
    const result = await validationService.validate(inactiveCredentials, mockDeviceInfo);
    
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('SUBSCRIPTION_INACTIVE');
    expect(result.supportActions).toBeTruthy();
  });
  
  test('should use cache when available', async () => {
    // First request
    const result1 = await validationService.validate(mockCredentials, mockDeviceInfo);
    expect(result1.performance.cached).toBe(false);
    
    // Second request should use cache
    const result2 = await validationService.validate(mockCredentials, mockDeviceInfo, {
      allowCache: true
    });
    expect(result2.localMetadata.source).toBe('cache');
  });
  
  test('should handle network failures gracefully', async () => {
    // Mock network failure
    const failingService = new UnifiedValidationService({
      endpoint: 'https://invalid-endpoint.invalid'
    });
    
    const gracefulManager = new GracefulDegradationManager(failingService);
    const result = await gracefulManager.attemptValidation(mockCredentials, mockDeviceInfo);
    
    expect(result.offline).toBe(true);
    expect(result.error.type).toBeTruthy();
  });
});
```

### 2. Performance Testing

```javascript
// Performance testing for validation service
class ValidationPerformanceTest {
  constructor(validationService) {
    this.service = validationService;
    this.metrics = [];
  }
  
  async runPerformanceTest(iterations = 100) {
    console.log(`Running performance test with ${iterations} iterations...`);
    
    const credentials = {
      email: 'perf-test@restaurant.com',
      token: 'POSPAL-PERF-TEST-XXXX'
    };
    
    const deviceInfo = {
      machineFingerprint: 'perf_test_fingerprint',
      hostname: 'PERF-TEST-TERMINAL',
      os: process.platform
    };
    
    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      
      try {
        const result = await this.service.validate(credentials, deviceInfo);
        const endTime = performance.now();
        
        this.metrics.push({
          iteration: i + 1,
          responseTime: endTime - startTime,
          success: result.success,
          cached: result.localMetadata?.source === 'cache',
          cloudResponseTime: result.performance?.responseTime || 0
        });
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (error) {
        const endTime = performance.now();
        this.metrics.push({
          iteration: i + 1,
          responseTime: endTime - startTime,
          success: false,
          error: error.message
        });
      }
    }
    
    return this.analyzeMetrics();
  }
  
  analyzeMetrics() {
    const successful = this.metrics.filter(m => m.success);
    const failed = this.metrics.filter(m => !m.success);
    const cached = successful.filter(m => m.cached);
    const cloud = successful.filter(m => !m.cached);
    
    const avgResponseTime = successful.reduce((sum, m) => sum + m.responseTime, 0) / successful.length;
    const p95ResponseTime = this.calculatePercentile(successful.map(m => m.responseTime), 95);
    const p99ResponseTime = this.calculatePercentile(successful.map(m => m.responseTime), 99);
    
    return {
      totalRequests: this.metrics.length,
      successfulRequests: successful.length,
      failedRequests: failed.length,
      cachedRequests: cached.length,
      cloudRequests: cloud.length,
      performance: {
        averageResponseTime: Math.round(avgResponseTime),
        p95ResponseTime: Math.round(p95ResponseTime),
        p99ResponseTime: Math.round(p99ResponseTime),
        successRate: (successful.length / this.metrics.length) * 100
      },
      cacheEfficiency: cached.length > 0 ? {
        cacheHitRate: (cached.length / this.metrics.length) * 100,
        avgCachedResponseTime: Math.round(cached.reduce((sum, m) => sum + m.responseTime, 0) / cached.length),
        avgCloudResponseTime: cloud.length > 0 ? Math.round(cloud.reduce((sum, m) => sum + m.responseTime, 0) / cloud.length) : 0
      } : null
    };
  }
  
  calculatePercentile(values, percentile) {
    const sorted = values.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }
}

// Run performance test
const perfTest = new ValidationPerformanceTest(validationService);
perfTest.runPerformanceTest(500).then(results => {
  console.log('Performance Test Results:', JSON.stringify(results, null, 2));
});
```

## DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] Test unified endpoint with all operation types
- [ ] Verify error handling for all failure scenarios
- [ ] Test caching behavior and invalidation
- [ ] Validate circuit breaker functionality
- [ ] Performance test under load
- [ ] Test graceful degradation scenarios

### Deployment
- [ ] Deploy unified endpoint to production
- [ ] Configure monitoring and alerting
- [ ] Set up health checks
- [ ] Update DNS/CDN configuration if needed
- [ ] Test production endpoint connectivity

### Post-Deployment
- [ ] Monitor response times and error rates
- [ ] Verify client integrations work correctly
- [ ] Check cache hit rates and effectiveness
- [ ] Monitor circuit breaker activations
- [ ] Validate fallback mechanisms
- [ ] Update documentation and integration guides

---

*This integration guide provides comprehensive instructions for implementing POSPal's unified cloud validation service, ensuring reliable, performant, and resilient license validation across all deployment scenarios.*