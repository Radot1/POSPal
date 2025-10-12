# License Disconnection Email Implementation Guide

## Overview
Add email notification when users disconnect their POSPal license from a device, sent via Resend API.

---

## ✅ Already Complete

### 1. Email Template Created
**File**: `cloudflare-licensing/src/email-templates.js`
**Function**: `getLicenseDisconnectionEmailTemplate()` (lines 392-480)

**Features**:
- Displays customer name and unlock token
- Explains what happened
- Shows reactivation instructions
- Security warning if user didn't initiate
- Download link for new device

---

## 🔧 Implementation Required

### Step 1: Add Email Function to Cloudflare Workers

**File**: `cloudflare-licensing/src/index.js`

**Add import** (around line 36, after other email imports):
```javascript
import {
  getWelcomeEmailTemplate,
  getPaymentFailureEmailTemplate,
  getImmediateReactivationEmailTemplate,
  getRenewalReminderEmailTemplate,
  getMachineSwitchEmailTemplate,
  getLicenseDisconnectionEmailTemplate  // ADD THIS LINE
} from './email-templates.js';
```

**Add email sending function** (around line 1708, after `sendMachineSwitchEmail`):
```javascript
/**
 * Send license disconnection confirmation email
 */
async function sendLicenseDisconnectionEmail(env, customerId, email, name, unlockToken) {
  try {
    const { subject, html } = getLicenseDisconnectionEmailTemplate(name, unlockToken, email);

    const emailLogId = await logEmailDelivery(env.DB, customerId, 'license_disconnection', email, subject);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'POSPal License Management <noreply@pospal.gr>',
        to: [email],
        subject: subject,
        html: html,
      }),
    });

    if (response.ok) {
      await updateEmailStatus(env.DB, emailLogId, 'delivered');
      console.log(`License disconnection email sent to ${email}`);
    } else {
      const error = await response.text();
      await updateEmailStatus(env.DB, emailLogId, 'failed', error);
      console.error(`Failed to send disconnection email:`, error);
    }

  } catch (error) {
    console.error('License disconnection email error:', error);
  }
}
```

---

### Step 2: Modify Session End Handler

**File**: `cloudflare-licensing/src/index.js`

**Current code** (lines 161-190):
```javascript
async function handleSessionEnd(request, env) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return createResponse({
        success: false,
        error: 'Missing session ID'
      }, 400);
    }

    // Mark session as ended
    await env.DB.prepare(`
      UPDATE active_sessions
      SET status = 'ended', last_heartbeat = datetime('now')
      WHERE session_id = ? AND status = 'active'
    `).bind(sessionId).run();

    return createResponse({
      success: true
    });

  } catch (error) {
    console.error('Session end error:', error);
    return createResponse({
      success: false,
      error: 'Failed to end session'
    }, 500);
  }
}
```

**Updated code** (with email notification):
```javascript
async function handleSessionEnd(request, env) {
  try {
    const { sessionId, sendEmail } = await request.json();  // ADD sendEmail param

    if (!sessionId) {
      return createResponse({
        success: false,
        error: 'Missing session ID'
      }, 400);
    }

    // Get session and customer info BEFORE ending session (for email)
    const session = await env.DB.prepare(`
      SELECT s.customer_id, c.email, c.name, c.unlock_token
      FROM active_sessions s
      JOIN customers c ON s.customer_id = c.id
      WHERE s.session_id = ? AND s.status = 'active'
    `).bind(sessionId).first();

    // Mark session as ended
    await env.DB.prepare(`
      UPDATE active_sessions
      SET status = 'ended', last_heartbeat = datetime('now')
      WHERE session_id = ? AND status = 'active'
    `).bind(sessionId).run();

    // Send email notification if requested and session was found
    if (sendEmail && session) {
      await sendLicenseDisconnectionEmail(
        env,
        session.customer_id,
        session.email,
        session.name || 'Customer',
        session.unlock_token
      );
    }

    return createResponse({
      success: true,
      emailSent: sendEmail && session ? true : false
    });

  } catch (error) {
    console.error('Session end error:', error);
    return createResponse({
      success: false,
      error: 'Failed to end session'
    }, 500);
  }
}
```

---

### Step 3: Update Backend Disconnect Endpoint

**File**: `app.py`

**Current code** (around line 7358, in `disconnect_license()` function):
```python
# End cloud session
session_ended = False
if session_id:
    try:
        session_response = requests.post(
            f'{CLOUDFLARE_API_BASE}session/end',
            json={'sessionId': session_id},
            headers={'Content-Type': 'application/json'},
            timeout=10
        )
```

**Updated code**:
```python
# End cloud session
session_ended = False
if session_id:
    try:
        session_response = requests.post(
            f'{CLOUDFLARE_API_BASE}session/end',
            json={
                'sessionId': session_id,
                'sendEmail': True  # ADD THIS LINE - triggers email notification
            },
            headers={'Content-Type': 'application/json'},
            timeout=10
        )
```

---

## 🧪 Testing

### Test 1: Disconnect with Email
1. Have an active license
2. Click "Disconnect License from This Device"
3. Complete the disconnect flow
4. **Expected**: Email sent to customer with unlock token

### Test 2: Email Content Verification
Check email contains:
- ✅ Customer name
- ✅ Unlock token (correctly formatted)
- ✅ Reactivation instructions
- ✅ Security warning
- ✅ Download link

### Test 3: Offline Disconnect
1. Disconnect while cloud API is unreachable
2. **Expected**: Local cleanup succeeds, no email sent (acceptable)

---

## 📋 Deployment Checklist

- [ ] Add import in `index.js` (Step 1)
- [ ] Add `sendLicenseDisconnectionEmail()` function (Step 1)
- [ ] Update `handleSessionEnd()` function (Step 2)
- [ ] Update `app.py` disconnect endpoint (Step 3)
- [ ] Deploy Cloudflare Workers: `npx wrangler deploy`
- [ ] Test email delivery in development
- [ ] Test email delivery in production
- [ ] Verify email logs in Resend dashboard

---

## 🔍 Verification Commands

### Check Cloudflare Workers deployment:
```bash
cd cloudflare-licensing
npx wrangler deployments list --name pospal-licensing-v2-production
```

### Test email template locally:
```javascript
// In browser console or Node.js
const { getLicenseDisconnectionEmailTemplate } = require('./email-templates.js');
const { subject, html } = getLicenseDisconnectionEmailTemplate('John Doe', 'POSPAL-1234-5678-9ABC', 'john@example.com');
console.log(subject);
console.log(html);
```

---

## 📞 Support

If emails aren't sending:
1. Check Resend API key is set in Cloudflare Workers env vars
2. Check email_log table in D1 database for delivery status
3. Check Resend dashboard for bounce/delivery logs
4. Verify `sendEmail: true` is being passed to `/session/end`

---

**Implementation Status**: ⏳ Ready for deployment
**Estimated Time**: 15 minutes to implement + 10 minutes to test
**Last Updated**: October 12, 2025
