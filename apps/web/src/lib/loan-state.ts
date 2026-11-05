import {
  addMonths,
  monthOfDate,
  stepLoanMonth,
  type InterestRounding,
  type LoanDto,
  type LoanLedgerDto,
  type LoanLedgerInput,
  type LoanTerms,
  type MonthKey,
} from '@zerodue/shared';

/** Used when neither the loan nor the user's settings say how interest is rounded. */
export const DEFAULT_ROUNDING: InterestRounding = 'ROUND_HALF_UP_RUPEE';

export function loanTerms(loan: LoanDto): LoanTerms {
  return {
    annualRateBps: loan.annualRateBps ?? 0,
    interestStartMonth: loan.interestStartMonth ?? null,
    rounding: loan.roundingOverride ?? DEFAULT_ROUNDING,
  };
}

/** One month of what really happened on a loan. */
export interface ActualMonth {
  month: MonthKey;
  openingPaise: number;
  interestPaise: number;
  paymentPaise: number;
  closingPaise: number;
}

export interface LoanState {
  /** Balance at the start of `nextMonth`, before that month's interest. */
  openingPaise: number;
  /** The first month with nothing recorded yet. */
  nextMonth: MonthKey;
  actual: ActualMonth[];
  paidToDatePaise: number;
  interestToDatePaise: number;
  /** The loan has no starting balance yet. */
  needsBalance: boolean;
  cleared: boolean;
}

const KIND_ORDER: Record<LoanLedgerDto['kind'], number> = {
  INTEREST: 0,
  FEE: 0,
  ADJUSTMENT: 1,
  PAYMENT: 2,
};

/** Oldest first; within a day, interest is charged before the payment is made. */
function inOrder(entries: LoanLedgerDto[]): LoanLedgerDto[] {
  return [...entries].sort(
    (a, b) =>
      a.month.localeCompare(b.month) ||
      a.effectiveDate.localeCompare(b.effectiveDate) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * Where a loan stands: its starting balance plus every ledger entry, grouped by month.
 * `fallbackMonth` is where an untouched loan with no "as of" date begins (normally this month).
 */
export function loanState(
  loan: LoanDto,
  ledger: LoanLedgerDto[],
  fallbackMonth: MonthKey,
): LoanState {
  const start = loan.outstandingPaise ?? 0;
  const startMonth = loan.outstandingAsOf ? monthOfDate(loan.outstandingAsOf) : fallbackMonth;
  const byMonth = new Map<MonthKey, LoanLedgerDto[]>();
  for (const entry of inOrder(ledger.filter((e) => e.loanId === loan.id))) {
    byMonth.set(entry.month, [...(byMonth.get(entry.month) ?? []), entry]);
  }

  const actual: ActualMonth[] = [];
  let balance = start;
  for (const [month, entries] of byMonth) {
    const openingPaise = balance;
    let interestPaise = 0;
    let paymentPaise = 0;
    for (const entry of entries) {
      if (entry.kind === 'PAYMENT') paymentPaise += entry.amountPaise;
      else interestPaise += entry.amountPaise;
    }
    balance = entries[entries.length - 1]!.balanceAfterPaise;
    actual.push({ month, openingPaise, interestPaise, paymentPaise, closingPaise: balance });
  }

  const last = actual[actual.length - 1];
  return {
    openingPaise: balance,
    nextMonth: last ? addMonths(last.month, 1) : startMonth,
    actual,
    paidToDatePaise: actual.reduce((sum, m) => sum + m.paymentPaise, 0),
    interestToDatePaise: actual.reduce((sum, m) => sum + m.interestPaise, 0),
    needsBalance: loan.outstandingPaise == null,
    cleared: loan.outstandingPaise != null && balance === 0,
  };
}

export interface PaymentInput {
  paymentPaise: number;
  /** Day the money left the account, YYYY-MM-DD. */
  effectiveDate: string;
  /** What the lender actually charged, when it differs from the computed figure. */
  interestPaise?: number;
  transactionId?: string | null;
}

export interface PostedMonth {
  month: MonthKey;
  entries: LoanLedgerInput[];
  interestPaise: number;
  paymentPaise: number;
  closingPaise: number;
}

/**
 * The ledger entries for recording one month on a loan: that month's interest, then the payment.
 * The payment is capped at what is owed. Returns null when there is nothing to record.
 */
export function postMonth(
  loan: LoanDto,
  state: LoanState,
  input: PaymentInput,
): PostedMonth | null {
  const month = state.nextMonth;
  const computed = stepLoanMonth(loanTerms(loan), month, state.openingPaise, 0).interestPaise;
  const interestPaise = input.interestPaise ?? computed;
  const duePaise = state.openingPaise + interestPaise;
  const paymentPaise = Math.min(input.paymentPaise, duePaise);
  if (interestPaise === 0 && paymentPaise === 0) return null;

  const entries: LoanLedgerInput[] = [];
  let balance = state.openingPaise;
  if (interestPaise > 0) {
    balance += interestPaise;
    entries.push({
      loanId: loan.id,
      kind: 'INTEREST',
      month,
      effectiveDate: input.effectiveDate,
      amountPaise: interestPaise,
      balanceAfterPaise: balance,
    });
  }
  if (paymentPaise > 0) {
    balance -= paymentPaise;
    entries.push({
      loanId: loan.id,
      kind: 'PAYMENT',
      month,
      effectiveDate: input.effectiveDate,
      amountPaise: paymentPaise,
      balanceAfterPaise: balance,
      transactionId: input.transactionId ?? null,
    });
  }
  return { month, entries, interestPaise, paymentPaise, closingPaise: balance };
}
