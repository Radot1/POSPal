-- POSPal Licensing System v2.0 - Clean Database Schema
-- Run with: wrangler d1 execute pospal-licensing-dev --file=schema.sql

-- Customers table - Email/Password authentication
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, -- bcrypt hashed password
  name TEXT,
  restaurant_name TEXT,
  
  -- Stripe integration
  stripe_customer_id TEXT,
  stripe_session_id TEXT,
  subscription_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'cancelled', 'past_due'
  
  -- Account management
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME,
  last_seen DATETIME,
  email_verified BOOLEAN DEFAULT false,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until DATETIME NULL,
  
  -- Billing
  payment_failures INTEGER DEFAULT 0,
  grace_period_until DATETIME NULL,
  trial_ends_at DATETIME DEFAULT (datetime('now', '+30 days')),
  
  -- Security
  password_reset_token TEXT NULL,
  password_reset_expires DATETIME NULL,
  email_verify_token TEXT NULL
);

-- Active sessions - Instance control and authentication
CREATE TABLE IF NOT EXISTS active_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL, -- JWT token
  refresh_token TEXT,
  
  -- Device tracking
  device_fingerprint TEXT,
  device_info TEXT, -- JSON: OS, app version, etc.
  ip_address TEXT,
  user_agent TEXT,
  
  -- Session lifecycle
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME DEFAULT (datetime('now', '+4 hours')),
  status TEXT DEFAULT 'active', -- 'active', 'terminated', 'expired', 'kicked'
  
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Session audit log - Security and troubleshooting
CREATE TABLE IF NOT EXISTS session_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  session_id TEXT,
  action TEXT NOT NULL, -- 'login', 'logout', 'heartbeat', 'takeover', 'terminated', 'expired'
  
  -- Context
  ip_address TEXT,
  user_agent TEXT,
  device_info TEXT, -- JSON
  details TEXT, -- JSON for additional context
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Email delivery log - Track all customer communications  
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  email_type TEXT NOT NULL, -- 'welcome', 'password_reset', 'payment_failed', 'grace_period', 'cancelled'
  recipient_email TEXT NOT NULL,
  subject TEXT,
  delivery_status TEXT DEFAULT 'pending', -- 'pending', 'delivered', 'failed', 'bounced'
  provider_id TEXT, -- Resend message ID
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

-- Subscription events - Business intelligence and audit
CREATE TABLE IF NOT EXISTS subscription_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  event_type TEXT NOT NULL, -- 'created', 'renewed', 'failed', 'cancelled', 'grace_started', 'grace_ended'
  stripe_event_id TEXT,
  
  -- Event data
  subscription_id TEXT,
  amount_cents INTEGER,
  currency TEXT DEFAULT 'eur',
  
  -- Context
  details TEXT, -- JSON for additional event data
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- System configuration - Feature flags and settings
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_stripe_customer ON customers(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_subscription_status ON customers(subscription_status);
CREATE INDEX IF NOT EXISTS idx_customers_grace_period ON customers(grace_period_until);

CREATE INDEX IF NOT EXISTS idx_sessions_customer ON active_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON active_sessions(access_token);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON active_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_heartbeat ON active_sessions(last_heartbeat);

CREATE INDEX IF NOT EXISTS idx_audit_customer ON session_audit(customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON session_audit(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON session_audit(created_at);

CREATE INDEX IF NOT EXISTS idx_email_customer ON email_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_email_status ON email_log(delivery_status);
CREATE INDEX IF NOT EXISTS idx_email_type ON email_log(email_type);

CREATE INDEX IF NOT EXISTS idx_events_customer ON subscription_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON subscription_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON subscription_events(created_at);

-- Insert initial system configuration
INSERT OR IGNORE INTO system_config (key, value, description) VALUES 
('maintenance_mode', 'true', 'System maintenance mode - blocks new registrations'),
('trial_days', '30', 'Trial period length in days'),  
('grace_period_trial', '1', 'Grace period for trial users (days)'),
('grace_period_paid', '7', 'Grace period for paying customers (days)'),
('max_login_attempts', '10', 'Maximum failed login attempts before lockout'),
('lockout_duration_minutes', '30', 'Account lockout duration in minutes'),
('session_heartbeat_minutes', '1', 'Required heartbeat interval in minutes'),
('session_timeout_hours', '4', 'Session timeout in hours'),
('stripe_price_id', 'TBD', 'Stripe price ID for monthly subscription'),
('app_version', '2.0.0', 'Current application version'),
('created_at', datetime('now'), 'Database schema creation timestamp');