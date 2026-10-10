import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IntegrationService } from '../integration/integration.service';
import {
  ScheduledTransferStatus,
  ScheduledTransferFrequency,
} from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class ScheduledTransferService {
  private readonly logger = new Logger(ScheduledTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationService: IntegrationService,
  ) {}

  async findAll(userId: string) {
    return this.prisma.scheduledTransfer.findMany({
      where: { userId },
      orderBy: { nextExecutionAt: 'asc' },
    });
  }

  async create(userId: string, data: any) {
    return this.prisma.scheduledTransfer.create({
      data: {
        userId,
        recipientPhone: data.recipientPhone,
        amount: data.amount,
        frequency: data.frequency as ScheduledTransferFrequency,
        nextExecutionAt: new Date(data.nextExecutionAt || data.startDate || Date.now()),
        status: ScheduledTransferStatus.ACTIVE,
        note: data.note,
      },
    });
  }

  async cancel(userId: string, id: string) {
    return this.prisma.scheduledTransfer.update({
      where: { id, userId },
      data: { status: ScheduledTransferStatus.CANCELLED },
    });
  }

  /**
   * Cron job that runs every minute to process due transfers
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledTransfers() {
    const now = new Date();
    const dueTransfers = await this.prisma.scheduledTransfer.findMany({
      where: {
        status: ScheduledTransferStatus.ACTIVE,
        nextExecutionAt: { lte: now },
      },
    });

    if (dueTransfers.length === 0) return;

    this.logger.log(`Processing ${dueTransfers.length} due scheduled transfers...`);

    for (const transfer of dueTransfers) {
      try {
        await this.executeTransfer(transfer);
      } catch (error) {
        this.logger.error(`Failed to execute scheduled transfer ${transfer.id}:`, error);
      }
    }
  }

  private async executeTransfer(transfer: any) {
    this.logger.log(`Executing scheduled transfer: ${transfer.id} for user ${transfer.userId}`);

    try {
      // Execute the actual P2P transfer
      await this.integrationService.transferP2P(transfer.userId, {
        recipientPhone: transfer.recipientPhone,
        amount: Number(transfer.amount),
        note: `[Scheduled] ${transfer.note || ''}`,
        idempotencyKey: `SCHED-${transfer.id}-${transfer.nextExecutionAt.getTime()}`,
      });

      // Update next execution date or complete
      if (transfer.frequency === ScheduledTransferFrequency.ONCE) {
        await this.prisma.scheduledTransfer.update({
          where: { id: transfer.id },
          data: { status: ScheduledTransferStatus.COMPLETED },
        });
      } else {
        const nextDate = this.calculateNextExecution(transfer.nextExecutionAt, transfer.frequency);
        await this.prisma.scheduledTransfer.update({
          where: { id: transfer.id },
          data: { nextExecutionAt: nextDate },
        });
      }
    } catch (error) {
      // If it fails, we might want to retry or mark as PAUSED/FAILED
      this.logger.error(`Scheduled transfer ${transfer.id} execution failed: ${error.message}`);
    }
  }

  private calculateNextExecution(current: Date, frequency: ScheduledTransferFrequency): Date {
    const next = new Date(current);
    switch (frequency) {
      case ScheduledTransferFrequency.DAILY:
        next.setDate(next.getDate() + 1);
        break;
      case ScheduledTransferFrequency.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case ScheduledTransferFrequency.MONTHLY:
        next.setMonth(next.getMonth() + 1);
        break;
      default:
        break;
    }
    return next;
  }
}
