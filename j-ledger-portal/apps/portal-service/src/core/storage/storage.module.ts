import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { STORAGE_PROVIDER } from './storage.interface';
import { S3StorageProvider } from './s3-storage.provider';
import { LocalStorageProvider } from './local-storage.provider';

@Global()
@Module({
  providers: [
    StorageService,
    LocalStorageProvider,
    S3StorageProvider,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (
        configService: ConfigService,
        s3Provider: S3StorageProvider,
        localProvider: LocalStorageProvider,
      ) => {
        const providerType = configService.get<string>('STORAGE_PROVIDER_TYPE');
        const nodeEnv = configService.get<string>('NODE_ENV');
        const hasAwsKeys = !!configService.get<string>('AWS_ACCESS_KEY_ID');

        // Use S3 only if explicitly set to 's3' or if in production with AWS keys configured
        if (providerType === 's3' || (nodeEnv === 'production' && providerType !== 'local' && hasAwsKeys)) {
          return s3Provider;
        }

        return localProvider;
      },
      inject: [ConfigService, S3StorageProvider, LocalStorageProvider],
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
