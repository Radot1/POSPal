/**
 * Email templates for POSPal Licensing System
 */

const fontStack = '"Inter", "Helvetica Neue", Arial, sans-serif';
const pospalIconDataUri = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAH7NSURBVHja7Z13gCRHdf8/r6p7ZvMlnXI4oUTOWWCCAdsYMFGADQYsMAaDQWT/yDkYsHECgwEZg0lO2CDbRAEGASYLkYRyvjtd3DTTXfV+f1R1mrC7dzrpbm/nSX0z29NdXd1d9eqF73sPRjSiEY1oRCMa0YhGNKIRjWhEIxrRiEY0ohGNaEQjGtGIRjSiEY1oRCMa0YhGNKIRjWhEIxrRiEY0ohGNaEQjGtGIRjSiEY1oRCMa0YhGNKIRjWhEIxrRiEY0ohGNKIRjWhEIxrRiEY0ohGNKIRHd0vT/AVOEnYrKOKrqAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI1LTExLTI1VDE1OjU4OjUwKzAwOjAw8bXXSgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNS0xMS0yNVQxNTo1ODo1MCswMDowMIDob/YAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjUtMTEtMjVUMTU6NTg6NTArMDA6MDDX/U4pAAAAAElFTkSuQmCC`;

const perfectPalette = {
  neutral: {
    accent: '#dbeafe',
    badgeBg: '#eef2ff',
    badgeBorder: '#c7d2fe',
    badgeText: '#1e3a8a',
    highlightBg: '#f8fafc',
    highlightBorder: '#e5e7eb',
    highlightLabel: '#64748b',
    highlightValue: '#0f172a'
  },
  success: {
    accent: '#6ee7b7',
    badgeBg: '#ecfdf5',
    badgeBorder: '#a7f3d0',
    badgeText: '#047857',
    highlightBg: '#ecfdf5',
    highlightBorder: '#6ee7b7',
    highlightLabel: '#047857',
    highlightValue: '#065f46'
  },
  warning: {
    accent: '#fcd34d',
    badgeBg: '#fffbeb',
    badgeBorder: '#fde68a',
    badgeText: '#92400e',
    highlightBg: '#fffbeb',
    highlightBorder: '#fcd34d',
    highlightLabel: '#92400e',
    highlightValue: '#78350f'
  },
  critical: {
    accent: '#fda4af',
    badgeBg: '#fef2f2',
    badgeBorder: '#fecdd3',
    badgeText: '#b91c1c',
    highlightBg: '#fef2f2',
    highlightBorder: '#fca5a5',
    highlightLabel: '#b91c1c',
    highlightValue: '#7f1d1d'
  }
};

function renderEmailTemplate(title, summaryLines = [], detailItems = [], extraContent = '', options = {}) {
  const normalizedOptions =
    typeof options === 'string'
      ? { intent: options }
      : (options && typeof options === 'object') ? options : {};

  const {
    intent = 'neutral',
    subtitle = '',
    highlightLabel = '',
    highlightValue = '',
    highlightSupportingText = '',
    badgeText = 'POSPal Update',
    footerContent = null
  } = normalizedOptions;

  const palette = perfectPalette[intent] || perfectPalette.neutral;
  const safeSummary = summaryLines
    .filter(Boolean)
    .map(line => `<p style="color: #374151; margin: 0 0 12px 0;">${line}</p>`)
    .join('');
  const summarySection = safeSummary ? `<div style="margin-top: 20px;">${safeSummary}</div>` : '';

  const validDetails = (detailItems || []).filter(item => item && item.value !== undefined && item.value !== null && item.value !== '');
  const detailSection = validDetails.length
    ? `<div style="margin-top: 24px; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px 20px;">
        ${validDetails.map((item, index) => `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 10px 0; ${index < validDetails.length - 1 ? 'border-bottom: 1px solid #f3f4f6;' : ''}">
            <span style="color: #6b7280;">${item.label}</span>
            <span style="color: #111827; font-weight: 600; text-align: right;">${item.value}</span>
          </div>
        `).join('')}
      </div>`
    : '';

  const highlightBlock = highlightValue
    ? `<div style="margin-top: 24px; border: 1px solid ${palette.highlightBorder}; background: ${palette.highlightBg}; border-radius: 18px; padding: 18px 20px;">
        ${highlightLabel ? `<p style="margin: 0 0 6px 0; color: ${palette.highlightLabel}; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;">${highlightLabel}</p>` : ''}
        <p style="margin: 0; font-size: 26px; font-weight: 600; color: ${palette.highlightValue};">${highlightValue}</p>
        ${highlightSupportingText ? `<p style="margin: 10px 0 0 0; color: #374151;">${highlightSupportingText}</p>` : ''}
      </div>`
    : '';

  const normalizedExtraContent = Array.isArray(extraContent)
    ? extraContent.filter(Boolean).join('')
    : (extraContent || '');

  const supportFooter = footerContent === null
    ? `<div style="margin-top: 24px; background: #050708; border-radius: 20px; padding: 32px 36px; color: #f9fafb;">
         <p style="font-size: 18px; font-weight: 600; margin: 0 0 12px;">POSPal</p>
         <p style="color: #d1d5db; margin: 0 0 6px;">Need anything? We're ready to help.</p>
         <p style="color: #9ca3af; margin: 0;">Email <a href="mailto:support@pospal.gr" style="color: #6ee7b7; text-decoration: none;">support@pospal.gr</a> or visit the Help Center.</p>
       </div>`
    : footerContent;

  return `
    <div style="font-family: ${fontStack}; background: #f5f5f5; padding: 24px 16px;">
      <div style="max-width: 560px; margin: 0 auto;">
        <div style="background: #ffffff; border-radius: 24px; padding: 36px 28px; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08); border-top: 4px solid ${palette.accent};">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
            <span style="display: inline-flex; align-items: center; gap: 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: ${palette.badgeText}; background: ${palette.badgeBg}; border: 1px solid ${palette.badgeBorder}; border-radius: 999px; padding: 6px 14px;">
              ${badgeText}
            </span>
            <img src="${pospalIconDataUri}" alt="POSPal" style="width: 32px; height: 32px; border-radius: 10px; border: 1px solid #e5e7eb;" />
          </div>
          <h1 style="font-size: 30px; line-height: 1.2; color: #0f172a; margin: 0;">${title}</h1>
          ${subtitle ? `<p style="color: #6b7280; margin: 12px 0 0 0;">${subtitle}</p>` : ''}
          ${highlightBlock}
          ${summarySection}
          ${detailSection}
          ${normalizedExtraContent}
        </div>
        ${supportFooter || ''}
      </div>
    </div>
  `;
}

function renderTokenBlock(unlockToken, note = 'Works on one computer at a time.') {
  if (!unlockToken) {
    return '';
  }
  return `
    <div style="margin-top: 24px; border: 1px solid #0f172a; border-radius: 18px; background: linear-gradient(120deg, #0f172a, #111827); padding: 24px; text-align: center;">
      <p style="margin: 0 0 8px 0; font-size: 12px; letter-spacing: 0.12em; color: #9ca3af; text-transform: uppercase;">Unlock token</p>
      <div style="font-family: 'SFMono-Regular', Menlo, monospace; font-size: 26px; font-weight: 600; letter-spacing: 3px; color: #34d399;">
        ${unlockToken}
      </div>
      ${note ? `<p style="margin: 14px 0 0 0; color: #d1d5db;">${note}</p>` : ''}
    </div>
  `;
}

/**
 * Welcome email with unlock token (sent after payment)
 */
export function getWelcomeEmailTemplate(customerName, unlockToken, customerEmail) {
  const subject = 'Your POSPal License Details';
  const summaryLines = [
    `Hi ${customerName}, your POSPal subscription is active and ready to use.`,
    'Keep this email so you can reinstall or move devices at any time.'
  ];
  const detailItems = [
    { label: 'Account email', value: customerEmail },
    { label: 'Status', value: 'active' }
  ];
  const tokenBlock = renderTokenBlock(unlockToken);
  
  const html = renderEmailTemplate('License Ready', summaryLines, detailItems, tokenBlock, {
    intent: 'success',
    highlightLabel: 'Status',
    highlightValue: 'Active license',
    highlightSupportingText: 'POSPal is unlocked for your account. Use the token below on one computer at a time.',
    badgeText: 'POSPal Licensing'
  });
  return { subject, html };
}

/**
 * Immediate suspension email template - NO GRACE PERIOD POLICY
 */
export function getImmediateSuspensionEmailTemplate(customerName, invoiceDetails = {}) {
  const subject = 'Payment Failed - POSPal Access Paused';
  const { amountDueCents, currency, dueDate, hostedInvoiceUrl } = invoiceDetails || {};
  const amountLine = Number.isFinite(amountDueCents)
    ? `${(amountDueCents / 100).toFixed(2)} ${String(currency || '').toUpperCase() || 'EUR'}`
    : null;
  
  const summaryLines = [
    `Hi ${customerName}, your latest payment failed and POSPal access is paused.`,
    'Your data and menus remain intact. Access resumes automatically once payment succeeds.'
  ];
  const detailItems = [
    { label: 'Status', value: 'suspended' },
    amountLine ? { label: 'Amount attempted', value: amountLine } : null,
    dueDate ? { label: 'Last payment attempt', value: dueDate } : null
  ];

  const invoiceLinkBlock = hostedInvoiceUrl
    ? `<div style="margin-top: 24px; text-align: center;">
         <a href="${hostedInvoiceUrl}" style="display: inline-block; padding: 12px 22px; border-radius: 999px; background: #dc2626; color: #ffffff; text-decoration: none; font-weight: 600;">Pay invoice</a>
       </div>`
    : '';
  
  const html = renderEmailTemplate('Access Paused', summaryLines, detailItems, invoiceLinkBlock, {
    intent: 'critical',
    highlightLabel: 'Status',
    highlightValue: 'Access paused',
    highlightSupportingText: 'No grace period applies. Settle the invoice to restore POSPal immediately.',
    badgeText: 'Billing Alert'
  });
  
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
  const daysLabel = daysLeft === 1 ? '1 day' : `${daysLeft} days`;
  const summaryLines = [
    `Hi ${customerName}, your POSPal subscription renews in ${daysLeft} days.`
  ];
  const detailItems = [
    { label: 'Plan', value: 'POSPal Pro Monthly' },
    { label: 'Renewal window', value: `${daysLeft} days remaining` },
    { label: 'Status', value: 'active' }
  ];
  
  const html = renderEmailTemplate('Renewal Reminder', summaryLines, detailItems, '', {
    intent: 'warning',
    highlightLabel: 'Renews in',
    highlightValue: daysLabel,
    highlightSupportingText: 'Your plan will auto-renew unless you make changes before the date above.',
    badgeText: 'Billing Reminder'
  });
  
  return { subject, html };
}

/**
 * Immediate reactivation email template - NO GRACE PERIOD POLICY
 */
export function getImmediateReactivationEmailTemplate(customerName) {
  const subject = 'POSPal Reactivated';
  const summaryLines = [
    `Hi ${customerName}, your payment cleared and POSPal is active again.`
  ];
  const detailItems = [
    { label: 'Status', value: 'active' },
    { label: 'Next steps', value: 'no action needed' }
  ];
  
  const html = renderEmailTemplate('Access Restored', summaryLines, detailItems, '', {
    intent: 'success',
    highlightLabel: 'Status',
    highlightValue: 'Access restored',
    highlightSupportingText: 'You can continue using POSPal without interruption.',
    badgeText: 'Billing Update'
  });
  
  return { subject, html };
}

/**
 * Renewal processed receipt (for on-time renewals)
 */
export function getRenewalProcessedEmailTemplate(customerName, amountCents = null, currency = 'eur', periodEnd = null) {
  const subject = 'POSPal Renewal Confirmed';
  const amountLine = Number.isFinite(amountCents)
    ? `${(amountCents / 100).toFixed(2)} ${String(currency || '').toUpperCase()}`
    : 'your plan';
  const renewalDate = periodEnd ? new Date(periodEnd).toDateString() : null;

  const summaryLines = [
    `Hi ${customerName}, your POSPal subscription renewed successfully.`
  ];
  const detailItems = [
    { label: 'Plan charge', value: amountLine },
    renewalDate ? { label: 'Current period ends', value: renewalDate } : null,
    { label: 'Status', value: 'licensed_active' }
  ];

  const highlightValue = amountLine === 'your plan' ? 'Plan renewed' : amountLine;
  const html = renderEmailTemplate('Renewal Confirmed', summaryLines, detailItems, '', {
    intent: 'success',
    highlightLabel: 'Charge',
    highlightValue,
    highlightSupportingText: renewalDate ? `Current period ends ${renewalDate}.` : 'Your subscription stays active.',
    badgeText: 'Billing Update'
  });
  return { subject, html };
}

/**
 * License key recovery email template
 */
export function getLicenseRecoveryEmailTemplate(customerName, unlockToken, customerEmail) {
  const subject = 'Your POSPal Unlock Token';
  
  const summaryLines = [
    `Hi ${customerName}, here is the unlock token linked to ${customerEmail}.`
  ];
  const detailItems = [
    { label: 'Account email', value: customerEmail },
    { label: 'Note', value: 'token works on one computer at a time' }
  ];
  const tokenBlock = renderTokenBlock(unlockToken, 'Use this token to reinstall POSPal on your authorized device.');
  
  const html = renderEmailTemplate('License Recovery', summaryLines, detailItems, tokenBlock, {
    highlightLabel: 'Account',
    highlightValue: customerEmail,
    highlightSupportingText: 'The unlock token below works on one computer at a time.',
    badgeText: 'License Recovery'
  });
  
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
  
  const summaryLines = [
    `Hi ${customerName}, your POSPal license is now active on a different computer${deviceDetail ? ` (${deviceDetail})` : ''}.`
  ];
  const detailItems = [
    { label: 'Status', value: 'license moved to new device' },
    deviceDetail ? { label: 'Device info', value: deviceDetail } : null
  ];
  const extra = `
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 14px; margin-top: 12px;">
      <p style="color: #b91c1c; margin: 0;">If you didn't authorize this change, contact support@pospal.gr.</p>
    </div>
  `;
  
  const html = renderEmailTemplate('Computer Changed', summaryLines, detailItems, extra, {
    intent: 'warning',
    highlightLabel: 'Status',
    highlightValue: deviceDetail ? `License moved to ${deviceDetail}` : 'License moved to a new device',
    highlightSupportingText: 'If this was not you, contact support immediately to secure your account.',
    badgeText: 'Security Alert'
  });
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
  
  const summaryLines = [
    `Hi ${customerName}, your POSPal license was disconnected${deviceDetail ? ` from ${deviceDetail}` : ''}.`
  ];
  const detailItems = [
    { label: 'Account email', value: customerEmail },
    { label: 'Status', value: 'ready to activate elsewhere' }
  ];
  const tokenBlock = renderTokenBlock(unlockToken, "If you didn't request this, contact support@pospal.gr.");

  const html = renderEmailTemplate('License Disconnected', summaryLines, detailItems, tokenBlock, {
    highlightLabel: 'Status',
    highlightValue: 'Ready to activate elsewhere',
    highlightSupportingText: 'Use the token below to connect POSPal on your next device.',
    badgeText: 'License Update'
  });
  return { subject, html };
}

/**
 * Subscription cancelled email template
 */
export function getSubscriptionCancelledEmailTemplate(customerName, subscriptionId, periodEnd = null) {
  const subject = 'Your POSPal Subscription Has Been Cancelled';
  const periodEndText = periodEnd
    ? new Date(periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'the end of your current billing period';
  const greetingName = customerName || 'there';
  const subscriptionLine = subscriptionId
    ? `<p style="color: #9ca3af; margin: 24px 0 0 0; font-size: 14px;">Subscription ID: <span style="color: #111827;">${subscriptionId}</span></p>`
    : '';

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9" style="font-family: ${fontStack}; background: #f1f5f9; margin: 0;">
      <tr>
        <td align="center" style="padding: 56px 24px 56px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0; padding: 0; border-collapse: collapse;">
            <tr><td height="8" style="line-height: 8px; font-size: 0;">&nbsp;</td></tr>
          </table>
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background: #ffffff; border-radius: 32px;">
            <tr>
              <td style="padding: 0;">
                <div style="background: #ffffff; border-radius: 32px; padding: 40px 32px; box-shadow: 0 25px 45px rgba(15, 23, 42, 0.15);">
                <h1 style="font-size: 32px; line-height: 1.25; color: #0f172a; margin: 0 0 16px; text-align: center;">
                  Your subscription<br/>has been canceled
                </h1>
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin-bottom: 32px;"></div>

                <p style="color: #111827; font-size: 16px; margin: 0 0 24px; font-weight: 600;">Hi ${greetingName}, your subscription is active until</p>
                <div style="border-radius: 18px; border: 1px solid #d1fae5; background: #ecfdf5; padding: 20px 20px; margin-bottom: 28px;">
                  <p style="font-size: 26px; font-weight: 600; margin: 0; color: #064e3b;">${periodEndText}</p>
                </div>

                <p style="color: #374151; margin: 0 0 18px;">You can continue using POSPal normally until that date. Every menu, configuration, and report stays intact, and your unlock token still belongs to you.</p>
                <p style="color: #374151; margin: 0 0 18px;">If you change your mind, you can easily re-subscribe from within our app's licensing settings.</p>
                <p style="color: #374151; margin: 0;">If you didn't intend to cancel, reach out to us via <a href="mailto:support@pospal.gr" style="color: #0ea5e9; text-decoration: none;">support@pospal.gr</a>.</p>
                ${subscriptionLine}
                </div>
              </td>
            </tr>
          </table>

          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="margin-top: 32px; background: #050708; border-radius: 20px; padding: 32px 36px; color: #f9fafb;">
            <tr>
              <td>
                <p style="font-size: 18px; font-weight: 600; margin: 0 0 12px;">POSPal</p>
                <p style="color: #d1d5db; margin: 0 0 6px;">Need anything? We're around to help.</p>
                <p style="color: #9ca3af; margin: 0;">Email <a href="mailto:support@pospal.gr" style="color: #6ee7b7; text-decoration: none;">support@pospal.gr</a> or visit the Help Center.</p>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0; padding: 0; border-collapse: collapse;">
            <tr><td height="8" style="line-height: 8px; font-size: 0;">&nbsp;</td></tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return { subject, html };
}

/**
 * Cancellation reversal / renewal confirmation via portal
 */
export function getCancellationReversalEmailTemplate(customerName, periodEnd = null) {
  const subject = 'POSPal Subscription Reactivated';
  const periodEndText = periodEnd ? new Date(periodEnd).toDateString() : 'your current billing period';

  const summaryLines = [
    `Hi ${customerName}, the pending cancellation was removed and POSPal stays active.`
  ];
  const detailItems = [
    { label: 'Status', value: 'licensed_active' },
    { label: 'Current period ends', value: periodEndText }
  ];

  const html = renderEmailTemplate('Subscription Reactivated', summaryLines, detailItems, '', {
    intent: 'success',
    highlightLabel: 'Status',
    highlightValue: 'Subscription active',
    highlightSupportingText: `POSPal remains active through ${periodEndText}.`,
    badgeText: 'Billing Update'
  });
  return { subject, html };
}
