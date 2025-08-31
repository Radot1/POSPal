/**
 * Email templates for POSPal Licensing System
 */

/**
 * Welcome email with unlock token (sent after payment)
 */
export function getWelcomeEmailTemplate(customerName, unlockToken, customerEmail) {
  const subject = 'Your POSPal License is Ready! 🎉';
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #16a34a; margin: 0;">POSPal License Activated!</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Your restaurant POS system is ready</p>
      </div>
      
      <div style="background: #f0fdf4; border: 1px solid #16a34a; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #15803d; margin: 0 0 10px 0;">✅ Payment Successful</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, your POSPal subscription is now active!</p>
      </div>
      
      <h3 style="color: #374151;">🔑 Your Unlock Token</h3>
      <div style="background: #1f2937; color: #f9fafb; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
        <p style="margin: 0 0 10px 0; font-size: 14px; color: #d1d5db;">Copy this token exactly:</p>
        <div style="font-family: monospace; font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #10b981;">
          ${unlockToken}
        </div>
      </div>
      
      <h3 style="color: #374151;">🚀 How to Unlock POSPal</h3>
      <ol style="color: #6b7280; line-height: 1.6;">
        <li><strong>Open POSPal</strong> on your computer</li>
        <li>When prompted for license, click <strong>"Already paid? Enter unlock code"</strong></li>
        <li><strong>Enter your email:</strong> ${customerEmail}</li>
        <li><strong>Enter unlock token:</strong> ${unlockToken}</li>
        <li>Click <strong>"Unlock"</strong> - POSPal will activate immediately!</li>
      </ol>
      
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #92400e; margin: 0 0 10px 0;">⚠️ Important Notes</h4>
        <ul style="color: #92400e; margin: 0; padding-left: 20px;">
          <li>Your unlock token works on <strong>ONE computer at a time</strong></li>
          <li>To switch computers, just enter the same code on the new machine</li>
          <li>Keep this email safe - you'll need it to reinstall POSPal</li>
          <li>Your subscription renews automatically at €20/month</li>
        </ul>
      </div>
      
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #1d4ed8; margin: 0 0 10px 0;">📞 Need Help?</h4>
        <p style="color: #1e40af; margin: 0;">
          If you have any issues unlocking POSPal, just reply to this email. 
          We typically respond within 24 hours.
        </p>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          Thank you for choosing POSPal!<br>
          <a href="https://pospal.gr" style="color: #16a34a;">pospal.gr</a> • Modern Point of Sale System
        </p>
      </div>
    </div>
  `;
  
  return { subject, html };
}

/**
 * Payment failure email template
 */
export function getPaymentFailureEmailTemplate(customerName) {
  const subject = 'POSPal Subscription - Payment Issue';
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #dc2626; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #dc2626; margin: 0;">Payment Issue</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Action required for your POSPal subscription</p>
      </div>
      
      <div style="background: #fef2f2; border: 1px solid #dc2626; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #dc2626; margin: 0 0 10px 0;">⚠️ Payment Failed</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, we couldn't process your POSPal subscription payment.</p>
      </div>
      
      <h3 style="color: #374151;">What This Means</h3>
      <ul style="color: #6b7280; line-height: 1.6;">
        <li>Your POSPal access will be suspended after 3 failed payment attempts</li>
        <li>All your data remains safe and will be restored when payment is resolved</li>
        <li>You have 7 days to update your payment method</li>
      </ul>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://billing.stripe.com/p/login/customer_portal" 
           style="background: #dc2626; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Update Payment Method
        </a>
      </div>
      
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <h4 style="color: #1d4ed8; margin: 0 0 10px 0;">Need Help?</h4>
        <p style="color: #1e40af; margin: 0;">
          Having trouble with payments? Reply to this email and we'll help you resolve the issue quickly.
        </p>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          POSPal Support Team<br>
          <a href="https://pospal.gr" style="color: #16a34a;">pospal.gr</a>
        </p>
      </div>
    </div>
  `;
  
  return { subject, html };
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
        <h2 style="color: #92400e; margin: 0 0 10px 0;">📅 Upcoming Renewal</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, your POSPal subscription will automatically renew in ${daysLeft} days.</p>
      </div>
      
      <h3 style="color: #374151;">What's Renewing</h3>
      <ul style="color: #6b7280; line-height: 1.6;">
        <li><strong>Plan:</strong> POSPal Pro Monthly</li>
        <li><strong>Price:</strong> €20.00/month</li>
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
        <h4 style="color: #15803d; margin: 0 0 10px 0;">✨ What You Get</h4>
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
          <a href="https://pospal.gr" style="color: #16a34a;">pospal.gr</a> • Modern Point of Sale System
        </p>
      </div>
    </div>
  `;
  
  return { subject, html };
}

/**
 * Machine switch notification email
 */
export function getMachineSwitchEmailTemplate(customerName, newMachineInfo) {
  const subject = 'POSPal - Computer Changed';
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #3b82f6; margin: 0;">Computer Changed</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Your POSPal license was activated on a new computer</p>
      </div>
      
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #1d4ed8; margin: 0 0 10px 0;">🔄 License Transferred</h2>
        <p style="margin: 0; color: #374151;">Dear ${customerName}, your POSPal license is now active on a different computer.</p>
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
        <h4 style="color: #dc2626; margin: 0 0 10px 0;">🚨 Security Notice</h4>
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