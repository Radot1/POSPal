-- POSPal Complete Database Schema
-- This file combines all schema components for production deployment
-- Run with: wrangler d1 execute pospal-subscriptions --file=complete-schema.sql --env production

-- ==============================================
-- CORE CUSTOMERS TABLE
-- ==============================================
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  stripe_customer_id TEXT,
  stripe_session_id TEXT,
  unlock_token TEXT UNIQUE NOT NULL,
  machine_fingerprint TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'inactive', 'cancelled')),
  subscription_id TEXT, -- Stripe subscription ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_validation DATETIME,
  payment_failures INTEGER DEFAULT 0
);

-- Indexes for customers table (critical for performance)
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_token ON customers(unlock_token);
CREATE INDEX IF NOT EXISTS idx_customers_session ON customers(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_customers_machine ON customers(machine_fingerprint);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(subscription_status);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at);
CREATE INDEX IF NOT EXISTS idx_customers_last_seen ON customers(last_seen);

-- ==============================================
-- AUDIT LOG TABLE
-- ==============================================
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('validation', 'machine_switch', 'payment_success', 'payment_failed', 'session_start', 'session_end', 'login_attempt')),
  old_machine_fingerprint TEXT,
  new_machine_fingerprint TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT, -- JSON string for additional data
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Indexes for audit log
CREATE INDEX IF NOT EXISTS idx_audit_customer ON audit_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_customer_action ON audit_log(customer_id, action);

-- ==============================================
-- EMAIL LOG TABLE
-- ==============================================
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  email_type TEXT NOT NULL CHECK (email_type IN ('welcome', 'payment_success', 'payment_failed', 'renewal_reminder', 'machine_switch', 'refund_processed')),
  recipient_email TEXT NOT NULL,
  subject TEXT,
  delivery_status TEXT DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered', 'failed', 'bounced')),
  resend_id TEXT, -- Resend.com message ID
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Indexes for email log
CREATE INDEX IF NOT EXISTS idx_email_customer ON email_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_email_status ON email_log(delivery_status);
CREATE INDEX IF NOT EXISTS idx_email_type ON email_log(email_type);
CREATE INDEX IF NOT EXISTS idx_email_created_at ON email_log(created_at);

-- ==============================================
-- ACTIVE SESSIONS TABLE
-- ==============================================
CREATE TABLE IF NOT EXISTS active_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    session_id TEXT NOT NULL UNIQUE,
    machine_fingerprint TEXT NOT NULL,
    device_info TEXT, -- JSON string with device details
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'kicked')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Indexes for sessions
CREATE INDEX IF NOT EXISTS idx_active_sessions_customer_status ON active_sessions(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_active_sessions_session_id ON active_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_heartbeat ON active_sessions(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_active_sessions_machine ON active_sessions(machine_fingerprint);

-- ==============================================
-- REFUND REQUESTS TABLE
-- ==============================================
CREATE TABLE IF NOT EXISTS refund_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    invoice_id TEXT,
    reason TEXT NOT NULL,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processed')),
    refund_amount INTEGER, -- in cents
    stripe_refund_id TEXT,
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Indexes for refund requests
CREATE INDEX IF NOT EXISTS idx_refund_requests_customer_id ON refund_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status);
CREATE INDEX IF NOT EXISTS idx_refund_requests_created_at ON refund_requests(created_at);

-- ==============================================
-- ADDITIONAL PERFORMANCE INDEXES
-- ==============================================

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_customers_status_created ON customers(subscription_status, created_at);
CREATE INDEX IF NOT EXISTS idx_customers_last_validation ON customers(last_validation) WHERE last_validation IS NOT NULL;

-- Audit log performance indexes
CREATE INDEX IF NOT EXISTS idx_audit_recent ON audit_log(created_at DESC) WHERE created_at > datetime('now', '-30 days');

-- Session cleanup index
CREATE INDEX IF NOT EXISTS idx_sessions_cleanup ON active_sessions(last_heartbeat) WHERE status = 'active';

-- ==============================================
-- DATABASE INTEGRITY CONSTRAINTS
-- ==============================================

-- Trigger to update last_seen when customers table is updated
CREATE TRIGGER IF NOT EXISTS update_customer_last_seen
  AFTER UPDATE ON customers
  FOR EACH ROW
BEGIN
  UPDATE customers 
  SET last_seen = CURRENT_TIMESTAMP 
  WHERE id = NEW.id AND NEW.last_validation IS NOT NULL;
END;

-- Trigger to update refund_requests updated_at
CREATE TRIGGER IF NOT EXISTS update_refund_requests_timestamp
  AFTER UPDATE ON refund_requests
  FOR EACH ROW
BEGIN
  UPDATE refund_requests 
  SET updated_at = CURRENT_TIMESTAMP 
  WHERE id = NEW.id;
END;

-- ==============================================
-- DATA VALIDATION VIEWS (for monitoring)
-- ==============================================

-- View for active customer summary
CREATE VIEW IF NOT EXISTS active_customers_summary AS
SELECT 
  subscription_status,
  COUNT(*) as customer_count,
  COUNT(CASE WHEN last_validation > datetime('now', '-7 days') THEN 1 END) as active_last_week,
  COUNT(CASE WHEN payment_failures > 0 THEN 1 END) as customers_with_failures
FROM customers 
GROUP BY subscription_status;

-- View for session activity
CREATE VIEW IF NOT EXISTS session_activity_summary AS  
SELECT 
  DATE(created_at) as session_date,
  COUNT(*) as sessions_started,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as currently_active,
  COUNT(DISTINCT customer_id) as unique_customers
FROM active_sessions 
WHERE created_at > datetime('now', '-30 days')
GROUP BY DATE(created_at)
ORDER BY session_date DESC;

-- ==============================================
-- SCHEMA VERSION TRACKING
-- ==============================================
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert current schema version
INSERT OR REPLACE INTO schema_version (version, description) 
VALUES (1, 'Initial complete schema with all tables, indexes, and constraints');