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
  const badgeBlock = badgeText
    ? `<div style="text-align: center; margin-bottom: 14px;">
         <span style="display: inline-flex; align-items: center; gap: 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: ${palette.badgeText}; background: ${palette.badgeBg}; border: 1px solid ${palette.badgeBorder}; border-radius: 999px; padding: 8px 14px;">
           ${badgeText}
           <img src="${pospalIconDataUri}" alt="POSPal" style="width: 18px; height: 18px; border-radius: 6px; border: 1px solid #e5e7eb;" />
         </span>
       </div>`
    : '';

  const safeSummary = summaryLines
    .filter(Boolean)
    .map(line => `<p style="color: #374151; margin: 0 0 16px 0; font-size: 16px;">${line}</p>`)
    .join('');
  const summarySection = safeSummary ? `<div style="margin: 0 0 12px 0;">${safeSummary}</div>` : '';

  const validDetails = (detailItems || []).filter(item => item && item.value !== undefined && item.value !== null && item.value !== '');
  const detailSection = validDetails.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0; border: 1px solid #e5e7eb; border-radius: 18px; overflow: hidden;">
        ${validDetails.map((item, index) => `
          <tr>
            <td style="padding: 12px 16px; border-bottom: ${index < validDetails.length - 1 ? '1px solid #f3f4f6' : 'none'}; color: #6b7280; font-size: 14px;">${item.label}</td>
            <td style="padding: 12px 16px; border-bottom: ${index < validDetails.length - 1 ? '1px solid #f3f4f6' : 'none'}; color: #111827; font-weight: 600; text-align: right; font-size: 14px;">${item.value}</td>
          </tr>
        `).join('')}
      </table>`
    : '';

  const highlightBlock = highlightValue
    ? `<div style="margin: 0 0 24px 0; border: 1px solid ${palette.highlightBorder}; background: ${palette.highlightBg}; border-radius: 18px; padding: 18px 20px;">
        ${highlightLabel ? `<p style="margin: 0 0 6px 0; color: ${palette.highlightLabel}; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;">${highlightLabel}</p>` : ''}
        <p style="margin: 0; font-size: 26px; font-weight: 700; color: ${palette.highlightValue};">${highlightValue}</p>
        ${highlightSupportingText ? `<p style="margin: 10px 0 0 0; color: #374151; font-size: 15px;">${highlightSupportingText}</p>` : ''}
      </div>`
    : '';

  const normalizedExtraContent = Array.isArray(extraContent)
    ? extraContent.filter(Boolean).join('')
    : (extraContent || '');

  const supportFooterContent = footerContent === null
    ? `<p style="font-size: 18px; font-weight: 600; margin: 0 0 12px;">POSPal</p>
         <p style="color: #d1d5db; margin: 0 0 6px;">Need anything? We're around to help.</p>
         <p style="color: #9ca3af; margin: 0;">Email <a href="mailto:support@pospal.gr" style="color: #6ee7b7; text-decoration: none;">support@pospal.gr</a> or visit the Help Center.</p>`
    : footerContent;

  const footerSection = supportFooterContent
    ? `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="margin-top: 32px; background: #050708; border-radius: 20px; padding: 32px 36px; color: #f9fafb;">
         <tr>
           <td>
             ${supportFooterContent}
           </td>
         </tr>
       </table>`
    : '';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9" style="font-family: ${fontStack}; background: #f1f5f9; margin: 0;">
      <tr>
        <td align="center" style="padding: 56px 24px 56px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0; padding: 0; border-collapse: collapse;">
            <tr><td height="8" style="line-height: 8px; font-size: 0;">&nbsp;</td></tr>
          </table>
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background: #ffffff; border-radius: 32px; box-shadow: 0 25px 45px rgba(15, 23, 42, 0.15);">
            <tr>
              <td style="padding: 40px 32px;">
                ${badgeBlock}
                <h1 style="font-size: 32px; line-height: 1.25; color: #0f172a; margin: 0; text-align: center;">${title}</h1>
                ${subtitle ? `<p style="color: #6b7280; margin: 12px 0 0 0; text-align: center;">${subtitle}</p>` : ''}
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin: 24px 0 24px 0;"></div>
                ${highlightBlock}
                ${summarySection}
                ${detailSection}
                ${normalizedExtraContent}
              </td>
            </tr>
          </table>
          ${footerSection}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0; padding: 0; border-collapse: collapse;">
            <tr><td height="8" style="line-height: 8px; font-size: 0;">&nbsp;</td></tr>
          </table>
        </td>
      </tr>
    </table>
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

function renderSubscriptionIdLine(subscriptionId) {
  if (!subscriptionId) {
    return '';
  }
  return `<p style="color: #9ca3af; margin: 24px 0 0 0; font-size: 14px;">Subscription ID: <span style="color: #111827;">${subscriptionId}</span></p>`;
}

/**
 * Welcome email with unlock token (sent after payment)
 */
export function getWelcomeEmailTemplate(customerName, unlockToken, customerEmail, subscriptionId = '') {
  const subject = 'Your POSPal License Details';
  const greetingName = customerName || 'there';
  const tokenBlock = renderTokenBlock(unlockToken, 'Keep this token safe. It works on one computer at a time.');
  const subscriptionLine = renderSubscriptionIdLine(subscriptionId);

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
                  Welcome to POSPal
                </h1>
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin-bottom: 32px;"></div>

                <p style="color: #111827; font-size: 16px; margin: 0 0 24px; font-weight: 600;">Hi ${greetingName}, your subscription status is</p>
                <div style="border-radius: 18px; border: 1px solid #d1fae5; background: #ecfdf5; padding: 20px 20px; margin-bottom: 28px;">
                  <p style="font-size: 26px; font-weight: 600; margin: 0; color: #064e3b;">Active</p>
                </div>

                <p style="color: #374151; margin: 0 0 18px;">POSPal is unlocked for ${customerEmail}. Keep this email handy so you can reinstall or move devices whenever you need.</p>
                <p style="color: #374151; margin: 0 0 18px;">Enter the unlock token on the computer that will host POSPal. All menus, reports, and data stay tethered to that machine.</p>
                ${tokenBlock}
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
 * Immediate suspension email template - NO GRACE PERIOD POLICY
 */
export function getImmediateSuspensionEmailTemplate(customerName, invoiceDetails = {}, subscriptionId = '') {
  const subject = 'Payment Failed - POSPal Access Paused';
  const { amountDueCents, currency, dueDate, hostedInvoiceUrl } = invoiceDetails || {};
  const amountLine = Number.isFinite(amountDueCents)
    ? `${(amountDueCents / 100).toFixed(2)} ${String(currency || '').toUpperCase() || 'EUR'}`
    : null;
  const dueDateText = dueDate ? new Date(dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
  const subscriptionLine = renderSubscriptionIdLine(subscriptionId);
  const amountSummary = amountLine ? `The attempted charge was ${amountLine}. ` : '';
  const attemptSummary = dueDateText ? `Last attempt: ${dueDateText}.` : '';
  const hostedPortalLine = hostedInvoiceUrl
    ? `You can also review the invoice here: <a href="${hostedInvoiceUrl}" style="color: #0ea5e9; text-decoration: none;">invoice link</a>.`
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
                  Your subscription<br/>is paused
                </h1>
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin-bottom: 32px;"></div>

                <p style="color: #111827; font-size: 16px; margin: 0 0 24px; font-weight: 600;">Hi ${customerName}, your subscription status is</p>
                <div style="border-radius: 18px; border: 1px solid #fecdd3; background: #fef2f2; padding: 20px 20px; margin-bottom: 28px;">
                  <p style="font-size: 26px; font-weight: 600; margin: 0; color: #b91c1c;">Access paused</p>
                </div>

                <p style="color: #374151; margin: 0 0 18px;">There’s no grace period on this plan, so POSPal stays paused until the invoice is settled.</p>
                <p style="color: #374151; margin: 0 0 24px;">Menus and data stay intact. Access resumes automatically as soon as payment succeeds.</p>
                <p style="color: #374151; margin: 0 0 18px;">${amountSummary}${attemptSummary}</p>
                <p style="color: #374151; margin: 0 0 18px;">Open POSPal and head to <strong>Settings → Licensing</strong> to update your card or pay via the Stripe portal.</p>
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
 * DEPRECATED: Old payment failure email template with grace period language
 * This is replaced by getImmediateSuspensionEmailTemplate for the no-grace-period policy
 */
export function getPaymentFailureEmailTemplate(customerName, subscriptionId = '') {
  // This function is kept for backward compatibility but should not be used
  // Use getImmediateSuspensionEmailTemplate instead
  console.warn('DEPRECATED: Use getImmediateSuspensionEmailTemplate instead of getPaymentFailureEmailTemplate');
  return getImmediateSuspensionEmailTemplate(customerName, {}, subscriptionId);
}

/**
 * Renewal reminder email template
 */
export function getRenewalReminderEmailTemplate(customerName, daysLeft, subscriptionId = '') {
  const subject = `POSPal Renewal - ${daysLeft} days remaining`;
  const daysLabel = daysLeft === 1 ? '1 day' : `${daysLeft} days`;
  const greetingName = customerName || 'there';
  const subscriptionLine = renderSubscriptionIdLine(subscriptionId);

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
                  Renewal reminder
                </h1>
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin-bottom: 32px;"></div>

                <p style="color: #111827; font-size: 16px; margin: 0 0 24px; font-weight: 600;">Hi ${greetingName}, your subscription renews soon.</p>
                <div style="border-radius: 18px; border: 1px solid #fcd34d; background: #fffbeb; padding: 20px 20px; margin-bottom: 28px;">
                  <p style="font-size: 26px; font-weight: 600; margin: 0; color: #92400e;">Renews in ${daysLabel}</p>
                </div>

                <p style="color: #374151; margin: 0 0 18px;">No action is needed unless you plan to pause. Billing will run automatically at the end of this window.</p>
                <p style="color: #374151; margin: 0 0 24px;">Want to make changes? Open POSPal and head to <strong>Settings → Licensing</strong> before renewal day.</p>

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
 * Immediate reactivation email template - NO GRACE PERIOD POLICY
 */
export function getImmediateReactivationEmailTemplate(customerName, subscriptionId = '', periodEnd = null) {
  const subject = 'POSPal Reactivated';
  const greetingName = customerName || 'there';
  const periodEndText = periodEnd
    ? new Date(periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const reactivatedDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const subscriptionLine = renderSubscriptionIdLine(subscriptionId);
  const detailRows = [
    { label: 'Status', value: 'licensed_active' },
    { label: 'Reactivated on', value: reactivatedDate },
    periodEndText ? { label: 'Current period ends', value: periodEndText } : null
  ].filter(Boolean);

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
                  Your subscription<br/>is active again
                </h1>
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin-bottom: 32px;"></div>

                <p style="color: #111827; font-size: 16px; margin: 0 0 24px; font-weight: 600;">Hi ${greetingName}, your subscription status is</p>
                <div style="border-radius: 18px; border: 1px solid #d1fae5; background: #ecfdf5; padding: 20px 20px; margin-bottom: 28px;">
                  <p style="font-size: 26px; font-weight: 600; margin: 0; color: #065f46;">Subscription active</p>
                </div>

                <p style="color: #374151; margin: 0 0 18px;">Thank you for settling the invoice. POSPal is unlocked again—everything you configured stays intact.</p>
                <p style="color: #374151; margin: 0 0 24px;">Need to review billing later? Open POSPal and head to <strong>Settings → Licensing</strong>.</p>

                ${detailRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0; border: 1px solid #a7f3d0; border-radius: 18px;">
                  ${detailRows.map(row => `
                    <tr>
                      <td style="padding: 12px 16px; color: #6b7280; font-size: 14px;">${row.label}</td>
                      <td style="padding: 12px 16px; color: #0f172a; font-weight: 600; text-align: right; font-size: 14px;">${row.value}</td>
                    </tr>
                  `).join('')}
                </table>` : ''}
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
 * Renewal processed receipt (for on-time renewals)
 */
export function getRenewalProcessedEmailTemplate(customerName, amountCents = null, currency = 'eur', periodEnd = null, subscriptionId = '') {
  const subject = 'POSPal Renewal Confirmed';
  const greetingName = customerName || 'there';
  const amountLine = Number.isFinite(amountCents)
    ? `${(amountCents / 100).toFixed(2)} ${String(currency || '').toUpperCase()}`
    : 'Plan renewed';
  const periodEndText = periodEnd
    ? new Date(periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const subscriptionLine = renderSubscriptionIdLine(subscriptionId);
  const periodSentence = periodEndText
    ? `<p style="color: #374151; margin: 0 0 18px;">Your current period runs through <strong>${periodEndText}</strong>.</p>`
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
                  Renewal confirmed
                </h1>
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin-bottom: 32px;"></div>

                <p style="color: #111827; font-size: 16px; margin: 0 0 24px; font-weight: 600;">Hi ${greetingName}, your POSPal subscription renewed successfully.</p>
                <div style="border-radius: 18px; border: 1px solid #a7f3d0; background: #ecfdf5; padding: 20px 20px; margin-bottom: 28px;">
                  <p style="font-size: 26px; font-weight: 600; margin: 0; color: #047857;">${amountLine}</p>
                </div>

                <p style="color: #374151; margin: 0 0 18px;">No action needed—POSPal stays active, and your menus, reports, and data carry on uninterrupted.</p>
                <p style="color: #374151; margin: 0 0 24px;">Want to review billing? Open POSPal and head to <strong>Settings → Licensing</strong>.</p>

                ${periodSentence}
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
 * License key recovery email template
 */
export function getLicenseRecoveryEmailTemplate(customerName, unlockToken, customerEmail, subscriptionId = '') {
  const subject = 'Your POSPal Unlock Token';
  const greetingName = customerName || 'there';
  const subscriptionLine = renderSubscriptionIdLine(subscriptionId);
  const tokenBlock = renderTokenBlock(unlockToken, 'Use this token to reinstall POSPal on your authorized device.');
  
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
                  License recovery
                </h1>
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin-bottom: 32px;"></div>

                <p style="color: #111827; font-size: 16px; margin: 0 0 24px; font-weight: 600;">Hi ${greetingName}, here’s the unlock token linked to ${customerEmail}.</p>
                <div style="border-radius: 18px; border: 1px solid #d1fae5; background: #ecfdf5; padding: 20px 20px; margin-bottom: 28px;">
                  <p style="font-size: 26px; font-weight: 600; margin: 0; color: #065f46;">Use on one computer at a time</p>
                </div>

                ${tokenBlock}
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
 * Machine switch notification email
 */
export function getMachineSwitchEmailTemplate(customerName, newMachineInfo = null, subscriptionId = '') {
  const subject = 'POSPal - Computer Changed';
  const greetingName = customerName || 'there';
  const subscriptionLine = renderSubscriptionIdLine(subscriptionId);

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
                  License moved to a new computer
                </h1>
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin-bottom: 32px;"></div>

                <p style="color: #111827; font-size: 16px; margin: 0 0 24px; font-weight: 600;">Hi ${greetingName}, your POSPal license is now active on a different device.</p>
                <div style="border-radius: 18px; border: 1px solid #fecaca; background: #fef2f2; padding: 20px 20px; margin-bottom: 28px;">
                  <p style="font-size: 26px; font-weight: 600; margin: 0; color: #b91c1c;">Security alert</p>
                </div>

                <p style="color: #374151; margin: 0 0 18px;">If you moved POSPal, no action is needed. Licenses only run on one computer at a time.</p>
                <p style="color: #374151; margin: 0 0 24px;">If this wasn’t you, email <a href="mailto:support@pospal.gr" style="color: #b91c1c; text-decoration: none; font-weight: 600;">support@pospal.gr</a> immediately so we can secure your account.</p>

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
 * License disconnection confirmation email template
 */
export function getLicenseDisconnectionEmailTemplate(customerName, unlockToken, customerEmail, deviceInfo = {}, subscriptionId = '') {
  const subject = 'POSPal License Disconnected from Device';
  const deviceDetail = deviceInfo && typeof deviceInfo === 'object'
    ? (deviceInfo.hostname || deviceInfo.current || deviceInfo.deviceName || null)
    : null;
  
  const greetingName = customerName || 'there';
  const subscriptionLine = renderSubscriptionIdLine(subscriptionId);
  const tokenBlock = renderTokenBlock(unlockToken, "If you didn't request this, contact support@pospal.gr.");

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9" style="font-family: ${fontStack}; background: #f1f5f9; margin: 0;">
      <tr>
        <td align="center" style="padding: 56px 24px 56px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0; padding: 0; border-collapse: collapse;">
            <tr><td height="8" style="line-height: 8px; font-size: 0;">&nbsp;</td></tr>
          </table>
          <table role="presentation" width 560 cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background: #ffffff; border-radius: 32px;">
            <tr>
              <td style="padding: 0;">
                <div style="background: #ffffff; border-radius: 32px; padding: 40px 32px; box-shadow: 0 25px 45px rgba(15, 23, 42, 0.15);">
                <h1 style="font-size: 32px; line-height: 1.25; color: #0f172a; margin: 0 0 16px; text-align: center;">
                  License disconnected
                </h1>
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin-bottom: 32px;"></div>

                <p style="color: #111827; font-size: 16px; margin: 0 0 24px; font-weight: 600;">Hi ${greetingName}, your POSPal license was disconnected${deviceDetail ? ` from ${deviceDetail}` : ''}.</p>
                <div style="border-radius: 18px; border: 1px solid #d1fae5; background: #ecfdf5; padding: 20px 20px; margin-bottom: 28px;">
                  <p style="font-size: 26px; font-weight: 600; margin: 0; color: #065f46;">Ready to activate elsewhere</p>
                </div>

                <p style="color: #374151; margin: 0 0 18px;">Use the unlock token below to connect POSPal on your next device.</p>
                <p style="color: #374151; margin: 0 0 24px;">If you didn’t make this change, email <a href="mailto:support@pospal.gr" style="color: #0ea5e9; text-decoration: none;">support@pospal.gr</a> so we can secure your account.</p>

                ${tokenBlock}
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
 * Subscription cancelled email template
 */
export function getSubscriptionCancelledEmailTemplate(customerName, subscriptionId, periodEnd = null) {
  const subject = 'Your POSPal Subscription Has Been Cancelled';
  const periodEndText = periodEnd
    ? new Date(periodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'the end of your current billing period';
  const greetingName = customerName || 'there';
  const subscriptionLine = renderSubscriptionIdLine(subscriptionId);

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
export function getCancellationReversalEmailTemplate(customerName, periodEnd = null, subscriptionId = '') {
  const subject = 'POSPal Subscription Reactivated';
  const greetingName = customerName || 'there';
  const statusValue = 'Active';
  const subscriptionLine = renderSubscriptionIdLine(subscriptionId);

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
                  Your subscription<br/>is active again
                </h1>
                <div style="width: 100%; height: 1px; background: #e5e7eb; margin-bottom: 32px;"></div>

                <p style="color: #111827; font-size: 16px; margin: 0 0 24px; font-weight: 600;">Hi ${greetingName}, your subscription status is</p>
                <div style="border-radius: 18px; border: 1px solid #d1fae5; background: #ecfdf5; padding: 20px 20px; margin-bottom: 28px;">
                  <p style="font-size: 26px; font-weight: 600; margin: 0; color: #064e3b;">${statusValue}</p>
                </div>

                <p style="color: #374151; margin: 0 0 18px;">Welcome back to POSPal, and thank you for staying with us. Your subscription is fully active again.</p>
                <p style="color: #374151; margin: 0 0 18px;">If you ever feel like taking a break, navigate to POSPal’s in app licensing settings at any time.</p>
                <p style="color: #374151; margin: 0;">Have questions or need a hand? Email <a href="mailto:support@pospal.gr" style="color: #0ea5e9; text-decoration: none;">support@pospal.gr</a> and we’ll help right away.</p>
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
