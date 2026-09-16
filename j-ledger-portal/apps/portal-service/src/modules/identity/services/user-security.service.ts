import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { KafkaProducerService } from '../../notification/kafka-producer.service';
import {
  NotificationEventType,
  KafkaTopic,
  DeviceTrustLevel,
} from '@repo/dto';
import { PaginationUtility } from '../../../common/utils/pagination.util';
import { SecurityEventType, AddressType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID, randomBytes, randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_KEYS } from '../../../core/common/constants';
import { ConfigService } from '@nestjs/config';
import { UserAuthService } from './user-auth.service';

@Injectable()
export class UserSecurityService {
  private readonly logger = new Logger(UserSecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(forwardRef(() => UserAuthService))
    private readonly userAuthService: UserAuthService,
  ) {}

  async logSecurityEvent(
    userId: string,
    eventType: NotificationEventType,
    metadata?: any,
  ) {
    // 1. Always record to Database for audit trail
    await this.prisma.securityEvent.create({
      data: {
        userId,
        eventType: eventType as SecurityEventType,
        metadata: metadata || {},
      },
    });

    // 2. Only emit to Kafka for events that REQUIRE a notification to the user
    const essentialEvents = [
      NotificationEventType.LOGIN_FAILURE,
      NotificationEventType.PASSWORD_CHANGE,
      NotificationEventType.PASSWORD_SET,
      NotificationEventType.PIN_SETUP,
      NotificationEventType.KYC_APPROVED,
      NotificationEventType.KYC_REJECTED,
      NotificationEventType.DEVICE_REGISTERED,
    ];

    if (!essentialEvents.includes(eventType)) {
      this.logger.debug(
        `Skipping Kafka emission for non-essential security event: ${eventType}`,
      );
      return;
    }

    // Emit to Kafka for notification-worker
    try {
      await this.kafkaProducer.emit(KafkaTopic.SECURITY_EVENTS, {
        userId,
        eventType,
        metadata: metadata || {},
        timestamp: new Date().toISOString(),
        referenceId: new Date().getTime().toString(),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit security event to Kafka for user ${userId}: ${error.message}`,
      );
    }
  }

  async handlePinFailure(userId: string) {
    const MAX_PIN_ATTEMPTS = 3;
    const PIN_LOCK_DURATION_MS = 5 * 60 * 1000;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        pinAttempts: { increment: 1 },
      },
    });

    if (updated.pinAttempts >= MAX_PIN_ATTEMPTS) {
      return this.prisma.user.update({
        where: { id: userId },
        data: {
          pinLockedUntil: new Date(Date.now() + PIN_LOCK_DURATION_MS),
        },
      });
    }

    return updated;
  }

  async resetPinAttempts(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { pinAttempts: 0, pinLockedUntil: null },
    });
  }

  async verifyDevice(dto: any, context?: any) {
    // TODO: Implement device verification logic
    return { success: true };
  }

  async setupPin(userId: string, dto: any) {
    const pinHash = await bcrypt.hash(dto.pin, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash },
    });

    await this.logSecurityEvent(userId, NotificationEventType.PIN_SETUP);
    return { success: true };
  }

  async verifyPin(userId: string, dto: any, context?: any) {
    this.logger.debug(`[Security] Verifying PIN for user ${userId}`);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger.warn(`[Security] User not found for ID: ${userId}`);
      throw new BadRequestException('User not found');
    }

    if (!user.pinHash) {
      this.logger.warn(`[Security] PIN not set for user: ${userId}`);
      throw new BadRequestException('PIN not set');
    }

    // Check if PIN is currently locked
    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      const timeLeft = Math.ceil(
        (user.pinLockedUntil.getTime() - Date.now()) / 1000,
      );
      throw new ForbiddenException({
        statusCode: 403,
        message: `PIN is locked. Please try again in ${timeLeft} seconds.`,
        error: 'Forbidden',
        timeLeft,
      });
    }

    const isPinValid = await bcrypt.compare(dto.pin, user.pinHash);
    if (!isPinValid) {
      this.logger.warn(`[Security] Invalid PIN attempt for user: ${userId}`);
      const updatedUser = await this.handlePinFailure(userId);
      const remainingAttempts = 3 - updatedUser.pinAttempts;

      if (
        updatedUser.pinLockedUntil &&
        updatedUser.pinLockedUntil > new Date()
      ) {
        await this.logSecurityEvent(userId, NotificationEventType.PIN_LOCKED, {
          deviceId: dto.deviceId,
          attempts: updatedUser.pinAttempts,
        });

        await this.logSecurityEvent(
          userId,
          NotificationEventType.ACCOUNT_LOCKED,
          {
            action: 'ACCOUNT_LOCKED',
            reason: 'PIN locked due to 3 consecutive failures',
            deviceId: dto.deviceId,
          },
        );

        throw new ForbiddenException({
          statusCode: 403,
          message:
            'PIN locked due to too many incorrect attempts. Please try again in 5 minutes.',
          error: 'Forbidden',
          timeLeft: 300,
        });
      } else {
        await this.logSecurityEvent(userId, NotificationEventType.PIN_FAILURE, {
          deviceId: dto.deviceId,
          attempts: updatedUser.pinAttempts,
          remainingAttempts: remainingAttempts > 0 ? remainingAttempts : 0,
        });
        throw new UnauthorizedException(
          `Invalid PIN. You have ${remainingAttempts} attempts remaining.`,
        );
      }
    }

    await this.logSecurityEvent(userId, NotificationEventType.PIN_VERIFIED, {
      deviceId: dto.deviceId,
    });

    // Reset pin attempts on success
    await this.resetPinAttempts(userId);

    // Generate fresh tokens for the unlocked session (Marked as PIN Verified)
    const device = await this.prisma.userDevice.findFirst({
      where: { userId, deviceIdentifier: dto.deviceId },
    });

    return this.userAuthService.generateAuthResponse(userId, device?.id, context, true);
  }

  async changePin(userId: string, dto: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.pinHash) {
      throw new BadRequestException('PIN not set');
    }

    const isPinValid = await bcrypt.compare(dto.oldPin, user.pinHash);
    if (!isPinValid) {
      throw new BadRequestException('รหัส PIN เดิมไม่ถูกต้อง');
    }

    const pinHash = await bcrypt.hash(dto.newPin, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pinHash,
        pinAttempts: 0,
        pinLockedUntil: null,
      },
    });

    await this.logSecurityEvent(userId, NotificationEventType.PIN_SETUP, { action: 'change' });
    return { success: true, message: 'เปลี่ยนรหัส PIN เรียบร้อยแล้ว' };
  }

  async resetPinRequest(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.email) {
      throw new BadRequestException('กรุณายืนยันอีเมลในระบบก่อนทำรายการรีเซ็ต PIN');
    }

    // Check if email is verified
    const verificationSetting = await this.prisma.userSetting.findUnique({
      where: {
        userId_key: {
          userId,
          key: 'email_verified',
        },
      },
    });

    if (!verificationSetting || verificationSetting.value !== 'true') {
      throw new BadRequestException('กรุณายืนยันอีเมลในระบบก่อนทำรายการรีเซ็ต PIN');
    }

    // Generate 6-digit OTP code using cryptographically secure randomInt
    const otp = randomInt(100000, 1000000).toString();

    // Store in Redis with 5 minutes TTL
    const redisKey = REDIS_KEYS.USER.PIN_RESET_OTP(userId);
    await this.redis.set(
      redisKey,
      JSON.stringify({ email: user.email, otp }),
      'EX',
      300,
    );

    // Emit event to Kafka for sending mail
    await this.kafkaProducer.emit(KafkaTopic.SECURITY_EVENTS, {
      userId,
      eventType: 'PIN_RESET_OTP',
      metadata: {
        email: user.email,
        otp,
      },
    });

    // ⚠️ DEV ONLY: Remove before production — OTP should be delivered via SMS/Email
    this.logger.warn(`[ResetPIN] Generated reset OTP for user ${userId}: ${otp}`);
    return { success: true, message: 'ส่งรหัส OTP สำหรับรีเซ็ต PIN ไปยังอีเมลของท่านแล้ว' };
  }

  async resetPin(userId: string, dto: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const redisKey = REDIS_KEYS.USER.PIN_RESET_OTP(userId);
    const otpDataString = await this.redis.get(redisKey);

    if (!otpDataString) {
      throw new BadRequestException('รหัส OTP หมดอายุหรือไม่มีความถูกต้อง');
    }

    const { otp } = JSON.parse(otpDataString);
    if (otp !== dto.otp) {
      throw new BadRequestException('รหัส OTP ไม่ถูกต้อง');
    }

    // Delete from Redis
    await this.redis.del(redisKey);

    // Update PIN
    const pinHash = await bcrypt.hash(dto.newPin, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pinHash,
        pinAttempts: 0,
        pinLockedUntil: null,
      },
    });

    await this.logSecurityEvent(userId, NotificationEventType.PIN_SETUP, { action: 'reset' });
    return { success: true, message: 'รีเซ็ตรหัส PIN เรียบร้อยแล้ว' };
  }

  async generateBiometricChallenge(userId: string) {
    // TODO: Implement biometric challenge generation
    return { challenge: randomUUID() };
  }

  async verifyBiometric(userId: string, dto: any, context?: any) {
    // TODO: Implement biometric verification logic
    return { success: true };
  }

  async findAllUserDevices(
    page: number = 1,
    limit: number = 10,
    filters: {
      search?: string;
      os?: string;
      trustLevel?: string;
    } = {},
  ) {
    const { page: safePage, limit: safeLimit, skip, take } = PaginationUtility.getParams({ page, limit });
    const search = filters.search?.trim();

    const where: any = {
      ...(filters.os &&
        filters.os !== 'ALL' && {
          OR: [
            {
              osVersion: {
                contains: filters.os,
                mode: 'insensitive',
              },
            },
            {
              deviceType: {
                contains: filters.os,
                mode: 'insensitive',
              },
            },
          ],
        }),
      ...(filters.trustLevel &&
        filters.trustLevel !== 'ALL' && {
          trustLevel: filters.trustLevel,
        }),
      ...(search && {
        AND: [
          {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { deviceIdentifier: { contains: search, mode: 'insensitive' } },
              { deviceName: { contains: search, mode: 'insensitive' } },
              { deviceType: { contains: search, mode: 'insensitive' } },
              { osVersion: { contains: search, mode: 'insensitive' } },
              { appVersion: { contains: search, mode: 'insensitive' } },
              { userId: { contains: search, mode: 'insensitive' } },
              { user: { email: { contains: search, mode: 'insensitive' } } },
              {
                user: {
                  phoneNumber: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          },
        ],
      }),
    };

    const [devices, total, stats] = await Promise.all([
      this.prisma.userDevice.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phoneNumber: true,
              status: true,
            },
          },
        },
        orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.userDevice.count({ where }),
      this.prisma.userDevice.groupBy({
        by: ['trustLevel'],
        _count: { _all: true },
      }),
    ]);

    const latestSessions = devices.length
      ? await this.prisma.refreshSession.findMany({
          where: {
            deviceId: { in: devices.map((device) => device.id) },
          },
          orderBy: { lastSeenAt: 'desc' },
          distinct: ['deviceId'],
          select: {
            deviceId: true,
            ipAddress: true,
            location: true,
            userAgent: true,
            revokedAt: true,
            lastSeenAt: true,
          },
        })
      : [];

    const sessionsByDeviceId = new Map(
      latestSessions.map((session) => [session.deviceId, session]),
    );

    const data = devices.map((device) => {
      const session = sessionsByDeviceId.get(device.id);

      return {
        id: device.id,
        userId: device.userId,
        email: device.user.email,
        phoneNumber: device.user.phoneNumber,
        userStatus: device.user.status,
        deviceName: device.deviceName,
        deviceIdentifier: device.deviceIdentifier,
        deviceType: device.deviceType,
        osVersion: device.osVersion,
        appVersion: device.appVersion,
        trustLevel: device.trustLevel,
        lastSeenAt: device.lastSeenAt,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt,
        lastIp: session?.ipAddress || null,
        lastLocation: session?.location || null,
        userAgent: session?.userAgent || null,
        sessionRevokedAt: session?.revokedAt || null,
      };
    });

    return {
      data,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
      stats: {
        total: stats.reduce((sum, item) => sum + item._count._all, 0),
        trusted:
          stats.find((item) => item.trustLevel === DeviceTrustLevel.TRUSTED)
            ?._count._all || 0,
        untrusted:
          stats.find((item) => item.trustLevel === DeviceTrustLevel.UNTRUSTED)
            ?._count._all || 0,
        unknown:
          stats.find((item) => item.trustLevel === DeviceTrustLevel.UNKNOWN)
            ?._count._all || 0,
      },
    };
  }

  async revokeUserDevice(deviceId: string) {
    const device = await this.prisma.userDevice.update({
      where: { id: deviceId },
      data: { trustLevel: DeviceTrustLevel.UNTRUSTED },
    });

    await this.prisma.refreshSession.updateMany({
      where: {
        deviceId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await this.logSecurityEvent(device.userId, NotificationEventType.LOGOUT, {
      action: 'DEVICE_REVOKED',
      deviceId,
    });

    return device;
  }

  async createPayToken(userId: string): Promise<{ token: string; expiresAt: string }> {
    const token = 'PAY-' + randomBytes(8).toString('hex').toUpperCase();
    const ttlSeconds = 60; // 1-minute expiration
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    
    // Store token in Redis
    await this.redis.set(REDIS_KEYS.USER.PAY_TOKEN(token), userId, 'EX', ttlSeconds);
    const maskedToken = token.substring(0, 8) + '...';
    this.logger.log(`Generated dynamic pay token for user ${userId}: ${maskedToken}`);
    
    return {
      token,
      expiresAt,
    };
  }
}
