/**
 * Email templates for POSPal Licensing System
 */

/**
 * Welcome email with unlock token (sent after payment)
 */
export function getWelcomeEmailTemplate(customerName, unlockToken, customerEmail) {
  const subject = 'Your POSPal License is Ready!';
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #16a34a; margin: 0;">POSPal License Activated!</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Your restaurant POS system is ready</p>
      </div>
      
      <div style="background: #f0fdf4; border: 1px solid #16a34a; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #15803d; margin: 0 0 10px 0;">Payment Successful</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, your POSPal subscription is now active!</p>
      </div>
      
      <h3 style="color: #374151;">Your Unlock Token</h3>
      <div style="background: #1f2937; color: #f9fafb; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
        <p style="margin: 0 0 10px 0; font-size: 14px; color: #d1d5db;">Copy this token exactly:</p>
        <div style="font-family: monospace; font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #10b981;">
          ${unlockToken}
        </div>
      </div>
      
      <h3 style="color: #374151;">How to Unlock POSPal</h3>
      <ol style="color: #6b7280; line-height: 1.6;">
        <li><strong>Open POSPal</strong> on your computer</li>
        <li>When prompted for license, click <strong>"Already paid? Enter unlock code"</strong></li>
        <li><strong>Enter your email:</strong> ${customerEmail}</li>
        <li><strong>Enter unlock token:</strong> ${unlockToken}</li>
        <li>Click <strong>"Unlock"</strong> - POSPal will activate immediately!</li>
      </ol>
      
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #92400e; margin: 0 0 10px 0;">Important Notes</h4>
        <ul style="color: #92400e; margin: 0; padding-left: 20px;">
          <li>Your unlock token works on <strong>ONE computer at a time</strong></li>
          <li>To switch computers, just enter the same code on the new machine</li>
          <li>Keep this email safe - you'll need it to reinstall POSPal</li>
          <li>Your subscription renews automatically at &euro;20/month</li>
        </ul>
      </div>
      
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #1d4ed8; margin: 0 0 10px 0;">Need Help?</h4>
        <p style="color: #1e40af; margin: 0;">
          If you have any issues unlocking POSPal, just reply to this email. 
          We typically respond within 24 hours.
        </p>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          Thank you for choosing POSPal!<br>
          <a href="https://pospal.gr" style="color: #16a34a;">pospal.gr</a> - Modern Point of Sale System
        </p>
      </div>
    </div>
  `;
  
  return { subject, html };
}

/**
 * Immediate suspension email template - NO GRACE PERIOD POLICY
 */
export function getImmediateSuspensionEmailTemplate(customerName, invoiceDetails = {}) {
  const subject = 'POSPal Access Suspended - Payment Required';
  const { amountDueCents, currency, hostedInvoiceUrl, dueDate } = invoiceDetails || {};
  const amountLine = Number.isFinite(amountDueCents)
    ? `${(amountDueCents / 100).toFixed(2)} ${String(currency || '').toUpperCase() || 'EUR'}`
    : null;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #dc2626; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #dc2626; margin: 0;">Access Suspended</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Your POSPal subscription payment failed</p>
      </div>
      
      <div style="background: #fef2f2; border: 1px solid #dc2626; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #dc2626; margin: 0 0 10px 0;">Immediate Suspension</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, your POSPal access has been immediately suspended due to payment failure.</p>
      </div>
      
      <h3 style="color: #374151;">Our No Grace Period Policy</h3>
      <div style="background: #fff7ed; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <ul style="color: #92400e; line-height: 1.6; margin: 0; padding-left: 20px;">
          <li><strong>Immediate suspension:</strong> No waiting period when payment fails</li>
          <li><strong>Pay to play:</strong> Access is restored immediately when payment succeeds</li>
          <li><strong>Your data is safe:</strong> All settings and data are preserved</li>
          <li><strong>Simple policy:</strong> No confusing grace periods or warnings</li>
        </ul>
      </div>
      
      <h3 style="color: #374151;">Restore Access Now</h3>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${hostedInvoiceUrl || 'https://billing.stripe.com/p/login/customer_portal'}"
           style="background: #dc2626; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          ${amountLine ? `Pay ${amountLine}` : 'Update Payment & Restore Access'}
        </a>
      </div>

      ${amountLine ? `
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #92400e; margin: 0 0 10px 0;">Invoice details</h4>
        <ul style="color: #92400e; margin: 0; padding-left: 20px; line-height: 1.6;">
          <li><strong>Amount due:</strong> ${amountLine}</li>
          ${dueDate ? `<li><strong>Payment attempt:</strong> ${dueDate}</li>` : ''}
          ${hostedInvoiceUrl ? `<li><a href="${hostedInvoiceUrl}" style="color: #1d4ed8;">View invoice</a></li>` : ''}
        </ul>
      </div>
      ` : ''}
      
      <div style="background: #f0fdf4; border: 1px solid #16a34a; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #15803d; margin: 0 0 10px 0;">Instant Reactivation</h4>
        <p style="color: #15803d; margin: 0;">
          As soon as your payment goes through, POSPal will be immediately reactivated. 
          No waiting, no delays - just instant access to your POS system.
        </p>
      </div>
      
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #1d4ed8; margin: 0 0 10px 0;">Need Help?</h4>
        <p style="color: #1e40af; margin: 0;">
          Having payment issues? Reply to this email and we'll help you resolve it quickly.
        </p>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          POSPal Billing Team<br>
          <a href="https://pospal.gr" style="color: #16a34a;">pospal.gr</a> - Modern Point of Sale System
        </p>
      </div>
    </div>
  `;
  
  return { subject, html };
}

/**
 * DEPRECATED: Old payment failure email template with grace period language
 * This is replaced by getImmediateSuspensionEmailTemplate for the no-grace-period policy
 */
export function getPaymentFailureEmailTemplate(customerName) {
  // This function is kept for backward compatibility but should not be used
  // Use getImmediateSuspensionEmailTemplate instead
  console.warn('DEPRECATED: Use getImmediateSuspensionEmailTemplate instead of getPaymentFailureEmailTemplate');
  return getImmediateSuspensionEmailTemplate(customerName);
}

/**
 * Renewal reminder email template
 */
export function getRenewalReminderEmailTemplate(customerName, daysLeft) {
  const subject = `POSPal Renewal - ${daysLeft} days remaining`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #f59e0b; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #f59e0b; margin: 0;">Renewal Reminder</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">${daysLeft} days until your subscription renews</p>
      </div>
      
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #92400e; margin: 0 0 10px 0;">Upcoming Renewal</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, your POSPal subscription will automatically renew in ${daysLeft} days.</p>
      </div>
      
      <h3 style="color: #374151;">What's Renewing</h3>
      <ul style="color: #6b7280; line-height: 1.6;">
        <li><strong>Plan:</strong> POSPal Pro Monthly</li>
        <li><strong>Price:</strong> &euro;20.00/month</li>
        <li><strong>Payment Method:</strong> Card ending in ****</li>
        <li><strong>Renewal:</strong> Automatic</li>
      </ul>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://billing.stripe.com/p/login/customer_portal" 
           style="background: #16a34a; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Manage Subscription
        </a>
      </div>
      
      <div style="background: #f0fdf4; border: 1px solid #16a34a; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #15803d; margin: 0 0 10px 0;">What You Get</h4>
        <ul style="color: #15803d; margin: 0; padding-left: 20px;">
          <li>Complete POS system with unlimited orders</li>
          <li>QR menu and online ordering</li>
          <li>Printing and reporting features</li>
          <li>Free updates and support</li>
        </ul>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          Questions? Just reply to this email.<br>
          <a href="https://pospal.gr" style="color: #16a34a;">pospal.gr</a> - Modern Point of Sale System
        </p>
      </div>
    </div>
  `;
  
  return { subject, html };
}

/**
 * Immediate reactivation email template - NO GRACE PERIOD POLICY
 */
export function getImmediateReactivationEmailTemplate(customerName) {
  const subject = 'POSPal Reactivated - Welcome Back!';
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #16a34a; margin: 0;">Access Restored!</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Your POSPal subscription is active again</p>
      </div>
      
      <div style="background: #f0fdf4; border: 1px solid #16a34a; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #15803d; margin: 0 0 10px 0;">Immediate Reactivation</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, your payment has been processed successfully and POSPal access is immediately restored!</p>
      </div>
      
      <h3 style="color: #374151;">You're All Set</h3>
      <ul style="color: #6b7280; line-height: 1.6;">
        <li><strong>Access restored:</strong> POSPal is ready to use right now</li>
        <li><strong>All data preserved:</strong> Your settings, menus, and reports are intact</li>
        <li><strong>No delays:</strong> Start taking orders immediately</li>
        <li><strong>Auto-renewal active:</strong> Future payments will process automatically</li>
      </ul>
      
      <div style="background: #fff7ed; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #92400e; margin: 0 0 10px 0;">Our Simple Policy</h4>
        <p style="color: #92400e; margin: 0;">
          We keep things simple: <strong>Payment succeeds = Instant access</strong>. 
          No waiting periods, no approvals - just immediate reactivation when you pay.
        </p>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://pospal.gr" 
           style="background: #16a34a; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Open POSPal Now
        </a>
      </div>
      
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #1d4ed8; margin: 0 0 10px 0;">Support Available</h4>
        <p style="color: #1e40af; margin: 0;">
          Questions about your reactivation? Reply to this email and we'll help you right away.
        </p>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          Welcome back to POSPal!<br>
          <a href="https://pospal.gr" style="color: #16a34a;">pospal.gr</a> - Modern Point of Sale System
        </p>
      </div>
    </div>
  `;
  
  return { subject, html };
}

/**
 * Renewal processed receipt (for on-time renewals)
 */
export function getRenewalProcessedEmailTemplate(customerName, amountCents = null, currency = 'eur', periodEnd = null) {
  const subject = 'POSPal Renewal Confirmed';
  const amountLine = Number.isFinite(amountCents)
    ? `${(amountCents / 100).toFixed(2)} ${String(currency || '').toUpperCase()}`
    : 'your active plan';
  const renewalDate = periodEnd ? new Date(periodEnd).toDateString() : null;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #16a34a; margin: 0;">Renewal Successful</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">POSPal remains active on your account</p>
      </div>

      <p style="color: #374151;">Hi ${customerName}, your POSPal subscription renewed successfully.</p>

      <div style="background: #f0fdf4; border: 1px solid #16a34a; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <ul style="color: #15803d; margin: 0; padding-left: 20px; line-height: 1.6;">
          <li><strong>Plan charge:</strong> ${amountLine}</li>
          ${renewalDate ? `<li><strong>Current period ends:</strong> ${renewalDate}</li>` : ''}
          <li><strong>Status:</strong> licensed_active</li>
        </ul>
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <a href="https://billing.stripe.com/p/login/customer_portal"
           style="background: #16a34a; color: white; padding: 14px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Manage Subscription
        </a>
      </div>

      <p style="color: #6b7280;">If you didn’t authorize this renewal, reply and we’ll help immediately.</p>

      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          POSPal Billing · pospal.gr
        </p>
      </div>
    </div>
  `;

  return { subject, html };
}

/**
 * License key recovery email template
 */
export function getLicenseRecoveryEmailTemplate(customerName, unlockToken, customerEmail) {
  const subject = 'Your POSPal License Key';
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #111827; margin-top: 0; text-align: center;">POSPal Unlock Token</h2>
      <p style="color: #374151; margin: 16px 0 0 0;">Hi ${customerName},</p>
      <p style="color: #374151; margin: 8px 0 24px 0;">Here is the unlock token linked to ${customerEmail}.</p>
      <div style="background: #111827; color: #f9fafb; padding: 18px; border-radius: 10px; text-align: center; margin: 0 0 24px 0;">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: #d1d5db;">Unlock token</p>
        <div style="font-family: monospace; font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #34d399;">
          ${unlockToken}
        </div>
      </div>
      <p style="color: #6b7280; margin: 0;">Keep this email for your records.</p>
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 10px; padding: 12px; margin: 20px 0;">
        <ul style="color: #1e40af; margin: 0; padding-left: 20px; line-height: 1.6;">
          <li>Open POSPal and choose "Already paid? Enter unlock code"</li>
          <li>Email: ${customerEmail}</li>
          <li>Enter unlock token: ${unlockToken}</li>
          <li>Need billing history? <a style="color: #1d4ed8;" href="https://billing.stripe.com/p/login/customer_portal">Open customer portal</a></li>
        </ul>
      </div>
      <p style="color: #9ca3af; font-size: 13px; text-align: center; margin: 32px 0 0 0;">POSPal Licensing &middot; pospal.gr</p>
    </div>
  `;
  
  return { subject, html };
}

/**
 * Machine switch notification email
 */
export function getMachineSwitchEmailTemplate(customerName, newMachineInfo = null) {
  const subject = 'POSPal - Computer Changed';
  const deviceDetail = newMachineInfo && typeof newMachineInfo === 'object'
    ? (newMachineInfo.hostname || newMachineInfo.current || newMachineInfo.deviceName || null)
    : null;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #3b82f6; margin: 0;">Computer Changed</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Your POSPal license was activated on a new computer</p>
      </div>
      
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #1d4ed8; margin: 0 0 10px 0;">License Transferred</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, your POSPal license is now active on a different computer${deviceDetail ? ` (${deviceDetail})` : ''}.</p>
      </div>
      
      <h3 style="color: #374151;">What Happened</h3>
      <p style="color: #6b7280; line-height: 1.6;">
        You (or someone with your unlock token) activated POSPal on a new computer. 
        Since your license works on one computer at a time, the previous installation has been deactivated.
      </p>
      
      <h3 style="color: #374151;">If This Wasn't You</h3>
      <ul style="color: #6b7280; line-height: 1.6;">
        <li>Someone else may have your unlock token</li>
        <li>You can reclaim your license by entering your unlock token on your main computer</li>
        <li>Consider changing your unlock token by contacting support</li>
      </ul>
      
      <div style="background: #fef2f2; border: 1px solid #dc2626; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #dc2626; margin: 0 0 10px 0;">Security Notice</h4>
        <p style="color: #dc2626; margin: 0;">
          If you didn't authorize this change, please contact us immediately at support@pospal.gr
        </p>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="mailto:support@pospal.gr" 
           style="background: #dc2626; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Contact Support
        </a>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          POSPal Security Team<br>
          <a href="https://pospal.gr" style="color: #16a34a;">pospal.gr</a>
        </p>
      </div>
    </div>
  `;
  
  return { subject, html };
}
/**
 * License disconnection confirmation email template
 */
export function getLicenseDisconnectionEmailTemplate(customerName, unlockToken, customerEmail, deviceInfo = {}) {
  const subject = 'POSPal License Disconnected from Device';
  const deviceDetail = deviceInfo && typeof deviceInfo === 'object'
    ? (deviceInfo.hostname || deviceInfo.current || deviceInfo.deviceName || null)
    : null;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #f59e0b; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #f59e0b; margin: 0;">License Disconnected</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Your POSPal license has been removed from a device</p>
      </div>
      
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #92400e; margin: 0 0 10px 0;">Device Disconnected</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, your POSPal license was successfully disconnected from a device${deviceDetail ? ` (${deviceDetail})` : ''}.</p>
      </div>
      
      <h3 style="color: #374151;">What Happened</h3>
      <p style="color: #6b7280; line-height: 1.6;">
        Your POSPal license was manually disconnected from a device. This allows you to activate POSPal on a different computer.
      </p>
      
      <div style="background: #f0fdf4; border: 1px solid #16a34a; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #15803d; margin: 0 0 10px 0;">Your License is Safe</h4>
        <ul style="color: #15803d; margin: 0; padding-left: 20px;">
          <li><strong>Subscription active:</strong> Your POSPal subscription continues</li>
          <li><strong>Data preserved:</strong> All menu items and settings are saved</li>
          <li><strong>Ready to reactivate:</strong> Use your unlock token on any computer</li>
          <li><strong>No charges:</strong> This doesn't affect your billing</li>
        </ul>
      </div>
      
      <h3 style="color: #374151;">Your Unlock Token</h3>
      <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
        Use this token to activate POSPal on your new device:
      </p>
      <div style="background: #1f2937; color: #f9fafb; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
        <div style="font-family: monospace; font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #10b981;">
          ${unlockToken}
        </div>
      </div>
      
      <h3 style="color: #374151;">Activate on New Device</h3>
      <ol style="color: #6b7280; line-height: 1.6;">
        <li><strong>Install POSPal</strong> on your new computer</li>
        <li>Open POSPal and click <strong>"Already paid? Enter unlock code"</strong></li>
        <li><strong>Enter your email:</strong> ${customerEmail}</li>
        <li><strong>Enter unlock token:</strong> ${unlockToken}</li>
        <li>Click <strong>"Unlock"</strong> - POSPal will activate immediately!</li>
      </ol>
      
      <div style="background: #fff7ed; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #92400e; margin: 0 0 10px 0;">If You Didn't Do This</h4>
        <p style="color: #92400e; margin: 0 0 10px 0;">
          If you didn't disconnect your license, someone else may have access to your account.
        </p>
        <ul style="color: #92400e; margin: 0; padding-left: 20px;">
          <li>Contact support immediately: support@pospal.gr</li>
          <li>We'll help secure your account and investigate</li>
          <li>Your subscription won't be charged during investigation</li>
        </ul>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://pospal.gr/download" 
           style="background: #16a34a; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Download POSPal
        </a>
      </div>
      
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #1d4ed8; margin: 0 0 10px 0;">Need Help?</h4>
        <p style="color: #1e40af; margin: 0;">
          Having trouble reactivating POSPal on your new device? Reply to this email and we'll assist you.
        </p>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          POSPal License Management<br>
          <a href="https://pospal.gr" style="color: #16a34a;">pospal.gr</a> - Modern Point of Sale System
        </p>
      </div>
    </div>
  `;

  return { subject, html };
}

/**
 * Subscription cancelled email template
 */
export function getSubscriptionCancelledEmailTemplate(customerName, subscriptionId, periodEnd = null) {
  const subject = 'Your POSPal Subscription Has Been Cancelled';
  const periodEndText = periodEnd ? new Date(periodEnd).toDateString() : 'the end of your current billing period';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #dc2626; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #dc2626; margin: 0;">Subscription Cancelled</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">POSPal access will end soon</p>
      </div>

      <p style="color: #374151;">Hi ${customerName}, we received a cancellation for your POSPal subscription${subscriptionId ? ` (${subscriptionId})` : ''}.</p>

      <div style="background: #fff7ed; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <ul style="color: #92400e; margin: 0; padding-left: 20px; line-height: 1.6;">
          <li><strong>Access ends:</strong> ${periodEndText}</li>
          <li><strong>Your data:</strong> kept intact; you can resubscribe anytime</li>
          <li><strong>Need billing history?</strong> <a href="https://billing.stripe.com/p/login/customer_portal" style="color: #1d4ed8;">Open customer portal</a></li>
        </ul>
      </div>

      <div style="background: #f0fdf4; border: 1px solid #16a34a; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #15803d; margin: 0 0 10px 0;">Changed your mind?</h4>
        <p style="color: #15803d; margin: 0;">You can reactivate at any time—your unlock token and settings remain ready to use.</p>
      </div>

      <p style="color: #6b7280;">Questions? Reply to this email and we'll help.</p>

      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">POSPal Billing · pospal.gr</p>
      </div>
    </div>
  `;

  return { subject, html };
}
