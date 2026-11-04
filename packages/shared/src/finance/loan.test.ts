import { describe, expect, it } from 'vitest';
import { monthlyInterest } from './interest';
import {
  MAX_PROJECTION_MONTHS,
  plannedPayment,
  projectLoan,
  solveLevelPayment,
  stepLoanMonth,
  type LoanTerms,
  type ProjectionInput,
} from './loan';

const rs = (rupees: number): number => rupees * 100;

// ₹1,00,000 at 12% a year: month one interest is exactly ₹1,000.
const terms: LoanTerms = { annualRateBps: 1200, rounding: 'ROUND_HALF_UP_RUPEE' };
const base: ProjectionInput = {
  ...terms,
  openingBalancePaise: rs(100_000),
  firstMonth: '2030-01-01',
  payments: { defaultPaymentPaise: rs(30_000) },
};

describe('monthlyInterest', () => {
  it('is opening × rate ÷ 12, rounded to the rupee by default', () => {
    expect(monthlyInterest(rs(100_000), 1200, 'ROUND_HALF_UP_RUPEE')).toBe(rs(1_000));
    expect(monthlyInterest(rs(41_710), 1200, 'ROUND_HALF_UP_RUPEE')).toBe(rs(417)); // 417.10
    expect(monthlyInterest(rs(51_220), 1200, 'ROUND_HALF_UP_RUPEE')).toBe(rs(512)); // 512.20
  });

  it('rounds exact halves up and just-below-half down', () => {
    expect(monthlyInterest(5_000, 1200, 'ROUND_HALF_UP_RUPEE')).toBe(100); // 0.50 → ₹1
    expect(monthlyInterest(4_999, 1200, 'ROUND_HALF_UP_RUPEE')).toBe(0); // 0.4999 → ₹0
  });

  it('can keep the paisa instead', () => {
    expect(monthlyInterest(rs(41_710), 1200, 'CARRY_PAISE')).toBe(41_710);
    expect(monthlyInterest(5_000, 1200, 'CARRY_PAISE')).toBe(50);
  });

  it('is zero for a zero balance or rate and rejects invalid inputs', () => {
    expect(monthlyInterest(0, 1200, 'CARRY_PAISE')).toBe(0);
    expect(monthlyInterest(rs(1_000), 0, 'ROUND_HALF_UP_RUPEE')).toBe(0);
    expect(() => monthlyInterest(-1, 1200, 'CARRY_PAISE')).toThrow(RangeError);
    expect(() => monthlyInterest(100, 12.5, 'CARRY_PAISE')).toThrow(RangeError);
  });
});

describe('plannedPayment', () => {
  it('uses the month override, then the default, then zero, and adds extras', () => {
    const plan = {
      byMonth: { '2030-02-01': 700 },
      defaultPaymentPaise: 500,
      extraByMonth: { '2030-03-01': 50 },
    };
    expect(plannedPayment(plan, '2030-01-01')).toBe(500);
    expect(plannedPayment(plan, '2030-02-01')).toBe(700);
    expect(plannedPayment(plan, '2030-03-01')).toBe(550);
    expect(plannedPayment({}, '2030-01-01')).toBe(0);
    expect(
      plannedPayment({ byMonth: { '2030-01-01': 0 }, defaultPaymentPaise: 9 }, '2030-01-01'),
    ).toBe(0);
  });

  it('rejects negative or fractional amounts', () => {
    expect(() => plannedPayment({ defaultPaymentPaise: -1 }, '2030-01-01')).toThrow(RangeError);
    expect(() => plannedPayment({ extraByMonth: { '2030-01-01': 1.5 } }, '2030-01-01')).toThrow(
      RangeError,
    );
  });
});

describe('stepLoanMonth', () => {
  it('posts interest on the opening balance, then applies the payment', () => {
    expect(stepLoanMonth(terms, '2030-01-01', rs(100_000), rs(30_000))).toEqual({
      month: '2030-01-01',
      openingPaise: rs(100_000),
      interestPaise: rs(1_000),
      duePaise: rs(101_000),
      paymentPaise: rs(30_000),
      closingPaise: rs(71_000),
      unusedPaise: 0,
    });
  });

  it('caps the payment at what is due and reports the unused part', () => {
    const row = stepLoanMonth(terms, '2030-01-01', rs(1_000), rs(5_000));
    expect(row.paymentPaise).toBe(rs(1_010));
    expect(row.closingPaise).toBe(0);
    expect(row.unusedPaise).toBe(rs(3_990));
  });

  it('charges no interest before interestStartMonth, and from it onward', () => {
    const delayed = { ...terms, interestStartMonth: '2030-02-01' };
    expect(stepLoanMonth(delayed, '2030-01-01', rs(100_000), 0).interestPaise).toBe(0);
    expect(stepLoanMonth(delayed, '2030-02-01', rs(100_000), 0).interestPaise).toBe(rs(1_000));
    expect(stepLoanMonth(delayed, '2030-03-01', rs(100_000), 0).interestPaise).toBe(rs(1_000));
    expect(
      stepLoanMonth({ ...terms, interestStartMonth: null }, '2030-01-01', rs(100_000), 0)
        .interestPaise,
    ).toBe(rs(1_000));
  });

  it('validates its inputs', () => {
    expect(() => stepLoanMonth({ ...terms, annualRateBps: -1 }, '2030-01-01', 1, 1)).toThrow(
      RangeError,
    );
    expect(() => stepLoanMonth(terms, '2030-01-01', -1, 1)).toThrow(RangeError);
    expect(() => stepLoanMonth(terms, '2030-01-01', 1, -1)).toThrow(RangeError);
  });
});

describe('projectLoan', () => {
  it('projects month by month until the loan clears', () => {
    const result = projectLoan(base);
    expect(
      result.rows.map((r) => [
        r.month,
        r.interestPaise / 100,
        r.paymentPaise / 100,
        r.closingPaise / 100,
      ]),
    ).toEqual([
      ['2030-01-01', 1_000, 30_000, 71_000],
      ['2030-02-01', 710, 30_000, 41_710],
      ['2030-03-01', 417, 30_000, 12_127],
      ['2030-04-01', 121, 12_248, 0],
    ]);
    expect(result.payoffMonth).toBe('2030-04-01');
    expect(result.totalInterestPaise).toBe(rs(2_248));
    expect(result.totalPaidPaise).toBe(rs(100_000) + rs(2_248));
    expect(result.endingBalancePaise).toBe(0);
  });

  it('keeps paisa precision when asked', () => {
    const result = projectLoan({ ...base, rounding: 'CARRY_PAISE' });
    expect(result.rows[2]!.interestPaise).toBe(41_710); // ₹417.10
  });

  it('returns no rows for an already-cleared loan', () => {
    const result = projectLoan({ ...base, openingBalancePaise: 0 });
    expect(result).toEqual({
      rows: [],
      payoffMonth: '2030-01-01',
      totalInterestPaise: 0,
      totalPaidPaise: 0,
      endingBalancePaise: 0,
    });
  });

  it('reports no payoff month when the horizon ends first', () => {
    const result = projectLoan({
      ...base,
      payments: { defaultPaymentPaise: rs(30_000) },
      maxMonths: 2,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.payoffMonth).toBeNull();
    expect(result.endingBalancePaise).toBe(rs(41_710));
  });

  it('stops at the 50-year cap when payments never cover the interest', () => {
    const result = projectLoan({ ...base, payments: { defaultPaymentPaise: rs(500) } });
    expect(result.rows).toHaveLength(MAX_PROJECTION_MONTHS);
    expect(result.payoffMonth).toBeNull();
  });

  it('honours per-month overrides and extra lump sums', () => {
    const result = projectLoan({
      ...base,
      payments: { defaultPaymentPaise: rs(30_000), extraByMonth: { '2030-02-01': rs(20_000) } },
    });
    expect(result.rows[1]!.paymentPaise).toBe(rs(50_000));
    expect(result.payoffMonth).toBe('2030-03-01');
  });

  it('rejects a negative opening balance', () => {
    expect(() => projectLoan({ ...base, openingBalancePaise: -1 })).toThrow(RangeError);
  });
});

describe('solveLevelPayment', () => {
  const solveInput = {
    ...terms,
    openingBalancePaise: rs(100_000),
    firstMonth: '2030-01-01',
    targetMonth: '2030-04-01',
  };

  it('finds the smallest payment that clears by the target month', () => {
    const payment = solveLevelPayment(solveInput);
    const clears = (p: number) =>
      projectLoan({ ...base, payments: { defaultPaymentPaise: p }, maxMonths: 4 })
        .endingBalancePaise === 0;
    expect(clears(payment)).toBe(true);
    expect(clears(payment - 1)).toBe(false);
    // annuity: ₹1,00,000 over 4 months at 1% a month is about ₹25,628
    expect(Math.abs(payment - rs(25_628))).toBeLessThan(rs(5));
  });

  it('can round up to a whole rupee like a bank EMI', () => {
    const exact = solveLevelPayment(solveInput);
    const rounded = solveLevelPayment({ ...solveInput, roundUpToRupee: true });
    expect(rounded % 100).toBe(0);
    expect(rounded).toBeGreaterThanOrEqual(exact);
    expect(rounded - exact).toBeLessThan(100);
    expect(solveLevelPayment({ ...solveInput, roundUpToRupee: false })).toBe(exact);
  });

  it('accounts for committed extra payments', () => {
    const plain = solveLevelPayment(solveInput);
    const withLump = solveLevelPayment({
      ...solveInput,
      extraByMonth: { '2030-01-01': rs(40_000) },
    });
    expect(withLump).toBeLessThan(plain);
  });

  it('is zero interest-free arithmetic when the rate is zero', () => {
    expect(solveLevelPayment({ ...solveInput, annualRateBps: 0 })).toBe(rs(25_000));
  });

  it('is zero for a cleared loan and rejects a target before the start', () => {
    expect(solveLevelPayment({ ...solveInput, openingBalancePaise: 0 })).toBe(0);
    expect(() => solveLevelPayment({ ...solveInput, targetMonth: '2029-12-01' })).toThrow(
      RangeError,
    );
    expect(() => solveLevelPayment({ ...solveInput, openingBalancePaise: -5 })).toThrow(RangeError);
  });

  it('works for a single month', () => {
    expect(solveLevelPayment({ ...solveInput, targetMonth: '2030-01-01' })).toBe(rs(101_000));
  });
});
