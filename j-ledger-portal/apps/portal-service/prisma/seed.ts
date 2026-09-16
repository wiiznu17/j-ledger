import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import axios from 'axios';

const prisma = new PrismaClient();

async function main() {
  const isProduction = process.env.NODE_ENV === 'production';

  console.log('🧹 Cleaning up old seed data...');
  try {
    // Only cleanup test data in non-production environments
    if (!isProduction) {
      // Delete in reverse order of dependencies
      await prisma.terminal.deleteMany({ where: { hardwareId: 'HW-TM-001' } });
      await prisma.merchant.deleteMany({
        where: { name: 'Coffee Master - Sukhumvit Branch' },
      });
      await prisma.brand.deleteMany({ where: { name: 'Coffee Master' } });
      await prisma.partner.deleteMany({
        where: { taxId: { in: ['0000000000000', '1234567890123'] } },
      });
      await prisma.user.deleteMany({
        where: { phoneNumber: { in: ['0811111111', '0812345678'] } },
      });
      console.log('✅ Cleanup completed.');
    } else {
      console.log('ℹ️ Skipping cleanup in production environment.');
    }
  } catch (e) {
    console.warn('⚠️ Cleanup warning (might be first run):', e);
  }

  console.log('🚀 Starting comprehensive RBAC seed...');

  // 1. Define All Permissions
  const permissionsList = [
    // Staff & Admin Management
    {
      name: 'CREATE_ADMINS',
      resource: 'staff',
      action: 'create',
      description: 'Create new administrator accounts',
    },
    {
      name: 'DELETE_ADMINS',
      resource: 'staff',
      action: 'delete',
      description: 'Remove administrator accounts',
    },
    {
      name: 'MANAGE_STAFF',
      resource: 'staff',
      action: 'update',
      description: 'Update staff profile information',
    },
    {
      name: 'RESET_STAFF_PASSWORD',
      resource: 'staff',
      action: 'reset_password',
      description: 'Reset staff account passwords',
    },
    {
      name: 'DEACTIVATE_STAFF',
      resource: 'staff',
      action: 'deactivate',
      description: 'Deactivate staff accounts',
    },
    {
      name: 'REACTIVATE_STAFF',
      resource: 'staff',
      action: 'activate',
      description: 'Reactivate staff accounts',
    },
    {
      name: 'ASSIGN_STAFF_ROLES',
      resource: 'staff',
      action: 'assign_role',
      description: 'Assign security roles to staff',
    },

    // KYC & User Identity
    {
      name: 'VIEW_KYC',
      resource: 'kyc',
      action: 'read',
      description: 'View user KYC documents and status',
    },
    {
      name: 'APPROVE_KYC',
      resource: 'kyc',
      action: 'approve',
      description: 'Approve user KYC verification',
    },
    {
      name: 'REJECT_KYC',
      resource: 'kyc',
      action: 'reject',
      description: 'Reject user KYC verification',
    },
    {
      name: 'VIEW_USERS',
      resource: 'user',
      action: 'read',
      description: 'View customer user profiles',
    },
    {
      name: 'FREEZE_USERS',
      resource: 'user',
      action: 'freeze',
      description: 'Freeze customer accounts',
    },
    {
      name: 'UNFREEZE_USERS',
      resource: 'user',
      action: 'unfreeze',
      description: 'Unfreeze customer accounts',
    },

    // System & Security
    {
      name: 'MANAGE_SYSTEM_ROLES',
      resource: 'system',
      action: 'manage',
      description: 'Create and edit system roles',
    },
    {
      name: 'MANAGE_SYSTEM_PERMISSIONS',
      resource: 'system',
      action: 'manage',
      description: 'Manage system-wide permissions',
    },
    {
      name: 'VIEW_AUDIT_LOGS',
      resource: 'audit',
      action: 'read',
      description: 'View system administrative audit logs',
    },
    {
      name: 'VIEW_DASHBOARD',
      resource: 'dashboard',
      action: 'read',
      description: 'Access administrative dashboard',
    },
    {
      name: 'VIEW_STATISTICS',
      resource: 'stats',
      action: 'read',
      description: 'View operational statistics',
    },

    // Financial Monitoring
    {
      name: 'VIEW_TRANSACTIONS',
      resource: 'transaction',
      action: 'read',
      description: 'Monitor financial transactions',
    },
    {
      name: 'VIEW_TRANSACTION_DETAILS',
      resource: 'transaction',
      action: 'read',
      description: 'View detailed transaction data',
    },
    {
      name: 'VIEW_LEDGER_ENTRIES',
      resource: 'ledger',
      action: 'read',
      description: 'View accounting ledger entries',
    },
    {
      name: 'VIEW_ACCOUNTS',
      resource: 'account',
      action: 'read',
      description: 'View customer ledger accounts',
    },
    {
      name: 'FREEZE_ACCOUNTS',
      resource: 'account',
      action: 'freeze',
      description: 'Freeze financial accounts',
    },
    {
      name: 'UNFREEZE_ACCOUNTS',
      resource: 'account',
      action: 'unfreeze',
      description: 'Unfreeze financial accounts',
    },
    {
      name: 'VIEW_RECONCILIATION_REPORTS',
      resource: 'reconciliation',
      action: 'read',
      description: 'View reconciliation reports',
    },
    {
      name: 'RUN_RECONCILIATION',
      resource: 'reconciliation',
      action: 'execute',
      description: 'Trigger system reconciliation',
    },

    // AML
    {
      name: 'VIEW_SUSPICIOUS_ACTIVITIES',
      resource: 'AML',
      action: 'VIEW',
      description: 'View flagged suspicious activities',
    },
    {
      name: 'REVIEW_SUSPICIOUS_ACTIVITIES',
      resource: 'AML',
      action: 'REVIEW',
      description: 'Update status of suspicious activities',
    },
    {
      name: 'REPORT_TO_AMLO',
      resource: 'AML',
      action: 'REPORT',
      description: 'Send official report to AMLO',
    },

    // Merchant Management
    {
      name: 'VIEW_MERCHANTS',
      resource: 'merchant',
      action: 'read',
      description: 'View merchant partners and branches',
    },
    {
      name: 'VIEW_MERCHANT_APPLICATIONS',
      resource: 'merchant',
      action: 'read',
      description: 'View new merchant applications',
    },
    {
      name: 'APPROVE_MERCHANTS',
      resource: 'merchant',
      action: 'approve',
      description: 'Approve or reject merchant applications',
    },
    {
      name: 'MANAGE_MERCHANTS',
      resource: 'merchant',
      action: 'manage',
      description: 'Freeze, unfreeze or manage terminals',
    },

    // Promotions & Deals
    {
      name: 'VIEW_DEALS',
      resource: 'deal',
      action: 'read',
      description: 'View active promotional deals, brands, and categories',
    },
    {
      name: 'MANAGE_DEALS',
      resource: 'deal',
      action: 'manage',
      description:
        'Create, update, toggle, or delete promotional deals and metadata',
    },
    {
      name: 'VIEW_BANNERS',
      resource: 'banner',
      action: 'read',
      description: 'View active promotional banners',
    },
    {
      name: 'MANAGE_BANNERS',
      resource: 'banner',
      action: 'manage',
      description: 'Create, update, or delete promotional banners',
    },

    // Loyalty System
    {
      name: 'VIEW_LOYALTY',
      resource: 'loyalty',
      action: 'read',
      description: 'View active loyalty rules and stats',
    },
    {
      name: 'MANAGE_LOYALTY',
      resource: 'loyalty',
      action: 'manage',
      description: 'Modify loyalty point structures and rule triggers',
    },

    // System Settings & Operations
    {
      name: 'VIEW_SYSTEM_SETTINGS',
      resource: 'system',
      action: 'read',
      description: 'View core system settings and fees',
    },
    {
      name: 'MANAGE_SYSTEM_SETTINGS',
      resource: 'system',
      action: 'manage',
      description: 'Modify core system fees, MDR rates, and bounds',
    },
    {
      name: 'VIEW_SYSTEM_OUTBOX',
      resource: 'outbox',
      action: 'read',
      description: 'View system Kafka outbox message logs',
    },
    {
      name: 'RETRY_SYSTEM_OUTBOX',
      resource: 'outbox',
      action: 'retry',
      description: 'Trigger outbox event retries',
    },
  ];

  console.log('📦 Seeding permissions...');
  const createdPermissionsMap = new Map();
  for (const p of permissionsList) {
    const permission = await prisma.permission.upsert({
      where: { name: p.name },
      update: p,
      create: p,
    });
    createdPermissionsMap.set(p.name, permission.id);
  }

  // 2. Define Roles
  const roles = [
    { name: 'SUPER_ADMIN', description: 'Full system access', isSystem: true },
    {
      name: 'AUDITOR',
      description: 'View-only access to financial and audit records',
      isSystem: true,
    },
    {
      name: 'SUPPORT_AGENT',
      description: 'Limited access to user management and transactions',
      isSystem: true,
    },
    {
      name: 'COMPLIANCE_OFFICER',
      description: 'Dedicated access to KYC and AML monitoring',
      isSystem: true,
    },
  ];

  console.log('👑 Seeding roles...');
  const createdRolesMap = new Map();
  for (const role of roles) {
    const r = await prisma.role.upsert({
      where: { name: role.name },
      update: {
        description: role.description,
        isSystem: role.isSystem,
      },
      create: role,
    });
    createdRolesMap.set(role.name, r.id);
  }

  // 3. Link Permissions to Roles (RolePermission)
  const rolePermissionsMapping = {
    SUPER_ADMIN: permissionsList.map((p) => p.name), // Everything
    AUDITOR: [
      'VIEW_TRANSACTIONS',
      'VIEW_TRANSACTION_DETAILS',
      'VIEW_LEDGER_ENTRIES',
      'VIEW_AUDIT_LOGS',
      'VIEW_DASHBOARD',
      'VIEW_STATISTICS',
      'VIEW_MERCHANTS',
      'VIEW_DEALS',
      'VIEW_BANNERS',
      'VIEW_LOYALTY',
      'VIEW_SYSTEM_SETTINGS',
      'VIEW_SYSTEM_OUTBOX',
    ],
    SUPPORT_AGENT: [
      'VIEW_USERS',
      'VIEW_ACCOUNTS',
      'VIEW_TRANSACTIONS',
      'VIEW_DASHBOARD',
      'VIEW_KYC',
      'VIEW_MERCHANTS',
      'VIEW_MERCHANT_APPLICATIONS',
      'VIEW_DEALS',
      'VIEW_BANNERS',
      'VIEW_LOYALTY',
      'VIEW_SYSTEM_SETTINGS',
    ],
    COMPLIANCE_OFFICER: [
      'VIEW_SUSPICIOUS_ACTIVITIES',
      'REVIEW_SUSPICIOUS_ACTIVITIES',
      'REPORT_TO_AMLO',
      'VIEW_USERS',
      'VIEW_ACCOUNTS',
      'VIEW_TRANSACTIONS',
      'VIEW_KYC',
      'APPROVE_KYC',
      'REJECT_KYC',
      'VIEW_MERCHANTS',
      'VIEW_MERCHANT_APPLICATIONS',
      'APPROVE_MERCHANTS',
      'MANAGE_MERCHANTS',
      'VIEW_LOYALTY',
      'VIEW_SYSTEM_SETTINGS',
      'VIEW_SYSTEM_OUTBOX',
    ],
  };

  console.log('🔗 Linking permissions to roles...');
  for (const [roleName, perms] of Object.entries(rolePermissionsMapping)) {
    const roleId = createdRolesMap.get(roleName);
    if (!roleId) continue;

    await prisma.rolePermission.deleteMany({ where: { roleId } });

    for (const permName of perms) {
      const permissionId = createdPermissionsMap.get(permName);
      if (permissionId) {
        await prisma.rolePermission.create({
          data: {
            roleId,
            permissionId,
          },
        });
      }
    }
  }

  // 4. Create/Update Default Admin User (only in non-production)
  if (!isProduction) {
    const seedAdminEmail =
      process.env.JLEDGER_ADMIN_EMAIL || 'admin@jledger.com';
    const seedAdminPasswordRaw =
      process.env.JLEDGER_ADMIN_PASSWORD || 'password123';
    const adminPassword = await bcrypt.hash(seedAdminPasswordRaw, 10);
    const adminUser = await prisma.staff.upsert({
      where: { username: 'admin' },
      update: {
        email: seedAdminEmail,
        password: adminPassword,
      },
      create: {
        username: 'admin',
        password: adminPassword,
        email: seedAdminEmail,
        firstName: 'System',
        lastName: 'Admin',
        isActive: true,
      },
    });

    const superAdminRoleId = createdRolesMap.get('SUPER_ADMIN');
    if (superAdminRoleId) {
      await prisma.staffRole.upsert({
        where: {
          staffId_roleId: {
            staffId: adminUser.id,
            roleId: superAdminRoleId,
          },
        },
        update: {},
        create: {
          staffId: adminUser.id,
          roleId: superAdminRoleId,
        },
      });
    }
  } else {
    console.log(
      'ℹ️ Skipping admin user creation in production. Use admin setup process instead.',
    );
  }

  // 5. Seed Loyalty Rules
  console.log('💎 Seeding loyalty rules...');
  const loyaltyRules = [
    {
      eventType: 'TOPUP',
      pointsPerThb: 0.04, // 25 THB = 1 Point
      minAmount: 100,
      isActive: true,
      isLocked: true,
      description: 'Earn points on successful wallet top-ups',
    },
    {
      eventType: 'P2P_TRANSFER',
      pointsPerThb: 0.04, // 25 THB = 1 Point
      minAmount: 1,
      isActive: true,
      isLocked: true,
      description: 'Earn points on peer-to-peer transfers (Sender only)',
    },
    {
      eventType: 'MERCHANT_PAYMENT',
      pointsPerThb: 0.08, // 12.5 THB = 1 Point (Bonus for spending!)
      minAmount: 1,
      isActive: true,
      isLocked: true,
      description: 'Earn points on merchant payments',
    },
  ];

  for (const rule of loyaltyRules) {
    await prisma.loyaltyRule.upsert({
      where: { eventType: rule.eventType },
      update: rule,
      create: rule,
    });
  }

  // 5.5. Seed Deal Categories & General Brands
  console.log('🏷️ Seeding deal categories & general brands...');
  const categories = [
    { name: 'Food & Beverage', description: 'Dining, cafes, and food delivery', order: 1 },
    { name: 'Shopping', description: 'Retail, fashion, and lifestyle', order: 2 },
    { name: 'Travel', description: 'Flights, hotels, and tours', order: 3 },
    { name: 'Entertainment', description: 'Movies, games, and events', order: 4 },
    { name: 'Services', description: 'Utility, telco, and insurance', order: 5 },
  ];
  for (const cat of categories) {
    await prisma.dealCategory.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }

  const generalBrands = [
    { name: 'Starbucks', website: 'https://www.starbucks.co.th', description: 'Coffee and snacks' },
    { name: 'Grab', website: 'https://www.grab.com', description: 'Transport and food' },
    { name: 'Major Cineplex', website: 'https://www.majorcineplex.com', description: 'Movies and entertainment' },
    { name: 'Lazada', website: 'https://www.lazada.co.th', description: 'Online shopping' },
    { name: 'AIS', website: 'https://www.ais.th', description: 'Telecommunication' },
  ];
  for (const brand of generalBrands) {
    await prisma.brand.upsert({
      where: { name: brand.name },
      update: {},
      create: brand,
    });
  }

  // 6. System Ecosystem Seed
  console.log('🏛️ Seeding system ecosystem...');
  const systemPartner = await prisma.partner.upsert({
    where: { taxId: '0000000000000' },
    update: {},
    create: {
      name: 'J-Ledger System',
      taxId: '0000000000000',
      status: 'ACTIVE',
      type: 'CORPORATE',
      feeRate: 0,
    },
  });

  const financeUrl = process.env.FINANCE_SERVICE_URL || 'http://localhost:8081';
  const internalSecret = process.env.JLEDGER_INTERNAL_SECRET;
  if (!internalSecret) {
    throw new Error(
      'JLEDGER_INTERNAL_SECRET environment variable is required to run database seed',
    );
  }
  const headers = { 'X-Internal-Secret': internalSecret };

  // --- CORE SYSTEM SEEDING (Runs in ALL environments) ---
  console.log('💰 Ensuring Finance Service core settings and system accounts...');
  try {
    // 6.1. Seed System Settings
    await axios.put(
      `${financeUrl}/api/v1/system/settings`,
      {
        systemName: 'J-Ledger',
        companyName: 'J-Ledger Co., Ltd.',
        supportEmail: 'support@jledger.com',
        supportPhone: '+66-2-123-4567',
        defaultCurrency: 'THB',
        businessHoursStart: '09:00',
        businessHoursEnd: '17:00',
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: true,
        kycRequired: true,
        twoFactorAuthRequired: false,
        defaultLanguage: 'th',
        timezone: 'Asia/Bangkok',
        sessionTimeoutMinutes: 30,
        registrationMode: 'open',
        transferFeeFixed: 5.0,
        transferFeePercentage: 0.01,
        topUpFeeFixed: 0,
        topUpFeePercentage: 0,
        billPaymentFeeFixed: 10.0,
        billPaymentFeePercentage: 0.005,
        withdrawalFeeFixed: 25.0,
        withdrawalFeePercentage: 0.02,
        minimumFee: 1.0,
        dailyTransactionLimit: 500000.0,
        monthlyTransactionLimit: 5000000.0,
        perTransactionLimit: 100000.0,
        walletBalanceLimit: 1000000.0,
        dailyTopUpLimit: 200000.0,
      },
      { headers },
    );
    console.log('✅ System settings updated.');

    // 6.2. Ensure Core System Accounts exist
    let systemAccounts = (systemPartner.financeAccounts as any) || {};

    // 6.2.1. SYSTEM_BANK_ACCOUNT
    try {
      const existingAccounts = await axios.get(
        `${financeUrl}/api/v1/accounts/user/00000000-0000-0000-0000-000000000000`,
        { headers },
      );
      const hasBankAcc = existingAccounts.data.some(
        (acc: any) => acc.account_name === 'SYSTEM_BANK_ACCOUNT',
      );

      if (!hasBankAcc) {
        await axios.post(
          `${financeUrl}/api/v1/accounts`,
          {
            user_id: '00000000-0000-0000-0000-000000000000',
            account_name: 'SYSTEM_BANK_ACCOUNT',
            currency: 'THB',
            account_type: 'BANK_CLEARING',
          },
          { headers },
        );
        console.log('✅ SYSTEM_BANK_ACCOUNT created.');
      } else {
        console.log('ℹ️ SYSTEM_BANK_ACCOUNT already exists.');
      }
    } catch (e: any) {
      console.warn('⚠️ Could not verify or create SYSTEM_BANK_ACCOUNT');
    }

    // 6.2.2. Revenue and VAT Accounts
    const systemPartnerAccounts = await axios
      .get(`${financeUrl}/api/v1/accounts/user/${systemPartner.id}`, {
        headers,
      })
      .catch(() => ({ data: [] }));

    if (!systemAccounts.revenue) {
      const existingRevenue = systemPartnerAccounts.data.find(
        (acc: any) => acc.account_name === 'SYSTEM_REVENUE',
      );
      if (existingRevenue) {
        systemAccounts.revenue = existingRevenue.id;
      } else {
        const res = await axios.post(
          `${financeUrl}/api/v1/accounts`,
          {
            user_id: systemPartner.id,
            account_name: 'SYSTEM_REVENUE',
            currency: 'THB',
            account_type: 'SYSTEM_REVENUE',
          },
          { headers },
        );
        systemAccounts.revenue = res.data.id;
      }
    }

    if (!systemAccounts.vat_payable) {
      const existingVat = systemPartnerAccounts.data.find(
        (acc: any) => acc.account_name === 'SYSTEM_VAT_PAYABLE',
      );
      if (existingVat) {
        systemAccounts.vat_payable = existingVat.id;
      } else {
        const res = await axios.post(
          `${financeUrl}/api/v1/accounts`,
          {
            user_id: systemPartner.id,
            account_name: 'SYSTEM_VAT_PAYABLE',
            currency: 'THB',
            account_type: 'SYSTEM_VAT_PAYABLE',
          },
          { headers },
        );
        systemAccounts.vat_payable = res.data.id;
      }
    }

    await prisma.partner.update({
      where: { id: systemPartner.id },
      data: { financeAccounts: systemAccounts },
    });
    console.log('✅ 3 Core System Accounts linked.');
  } catch (error: any) {
    console.warn(
      '⚠️ Warning: Failed to seed Finance Service core. Is it running?',
    );
  }

  // 7. Seed Merchant Ecosystem (Minimal) - Only in Non-Production
  if (!isProduction) {
    console.log('🏪 Seeding merchant ecosystem...');

    const merchantUser = await prisma.user.upsert({
      where: { phoneNumber: '0812345678' },
      update: {},
      create: {
        phoneNumber: '0812345678',
        email: 'merchant@test.com',
        status: 'ACTIVE',
        registrationState: 'COMPLETED',
      },
    });

    // Create Finance Account and Wallet for Merchant Owner
    try {
      const ownerAccounts = await axios
        .get(`${financeUrl}/api/v1/accounts/user/${merchantUser.id}`, {
          headers,
        })
        .catch(() => ({ data: [] }));
      const hasBusinessAcc = ownerAccounts.data.some(
        (acc: any) => acc.account_name === 'BUSINESS_OPERATIONAL',
      );

      if (!hasBusinessAcc) {
        await axios.post(
          `${financeUrl}/api/v1/accounts`,
          {
            user_id: merchantUser.id,
            account_name: 'BUSINESS_OPERATIONAL',
            currency: 'THB',
            account_type: 'AVAILABLE',
          },
          { headers },
        );
        console.log('✅ Merchant Owner BUSINESS_OPERATIONAL account created.');
      }

      // Check if wallet exists before creating
      try {
        await axios.get(
          `${financeUrl}/api/finance/wallets/${merchantUser.id}`,
          { headers },
        );
        console.log('ℹ️ Merchant Owner wallet already exists.');
      } catch (walletErr: any) {
        if (walletErr.response?.status === 404) {
          await axios.post(
            `${financeUrl}/api/finance/wallets/create`,
            {
              userId: merchantUser.id,
              currency: 'THB',
            },
            { headers },
          );
          console.log('✅ Merchant Owner wallet created.');
        }
      }
    } catch (e: any) {
      console.warn('   Note: Merchant Finance setup error:', e.message);
    }

    const partner = await prisma.partner.upsert({
      where: { taxId: '1234567890123' },
      update: { userId: merchantUser.id, status: 'ACTIVE' },
      create: {
        userId: merchantUser.id,
        name: 'Coffee Master HQ',
        taxId: '1234567890123',
        status: 'ACTIVE',
        feeRate: 0.03,
      },
    });

    const brand = await prisma.brand.upsert({
      where: { name: 'Coffee Master' },
      update: { partnerId: partner.id },
      create: {
        name: 'Coffee Master',
        partnerId: partner.id,
        description: 'The best coffee in town',
      },
    });

    let merchant = await prisma.merchant.findFirst({
      where: {
        name: 'Coffee Master - Sukhumvit Branch',
        partnerId: partner.id,
      },
    });

    if (!merchant) {
      merchant = await prisma.merchant.create({
        data: {
          partnerId: partner.id,
          name: 'Coffee Master - Sukhumvit Branch',
          category: 'COFFEE_SHOP',
          address: 'Sukhumvit Soi 24, Bangkok',
        },
      });
    }

    const terminalSecret = 'sk_test_coffee_master_2024';
    await prisma.terminal.upsert({
      where: { hardwareId: 'HW-TM-001' },
      update: { secretKey: terminalSecret },
      create: {
        merchantId: merchant.id,
        name: 'POS-01',
        secretKey: terminalSecret,
        hardwareId: 'HW-TM-001',
        status: 'ACTIVE',
      },
    });
  }

  console.log('✅ Comprehensive Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
