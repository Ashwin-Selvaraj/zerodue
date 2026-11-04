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
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { DEVICE_HEADER, writeContext } from '../common/device';
import { RecordsService } from '../records/records.service';
import {
  AccountDto,
  AccountInputDto,
  AccountPatchDto,
  CategoryDto,
  CategoryInputDto,
  CategoryPatchDto,
  CategoryRuleDto,
  CategoryRuleInputDto,
  CategoryRulePatchDto,
} from './dto';

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  @ApiOkResponse({ type: [AccountDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.records.list(user.id, 'account');
  }

  @Post()
  @ApiCreatedResponse({ type: AccountDto })
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: AccountInputDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.create(user.id, 'account', body, writeContext(device));
  }

  @Get(':id')
  @ApiOkResponse({ type: AccountDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.records.get(user.id, 'account', id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: AccountDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AccountPatchDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.update(user.id, 'account', id, body, writeContext(device));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.remove(user.id, 'account', id, writeContext(device));
  }
}

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  @ApiOkResponse({ type: [CategoryDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.records.list(user.id, 'category');
  }

  /** The categories shown as action buttons on the "What type of payment?" notification. */
  @Get('quick-picks')
  @ApiOkResponse({ type: [CategoryDto] })
  async quickPicks(@CurrentUser() user: AuthUser) {
    const all = (await this.records.list(user.id, 'category')) as { quickPick: boolean }[];
    return all.filter((category) => category.quickPick);
  }

  @Post()
  @ApiCreatedResponse({ type: CategoryDto })
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CategoryInputDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.create(user.id, 'category', body, writeContext(device));
  }

  @Get(':id')
  @ApiOkResponse({ type: CategoryDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.records.get(user.id, 'category', id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: CategoryDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CategoryPatchDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.update(user.id, 'category', id, body, writeContext(device));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.remove(user.id, 'category', id, writeContext(device));
  }
}

@ApiTags('rules')
@ApiBearerAuth()
@Controller('rules')
export class RulesController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  @ApiOkResponse({ type: [CategoryRuleDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.records.list(user.id, 'categoryRule');
  }

  @Post()
  @ApiCreatedResponse({ type: CategoryRuleDto })
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CategoryRuleInputDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.create(user.id, 'categoryRule', body, writeContext(device));
  }

  @Patch(':id')
  @ApiOkResponse({ type: CategoryRuleDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CategoryRulePatchDto,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.update(user.id, 'categoryRule', id, body, writeContext(device));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(DEVICE_HEADER) device?: string,
  ) {
    return this.records.remove(user.id, 'categoryRule', id, writeContext(device));
  }
}

const auditQuery = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().uuid().optional(),
});

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Edit history of financial records, including versions that lost a sync conflict. */
  @Get()
  history(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    const { entity, entityId } = auditQuery.parse(query);
    return this.audit.history(user.id, entity, entityId);
  }
}
