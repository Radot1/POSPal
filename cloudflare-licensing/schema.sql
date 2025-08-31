-- POSPal Subscription Database Schema
-- Run this with: wrangler d1 execute pospal-subscriptions --file=schema.sql

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  stripe_customer_id TEXT,
  stripe_session_id TEXT,
  unlock_token TEXT UNIQUE NOT NULL,
  machine_fingerprint TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'cancelled'
  subscription_id TEXT, -- Stripe subscription ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_validation DATETIME,
  payment_failures INTEGER DEFAULT 0
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_token ON customers(unlock_token);
CREATE INDEX IF NOT EXISTS idx_customers_session ON customers(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_customers_machine ON customers(machine_fingerprint);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(subscription_status);

-- Audit log for machine switches and validation attempts
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'validation', 'machine_switch', 'payment_success', 'payment_failed'
  old_machine_fingerprint TEXT,
  new_machine_fingerprint TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT, -- JSON string for additional data
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_customer ON audit_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- Email delivery log
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  email_type TEXT NOT NULL, -- 'welcome', 'payment_success', 'payment_failed', 'renewal_reminder'
  recipient_email TEXT NOT NULL,
  subject TEXT,
  delivery_status TEXT DEFAULT 'pending', -- 'pending', 'delivered', 'failed'
  resend_id TEXT, -- Resend.com message ID
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_email_customer ON email_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_email_status ON email_log(delivery_status);
CREATE INDEX IF NOT EXISTS idx_email_type ON email_log(email_type);