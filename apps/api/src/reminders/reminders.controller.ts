import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { uuidSchema } from '@zerodue/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { DEVICE_HEADER, writeContext } from '../common/device';
import { Public } from '../common/public.decorator';
import { PushSender } from './push.sender';
import { RemindersService } from './reminders.service';

class SnoozeDto extends createZodDto(
  z.object({
    minutes: z
      .number()
      .int()
      .min(1)
      .max(7 * 24 * 60)
      .default(60),
  }),
) {}

class SubscribeDto extends createZodDto(
  z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  }),
) {}

@ApiTags('reminders')
@ApiBearerAuth()
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  @ApiOkResponse({ description: 'Reminders that have come due and still need attention' })
  list(@CurrentUser() user: AuthUser) {
    return this.reminders.list(user.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reminders.markRead(user.id, id);
  }

  @Post(':id/dismiss')
  @HttpCode(204)
  dismiss(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reminders.dismiss(user.id, id);
  }

  @Post(':id/snooze')
  @HttpCode(200)
  snooze(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SnoozeDto,
  ) {
    return this.reminders.snooze(user.id, id, body.minutes);
  }

  @Post(':id/mark-paid')
  @HttpCode(200)
  markPaid(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.reminders.markPaid(user.id, id, writeContext(device));
  }
}

@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly sender: PushSender,
  ) {}

  /** What the browser needs to subscribe; null when push is not set up on this server. */
  @Public()
  @Get('vapid-public-key')
  vapidPublicKey() {
    return { publicKey: this.sender.publicKey };
  }

  @ApiBearerAuth()
  @Post('subscriptions')
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body() body: SubscribeDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    const deviceId = device && uuidSchema.safeParse(device).success ? device : null;
    return this.reminders.subscribe(
      user.id,
      { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth },
      deviceId,
    );
  }

  @ApiBearerAuth()
  @Delete('subscriptions/:id')
  @HttpCode(204)
  unsubscribe(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reminders.unsubscribe(user.id, id);
  }
}
