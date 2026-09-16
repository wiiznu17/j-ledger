import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './core/prisma/prisma.module';
import { RedisModule } from './core/redis/redis.module';
import { IdentityModule } from './modules/identity/identity.module';
import { KycModule } from './modules/kyc/kyc.module';
import { AdminModule } from './admin/admin.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { AuditModule } from './modules/audit/audit.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { NotificationModule } from './modules/notification/notification.module';
import { BillingModule } from './modules/billing/billing.module';
import { StorageModule } from './core/storage/storage.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { DealModule } from './modules/deals/deal.module';
import { BannerModule } from './modules/banners/banner.module';
import { MerchantModule } from './modules/merchant/merchant.module';
import { TerminalModule } from './terminal/terminal.module';
import { UserModule } from './user/user.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { ScheduledTransferModule } from './modules/scheduled-transfer/scheduled-transfer.module';
import { HealthController } from './core/health/health.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerStorageRedisService } from './core/redis/throttler-storage-redis.service';
import { LoggerModule } from 'nestjs-pino';
import { TraceMiddleware } from './core/common/middleware/trace.middleware';
import { FinanceModule } from './core/finance/finance.module';
import { randomUUID } from 'crypto';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        customProps: () => ({
          service: 'portal-service',
        }),
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        autoLogging: true,
        genReqId: (req: any) =>
          req.headers['x-trace-id'] || req.id || randomUUID(),
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    FinanceModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ThrottlerStorageRedisService],
      useFactory: (storage: ThrottlerStorageRedisService) => {
        const isDev = process.env.NODE_ENV !== 'production';
        return {
          throttlers: [
            {
              name: 'default',
              ttl: 60000,
              limit: isDev ? 1000 : 60,
            },
            {
              name: 'otp-send',
              ttl: 60000,
              limit: isDev ? 1000 : 3,
            },
            {
              name: 'otp-verify',
              ttl: 300000,
              limit: isDev ? 1000 : 3,
            },
            {
              name: 'login',
              ttl: 300000,
              limit: isDev ? 1000 : 5,
            },
            {
              name: 'refreshToken',
              ttl: 60000,
              limit: isDev ? 1000 : 10,
            },
            {
              name: 'pinVerify',
              ttl: 300000,
              limit: isDev ? 1000 : 5,
            },
            {
              name: 'biometricVerify',
              ttl: 60000,
              limit: isDev ? 1000 : 10,
            },
            {
              name: 'accountDeletion',
              ttl: 3600000,
              limit: isDev ? 1000 : 2,
            },
          ],
          storage,
        };
      },
    }),
    IdentityModule,
    KycModule,
    AdminModule,
    IntegrationModule,
    AuditModule,
    ReportingModule,
    NotificationModule,
    BillingModule,
    StorageModule,
    LoyaltyModule,
    DealModule,
    BannerModule,
    MerchantModule,
    TerminalModule,
    UserModule,
    FraudModule,
    ScheduledTransferModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TraceMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
