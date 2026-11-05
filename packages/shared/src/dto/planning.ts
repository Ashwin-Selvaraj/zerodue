import { z } from 'zod';
import {
  dateOnlySchema,
  paiseSchema,
  positivePaiseSchema,
  syncMetaSchema,
  uuidSchema,
} from './records';

/**
 * Loans, receivables, goals and allocation rules: the records the planner works from.
 * Same conventions as `records.ts`: `xInputSchema` is what a client writes, `xSchema` what the API returns.
 */

const idField = { id: uuidSchema.optional() };
/** The first day of a month, YYYY-MM-01. */
export const monthDateSchema = dateOnlySchema.refine((v) => v.endsWith('-01'), 'Use the 1st');

// ───────────────────────────── loans ─────────────────────────────

export const loanKinds = ['EMI', 'FLEXIBLE'] as const;
export const loanStatuses = ['ACTIVE', 'CLOSED'] as const;
export const interestRoundings = ['ROUND_HALF_UP_RUPEE', 'CARRY_PAISE'] as const;

export const loanInputSchema = z.object({
  ...idField,
  name: z.string().trim().min(1).max(80),
  /** EMI: a fixed instalment. FLEXIBLE: interest accrues monthly and you pay what you can. */
  kind: z.enum(loanKinds),
  status: z.enum(loanStatuses).default('ACTIVE'),
  accountId: uuidSchema.nullish(),
  originalPaise: paiseSchema.nullish(),
  /** Balance at the start of `outstandingAsOf`'s month, before that month's interest. */
  outstandingPaise: paiseSchema.nullish(),
  outstandingAsOf: dateOnlySchema.nullish(),
  /** 8.5% = 850. */
  annualRateBps: z.number().int().min(0).max(10_000).nullish(),
  emiPaise: paiseSchema.nullish(),
  emiDueDay: z.number().int().min(1).max(31).nullish(),
  /** Flexible loans: day of month payments are made; empty means month-end. */
  paymentDay: z.number().int().min(1).max(31).nullish(),
  /** First month that accrues interest. */
  interestStartMonth: monthDateSchema.nullish(),
  roundingOverride: z.enum(interestRoundings).nullish(),
  targetPayoffMonth: monthDateSchema.nullish(),
  closedAt: dateOnlySchema.nullish(),
  notes: z.string().max(1000).nullish(),
});
export const loanSchema = loanInputSchema
  .required({ status: true })
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type LoanInput = z.infer<typeof loanInputSchema>;
export type LoanDto = z.infer<typeof loanSchema>;
export const loanPatchSchema = loanInputSchema.omit({ id: true }).partial();

export const ledgerKinds = ['INTEREST', 'PAYMENT', 'FEE', 'ADJUSTMENT'] as const;

/** Something that really happened on a loan: interest charged, a payment made. Projections are never stored. */
export const loanLedgerInputSchema = z.object({
  ...idField,
  loanId: uuidSchema,
  kind: z.enum(ledgerKinds),
  /** The month the entry belongs to (first of month). */
  month: monthDateSchema,
  effectiveDate: dateOnlySchema,
  /** Always positive: INTEREST and FEE raise the balance, PAYMENT lowers it. */
  amountPaise: positivePaiseSchema,
  balanceAfterPaise: paiseSchema,
  transactionId: uuidSchema.nullish(),
  note: z.string().max(200).nullish(),
});
export const loanLedgerSchema = loanLedgerInputSchema
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type LoanLedgerInput = z.infer<typeof loanLedgerInputSchema>;
export type LoanLedgerDto = z.infer<typeof loanLedgerSchema>;
export const loanLedgerPatchSchema = loanLedgerInputSchema.omit({ id: true }).partial();

/** A manual payment for one future month, replacing the "pay everything available" default. */
export const plannedPaymentInputSchema = z.object({
  ...idField,
  loanId: uuidSchema,
  month: monthDateSchema,
  amountPaise: paiseSchema,
});
export const plannedPaymentSchema = plannedPaymentInputSchema
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type PlannedPaymentInput = z.infer<typeof plannedPaymentInputSchema>;
export type PlannedPaymentDto = z.infer<typeof plannedPaymentSchema>;
export const plannedPaymentPatchSchema = plannedPaymentInputSchema.omit({ id: true }).partial();

/** The inputs of a saved what-if. All optional: an empty scenario is the current plan. */
export const scenarioParamsSchema = z.object({
  extraPayments: z
    .array(z.object({ month: monthDateSchema, amountPaise: positivePaiseSchema }))
    .max(60)
    .default([]),
  monthlyPaymentPaise: paiseSchema.nullish(),
  annualRateBps: z.number().int().min(0).max(10_000).nullish(),
  targetMonth: monthDateSchema.nullish(),
});
export type ScenarioParams = z.infer<typeof scenarioParamsSchema>;

export const scenarioInputSchema = z.object({
  ...idField,
  loanId: uuidSchema.nullish(),
  name: z.string().trim().min(1).max(60),
  params: scenarioParamsSchema,
});
export const scenarioSchema = scenarioInputSchema
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;
export type ScenarioDto = z.infer<typeof scenarioSchema>;
export const scenarioPatchSchema = scenarioInputSchema.omit({ id: true }).partial();

// ───────────────────────────── receivables ─────────────────────────────

export const receivableKinds = ['OWED_TO_ME', 'EXPECTED_INCOME'] as const;
export const receivableStatuses = ['EXPECTED', 'RECEIVED', 'CANCELLED'] as const;

export const receivableInputSchema = z.object({
  ...idField,
  kind: z.enum(receivableKinds),
  counterparty: z.string().trim().min(1).max(80),
  description: z.string().max(200).nullish(),
  amountPaise: positivePaiseSchema,
  expectedDate: dateOnlySchema,
  status: z.enum(receivableStatuses).default('EXPECTED'),
  receivedAt: z.string().datetime({ offset: true }).nullish(),
  categoryId: uuidSchema.nullish(),
});
export const receivableSchema = receivableInputSchema
  .required({ status: true })
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type ReceivableInput = z.infer<typeof receivableInputSchema>;
export type ReceivableDto = z.infer<typeof receivableSchema>;
export const receivablePatchSchema = receivableInputSchema.omit({ id: true }).partial();

// ───────────────────────────── goals ─────────────────────────────

export const goalStatuses = ['ACTIVE', 'ACHIEVED', 'CANCELLED'] as const;
export const contributionStatuses = ['PLEDGED', 'RECEIVED'] as const;

export const goalInputSchema = z.object({
  ...idField,
  name: z.string().trim().min(1).max(80),
  targetAmountPaise: positivePaiseSchema,
  targetDate: dateOnlySchema.nullish(),
  status: z.enum(goalStatuses).default('ACTIVE'),
  /** Free-form details, e.g. what is being bought. */
  metadata: z.record(z.string(), z.unknown()).nullish(),
});
export const goalSchema = goalInputSchema
  .required({ status: true })
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type GoalInput = z.infer<typeof goalInputSchema>;
export type GoalDto = z.infer<typeof goalSchema>;
export const goalPatchSchema = goalInputSchema.omit({ id: true }).partial();

export const goalContributionInputSchema = z.object({
  ...idField,
  goalId: uuidSchema,
  contributor: z.string().trim().min(1).max(60),
  isSelf: z.boolean().default(false),
  amountPaise: positivePaiseSchema,
  status: z.enum(contributionStatuses).default('PLEDGED'),
  receivedOn: dateOnlySchema.nullish(),
});
export const goalContributionSchema = goalContributionInputSchema
  .required({ isSelf: true, status: true })
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type GoalContributionInput = z.infer<typeof goalContributionInputSchema>;
export type GoalContributionDto = z.infer<typeof goalContributionSchema>;
export const goalContributionPatchSchema = goalContributionInputSchema.omit({ id: true }).partial();

// ───────────────────────────── allocation ─────────────────────────────

export const allocationTargets = ['LOAN', 'GOAL', 'RETURN_TO_SOURCE', 'UNALLOCATED'] as const;

/** Where an earmarked income stream (money that isn't yours to spend freely) goes. */
export const allocationRuleInputSchema = z
  .object({
    ...idField,
    recurringItemId: uuidSchema,
    target: z.enum(allocationTargets),
    loanId: uuidSchema.nullish(),
    goalId: uuidSchema.nullish(),
    startMonth: monthDateSchema,
    endMonth: monthDateSchema.nullish(),
    /** A loan rule stops by itself once the loan has no balance. */
    endsWhenLoanCleared: z.boolean().default(true),
    /** Lower is tried first. */
    priority: z.number().int().min(0).max(1000).default(100),
  })
  .superRefine((value, ctx) => {
    if (value.target === 'LOAN' && !value.loanId) {
      ctx.addIssue({ code: 'custom', path: ['loanId'], message: 'Choose a loan' });
    }
    if (value.target === 'GOAL' && !value.goalId) {
      ctx.addIssue({ code: 'custom', path: ['goalId'], message: 'Choose a goal' });
    }
    if (value.endMonth && value.endMonth < value.startMonth) {
      ctx.addIssue({ code: 'custom', path: ['endMonth'], message: 'Ends before it starts' });
    }
  });
const allocationShape = z.object({
  ...idField,
  recurringItemId: uuidSchema,
  target: z.enum(allocationTargets),
  loanId: uuidSchema.nullish(),
  goalId: uuidSchema.nullish(),
  startMonth: monthDateSchema,
  endMonth: monthDateSchema.nullish(),
  endsWhenLoanCleared: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(100),
});
export const allocationRuleSchema = allocationShape
  .required({ endsWhenLoanCleared: true, priority: true })
  .extend({ id: uuidSchema })
  .merge(syncMetaSchema.omit({ id: true }));
export type AllocationRuleInput = z.infer<typeof allocationRuleInputSchema>;
export type AllocationRuleDto = z.infer<typeof allocationRuleSchema>;
export const allocationRulePatchSchema = allocationShape.omit({ id: true }).partial();
