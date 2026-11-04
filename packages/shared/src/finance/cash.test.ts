import { describe, expect, it } from 'vitest';
import { cashEventsOf, findCashRisks } from './cash';
import { buildPlan } from './plan';
import { goalProgress } from './goal';

const rs = (rupees: number): number => rupees * 100;

describe('findCashRisks', () => {
  it('flags a payment that overdraws before the money arrives', () => {
    const risks = findCashRisks(rs(5_000), [
      { date: '2030-01-16', label: 'Client payment', amountPaise: rs(70_000) },
      { date: '2030-01-05', label: 'EMI', amountPaise: -rs(4_500) },
      { date: '2030-01-10', label: 'Insurance', amountPaise: -rs(6_000) },
    ]);
    expect(risks).toEqual([
      {
        date: '2030-01-10',
        label: 'Insurance',
        balancePaise: -rs(5_500),
        shortfallPaise: rs(5_500),
      },
    ]);
  });

  it('applies money-out first on the same day', () => {
    const risks = findCashRisks(rs(1_000), [
      { date: '2030-01-05', label: 'Salary', amountPaise: rs(50_000) },
      { date: '2030-01-05', label: 'Rent', amountPaise: -rs(5_000) },
    ]);
    expect(risks.map((r) => r.label)).toEqual(['Rent']);
  });

  it('measures against a safety buffer and never flags an inflow', () => {
    const events = [
      { date: '2030-01-02', label: 'Bill', amountPaise: -rs(1_000) },
      { date: '2030-01-03', label: 'Refund', amountPaise: rs(10) },
    ];
    expect(findCashRisks(rs(3_000), events, 0)).toEqual([]);
    const risks = findCashRisks(rs(3_000), events, rs(5_000));
    expect(risks).toEqual([
      { date: '2030-01-02', label: 'Bill', balancePaise: rs(2_000), shortfallPaise: rs(3_000) },
    ]);
  });

  it('reports every dip separately and leaves the input untouched', () => {
    const events = [
      { date: '2030-01-09', label: 'B', amountPaise: -rs(10) },
      { date: '2030-01-02', label: 'A', amountPaise: -rs(10) },
    ];
    const copy = structuredClone(events);
    expect(findCashRisks(0, events).map((r) => r.label)).toEqual(['A', 'B']);
    expect(events).toEqual(copy);
  });

  it('validates its inputs', () => {
    expect(() => findCashRisks(-1, [])).toThrow(RangeError);
    expect(() => findCashRisks(0, [], -1)).toThrow(RangeError);
  });
});

describe('cashEventsOf', () => {
  it('turns planned months into signed, dated events', () => {
    const plan = buildPlan({
      startMonth: '2030-01-01',
      months: 1,
      openingBalancePaise: 0,
      streams: [
        {
          id: 's',
          name: 'Salary',
          kind: 'INCOME',
          frequency: 'MONTHLY',
          dueDay: 28,
          startDate: '2030-01-01',
          periods: [{ effectiveFrom: '2030-01-01', amountPaise: rs(50_000) }],
        },
        {
          id: 'r',
          name: 'Rent',
          kind: 'EXPENSE',
          frequency: 'MONTHLY',
          dueDay: 3,
          startDate: '2030-01-01',
          periods: [{ effectiveFrom: '2030-01-01', amountPaise: rs(12_000) }],
        },
        {
          id: 'g',
          name: 'Support',
          kind: 'INCOME',
          frequency: 'MONTHLY',
          dueDay: 1,
          earmarked: true,
          startDate: '2030-01-01',
          periods: [{ effectiveFrom: '2030-01-01', amountPaise: rs(20_000) }],
        },
      ],
      oneOffs: [{ id: 'o', label: 'Gadget', month: '2030-01-01', amountPaise: rs(5_000) }],
      receivables: [
        {
          id: 'f',
          label: 'Friend',
          kind: 'OWED_TO_ME',
          expectedDate: '2030-01-20',
          amountPaise: rs(3_000),
        },
      ],
    });
    const events = cashEventsOf(plan.months);
    expect(events).toHaveLength(5);
    expect(events).toEqual(
      expect.arrayContaining([
        { date: '2030-01-28', label: 'Salary', amountPaise: rs(50_000) },
        { date: '2030-01-20', label: 'Friend', amountPaise: rs(3_000) },
        { date: '2030-01-03', label: 'Rent', amountPaise: -rs(12_000) },
        { date: '2030-01-31', label: 'Gadget', amountPaise: -rs(5_000) },
        { date: '2030-01-01', label: 'Support', amountPaise: rs(20_000) },
      ]),
    );
    expect(cashEventsOf([])).toEqual([]);
  });
});

describe('goalProgress', () => {
  it('funds a purchase from several contributors and computes the gap', () => {
    const goal = goalProgress(rs(100_000), [
      { contributor: 'Me', amountPaise: rs(30_000), status: 'RECEIVED' },
      { contributor: 'Sibling', amountPaise: rs(25_000), status: 'PLEDGED' },
      { contributor: 'Me', amountPaise: rs(5_000), status: 'PLEDGED' },
    ]);
    expect(goal).toEqual({
      targetPaise: rs(100_000),
      fundedPaise: rs(60_000),
      receivedPaise: rs(30_000),
      pledgedPaise: rs(30_000),
      gapPaise: rs(40_000),
      percentFunded: 60,
      byContributor: [
        { contributor: 'Me', amountPaise: rs(35_000) },
        { contributor: 'Sibling', amountPaise: rs(25_000) },
      ],
    });
  });

  it('has no gap and caps at 100% when over-funded or when the target is zero', () => {
    const over = goalProgress(rs(100), [
      { contributor: 'A', amountPaise: rs(150), status: 'RECEIVED' },
    ]);
    expect(over).toMatchObject({ gapPaise: 0, percentFunded: 100 });
    expect(goalProgress(0, [])).toMatchObject({
      gapPaise: 0,
      percentFunded: 100,
      byContributor: [],
    });
  });

  it('rounds the percentage down and validates amounts', () => {
    expect(
      goalProgress(3, [{ contributor: 'A', amountPaise: 2, status: 'RECEIVED' }]).percentFunded,
    ).toBe(66);
    expect(() => goalProgress(-1, [])).toThrow(RangeError);
    expect(() =>
      goalProgress(10, [{ contributor: 'A', amountPaise: -1, status: 'RECEIVED' }]),
    ).toThrow(RangeError);
  });
});
