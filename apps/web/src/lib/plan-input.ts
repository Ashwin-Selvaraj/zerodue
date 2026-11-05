import {
  buildPlan,
  cashEventsOf,
  findCashRisks,
  isoDateIST,
  lastDateOfMonth,
  monthKey,
  monthOfDate,
  type AccountDto,
  type AllocationRule,
  type AllocationRuleDto,
  type AmountPeriodDto,
  type CashRisk,
  type GoalContributionDto,
  type GoalDto,
  type LoanDto,
  type LoanLedgerDto,
  type MonthKey,
  type OccurrenceDto,
  type OneOff,
  type Plan,
  type PlanInput,
  type PlannedPaymentDto,
  type Receivable,
  type ReceivableDto,
  type RecurringItemDto,
  type Stream,
  type TransactionDto,
} from '@zerodue/shared';
import { loanState, loanTerms, type LoanState } from './loan-state';

/** Everything the planner needs, as it sits in the local database. */
export interface PlanSnapshot {
  /** Today in IST, YYYY-MM-DD. */
  today: string;
  months: number;
  accounts: AccountDto[];
  transactions: TransactionDto[];
  items: RecurringItemDto[];
  periods: AmountPeriodDto[];
  occurrences: OccurrenceDto[];
  receivables: ReceivableDto[];
  allocations: AllocationRuleDto[];
  loans: LoanDto[];
  ledger: LoanLedgerDto[];
  plannedPayments: PlannedPaymentDto[];
  goals: GoalDto[];
  contributions: GoalContributionDto[];
  /** The loan spare money is swept into; defaults to the active flexible loan with the highest rate. */
  sweepLoanId?: string | null;
  /** Cash that should never be touched when checking for timing problems. */
  bufferPaise?: number;
}

export interface BuiltPlan {
  input: PlanInput;
  plan: Plan;
  startMonth: MonthKey;
  openingBalancePaise: number;
  sweepLoan: LoanDto | null;
  sweepState: LoanState | null;
  risks: CashRisk[];
  bufferPaise: number;
  /** Things the user should fix for the numbers to be trusted. */
  warnings: string[];
}

const SPENDABLE = new Set<AccountDto['type']>(['BANK', 'CASH', 'WALLET']);

/**
 * What is in the accounts you can spend from. The balance you entered is where counting starts:
 * anything recorded on or after that day is added to it.
 */
export function currentBalancePaise(
  accounts: AccountDto[],
  transactions: TransactionDto[],
): number {
  let total = 0;
  for (const account of accounts.filter((a) => SPENDABLE.has(a.type) && !a.archived)) {
    const since = account.balanceAsOf ?? isoDateIST(account.createdAt);
    let balance = account.balancePaise;
    for (const txn of transactions) {
      if (txn.status === 'IGNORED' || isoDateIST(txn.occurredAt) < since) continue;
      if (txn.accountId === account.id) {
        balance += txn.type === 'INCOME' ? txn.amountPaise : -txn.amountPaise;
      } else if (txn.type === 'TRANSFER' && txn.toAccountId === account.id) {
        balance += txn.amountPaise;
      }
    }
    total += balance;
  }
  return total;
}

/** The loan that spare money is swept into: the chosen one, else the active flexible loan costing most. */
export function pickSweepLoan(loans: LoanDto[], chosenId?: string | null): LoanDto | null {
  const active = loans.filter((l) => l.status === 'ACTIVE');
  const chosen = active.find((l) => l.id === chosenId);
  if (chosen) return chosen;
  return (
    active
      .filter((l) => l.kind === 'FLEXIBLE' && (l.outstandingPaise ?? 0) > 0)
      .sort((a, b) => (b.annualRateBps ?? 0) - (a.annualRateBps ?? 0))[0] ?? null
  );
}

function toStreams(items: RecurringItemDto[], periods: AmountPeriodDto[]): Stream[] {
  return items
    .filter((item) => item.active)
    .map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      frequency: item.frequency,
      dueDay: item.dueDay ?? undefined,
      anchorMonth: item.anchorMonth ?? undefined,
      startDate: item.startDate,
      endDate: item.endDate ?? undefined,
      earmarked: item.kind === 'INCOME' && !item.fixedOutgoing,
      periods: periods
        .filter((p) => p.recurringItemId === item.id)
        .map((p) => ({ effectiveFrom: p.effectiveFrom, amountPaise: p.amountPaise })),
    }));
}

/** Money still to come. One that is overdue is counted in the first month rather than lost. */
function toReceivables(rows: ReceivableDto[], startMonth: MonthKey): Receivable[] {
  return rows
    .filter((r) => r.status === 'EXPECTED')
    .map((r) => ({
      id: r.id,
      label: r.counterparty,
      kind: r.kind,
      expectedDate: monthOfDate(r.expectedDate) < startMonth ? startMonth : r.expectedDate,
      amountPaise: r.amountPaise,
    }));
}

/** Your own share of a purchase you have promised to fund is money going out in the goal's month. */
function toOneOffs(
  goals: GoalDto[],
  contributions: GoalContributionDto[],
  startMonth: MonthKey,
): OneOff[] {
  return contributions
    .filter((c) => c.isSelf && c.status === 'PLEDGED')
    .flatMap((c) => {
      const goal = goals.find((g) => g.id === c.goalId && g.status === 'ACTIVE');
      if (!goal) return [];
      const planned = goal.targetDate ? monthOfDate(goal.targetDate) : startMonth;
      const month = planned < startMonth ? startMonth : planned;
      return [
        {
          id: c.id,
          label: `${goal.name} (my share)`,
          month,
          amountPaise: c.amountPaise,
          date: lastDateOfMonth(month),
        },
      ];
    });
}

function toAllocations(rows: AllocationRuleDto[]): AllocationRule[] {
  return rows.map((r) => ({
    streamId: r.recurringItemId,
    target: r.target,
    loanId: r.loanId ?? undefined,
    goalId: r.goalId ?? undefined,
    startMonth: r.startMonth,
    endMonth: r.endMonth ?? undefined,
    priority: r.priority,
  }));
}

export function buildPlanFromSnapshot(snap: PlanSnapshot): BuiltPlan {
  const startMonth = monthKey(`${snap.today}T12:00:00+05:30`);
  const warnings: string[] = [];
  const openingBalancePaise = Math.max(0, currentBalancePaise(snap.accounts, snap.transactions));

  const sweepLoan = pickSweepLoan(snap.loans, snap.sweepLoanId);
  const sweepState = sweepLoan ? loanState(sweepLoan, snap.ledger, startMonth) : null;
  if (sweepLoan && sweepState) {
    if (sweepState.needsBalance) warnings.push(`${sweepLoan.name} has no balance entered yet.`);
    else if (sweepState.nextMonth < startMonth) {
      warnings.push(
        `${sweepLoan.name}: record the payments made since ${sweepState.nextMonth.slice(0, 7)} so the balance is right.`,
      );
    }
  }

  const manualPayments = Object.fromEntries(
    snap.plannedPayments
      .filter((p) => sweepLoan && p.loanId === sweepLoan.id)
      .map((p) => [p.month, p.amountPaise]),
  );

  const input: PlanInput = {
    startMonth,
    months: snap.months,
    openingBalancePaise,
    streams: toStreams(snap.items, snap.periods),
    settledOccurrences: snap.occurrences
      .filter((o) => o.status !== 'UPCOMING')
      .map((o) => `${o.recurringItemId}:${o.dueDate}`),
    oneOffs: toOneOffs(snap.goals, snap.contributions, startMonth),
    receivables: toReceivables(snap.receivables, startMonth),
    allocations: toAllocations(snap.allocations),
    loan:
      sweepLoan && sweepState
        ? {
            id: sweepLoan.id,
            name: sweepLoan.name,
            ...loanTerms(sweepLoan),
            openingBalancePaise: sweepState.openingPaise,
            firstMonth: sweepState.nextMonth,
            manualPayments,
          }
        : undefined,
  };

  const plan = buildPlan(input);
  const risks = findCashRisks(
    openingBalancePaise,
    cashEventsOf(plan.months),
    snap.bufferPaise ?? 0,
  );
  return {
    input,
    plan,
    startMonth,
    openingBalancePaise,
    sweepLoan,
    sweepState,
    risks,
    bufferPaise: snap.bufferPaise ?? 0,
    warnings,
  };
}
