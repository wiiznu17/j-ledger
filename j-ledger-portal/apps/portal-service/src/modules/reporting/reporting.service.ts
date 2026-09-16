import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { INTERNAL_API_PATHS } from '@repo/dto';

@Injectable()
export class ReportingService {
  private readonly apiGatewayUrl: string;
  private readonly internalSecret: string;
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiGatewayUrl = this.configService.get<string>(
      'FINANCE_SERVICE_URL',
      'http://localhost:8081',
    );
    const secret = this.configService.get<string>('JLEDGER_INTERNAL_SECRET');
    if (!secret) {
      throw new Error('JLEDGER_INTERNAL_SECRET is required in environment');
    }
    this.internalSecret = secret;
  }

  private async forwardToGateway<T = any>(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    paramsOrData?: unknown,
  ): Promise<T> {
    const url = `${this.apiGatewayUrl}${path}`;
    const headers = {
      'X-Internal-Secret': this.internalSecret,
    };

    const config: any = {
      method: method.toUpperCase(),
      url,
      headers,
    };

    if (method.toLowerCase() === 'get') {
      config.params = paramsOrData;
    } else {
      config.data = paramsOrData;
    }

    const response = await this.httpService.axiosRef.request<T>(config);
    return response.data;
  }

  // ==================== Daily Reports ====================

  async getDailyReport(date?: string) {
    const targetDate = date || new Date().toISOString().split('T')[0];

    const query = new URLSearchParams({
      startDate: `${targetDate}T00:00:00`,
      endDate: `${targetDate}T23:59:59`,
    });

    const transactions = await this.forwardToGateway<any>(
      'get',
      `${INTERNAL_API_PATHS.FINANCE.TRANSACTIONS.BASE}?${query.toString()}`,
    );

    // Calculate metrics
    const content = transactions.content || transactions.data || [];
    const totalTransactions = content.length || 0;
    const totalAmount =
      content.reduce((sum: number, tx: any) => sum + Number(tx.amount), 0) || 0;
    const avgAmount =
      totalTransactions > 0 ? totalAmount / totalTransactions : 0;

    // Breakdown by type
    const byType =
      content.reduce((acc: any, tx: any) => {
        const type = tx.transactionType || tx.type;
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}) || {};

    // Breakdown by status
    const byStatus =
      content.reduce((acc: any, tx: any) => {
        acc[tx.status] = (acc[tx.status] || 0) + 1;
        return acc;
      }, {}) || {};

    return {
      date: targetDate,
      totalTransactions,
      totalAmount,
      avgAmount,
      byType,
      byStatus,
    };
  }

  // ==================== Monthly Reports ====================

  async getMonthlyReport(year?: number, month?: number) {
    const targetYear = year || new Date().getFullYear();
    const targetMonth = month || new Date().getMonth() + 1;

    const startDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
    const endDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-31`;

    // Get transactions from core-service for the month
    const query = new URLSearchParams({
      startDate,
      endDate,
    });

    const transactions = await this.forwardToGateway<any>(
      'get',
      `${INTERNAL_API_PATHS.FINANCE.TRANSACTIONS.BASE}?${query.toString()}`,
    );

    // Calculate metrics
    const content = transactions.content || transactions.data || [];
    const totalTransactions = content.length || 0;
    const totalAmount =
      content.reduce((sum: number, tx: any) => sum + Number(tx.amount), 0) || 0;
    const avgAmount =
      totalTransactions > 0 ? totalAmount / totalTransactions : 0;

    // Breakdown by type
    const byType =
      content.reduce((acc: any, tx: any) => {
        const type = tx.transactionType || tx.type;
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}) || {};

    // Breakdown by status
    const byStatus =
      content.reduce((acc: any, tx: any) => {
        acc[tx.status] = (acc[tx.status] || 0) + 1;
        return acc;
      }, {}) || {};

    return {
      year: targetYear,
      month: targetMonth,
      totalTransactions,
      totalAmount,
      avgAmount,
      byType,
      byStatus,
      revenue: totalAmount * 0.01, // Assuming 1% fee
    };
  }

  // ==================== User Statistics ====================

  async getUserStatistics() {
    // TODO: Get all users from identity module
    // For now, return placeholder data
    return {
      totalUsers: 0,
      activeUsers: 0,
      inactiveUsers: 0,
      newUsers: 0,
      byStatus: {},
      kycStatus: {
        verified: 0,
        pending: 0,
        notStarted: 0,
      },
    };
  }

  // ==================== Admin BI Analytics ====================

  async getAdminAnalytics(query: {
    timeframe?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { startDate, endDate, label } = this.resolveReportRange(query);
    const previousRange = this.resolvePreviousRange(startDate, endDate);
    const txQuery = new URLSearchParams({
      page: '0',
      size: '500',
      startDate: `${startDate}T00:00:00`,
      endDate: `${endDate}T23:59:59`,
    });
    const previousTxQuery = new URLSearchParams({
      page: '0',
      size: '500',
      startDate: `${previousRange.startDate}T00:00:00`,
      endDate: `${previousRange.endDate}T23:59:59`,
    });

    const [transactionsResponse, previousTransactionsResponse, reconciliationResponse, treasurySummary] =
      await Promise.all([
        this.forwardToGateway<any>(
          'get',
          `${INTERNAL_API_PATHS.FINANCE.TRANSACTIONS.BASE}?${txQuery.toString()}`,
        ),
        this.forwardToGateway<any>(
          'get',
          `${INTERNAL_API_PATHS.FINANCE.TRANSACTIONS.BASE}?${previousTxQuery.toString()}`,
        ),
        this.getReconciliationReports({ page: 1, limit: 50 }),
        this.forwardToGateway<any>(
          'get',
          INTERNAL_API_PATHS.FINANCE.TREASURY.SUMMARY,
        ).catch(() => null),
      ]);

    const transactions = this.extractContent(transactionsResponse);
    const previousTransactions = this.extractContent(previousTransactionsResponse);
    const reconciliationReports = this.extractContent(reconciliationResponse);
    const latestReconciliation = reconciliationReports[0] || null;
    const completedTransactions = transactions.filter(
      (tx: any) => tx.status === 'COMPLETED',
    );
    const previousCompletedTransactions = previousTransactions.filter(
      (tx: any) => tx.status === 'COMPLETED',
    );
    const networkVolume = this.sumAmount(completedTransactions);
    const previousNetworkVolume = this.sumAmount(previousCompletedTransactions);
    const feeEarnings = completedTransactions.reduce(
      (sum: number, tx: any) => sum + Number(tx.fee || 0),
      0,
    );
    const fallbackMdrYield = networkVolume * 0.03;
    const totalAssets =
      Number(
        latestReconciliation?.totalSystemAssets ??
          treasurySummary?.totalRealAssets ??
          treasurySummary?.totalBankBalance ??
          0,
      ) || 0;
    const totalLiabilities =
      Number(
        latestReconciliation?.totalUserLiabilities ??
          treasurySummary?.totalCustomerLiability ??
          0,
      ) || 0;
    const discrepancy = Number(latestReconciliation?.discrepancy || 0);
    const reconciledRatio =
      totalAssets > 0
        ? Math.max(0, 100 - (Math.abs(discrepancy) / totalAssets) * 100)
        : latestReconciliation
          ? 100
          : 0;

    return {
      filters: {
        timeframe: query.timeframe || '30D',
        startDate,
        endDate,
        label,
      },
      stats: {
        networkVolume,
        volumeGrowth: this.growthPercent(networkVolume, previousNetworkVolume),
        feeEarnings: feeEarnings || fallbackMdrYield,
        totalAssets,
        totalLiabilities,
        solvencySurplus: totalAssets - totalLiabilities,
        reconciledRatio,
        totalTransactions: transactions.length,
        completedTransactions: completedTransactions.length,
        failedTransactions: transactions.filter((tx: any) => tx.status === 'FAILED')
          .length,
      },
      chartData: this.buildVolumeBuckets(completedTransactions, startDate, endDate),
      latestReconciliation,
    };
  }

  private extractContent(response: any) {
    if (Array.isArray(response)) return response;
    return response?.content || response?.data || [];
  }

  private sumAmount(transactions: any[]) {
    return transactions.reduce(
      (sum: number, tx: any) => sum + Number(tx.amount || 0),
      0,
    );
  }

  private growthPercent(current: number, previous: number) {
    if (!previous) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 10000) / 100;
  }

  private resolveReportRange(query: {
    timeframe?: string;
    startDate?: string;
    endDate?: string;
  }) {
    if (query.startDate && query.endDate) {
      return {
        startDate: query.startDate,
        endDate: query.endDate,
        label: 'Custom',
      };
    }

    const end = new Date();
    const start = new Date(end);
    const timeframe = query.timeframe || '30D';

    if (timeframe === '7D') start.setDate(end.getDate() - 6);
    else if (timeframe === '90D') start.setDate(end.getDate() - 89);
    else if (timeframe === 'YTD') start.setMonth(0, 1);
    else start.setDate(end.getDate() - 29);

    return {
      startDate: this.formatDate(start),
      endDate: this.formatDate(end),
      label: timeframe,
    };
  }

  private resolvePreviousRange(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    const days = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
    );
    const previousEnd = new Date(start);
    previousEnd.setDate(start.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousEnd.getDate() - days + 1);

    return {
      startDate: this.formatDate(previousStart),
      endDate: this.formatDate(previousEnd),
    };
  }

  private formatDate(date: Date) {
    return date.toISOString().split('T')[0];
  }

  private buildVolumeBuckets(
    transactions: any[],
    startDate: string,
    endDate: string,
  ) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    const totalDays = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
    );
    const bucketCount = Math.min(6, totalDays);
    const bucketSize = Math.ceil(totalDays / bucketCount);

    return Array.from({ length: bucketCount }).map((_, index) => {
      const bucketStart = new Date(start);
      bucketStart.setDate(start.getDate() + index * bucketSize);
      const bucketEnd = new Date(bucketStart);
      bucketEnd.setDate(bucketStart.getDate() + bucketSize - 1);
      if (bucketEnd > end) bucketEnd.setTime(end.getTime());

      const amount = transactions
        .filter((tx: any) => {
          const createdAt = new Date(tx.createdAt);
          return createdAt >= bucketStart && createdAt <= new Date(`${this.formatDate(bucketEnd)}T23:59:59`);
        })
        .reduce((sum: number, tx: any) => sum + Number(tx.amount || 0), 0);

      return {
        label:
          bucketCount <= 4
            ? this.formatDate(bucketStart)
            : `P${index + 1}`,
        startDate: this.formatDate(bucketStart),
        endDate: this.formatDate(bucketEnd),
        amount,
      };
    });
  }

  // ==================== Reconciliation Reports ====================

  async getReconciliationReports(query: {
    page?: number;
    limit?: number;
    reportDate?: string;
    status?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 50;

    const params: Record<string, string> = {
      page: page.toString(),
      limit: limit.toString(),
    };

    if (query.reportDate) params.reportDate = query.reportDate;
    if (query.status) params.status = query.status;

    return this.forwardToGateway<any>(
      'get',
      INTERNAL_API_PATHS.FINANCE.SYSTEM.RECONCILE.REPORTS,
      params,
    );
  }

  async getReconciliationReport(id: string) {
    return this.forwardToGateway<any>(
      'get',
      INTERNAL_API_PATHS.FINANCE.SYSTEM.RECONCILE.DETAIL(id),
    );
  }

  async runReconciliation() {
    return this.forwardToGateway<any>(
      'post',
      INTERNAL_API_PATHS.FINANCE.SYSTEM.RECONCILE.TRIGGER,
    );
  }

  async getOutbox(query?: {
    status?: string;
    eventType?: string;
    page?: number;
    limit?: number;
  }) {
    const params: Record<string, string> = {};
    if (query?.status) params.status = query.status;
    if (query?.eventType) params.eventType = query.eventType;
    if (query?.page) params.page = query.page.toString();
    if (query?.limit) params.limit = query.limit.toString();

    return this.forwardToGateway<any>(
      'get',
      INTERNAL_API_PATHS.FINANCE.SYSTEM.OUTBOX.BASE,
      params,
    );
  }

  async retryOutbox(id: string) {
    return this.forwardToGateway<any>(
      'post',
      INTERNAL_API_PATHS.FINANCE.SYSTEM.OUTBOX.RETRY(id),
    );
  }
}
