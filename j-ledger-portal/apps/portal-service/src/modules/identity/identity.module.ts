import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { IdentityService } from './identity.service';
import { UserAuthService } from './services/user-auth.service';
import { UserRegistrationService } from './services/user-registration.service';
import { UserProfileService } from './services/user-profile.service';
import { UserSecurityService } from './services/user-security.service';
import { UserAdminService } from './services/user-admin.service';
import { ConfigService } from '@nestjs/config';
import { AwsSnsSmSProvider } from '../integrations/providers/sms-provider.aws-sns';
import { SmsProviderMock } from '../integrations/providers/sms-provider.mock';
import { ISmsProvider as ISmsProviderSymbol } from '../integrations/interfaces/sms-provider.interface';
import { JwtStrategy } from './jwt.strategy';
import { IntegrationModule } from '../integration/integration.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.CUSTOMER_JWT_SECRET;
        if (!secret || secret.length < 32) {
          throw new Error('CUSTOMER_JWT_SECRET is missing or too short');
        }
        return {
          secret: secret,
          signOptions: { expiresIn: '3m' },
        };
      },
    }),
    IntegrationModule,
    NotificationModule,
  ],
  providers: [
    IdentityService,
    UserAuthService,
    UserRegistrationService,
    UserProfileService,
    UserSecurityService,
    UserAdminService,
    {
      provide: ISmsProviderSymbol,
      useFactory: (configService: ConfigService) => {
        const providerType = configService.get<string>('SMS_PROVIDER_TYPE', 'mock');
        const nodeEnv = configService.get<string>('NODE_ENV', 'development');
        if (providerType === 'aws' && nodeEnv === 'production') {
          return new AwsSnsSmSProvider(configService);
        }
        return new SmsProviderMock();
      },
      inject: [ConfigService],
    },
    JwtStrategy,
  ],
  exports: [
    JwtModule, // needed for guard registration-auth.guard.ts
    IdentityService,
    UserAuthService,
    UserRegistrationService,
    UserProfileService,
    UserSecurityService,
    UserAdminService,
  ],
})
export class IdentityModule {}
