import {
  accountInputSchema,
  accountPatchSchema,
  accountSchema,
  amountPeriodInputSchema,
  amountPeriodPatchSchema,
  amountPeriodSchema,
  categoryInputSchema,
  categoryPatchSchema,
  categoryRuleInputSchema,
  categoryRulePatchSchema,
  categoryRuleSchema,
  categorySchema,
  occurrenceInputSchema,
  occurrencePatchSchema,
  occurrenceSchema,
  recurringItemInputSchema,
  recurringItemPatchSchema,
  recurringItemSchema,
  transactionInputSchema,
  transactionPatchSchema,
  transactionSchema,
  type SyncEntity,
} from '@zerodue/shared';
import type { ZodObject, ZodRawShape, ZodTypeAny } from 'zod';

/** Everything the generic records/sync code needs to know about a synced record type. */
export interface EntityDef {
  name: SyncEntity;
  /** Prisma client delegate name, e.g. `recurringItem`. */
  delegate: string;
  /** What a client may write (full record). */
  input: ZodTypeAny;
  /** Partial write for PATCH. */
  patch: ZodTypeAny;
  /** What the API returns; its keys are the only columns exposed. */
  output: ZodObject<ZodRawShape>;
  /** Columns stored as `date`; exchanged as YYYY-MM-DD. */
  dateOnly: string[];
  /** Columns stored as timestamptz; exchanged as ISO strings. */
  instants: string[];
  /** Foreign keys that must point at the same user's records. */
  refs: Record<string, SyncEntity>;
}

const META_INSTANTS = ['createdAt', 'updatedAt', 'editedAt', 'deletedAt'];

export const ENTITIES: Record<SyncEntity, EntityDef> = {
  account: {
    name: 'account',
    delegate: 'account',
    input: accountInputSchema,
    patch: accountPatchSchema,
    output: accountSchema,
    dateOnly: ['balanceAsOf'],
    instants: META_INSTANTS,
    refs: {},
  },
  category: {
    name: 'category',
    delegate: 'category',
    input: categoryInputSchema,
    patch: categoryPatchSchema,
    output: categorySchema,
    dateOnly: [],
    instants: META_INSTANTS,
    refs: { parentId: 'category' },
  },
  categoryRule: {
    name: 'categoryRule',
    delegate: 'categoryRule',
    input: categoryRuleInputSchema,
    patch: categoryRulePatchSchema,
    output: categoryRuleSchema,
    dateOnly: [],
    instants: META_INSTANTS,
    refs: { categoryId: 'category' },
  },
  transaction: {
    name: 'transaction',
    delegate: 'transaction',
    input: transactionInputSchema,
    patch: transactionPatchSchema,
    output: transactionSchema,
    dateOnly: [],
    instants: [...META_INSTANTS, 'occurredAt'],
    refs: { accountId: 'account', toAccountId: 'account', categoryId: 'category' },
  },
  recurringItem: {
    name: 'recurringItem',
    delegate: 'recurringItem',
    input: recurringItemInputSchema,
    patch: recurringItemPatchSchema,
    output: recurringItemSchema,
    dateOnly: ['anchorMonth', 'startDate', 'endDate'],
    instants: META_INSTANTS,
    refs: { categoryId: 'category', accountId: 'account' },
  },
  recurringAmountPeriod: {
    name: 'recurringAmountPeriod',
    delegate: 'recurringAmountPeriod',
    input: amountPeriodInputSchema,
    patch: amountPeriodPatchSchema,
    output: amountPeriodSchema,
    dateOnly: ['effectiveFrom'],
    instants: META_INSTANTS,
    refs: { recurringItemId: 'recurringItem' },
  },
  recurringOccurrence: {
    name: 'recurringOccurrence',
    delegate: 'recurringOccurrence',
    input: occurrenceInputSchema,
    patch: occurrencePatchSchema,
    output: occurrenceSchema as unknown as ZodObject<ZodRawShape>,
    dateOnly: ['dueDate'],
    instants: [...META_INSTANTS, 'paidAt', 'snoozedUntil'],
    refs: { recurringItemId: 'recurringItem' },
  },
};
