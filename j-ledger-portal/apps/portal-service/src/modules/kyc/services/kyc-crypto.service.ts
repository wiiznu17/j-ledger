import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'crypto';

@Injectable()
export class KycCryptoService {
  private readonly logger = new Logger(KycCryptoService.name);

  constructor(private readonly configService: ConfigService) {}

  encryptPii(data: string): string {
    const encryptionKey = this.configService.get<string>('PII_ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new InternalServerErrorException(
        'System missing PII encryption capabilities',
      );
    }
    const iv = randomBytes(12); // เป็นค่าที่สร้างขึ้นมาแบบสุ่มเพื่อความปลอดภัยของข้อมูล เช่น 23f0e1c8a3d9
    const key = Buffer.from(encryptionKey, 'hex'); // เป็นค่าที่กำหนดไว้ใน .env เช่น 12345678901234567890123456789012
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decryptPii(encryptedData: string): string {
    const encryptionKey = this.configService.get<string>('PII_ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new InternalServerErrorException(
        'System missing PII decryption capabilities',
      );
    }

    try {
      const [ivHex, authTagHex, encryptedHex] = encryptedData.split(':');
      if (!ivHex || !authTagHex || !encryptedHex) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const key = Buffer.from(encryptionKey, 'hex');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);

      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      this.logger.error(`Decryption failed: ${error.message}`);
      throw new Error('Could not decrypt PII data');
    }
  }

  hashBuffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  hashString(str: string): string {
    return createHash('sha256').update(str, 'utf8').digest('hex');
  }

  parseDate(dateStr: string | null): Date | null {
    if (!dateStr) return null;

    // Split by /, space, or dot
    const parts = dateStr.split(/[\/\s.]+/).filter(Boolean);
    if (parts.length < 3) return null;

    const day = parseInt(parts[0]);
    const month = parts[1];
    let year = parseInt(parts[2]);

    // Handle Buddhist Era (BE) - Thai years are usually > 2400
    if (year > 2400) {
      year -= 543;
    }

    const d = new Date(year, this.mapMonth(month), day);
    return isNaN(d.getTime()) ? null : d;
  }

  mapMonth(monthStr: string): number {
    const thaiMonths = [
      'ม.ค.',
      'ก.พ.',
      'มี.ค.',
      'เม.ย.',
      'พ.ค.',
      'มิ.ย.',
      'ก.ค.',
      'ส.ค.',
      'ก.ย.',
      'ต.ค.',
      'พ.ย.',
      'ธ.ค.',
    ];
    const engMonths = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    let idx = thaiMonths.findIndex((m) => monthStr.includes(m));
    if (idx === -1)
      idx = engMonths.findIndex((m) =>
        monthStr.toLowerCase().startsWith(m.toLowerCase()),
      );

    return idx === -1 ? 0 : idx;
  }

  maskIdCardNumber(id: string): string {
    if (!id || id.length < 13) return id;
    // Format: X-XXXX-XXXXX-XX-X -> 1-2345-XXXXX-01-2
    return `${id.slice(0, 1)}-${id.slice(1, 5)}-XXXXX-${id.slice(10, 12)}-${id.slice(12)}`;
  }
}
