SET search_path TO finance, public;

-- Add System Fee and Rounding Difference Accounts for multi-leg ledger and Banker's rounding
INSERT INTO finance.accounts (id, user_id, account_name, account_type, balance, daily_limit, currency, status, kyc_status, version)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'SYSTEM_FEE_ACCOUNT',
    'FEE',
    0.0000,
    999999999.0000,
    'THB',
    'ACTIVE',
    'APPROVED',
    1
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.accounts (id, user_id, account_name, account_type, balance, daily_limit, currency, status, kyc_status, version)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'SYSTEM_ROUNDING_ACCOUNT',
    'ROUNDING_DIFFERENCE',
    0.0000,
    999999999.0000,
    'THB',
    'ACTIVE',
    'APPROVED',
    1
)
ON CONFLICT (id) DO NOTHING;
