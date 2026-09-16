import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FraudRule, FraudRuleType, FraudRuleAction, DeviceTrustLevel } from '@prisma/client';
import { FraudRuleDto } from '@repo/dto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../core/common/constants';

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async findAll(): Promise<FraudRule[]> {
    return this.prisma.fraudRule.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<FraudRule | null> {
    return this.prisma.fraudRule.findUnique({
      where: { id },
    });
  }

  async create(data: any): Promise<FraudRule> {
    return this.prisma.fraudRule.create({
      data: {
        name: data.name,
        description: data.description,
        ruleType: data.ruleType as FraudRuleType,
        condition: data.condition || {},
        action: data.action as FraudRuleAction,
        severity: data.severity || 'MEDIUM',
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
    });
  }

  async update(id: string, data: any): Promise<FraudRule> {
    return this.prisma.fraudRule.update({
      where: { id },
      data,
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.fraudRule.delete({
      where: { id },
    });
  }

  /**
   * Evaluate a transaction against active fraud rules
   */
  async evaluateTransaction(payload: {
    userId: string;
    amount: number;
    type: string;
    metadata?: any;
    deviceIdentifier?: string;
  }): Promise<{ action: FraudRuleAction; reason?: string } | null> {
    const activeRules = await this.prisma.fraudRule.findMany({
      where: { isActive: true },
    });

    for (const rule of activeRules) {
      const isTriggered = await this.checkRule(rule, payload);
      if (isTriggered) {
        this.logger.warn(`Fraud rule triggered: ${rule.name} for user ${payload.userId}`);
        return {
          action: rule.action as FraudRuleAction,
          reason: `Triggered by rule: ${rule.name}`,
        };
      }
    }

    return null;
  }

  private async checkRule(rule: FraudRule, payload: any): Promise<boolean> {
    const condition = rule.condition as any;

    switch (rule.ruleType) {
      case FraudRuleType.AMOUNT:
        if (condition.maxAmount && payload.amount > condition.maxAmount) {
          return true;
        }
        break;

      case FraudRuleType.VELOCITY:
        // Check number of transactions in the last X minutes
        if (condition.windowMinutes && condition.maxCount && payload.userId) {
          const windowSeconds = Math.max(1, Number(condition.windowMinutes)) * 60;
          const maxCount = Number(condition.maxCount);
          if (this.redis) {
            try {
              const timeSlot = Math.floor(Date.now() / (windowSeconds * 1000));
              const key = `fraud:velocity:${payload.userId}:${timeSlot}`;
              const count = await this.redis.incr(key);
              if (count === 1) {
                await this.redis.expire(key, windowSeconds * 2);
              }
              if (count > maxCount) {
                this.logger.warn(
                  `Velocity check exceeded for user=${payload.userId}: count=${count} > max=${maxCount} in ${condition.windowMinutes}m`,
                );
                return true;
              }
            } catch (err: any) {
              this.logger.warn(`Redis velocity check error: ${err.message}`);
            }
          }
        }
        break;

      case FraudRuleType.NEW_DEVICE:
        // Check if device is trusted/known
        if (payload.userId) {
          const deviceId =
            payload.metadata?.deviceId ||
            payload.metadata?.deviceIdentifier ||
            payload.deviceIdentifier;
          if (deviceId) {
            const device = await this.prisma.userDevice.findUnique({
              where: {
                userId_deviceIdentifier: {
                  userId: payload.userId,
                  deviceIdentifier: deviceId,
                },
              },
            });
            // Trigger rule if device is completely unknown or untrusted
            if (!device || device.trustLevel === DeviceTrustLevel.UNKNOWN) {
              this.logger.warn(
                `New or untrusted device detected for user=${payload.userId}: deviceId=${deviceId}`,
              );
              return true;
            }
          }
        }
        break;

      default:
        break;
    }

    return false;
  }
}
