-- =============================================================================
-- J-Ledger Finance Service - Production Seed Data
-- This file contains seed data for production environment.
-- Only includes essential system accounts with zero balances.
-- =============================================================================

SET search_path TO finance, public;

-- Seed System Bank Account (Double-entry core) - Zero balance for production
INSERT INTO accounts (id, user_id, account_name, account_type, balance, currency, status, created_at, updated_at, version)
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'SYSTEM_BANK_ACCOUNT', 'BANK_CLEARING', 0, 'THB', 'ACTIVE', NOW(), NOW(), 0)
ON CONFLICT (id) DO NOTHING;

-- Seed System Fee Account - Zero balance for production
INSERT INTO accounts (id, user_id, account_name, account_type, balance, currency, status, created_at, updated_at, version)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'SYSTEM_FEE_ACCOUNT', 'FEE', 0, 'THB', 'ACTIVE', NOW(), NOW(), 0)
ON CONFLICT (id) DO NOTHING;

-- Seed System Rounding Difference Account - Zero balance for production
INSERT INTO accounts (id, user_id, account_name, account_type, balance, currency, status, created_at, updated_at, version)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'SYSTEM_ROUNDING_ACCOUNT', 'ROUNDING_DIFFERENCE', 0, 'THB', 'ACTIVE', NOW(), NOW(), 0)
ON CONFLICT (id) DO NOTHING;

-- Note: Treasury bank accounts should be created manually in production
-- through the admin interface or separate setup process with real bank details.
