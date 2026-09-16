import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FinanceService } from '../../core/finance/finance.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
    private readonly configService: ConfigService,
  ) {}

  async createInvoice(dto: CreateInvoiceDto) {
    this.logger.log(
      `[createInvoice] Starting invoice creation for user=${dto.userId}`,
    );
    const { items, ...rest } = dto;

    try {
      const settings = await this.financeService.getSystemSettings();
      const vatRate = dto.partnerId ? Number(settings.vatRate || 0.07) : 0;
      const minAmount = Number(settings.minMerchantPayment || 5.0);

      // Calculate totals with consistent rounding
      const subtotal = items.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0,
      );
      const tax = dto.partnerId ? Number((subtotal * vatRate).toFixed(2)) : 0;
      const total = subtotal + tax;

      if (dto.partnerId && total < minAmount) {
        throw new BadRequestException(
          `Minimum invoice amount is ฿${minAmount.toFixed(2)}`,
        );
      }

      this.logger.log(
        `[createInvoice] Totals calculated: subtotal=${subtotal.toFixed(2)}, tax=${tax.toFixed(2)}, total=${total.toFixed(2)} (VAT Rate: ${vatRate})`,
      );

      // Generate Invoice Number: INV-YYYYMMDD-XXXXXX-RAND
      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomPart = randomBytes(2).toString('hex').toUpperCase();
      const count = await this.prisma.invoice.count();
      const invoiceNumber = `INV-${datePart}-${(count + 1).toString().padStart(4, '0')}-${randomPart}`;
      this.logger.log(
        `[createInvoice] Generated unique number: ${invoiceNumber}`,
      );

      // Calculate Platform Fees if partnerId is provided
      let feeRate = null;
      let feeAmount = null;
      let feeTax = null;

      if (dto.partnerId) {
        const partner = await this.prisma.partner.findUnique({
          where: { id: dto.partnerId },
        });
        if (partner) {
          feeRate = partner.feeRate;
          // Calculate fee from TOTAL amount (Gross) and round to 2 decimals
          feeAmount = Number((total * Number(feeRate)).toFixed(2));
          feeTax = Number((feeAmount * vatRate).toFixed(2));
          this.logger.log(
            `[createInvoice] Platform fees calculated: feeAmount=${feeAmount.toFixed(2)}, feeTax=${feeTax.toFixed(2)} (VAT Rate: ${vatRate})`,
          );
        }
      }

      const result = await this.prisma.invoice.create({
        data: {
          ...rest,
          invoiceNumber,
          amount: subtotal,
          tax,
          total,
          feeRate,
          feeAmount,
          feeTax,
          status: InvoiceStatus.PENDING,
          items: {
            create: items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              amount: item.unitPrice * item.quantity,
            })),
          },
        },
        include: {
          items: true,
        },
      });
      this.logger.log(
        `[createInvoice] Successfully created invoice: ${result.id}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `[createInvoice] CRITICAL ERROR: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async getInvoices(userId: string) {
    return this.prisma.invoice.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInvoiceById(id: string, userId: string) {
    this.logger.log(
      `[getInvoiceById] Searching invoice for user=${userId} with identifier="${id}"`,
    );

    const searchConditions: any[] = [
      { id },
      { invoiceNumber: id },
      { referenceId: id },
    ];

    if (id.startsWith('PAY-')) {
      searchConditions.push({ referenceId: id.replace('PAY-', '') });
    }

    if (id.startsWith('TXN')) {
      try {
        const txn = await this.financeService.getTransactionByUuid(id);
        if (txn && txn.referenceId) {
          const fallbackRef = txn.referenceId;
          this.logger.log(
            `[getInvoiceById] Resolved TXN ${id} to referenceId: ${fallbackRef}`,
          );
          searchConditions.push({ referenceId: fallbackRef });
          if (fallbackRef.startsWith('PAY-')) {
            searchConditions.push({
              referenceId: fallbackRef.replace('PAY-', ''),
            });
          } else {
            searchConditions.push({ referenceId: `PAY-${fallbackRef}` });
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `[getInvoiceById] Failed to resolve TXN ${id} via finance-service: ${err.message}`,
        );
      }
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        userId,
        OR: searchConditions,
      },
      include: { items: true },
    });

    if (!invoice) {
      this.logger.log(
        `[getInvoiceById] Invoice not found in Invoice table. Searching in TopupOrder for identifier="${id}"`,
      );
      const stripeId = id.startsWith('PAY-') ? id.replace('PAY-', '') : id;
      const topupOrder = await this.prisma.topupOrder.findFirst({
        where: {
          userId,
          OR: [
            { id },
            { stripePaymentIntentId: stripeId },
            { financeTransactionId: id },
            { financeTransactionId: stripeId }
          ]
        }
      });

      if (topupOrder) {
        this.logger.log(
          `[getInvoiceById] Found matching TopupOrder: ${topupOrder.id}. Synthesizing invoice response.`,
        );

        let dynamicNote = 'Top-up';
        const stripeSecret = this.configService.get<string>('STRIPE_SECRET_KEY');
        if (topupOrder.stripePaymentIntentId && stripeSecret) {
          try {
            const Stripe = require('stripe');
            const stripeClient = new Stripe(stripeSecret);
            const intent = await stripeClient.paymentIntents.retrieve(
              topupOrder.stripePaymentIntentId,
            );
            if (intent && intent.metadata && intent.metadata.note) {
              dynamicNote = intent.metadata.note;
            }
          } catch (stripeErr: any) {
            this.logger.warn(
              `[getInvoiceById] Could not fetch note from Stripe: ${stripeErr.message}`,
            );
          }
        }

        return {
          id: topupOrder.id,
          invoiceNumber: `INV-TOPUP-${topupOrder.id.slice(0, 8).toUpperCase()}`,
          userId: topupOrder.userId,
          senderName: 'Top-up via Stripe',
          senderDetail: 'Direct Bank Deposit',
          amount: Number(topupOrder.amount),
          tax: 0,
          feeAmount: 0,
          feeTax: 0,
          total: Number(topupOrder.amount),
          currency: topupOrder.currency,
          status: topupOrder.status === 'PAID' ? 'PAID' : 'PENDING',
          dueDate: null,
          paidAt: topupOrder.updatedAt,
          partnerId: null,
          referenceId: topupOrder.financeTransactionId || `PAY-${topupOrder.stripePaymentIntentId}`,
          note: dynamicNote,
          createdAt: topupOrder.createdAt,
          updatedAt: topupOrder.updatedAt,
          items: [
            {
              id: `item-${topupOrder.id}`,
              invoiceId: topupOrder.id,
              name: 'Top-up funds',
              quantity: 1,
              unitPrice: Number(topupOrder.amount),
              amount: Number(topupOrder.amount),
            },
          ],
        } as any;
      }

      this.logger.log(
        `[getInvoiceById] TopupOrder not found. Searching in MerchantPayment for identifier="${id}"`,
      );

      const merchantPayment = await this.prisma.merchantPayment.findFirst({
        where: {
          OR: [
            { id },
            { referenceId: id },
          ],
        },
        include: {
          merchant: {
            include: {
              partner: {
                include: {
                  profile: true,
                },
              },
            },
          },
        },
      });

      if (merchantPayment) {
        this.logger.log(
          `[getInvoiceById] Found matching MerchantPayment: ${merchantPayment.id}. Validating user ownership.`,
        );

        let isOwner = false;
        try {
          const userWallet = await this.financeService.getWallet(userId);
          const txn = await this.financeService.getTransactionByUuid(merchantPayment.referenceId || id);
          if (userWallet && txn && Number(txn.fromWalletId) === Number(userWallet.id)) {
            isOwner = true;
          }
        } catch (err: any) {
          this.logger.warn(
            `[getInvoiceById] Failed to validate merchant payment ownership: ${err.message}`,
          );
        }

        if (!isOwner) {
          this.logger.warn(
            `[getInvoiceById] User ${userId} is not the owner of MerchantPayment ${merchantPayment.id}`,
          );
          throw new NotFoundException('Invoice not found');
        }

        this.logger.log(
          `[getInvoiceById] Ownership validated. Synthesizing invoice response for merchant payment.`,
        );

        const amountNum = Number(merchantPayment.amount);
        const vatRate = 0.07;
        const merchantVat = Number((amountNum * (vatRate / (1 + vatRate))).toFixed(2));

        return {
          id: merchantPayment.id,
          invoiceNumber: `INV-PAY-${merchantPayment.id.slice(0, 8).toUpperCase()}`,
          userId: userId,
          senderName: merchantPayment.merchant.name,
          senderDetail: merchantPayment.merchant.category || 'Partner Store',
          amount: amountNum,
          tax: merchantVat,
          feeAmount: 0,
          feeTax: 0,
          total: amountNum,
          currency: merchantPayment.currency,
          status: merchantPayment.status === 'COMPLETED' ? 'PAID' : 'PENDING',
          dueDate: null,
          paidAt: merchantPayment.updatedAt,
          partnerId: merchantPayment.merchant.partnerId,
          referenceId: merchantPayment.referenceId || merchantPayment.id,
          note: merchantPayment.note || 'Merchant Payment',
          createdAt: merchantPayment.createdAt,
          updatedAt: merchantPayment.updatedAt,
          items: [
            {
              id: `item-${merchantPayment.id}`,
              invoiceId: merchantPayment.id,
              name: `Payment to ${merchantPayment.merchant.name}`,
              quantity: 1,
              unitPrice: amountNum,
              amount: amountNum,
            },
          ],
        } as any;
      }

      this.logger.warn(
        `[getInvoiceById] Invoice, TopupOrder, and MerchantPayment NOT FOUND for user=${userId} with identifier="${id}"`,
      );
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  async payInvoice(id: string, userId: string) {
    const invoice = await this.getInvoiceById(id, userId);

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already paid');
    }

    // 1. Process payment with Finance Service
    try {
      if (invoice.partnerId) {
        // REAL SETTLEMENT & VAT SEPARATION
        const [userWallet, partner, systemPartner] = await Promise.all([
          this.financeService.getWallet(userId),
          this.prisma.partner.findUnique({ where: { id: invoice.partnerId } }),
          this.prisma.partner.findFirst({ where: { taxId: '0000000000000' } }),
        ]);

        if (!userWallet)
          throw new BadRequestException('Customer wallet not found');
        if (!partner || !partner.financeAccounts)
          throw new BadRequestException('Merchant accounts not found');
        if (!systemPartner || !systemPartner.financeAccounts)
          throw new BadRequestException('System accounts not found');

        const mAcc = partner.financeAccounts as any;
        const sAcc = systemPartner.financeAccounts as any;

        // Calculate Split (All based on rounded values recorded at creation)
        const total = Number(invoice.total);
        const merchantVat = Number(invoice.tax);
        const systemFee = Number(invoice.feeAmount || 0);
        const systemVat = Number(invoice.feeTax || 0);

        // Merchant Net is the residual to ensure total balance
        const merchantNet = total - merchantVat - systemFee - systemVat;

        this.logger.log(
          `[payInvoice] Executing 4-way split for invoice=${invoice.id}: Total=${total.toFixed(2)}, Net=${merchantNet.toFixed(2)}, MVAT=${merchantVat.toFixed(2)}, Fee=${systemFee.toFixed(2)}, SVAT=${systemVat.toFixed(2)}`,
        );

        // Leg 1: Merchant Net (To Pending)
        await this.financeService.performTransfer({
          fromAccountId: userWallet.walletId,
          toAccountId: mAcc.pending,
          amount: merchantNet.toFixed(2),
          idempotencyKey: `pay_leg_net_${invoice.id}`,
          type: 'MERCHANT_PAYMENT',
          note: `Payment for INV ${invoice.invoiceNumber}`,
          metadata: {
            isMerchantPayment: true,
            totalAmount: total.toFixed(2),
          },
        });

        // Leg 2: Merchant VAT (To VAT)
        if (Number(merchantVat.toFixed(2)) > 0 && mAcc.vat) {
          await this.financeService.performTransfer({
            fromAccountId: userWallet.walletId,
            toAccountId: mAcc.vat,
            amount: merchantVat.toFixed(2),
            idempotencyKey: `pay_leg_vat_${invoice.id}`,
            type: 'MERCHANT_PAYMENT',
            note: `VAT for INV ${invoice.invoiceNumber}`,
            metadata: {
              silent: true,
              isMerchantPayment: true,
              parentIdempotencyKey: `pay_leg_net_${invoice.id}`,
            },
          });
        }

        // Leg 3: System Fee (To System Revenue)
        if (Number(systemFee.toFixed(2)) > 0 && sAcc.revenue) {
          await this.financeService.performTransfer({
            fromAccountId: userWallet.walletId,
            toAccountId: sAcc.revenue,
            amount: systemFee.toFixed(2),
            idempotencyKey: `pay_leg_fee_${invoice.id}`,
            type: 'MERCHANT_PAYMENT',
            note: `Fee for INV ${invoice.invoiceNumber}`,
            metadata: {
              silent: true,
              isMerchantPayment: true,
              parentIdempotencyKey: `pay_leg_net_${invoice.id}`,
            },
          });
        }

        // Leg 4: System VAT (To System VAT Payable)
        if (Number(systemVat.toFixed(2)) > 0 && sAcc.vat_payable) {
          await this.financeService.performTransfer({
            fromAccountId: userWallet.walletId,
            toAccountId: sAcc.vat_payable,
            amount: systemVat.toFixed(2),
            idempotencyKey: `pay_leg_svat_${invoice.id}`,
            type: 'MERCHANT_PAYMENT',
            note: `Service VAT for INV ${invoice.invoiceNumber}`,
            metadata: {
              silent: true,
              isMerchantPayment: true,
              parentIdempotencyKey: `pay_leg_net_${invoice.id}`,
            },
          });
        }
      }

      const updatedInvoice = await this.prisma.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
          referenceId: `SPLIT_PAY_${invoice.id}`,
        },
        include: { items: true },
      });

      this.logger.log(
        `[payInvoice] Successfully processed payment for invoice: ${id}`,
      );
      return updatedInvoice;
    } catch (error) {
      this.logger.error(
        `[payInvoice] Payment failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
