import { Test, TestingModule } from '@nestjs/testing';
import { FraudService } from './fraud.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FraudRuleType, FraudRuleAction, DeviceTrustLevel } from '@prisma/client';
import { REDIS_CLIENT } from '../../core/common/constants';

describe('FraudService', () => {
  let service: FraudService;
  let prisma: any;
  let redis: any;

  beforeEach(async () => {
    prisma = {
      fraudRule: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      userDevice: {
        findUnique: jest.fn(),
      },
    };

    redis = {
      incr: jest.fn(),
      expire: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FraudService,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get<FraudService>(FraudService);
  });

  it('should trigger AMOUNT fraud rule when transaction exceeds maxAmount', async () => {
    prisma.fraudRule.findMany.mockResolvedValue([
      {
        id: 'rule-1',
        name: 'High Amount Rule',
        ruleType: FraudRuleType.AMOUNT,
        action: FraudRuleAction.BLOCK,
        condition: { maxAmount: 50000 },
        isActive: true,
      },
    ]);

    const result = await service.evaluateTransaction({
      userId: 'user-1',
      amount: 60000,
      type: 'TRANSFER',
    });

    expect(result).toEqual({
      action: FraudRuleAction.BLOCK,
      reason: 'Triggered by rule: High Amount Rule',
    });
  });

  it('should trigger VELOCITY fraud rule when transaction count exceeds threshold in window', async () => {
    prisma.fraudRule.findMany.mockResolvedValue([
      {
        id: 'rule-2',
        name: 'High Velocity Rule',
        ruleType: FraudRuleType.VELOCITY,
        action: FraudRuleAction.FLAG,
        condition: { windowMinutes: 5, maxCount: 3 },
        isActive: true,
      },
    ]);

    redis.incr.mockResolvedValue(4); // Exceeds maxCount: 3

    const result = await service.evaluateTransaction({
      userId: 'user-1',
      amount: 100,
      type: 'TRANSFER',
    });

    expect(result).toEqual({
      action: FraudRuleAction.FLAG,
      reason: 'Triggered by rule: High Velocity Rule',
    });
  });

  it('should trigger NEW_DEVICE fraud rule when device is unknown', async () => {
    prisma.fraudRule.findMany.mockResolvedValue([
      {
        id: 'rule-3',
        name: 'New Device Check',
        ruleType: FraudRuleType.NEW_DEVICE,
        action: FraudRuleAction.HOLD,
        condition: {},
        isActive: true,
      },
    ]);

    prisma.userDevice.findUnique.mockResolvedValue(null); // Unknown device

    const result = await service.evaluateTransaction({
      userId: 'user-1',
      amount: 100,
      type: 'TRANSFER',
      metadata: { deviceId: 'device-xyz' },
    });

    expect(result).toEqual({
      action: FraudRuleAction.HOLD,
      reason: 'Triggered by rule: New Device Check',
    });
  });

  it('should NOT trigger NEW_DEVICE rule when device is TRUSTED', async () => {
    prisma.fraudRule.findMany.mockResolvedValue([
      {
        id: 'rule-3',
        name: 'New Device Check',
        ruleType: FraudRuleType.NEW_DEVICE,
        action: FraudRuleAction.HOLD,
        condition: {},
        isActive: true,
      },
    ]);

    prisma.userDevice.findUnique.mockResolvedValue({
      id: 'dev-1',
      trustLevel: DeviceTrustLevel.TRUSTED,
    });

    const result = await service.evaluateTransaction({
      userId: 'user-1',
      amount: 100,
      type: 'TRANSFER',
      metadata: { deviceId: 'device-trusted' },
    });

    expect(result).toBeNull();
  });
});
