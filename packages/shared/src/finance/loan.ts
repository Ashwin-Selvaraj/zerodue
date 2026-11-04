import { assertBps, assertPaise } from './guards';
import { monthlyInterest, type InterestRounding } from './interest';
import { addMonths, monthsBetween, type MonthKey } from './months';

/** Longest projection we will run (50 years) so a payment below the interest can't loop forever. */
export const MAX_PROJECTION_MONTHS = 600;

export interface LoanTerms {
  annualRateBps: number;
  /** First month that accrues interest; null/undefined means interest accrues from the first month. */
  interestStartMonth?: MonthKey | null;
  rounding: InterestRounding;
}

export interface PaymentPlan {
  /** Explicit payment for a month; overrides `defaultPaymentPaise` for that month. */
  byMonth?: Record<MonthKey, number>;
  /** Payment for any month without an explicit one (e.g. a fixed EMI). */
  defaultPaymentPaise?: number;
  /** Added on top of the payment for a month (lump sums, extra part-payments). */
  extraByMonth?: Record<MonthKey, number>;
}

export interface ScheduleRow {
  month: MonthKey;
  openingPaise: number;
  interestPaise: number;
  /** Opening balance plus interest: the most that can be paid this month. */
  duePaise: number;
  /** What was actually applied: the planned payment capped at `duePaise`. */
  paymentPaise: number;
  closingPaise: number;
  /** Planned money that exceeded what was due (the loan cleared). */
  unusedPaise: number;
}

/** Looks up what the plan says to pay in a month (before capping at what is due). */
export function plannedPayment(plan: PaymentPlan, month: MonthKey): number {
  const base = plan.byMonth?.[month] ?? plan.defaultPaymentPaise ?? 0;
  const extra = plan.extraByMonth?.[month] ?? 0;
  assertPaise(base, `payment for ${month}`);
  assertPaise(extra, `extra payment for ${month}`);
  return base + extra;
}

/** One month: interest posts on the opening balance, then the payment is made at month-end. */
export function stepLoanMonth(
  terms: LoanTerms,
  month: MonthKey,
  openingPaise: number,
  plannedPaise: number,
): ScheduleRow {
  assertBps(terms.annualRateBps, 'annualRateBps');
  assertPaise(openingPaise, 'openingPaise');
  assertPaise(plannedPaise, 'plannedPaise');
  const accrues = terms.interestStartMonth == null || month >= terms.interestStartMonth;
  const interestPaise = accrues
    ? monthlyInterest(openingPaise, terms.annualRateBps, terms.rounding)
    : 0;
  const duePaise = openingPaise + interestPaise;
  const paymentPaise = Math.min(plannedPaise, duePaise);
  return {
    month,
    openingPaise,
    interestPaise,
    duePaise,
    paymentPaise,
    closingPaise: duePaise - paymentPaise,
    unusedPaise: plannedPaise - paymentPaise,
  };
}

export interface ProjectionInput extends LoanTerms {
  /** Balance at the start of `firstMonth`. */
  openingBalancePaise: number;
  firstMonth: MonthKey;
  payments: PaymentPlan;
  /** Stop after this many months even if not cleared. Defaults to {@link MAX_PROJECTION_MONTHS}. */
  maxMonths?: number;
}

export interface Projection {
  rows: ScheduleRow[];
  /** Month in which the balance reaches zero; null if it does not within the horizon. */
  payoffMonth: MonthKey | null;
  totalInterestPaise: number;
  totalPaidPaise: number;
  endingBalancePaise: number;
}

/**
 * Month-by-month schedule until the loan clears or the horizon ends.
 * An already-cleared loan (opening balance 0) returns no rows and `payoffMonth = firstMonth`.
 */
export function projectLoan(input: ProjectionInput): Projection {
  assertPaise(input.openingBalancePaise, 'openingBalancePaise');
  const maxMonths = input.maxMonths ?? MAX_PROJECTION_MONTHS;
  const rows: ScheduleRow[] = [];
  let balance = input.openingBalancePaise;
  let totalInterestPaise = 0;
  let totalPaidPaise = 0;

  for (let i = 0; i < maxMonths && balance > 0; i++) {
    const month = addMonths(input.firstMonth, i);
    const row = stepLoanMonth(input, month, balance, plannedPayment(input.payments, month));
    rows.push(row);
    totalInterestPaise += row.interestPaise;
    totalPaidPaise += row.paymentPaise;
    balance = row.closingPaise;
  }

  const payoffMonth =
    balance > 0 ? null : rows.length > 0 ? rows[rows.length - 1]!.month : input.firstMonth;
  return { rows, payoffMonth, totalInterestPaise, totalPaidPaise, endingBalancePaise: balance };
}

export interface SolveInput extends LoanTerms {
  openingBalancePaise: number;
  firstMonth: MonthKey;
  /** Month by which the loan must be cleared (inclusive). */
  targetMonth: MonthKey;
  /** Payments already committed on top of the level payment (e.g. a planned lump sum). */
  extraByMonth?: Record<MonthKey, number>;
  /** Round the answer up to a whole rupee, as banks do for EMIs. */
  roundUpToRupee?: boolean;
}

/**
 * The smallest level monthly payment that clears the loan by `targetMonth`, found by simulating
 * the real schedule (so rounding rules are honoured). The last payment may be smaller.
 */
export function solveLevelPayment(input: SolveInput): number {
  assertPaise(input.openingBalancePaise, 'openingBalancePaise');
  const months = monthsBetween(input.firstMonth, input.targetMonth) + 1;
  if (months < 1) throw new RangeError('targetMonth must not be before firstMonth');
  if (input.openingBalancePaise === 0) return 0;

  const clears = (payment: number): boolean =>
    projectLoan({
      ...input,
      payments: { defaultPaymentPaise: payment, extraByMonth: input.extraByMonth },
      maxMonths: months,
    }).endingBalancePaise === 0;

  // Paying nothing until the last month and then the whole compounded balance always clears.
  let low = 0;
  let high = projectLoan({ ...input, payments: {}, maxMonths: months }).endingBalancePaise;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (clears(mid)) high = mid;
    else low = mid + 1;
  }
  return input.roundUpToRupee ? Math.ceil(low / 100) * 100 : low;
}
