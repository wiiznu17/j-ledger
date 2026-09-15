import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageProvider } from './storage.interface';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class LocalStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly uploadDir: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = path.resolve(process.cwd(), 'uploads');
    const port = this.configService.get<number>('PORT', 3000);
    this.baseUrl = `http://localhost:${port}`;
  }

  async uploadFile(
    file: Buffer,
    fileName: string,
    mimeType: string,
    folder: string = 'uploads',
  ): Promise<{ url: string; key: string }> {
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `${folder}/${Date.now()}-${sanitizedFileName}`;
    const targetPath = path.join(this.uploadDir, key);

    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, file);
      this.logger.log(`[LOCAL STORAGE] Saved file to ${targetPath}`);

      const url = `${this.baseUrl}/uploads/${key}`;
      return { url, key };
    } catch (error) {
      this.logger.error(`[LOCAL STORAGE] Failed to write file: ${error.message}`);
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    const targetPath = path.join(this.uploadDir, key);
    try {
      await fs.rm(targetPath, { force: true });
      this.logger.log(`[LOCAL STORAGE] Deleted file at ${targetPath}`);
    } catch (error) {
      this.logger.warn(`[LOCAL STORAGE] Failed to delete file: ${error.message}`);
    }
  }

  async getSignedUrl(key: string, _expiresIn = 3600): Promise<string> {
    return `${this.baseUrl}/uploads/${key}`;
  }
}
