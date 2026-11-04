import { assertPaise } from './guards';
import { stepLoanMonth, type LoanTerms, type ScheduleRow } from './loan';
import {
  dateInMonth,
  lastDateOfMonth,
  monthOfDate,
  monthRange,
  monthsBetween,
  type DateString,
  type MonthKey,
} from './months';

// ───────────────────────────── Inputs ─────────────────────────────

export interface AmountPeriod {
  /** First due date this amount applies to. Later periods replace earlier ones. */
  effectiveFrom: DateString;
  amountPaise: number;
}

/** A recurring income or expense (salary, bonus, EMI, card bill, food...). */
export interface Stream {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  frequency: 'MONTHLY' | 'QUARTERLY' | 'ONE_TIME';
  /** Day of month it falls due; clamped to the month length. Defaults to the 1st. */
  dueDay?: number;
  /** QUARTERLY cycles every 3 months starting here. Defaults to the start date's month. */
  anchorMonth?: MonthKey;
  startDate: DateString;
  endDate?: DateString;
  periods: AmountPeriod[];
  /** Income that is not "my money": it is routed by allocation rules instead of counted in leftover. */
  earmarked?: boolean;
}

/** A single planned expense in a month (gold purchase share, closing another loan...). */
export interface OneOff {
  id: string;
  label: string;
  month: MonthKey;
  amountPaise: number;
  /** Exact date if known; otherwise the last day of the month is used for cash-risk checks. */
  date?: DateString;
}

/** Money expected to arrive that is not a recurring stream. Only unreceived items belong here. */
export interface Receivable {
  id: string;
  label: string;
  /** EXPECTED_INCOME counts as income (e.g. a freelance payment); OWED_TO_ME is money coming back. */
  kind: 'EXPECTED_INCOME' | 'OWED_TO_ME';
  expectedDate: DateString;
  amountPaise: number;
}

/**
 * Where an earmarked income stream goes. Rules for a stream are tried in `priority` order (lower
 * first); the first active rule takes the whole amount. A LOAN rule is only active while that loan
 * still has a balance, so it ends by itself when the loan clears.
 */
export interface AllocationRule {
  streamId: string;
  target: 'LOAN' | 'GOAL' | 'RETURN_TO_SOURCE' | 'UNALLOCATED';
  loanId?: string;
  goalId?: string;
  startMonth: MonthKey;
  endMonth?: MonthKey;
  priority?: number;
}

/** The loan whose balance the plan sweeps spare money into. */
export interface PlanLoan extends LoanTerms {
  id: string;
  name: string;
  /** Balance at the start of `firstMonth`. */
  openingBalancePaise: number;
  firstMonth: MonthKey;
  /** Manual payment for a month; replaces the default "pay everything available". */
  manualPayments?: Record<MonthKey, number>;
}

export interface PlanInput {
  startMonth: MonthKey;
  months: number;
  /** Money already in the account at the start of `startMonth`; counted once, in the first month. */
  openingBalancePaise: number;
  streams: Stream[];
  /** Occurrences already paid/received, as `${streamId}:${YYYY-MM-DD}`; excluded from forward totals. */
  settledOccurrences?: string[];
  oneOffs?: OneOff[];
  receivables?: Receivable[];
  allocations?: AllocationRule[];
  loan?: PlanLoan;
}

// ───────────────────────────── Outputs ─────────────────────────────

export interface PlanLine {
  id: string;
  label: string;
  amountPaise: number;
  date: DateString;
}

export type StepKind = 'INCOME' | 'FIXED' | 'ONE_OFF' | 'RECEIVABLE' | 'OPENING_BALANCE';

/** One row of the waterfall table, with the running total after it. */
export interface WaterfallStep {
  kind: StepKind;
  label: string;
  deltaPaise: number;
  runningPaise: number;
}

export type PlanFlag = 'SHORTFALL' | 'PENDING_DECISION' | 'OVERCOMMITTED';

export interface Allocations {
  toLoanPaise: number;
  toGoalPaise: number;
  returnedPaise: number;
  /** Deliberately parked by an UNALLOCATED rule. */
  heldPaise: number;
  /** Earmarked money with no rule: you need to decide where it goes. */
  undecidedPaise: number;
}

export interface PlanMonth {
  month: MonthKey;
  income: PlanLine[];
  incomePaise: number;
  fixed: PlanLine[];
  fixedOutgoingsPaise: number;
  oneOffs: PlanLine[];
  oneOffsPaise: number;
  receivables: PlanLine[];
  receivablesPaise: number;
  openingBalancePaise: number;
  /** Income − fixed − one-offs + money owed back + opening balance. "My money" only. */
  leftoverPaise: number;
  earmarked: PlanLine[];
  earmarkedPaise: number;
  allocations: Allocations;
  /** Leftover plus earmarked money routed to the loan. */
  availablePaise: number;
  loan: ScheduleRow | null;
  loanPaymentPaise: number;
  /** Available minus the loan payment; negative when a manual payment exceeds what is available. */
  sparePaise: number;
  steps: WaterfallStep[];
  flags: PlanFlag[];
}

export interface PendingDecision {
  month: MonthKey;
  streamId: string;
  label: string;
  amountPaise: number;
}

export interface Plan {
  months: PlanMonth[];
  /** Loan payoff summary for the swept loan; null when the plan has no loan. */
  loan: {
    payoffMonth: MonthKey | null;
    totalInterestPaise: number;
    totalPaidPaise: number;
    endingBalancePaise: number;
  } | null;
  pendingDecisions: PendingDecision[];
}

// ───────────────────────────── Occurrences ─────────────────────────────

export interface Occurrence {
  streamId: string;
  name: string;
  kind: Stream['kind'];
  earmarked: boolean;
  dueDate: DateString;
  amountPaise: number;
}

function amountOn(periods: AmountPeriod[], date: DateString): number | null {
  let chosen: AmountPeriod | null = null;
  for (const period of periods) {
    assertPaise(period.amountPaise, 'period amount');
    if (
      period.effectiveFrom <= date &&
      (chosen === null || period.effectiveFrom >= chosen.effectiveFrom)
    ) {
      chosen = period;
    }
  }
  return chosen ? chosen.amountPaise : null;
}

/** The stream's occurrence in a month, or null if none falls due (or no amount applies yet). */
export function occurrenceInMonth(stream: Stream, month: MonthKey): Occurrence | null {
  const startMonth = monthOfDate(stream.startDate);
  let dueDate: DateString;

  if (stream.frequency === 'ONE_TIME') {
    if (startMonth !== month) return null;
    dueDate = stream.startDate;
  } else {
    if (stream.frequency === 'QUARTERLY') {
      const distance = monthsBetween(stream.anchorMonth ?? startMonth, month);
      if (distance < 0 || distance % 3 !== 0) return null;
    }
    dueDate = dateInMonth(month, stream.dueDay ?? 1);
  }

  if (dueDate < stream.startDate) return null;
  if (stream.endDate !== undefined && dueDate > stream.endDate) return null;

  const amountPaise = amountOn(stream.periods, dueDate);
  if (amountPaise === null) return null;
  return {
    streamId: stream.id,
    name: stream.name,
    kind: stream.kind,
    earmarked: stream.earmarked ?? false,
    dueDate,
    amountPaise,
  };
}

// ───────────────────────────── The plan ─────────────────────────────

const sum = (lines: PlanLine[]): number =>
  lines.reduce((total, line) => total + line.amountPaise, 0);

/** `activeLoanId` is the swept loan's id while it still has a balance, otherwise undefined. */
function activeRule(
  rules: AllocationRule[],
  month: MonthKey,
  activeLoanId: string | undefined,
): AllocationRule | undefined {
  return rules.find((rule) => {
    if (month < rule.startMonth) return false;
    if (rule.endMonth !== undefined && month > rule.endMonth) return false;
    if (rule.target === 'LOAN') return activeLoanId !== undefined && rule.loanId === activeLoanId;
    return true;
  });
}

/**
 * Builds the month-by-month cash plan: income → fixed outgoings → one-offs → money owed back →
 * opening balance = leftover; then routes earmarked money, sweeps what is available into the loan,
 * and reports what is spare. Everything is derived from the inputs, so changing any of them and
 * calling this again gives a fully recalculated plan.
 */
export function buildPlan(input: PlanInput): Plan {
  assertPaise(input.openingBalancePaise, 'openingBalancePaise');
  const settled = new Set(input.settledOccurrences ?? []);
  const loan = input.loan;
  if (loan) assertPaise(loan.openingBalancePaise, 'loan openingBalancePaise');

  const rulesByStream = new Map<string, (AllocationRule & { priority: number })[]>();
  for (const rule of input.allocations ?? []) {
    const ranked = { ...rule, priority: rule.priority ?? 100 };
    rulesByStream.set(rule.streamId, [...(rulesByStream.get(rule.streamId) ?? []), ranked]);
  }
  for (const rules of rulesByStream.values()) {
    rules.sort((a, b) => a.priority - b.priority);
  }

  let balance = loan?.openingBalancePaise ?? 0;
  let totalInterestPaise = 0;
  let totalPaidPaise = 0;
  let payoffMonth: MonthKey | null = loan && balance === 0 ? loan.firstMonth : null;
  const pendingDecisions: PendingDecision[] = [];
  const months: PlanMonth[] = [];

  for (const [index, month] of monthRange(input.startMonth, input.months).entries()) {
    const income: PlanLine[] = [];
    const fixed: PlanLine[] = [];
    const earmarked: PlanLine[] = [];
    const earmarkedOccurrences: Occurrence[] = [];

    for (const stream of input.streams) {
      const occurrence = occurrenceInMonth(stream, month);
      if (!occurrence || settled.has(`${stream.id}:${occurrence.dueDate}`)) continue;
      const line: PlanLine = {
        id: stream.id,
        label: stream.name,
        amountPaise: occurrence.amountPaise,
        date: occurrence.dueDate,
      };
      if (occurrence.kind === 'EXPENSE') fixed.push(line);
      else if (occurrence.earmarked) {
        earmarked.push(line);
        earmarkedOccurrences.push(occurrence);
      } else income.push(line);
    }

    const receivables: PlanLine[] = [];
    for (const item of input.receivables ?? []) {
      assertPaise(item.amountPaise, 'receivable amount');
      if (monthOfDate(item.expectedDate) !== month) continue;
      const line: PlanLine = {
        id: item.id,
        label: item.label,
        amountPaise: item.amountPaise,
        date: item.expectedDate,
      };
      if (item.kind === 'EXPECTED_INCOME') income.push(line);
      else receivables.push(line);
    }

    const oneOffs: PlanLine[] = (input.oneOffs ?? [])
      .filter((item) => item.month === month)
      .map((item) => {
        assertPaise(item.amountPaise, 'one-off amount');
        return {
          id: item.id,
          label: item.label,
          amountPaise: item.amountPaise,
          date: item.date ?? lastDateOfMonth(month),
        };
      });

    const incomePaise = sum(income);
    const fixedOutgoingsPaise = sum(fixed);
    const oneOffsPaise = sum(oneOffs);
    const receivablesPaise = sum(receivables);
    const openingBalancePaise = index === 0 ? input.openingBalancePaise : 0;
    const leftoverPaise =
      incomePaise - fixedOutgoingsPaise - oneOffsPaise + receivablesPaise + openingBalancePaise;

    // Waterfall table: the order matches how the plan is read, with a running total after each row.
    const steps: WaterfallStep[] = [];
    let running = 0;
    const push = (kind: StepKind, label: string, deltaPaise: number): void => {
      running += deltaPaise;
      steps.push({ kind, label, deltaPaise, runningPaise: running });
    };
    for (const line of income) push('INCOME', line.label, line.amountPaise);
    for (const line of fixed) push('FIXED', line.label, -line.amountPaise);
    for (const line of oneOffs) push('ONE_OFF', line.label, -line.amountPaise);
    for (const line of receivables) push('RECEIVABLE', line.label, line.amountPaise);
    if (openingBalancePaise > 0) push('OPENING_BALANCE', 'Current balance', openingBalancePaise);

    // Route earmarked money. A loan rule only counts while the loan still has a balance.
    const activeLoan = loan && month >= loan.firstMonth && balance > 0 ? loan : undefined;
    const allocations: Allocations = {
      toLoanPaise: 0,
      toGoalPaise: 0,
      returnedPaise: 0,
      heldPaise: 0,
      undecidedPaise: 0,
    };
    for (const occurrence of earmarkedOccurrences) {
      const rule = activeRule(rulesByStream.get(occurrence.streamId) ?? [], month, activeLoan?.id);
      if (!rule) {
        allocations.undecidedPaise += occurrence.amountPaise;
        pendingDecisions.push({
          month,
          streamId: occurrence.streamId,
          label: occurrence.name,
          amountPaise: occurrence.amountPaise,
        });
      } else if (rule.target === 'LOAN') allocations.toLoanPaise += occurrence.amountPaise;
      else if (rule.target === 'GOAL') allocations.toGoalPaise += occurrence.amountPaise;
      else if (rule.target === 'RETURN_TO_SOURCE')
        allocations.returnedPaise += occurrence.amountPaise;
      else allocations.heldPaise += occurrence.amountPaise;
    }

    const availablePaise = leftoverPaise + allocations.toLoanPaise;
    let loanRow: ScheduleRow | null = null;
    if (activeLoan) {
      const planned = activeLoan.manualPayments?.[month] ?? Math.max(0, availablePaise);
      loanRow = stepLoanMonth(activeLoan, month, balance, planned);
      balance = loanRow.closingPaise;
      totalInterestPaise += loanRow.interestPaise;
      totalPaidPaise += loanRow.paymentPaise;
      if (balance === 0) payoffMonth = month;
    }
    const loanPaymentPaise = loanRow?.paymentPaise ?? 0;
    const sparePaise = availablePaise - loanPaymentPaise;

    const flags: PlanFlag[] = [];
    if (leftoverPaise < 0) flags.push('SHORTFALL');
    if (allocations.undecidedPaise > 0) flags.push('PENDING_DECISION');
    if (sparePaise < 0) flags.push('OVERCOMMITTED');

    months.push({
      month,
      income,
      incomePaise,
      fixed,
      fixedOutgoingsPaise,
      oneOffs,
      oneOffsPaise,
      receivables,
      receivablesPaise,
      openingBalancePaise,
      leftoverPaise,
      earmarked,
      earmarkedPaise: sum(earmarked),
      allocations,
      availablePaise,
      loan: loanRow,
      loanPaymentPaise,
      sparePaise,
      steps,
      flags,
    });
  }

  return {
    months,
    loan: loan
      ? { payoffMonth, totalInterestPaise, totalPaidPaise, endingBalancePaise: balance }
      : null,
    pendingDecisions,
  };
}

/** Money available for the loan in each month, keyed for {@link analyseGap}. */
export function availabilityByMonth(plan: Plan): Record<MonthKey, number> {
  return Object.fromEntries(plan.months.map((m) => [m.month, m.availablePaise]));
}
