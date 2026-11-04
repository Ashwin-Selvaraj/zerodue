import { z } from 'zod';

/**
 * Schemas for every user-editable record that syncs between devices.
 * `xInputSchema` is what a client may write; `xSchema` is what the API returns (input + sync metadata).
 */

// ───────────────────────────── primitives ─────────────────────────────

export const uuidSchema = z.string().uuid();
/** An instant with an explicit offset, e.g. 2026-11-04T10:15:00+05:30. */
export const instantSchema = z.string().datetime({ offset: true });
/** A calendar date, YYYY-MM-DD. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const MAX_PAISE = 2_147_483_647; // 32-bit column
export const paiseSchema = z.number().int().min(0).max(MAX_PAISE);
export const positivePaiseSchema = z.number().int().min(1).max(MAX_PAISE);

export const syncMetaSchema = z.object({
  id: uuidSchema,
  version: z.number().int().min(1),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  /** When the edit was made on the device (drives newest-edit-wins). */
  editedAt: instantSchema,
  /** Set when the record was deleted (a tombstone, so other devices learn of it). */
  deletedAt: instantSchema.nullable(),
  lastDeviceId: uuidSchema.nullable(),
});
export type SyncMeta = z.infer<typeof syncMetaSchema>;

const idField = { id: uuidSchema.optional() };

// ───────────────────────────── accounts ─────────────────────────────

export const accountTypes = ['BANK', 'CREDIT_CARD', 'CASH', 'WALLET', 'LOAN'] as const;

export const accountInputSchema = z.object({
  ...idField,
  name: z.string().trim().min(1).max(80),
  type: z.enum(accountTypes),
  last4: z
    .string()
    .regex(/^\d{4}$/)
    .nullish(),
  balancePaise: paiseSchema.default(0),
  balanceAsOf: dateOnlySchema.nullish(),
  creditLimitPaise: paiseSchema.nullish(),
  archived: z.boolean().default(false),
});
export const accountSchema = accountInputSchema
  .required({ balancePaise: true, archived: true })
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type AccountInput = z.infer<typeof accountInputSchema>;
export type AccountDto = z.infer<typeof accountSchema>;
export const accountPatchSchema = accountInputSchema.omit({ id: true }).partial();

// ───────────────────────────── categories & rules ─────────────────────────────

export const categoryKinds = ['EXPENSE', 'INCOME', 'BOTH'] as const;

export const categoryInputSchema = z.object({
  ...idField,
  name: z.string().trim().min(1).max(60),
  kind: z.enum(categoryKinds).default('EXPENSE'),
  parentId: uuidSchema.nullish(),
  icon: z.string().max(40).nullish(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  sortOrder: z.number().int().default(0),
  /** Shown as an action button on the "What type of payment?" notification. */
  quickPick: z.boolean().default(false),
});
export const categorySchema = categoryInputSchema
  .required({ kind: true, sortOrder: true, quickPick: true })
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type CategoryDto = z.infer<typeof categorySchema>;
export const categoryPatchSchema = categoryInputSchema.omit({ id: true }).partial();

export const ruleMatchTypes = [
  'MERCHANT_EQUALS',
  'MERCHANT_CONTAINS',
  'VPA_EQUALS',
  'REMARKS_REGEX',
] as const;

export const categoryRuleInputSchema = z.object({
  ...idField,
  matchType: z.enum(ruleMatchTypes),
  pattern: z.string().trim().min(1).max(200),
  categoryId: uuidSchema,
  priority: z.number().int().default(100),
  enabled: z.boolean().default(true),
});
export const categoryRuleSchema = categoryRuleInputSchema
  .required({ priority: true, enabled: true })
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type CategoryRuleInput = z.infer<typeof categoryRuleInputSchema>;
export type CategoryRuleDto = z.infer<typeof categoryRuleSchema>;
export const categoryRulePatchSchema = categoryRuleInputSchema.omit({ id: true }).partial();

// ───────────────────────────── transactions ─────────────────────────────

export const transactionTypes = ['EXPENSE', 'INCOME', 'TRANSFER'] as const;
export const transactionStatuses = ['POSTED', 'PENDING_CATEGORY', 'IGNORED'] as const;
export const transactionSources = [
  'MANUAL',
  'SMS_BANK',
  'SMS_UPI',
  'STATEMENT_IMPORT',
  'RECURRING',
  'SYSTEM',
] as const;
export const categorisedVias = ['MANUAL', 'RULE', 'FLUTTER', 'PUSH', 'IMPORT'] as const;

const transactionFields = z.object({
  ...idField,
  type: z.enum(transactionTypes),
  status: z.enum(transactionStatuses).default('POSTED'),
  /** Always positive; direction comes from `type`. */
  amountPaise: positivePaiseSchema,
  accountId: uuidSchema,
  /** Transfers only: the account the money moves into. */
  toAccountId: uuidSchema.nullish(),
  categoryId: uuidSchema.nullish(),
  categorisedVia: z.enum(categorisedVias).nullish(),
  occurredAt: instantSchema,
  merchant: z.string().trim().max(120).nullish(),
  vpa: z.string().trim().max(120).nullish(),
  note: z.string().max(500).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  upiRef: z.string().trim().max(40).nullish(),
  last4: z
    .string()
    .regex(/^\d{4}$/)
    .nullish(),
  source: z.enum(transactionSources).default('MANUAL'),
});

function checkTransfer(
  value: { type: string; accountId: string; toAccountId?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (value.type === 'TRANSFER') {
    if (!value.toAccountId) {
      ctx.addIssue({
        code: 'custom',
        path: ['toAccountId'],
        message: 'Transfers need a destination account',
      });
    } else if (value.toAccountId === value.accountId) {
      ctx.addIssue({
        code: 'custom',
        path: ['toAccountId'],
        message: 'Choose a different account',
      });
    }
  } else if (value.toAccountId) {
    ctx.addIssue({
      code: 'custom',
      path: ['toAccountId'],
      message: 'Only transfers have a destination account',
    });
  }
}

export const transactionInputSchema = transactionFields.superRefine(checkTransfer);
export const transactionSchema = transactionFields
  .required({ status: true, tags: true, source: true })
  .extend({ id: uuidSchema, occurrenceId: uuidSchema.nullable() })
  .merge(syncMetaSchema.omit({ id: true }));
export type TransactionInput = z.infer<typeof transactionInputSchema>;
export type TransactionDto = z.infer<typeof transactionSchema>;
export const transactionPatchSchema = transactionFields.omit({ id: true }).partial();

export const transactionQuerySchema = z.object({
  /** Month filter in IST, YYYY-MM-01. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/)
    .optional(),
  categoryId: uuidSchema.optional(),
  accountId: uuidSchema.optional(),
  status: z.enum(transactionStatuses).optional(),
  source: z.enum(transactionSources).optional(),
  tag: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;

export const bulkCategoriseSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(200),
  categoryId: uuidSchema,
});
export type BulkCategoriseInput = z.infer<typeof bulkCategoriseSchema>;

export const transactionPageSchema = z.object({
  items: z.array(transactionSchema),
  nextCursor: z.string().nullable(),
});

// ───────────────────────────── recurring ─────────────────────────────

export const recurringKinds = ['INCOME', 'EXPENSE'] as const;
export const frequencies = ['MONTHLY', 'QUARTERLY', 'ONE_TIME'] as const;

export const recurringItemInputSchema = z.object({
  ...idField,
  kind: z.enum(recurringKinds),
  name: z.string().trim().min(1).max(80),
  frequency: z.enum(frequencies),
  dueDay: z.number().int().min(1).max(31).nullish(),
  /** QUARTERLY cycles from this month (first of month). */
  anchorMonth: dateOnlySchema.nullish(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullish(),
  categoryId: uuidSchema.nullish(),
  accountId: uuidSchema.nullish(),
  /** Days before the due date to remind, e.g. [3, 1]. */
  reminderLeadDays: z.array(z.number().int().min(0).max(30)).max(5).default([]),
  /** For income: false means earmarked (not "my money"), routed by allocation rules. */
  fixedOutgoing: z.boolean().default(true),
  active: z.boolean().default(true),
});
export const recurringItemSchema = recurringItemInputSchema
  .required({ reminderLeadDays: true, fixedOutgoing: true, active: true })
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type RecurringItemInput = z.infer<typeof recurringItemInputSchema>;
export type RecurringItemDto = z.infer<typeof recurringItemSchema>;
export const recurringItemPatchSchema = recurringItemInputSchema.omit({ id: true }).partial();

export const amountPeriodInputSchema = z.object({
  ...idField,
  recurringItemId: uuidSchema,
  /** First due date this amount applies to. */
  effectiveFrom: dateOnlySchema,
  amountPaise: paiseSchema,
  label: z.string().max(80).nullish(),
  /** Display-only split of the amount, e.g. {"Fuel": 700000}. */
  breakdown: z.record(z.string(), z.number().int().min(0)).nullish(),
});
export const amountPeriodSchema = amountPeriodInputSchema
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type AmountPeriodInput = z.infer<typeof amountPeriodInputSchema>;
export type AmountPeriodDto = z.infer<typeof amountPeriodSchema>;
export const amountPeriodPatchSchema = amountPeriodInputSchema.omit({ id: true }).partial();

/** A recurring item together with its amount periods, for create/read in one call. */
export const recurringItemWithPeriodsInputSchema = recurringItemInputSchema.extend({
  periods: z
    .array(amountPeriodInputSchema.omit({ id: true, recurringItemId: true }))
    .max(50)
    .default([]),
});
export type RecurringItemWithPeriodsInput = z.infer<typeof recurringItemWithPeriodsInputSchema>;
export const recurringItemWithPeriodsSchema = recurringItemSchema.extend({
  periods: z.array(amountPeriodSchema),
});
export type RecurringItemWithPeriodsDto = z.infer<typeof recurringItemWithPeriodsSchema>;

export const occurrenceStatuses = ['UPCOMING', 'PAID', 'SKIPPED'] as const;

export const occurrenceInputSchema = z.object({
  ...idField,
  recurringItemId: uuidSchema,
  dueDate: dateOnlySchema,
  label: z.string().max(80).nullish(),
  expectedAmountPaise: paiseSchema,
  status: z.enum(occurrenceStatuses).default('UPCOMING'),
  paidAt: instantSchema.nullish(),
  paidAmountPaise: paiseSchema.nullish(),
  snoozedUntil: instantSchema.nullish(),
});
export const occurrenceSchema = occurrenceInputSchema
  .required({ status: true })
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }))
  .extend({ overdue: z.boolean().optional() });
/** Occurrence as listed by the API: with the recurring item's name and kind, and the overdue flag. */
export const occurrenceViewSchema = occurrenceSchema.extend({
  name: z.string(),
  kind: z.enum(recurringKinds),
  overdue: z.boolean(),
});
export type OccurrenceView = z.infer<typeof occurrenceViewSchema>;
export type OccurrenceInput = z.infer<typeof occurrenceInputSchema>;
export type OccurrenceDto = z.infer<typeof occurrenceSchema>;
export const occurrencePatchSchema = occurrenceInputSchema.omit({ id: true }).partial();

export const occurrenceQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  status: z.enum(occurrenceStatuses).optional(),
});
export type OccurrenceQuery = z.infer<typeof occurrenceQuerySchema>;

export const markPaidSchema = z.object({
  paidAt: instantSchema.optional(),
  /** Actual amount paid; defaults to the expected amount. */
  amountPaise: positivePaiseSchema.optional(),
  /** Also record a transaction for this payment. */
  createTransaction: z.boolean().default(false),
  /** Account for the transaction; falls back to the item's account. */
  accountId: uuidSchema.optional(),
});
export type MarkPaidInput = z.infer<typeof markPaidSchema>;

// ───────────────────────────── sync ─────────────────────────────

export const syncEntities = [
  'account',
  'category',
  'categoryRule',
  'transaction',
  'recurringItem',
  'recurringAmountPeriod',
  'recurringOccurrence',
] as const;
export type SyncEntity = (typeof syncEntities)[number];
export const syncEntitySchema = z.enum(syncEntities);

export const syncOpSchema = z.object({
  entity: syncEntitySchema,
  op: z.enum(['upsert', 'delete']),
  id: uuidSchema,
  /** Full record for upserts (the schema for `entity`). Ignored for deletes. */
  data: z.record(z.string(), z.unknown()).optional(),
  /** When the user made this edit on the device. */
  editedAt: instantSchema,
  /** The record version this edit was based on (0 for a new record). */
  baseVersion: z.number().int().min(0).default(0),
});
export type SyncOp = z.infer<typeof syncOpSchema>;

export const syncPushSchema = z.object({
  deviceId: uuidSchema,
  ops: z.array(syncOpSchema).max(200),
});
export type SyncPushInput = z.infer<typeof syncPushSchema>;

export const syncOpResultSchema = z.object({
  entity: syncEntitySchema,
  id: uuidSchema,
  /** applied: stored. conflict: another edit won, see `serverRow`. rejected: invalid, see `error`. */
  status: z.enum(['applied', 'conflict', 'rejected']),
  error: z.string().optional(),
  /** The current server record when this device's edit lost (or on a version-stale delete). */
  serverRow: z.record(z.string(), z.unknown()).optional(),
});
export type SyncOpResult = z.infer<typeof syncOpResultSchema>;
export const syncPushResponseSchema = z.object({ results: z.array(syncOpResultSchema) });
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

export const syncPullQuerySchema = z.object({
  /** Opaque cursor from the previous pull; omit for a full initial sync. */
  cursor: z.string().max(2000).optional(),
  /** The caller's device, so it does not receive its own writes back. */
  deviceId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export const syncPullResponseSchema = z.object({
  changes: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  cursor: z.string(),
  hasMore: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;
