import { Injectable, Logger } from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleVisionService {
  private readonly client: ImageAnnotatorClient;
  private readonly logger = new Logger(GoogleVisionService.name);

  constructor(private readonly configService: ConfigService) {
    const credentialsJson = this.configService.get(
      'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    );
    const credentialsPath = this.configService.get(
      'GOOGLE_APPLICATION_CREDENTIALS',
    );

    if (credentialsJson) {
      this.logger.log('Initializing Google Vision using JSON string from env');
      const credentials = JSON.parse(credentialsJson);
      this.client = new ImageAnnotatorClient({ credentials });
    } else if (credentialsPath) {
      this.logger.log(
        `Initializing Google Vision using key file: ${credentialsPath}`,
      );
      // When keyFilename is provided (or GOOGLE_APPLICATION_CREDENTIALS env is set),
      // the SDK handles it automatically.
      this.client = new ImageAnnotatorClient({ keyFilename: credentialsPath });
    } else {
      this.logger.warn(
        'Google Cloud credentials (JSON or Path) not found in environment',
      );
    }
  }

  async extractIdCardData(imageBuffer: Buffer) {
    const ocrProvider = this.configService.get<string>('KYC_OCR_PROVIDER_TYPE');
    const isMock = ocrProvider === 'mock' || !this.client;

    if (isMock) {
      this.logger.log(
        '[MOCK OCR] Google Vision client not available or mock mode active — returning mock ID card data',
      );
      return {
        idNumber: '1234567890123',
        prefixTh: 'นาย',
        firstNameTh: 'สมชาย',
        lastNameTh: 'เข็มกลัด',
        prefixEn: 'Mr.',
        firstNameEn: 'Somchai',
        lastNameEn: 'Khemklad',
        dateOfBirth: '01 ม.ค. 2533',
        idCardIssueDate: '01 ม.ค. 2560',
        idCardExpiryDate: '01 ม.ค. 2570',
        religion: 'พุทธ',
        registeredAddress: '123/45 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ',
        subdistrict: 'ห้วยขวาง',
        district: 'ห้วยขวาง',
        province: 'กรุงเทพฯ',
        fullText: 'บัตรประจำตัวประชาชน Thai National ID Card 1 2345 67890 12 3',
      };
    }

    try {
      this.logger.debug('Sending image to Google Cloud Vision...');
      const [result] = await this.client.textDetection(imageBuffer);
      const fullText = result.fullTextAnnotation?.text;

      if (!fullText) {
        this.logger.warn('No text detected on ID card');
        return null;
      }

      this.logger.debug(`Detected text: ${fullText.replace(/\n/g, ' ')}`);

      // Basic parsing logic (can be improved with specialized patterns)
      return this.parseThaiIdCard(fullText);
    } catch (error) {
      this.logger.error('Google Vision API error', error);
      throw error;
    }
  }

  private parseThaiIdCard(text: string) {
    this.logger.debug(`[OCR] Parsing text: ${text}`);

    // 1. ID Number
    const idNumberMatch = text.match(
      /(?:เลขประจำตัวประชาชน|Identification Number)\s*([\d\s-]{13,25})/i,
    );
    const idNumber = idNumberMatch
      ? idNumberMatch[1].replace(/[^\d]/g, '').slice(0, 13)
      : null;

    // 2. Names (Thai)
    const nameThMatch = text.match(
      /(?:ชื่อตัวและชื่อสกุล|Name)\s+(นาย|นาง|นางสาว|Mr\.|Mrs\.|Miss|Ms\.)\s*([\u0E00-\u0E7F\s]+)/i,
    );
    let prefixTh = null;
    let firstNameTh = null;
    let lastNameTh = null;

    if (nameThMatch) {
      prefixTh = nameThMatch[1];
      const fullThaiName = nameThMatch[2].trim().split(/\s+/);
      firstNameTh = fullThaiName[0] || null;
      lastNameTh = fullThaiName[1] || null;
    }

    // 3. Names (English)
    const nameEnMatch = text.match(
      /Name\s+(Mr\.|Mrs\.|Miss|Ms\.|Master)\s*([A-Za-z]+)/i,
    );
    const prefixEn = nameEnMatch ? nameEnMatch[1] : null;
    const firstNameEn = nameEnMatch ? nameEnMatch[2] : null;
    const lastNameEnMatch = text.match(/Last\s+name\s*([A-Za-z]+)/i);
    const lastNameEn = lastNameEnMatch ? lastNameEnMatch[1] : null;

    // 4. Dates - More robust patterns for typos
    const datePattern =
      /([\d]{1,2}\s+[\u0E00-\u0E7F A-Za-z.,]+\s+[\d\(\)]{4,5})/i;

    // 4. Dates - Prioritize Thai B.E. years (handle both Label-Date and Date-Label directions)
    const dobMatch =
      text.match(
        /(?:เกิดวันที่|Date of Birth)\s*([\d]{1,2}\s+[\u0E00-\u0E7F A-Za-z.]+\s+[\d]{4})/i,
      ) ||
      text.match(
        /([\d]{1,2}\s+[\u0E00-\u0E7F A-Za-z.]+\s+[\d]{4})\s*(?:เกิดวันที่|Date of Birth)/i,
      );

    const issueDateMatch =
      text.match(
        /(?:วันออกบัตร|Date of Iss|Date of Ite|Issue Date)\s*([\d]{1,2}\s+[\u0E00-\u0E7F A-Za-z,.]+\s+[\d\sA-Za-z\(\)]{4,5})/i,
      ) ||
      text.match(
        /([\d]{1,2}\s+[\u0E00-\u0E7F A-Za-z,.]+\s+[\d\sA-Za-z\(\)]{4,5})\s*(?:วันออกบัตร|Date of Iss|Date of Ite|Issue Date)/i,
      );

    const expiryDateMatch =
      text.match(
        /(?:วันบัตรหมดอายุ|Date of Exp|Expiry Date)\s*([\d]{1,2}\s+[\u0E00-\u0E7F A-Za-z,.]+\s+[\d]{4})/i,
      ) ||
      text.match(
        /([\d]{1,2}\s+[\u0E00-\u0E7F A-Za-z,.]+\s+[\d]{4})\s*(?:วันบัตรหมดอายุ|Date of Exp|Expiry Date)/i,
      );

    // 5. Address (Multi-line + Sub-parsing)
    // Be more aggressive with labels that end the address
    const addressMatch = text.match(
      /(?:ที่อยู่|Address)\s*([\s\S]+?)(?=\s*(?:วันออกบัตร|Date of Iss|Date of Ite|วันบัตรหมดอายุ|Date of Exp|เจ้าพนักงาน|[\d]{1,2}\s+[\u0E00-\u0E7F]{2,3}\.\s+[\d]{4}))/i,
    );
    let fullAddress = addressMatch
      ? addressMatch[1].replace(/\n/g, ' ').trim()
      : null;

    // Cleanup address if it still has common date suffixes or trailing Thai dates
    if (fullAddress) {
      // 1. Split by known labels that definitely start AFTER the address
      fullAddress = fullAddress
        .split(
          /(?:วันออกบัตร|Date of Iss|Date of Ite|เจ้าพนักงาน|วันบัตรหมดอายุ|Date of Exp)/i,
        )[0]
        .trim();

      // 2. Remove trailing Thai date pattern more robustly
      // Handles: "26 เม.ย. 2568", "26 เม.ย.2568", "26เม.ย.2568", "26 เม.ย. 2568 123" (noise)
      fullAddress = fullAddress
        .replace(/\d{1,2}\s*[\u0E00-\u0E7F.]{2,8}\s*\d{4}.*$/, '')
        .trim();

      // 3. Final cleanup of any lingering symbols or partial labels at the end
      fullAddress = fullAddress.replace(/[,.-]$/, '').trim();
    }

    let subdistrict = null;
    let district = null;
    let province = null;

    if (fullAddress) {
      // Extract sub-fields
      const sdMatch = fullAddress.match(/(?:ต\.|แขวง)\s*([\u0E00-\u0E7F]+)/);
      const dMatch = fullAddress.match(/(?:อ\.|เขต)\s*([\u0E00-\u0E7F]+)/);
      const pMatch = fullAddress.match(/(?:จ\.)\s*([\u0E00-\u0E7F]+)/);

      subdistrict = sdMatch ? sdMatch[1].trim() : null;
      district = dMatch ? dMatch[1].trim() : null;
      province = pMatch ? pMatch[1].trim() : null;
    }

    // 6. Religion
    const religionMatch = text.match(
      /(?:ศาสนา|Religion)\s*([\u0E00-\u0E7F]+)/i,
    );

    const result = {
      idNumber: idNumber || null,
      prefixTh: prefixTh || null,
      firstNameTh: firstNameTh || null,
      lastNameTh: lastNameTh || null,
      prefixEn: prefixEn || null,
      firstNameEn: firstNameEn || null,
      lastNameEn: lastNameEn || null,
      dateOfBirth: dobMatch ? dobMatch[1].trim() : null,
      idCardIssueDate: issueDateMatch ? issueDateMatch[1].trim() : null,
      idCardExpiryDate: expiryDateMatch ? expiryDateMatch[1].trim() : null,
      religion: religionMatch ? religionMatch[1].trim() : null,
      registeredAddress: fullAddress,
      subdistrict,
      district,
      province,
      fullText: text,
    };

    this.logger.debug(
      `[OCR] Parsed Result: ${JSON.stringify(result, null, 2)}`,
    );
    return result;
  }
}
