import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { SyncPullQueryDto, SyncPullResponseDto, SyncPushDto, SyncPushResponseDto } from './dto';
import { SyncService } from './sync.service';

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** Sends a device's queued edits. Each op gets its own result, so one bad record never blocks the rest. */
  @Post('push')
  @HttpCode(200)
  @ApiOkResponse({ type: SyncPushResponseDto })
  push(@CurrentUser() user: AuthUser, @Body() body: SyncPushDto) {
    return this.sync.push(user.id, body);
  }

  /** Changes since the cursor (omit it for a first sync). Repeat while `hasMore` is true. */
  @Get('pull')
  @ApiOkResponse({ type: SyncPullResponseDto })
  pull(@CurrentUser() user: AuthUser, @Query() query: SyncPullQueryDto) {
    return this.sync.pull(user.id, query);
  }
}
