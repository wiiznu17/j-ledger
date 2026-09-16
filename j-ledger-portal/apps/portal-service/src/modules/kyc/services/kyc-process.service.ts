import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { IdentityService } from '../../identity/identity.service';
import { ConfigService } from '@nestjs/config';
import { S3Service } from './s3.service';
import { GoogleVisionService } from './ocr.service';
import { AwsRekognitionService } from './face.service';
import { KycCryptoService } from './kyc-crypto.service';
import { randomUUID } from 'crypto';
import {
  RegistrationState,
  KYCVerificationStatus,
} from '@repo/dto';

@Injectable()
export class KycProcessService {
  private readonly logger = new Logger(KycProcessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identityService: IdentityService,
    private readonly configService: ConfigService,
    private readonly s3Service: S3Service,
    private readonly ocrService: GoogleVisionService,
    private readonly faceService: AwsRekognitionService,
    private readonly cryptoService: KycCryptoService,
  ) {}

  async uploadIdCard(userId: string, idCardImage: Buffer) {
    await this.identityService.validateRegistrationState(userId, [
      RegistrationState.TC_ACCEPTED,
      RegistrationState.ID_CARD_UPLOADED,
    ]);
    const idCardHash = this.cryptoService.hashBuffer(idCardImage);
    const idCardKey = `kyc/${userId}/id-card.jpg`;

    // 1. Upload to S3
    const idCardUrl = await this.s3Service.uploadFile(
      idCardKey,
      idCardImage,
      'image/jpeg',
    );

    // 2. Perform OCR via Google Vision
    const ocrResult = await this.ocrService.extractIdCardData(idCardImage);

    // Fail early if OCR results are clearly invalid/empty
    if (!ocrResult || !ocrResult.idNumber) {
      this.logger.warn(
        `[KYC] OCR failed to extract ID number for user ${userId}`,
      );
      throw new BadRequestException(
        'Could not read ID card number. Please ensure the card is clear and try again.',
      );
    }

    const idCardNumber = ocrResult.idNumber;
    const extraction = ocrResult;

    // 3. Identity Deduplication (SHA-256 of Raw Data)
    const idCardToken = idCardNumber ? this.cryptoService.hashString(idCardNumber) : null;
    if (idCardToken) {
      const existingKyc = await this.prisma.kYCData.findUnique({
        where: { idCardToken },
      });

      if (existingKyc && existingKyc.userId !== userId) {
        throw new ConflictException(
          'This ID card is already registered with another account',
        );
      }
    }

    // 4. Initialize AWS Liveness Session
    const livenessSessionId = await this.faceService.createLivenessSession();

    // 5. Threshold Branching (Manual Review)
    const isLowConfidence = !idCardNumber || idCardNumber.length < 13;
    const reviewNote = isLowConfidence
      ? 'OCR failed to extract complete ID number'
      : null;

    // 6. Upsert Data
    await this.prisma.$transaction(async (tx) => {
      await tx.kYCData.upsert({
        where: { userId },
        update: {
          idCardNumberEncrypted: idCardNumber
            ? this.cryptoService.encryptPii(idCardNumber)
            : null,
          idCardToken,
          idCardImageUrl: idCardUrl,
          idCardImageSha256: idCardHash,
          livenessSessionId,
          reviewNote,
          ocrConfidence: isLowConfidence ? 0.5 : 0.95,
          verificationStatus: KYCVerificationStatus.PENDING,
        },
        create: {
          userId,
          verificationStatus: KYCVerificationStatus.PENDING,
          idCardNumberEncrypted: idCardNumber
            ? this.cryptoService.encryptPii(idCardNumber)
            : null,
          idCardToken,
          idCardImageUrl: idCardUrl,
          idCardImageSha256: idCardHash,
          livenessSessionId,
          reviewNote,
          ocrConfidence: isLowConfidence ? 0.5 : 0.95,
          prefix: extraction.prefixTh,
          firstNameTh: extraction.firstNameTh,
          lastNameTh: extraction.lastNameTh,
          prefixEn: extraction.prefixEn,
          firstNameEn: extraction.firstNameEn,
          lastNameEn: extraction.lastNameEn,
          dateOfBirth: this.cryptoService.parseDate(extraction.dateOfBirth),
          idCardIssueDate: this.cryptoService.parseDate(extraction.idCardIssueDate),
          idCardExpiryDate: this.cryptoService.parseDate(extraction.idCardExpiryDate),
          religion: extraction.religion,
        },
      });

      // Save raw address to PII for resumption if structured data isn't confirmed yet
      if (extraction.registeredAddress) {
        await tx.pII.upsert({
          where: { userId_field: { userId, field: 'raw_id_card_address' } },
          update: {
            encryptedData: this.cryptoService.encryptPii(extraction.registeredAddress),
          },
          create: {
            userId,
            field: 'raw_id_card_address',
            encryptedData: this.cryptoService.encryptPii(extraction.registeredAddress),
          },
        });
      }
    });

    // Update user registration state
    await this.prisma.user.update({
      where: { id: userId },
      data: { registrationState: RegistrationState.ID_CARD_UPLOADED },
    });
    return {
      extractedData: {
        idNumber: idCardNumber, // ส่งเลขจริงกลับไปให้ตรวจ
        ...extraction,
      },
      livenessSessionId,
    };
  }

  async uploadIdCardSimple(userId: string, idCardImage: Buffer) {
    this.logger.log(`[KYC] STEP 5: Uploading ID card for user ${userId}`);
    this.logger.log(
      `[KYC] Image buffer size: ${idCardImage ? idCardImage.length : 'null'} bytes`,
    );

    const idCardHash = this.cryptoService.hashBuffer(idCardImage);
    const idCardKey = `kyc/${userId}/id-card.jpg`;

    // Upload to S3
    const idCardUrl = await this.s3Service.uploadFile(
      idCardKey,
      idCardImage,
      'image/jpeg',
    );

    const extraction = {
      idCardNumber: '1234567890123',
      firstNameTh: 'สมชาย',
      lastNameTh: 'เข็มกลัด',
      prefixTh: 'นาย',
      firstNameEn: 'John',
      lastNameEn: 'Doe',
      prefixEn: 'Mr.',
      thaiName: 'นายสมชาย เข็มกลัด',
      dateOfBirth: '01/01/1990',
      idCardIssueDate: '01/01/2010',
      idCardExpiryDate: '01/01/2030',
      religion: 'พุทธ',
      address: {
        line1: '123/45 ถนนพระราม 9',
        subdistrict: 'ห้วยขวาง',
        district: 'ห้วยขวาง',
        province: 'กรุงเทพฯ',
        postalCode: '10310',
      },
    };
    this.logger.debug(`[KYC] Simple mode extraction completed for user ${userId}`);
    const idCardNumber = extraction.idCardNumber;
    // In production, enforce global deduplication. In non-production mock/simple mode, append userId to allow test users
    const isProduction = process.env.NODE_ENV === 'production';
    const idCardToken = this.cryptoService.hashString(
      isProduction ? idCardNumber : idCardNumber + userId,
    );
    const encryptedId = this.cryptoService.encryptPii(idCardNumber);
    const encryptedThaiName = this.cryptoService.encryptPii(extraction.thaiName);

    const livenessSessionId = randomUUID();
    this.logger.log(`[KYC] Generated livenessSessionId: ${livenessSessionId}`);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.kYCData.upsert({
          where: { userId },
          update: {
            idCardImageUrl: idCardUrl,
            idCardImageSha256: idCardHash,
            idCardNumberEncrypted: encryptedId,
            idCardName: extraction.thaiName,
            firstNameTh: extraction.firstNameTh,
            lastNameTh: extraction.lastNameTh,
            firstNameEn: extraction.firstNameEn,
            lastNameEn: extraction.lastNameEn,
            prefix: extraction.prefixTh,
            dateOfBirth: this.cryptoService.parseDate(extraction.dateOfBirth),
            thaiNameEncrypted: encryptedThaiName,

            religion: extraction.religion,
            idCardToken,
            livenessSessionId,
            verificationStatus: KYCVerificationStatus.PENDING,
            ocrConfidence: 0.95,
          },
          create: {
            userId,
            verificationStatus: KYCVerificationStatus.PENDING,
            idCardImageUrl: idCardUrl,
            idCardImageSha256: idCardHash,
            idCardNumberEncrypted: encryptedId,
            idCardName: extraction.thaiName,
            firstNameTh: extraction.firstNameTh,
            lastNameTh: extraction.lastNameTh,
            firstNameEn: extraction.firstNameEn,
            lastNameEn: extraction.lastNameEn,
            prefix: extraction.prefixTh,
            dateOfBirth: this.cryptoService.parseDate(extraction.dateOfBirth),
            thaiNameEncrypted: encryptedThaiName,

            religion: extraction.religion,
            idCardToken,
            livenessSessionId,
            ocrConfidence: 0.95,
          },
        });
      });
      this.logger.log(
        `[KYC] KYC data upserted for user ${userId} with encrypted fields`,
      );
    } catch (error) {
      this.logger.error(
        `[KYC] Failed to upsert KYC data for user ${userId}`,
        error,
      );
      throw error;
    }

    // Update user registration state
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { registrationState: RegistrationState.ID_CARD_UPLOADED },
      });
      this.logger.log(
        `[KYC] User state updated to ID_CARD_UPLOADED for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `[KYC] Failed to update user state for user ${userId}`,
        error,
      );
      throw error;
    }

    this.logger.log(
      `[KYC] STEP 5 Complete: ID card uploaded for user ${userId}, state: ID_CARD_UPLOADED`,
    );

    return {
      extractedData: {
        idCardNumber: idCardNumber,
        firstNameTh: extraction.firstNameTh,
        lastNameTh: extraction.lastNameTh,
        prefixTh: extraction.prefixTh,
        firstNameEn: extraction.firstNameEn,
        lastNameEn: extraction.lastNameEn,
        prefixEn: extraction.prefixEn,
        thaiName: extraction.thaiName,
        dateOfBirth: extraction.dateOfBirth,
        idCardIssueDate: extraction.idCardIssueDate,
        idCardExpiryDate: extraction.idCardExpiryDate,
        religion: extraction.religion,
        registeredAddress: extraction.address,
      },
      livenessSessionId,
    };
  }

  async confirmOcrData(userId: string, dto: any) {
    await this.identityService.validateRegistrationState(userId, [
      RegistrationState.ID_CARD_UPLOADED,
      RegistrationState.ID_CARD_CONFIRMED,
    ]);
    this.logger.log(`[KYC] STEP 5.5: Confirming OCR data for user ${userId}`);

    // Sanitize ID Number (Remove dashes/spaces)
    const cleanIdNumber = dto.idNumber ? dto.idNumber.replace(/\D/g, '') : null;

    // Encrypt sensitive fields
    const encryptedId = cleanIdNumber ? this.cryptoService.encryptPii(cleanIdNumber) : null;
    const thaiName =
      `${dto.prefixTh || ''}${dto.firstNameTh || ''} ${dto.lastNameTh || ''}`.trim();
    const encryptedThaiName = thaiName ? this.cryptoService.encryptPii(thaiName) : null;
    // In production, enforce global deduplication. In non-production, append userId to allow multiple test accounts
    const isProduction = process.env.NODE_ENV === 'production';
    const idCardToken = cleanIdNumber
      ? this.cryptoService.hashString(
          isProduction ? cleanIdNumber : cleanIdNumber + userId,
        )
      : null;

    if (idCardToken && cleanIdNumber) {
      const existingKyc = await this.prisma.kYCData.findUnique({
        where: { idCardToken },
      });
      if (existingKyc && existingKyc.userId !== userId) {
        throw new ConflictException(
          'This ID card is already registered with another account',
        );
      }
    }

    try {
      const updated = await this.prisma.kYCData.update({
        where: { userId },
        data: {
          idCardNumberEncrypted: encryptedId,
          idCardName: thaiName,
          firstNameTh: dto.firstNameTh,
          lastNameTh: dto.lastNameTh,
          firstNameEn: dto.firstNameEn,
          lastNameEn: dto.lastNameEn,
          prefix: dto.prefixTh,
          prefixEn: dto.prefixEn,
          dateOfBirth: dto.dateOfBirth ? this.cryptoService.parseDate(dto.dateOfBirth) : null,
          idCardIssueDate: dto.issueDate ? this.cryptoService.parseDate(dto.issueDate) : null,
          idCardExpiryDate: dto.expiryDate
            ? this.cryptoService.parseDate(dto.expiryDate)
            : null,
          thaiNameEncrypted: encryptedThaiName,
          religion: dto.religion,
          ...(idCardToken && { idCardToken }),
        },
      });

      // 4. Update identity.addresses table via IdentityService
      if (dto.registeredAddress) {
        await this.identityService.updateAddress(
          userId,
          'REGISTERED',
          dto.registeredAddress,
          'ID_CARD_OCR',
        );
      }

      // Update user registration state to ID_CARD_CONFIRMED
      await this.prisma.user.update({
        where: { id: userId },
        data: { registrationState: RegistrationState.ID_CARD_CONFIRMED },
      });

      this.logger.log(
        `[KYC] OCR data confirmed and state updated to ID_CARD_CONFIRMED for user ${userId}`,
      );
      return { success: true };
    } catch (error) {
      this.logger.error(
        `[KYC] Failed to save confirmed OCR data for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  async submitSelfie(userId: string, selfieImage?: Buffer) {
    await this.identityService.validateRegistrationState(userId, [
      RegistrationState.ID_CARD_CONFIRMED,
      RegistrationState.KYC_VERIFIED,
    ]);
    const kyc = await this.prisma.kYCData.findUnique({
      where: { userId },
    });

    if (!kyc || !kyc.livenessSessionId || !kyc.idCardImageUrl) {
      throw new BadRequestException('ID Card must be uploaded before selfie');
    }

    // 1. Try to get Liveness Session Results if exists, otherwise fallback to manual comparison
    let livenessResults: any = null;
    try {
      livenessResults = await this.faceService.getLivenessResults(
        kyc.livenessSessionId,
      );
      this.logger.log(
        `Liveness check for user ${userId}: Status=${livenessResults.status}, Confidence=${livenessResults.confidence}`,
      );
    } catch (err) {
      this.logger.warn(
        `Liveness results not available for session ${kyc.livenessSessionId}, proceeding with manual face comparison.`,
      );
    }

    const minLivenessScore = this.configService.get(
      'KYC_MIN_LIVENESS_CONFIDENCE',
      90,
    );
    const isLive =
      livenessResults &&
      livenessResults.status === 'SUCCEEDED' &&
      (livenessResults.confidence || 0) >= minLivenessScore;

    // 2. Determine which image to use for Comparison
    let finalSelfieBuffer: Buffer;
    if (isLive && livenessResults?.referenceImage?.Bytes) {
      finalSelfieBuffer = Buffer.from(livenessResults.referenceImage.Bytes);
      this.logger.debug(
        `Using AWS Liveness Reference Image for user ${userId}`,
      );
    } else if (selfieImage) {
      finalSelfieBuffer = selfieImage;
      this.logger.debug(`Using manual selfie upload for user ${userId}`);
    } else {
      throw new BadRequestException(
        'Face verification data missing. Please capture your face correctly.',
      );
    }

    const selfieHash = this.cryptoService.hashBuffer(finalSelfieBuffer);
    const selfieKey = `kyc/${userId}/selfie.jpg`;

    // 3. Upload Selfie to S3
    const selfieUrl = await this.s3Service.uploadFile(
      selfieKey,
      finalSelfieBuffer,
      'image/jpeg',
    );

    // 4. Face Comparison (Real Comparison)
    // We use the ID card key from S3 and the new selfie buffer
    const idCardKey = `kyc/${userId}/id-card.jpg`;

    // AWS Rekognition can take bytes for both. Since we have selfie as buffer,
    // we just need the ID card buffer.
    // Optimization: In a real high-scale system, we'd use S3 objects directly in Rekognition
    // But for this flow, we'll download ID card buffer once to compare.

    this.logger.debug(`Performing real face comparison for user ${userId}`);

    let isMatch = false;
    let similarity = 0;

    try {
      // Fetch ID card image from S3
      const idCardBuffer = await this.s3Service.getFile(idCardKey);

      // Compare with the reference image (from liveness) or provided selfie
      const comparison = await this.faceService.compareFaces(
        idCardBuffer,
        finalSelfieBuffer,
      );

      const minSimilarity = this.configService.get(
        'KYC_MIN_SIMILARITY_SCORE',
        80,
      );
      isMatch = comparison.isMatch && comparison.similarity >= minSimilarity;
      similarity = comparison.similarity;

      this.logger.log(
        `Face match result for user ${userId}: isMatch=${isMatch}, similarity=${similarity}%`,
      );

      if (!isMatch) {
        throw new BadRequestException(
          `Face verification failed (Similarity: ${similarity}%). Please ensure your face is clearly visible and matches your ID card.`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Face comparison failed for user ${userId}`, err);
      isMatch = false;
      throw new BadRequestException(
        'Face verification failed. Please try again with better lighting.',
      );
    }

    // Finalize KYC
    await this.prisma.$transaction(async (tx) => {
      await tx.kYCData.update({
        where: { userId },
        data: {
          selfieImageUrl: selfieUrl,
          selfieImageSha256: selfieHash,
          faceMatchScore: Math.round(similarity),
          verificationStatus: KYCVerificationStatus.PENDING,
          updatedAt: new Date(),
        },
      });

      // Update user registration state
      await tx.user.update({
        where: { id: userId },
        data: { registrationState: RegistrationState.KYC_VERIFIED },
      });
    });

    return {
      isMatch,
      verificationStatus: isMatch
        ? KYCVerificationStatus.APPROVED
        : KYCVerificationStatus.REJECTED,
    };
  }

  async submitSelfieSimple(userId: string, selfieImage: Buffer) {
    this.logger.log(`[KYC] STEP 6: Submitting selfie for user ${userId}`);
    this.logger.log(
      `[KYC] Selfie buffer size: ${selfieImage ? selfieImage.length : 'null'} bytes`,
    );

    const kyc = await this.prisma.kYCData.findUnique({
      where: { userId },
    });

    this.logger.log(
      `[KYC] Found KYC data: ${!!kyc}, has livenessSessionId: ${!!kyc?.livenessSessionId}`,
    );

    if (!kyc || !kyc.livenessSessionId) {
      this.logger.error(
        `[KYC] ID Card must be uploaded before selfie for user ${userId}`,
      );
      throw new BadRequestException('ID Card must be uploaded before selfie');
    }

    const selfieHash = this.cryptoService.hashBuffer(selfieImage);
    const selfieKey = `kyc/${userId}/selfie.jpg`;

    // Upload Selfie to S3
    const selfieUrl = await this.s3Service.uploadFile(
      selfieKey,
      selfieImage,
      'image/jpeg',
    );

    // Simple mode: Skip face verification, just save the image
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.kYCData.update({
          where: { userId },
          data: {
            selfieImageUrl: selfieUrl,
            selfieImageSha256: selfieHash,
            verificationStatus: KYCVerificationStatus.PENDING, // Wait for admin review even in simple mode
            verifiedAt: null,
          },
        });
      });
      this.logger.log(`[KYC] KYC data updated with selfie for user ${userId}`);
    } catch (error) {
      this.logger.error(
        `[KYC] Failed to update KYC data with selfie for user ${userId}`,
        error,
      );
      throw error;
    }

    // Update user registration state
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { registrationState: RegistrationState.KYC_VERIFIED },
      });
      this.logger.log(
        `[KYC] User state updated to KYC_VERIFIED for user ${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `[KYC] Failed to update user state for user ${userId}`,
        error,
      );
      throw error;
    }

    this.logger.log(
      `[KYC] STEP 6 Complete: Selfie submitted for user ${userId}, state: KYC_VERIFIED`,
    );

    return {
      isMatch: true,
      verificationStatus: KYCVerificationStatus.PENDING,
    };
  }
}
