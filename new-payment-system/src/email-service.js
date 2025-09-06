/**
 * POSPal Licensing System v2.0 - Email Service
 * Handles all customer email communications via Resend
 */

/**
 * Send welcome email to new customers
 */
export async function sendWelcomeEmail(env, customerId, email, name, verifyToken) {
  const subject = 'Καλώς ήρθες στο POSPal! Επιβεβαίωσε το email σου';
  const html = generateWelcomeEmailHTML(name, verifyToken, env.ENVIRONMENT);
  
  return await sendEmail(env, {
    customerId,
    emailType: 'welcome',
    to: email,
    subject,
    html
  });
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(env, customerId, email, name, resetToken) {
  const subject = 'POSPal - Επαναφορά Κωδικού Πρόσβασης';
  const html = generatePasswordResetHTML(name, resetToken, env.ENVIRONMENT);
  
  return await sendEmail(env, {
    customerId,
    emailType: 'password_reset',
    to: email,
    subject,
    html
  });
}

/**
 * Send payment failure notification
 */
export async function sendPaymentFailureEmail(env, customerId, email, name, gracePeriodEnd) {
  const subject = 'POSPal - Πρόβλημα με την πληρωμή';
  const html = generatePaymentFailureHTML(name, gracePeriodEnd);
  
  return await sendEmail(env, {
    customerId,
    emailType: 'payment_failed',
    to: email,
    subject,
    html
  });
}

/**
 * Send grace period warning
 */
export async function sendGracePeriodEmail(env, customerId, email, name, daysLeft) {
  const subject = `POSPal - Η πρόσβαση λήγει σε ${daysLeft} ημέρες`;
  const html = generateGracePeriodHTML(name, daysLeft);
  
  return await sendEmail(env, {
    customerId,
    emailType: 'grace_period',
    to: email,
    subject,
    html
  });
}

/**
 * Send session takeover notification
 */
export async function sendSessionTakeoverEmail(env, customerId, email, name, deviceInfo) {
  const subject = 'POSPal - Νέα σύνδεση στον λογαριασμό σας';
  const html = generateSessionTakeoverHTML(name, deviceInfo);
  
  return await sendEmail(env, {
    customerId,
    emailType: 'security_alert',
    to: email,
    subject,
    html
  });
}

/**
 * Core email sending function
 */
async function sendEmail(env, { customerId, emailType, to, subject, html }) {
  try {
    // Log email attempt
    const emailLogId = await logEmailDelivery(env.DB, customerId, emailType, to, subject);
    
    // Send via Resend
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'POSPal <noreply@resend.dev>',
        to: [to],
        subject: subject,
        html: html,
      }),
    });
    
    if (response.ok) {
      const result = await response.json();
      await updateEmailStatus(env.DB, emailLogId, 'delivered', null, result.id);
      console.log(`Email sent to ${to}, Resend ID: ${result.id}`);
      return { success: true, messageId: result.id };
    } else {
      const error = await response.text();
      await updateEmailStatus(env.DB, emailLogId, 'failed', error);
      console.error(`Failed to send email to ${to}:`, error);
      return { success: false, error };
    }
    
  } catch (error) {
    console.error('Email service error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Log email delivery attempt
 */
async function logEmailDelivery(db, customerId, emailType, recipientEmail, subject) {
  const result = await db.prepare(`
    INSERT INTO email_log 
    (customer_id, email_type, recipient_email, subject, delivery_status, created_at)
    VALUES (?, ?, ?, ?, 'pending', datetime('now'))
  `).bind(customerId, emailType, recipientEmail, subject).run();
  
  return result.meta.last_row_id;
}

/**
 * Update email delivery status
 */
async function updateEmailStatus(db, emailLogId, status, errorMessage = null, providerId = null) {
  await db.prepare(`
    UPDATE email_log 
    SET delivery_status = ?, error_message = ?, provider_id = ?, 
        delivered_at = CASE WHEN ? = 'delivered' THEN datetime('now') ELSE delivered_at END
    WHERE id = ?
  `).bind(status, errorMessage, providerId, status, emailLogId).run();
}

/**
 * Generate welcome email HTML
 */
function generateWelcomeEmailHTML(name, verifyToken, environment) {
  const baseUrl = environment === 'production' 
    ? 'https://license.pospal.gr' 
    : 'https://license-dev.pospal.gr';
    
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #059669; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #059669; margin: 0;">Καλώς ήρθες στο POSPal!</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Το επαγγελματικό σύστημα POS για εστιατόρια</p>
      </div>
      
      <div style="background: #f0fdf4; border: 1px solid #059669; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #047857; margin: 0 0 15px 0;">Γεια σου ${name}! 👋</h2>
        <p style="margin: 0; color: #374151;">Ο λογαριασμός σου δημιουργήθηκε επιτυχώς. Για να ολοκληρώσεις την εγγραφή, επιβεβαίωσε το email σου κάνοντας κλικ παρακάτω:</p>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${baseUrl}/auth/verify?token=${verifyToken}" 
           style="background: #059669; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
          ✅ Επιβεβαίωση Email
        </a>
      </div>
      
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="color: #1d4ed8; margin: 0 0 15px 0;">Τι γίνεται μετά;</h3>
        <ol style="color: #1e40af; line-height: 1.8; padding-left: 20px;">
          <li>Επιβεβαίωσε το email σου (κλικ πάνω)</li>
          <li>Κατέβασε το POSPal από το site μας</li>
          <li>Άνοιξε το POSPal και συνδέσου με αυτό το email</li>
          <li>Απόλαυσε 30 ημέρες δωρεάν δοκιμή!</li>
          <li>Μετά από 30 ημέρες, μόνο €20/μήνα</li>
        </ol>
      </div>
      
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
        <p style="color: #92400e; margin: 0; text-align: center;">
          <strong>Χρειάζεσαι βοήθεια;</strong> Στείλε email στο 
          <a href="mailto:support@pospal.gr" style="color: #92400e;">support@pospal.gr</a>
        </p>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          Με εκτίμηση,<br>
          Η ομάδα του POSPal<br>
          <a href="https://pospal.gr" style="color: #059669;">pospal.gr</a>
        </p>
      </div>
    </div>
  `;
}

/**
 * Generate password reset email HTML
 */
function generatePasswordResetHTML(name, resetToken, environment) {
  const baseUrl = environment === 'production' 
    ? 'https://license.pospal.gr' 
    : 'https://license-dev.pospal.gr';
    
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #ef4444; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #ef4444; margin: 0;">Επαναφορά Κωδικού</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">POSPal Account Recovery</p>
      </div>
      
      <div style="background: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #dc2626; margin: 0 0 15px 0;">Γεια σου ${name},</h2>
        <p style="margin: 0; color: #374151;">Παραλάβαμε αίτημα για επαναφορά του κωδικού πρόσβασης για τον λογαριασμό σου στο POSPal.</p>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${baseUrl}/auth/reset?token=${resetToken}" 
           style="background: #ef4444; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
          🔑 Επαναφορά Κωδικού
        </a>
      </div>
      
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="color: #92400e; margin: 0 0 15px 0;">⚠️ Σημαντικό</h3>
        <ul style="color: #92400e; line-height: 1.6; padding-left: 20px; margin: 0;">
          <li>Αυτός ο σύνδεσμος λήγει σε 1 ώρα</li>
          <li>Χρησιμοποίησε τον μόνο μια φορά</li>
          <li>Αν δεν ζήτησες εσύ αυτήν την επαναφορά, αγνόησε αυτό το email</li>
        </ul>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          Ασφάλεια & Υποστήριξη<br>
          <a href="mailto:support@pospal.gr" style="color: #059669;">support@pospal.gr</a>
        </p>
      </div>
    </div>
  `;
}

/**
 * Generate payment failure email HTML
 */
function generatePaymentFailureHTML(name, gracePeriodEnd) {
  const endDate = new Date(gracePeriodEnd).toLocaleDateString('el-GR');
  
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #f59e0b; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #f59e0b; margin: 0;">Πρόβλημα με την Πληρωμή</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">POSPal Subscription Issue</p>
      </div>
      
      <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 25px; margin: 20px 0;">
        <h2 style="color: #92400e; margin: 0 0 15px 0;">Γεια σου ${name},</h2>
        <p style="color: #92400e; margin: 0 0 15px 0;">
          Δυστυχώς, δεν μπορέσαμε να επεξεργαστούμε την πληρωμή για τη συνδρομή σου στο POSPal.
        </p>
        <p style="color: #92400e; margin: 0; font-weight: bold;">
          🛡️ Καμία ανησυχία - έχεις χρόνο μέχρι ${endDate} να διορθώσεις το θέμα.
        </p>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://billing.stripe.com/p/login/" 
           style="background: #059669; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; margin: 10px;">
          💳 Ενημέρωση Πληρωμής
        </a>
        <br>
        <a href="mailto:support@pospal.gr" 
           style="background: #6b7280; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; margin: 10px;">
          📧 Επικοινωνία
        </a>
      </div>
      
      <div style="background: #f0fdf4; border: 1px solid #059669; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="color: #047857; margin: 0 0 15px 0;">Συνήθη αίτια:</h3>
        <ul style="color: #065f46; line-height: 1.6; padding-left: 20px; margin: 0;">
          <li>Κάρτα με λήξη ημερομηνία</li>
          <li>Ανεπαρκή κεφάλαια</li>
          <li>Αλλαγή στοιχείων τραπέζης</li>
          <li>Περιορισμοί από την τράπεζα</li>
        </ul>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          Εδώ για να βοηθήσουμε!<br>
          Ομάδα POSPal • <a href="mailto:support@pospal.gr" style="color: #059669;">support@pospal.gr</a>
        </p>
      </div>
    </div>
  `;
}

/**
 * Generate grace period warning email HTML  
 */
function generateGracePeriodHTML(name, daysLeft) {
  const urgencyColor = daysLeft <= 2 ? '#ef4444' : '#f59e0b';
  const urgencyEmoji = daysLeft <= 2 ? '🚨' : '⚠️';
  
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid ${urgencyColor}; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: ${urgencyColor}; margin: 0;">${urgencyEmoji} Η πρόσβαση λήγει σύντομα</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">POSPal Access Warning</p>
      </div>
      
      <div style="background: #fef2f2; border: 2px solid ${urgencyColor}; border-radius: 8px; padding: 25px; margin: 20px 0; text-align: center;">
        <h2 style="color: #dc2626; margin: 0 0 15px 0;">Γεια σου ${name},</h2>
        <div style="font-size: 48px; font-weight: bold; color: ${urgencyColor}; margin: 20px 0;">
          ${daysLeft}
        </div>
        <p style="color: #dc2626; margin: 0; font-size: 18px; font-weight: bold;">
          ημέρες απομένουν για πρόσβαση στο POSPal
        </p>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://billing.stripe.com/p/login/" 
           style="background: #059669; color: white; padding: 18px 36px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 18px;">
          💳 Ανανέωση Τώρα
        </a>
      </div>
      
      <div style="background: #f0fdf4; border: 1px solid #059669; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="color: #047857; margin: 0 0 15px 0; text-align: center;">Τι συμβαίνει;</h3>
        <p style="color: #065f46; margin: 0; text-align: center;">
          Η συνδρομή σου έχει πρόβλημα πληρωμής, αλλά σου δίνουμε χρόνο χάριτος.
          Μετά από ${daysLeft} ημέρες, το POSPal θα κλειδώσει μέχρι να ανανεώσεις.
        </p>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          Χρειάζεσαι βοήθεια; <a href="mailto:support@pospal.gr" style="color: #059669;">support@pospal.gr</a><br>
          Ομάδα POSPal
        </p>
      </div>
    </div>
  `;
}

/**
 * Generate session takeover notification HTML
 */
function generateSessionTakeoverHTML(name, deviceInfo) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #3b82f6; margin: 0;">🔐 Νέα Σύνδεση</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">POSPal Security Notification</p>
      </div>
      
      <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #1d4ed8; margin: 0 0 15px 0;">Γεια σου ${name},</h2>
        <p style="color: #1e40af; margin: 0;">
          Κάποιος συνδέθηκε στον λογαριασμό σου από νέα συσκευή και ανέλαβε τη συνεδρία σου.
        </p>
      </div>
      
      <div style="background: #f8f9fa; border: 1px solid #d1d5db; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="color: #374151; margin: 0 0 15px 0;">Στοιχεία Σύνδεσης:</h3>
        <ul style="color: #6b7280; line-height: 1.6; padding-left: 20px; margin: 0;">
          <li><strong>Ώρα:</strong> ${new Date().toLocaleString('el-GR')}</li>
          <li><strong>Συσκευή:</strong> ${deviceInfo.os || 'Άγνωστη'}</li>
          <li><strong>Εφαρμογή:</strong> POSPal v${deviceInfo.appVersion || '2.0'}</li>
        </ul>
      </div>
      
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="color: #92400e; margin: 0 0 15px 0;">Ήσουν εσύ;</h3>
        <p style="color: #92400e; margin: 0;">
          Αν δεν ήσουν εσύ, παρακαλούμε άλλαξε τον κωδικό σου αμέσως και επικοινώνησε μαζί μας.
        </p>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="mailto:support@pospal.gr" 
           style="background: #ef4444; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
          🚨 Αναφορά Προβλήματος
        </a>
      </div>
      
      <div style="text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
        <p style="color: #9ca3af; font-size: 14px; margin: 0;">
          Ασφάλεια Λογαριασμού<br>
          Ομάδα POSPal • <a href="mailto:support@pospal.gr" style="color: #059669;">support@pospal.gr</a>
        </p>
      </div>
    </div>
  `;
}