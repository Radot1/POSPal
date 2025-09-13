# POSPal License Key Recovery System

## Overview

The POSPal License Key Recovery System is a comprehensive, secure solution for customers who have lost their license key emails or need to retrieve their existing license keys. The system implements advanced security measures, rate limiting, and comprehensive audit logging to prevent abuse while maintaining a smooth user experience.

## Features

### 🔐 Security Features
- **Rate Limiting**: Multi-tiered rate limiting (per IP, per email, per IP+email combination)
- **Security Analysis**: Automated security indicator analysis for each request
- **Audit Trail**: Comprehensive logging of all recovery attempts
- **Email Enumeration Protection**: Generic responses to prevent account discovery
- **Temporary Blocking**: Automatic temporary blocks after rate limit violations

### 📧 Enhanced Email Template
- **Dedicated Recovery Template**: Purpose-built email template for license recovery
- **Security Warnings**: Clear warnings about unauthorized access attempts
- **Usage Instructions**: Step-by-step instructions for license activation
- **Subscription Status**: Clear indication of subscription status and billing info

### 📊 Monitoring & Analytics
- **Recovery Attempt Tracking**: Detailed logging of all recovery attempts
- **Security Flags**: Automated flagging of suspicious recovery patterns
- **Success/Failure Metrics**: Track recovery success rates and failure reasons
- **Audit Event Integration**: Full integration with existing audit system

## API Endpoints

### Primary Endpoint: `/recover-license`

**Method**: `POST`  
**Content-Type**: `application/json`

#### Request Body
```json
{
  "email": "customer@example.com"
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "If this email has a POSPal account, a recovery email will be sent within a few minutes.",
  "customerInfo": {
    "subscriptionStatus": "active",
    "accountCreated": "2024-01-15T10:30:00.000Z"
  }
}
```

#### Rate Limited Response (429)
```json
{
  "error": "Rate limit exceeded for email_recovery_per_ip. Temporarily blocked until Mon Dec 09 2024 15:30:00.",
  "rateLimited": true,
  "reason": "rate_limit_exceeded",
  "blockedUntil": "2024-12-09T15:30:00.000Z"
}
```

### Legacy Endpoint: `/resend-license-email`

**Status**: DEPRECATED - Redirects to `/recover-license`  
**Method**: `POST`  
**Backward Compatibility**: Full compatibility maintained

## Rate Limiting Configuration

### Per IP Address Limits
- **Hourly**: 5 recovery attempts per hour
- **Daily**: 20 recovery attempts per day

### Per Email Address Limits  
- **Hourly**: 3 recovery attempts per hour
- **Daily**: 10 recovery attempts per day

### Per IP+Email Combination
- **Hourly**: 2 recovery attempts per hour  
- **Daily**: 5 recovery attempts per day

### Temporary Blocking
- **Block Duration**: 60 minutes after rate limit exceeded
- **Reset Period**: 24 hours for daily limits, 1 hour for hourly limits

## Database Schema

### Recovery Attempts Table
```sql
CREATE TABLE recovery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  success BOOLEAN DEFAULT FALSE,
  customer_id INTEGER,
  recovery_type TEXT DEFAULT 'email_recovery',
  security_flags TEXT, -- JSON string for security indicators
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
```

### Rate Limits Table
```sql
CREATE TABLE rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  limit_type TEXT NOT NULL,
  attempt_count INTEGER DEFAULT 0,
  first_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
  reset_after DATETIME,
  blocked_until DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Security Analysis

### Automatic Security Flagging

The system automatically analyzes each recovery request and assigns security levels:

#### Normal Security Level
- Email exists in system
- Customer recently active (< 30 days)
- Active subscription

#### Medium Security Level  
- Customer inactive for > 30 days
- Inactive/cancelled subscription
- Multiple recent recovery attempts

#### High Security Level
- Email not found in system
- Suspicious request patterns
- Rate limit violations

### Security Indicators Tracked
- **IP Address**: Cloudflare connecting IP
- **User Agent**: Browser/client information  
- **Country**: Cloudflare IP country
- **Timestamp**: Request timestamp
- **Customer Activity**: Last seen, subscription status
- **Request Patterns**: Frequency, timing analysis

## Email Template Features

### License Recovery Email Content
- **Clear Subject Line**: "Your POSPal License Key Recovery"
- **License Key Display**: Prominently displayed unlock token
- **Usage Instructions**: Step-by-step activation guide
- **Security Warning**: Alert about unauthorized access attempts
- **Subscription Info**: Current subscription status and billing
- **Support Contact**: Clear support contact information

### Security Warnings
- Warning if request wasn't initiated by customer
- Instructions for contacting support if unauthorized
- Recommendations for account security

## Implementation Guide

### 1. Database Setup
```bash
# Apply the recovery system schema
wrangler d1 execute pospal-subscriptions --file=license-recovery-schema.sql
```

### 2. Environment Variables
Ensure these environment variables are set:
- `RESEND_API_KEY`: For email delivery
- `DB`: D1 database binding

### 3. Frontend Integration
```javascript
// Example frontend implementation
async function recoverLicense(email) {
  try {
    const response = await fetch('/recover-license', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email })
    });
    
    const result = await response.json();
    
    if (response.status === 429) {
      // Handle rate limiting
      showError(`Too many attempts. ${result.error}`);
      return;
    }
    
    if (result.success) {
      showSuccess(result.message);
    } else {
      showError(result.error);
    }
  } catch (error) {
    showError('Failed to process recovery request');
  }
}
```

## Monitoring and Analytics

### Key Metrics to Monitor
1. **Recovery Success Rate**: Percentage of successful recoveries
2. **Rate Limit Violations**: Frequency of rate limit hits
3. **Security Flag Distribution**: Breakdown by security levels
4. **Email Delivery Success**: Recovery email delivery rates
5. **Geographic Patterns**: Recovery request origin analysis

### Audit Events Generated
- `license_recovery_requested`: Each recovery attempt
- `license_recovery_email_sent`: Successful email delivery
- `license_recovery_email_failed`: Failed email delivery
- `rate_limit_violation`: Rate limit exceeded events

### Recommended Queries

#### Daily Recovery Statistics
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_attempts,
  SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_attempts,
  COUNT(DISTINCT email) as unique_emails,
  COUNT(DISTINCT ip_address) as unique_ips
FROM recovery_attempts 
WHERE created_at > datetime('now', '-30 days')
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

#### Security Level Analysis
```sql
SELECT 
  JSON_EXTRACT(security_flags, '$.securityLevel') as security_level,
  COUNT(*) as count,
  AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate
FROM recovery_attempts
WHERE created_at > datetime('now', '-7 days')
GROUP BY JSON_EXTRACT(security_flags, '$.securityLevel');
```

## Best Practices

### For Administrators
1. **Monitor Rate Limits**: Regular review of rate limit violations
2. **Security Analysis**: Weekly review of high-security flagged attempts
3. **Email Delivery**: Monitor email delivery success rates
4. **Database Maintenance**: Regular cleanup of old recovery attempts

### For Developers
1. **Error Handling**: Implement proper error handling for all scenarios
2. **User Feedback**: Provide clear feedback for rate limiting
3. **Security Updates**: Keep security thresholds updated based on usage patterns
4. **Testing**: Regular testing of rate limiting and security features

## Troubleshooting

### Common Issues

#### High Rate Limit Violations
- **Cause**: Legitimate customers hitting limits
- **Solution**: Review and adjust rate limit thresholds
- **Investigation**: Analyze recovery attempt patterns

#### Low Recovery Success Rate  
- **Cause**: Email delivery issues or invalid customer data
- **Solution**: Check Resend API status and customer database integrity
- **Investigation**: Review email delivery logs

#### Security False Positives
- **Cause**: Legitimate customers flagged as suspicious
- **Solution**: Refine security analysis algorithms
- **Investigation**: Review security flag patterns

### Support Scenarios

#### Customer Cannot Recover License
1. Check rate limiting status
2. Verify email in customer database  
3. Check email delivery logs
4. Use manual license creation if needed

#### Suspected Abuse
1. Review recovery attempts for suspicious patterns
2. Check IP and email patterns in audit logs
3. Implement additional blocking if needed
4. Report to security team

## Integration Points

### Existing System Integration
- **Customer Database**: Full integration with existing customer table
- **Audit System**: Leverages existing audit logging infrastructure  
- **Email System**: Uses existing Resend integration
- **Rate Limiting**: New dedicated system for recovery-specific limits

### Frontend Integration Points
- **License Recovery Form**: Customer-facing recovery request form
- **Rate Limit Handling**: Graceful handling of rate limit responses
- **Success Messaging**: Clear communication of recovery status
- **Error Handling**: Comprehensive error state management

## Future Enhancements

### Planned Features
1. **CAPTCHA Integration**: Add CAPTCHA for high-risk recovery attempts
2. **Phone Verification**: Optional SMS verification for high-value accounts  
3. **IP Reputation**: Integration with IP reputation services
4. **Machine Learning**: Advanced pattern recognition for abuse detection
5. **Admin Dashboard**: Visual interface for monitoring and management

### Security Improvements
1. **Enhanced Fingerprinting**: More sophisticated request analysis
2. **Behavioral Analysis**: Pattern recognition for legitimate vs. fraudulent requests
3. **Real-time Blocking**: Dynamic blocking based on threat intelligence
4. **Multi-factor Recovery**: Optional additional verification steps

This comprehensive license recovery system provides POSPal with enterprise-grade security while maintaining an excellent user experience for legitimate customers who need to recover their license keys.