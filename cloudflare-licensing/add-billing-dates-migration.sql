-- Migration: Add billing date columns to customers table
-- Run this with: wrangler d1 execute pospal-subscriptions --file=add-billing-dates-migration.sql

-- Add billing date columns to existing customers table
ALTER TABLE customers ADD COLUMN next_billing_date TEXT;
ALTER TABLE customers ADD COLUMN current_period_start TEXT;
ALTER TABLE customers ADD COLUMN current_period_end TEXT;

-- Create indexes for the new billing date columns
CREATE INDEX IF NOT EXISTS idx_customers_next_billing ON customers(next_billing_date);
CREATE INDEX IF NOT EXISTS idx_customers_period_end ON customers(current_period_end);

-- Verify the migration by showing the updated table structure
PRAGMA table_info(customers);