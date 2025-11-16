-- Adds the trial_devices registry table for enforcing single trials per hardware

CREATE TABLE IF NOT EXISTS trial_devices (
    hardware_hash TEXT PRIMARY KEY,
    hardware_last4 TEXT,
    first_run TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'blocked')),
    tamper_flag INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_ip TEXT,
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_trial_devices_status ON trial_devices(status);
CREATE INDEX IF NOT EXISTS idx_trial_devices_last_seen ON trial_devices(last_seen);
