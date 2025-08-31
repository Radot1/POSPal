-- Add active_sessions table for session management
CREATE TABLE IF NOT EXISTS active_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    session_id TEXT NOT NULL UNIQUE,
    machine_fingerprint TEXT NOT NULL,
    device_info TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    FOREIGN KEY (customer_id) REFERENCES customers (id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_active_sessions_customer_status 
ON active_sessions(customer_id, status);

CREATE INDEX IF NOT EXISTS idx_active_sessions_session_id 
ON active_sessions(session_id);

CREATE INDEX IF NOT EXISTS idx_active_sessions_heartbeat 
ON active_sessions(last_heartbeat);