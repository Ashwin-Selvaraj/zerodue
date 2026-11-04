import { describe, expect, it } from 'vitest';
import {
  availabilityByMonth,
  buildPlan,
  occurrenceInMonth,
  type PlanInput,
  type PlanLoan,
  type Stream,
} from './plan';

const rs = (rupees: number): number => rupees * 100;
const period = (effectiveFrom: string, rupees: number) => ({
  effectiveFrom,
  amountPaise: rs(rupees),
});

const salary: Stream = {
  id: 'salary',
  name: 'Salary',
  kind: 'INCOME',
  frequency: 'MONTHLY',
  dueDay: 28,
  startDate: '2030-01-01',
  periods: [period('2030-01-01', 50_000)],
};
const bonus: Stream = {
  id: 'bonus',
  name: 'Bonus',
  kind: 'INCOME',
  frequency: 'QUARTERLY',
  dueDay: 15,
  anchorMonth: '2030-03-01',
  startDate: '2030-01-01',
  periods: [period('2030-01-01', 10_000)],
};
const rent: Stream = {
  id: 'rent',
  name: 'Rent',
  kind: 'EXPENSE',
  frequency: 'MONTHLY',
  dueDay: 3,
  startDate: '2030-01-01',
  periods: [period('2030-01-01', 12_000), period('2030-06-01', 15_000)],
};
const gift: Stream = {
  id: 'gift',
  name: 'Family support',
  kind: 'INCOME',
  frequency: 'MONTHLY',
  dueDay: 1,
  earmarked: true,
  startDate: '2030-02-01',
  periods: [period('2030-02-01', 20_000)],
};
const loan: PlanLoan = {
  id: 'L',
  name: 'Loan',
  openingBalancePaise: rs(100_000),
  firstMonth: '2030-01-01',
  annualRateBps: 1200,
  rounding: 'ROUND_HALF_UP_RUPEE',
};

const plan = (overrides: Partial<PlanInput> = {}) =>
  buildPlan({
    startMonth: '2030-01-01',
    months: 4,
    openingBalancePaise: 0,
    streams: [salary, rent],
    ...overrides,
  });

describe('occurrenceInMonth', () => {
  it('falls on the due day, defaulting to the 1st, and clamps to short months', () => {
    const monthly = (dueDay?: number): Stream => ({ ...salary, dueDay });
    expect(occurrenceInMonth(monthly(10), '2030-03-01')?.dueDate).toBe('2030-03-10');
    expect(occurrenceInMonth(monthly(undefined), '2030-03-01')?.dueDate).toBe('2030-03-01');
    expect(occurrenceInMonth(monthly(31), '2030-02-01')?.dueDate).toBe('2030-02-28');
  });

  it('cycles quarterly from the anchor month, not before it', () => {
    const due = (month: string) => occurrenceInMonth(bonus, month) !== null;
    expect([
      due('2030-03-01'),
      due('2030-06-01'),
      due('2030-09-01'),
      due('2030-12-01'),
      due('2031-03-01'),
    ]).toEqual([true, true, true, true, true]);
    expect([due('2030-01-01'), due('2030-02-01'), due('2030-04-01'), due('2030-05-01')]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(due('2029-12-01')).toBe(false); // before the anchor
  });

  it('defaults the quarterly anchor to the start date month', () => {
    const quarterly: Stream = {
      ...bonus,
      anchorMonth: undefined,
      startDate: '2030-02-01',
      periods: [period('2030-02-01', 1)],
    };
    expect(occurrenceInMonth(quarterly, '2030-02-01')).not.toBeNull();
    expect(occurrenceInMonth(quarterly, '2030-03-01')).toBeNull();
    expect(occurrenceInMonth(quarterly, '2030-05-01')).not.toBeNull();
  });

  it('puts a one-time item only in its own month, on its start date', () => {
    const once: Stream = {
      ...salary,
      frequency: 'ONE_TIME',
      startDate: '2030-04-17',
      periods: [period('2030-04-01', 9)],
    };
    expect(occurrenceInMonth(once, '2030-04-01')?.dueDate).toBe('2030-04-17');
    expect(occurrenceInMonth(once, '2030-05-01')).toBeNull();
    expect(occurrenceInMonth(once, '2030-03-01')).toBeNull();
  });

  it('skips a due day that falls before the start date', () => {
    const late: Stream = { ...salary, dueDay: 5, startDate: '2030-01-20' };
    expect(occurrenceInMonth(late, '2030-01-01')).toBeNull();
    expect(occurrenceInMonth(late, '2030-02-01')?.dueDate).toBe('2030-02-05');
  });

  it('stops after the end date, inclusive', () => {
    const ending: Stream = { ...salary, dueDay: 10, endDate: '2030-03-10' };
    expect(occurrenceInMonth(ending, '2030-03-01')).not.toBeNull();
    expect(occurrenceInMonth(ending, '2030-04-01')).toBeNull();
  });

  it('uses the amount period in force on the due date, however the periods are ordered', () => {
    const stepped: Stream = {
      ...rent,
      periods: [
        period('2030-06-01', 15_000),
        period('2030-01-01', 12_000),
        period('2030-09-01', 18_000),
      ],
    };
    const amount = (month: string) => occurrenceInMonth(stepped, month)?.amountPaise;
    expect(amount('2030-05-01')).toBe(rs(12_000));
    expect(amount('2030-06-01')).toBe(rs(15_000));
    expect(amount('2030-08-01')).toBe(rs(15_000));
    expect(amount('2030-09-01')).toBe(rs(18_000));
  });

  it('lets a later duplicate period win, and gives nothing before the first period applies', () => {
    const dupe: Stream = { ...rent, periods: [period('2030-01-01', 1), period('2030-01-01', 2)] };
    expect(occurrenceInMonth(dupe, '2030-01-01')?.amountPaise).toBe(rs(2));
    const notYet: Stream = { ...rent, periods: [period('2030-03-01', 5)] };
    expect(occurrenceInMonth(notYet, '2030-02-01')).toBeNull();
    expect(occurrenceInMonth({ ...rent, periods: [] }, '2030-02-01')).toBeNull();
  });

  it('reports whether income is earmarked and rejects bad amounts', () => {
    expect(occurrenceInMonth(gift, '2030-02-01')?.earmarked).toBe(true);
    expect(occurrenceInMonth(salary, '2030-02-01')?.earmarked).toBe(false);
    expect(() =>
      occurrenceInMonth(
        { ...rent, periods: [{ effectiveFrom: '2030-01-01', amountPaise: -1 }] },
        '2030-01-01',
      ),
    ).toThrow(RangeError);
  });
});

describe('buildPlan: the waterfall', () => {
  const nonLoan = plan({
    openingBalancePaise: rs(2_000),
    receivables: [
      {
        id: 'r1',
        label: 'Freelance',
        kind: 'EXPECTED_INCOME',
        expectedDate: '2030-01-20',
        amountPaise: rs(7_000),
      },
      {
        id: 'r2',
        label: 'Friend',
        kind: 'OWED_TO_ME',
        expectedDate: '2030-01-25',
        amountPaise: rs(3_000),
      },
      {
        id: 'r3',
        label: 'Later',
        kind: 'OWED_TO_ME',
        expectedDate: '2030-03-02',
        amountPaise: rs(500),
      },
    ],
    oneOffs: [
      { id: 'o1', label: 'Gadget', month: '2030-01-01', amountPaise: rs(5_000) },
      { id: 'o2', label: 'Repair', month: '2030-02-01', amountPaise: rs(900), date: '2030-02-14' },
    ],
  });
  const jan = nonLoan.months[0]!;

  it('goes income → fixed → one-offs → money owed back → opening balance = leftover', () => {
    expect(jan.incomePaise).toBe(rs(57_000)); // salary + freelance
    expect(jan.fixedOutgoingsPaise).toBe(rs(12_000));
    expect(jan.oneOffsPaise).toBe(rs(5_000));
    expect(jan.receivablesPaise).toBe(rs(3_000));
    expect(jan.openingBalancePaise).toBe(rs(2_000));
    expect(jan.leftoverPaise).toBe(rs(45_000));
    expect(jan.steps.map((s) => [s.kind, s.label, s.runningPaise / 100])).toEqual([
      ['INCOME', 'Salary', 50_000],
      ['INCOME', 'Freelance', 57_000],
      ['FIXED', 'Rent', 45_000],
      ['ONE_OFF', 'Gadget', 40_000],
      ['RECEIVABLE', 'Friend', 43_000],
      ['OPENING_BALANCE', 'Current balance', 45_000],
    ]);
    expect(jan.steps.at(-1)!.runningPaise).toBe(jan.leftoverPaise);
  });

  it('counts the opening balance once, in the first month only', () => {
    const feb = nonLoan.months[1]!;
    expect(feb.openingBalancePaise).toBe(0);
    expect(feb.steps.some((s) => s.kind === 'OPENING_BALANCE')).toBe(false);
    expect(feb.leftoverPaise).toBe(rs(50_000 - 12_000 - 900));
    expect(nonLoan.months[2]!.receivablesPaise).toBe(rs(500));
  });

  it('dates one-offs, defaulting to the last day of the month', () => {
    expect(jan.oneOffs[0]!.date).toBe('2030-01-31');
    expect(nonLoan.months[1]!.oneOffs[0]!.date).toBe('2030-02-14');
  });

  it('leaves out occurrences that are already settled', () => {
    const settled = plan({ settledOccurrences: ['rent:2030-01-03'] });
    expect(settled.months[0]!.fixed).toEqual([]);
    expect(settled.months[1]!.fixed).toHaveLength(1);
  });

  it('follows quarterly income and stepped amounts through the months', () => {
    const p = plan({ months: 7, streams: [salary, bonus, rent] });
    expect(p.months.map((m) => m.leftoverPaise / 100)).toEqual([
      38_000, 38_000, 48_000, 38_000, 38_000, 45_000, 35_000,
    ]); // bonus in Mar and Jun; rent rises to 15,000 from Jun
  });

  it('recalculates everything when an input changes', () => {
    const raised = plan({
      streams: [{ ...salary, periods: [period('2030-01-01', 55_000)] }, rent],
    });
    plan().months.forEach((m, i) =>
      expect(raised.months[i]!.leftoverPaise - m.leftoverPaise).toBe(rs(5_000)),
    );
  });

  it('flags a negative leftover as a shortfall and pays nothing to the loan that month', () => {
    const p = plan({ streams: [rent], loan });
    const jan = p.months[0]!;
    expect(jan.leftoverPaise).toBe(-rs(12_000));
    expect(jan.flags).toContain('SHORTFALL');
    expect(jan.loanPaymentPaise).toBe(0);
    expect(jan.loan!.closingPaise).toBe(rs(101_000)); // interest still accrues
  });

  it('rejects invalid amounts', () => {
    expect(() => plan({ openingBalancePaise: -1 })).toThrow(RangeError);
    expect(() => plan({ loan: { ...loan, openingBalancePaise: -1 } })).toThrow(RangeError);
    expect(() =>
      plan({ oneOffs: [{ id: 'x', label: 'x', month: '2030-01-01', amountPaise: -1 }] }),
    ).toThrow(RangeError);
    expect(() =>
      plan({
        receivables: [
          { id: 'x', label: 'x', kind: 'OWED_TO_ME', expectedDate: '2030-01-01', amountPaise: -1 },
        ],
      }),
    ).toThrow(RangeError);
  });
});

describe('buildPlan: sweeping spare money into a loan', () => {
  const swept = plan({
    streams: [salary, bonus, rent, gift],
    loan,
    allocations: [{ streamId: 'gift', target: 'LOAN', loanId: 'L', startMonth: '2030-02-01' }],
  });
  const [jan, feb, mar, apr] = swept.months as [
    (typeof swept.months)[number],
    (typeof swept.months)[number],
    (typeof swept.months)[number],
    (typeof swept.months)[number],
  ];

  it('pays everything available each month and compounds the rest', () => {
    expect(jan.availablePaise).toBe(rs(38_000));
    expect(jan.loan).toMatchObject({
      interestPaise: rs(1_000),
      paymentPaise: rs(38_000),
      closingPaise: rs(63_000),
    });
    expect(jan.sparePaise).toBe(0);

    expect(feb.allocations.toLoanPaise).toBe(rs(20_000));
    expect(feb.availablePaise).toBe(rs(58_000));
    expect(feb.loan).toMatchObject({
      interestPaise: rs(630),
      paymentPaise: rs(58_000),
      closingPaise: rs(5_630),
    });
  });

  it('clears the loan, reports the spare, and summarises the payoff', () => {
    expect(mar.availablePaise).toBe(rs(68_000)); // leftover 48,000 incl. bonus + 20,000
    expect(mar.loan).toMatchObject({
      interestPaise: rs(56),
      paymentPaise: rs(5_686),
      closingPaise: 0,
    });
    expect(mar.sparePaise).toBe(rs(62_314));
    expect(swept.loan).toEqual({
      payoffMonth: '2030-03-01',
      totalInterestPaise: rs(1_686),
      totalPaidPaise: rs(101_686),
      endingBalancePaise: 0,
    });
  });

  it('stops the loan allocation once cleared and asks where the money should go', () => {
    expect(apr.loan).toBeNull();
    expect(apr.allocations).toMatchObject({ toLoanPaise: 0, undecidedPaise: rs(20_000) });
    expect(apr.flags).toContain('PENDING_DECISION');
    expect(apr.sparePaise).toBe(apr.availablePaise);
    expect(swept.pendingDecisions).toEqual([
      { month: '2030-04-01', streamId: 'gift', label: 'Family support', amountPaise: rs(20_000) },
    ]);
    expect(feb.flags).not.toContain('PENDING_DECISION');
  });

  it('exposes availability per month for gap analysis', () => {
    expect(availabilityByMonth(swept)).toEqual({
      '2030-01-01': rs(38_000),
      '2030-02-01': rs(58_000),
      '2030-03-01': rs(68_000),
      '2030-04-01': rs(38_000),
    });
  });

  it('uses manual payments instead of sweeping, and flags overcommitting', () => {
    const manual = plan({
      loan: { ...loan, manualPayments: { '2030-01-01': rs(10_000), '2030-02-01': rs(60_000) } },
    });
    expect(manual.months[0]!.loanPaymentPaise).toBe(rs(10_000));
    expect(manual.months[0]!.sparePaise).toBe(rs(28_000));
    expect(manual.months[0]!.flags).not.toContain('OVERCOMMITTED');
    expect(manual.months[1]!.loanPaymentPaise).toBe(rs(60_000));
    expect(manual.months[1]!.sparePaise).toBe(rs(38_000) - rs(60_000));
    expect(manual.months[1]!.flags).toContain('OVERCOMMITTED');
  });

  it('handles a loan that has not started yet and one that is already cleared', () => {
    const later = plan({ loan: { ...loan, firstMonth: '2030-03-01' } });
    expect(later.months.map((m) => m.loan === null)).toEqual([true, true, false, false]);
    expect(later.months[0]!.sparePaise).toBe(later.months[0]!.availablePaise);

    const cleared = plan({ loan: { ...loan, openingBalancePaise: 0 } });
    expect(cleared.loan).toEqual({
      payoffMonth: '2030-01-01',
      totalInterestPaise: 0,
      totalPaidPaise: 0,
      endingBalancePaise: 0,
    });
    expect(cleared.months.every((m) => m.loan === null)).toBe(true);
  });

  it('has no loan section without a loan, and ignores loan rules', () => {
    const none = plan({
      streams: [salary, gift],
      allocations: [{ streamId: 'gift', target: 'LOAN', loanId: 'L', startMonth: '2030-02-01' }],
    });
    expect(none.loan).toBeNull();
    expect(none.months[1]!.allocations.toLoanPaise).toBe(0);
    expect(none.months[1]!.allocations.undecidedPaise).toBe(rs(20_000));
  });
});

describe('buildPlan: routing earmarked money', () => {
  const route = (allocations: PlanInput['allocations'], withLoan = false) =>
    plan({ streams: [salary, gift], allocations, loan: withLoan ? loan : undefined });
  const feb = (allocations: PlanInput['allocations'], withLoan = false) =>
    route(allocations, withLoan).months[1]!.allocations;

  it('sends it to a goal, back to the source, or parks it', () => {
    expect(
      feb([{ streamId: 'gift', target: 'GOAL', goalId: 'G', startMonth: '2030-01-01' }]),
    ).toMatchObject({ toGoalPaise: rs(20_000), undecidedPaise: 0 });
    expect(
      feb([{ streamId: 'gift', target: 'RETURN_TO_SOURCE', startMonth: '2030-01-01' }]),
    ).toMatchObject({ returnedPaise: rs(20_000) });
    expect(
      feb([{ streamId: 'gift', target: 'UNALLOCATED', startMonth: '2030-01-01' }]),
    ).toMatchObject({ heldPaise: rs(20_000), undecidedPaise: 0 });
  });

  it('asks for a decision when there is no rule, or the rule is outside its dates', () => {
    expect(feb(undefined).undecidedPaise).toBe(rs(20_000));
    expect(
      feb([{ streamId: 'gift', target: 'GOAL', startMonth: '2030-03-01' }]).undecidedPaise,
    ).toBe(rs(20_000)); // not started
    expect(
      feb([{ streamId: 'gift', target: 'GOAL', startMonth: '2030-01-01', endMonth: '2030-01-01' }])
        .undecidedPaise,
    ).toBe(rs(20_000)); // ended
    expect(
      feb([{ streamId: 'gift', target: 'GOAL', startMonth: '2030-01-01', endMonth: '2030-02-01' }])
        .toGoalPaise,
    ).toBe(rs(20_000)); // inclusive
    expect(
      feb([{ streamId: 'other', target: 'GOAL', startMonth: '2030-01-01' }]).undecidedPaise,
    ).toBe(rs(20_000)); // another stream's rule
  });

  it('ignores a loan rule that names a different loan', () => {
    expect(
      feb([{ streamId: 'gift', target: 'LOAN', loanId: 'OTHER', startMonth: '2030-01-01' }], true)
        .undecidedPaise,
    ).toBe(rs(20_000));
  });

  it('tries rules in priority order, lowest first, and then falls back to the next', () => {
    const rules: PlanInput['allocations'] = [
      { streamId: 'gift', target: 'GOAL', startMonth: '2030-01-01' }, // default priority 100
      { streamId: 'gift', target: 'RETURN_TO_SOURCE', startMonth: '2030-01-01', priority: 10 },
    ];
    expect(feb(rules).returnedPaise).toBe(rs(20_000));
    expect(feb(rules).toGoalPaise).toBe(0);
    // priority rule limited to January: February falls through to the default-priority rule
    const limited: PlanInput['allocations'] = [
      { streamId: 'gift', target: 'GOAL', startMonth: '2030-01-01' },
      {
        streamId: 'gift',
        target: 'RETURN_TO_SOURCE',
        startMonth: '2030-01-01',
        endMonth: '2030-01-01',
        priority: 10,
      },
    ];
    expect(feb(limited).toGoalPaise).toBe(rs(20_000));
  });

  it('does not count earmarked money in leftover', () => {
    expect(route(undefined).months[1]!.leftoverPaise).toBe(rs(50_000));
    expect(route(undefined).months[1]!.earmarkedPaise).toBe(rs(20_000));
    expect(route(undefined).months[1]!.earmarked.map((l) => l.label)).toEqual(['Family support']);
  });
});
