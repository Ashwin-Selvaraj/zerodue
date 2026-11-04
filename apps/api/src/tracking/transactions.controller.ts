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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { DEVICE_HEADER, writeContext } from '../common/device';
import { RecordsService } from '../records/records.service';
import {
  BulkCategoriseDto,
  TransactionDto,
  TransactionInputDto,
  TransactionPageDto,
  TransactionPatchDto,
  TransactionQueryDto,
} from './dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly records: RecordsService,
    private readonly transactions: TransactionsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: TransactionPageDto })
  list(@CurrentUser() user: AuthUser, @Query() query: TransactionQueryDto) {
    return this.transactions.list(user.id, query);
  }

  @Post()
  @ApiCreatedResponse({ type: TransactionDto })
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: TransactionInputDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.create(user.id, 'transaction', body, writeContext(device));
  }

  @Post('bulk-categorise')
  @HttpCode(200)
  @ApiOkResponse({ type: [TransactionDto] })
  bulkCategorise(
    @CurrentUser() user: AuthUser,
    @Body() body: BulkCategoriseDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.transactions.bulkCategorise(user.id, body, writeContext(device));
  }

  @Get(':id')
  @ApiOkResponse({ type: TransactionDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.records.get(user.id, 'transaction', id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: TransactionDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransactionPatchDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.update(user.id, 'transaction', id, body, writeContext(device));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.remove(user.id, 'transaction', id, writeContext(device));
  }
}
