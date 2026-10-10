import { HttpException, HttpStatus, Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FinanceService } from '../../../core/finance/finance.service';
import Stripe from 'stripe';
import { TopupOrderStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { BillingService } from '../../billing/billing.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { INTERNAL_API_PATHS } from '@repo/dto';

@Injectable()
export class StripeIntegrationService {
  private readonly logger = new Logger(StripeIntegrationService.name);
  private readonly stripe: any | null;
  private readonly apiGatewayUrl: string;
  private readonly internalSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
    private readonly loyaltyService: LoyaltyService,
  ) {
    this.apiGatewayUrl = this.configService.get<string>(
      'FINANCE_SERVICE_URL',
      'http://localhost:8081',
    );
    this.internalSecret = this.configService.get<string>(
      'JLEDGER_INTERNAL_SECRET',
      'default-secret',
    );
    const stripeSecretKey = this.configService.get<string>(
      'STRIPE_SECRET_KEY',
      '',
    );
    if (!stripeSecretKey) {
      this.logger.warn(
        'STRIPE_SECRET_KEY is not set; Stripe features are disabled.',
      );
      this.stripe = null;
    } else {
      this.stripe = new Stripe(stripeSecretKey);
    }
  }

  async getStripeBalance() {
    if (!this.stripe) return null;
    try {
      const balance = await this.stripe.balance.retrieve();
      const available =
        balance.available.find((b) => b.currency === 'thb')?.amount || 0;
      const pending =
        balance.pending.find((b) => b.currency === 'thb')?.amount || 0;

      return {
        available: available / 100, // Convert from cents to THB
        pending: pending / 100,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch Stripe balance: ${error.message}`);
      return null;
    }
  }

  async forwardToGateway<T = any>(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    data?: unknown,
    customerAccountId?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.apiGatewayUrl}${path}`;
    const headers = {
      'X-Internal-Secret': this.internalSecret,
      ...(customerAccountId && { 'X-Customer-Account-Id': customerAccountId }),
      ...(extraHeaders ?? {}),
    };

    const response = await this.httpService.axiosRef.request<T>({
      method: method.toUpperCase(),
      url,
      data,
      headers,
    });

    return response.data;
  }

  async createStripeTopupIntent(
    userId: string,
    amount: number,
    currency: string = 'THB',
    note?: string,
  ) {
    if (!this.stripe) {
      throw new HttpException(
        { message: 'Stripe is not configured' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!amount || amount <= 0) {
      throw new Error('Invalid top-up amount');
    }

    const normalizedCurrency = currency.toLowerCase();
    const amountMinor = Math.round(amount * 100);
    const idempotencyKey = `topup_${userId}_${randomUUID()}`;

    const order = await this.prisma.topupOrder.create({
      data: {
        userId,
        amount: amount.toFixed(4),
        currency: currency.toUpperCase(),
        status: TopupOrderStatus.PENDING,
        idempotencyKey,
      },
    });

    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: amountMinor,
        currency: normalizedCurrency,
        metadata: {
          userId,
          orderId: order.id,
          note: note || '',
        },
      },
      {
        idempotencyKey,
      },
    );

    await this.prisma.topupOrder.update({
      where: { id: order.id },
      data: {
        stripePaymentIntentId: paymentIntent.id,
        clientSecretRef: paymentIntent.client_secret || '',
      },
    });

    const wallet = await this.financeService.getWallet(userId);
    if (wallet) {
      await this.financeService
        .createPaymentIntent(
          wallet.accountId,
          paymentIntent.id,
          amount.toFixed(4),
          'TOPUP',
        )
        .catch((err) => {
          this.logger.error(
            `Failed to register payment intent in finance-service: ${err.message}`,
          );
        });
    }

    return {
      orderId: order.id,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      publishableKey: this.configService.get<string>(
        'STRIPE_PUBLISHABLE_KEY',
        '',
      ),
    };
  }

  async getTopupOrderStatus(userId: string, orderId: string) {
    let order = await this.prisma.topupOrder.findFirst({
      where: { id: orderId, userId },
    });
    if (!order) {
      throw new Error('Top-up order not found');
    }

    if (
      order.status === TopupOrderStatus.PENDING &&
      order.stripePaymentIntentId &&
      this.stripe
    ) {
      try {
        this.logger.log(
          `[TopupOrderStatus] Actively querying Stripe for intent: ${order.stripePaymentIntentId}`,
        );
        const paymentIntent = await this.stripe.paymentIntents.retrieve(
          order.stripePaymentIntentId,
        );

        if (paymentIntent.status === 'succeeded') {
          this.logger.log(
            `[TopupOrderStatus] Stripe payment succeeded! Running dynamic reconciliation for order: ${order.id}`,
          );
          await this.handlePaymentIntentSucceeded({
            id: `direct_recon_${randomUUID()}`,
            type: 'payment_intent.succeeded',
            data: { object: paymentIntent },
          });

          const updated = await this.prisma.topupOrder.findFirst({
            where: { id: orderId, userId },
          });
          if (updated) {
            order = updated;
          }
        }
      } catch (stripeErr: any) {
        this.logger.warn(
          `[TopupOrderStatus] Failed active Stripe verification check: ${stripeErr.message}`,
        );
      }
    }

    return {
      orderId: order.id,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      transactionId: order.financeTransactionId || order.id,
      createdAt: order.updatedAt,
    };
  }

  async processStripeWebhook(signature: string | undefined, rawBody: Buffer) {
    if (!this.stripe) {
      throw new HttpException(
        { message: 'Stripe is not configured' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
      '',
    );
    if (!signature) {
      throw new Error('Missing stripe signature');
    }

    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
    this.logger.log(`[StripeWebhook] event=${event.type} id=${event.id}`);
    if (event.type === 'payment_intent.succeeded') {
      await this.handlePaymentIntentSucceeded(event);
    }

    if (event.type === 'payout.paid') {
      await this.handlePayoutPaid(event);
    }

    if (
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'payment_intent.canceled'
    ) {
      await this.handlePaymentIntentFailed(event);
    }

    return { received: true };
  }

  private async handlePayoutPaid(event: any) {
    const payout = event.data.object as any;
    this.logger.log(`[StripeWebhook] Processing payout: ${payout.id}`);

    try {
      await this.forwardToGateway(
        'post',
        INTERNAL_API_PATHS.FINANCE.TREASURY.CONFIRM_STRIPE_PAYOUT,
        {
          stripePayoutId: payout.id,
          amount: (payout.amount / 100).toFixed(4), // Convert from cents
          arrivalDate: new Date(payout.arrival_date * 1000).toISOString(),
        },
      );
    } catch (error: any) {
      this.logger.error(
        `[StripeWebhook] Failed to confirm payout ${payout.id}: ${error.message}`,
      );
    }
  }

  private async handlePaymentIntentSucceeded(event: any) {
    const paymentIntent = event.data.object as any;
    const paymentIntentId = paymentIntent.id;
    this.logger.log(
      `[StripeWebhook] Processing successful payment: ${paymentIntentId}`,
    );

    const order = await this.prisma.topupOrder.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (!order) {
      this.logger.warn(
        `[StripeWebhook] missing order for paymentIntent=${paymentIntentId}`,
      );
      return;
    }

    if (order.status === TopupOrderStatus.PAID) {
      return;
    }
    if (
      order.status === TopupOrderStatus.PROCESSING &&
      order.processedEventId === event.id
    ) {
      return;
    }

    await this.prisma.topupOrder.update({
      where: { id: order.id },
      data: { status: TopupOrderStatus.PROCESSING, processedEventId: event.id },
    });

    try {
      await this.financeService.processPaymentWebhook(
        paymentIntentId,
        'SUCCESS',
        Number(order.amount),
      );
    } catch (error: any) {
      this.logger.error(
        `[StripeWebhook] credit failed order=${order.id} paymentIntent=${paymentIntentId} message="${error?.message || 'unknown'}"`,
      );
      await this.prisma.topupOrder.update({
        where: { id: order.id },
        data: {
          status: TopupOrderStatus.FAILED,
          processedEventId: event.id,
        },
      });
      throw error;
    }

    await this.prisma.topupOrder.update({
      where: { id: order.id },
      data: {
        status: TopupOrderStatus.PAID,
        financeTransactionId: `PAY-${paymentIntentId}`,
        processedEventId: event.id,
      },
    });

    try {
      await this.loyaltyService.earnPoints(
        order.userId,
        Number(order.amount),
        'TOPUP',
        `Top-up via ${order.currency}`,
        order.id,
      );
    } catch (err) {
      this.logger.error(
        `[StripeWebhook] Loyalty points earning failed for order=${order.id}: ${err.message}`,
      );
    }

    this.logger.log(
      `[StripeWebhook] Triggering invoice creation for order=${order.id} user=${order.userId}`,
    );
    try {
      await this.billingService.createInvoice({
        userId: order.userId,
        senderName: 'J-Ledger Top-up',
        note: paymentIntent.metadata?.note || `Top-up via ${order.currency}`,
        referenceId: paymentIntentId,
        items: [
          {
            name: `Wallet Top-up (${order.currency})`,
            quantity: 1,
            unitPrice: Number(order.amount),
          },
        ],
      });
    } catch (err) {
      this.logger.error(
        `[StripeWebhook] Invoice creation failed: ${err.message}`,
      );
    }
  }

  private async handlePaymentIntentFailed(event: any) {
    const paymentIntent = event.data.object as any;
    const paymentIntentId = paymentIntent.id;

    const order = await this.prisma.topupOrder.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (!order || order.status === TopupOrderStatus.PAID) {
      return;
    }

    const failedStatus =
      event.type === 'payment_intent.canceled'
        ? TopupOrderStatus.CANCELED
        : TopupOrderStatus.FAILED;

    try {
      await this.financeService.processPaymentWebhook(
        paymentIntentId,
        'FAILED',
        Number(order.amount),
      );
    } catch (err) {
      this.logger.error(
        `Failed to register payment intent failure in finance-service: ${err.message}`,
      );
    }

    await this.prisma.topupOrder.update({
      where: { id: order.id },
      data: { status: failedStatus, processedEventId: event.id },
    });
  }
}
