-- License Recovery System Database Schema
-- Adds rate limiting and security tracking for license key recovery

-- Recovery attempts tracking table
CREATE TABLE IF NOT EXISTS recovery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  success BOOLEAN DEFAULT FALSE,
  customer_id INTEGER,
  recovery_type TEXT DEFAULT 'email_recovery', -- 'email_recovery', 'manual_recovery', 'admin_recovery'
  security_flags TEXT, -- JSON string for security indicators
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Indexes for recovery attempts
CREATE INDEX IF NOT EXISTS idx_recovery_email ON recovery_attempts(email);
CREATE INDEX IF NOT EXISTS idx_recovery_ip ON recovery_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_recovery_created ON recovery_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_recovery_success ON recovery_attempts(success);
CREATE INDEX IF NOT EXISTS idx_recovery_customer ON recovery_attempts(customer_id);

-- Rate limiting table (tracks by IP and email combinations)
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL, -- Can be IP, email, or IP+email combination
  limit_type TEXT NOT NULL, -- 'email_recovery_per_ip', 'email_recovery_per_email', 'email_recovery_per_combo'
  attempt_count INTEGER DEFAULT 0,
  first_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
  reset_after DATETIME, -- When the rate limit resets
  blocked_until DATETIME, -- If temporarily blocked
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for rate limiting
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_identifier_type ON rate_limits(identifier, limit_type);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_after);
CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked ON rate_limits(blocked_until);

-- Update email_log table to support recovery emails (if not exists)
-- Note: This will only add the column if it doesn't exist
-- ALTER TABLE email_log ADD COLUMN recovery_attempt_id INTEGER REFERENCES recovery_attempts(id);