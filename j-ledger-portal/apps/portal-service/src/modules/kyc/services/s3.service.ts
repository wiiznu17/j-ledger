import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class S3Service {
  private readonly client: S3Client | null = null;
  private readonly bucket: string;
  private readonly isLocal: boolean;
  private readonly uploadDir: string;
  private readonly baseUrl: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly configService: ConfigService) {
    const provider = this.configService.get<string>('STORAGE_PROVIDER_TYPE');
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const hasAwsKeys = !!accessKeyId && !!secretAccessKey && accessKeyId !== 'mock_local_access_key';

    this.isLocal = provider === 'local' || (!isProduction && provider !== 's3') || !hasAwsKeys;
    this.uploadDir = path.resolve(process.cwd(), 'uploads');
    const port = this.configService.get<number>('PORT', 3000);
    this.baseUrl = `http://localhost:${port}`;

    if (this.isLocal) {
      this.logger.log('S3Service initialized in LOCAL/MOCK mode (storing in ./uploads)');
      this.bucket = 'local-kyc-bucket';
    } else {
      this.logger.log('S3Service initialized in AWS S3 mode');
      this.bucket = this.configService.get('AWS_S3_BUCKET_NAME');
      this.client = new S3Client({
        region: this.configService.get('AWS_REGION') || 'ap-southeast-1',
        credentials: {
          accessKeyId: accessKeyId!,
          secretAccessKey: secretAccessKey!,
        },
      });
    }
  }

  async uploadFile(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    if (this.isLocal) {
      try {
        const targetPath = path.join(this.uploadDir, key);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, body);
        this.logger.debug(`[LOCAL S3] Uploaded file to: ${targetPath}`);
        return `${this.baseUrl}/uploads/${key}`;
      } catch (error) {
        this.logger.error(`[LOCAL S3] Failed to save file locally: ${key}`, error);
        throw error;
      }
    }

    try {
      this.logger.debug(`Uploading file to S3: ${key}`);
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      });

      await this.client!.send(command);
      return `https://${this.bucket}.s3.${this.configService.get('AWS_REGION')}.amazonaws.com/${key}`;
    } catch (error) {
      this.logger.error(`Failed to upload to S3: ${key}`, error);
      throw error;
    }
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    if (this.isLocal) {
      return `${this.baseUrl}/uploads/${key}`;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client!, command, { expiresIn });
  }

  async getFile(key: string): Promise<Buffer> {
    if (this.isLocal) {
      try {
        const targetPath = path.join(this.uploadDir, key);
        return await fs.readFile(targetPath);
      } catch (error) {
        this.logger.warn(
          `[LOCAL S3] File ${key} not found on local disk. Returning fallback mock buffer.`,
        );
        return Buffer.from('mock-file-content');
      }
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client!.send(command);
      const chunks = [];
      const stream = response.Body as any;
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Failed to get file from S3: ${key}`, error);
      throw error;
    }
  }
}
