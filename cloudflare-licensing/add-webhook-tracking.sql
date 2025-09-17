-- POSPal Phase 3: Add Webhook Idempotency Protection
-- Create table to track processed webhook events
-- Run with: wrangler d1 execute pospal-subscriptions-dev --file=add-webhook-tracking.sql

-- Create webhook_events table for idempotency protection
CREATE TABLE IF NOT EXISTS webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processing_status TEXT DEFAULT 'completed' CHECK (processing_status IN ('processing', 'completed', 'failed')),
    customer_id INTEGER,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

-- Indexes for webhook events table
CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id ON webhook_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at ON webhook_events(processed_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_customer ON webhook_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(processing_status);

-- Update schema version to track this migration
INSERT OR IGNORE INTO schema_version (version, description)
VALUES (3, 'Phase 3: Added webhook_events table for idempotency protection');

-- Verification query
SELECT sql FROM sqlite_master WHERE type='table' AND name='webhook_events';