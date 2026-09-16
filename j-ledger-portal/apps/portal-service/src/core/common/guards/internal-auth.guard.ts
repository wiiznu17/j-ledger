import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const internalSecret = request.headers['x-internal-secret'];
    const expectedSecret = process.env.JLEDGER_INTERNAL_SECRET;

    if (!expectedSecret) {
      throw new UnauthorizedException('JLEDGER_INTERNAL_SECRET is not configured');
    }

    if (internalSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }

    return true;
  }
}
