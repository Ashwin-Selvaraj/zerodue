import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ingestBatchSchema,
  ingestSmsSchema,
  parseTestSchema,
  parseSms,
  readSms,
} from '@zerodue/shared';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { DeviceAccess } from '../common/device-access.decorator';
import { IngestService } from './ingest.service';

class IngestSmsDto extends createZodDto(ingestSmsSchema) {}
class IngestBatchDto extends createZodDto(ingestBatchSchema) {}
class ParseTestDto extends createZodDto(parseTestSchema) {}

@ApiTags('ingest')
@ApiBearerAuth()
@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  /** What the phone needs to decide which messages to read, and the notification's buttons. */
  @DeviceAccess()
  @Get('config')
  config(@CurrentUser() user: AuthUser) {
    return this.ingest.config(user.id);
  }

  @DeviceAccess()
  @Throttle({ default: { limit: () => Number(process.env.INGEST_RATE_LIMIT ?? 60), ttl: 60_000 } })
  @Post('sms')
  @HttpCode(200)
  sms(@CurrentUser() user: AuthUser, @Body() body: IngestSmsDto) {
    return this.ingest.ingest(user.id, body, user.deviceId ?? null);
  }

  /** Flushes the phone's queue after being offline. */
  @DeviceAccess()
  @Throttle({ default: { limit: () => Number(process.env.INGEST_RATE_LIMIT ?? 60), ttl: 60_000 } })
  @Post('sms/batch')
  @HttpCode(200)
  batch(@CurrentUser() user: AuthUser, @Body() body: IngestBatchDto) {
    return this.ingest.ingestBatch(user.id, body.events, user.deviceId ?? null);
  }

  /** Paste a message to see how it would be read, and whether it would be captured at all. */
  @Post('parse-test')
  @HttpCode(200)
  async parseTest(@CurrentUser() user: AuthUser, @Body() body: ParseTestDto) {
    if (body.sender === undefined) return parseSms(body.body);
    const { allowList } = await this.ingest.settings(user.id);
    return readSms(body.sender, body.body, allowList);
  }
}
