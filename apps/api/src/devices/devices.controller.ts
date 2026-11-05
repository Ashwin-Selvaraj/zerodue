import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { pairRequestSchema, type DeviceDto } from '@zerodue/shared';
import { createZodDto } from 'nestjs-zod';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { DevicesService } from './devices.service';

class PairDto extends createZodDto(pairRequestSchema) {}

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly config: AppConfig,
  ) {}

  /** What to show as a QR code: the code plus the address the phone should call. */
  @ApiBearerAuth()
  @Post('pairing-codes')
  async pairingCode(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const { code, expiresAt } = await this.devices.createPairingCode(user.id);
    const apiUrl = (
      this.config.env.PUBLIC_API_URL ?? `${req.protocol}://${req.get('host')}`
    ).replace(/\/$/, '');
    return { code, expiresAt, qrPayload: { apiUrl, code } };
  }

  /** The phone trades the code for its token. Not signed in, so strictly rate-limited. */
  @Public()
  @Throttle({ default: { limit: () => Number(process.env.AUTH_RATE_LIMIT ?? 10), ttl: 60_000 } })
  @Post('pair')
  @HttpCode(200)
  pair(@Body() body: PairDto) {
    return this.devices.pair(body.code, body.deviceName);
  }

  @ApiBearerAuth()
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<DeviceDto[]> {
    return this.devices.list(user.id);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.devices.revoke(user.id, id);
  }
}
