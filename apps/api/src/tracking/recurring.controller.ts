import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { DEVICE_HEADER, writeContext } from '../common/device';
import {
  MarkPaidDto,
  OccurrenceQueryDto,
  OccurrenceViewDto,
  RecurringItemDto,
  RecurringItemInputDto,
  RecurringItemPatchDto,
  SetPeriodsDto,
} from './dto';
import { RecurringService } from './recurring.service';

@ApiTags('recurring')
@ApiBearerAuth()
@Controller('recurring')
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Get()
  @ApiOkResponse({ type: [RecurringItemDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.recurring.list(user.id);
  }

  @Post()
  @ApiCreatedResponse({ type: RecurringItemDto })
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: RecurringItemInputDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.recurring.create(user.id, body, writeContext(device));
  }

  // Occurrence routes come before `:id` so "occurrences" is not read as an id.

  /** Due dates in a range (default: last month to two months ahead), with the overdue flag. */
  @Get('occurrences')
  @ApiOkResponse({ type: [OccurrenceViewDto] })
  occurrences(@CurrentUser() user: AuthUser, @Query() query: OccurrenceQueryDto) {
    return this.recurring.occurrences(user.id, query);
  }

  @Post('occurrences/:id/mark-paid')
  @HttpCode(200)
  @ApiOkResponse({ type: OccurrenceViewDto })
  markPaid(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MarkPaidDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.recurring.markPaid(user.id, id, body, writeContext(device));
  }

  @Post('occurrences/:id/unmark')
  @HttpCode(200)
  @ApiOkResponse({ type: OccurrenceViewDto })
  unmark(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.recurring.unmark(user.id, id, writeContext(device));
  }

  @Post('occurrences/:id/skip')
  @HttpCode(200)
  @ApiOkResponse({ type: OccurrenceViewDto })
  skip(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.recurring.skip(user.id, id, writeContext(device));
  }

  @Get(':id')
  @ApiOkResponse({ type: RecurringItemDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurring.get(user.id, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: RecurringItemDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecurringItemPatchDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.recurring.update(user.id, id, body, writeContext(device));
  }

  /** Replaces the whole amount schedule, e.g. ₹20,000 until the Mar bill, then ₹12,000. */
  @Put(':id/periods')
  @ApiOkResponse({ type: RecurringItemDto })
  setPeriods(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetPeriodsDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.recurring.setPeriods(user.id, id, body.periods, writeContext(device));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.recurring.remove(user.id, id, writeContext(device));
  }
}
