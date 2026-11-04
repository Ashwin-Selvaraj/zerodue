import { describe, expect, it } from 'vitest';
import type { ProjectionInput } from './loan';
import { analyseGap, compareScenarios, gapByMonth, runScenario } from './whatif';

const rs = (rupees: number): number => rupees * 100;

const base: ProjectionInput = {
  annualRateBps: 1200,
  rounding: 'ROUND_HALF_UP_RUPEE',
  openingBalancePaise: rs(100_000),
  firstMonth: '2030-01-01',
  payments: { defaultPaymentPaise: rs(30_000) },
};

describe('gapByMonth', () => {
  it('reports the shortfall per month and never goes negative', () => {
    const rows = gapByMonth('2030-01-01', '2030-03-01', rs(25_000), {
      '2030-01-01': rs(20_000),
      '2030-02-01': rs(25_000),
      '2030-03-01': rs(40_000),
    });
    expect(rows.map((r) => r.gapPaise)).toEqual([rs(5_000), 0, 0]);
    expect(rows[0]).toEqual({
      month: '2030-01-01',
      neededPaise: rs(25_000),
      availablePaise: rs(20_000),
      gapPaise: rs(5_000),
    });
  });

  it('treats a month with no entry as nothing available', () => {
    expect(gapByMonth('2030-01-01', '2030-01-01', 500, {})[0]!.gapPaise).toBe(500);
  });

  it('rejects a reversed range and a negative requirement', () => {
    expect(() => gapByMonth('2030-03-01', '2030-01-01', 1, {})).toThrow(RangeError);
    expect(() => gapByMonth('2030-01-01', '2030-01-01', -1, {})).toThrow(RangeError);
  });
});

describe('analyseGap', () => {
  it('solves the required payment and totals the shortfall', () => {
    const input = {
      annualRateBps: base.annualRateBps,
      rounding: base.rounding,
      openingBalancePaise: base.openingBalancePaise,
      firstMonth: base.firstMonth,
    };
    const analysis = analyseGap(input, '2030-04-01', {
      '2030-01-01': rs(20_000),
      '2030-02-01': rs(30_000),
      '2030-03-01': rs(20_000),
      '2030-04-01': rs(30_000),
    });
    expect(Math.abs(analysis.requiredMonthlyPaise - rs(25_628))).toBeLessThan(rs(5));
    expect(analysis.rows).toHaveLength(4);
    expect(analysis.totalGapPaise).toBe(analysis.rows.reduce((s, r) => s + r.gapPaise, 0));
    expect(analysis.rows[1]!.gapPaise).toBe(0);
    expect(analysis.rows[0]!.gapPaise).toBeGreaterThan(0);
  });
});

describe('runScenario', () => {
  it('runs the base plan when given nothing', () => {
    const result = runScenario(base);
    expect(result.name).toBe('Scenario');
    expect(result.payoffMonth).toBe('2030-04-01');
    expect(result.totalInterestPaise).toBe(rs(2_248));
    expect(result.months).toBe(4);
    expect(result.requiredMonthlyPaise).toBeUndefined();
  });

  it('applies extra payments, accumulating onto the same month and onto the base plan extras', () => {
    const withBaseExtra: ProjectionInput = {
      ...base,
      payments: { defaultPaymentPaise: rs(10_000), extraByMonth: { '2030-01-01': rs(5_000) } },
    };
    const result = runScenario(withBaseExtra, {
      extraPayments: [
        { month: '2030-01-01', amountPaise: rs(1_000) },
        { month: '2030-01-01', amountPaise: rs(2_000) },
        { month: '2030-02-01', amountPaise: rs(4_000) },
      ],
    });
    expect(result.projection.rows[0]!.paymentPaise).toBe(rs(18_000)); // 10k + 5k + 1k + 2k
    expect(result.projection.rows[1]!.paymentPaise).toBe(rs(14_000));
  });

  it('replaces the base plan with a level monthly payment, keeping extras', () => {
    const result = runScenario(base, {
      monthlyPaymentPaise: rs(50_000),
      extraPayments: [{ month: '2030-01-01', amountPaise: rs(10_000) }],
    });
    expect(result.projection.rows[0]!.paymentPaise).toBe(rs(60_000));
    expect(result.payoffMonth).toBe('2030-02-01');
  });

  it('changes the rate', () => {
    const higher = runScenario(base, { annualRateBps: 2400 });
    expect(higher.totalInterestPaise).toBeGreaterThan(rs(2_248));
    expect(higher.projection.rows[0]!.interestPaise).toBe(rs(2_000));
  });

  it('solves the payment needed for a target month, honouring the scenario extras', () => {
    const plain = runScenario(base, { name: 'Target', targetMonth: '2030-04-01' });
    expect(plain.name).toBe('Target');
    expect(Math.abs(plain.requiredMonthlyPaise! - rs(25_628))).toBeLessThan(rs(5));
    const lump = runScenario(base, {
      targetMonth: '2030-04-01',
      extraPayments: [{ month: '2030-01-01', amountPaise: rs(40_000) }],
    });
    expect(lump.requiredMonthlyPaise!).toBeLessThan(plain.requiredMonthlyPaise!);
  });

  it('rejects an invalid extra payment', () => {
    expect(() =>
      runScenario(base, { extraPayments: [{ month: '2030-01-01', amountPaise: -1 }] }),
    ).toThrow(RangeError);
  });
});

describe('compareScenarios', () => {
  it('reports interest and months saved against the current plan', () => {
    const { base: current, scenarios } = compareScenarios(base, [
      { name: 'Lump sum', extraPayments: [{ month: '2030-01-01', amountPaise: rs(40_000) }] },
      { name: 'Pay less', monthlyPaymentPaise: rs(20_000) },
    ]);
    expect(current.name).toBe('Current plan');
    const [lump, less] = scenarios;
    expect(lump!.interestSavedPaise).toBeGreaterThan(0);
    expect(lump!.monthsSaved).toBe(1);
    expect(less!.interestSavedPaise).toBeLessThan(0);
    expect(less!.monthsSaved).toBeLessThan(0);
    expect(lump!.name).toBe('Lump sum');
  });

  it('handles an empty scenario list', () => {
    expect(compareScenarios(base, []).scenarios).toEqual([]);
  });
});
