import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { Logger } from 'nestjs-pino';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import express from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { 
    rawBody: true,
    bufferLogs: true 
  });

  // Enable 'trust proxy' so Express can extract correct client IPs behind Nginx gateway / reverse proxies
  const expressApp = app.getHttpAdapter().getInstance();
  if (expressApp && typeof expressApp.set === 'function') {
    expressApp.set('trust proxy', 1);
    expressApp.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
  }


  // Use Pino Logger as global logger
  app.useLogger(app.get(Logger));

  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
  const isProduction = nodeEnv === 'production';

  // Secure HTTP Headers
  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
      crossOriginEmbedderPolicy: true,
    }),
  );

  // Swagger Documentation Setup

  // Only enable Swagger in non-production environments to prevent API structure exposure
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('J-Ledger Portal API')
      .setDescription('The core API for J-Ledger Fintech Platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new TransformInterceptor() as any,
    new ClassSerializerInterceptor(app.get(Reflector)),
  );

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  if (nodeEnv === 'production' && !process.env.JLEDGER_ALLOWED_ORIGINS) {
    throw new Error(
      'PRODUCTION SECURITY ERROR: JLEDGER_ALLOWED_ORIGINS environment variable must be explicitly defined in production.',
    );
  }

  const allowedOrigins = process.env.JLEDGER_ALLOWED_ORIGINS
    ? process.env.JLEDGER_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
      ];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200,
    maxAge: 3600,
    preflightContinue: false,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Portal Service running on port ${port} (0.0.0.0)`);
}
bootstrap();
