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
  type Type,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { SyncEntity } from '@zerodue/shared';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { DEVICE_HEADER, writeContext } from '../common/device';
import { RecordsService } from '../records/records.service';
import {
  AllocationRuleDto,
  AllocationRuleInputDto,
  AllocationRulePatchDto,
  GoalContributionDto,
  GoalContributionInputDto,
  GoalContributionPatchDto,
  GoalDto,
  GoalInputDto,
  GoalPatchDto,
  LoanDto,
  LoanInputDto,
  LoanLedgerDto,
  LoanLedgerInputDto,
  LoanLedgerPatchDto,
  LoanPatchDto,
  PlannedPaymentDto,
  PlannedPaymentInputDto,
  PlannedPaymentPatchDto,
  ReceivableDto,
  ReceivableInputDto,
  ReceivablePatchDto,
  ScenarioDto,
  ScenarioInputDto,
  ScenarioPatchDto,
} from './dto';

interface CrudDtos {
  entity: SyncEntity;
  path: string;
  tag: string;
  input: Type<unknown>;
  patch: Type<unknown>;
  output: Type<unknown>;
}

/**
 * A plain list/get/create/patch/delete controller for one synced record type. These records are
 * normally written through /sync/push; the REST routes serve other clients and scripts.
 */
function crudController(dtos: CrudDtos): Type<unknown> {
  @ApiTags(dtos.tag)
  @ApiBearerAuth()
  @Controller(dtos.path)
  class CrudController {
    constructor(readonly records: RecordsService) {}

    @Get()
    @ApiOkResponse({ type: [dtos.output] })
    list(@CurrentUser() user: AuthUser) {
      return this.records.list(user.id, dtos.entity);
    }

    @Post()
    @ApiBody({ type: dtos.input })
    @ApiCreatedResponse({ type: dtos.output })
    create(
      @CurrentUser() user: AuthUser,
      @Body() body: object,
      @Headers(DEVICE_HEADER) device?: string,
    ) {
      return this.records.create(user.id, dtos.entity, body, writeContext(device));
    }

    @Get(':id')
    @ApiOkResponse({ type: dtos.output })
    get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
      return this.records.get(user.id, dtos.entity, id);
    }

    @Patch(':id')
    @ApiBody({ type: dtos.patch })
    @ApiOkResponse({ type: dtos.output })
    update(
      @CurrentUser() user: AuthUser,
      @Param('id', ParseUUIDPipe) id: string,
      @Body() body: object,
      @Headers(DEVICE_HEADER) device?: string,
    ) {
      return this.records.update(user.id, dtos.entity, id, body, writeContext(device));
    }

    @Delete(':id')
    @HttpCode(204)
    remove(
      @CurrentUser() user: AuthUser,
      @Param('id', ParseUUIDPipe) id: string,
      @Headers(DEVICE_HEADER) device?: string,
    ) {
      return this.records.remove(user.id, dtos.entity, id, writeContext(device));
    }
  }
  return CrudController;
}

export const LoansController = crudController({
  entity: 'loan',
  path: 'loans',
  tag: 'loans',
  input: LoanInputDto,
  patch: LoanPatchDto,
  output: LoanDto,
});
export const LoanLedgerController = crudController({
  entity: 'loanLedgerEntry',
  path: 'loan-ledger',
  tag: 'loans',
  input: LoanLedgerInputDto,
  patch: LoanLedgerPatchDto,
  output: LoanLedgerDto,
});
export const PlannedPaymentsController = crudController({
  entity: 'loanPlannedPayment',
  path: 'planned-payments',
  tag: 'loans',
  input: PlannedPaymentInputDto,
  patch: PlannedPaymentPatchDto,
  output: PlannedPaymentDto,
});
export const ScenariosController = crudController({
  entity: 'scenario',
  path: 'scenarios',
  tag: 'loans',
  input: ScenarioInputDto,
  patch: ScenarioPatchDto,
  output: ScenarioDto,
});
export const ReceivablesController = crudController({
  entity: 'receivable',
  path: 'receivables',
  tag: 'receivables',
  input: ReceivableInputDto,
  patch: ReceivablePatchDto,
  output: ReceivableDto,
});
export const GoalsController = crudController({
  entity: 'goal',
  path: 'goals',
  tag: 'goals',
  input: GoalInputDto,
  patch: GoalPatchDto,
  output: GoalDto,
});
export const GoalContributionsController = crudController({
  entity: 'goalContribution',
  path: 'goal-contributions',
  tag: 'goals',
  input: GoalContributionInputDto,
  patch: GoalContributionPatchDto,
  output: GoalContributionDto,
});
export const AllocationRulesController = crudController({
  entity: 'allocationRule',
  path: 'allocation-rules',
  tag: 'planner',
  input: AllocationRuleInputDto,
  patch: AllocationRulePatchDto,
  output: AllocationRuleDto,
});

export const PLANNING_CONTROLLERS = [
  LoansController,
  LoanLedgerController,
  PlannedPaymentsController,
  ScenariosController,
  ReceivablesController,
  GoalsController,
  GoalContributionsController,
  AllocationRulesController,
];
