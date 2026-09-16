import {
  Injectable,
  Logger,
  BadRequestException,
  Inject,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { UserSecurityService } from './user-security.service';
import { REDIS_CLIENT, REDIS_KEYS } from '../../../core/common/constants';
import Redis from 'ioredis';
import { randomInt } from 'crypto';
import { KafkaProducerService } from '../../notification/kafka-producer.service';
import {
  NotificationEventType,
  KafkaTopic,
  AddressType,
} from '@repo/dto';
import { UserResponseDto } from '../dto/user-response.dto';

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userSecurityService: UserSecurityService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async getProfile(userId: string): Promise<UserResponseDto> {
    this.logger.log(`[UserProfile] Fetching profile for user ${userId}`);

    const [user, kycData, addresses] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          userSettings: {
            where: { key: { in: ['profile', 'email_verified'] } },
          },
        },
      }),
      this.prisma.kYCData
        .findUnique({
          where: { userId },
        })
        .catch(() => null),
      this.prisma.address.findMany({
        where: { userId, deletedAt: null },
      }),
    ]);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const profileSetting = user.userSettings.find((s) => s.key === 'profile');
    const emailVerifiedSetting = user.userSettings.find((s) => s.key === 'email_verified');
    const emailVerified = emailVerifiedSetting?.value === 'true';

    let profileData: any = {};

    if (profileSetting) {
      try {
        profileData = JSON.parse(profileSetting.value);
        if (profileData.address) {
          delete profileData.address;
        }
      } catch (e) {
        this.logger.error(`Failed to parse profile data for user ${userId}`, e);
      }
    }

    return new UserResponseDto({
      id: user.id,
      phoneNumber: user.phoneNumber,
      email: user.email,
      emailVerified,
      status: user.status,
      registrationState: user.registrationState,
      ledgerAccountId: user.ledgerAccountId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      profile: profileData,
      addresses: addresses,
      kycData: kycData
        ? {
            firstNameTh: kycData.firstNameTh,
            lastNameTh: kycData.lastNameTh,
            firstNameEn: kycData.firstNameEn,
            lastNameEn: kycData.lastNameEn,
            idCardName: kycData.idCardName,
            dateOfBirth: kycData.dateOfBirth,
            verificationStatus: kycData.verificationStatus,
            verifiedAt: kycData.verifiedAt,
          }
        : null,
    } as any);
  }

  async updateProfile(userId: string, profileData: any) {
    this.logger.log(`[UserProfile] Updating profile for user ${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (profileData.address) {
      delete profileData.address;
    }

    await this.prisma.userSetting.upsert({
      where: { userId_key: { userId: user.id, key: 'profile' } },
      create: {
        userId: user.id,
        key: 'profile',
        value: JSON.stringify(profileData),
      },
      update: {
        value: JSON.stringify(profileData),
      },
    });

    await this.userSecurityService.logSecurityEvent(userId, NotificationEventType.PROFILE_UPDATED, {
      fields: Object.keys(profileData),
    });

    return { success: true };
  }

  async updateAddress(userId: string, type: any, dto: any, source?: any) {
    this.logger.log(`[UserProfile] Updating address ${type} for user ${userId}`);

    const allowedFields = ['line1', 'line2', 'subdistrict', 'district', 'province', 'postalCode', 'label', 'countryCode'];
    const sanitizedDto: any = {};
    for (const key of allowedFields) {
      if (dto && dto[key] !== undefined) {
        sanitizedDto[key] = dto[key];
      }
    }

    try {
      const existing = await this.prisma.address.findFirst({
        where: {
          userId,
          type: type as AddressType,
          deletedAt: null,
        },
      });

      if (existing) {
        return await this.prisma.address.update({
          where: { id: existing.id },
          data: {
            ...sanitizedDto,
            verificationSource: source || undefined,
            updatedAt: new Date(),
          },
        });
      }

      return await this.prisma.address.create({
        data: {
          userId,
          type: type as AddressType,
          ...sanitizedDto,
          verificationSource: source || undefined,
        },
      });
    } finally {
      await this.userSecurityService.logSecurityEvent(
        userId,
        NotificationEventType.ADDRESS_UPDATED,
        { type, source },
      );
    }
  }

  async requestEmailVerification(userId: string, email: string): Promise<{ success: boolean; message: string }> {
    const existingUser = await this.prisma.user.findFirst({
      where: { email, id: { not: userId } },
    });
    if (existingUser) {
      throw new BadRequestException('Email address is already in use by another account');
    }

    const otp = randomInt(100000, 1000000).toString();
    const ttlSeconds = 300;

    const redisKey = REDIS_KEYS.USER.EMAIL_VERIFICATION_OTP(userId);
    await this.redis.set(redisKey, JSON.stringify({ email, otp }), 'EX', ttlSeconds);

    try {
      await this.kafkaProducer.emit(KafkaTopic.SECURITY_EVENTS, {
        userId,
        eventType: 'EMAIL_VERIFICATION_OTP' as any,
        metadata: { email, otp },
        timestamp: new Date().toISOString(),
        referenceId: `email-verify-${Date.now()}`,
      });
    } catch (error) {
      this.logger.error(`Failed to publish EMAIL_VERIFICATION_OTP event: ${error.message}`);
      throw new InternalServerErrorException('Failed to process email verification request');
    }

    return { success: true, message: 'Verification OTP sent to your email' };
  }

  async confirmEmailVerification(userId: string, email: string, otp: string): Promise<{ success: boolean; message: string }> {
    const redisKey = REDIS_KEYS.USER.EMAIL_VERIFICATION_OTP(userId);
    const rawData = await this.redis.get(redisKey);

    if (!rawData) {
      throw new BadRequestException('OTP has expired or was not requested');
    }

    const { email: storedEmail, otp: storedOtp } = JSON.parse(rawData);

    if (storedOtp !== otp) {
      throw new BadRequestException('Invalid verification code');
    }

    if (storedEmail.toLowerCase() !== email.toLowerCase()) {
      throw new BadRequestException('Email address mismatch');
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email, id: { not: userId } },
    });
    if (existingUser) {
      throw new BadRequestException('Email address is already in use by another account');
    }

    await this.redis.del(redisKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { email },
      });

      await tx.userSetting.upsert({
        where: { userId_key: { userId, key: 'email_verified' } },
        update: { value: 'true' },
        create: { userId, key: 'email_verified', value: 'true' },
      });
    });

    return { success: true, message: 'Email address verified successfully' };
  }

  async getUserConsents(userId: string) {
    return [];
  }

  async withdrawConsent(userId: string, consentType: string, context?: any) {
    await this.userSecurityService.logSecurityEvent(
      userId,
      NotificationEventType.CONSENT_WITHDRAWN,
      { consentType, ip: context?.ip },
    );
    return { success: true };
  }

  async exportUserData(userId: string) {
    return { exportedAt: new Date().toISOString() };
  }
}
