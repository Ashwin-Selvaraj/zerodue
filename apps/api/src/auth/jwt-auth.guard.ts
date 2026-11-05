import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from '../common/current-user.decorator';
import { DEVICE_ACCESS_KEY } from '../common/device-access.decorator';
import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { DEVICE_TOKEN_PREFIX } from '../devices/device-token';
import { DevicesService } from '../devices/devices.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly devices: DevicesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing access token');

    // A phone's token is only good on the few routes that opt in.
    if (token.startsWith(DEVICE_TOKEN_PREFIX)) {
      if (!this.reflector.getAllAndOverride<boolean>(DEVICE_ACCESS_KEY, targets)) {
        throw new UnauthorizedException('This device token cannot be used here');
      }
      const device = await this.devices.authenticate(token);
      if (!device) throw new UnauthorizedException('Unknown or revoked device');
      request.user = { id: device.userId, deviceId: device.id };
      return true;
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      request.user = { id: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
