import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SecurityEventType } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ISmsProvider } from '../../integrations/interfaces/sms-provider.interface';
import { FinanceService } from '../../../core/finance/finance.service';
import {
  UserStatus,
  RegistrationState,
  NotificationEventType,
  KYCVerificationStatus,
  AddressType,
} from '@repo/dto';
import {
  RegisterInitDto,
  RegisterVerifyOtpDto,
  RegisterPasswordDto,
  RegisterPinDto,
  AcceptTermsDto,
} from '../dto/auth.dto';
import * as bcrypt from 'bcryptjs';
import { createDecipheriv, randomUUID, randomInt } from 'crypto';
import { LogMaskingUtil } from '../../../common/utils/log-masking.util';
import { IdentityUtils } from '../utils/identity.utils';
import { UserAuthService } from './user-auth.service';
import { UserSecurityService } from './user-security.service';

const OTP_TTL_SECONDS = 3 * 60;

@Injectable()
export class UserRegistrationService {
  private readonly logger = new Logger(UserRegistrationService.name);
  private readonly registrationSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly userAuthService: UserAuthService,
    private readonly userSecurityService: UserSecurityService,
    @Inject(ISmsProvider) private readonly smsProvider: ISmsProvider,
    private readonly financeService: FinanceService,
  ) {
    this.registrationSecret = this.configService.get<string>('CUSTOMER_REGISTRATION_SECRET') || '';
  }

  // ==================== Registration ====================

  async registerInit(
    dto: RegisterInitDto,
    context?: { ip?: string; userAgent?: string },
  ) {
    // Validate phone number format BEFORE normalization (Thai numbers must be 10 digits and start with 0)
    const inputDigits = (dto.phoneNumber || '').replace(/\D/g, '');
    if (inputDigits.length !== 10) {
      throw new BadRequestException('Phone number must be 10 digits');
    }
    if (!inputDigits.startsWith('0')) {
      throw new BadRequestException('Phone number must start with 0');
    }

    const phoneNumber = IdentityUtils.normalizePhone(dto.phoneNumber);
    const maskedPhone = LogMaskingUtil.maskPhoneNumber(phoneNumber);
    this.logger.log(
      `[Register] STEP 1: Initiating registration for ${maskedPhone}`,
    );

    let user = await this.prisma.user.findFirst({
      where: { phoneNumber: { in: IdentityUtils.getPhoneCandidates(phoneNumber) } },
    });

    if (!user) {
      this.logger.log(`[Register] Creating new user for ${maskedPhone}`);
      user = await this.prisma.user.create({
        data: {
          phoneNumber,
          registrationState: RegistrationState.PENDING_OTP,
        },
      });
    } else {
      this.logger.log(
        `[Register] Existing user found for ${maskedPhone}, current state: ${user.registrationState}`,
      );

      // If user already has a password, they should use Login flow instead of Sign Up
      if (user.passwordHash) {
        this.logger.warn(
          `[Register] User ${maskedPhone} already has a password. Forcing login.`,
        );
        throw new ConflictException(
          'User already has an account. Please log in.',
        );
      }

      // If user is already completed, they must login
      if (
        (user.registrationState as RegistrationState) ===
        RegistrationState.COMPLETED
      ) {
        this.logger.warn(`[Register] User ${maskedPhone} already registered`);
        throw new ConflictException('User already registered');
      }

      // Update registration state to PENDING_OTP to enforce OTP verification even for resumes
      if (user.registrationState !== RegistrationState.PENDING_OTP) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { registrationState: RegistrationState.PENDING_OTP },
        });
        this.logger.log(
          `[Register] Updated registration state to PENDING_OTP for ${maskedPhone}`,
        );
      }

      this.logger.log(
        `[Register] Resuming onboarding for ${maskedPhone} from previous state: ${user.registrationState}`,
      );
    }

    const challenge = await this.createOtpChallenge(user.id, phoneNumber);
    await this.userSecurityService.logSecurityEvent(
      user.id,
      NotificationEventType.REGISTER_INIT_OTP,
      {
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
      },
    );

    this.logger.log(
      `[Register] STEP 1 Complete: OTP challenge created for ${maskedPhone}, state: PENDING_OTP`,
    );

    return {
      challengeId: challenge.id,
      expiresInSeconds: OTP_TTL_SECONDS,
    };
  }

  async registerVerifyOtp(
    dto: RegisterVerifyOtpDto,
    context?: { ip?: string; userAgent?: string },
  ) {
    const phoneNumber = IdentityUtils.normalizePhone(dto.phoneNumber);
    const maskedPhone = LogMaskingUtil.maskPhoneNumber(phoneNumber);
    this.logger.log(`[Register] STEP 2: Verifying OTP for ${maskedPhone}`);

    const user = await this.verifyOtpChallenge(
      dto.challengeId,
      phoneNumber,
      dto.otp,
    );
    this.logger.log(
      `[Register] OTP verified for user ${user.id}, current state: ${user.registrationState}`,
    );

    // Only update state if it's currently earlier than OTP_VERIFIED
    if (
      (user.registrationState as RegistrationState) ===
        RegistrationState.PENDING_OTP ||
      (user.registrationState as RegistrationState) ===
        RegistrationState.PENDING
    ) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { registrationState: RegistrationState.OTP_VERIFIED },
      });
      this.logger.log(
        `[Register] State updated to OTP_VERIFIED for ${maskedPhone}`,
      );
    } else {
      this.logger.log(
        `[Register] Keeping current state: ${user.registrationState} for ${maskedPhone}`,
      );
    }

    await this.userSecurityService.logSecurityEvent(
      user.id,
      NotificationEventType.REGISTER_OTP_VERIFIED,
      {
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
      },
    );

    this.logger.log(
      `[Register] STEP 2 Complete: State updated to OTP_VERIFIED for ${maskedPhone}`,
    );

    const finalUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    const finalState =
      (finalUser?.registrationState as RegistrationState) || RegistrationState.OTP_VERIFIED;

    return {
      regToken: await this.userAuthService.signRegistrationToken(user.id, finalState),
      nextState: finalState,
    };
  }

  async acceptTerms(
    authorization: string | undefined,
    dto: AcceptTermsDto,
    context?: any,
  ) {
    if (!authorization) {
      throw new UnauthorizedException('Authorization header required');
    }

    const token = authorization.replace('Bearer ', '');
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.registrationSecret,
    });

    if (payload.typ !== 'registration') {
      throw new UnauthorizedException('Invalid token type');
    }

    this.logger.log(
      `[Register] STEP 3: Accepting terms for user ${payload.sub}`,
    );

    await this.validateRegistrationState(payload.sub, [
      RegistrationState.OTP_VERIFIED,
      RegistrationState.TC_ACCEPTED,
    ]);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Save consent (upsert to handle re-acceptance)
    await this.prisma.userConsent.upsert({
      where: {
        userId_consentType: {
          userId: user.id,
          consentType: 'TERMS_OF_SERVICE',
        },
      },
      update: {
        acceptedAt: new Date(),
        withdrawnAt: null,
      },
      create: {
        userId: user.id,
        consentType: 'TERMS_OF_SERVICE',
        acceptedAt: new Date(),
      },
    });
    this.logger.log(`[Register] Consent saved for user ${user.id}`);

    // Update state
    await this.prisma.user.update({
      where: { id: user.id },
      data: { registrationState: RegistrationState.TC_ACCEPTED },
    });

    this.logger.log(
      `[Register] STEP 3 Complete: State updated to TC_ACCEPTED for user ${user.id}`,
    );

    return { success: true };
  }

  async registerPassword(
    authorization: string | undefined,
    dto: RegisterPasswordDto,
    context?: any,
  ) {
    if (!authorization) {
      throw new UnauthorizedException('Authorization header required');
    }

    const token = authorization.replace('Bearer ', '');
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.registrationSecret,
    });

    if (payload.typ !== 'registration') {
      throw new UnauthorizedException('Invalid token type');
    }

    this.logger.log(
      `[Register] STEP 5: Setting password for user ${payload.sub}`,
    );

    await this.validateRegistrationState(payload.sub, [
      RegistrationState.PROFILE_COMPLETED,
      RegistrationState.PASSWORD_SET,
    ]);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, registrationState: RegistrationState.PASSWORD_SET },
    });
    this.logger.log(`[Register] Password saved for user ${user.id}`);

    await this.userSecurityService.logSecurityEvent(user.id, NotificationEventType.PASSWORD_SET, {
      ipAddress: context?.ip,
      userAgent: context?.userAgent,
    });

    this.logger.log(
      `[Register] STEP 5 Complete: State updated to PASSWORD_SET for user ${user.id}`,
    );

    return { success: true };
  }

  async registerPin(
    authorization: string | undefined,
    dto: RegisterPinDto,
    context?: any,
  ) {
    if (!authorization) {
      throw new UnauthorizedException('Authorization header required');
    }

    const token = authorization.replace('Bearer ', '');
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.registrationSecret,
    });

    if (payload.typ !== 'registration') {
      throw new UnauthorizedException('Invalid token type');
    }

    this.logger.log(`[Register] STEP 6: Setting PIN for user ${payload.sub}`);

    await this.validateRegistrationState(payload.sub, [
      RegistrationState.PASSWORD_SET,
      RegistrationState.CREDENTIALS_SET,
    ]);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const pinHash = await bcrypt.hash(dto.pin, 10);

    // Register device
    await this.prisma.userDevice.upsert({
      where: {
        userId_deviceIdentifier: {
          userId: user.id,
          deviceIdentifier: dto.deviceId,
        },
      },
      create: {
        userId: user.id,
        deviceIdentifier: dto.deviceId,
        deviceName: dto.deviceName,
        trustLevel: 'TRUSTED',
        ...(dto.pushToken && { pushToken: dto.pushToken }),
      },
      update: {
        deviceName: dto.deviceName,
        lastSeenAt: new Date(),
        ...(dto.pushToken && { pushToken: dto.pushToken }),
      },
    });
    this.logger.log(`[Register] Device registered for user ${user.id}`);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { pinHash, registrationState: RegistrationState.CREDENTIALS_SET },
    });
    this.logger.log(`[Register] PIN saved for user ${user.id}`);

    await this.userSecurityService.logSecurityEvent(user.id, NotificationEventType.PIN_SETUP, {
      ipAddress: context?.ip,
      userAgent: context?.userAgent,
    });

    this.logger.log(
      `[Register] STEP 6 Complete: State updated to CREDENTIALS_SET for user ${user.id}`,
    );

    return { success: true };
  }

  async completeRegistration(authorization: string | undefined, context?: any) {
    if (!authorization) {
      throw new UnauthorizedException('Authorization header required');
    }

    const token = authorization.replace('Bearer ', '');
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.registrationSecret,
    });

    if (payload.typ !== 'registration') {
      throw new UnauthorizedException('Invalid token type');
    }

    this.logger.log(
      `[Register] STEP 7: Completing registration for user ${payload.sub}`,
    );

    await this.validateRegistrationState(payload.sub, [
      RegistrationState.CREDENTIALS_SET,
      RegistrationState.COMPLETED,
    ]);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Race Condition and Token Reuse Protection:
    // Allow completion only if status is PENDING_APPROVAL or REJECTED (for retries),
    // but if already COMPLETED and ACTIVE, throw conflict.
    if (
      (user.registrationState as RegistrationState) ===
        RegistrationState.COMPLETED &&
      (user.status as UserStatus) === UserStatus.ACTIVE
    ) {
      throw new ConflictException('Registration already completed');
    }

    // Wallet creation is now postponed until Admin Approval (kyc.service.ts)
    // to prevent provisioning accounts for unverified users.
    const walletId = user.ledgerAccountId;

    try {
      // Update user with wallet info and final state
      // Status Protection: Move to PENDING_APPROVAL if currently INACTIVE or REJECTED (retry case).
      // If user is already ACTIVE or BLOCKED, we MUST preserve that status.
      const updatedStatus =
        (user.status as UserStatus) === UserStatus.INACTIVE ||
        (user.status as UserStatus) === UserStatus.REJECTED
          ? UserStatus.PENDING_APPROVAL
          : (user.status as UserStatus);

      const updatedUser = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          registrationState: RegistrationState.COMPLETED,
          status: updatedStatus as UserStatus,
          ledgerAccountId: walletId,
        },
      });

      // Sync KYC status to PENDING if we are in approval mode
      if (updatedStatus === UserStatus.PENDING_APPROVAL) {
        await this.prisma.kYCData.updateMany({
          where: { userId: user.id },
          data: { verificationStatus: KYCVerificationStatus.PENDING },
        });
      }

      await this.userSecurityService.logSecurityEvent(
        user.id,
        NotificationEventType.REGISTRATION_COMPLETED,
        {
          walletId: walletId,
        },
      );

      // Issue tokens so user can be automatically logged in
      const deviceId = context?.deviceId || 'UNKNOWN';
      const device = await this.prisma.userDevice.findFirst({
        where: { userId: user.id, deviceIdentifier: deviceId },
      });

      const authResponse = await this.userAuthService.generateAuthResponse(
        user.id,
        device?.id || 'UNKNOWN',
        context,
      );

      this.logger.log(
        `[Register] STEP 7 Complete: Registration completed for user ${user.id}, tokens issued`,
      );

      // Fetch latest KYC data to get reviewNote if any
      const kycData = await this.prisma.kYCData.findUnique({
        where: { userId: user.id },
      });

      return {
        success: true,
        ...authResponse,
        user: {
          id: updatedUser.id,
          phoneNumber: updatedUser.phoneNumber,
          email: updatedUser.email,
          status: updatedUser.status,
          registrationState: updatedUser.registrationState,
          reviewNote: kycData?.reviewNote || null,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to complete registration for user ${user.id}`,
        error,
      );
      throw new BadRequestException('Failed to complete registration setup');
    }
  }

  async getRegistrationStatus(authorization: string | undefined) {
    if (!authorization) {
      throw new UnauthorizedException('Authorization header required');
    }

    const token = authorization.replace('Bearer ', '');

    let payload;
    try {
      // 1. Try registration secret first
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.registrationSecret,
      });
    } catch (regError: any) {
      // 2. If registration secret fails, try the main JWT secret (for authenticated retry)
      try {
        const jwtSecret = this.configService.get('CUSTOMER_JWT_SECRET');
        payload = await this.jwtService.verifyAsync(token, {
          secret: jwtSecret,
        });
      } catch (authError: any) {
        if (
          regError.name === 'TokenExpiredError' ||
          authError.name === 'TokenExpiredError'
        ) {
          this.logger.warn(`[Register] Token expired in getRegistrationStatus`);
          throw new UnauthorizedException('Token expired');
        }
        this.logger.warn(
          `[Register] Invalid token in getRegistrationStatus: ${authError.message}`,
        );
        throw new UnauthorizedException('Invalid token');
      }
    }

    this.logger.log(
      `[Register] Getting registration status for user ${payload.sub}`,
    );

    const [user, addresses, kycData, piiData] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          userSettings: true,
        },
      }),
      this.prisma.address.findMany({
        where: { userId: payload.sub, deletedAt: null },
      }),
      this.prisma.kYCData.findUnique({
        where: { userId: payload.sub },
      }),
      this.prisma.pII.findMany({
        where: { userId: payload.sub },
      }),
    ]);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    this.logger.log(
      `[Register] Current state for user ${user.id}: ${user.registrationState}`,
    );

    // Extract raw address from PII
    const rawAddressPii = (piiData as any[]).find(
      (p) => p.field === 'raw_id_card_address',
    );
    const idCardAddress = rawAddressPii
      ? this.decryptPii(rawAddressPii.encryptedData)
      : null;

    // Extract profile data from settings
    const profileSetting = user.userSettings.find((s) => s.key === 'profile');
    const profileData = profileSetting
      ? JSON.parse(profileSetting.value)
      : null;

    // Decrypt and mask ID card number if available
    let idNumber = null;
    if (kycData?.idCardNumberEncrypted) {
      try {
        const fullId = this.decryptPii(kycData.idCardNumberEncrypted);
        idNumber = fullId; // real id number for check
      } catch (e) {
        this.logger.warn(
          `Failed to decrypt ID number for status check: ${user.id}`,
        );
      }
    }

    return {
      state: user.registrationState,
      status: user.status,
      reviewNote: kycData?.reviewNote || null,
      prefilledData: {
        identity: kycData
          ? {
              idNumber,
              idCardUrl: kycData.idCardImageUrl,
              idCardAddress: idCardAddress,
              firstNameTh: kycData.firstNameTh,
              lastNameTh: kycData.lastNameTh,
              prefixTh: kycData.prefix,
              firstNameEn: kycData.firstNameEn,
              lastNameEn: kycData.lastNameEn,
              prefixEn: kycData.prefixEn,
              dateOfBirth: kycData.dateOfBirth,
              issueDate: kycData.idCardIssueDate,
              expiryDate: kycData.idCardExpiryDate,
              religion: kycData.religion,
            }
          : null,
        addresses: {
          registered:
            addresses.find((a) => a.type === AddressType.REGISTERED) || null,
          current:
            addresses.find((a) => a.type === AddressType.CURRENT) || null,
        },
        profile: profileData
          ? {
              occupation: profileData.occupation,
              incomeRange: profileData.incomeRange,
              sourceOfFunds: profileData.sourceOfFunds,
              purposeOfAccount: profileData.purposeOfAccount,
            }
          : null,
      },
    };
  }

  public async validateRegistrationState(
    userId: string,
    allowedStates: string[],
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { registrationState: true, status: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Allow REJECTED users to retry from any step they are at
    if ((user.status as UserStatus) === UserStatus.REJECTED) {
      this.logger.log(
        `[Register] User ${userId} is REJECTED, allowing state override.`,
      );
      return;
    }

    if (!allowedStates.includes(user.registrationState as string)) {
      this.logger.warn(
        `[Register] State mismatch for user ${userId}. Current: ${user.registrationState}, Allowed: ${allowedStates}`,
      );
      throw new ForbiddenException('Invalid registration sequence');
    }
  }

  // ==================== Private Helpers ====================

  private async createOtpChallenge(userId: string, phoneNumber: string) {
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    const challenge = await this.prisma.otpChallenge.create({
      data: {
        userId,
        phoneNumber,
        code: await bcrypt.hash(code, 10),
        expiresAt,
      },
    });

    // Always log OTP in non-production environments for debugging
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(
        `[DEV] OTP for ${phoneNumber}: ${code} (expires in ${OTP_TTL_SECONDS}s)`,
      );
    }

    try {
      await this.smsProvider.sendMessage(
        phoneNumber,
        `Your J-Ledger verification code is: ${code}`,
      );
    } catch (smsError) {
      // Log OTP to server logs as fallback when SMS fails (visible in CloudWatch / Docker logs)
      this.logger.error(
        `SMS delivery failed for ${phoneNumber}. OTP code for manual verification: ${code}`,
        smsError?.message,
      );
    }

    return challenge;
  }

  private async verifyOtpChallenge(
    challengeId: string,
    phoneNumber: string,
    otp: string,
  ) {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new BadRequestException('Invalid challenge');
    }

    if (!IdentityUtils.getPhoneCandidates(phoneNumber).includes(challenge.phoneNumber)) {
      throw new BadRequestException('Phone number mismatch');
    }

    if (challenge.expiresAt < new Date()) {
      throw new BadRequestException('OTP expired');
    }

    if (challenge.verifiedAt) {
      throw new BadRequestException('OTP already verified');
    }

    const isOtpValid = await bcrypt.compare(otp, challenge.code);
    if (!isOtpValid) {
      await this.prisma.otpChallenge.update({
        where: { id: challengeId },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid OTP');
    }

    await this.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { verifiedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return user;
  }

  private decryptPii(encryptedData: string): string {
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
}
