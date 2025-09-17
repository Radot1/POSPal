-- POSPal Phase 2: Add Missing Billing Date Columns
-- Migration to add billing date columns to existing customers table
-- Run with: wrangler d1 execute pospal-subscriptions --file=add-billing-columns-migration.sql --env production

-- Add missing billing date columns to customers table
ALTER TABLE customers ADD COLUMN next_billing_date TEXT;
ALTER TABLE customers ADD COLUMN current_period_start TEXT;
ALTER TABLE customers ADD COLUMN current_period_end TEXT;

-- Create indexes for the new columns (performance optimization)
CREATE INDEX IF NOT EXISTS idx_customers_next_billing ON customers(next_billing_date);
CREATE INDEX IF NOT EXISTS idx_customers_period_end ON customers(current_period_end);

-- Update schema version to track this migration
UPDATE schema_version SET description = 'Added billing date columns for Phase 2' WHERE version = 1;
INSERT OR IGNORE INTO schema_version (version, description) VALUES (2, 'Phase 2: Added billing date columns (next_billing_date, current_period_start, current_period_end)');

-- Verification query to confirm columns were added
SELECT sql FROM sqlite_master WHERE type='table' AND name='customers';