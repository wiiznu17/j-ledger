-- =============================================================================
-- J-Ledger Finance Service - Development Seed Data
-- This file contains seed data for development/staging environments only.
-- DO NOT run this in production.
-- =============================================================================

SET search_path TO finance, public;

-- Seed System Bank Account (Double-entry core)
INSERT INTO accounts (id, user_id, account_name, account_type, balance, currency, status, created_at, updated_at, version)
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'SYSTEM_BANK_ACCOUNT', 'BANK_CLEARING', 0, 'THB', 'ACTIVE', NOW(), NOW(), 0)
ON CONFLICT (id) DO NOTHING;

-- Seed System Fee Account
INSERT INTO accounts (id, user_id, account_name, account_type, balance, currency, status, created_at, updated_at, version)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'SYSTEM_FEE_ACCOUNT', 'FEE', 0, 'THB', 'ACTIVE', NOW(), NOW(), 0)
ON CONFLICT (id) DO NOTHING;

-- Seed System Rounding Difference Account
INSERT INTO accounts (id, user_id, account_name, account_type, balance, currency, status, created_at, updated_at, version)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'SYSTEM_ROUNDING_ACCOUNT', 'ROUNDING_DIFFERENCE', 0, 'THB', 'ACTIVE', NOW(), NOW(), 0)
ON CONFLICT (id) DO NOTHING;

-- Seed default treasury bank accounts (with test balances)
INSERT INTO treasury_bank_accounts (name, bank_name, account_number, provider, balance, currency, is_active, created_at, updated_at)
VALUES ('SCB Main Corporate', 'Siam Commercial Bank', '111-2-22222-3', 'SCB', 5000000.0000, 'THB', true, NOW(), NOW())
ON CONFLICT (account_number) DO NOTHING;

INSERT INTO treasury_bank_accounts (name, bank_name, account_number, provider, balance, currency, is_active, created_at, updated_at)
VALUES ('KBank Reserve Account', 'Kasikorn Bank', '888-7-77777-9', 'KBANK', 2000000.0000, 'THB', true, NOW(), NOW())
ON CONFLICT (account_number) DO NOTHING;
