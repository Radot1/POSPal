-- Email verification support for subscription signup
-- Creates a separate table to avoid modifying existing tables

CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  verification_id TEXT NOT NULL UNIQUE,
  verification_token TEXT,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, verified, used, expired
  context TEXT,
  expires_at DATETIME NOT NULL,
  verified_at DATETIME,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_sent_ip TEXT,
  last_attempt_at DATETIME,
  send_count INTEGER NOT NULL DEFAULT 1,
  attempt_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);
CREATE INDEX IF NOT EXISTS idx_email_verifications_status ON email_verifications(status);
CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(verification_token);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires ON email_verifications(expires_at);
