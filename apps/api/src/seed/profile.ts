import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * A starting set of accounts, bills, loans and goals, described in rupees so it is easy to write by hand.
 * `buildOps` turns it into sync operations, so the seed goes through the same validation as the app.
 */

const rupees = z.number().min(0).max(21_000_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}-01$/);
const key = z.string().min(1).max(40);

export const seedProfileSchema = z.object({
  accounts: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.enum(['BANK', 'CREDIT_CARD', 'CASH', 'WALLET']),
        balance: rupees.default(0),
        balanceAsOf: date.optional(),
      }),
    )
    .default([]),
  recurring: z
    .array(
      z.object({
        key,
        kind: z.enum(['INCOME', 'EXPENSE']),
        name: z.string().min(1),
        frequency: z.enum(['MONTHLY', 'QUARTERLY', 'ONE_TIME']),
        dueDay: z.number().int().min(1).max(31).optional(),
        anchorMonth: month.optional(),
        startDate: date,
        endDate: date.optional(),
        /** Income that is not yours to spend freely; routed by an allocation rule. */
        earmarked: z.boolean().default(false),
        category: z.string().optional(),
        account: z.string().optional(),
        reminderLeadDays: z.array(z.number().int().min(0).max(30)).default([]),
        /** The amount from a date onward; later entries replace earlier ones. */
        amounts: z.array(z.object({ from: date, rupees })).min(1),
      }),
    )
    .default([]),
  loans: z
    .array(
      z.object({
        key,
        name: z.string().min(1),
        kind: z.enum(['EMI', 'FLEXIBLE']),
        outstanding: rupees,
        asOf: date,
        annualRatePercent: z.number().min(0).max(100).default(0),
        interestStartMonth: month.optional(),
        emi: rupees.optional(),
        emiDueDay: z.number().int().min(1).max(31).optional(),
        paymentDay: z.number().int().min(1).max(31).optional(),
      }),
    )
    .default([]),
  receivables: z
    .array(
      z.object({
        kind: z.enum(['OWED_TO_ME', 'EXPECTED_INCOME']),
        counterparty: z.string().min(1),
        amount: rupees,
        expectedDate: date,
      }),
    )
    .default([]),
  goals: z
    .array(
      z.object({
        key,
        name: z.string().min(1),
        target: rupees,
        targetDate: date.optional(),
        contributions: z
          .array(
            z.object({
              contributor: z.string().min(1),
              isSelf: z.boolean().default(false),
              amount: rupees,
              status: z.enum(['PLEDGED', 'RECEIVED']).default('PLEDGED'),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  allocations: z
    .array(
      z.object({
        /** The `key` of an earmarked recurring item. */
        stream: key,
        target: z.enum(['LOAN', 'GOAL', 'RETURN_TO_SOURCE', 'UNALLOCATED']),
        loan: key.optional(),
        goal: key.optional(),
        startMonth: month,
        endMonth: month.optional(),
      }),
    )
    .default([]),
  /** Bills already paid before the seed: marked paid after the server has generated their due dates. */
  settled: z.array(z.object({ stream: key, dueDate: date })).default([]),
});

export type SeedProfile = z.infer<typeof seedProfileSchema>;

export function parseProfile(json: unknown): SeedProfile {
  const profile = seedProfileSchema.parse(json);
  const streams = new Set(profile.recurring.map((r) => r.key));
  const loans = new Set(profile.loans.map((l) => l.key));
  const goals = new Set(profile.goals.map((g) => g.key));
  for (const rule of profile.allocations) {
    if (!streams.has(rule.stream))
      throw new Error(`Allocation refers to unknown bill "${rule.stream}"`);
    if (rule.target === 'LOAN' && !(rule.loan && loans.has(rule.loan))) {
      throw new Error(`Allocation for "${rule.stream}" needs a known loan`);
    }
    if (rule.target === 'GOAL' && !(rule.goal && goals.has(rule.goal))) {
      throw new Error(`Allocation for "${rule.stream}" needs a known goal`);
    }
  }
  for (const entry of profile.settled) {
    if (!streams.has(entry.stream))
      throw new Error(`Settled entry refers to unknown bill "${entry.stream}"`);
  }
  return profile;
}

/** The same id for the same key every time, so running the seed twice doesn't duplicate anything. */
export function stableId(kind: string, name: string): string {
  const hex = createHash('sha1').update(`zerodue-seed:${kind}:${name}`).digest('hex');
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

const paise = (value: number): number => Math.round(value * 100);

export interface SeedOp {
  entity: string;
  op: 'upsert';
  id: string;
  data: Record<string, unknown>;
  editedAt: string;
  baseVersion: 0;
}

export interface Lookup {
  /** Id of an existing account by name (e.g. the default Cash account), if there is one. */
  accountId(name: string): string | undefined;
  categoryId(name: string): string | undefined;
}

/** Everything in the profile as sync operations, ordered so each record's references exist first. */
export function buildOps(profile: SeedProfile, lookup: Lookup, editedAt: string): SeedOp[] {
  const ops: SeedOp[] = [];
  const add = (entity: string, id: string, data: Record<string, unknown>): void => {
    ops.push({ entity, op: 'upsert', id, data, editedAt, baseVersion: 0 });
  };
  const accountId = (name: string): string => {
    const id = lookup.accountId(name) ?? stableId('account', name);
    return id;
  };
  const categoryId = (name: string): string => {
    const id = lookup.categoryId(name);
    if (!id) throw new Error(`No category called "${name}"`);
    return id;
  };

  for (const account of profile.accounts) {
    if (lookup.accountId(account.name)) continue;
    add('account', stableId('account', account.name), {
      name: account.name,
      type: account.type,
      balancePaise: paise(account.balance),
      balanceAsOf: account.balanceAsOf ?? null,
      archived: false,
    });
  }
  for (const loan of profile.loans) {
    add('loan', stableId('loan', loan.key), {
      name: loan.name,
      kind: loan.kind,
      status: 'ACTIVE',
      originalPaise: paise(loan.outstanding),
      outstandingPaise: paise(loan.outstanding),
      outstandingAsOf: loan.asOf,
      annualRateBps: Math.round(loan.annualRatePercent * 100),
      interestStartMonth: loan.interestStartMonth ?? null,
      emiPaise: loan.emi === undefined ? null : paise(loan.emi),
      emiDueDay: loan.emiDueDay ?? null,
      paymentDay: loan.paymentDay ?? null,
    });
  }
  for (const item of profile.recurring) {
    const id = stableId('recurring', item.key);
    add('recurringItem', id, {
      kind: item.kind,
      name: item.name,
      frequency: item.frequency,
      dueDay: item.dueDay ?? null,
      anchorMonth: item.anchorMonth ?? null,
      startDate: item.startDate,
      endDate: item.endDate ?? null,
      categoryId: item.category ? categoryId(item.category) : null,
      accountId: item.account ? accountId(item.account) : null,
      reminderLeadDays: item.reminderLeadDays,
      fixedOutgoing: !item.earmarked,
      active: true,
    });
    for (const amount of item.amounts) {
      add('recurringAmountPeriod', stableId('period', `${item.key}:${amount.from}`), {
        recurringItemId: id,
        effectiveFrom: amount.from,
        amountPaise: paise(amount.rupees),
      });
    }
  }
  for (const r of profile.receivables) {
    add('receivable', stableId('receivable', `${r.counterparty}:${r.expectedDate}`), {
      kind: r.kind,
      counterparty: r.counterparty,
      amountPaise: paise(r.amount),
      expectedDate: r.expectedDate,
      status: 'EXPECTED',
    });
  }
  for (const goal of profile.goals) {
    const id = stableId('goal', goal.key);
    add('goal', id, {
      name: goal.name,
      targetAmountPaise: paise(goal.target),
      targetDate: goal.targetDate ?? null,
      status: 'ACTIVE',
    });
    for (const c of goal.contributions) {
      add('goalContribution', stableId('contribution', `${goal.key}:${c.contributor}`), {
        goalId: id,
        contributor: c.contributor,
        isSelf: c.isSelf,
        amountPaise: paise(c.amount),
        status: c.status,
      });
    }
  }
  for (const rule of profile.allocations) {
    add('allocationRule', stableId('allocation', `${rule.stream}:${rule.startMonth}`), {
      recurringItemId: stableId('recurring', rule.stream),
      target: rule.target,
      loanId: rule.loan ? stableId('loan', rule.loan) : null,
      goalId: rule.goal ? stableId('goal', rule.goal) : null,
      startMonth: rule.startMonth,
      endMonth: rule.endMonth ?? null,
      endsWhenLoanCleared: true,
      priority: 100,
    });
  }
  return ops;
}
