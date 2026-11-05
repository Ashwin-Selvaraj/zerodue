import type { LoanDto, LoanLedgerDto } from '@zerodue/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDING, loanState, loanTerms, postMonth } from './loan-state';

const META = {
  version: 1,
  createdAt: '2026-11-01T00:00:00+05:30',
  updatedAt: '2026-11-01T00:00:00+05:30',
  editedAt: '2026-11-01T00:00:00+05:30',
  deletedAt: null,
  lastDeviceId: null,
};
const loan = (overrides: Partial<LoanDto> = {}): LoanDto => ({
  id: 'loan-1',
  name: 'Test loan',
  kind: 'FLEXIBLE',
  status: 'ACTIVE',
  outstandingPaise: 500_000_00,
  outstandingAsOf: '2026-11-01',
  annualRateBps: 900,
  interestStartMonth: '2026-11-01',
  ...META,
  ...overrides,
});
const entry = (overrides: Partial<LoanLedgerDto>): LoanLedgerDto => ({
  id: crypto.randomUUID(),
  loanId: 'loan-1',
  kind: 'PAYMENT',
  month: '2026-11-01',
  effectiveDate: '2026-11-30',
  amountPaise: 1,
  balanceAfterPaise: 0,
  ...META,
  ...overrides,
});

describe('loanTerms', () => {
  it('uses the loan rate, its start month and the default rounding', () => {
    expect(loanTerms(loan())).toEqual({
      annualRateBps: 900,
      interestStartMonth: '2026-11-01',
      rounding: DEFAULT_ROUNDING,
    });
  });
  it('treats a loan without a rate as interest free, and honours a rounding override', () => {
    expect(
      loanTerms(
        loan({ annualRateBps: null, interestStartMonth: null, roundingOverride: 'CARRY_PAISE' }),
      ),
    ).toEqual({ annualRateBps: 0, interestStartMonth: null, rounding: 'CARRY_PAISE' });
  });
});

describe('loanState', () => {
  it('starts from the entered balance and month when nothing is recorded', () => {
    const state = loanState(loan(), [], '2026-11-01');
    expect(state).toMatchObject({
      openingPaise: 500_000_00,
      nextMonth: '2026-11-01',
      actual: [],
      needsBalance: false,
      cleared: false,
    });
  });

  it('falls back to the given month when the loan has no "as of" date', () => {
    expect(loanState(loan({ outstandingAsOf: null }), [], '2026-12-01').nextMonth).toBe(
      '2026-12-01',
    );
  });

  it('flags a loan with no balance entered', () => {
    const state = loanState(loan({ outstandingPaise: null }), [], '2026-11-01');
    expect(state).toMatchObject({ needsBalance: true, cleared: false, openingPaise: 0 });
  });

  it('rolls the balance through recorded months and moves on to the next one', () => {
    const state = loanState(
      loan(),
      [
        entry({ id: 'p', kind: 'PAYMENT', amountPaise: 80_000_00, balanceAfterPaise: 423_750_00 }),
        entry({ id: 'i', kind: 'INTEREST', amountPaise: 3_750_00, balanceAfterPaise: 503_750_00 }),
      ],
      '2026-11-01',
    );
    expect(state.actual).toEqual([
      {
        month: '2026-11-01',
        openingPaise: 500_000_00,
        interestPaise: 3_750_00,
        paymentPaise: 80_000_00,
        closingPaise: 423_750_00,
      },
    ]);
    expect(state).toMatchObject({
      openingPaise: 423_750_00,
      nextMonth: '2026-12-01',
      paidToDatePaise: 80_000_00,
      interestToDatePaise: 3_750_00,
    });
  });

  it('ignores entries that belong to another loan, and reports a cleared loan', () => {
    const state = loanState(
      loan({ outstandingPaise: 1_000_00 }),
      [
        entry({ kind: 'PAYMENT', amountPaise: 1_000_00, balanceAfterPaise: 0 }),
        entry({ loanId: 'other', amountPaise: 5, balanceAfterPaise: 999 }),
      ],
      '2026-11-01',
    );
    expect(state).toMatchObject({ cleared: true, openingPaise: 0 });
    expect(state.actual).toHaveLength(1);
  });

  it('orders fees and adjustments with interest, and sorts months and days', () => {
    const state = loanState(
      loan({ outstandingPaise: 100_00 }),
      [
        entry({
          kind: 'PAYMENT',
          month: '2026-12-01',
          effectiveDate: '2026-12-31',
          amountPaise: 50_00,
          balanceAfterPaise: 60_00,
        }),
        entry({
          kind: 'FEE',
          month: '2026-11-01',
          effectiveDate: '2026-11-10',
          amountPaise: 5_00,
          balanceAfterPaise: 105_00,
        }),
        entry({
          kind: 'ADJUSTMENT',
          month: '2026-11-01',
          effectiveDate: '2026-11-10',
          amountPaise: 5_00,
          balanceAfterPaise: 110_00,
        }),
        entry({
          kind: 'PAYMENT',
          month: '2026-11-01',
          effectiveDate: '2026-11-10',
          amountPaise: 50_00,
          balanceAfterPaise: 60_00 + 50_00,
          createdAt: '2026-11-10T00:00:00+05:30',
        }),
        entry({
          kind: 'PAYMENT',
          month: '2026-11-01',
          effectiveDate: '2026-11-10',
          amountPaise: 1_00,
          balanceAfterPaise: 109_00 + 1_00 - 1_00,
          createdAt: '2026-11-11T00:00:00+05:30',
        }),
      ],
      '2026-11-01',
    );
    expect(state.actual.map((m) => m.month)).toEqual(['2026-11-01', '2026-12-01']);
    expect(state.actual[0]!.interestPaise).toBe(10_00);
    expect(state.actual[0]!.paymentPaise).toBe(51_00);
  });
});

describe('postMonth', () => {
  const state = (l: LoanDto) => loanState(l, [], '2026-11-01');

  it('records the interest charge and then the payment', () => {
    const l = loan();
    const posted = postMonth(l, state(l), {
      paymentPaise: 80_000_00,
      effectiveDate: '2026-11-30',
    })!;
    expect(posted.month).toBe('2026-11-01');
    expect(posted.interestPaise).toBe(3_750_00);
    expect(posted.closingPaise).toBe(423_750_00);
    expect(posted.entries.map((e) => [e.kind, e.amountPaise, e.balanceAfterPaise])).toEqual([
      ['INTEREST', 3_750_00, 503_750_00],
      ['PAYMENT', 80_000_00, 423_750_00],
    ]);
  });

  it('uses the lender’s interest figure when it differs from the computed one', () => {
    const l = loan();
    const posted = postMonth(l, state(l), {
      paymentPaise: 100_000_00,
      interestPaise: 3_800_00,
      effectiveDate: '2026-11-30',
    })!;
    expect(posted.closingPaise).toBe(500_000_00 + 3_800_00 - 100_000_00);
  });

  it('never takes more than is owed and remembers the transaction', () => {
    const l = loan({ outstandingPaise: 1_000_00, annualRateBps: 0 });
    const posted = postMonth(l, state(l), {
      paymentPaise: 5_000_00,
      effectiveDate: '2026-11-30',
      transactionId: 'txn-1',
    })!;
    expect(posted.paymentPaise).toBe(1_000_00);
    expect(posted.closingPaise).toBe(0);
    expect(posted.entries).toHaveLength(1);
    expect(posted.entries[0]).toMatchObject({ kind: 'PAYMENT', transactionId: 'txn-1' });
  });

  it('records interest alone when no payment is made', () => {
    const l = loan();
    const posted = postMonth(l, state(l), { paymentPaise: 0, effectiveDate: '2026-11-30' })!;
    expect(posted.entries.map((e) => e.kind)).toEqual(['INTEREST']);
    expect(posted.closingPaise).toBe(503_750_00);
  });

  it('returns nothing to record when there is no interest and no payment', () => {
    const l = loan({ annualRateBps: 0 });
    expect(postMonth(l, state(l), { paymentPaise: 0, effectiveDate: '2026-11-30' })).toBeNull();
  });

  it('charges no interest before the interest start month', () => {
    const l = loan({ interestStartMonth: '2027-01-01' });
    const posted = postMonth(l, state(l), {
      paymentPaise: 10_000_00,
      effectiveDate: '2026-11-30',
    })!;
    expect(posted.interestPaise).toBe(0);
    expect(posted.entries.map((e) => e.kind)).toEqual(['PAYMENT']);
  });
});
