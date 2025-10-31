-- ======================================================
-- Add Subscription Pricing Fields Migration
-- ======================================================
-- Purpose: Store subscription price information from Stripe
--          to display accurate pricing in POSPal application
-- Date: 2025-10-27
-- ======================================================

-- Add subscription_amount column (price in cents, e.g., 2500 for €25.00)
ALTER TABLE customers ADD COLUMN subscription_amount INTEGER;

-- Add subscription_currency column (ISO 4217 currency code, e.g., 'eur', 'usd')
ALTER TABLE customers ADD COLUMN subscription_currency TEXT DEFAULT 'eur';

-- Add index for pricing queries (optional, for future analytics)
CREATE INDEX IF NOT EXISTS idx_customers_pricing ON customers(subscription_amount, subscription_currency);

-- ======================================================
-- Notes:
-- ======================================================
-- - subscription_amount is stored in cents (Stripe format)
--   Example: €25.00 = 2500 cents
-- - subscription_currency uses lowercase ISO codes
--   Example: 'eur', 'usd', 'gbp'
-- - Existing customers will have NULL values initially
--   These will be populated on next webhook event or manual update
-- ======================================================
