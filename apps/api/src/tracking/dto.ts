import {
  accountInputSchema,
  accountPatchSchema,
  accountSchema,
  amountPeriodInputSchema,
  bulkCategoriseSchema,
  categoryInputSchema,
  categoryPatchSchema,
  categoryRuleInputSchema,
  categoryRulePatchSchema,
  categoryRuleSchema,
  categorySchema,
  markPaidSchema,
  occurrenceQuerySchema,
  occurrenceViewSchema,
  recurringItemPatchSchema,
  recurringItemWithPeriodsInputSchema,
  recurringItemWithPeriodsSchema,
  syncPullQuerySchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  syncPushSchema,
  transactionInputSchema,
  transactionPageSchema,
  transactionPatchSchema,
  transactionQuerySchema,
  transactionSchema,
} from '@zerodue/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class AccountInputDto extends createZodDto(accountInputSchema) {}
export class AccountPatchDto extends createZodDto(accountPatchSchema) {}
export class AccountDto extends createZodDto(accountSchema) {}

export class CategoryInputDto extends createZodDto(categoryInputSchema) {}
export class CategoryPatchDto extends createZodDto(categoryPatchSchema) {}
export class CategoryDto extends createZodDto(categorySchema) {}

export class CategoryRuleInputDto extends createZodDto(categoryRuleInputSchema) {}
export class CategoryRulePatchDto extends createZodDto(categoryRulePatchSchema) {}
export class CategoryRuleDto extends createZodDto(categoryRuleSchema) {}

export class TransactionInputDto extends createZodDto(transactionInputSchema) {}
export class TransactionPatchDto extends createZodDto(transactionPatchSchema) {}
export class TransactionDto extends createZodDto(transactionSchema) {}
export class TransactionQueryDto extends createZodDto(transactionQuerySchema) {}
export class TransactionPageDto extends createZodDto(transactionPageSchema) {}
export class BulkCategoriseDto extends createZodDto(bulkCategoriseSchema) {}

export class RecurringItemInputDto extends createZodDto(recurringItemWithPeriodsInputSchema) {}
export class RecurringItemPatchDto extends createZodDto(recurringItemPatchSchema) {}
export class RecurringItemDto extends createZodDto(recurringItemWithPeriodsSchema) {}
export class SetPeriodsDto extends createZodDto(
  z.object({
    periods: z.array(amountPeriodInputSchema.omit({ id: true, recurringItemId: true })).max(50),
  }),
) {}
export class OccurrenceQueryDto extends createZodDto(occurrenceQuerySchema) {}
export class OccurrenceViewDto extends createZodDto(occurrenceViewSchema) {}
export class MarkPaidDto extends createZodDto(markPaidSchema) {}

export class SyncPushDto extends createZodDto(syncPushSchema) {}
export class SyncPushResponseDto extends createZodDto(syncPushResponseSchema) {}
export class SyncPullQueryDto extends createZodDto(syncPullQuerySchema) {}
export class SyncPullResponseDto extends createZodDto(syncPullResponseSchema) {}
