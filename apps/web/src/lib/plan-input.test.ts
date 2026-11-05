import type {
  AccountDto,
  AllocationRuleDto,
  AmountPeriodDto,
  GoalContributionDto,
  GoalDto,
  LoanDto,
  OccurrenceDto,
  ReceivableDto,
  RecurringItemDto,
  TransactionDto,
} from '@zerodue/shared';
import { describe, expect, it } from 'vitest';
import {
  buildPlanFromSnapshot,
  currentBalancePaise,
  pickSweepLoan,
  type PlanSnapshot,
} from './plan-input';

const META = {
  version: 1,
  createdAt: '2026-10-01T09:00:00+05:30',
  updatedAt: '2026-10-01T09:00:00+05:30',
  editedAt: '2026-10-01T09:00:00+05:30',
  deletedAt: null,
  lastDeviceId: null,
};
const rs = (rupees: number): number => rupees * 100;

const account = (overrides: Partial<AccountDto> = {}): AccountDto => ({
  id: 'bank',
  name: 'Bank',
  type: 'BANK',
  balancePaise: rs(5_000),
  balanceAsOf: '2026-11-03',
  archived: false,
  ...META,
  ...overrides,
});
const txn = (overrides: Partial<TransactionDto>): TransactionDto => ({
  id: crypto.randomUUID(),
  type: 'EXPENSE',
  status: 'POSTED',
  amountPaise: rs(500),
  accountId: 'bank',
  occurredAt: '2026-11-04T10:00:00+05:30',
  tags: [],
  source: 'MANUAL',
  occurrenceId: null,
  ...META,
  ...overrides,
});
const item = (id: string, overrides: Partial<RecurringItemDto>): RecurringItemDto => ({
  id,
  kind: 'EXPENSE',
  name: id,
  frequency: 'MONTHLY',
  startDate: '2026-11-01',
  reminderLeadDays: [],
  fixedOutgoing: true,
  active: true,
  ...META,
  ...overrides,
});
const period = (itemId: string, amount: number, from = '2026-11-01'): AmountPeriodDto => ({
  id: `${itemId}-${from}`,
  recurringItemId: itemId,
  effectiveFrom: from,
  amountPaise: rs(amount),
  ...META,
});
const loan = (overrides: Partial<LoanDto> = {}): LoanDto => ({
  id: 'loan',
  name: 'Big loan',
  kind: 'FLEXIBLE',
  status: 'ACTIVE',
  outstandingPaise: rs(500_000),
  outstandingAsOf: '2026-11-01',
  annualRateBps: 900,
  interestStartMonth: '2026-11-01',
  ...META,
  ...overrides,
});

/** A neutral household: salary, a quarterly bonus, bills, a loan, a goal and one expected payment. */
function snapshot(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  const items = [
    item('salary', { kind: 'INCOME', dueDay: 30 }),
    item('bonus', {
      kind: 'INCOME',
      frequency: 'QUARTERLY',
      dueDay: 30,
      anchorMonth: '2026-11-01',
    }),
    item('family', { kind: 'INCOME', dueDay: 1, startDate: '2026-12-01', fixedOutgoing: false }),
    item('emi', { dueDay: 5 }),
    item('card', { dueDay: 4, startDate: '2026-11-04' }),
    item('food', { dueDay: 1 }),
  ];
  const card: OccurrenceDto = {
    id: 'card-nov',
    recurringItemId: 'card',
    dueDate: '2026-11-04',
    expectedAmountPaise: rs(15_000),
    status: 'PAID',
    ...META,
  };
  return {
    today: '2026-11-05',
    months: 3,
    accounts: [account()],
    transactions: [],
    items,
    periods: [
      period('salary', 60_000),
      period('bonus', 20_000),
      period('family', 50_000, '2026-12-01'),
      period('emi', 4_000),
      period('card', 15_000, '2026-11-04'),
      period('food', 3_000),
    ],
    occurrences: [card],
    receivables: [
      {
        id: 'owed',
        kind: 'OWED_TO_ME',
        counterparty: 'A friend',
        amountPaise: rs(15_000),
        expectedDate: '2026-11-16',
        status: 'EXPECTED',
        ...META,
      } satisfies ReceivableDto,
    ],
    allocations: [
      {
        id: 'rule',
        recurringItemId: 'family',
        target: 'LOAN',
        loanId: 'loan',
        startMonth: '2026-12-01',
        endsWhenLoanCleared: true,
        priority: 100,
        ...META,
      } satisfies AllocationRuleDto,
    ],
    loans: [loan()],
    ledger: [],
    plannedPayments: [],
    goals: [
      {
        id: 'goal',
        name: 'Purchase',
        targetAmountPaise: rs(100_000),
        targetDate: '2026-11-20',
        status: 'ACTIVE',
        ...META,
      } satisfies GoalDto,
    ],
    contributions: [
      {
        id: 'mine',
        goalId: 'goal',
        contributor: 'Me',
        isSelf: true,
        amountPaise: rs(25_000),
        status: 'PLEDGED',
        ...META,
      } satisfies GoalContributionDto,
    ],
    ...overrides,
  };
}

describe('currentBalancePaise', () => {
  it('adds what was recorded on or after the day the balance was entered', () => {
    const balance = currentBalancePaise(
      [account()],
      [
        txn({ amountPaise: rs(500) }),
        txn({ type: 'INCOME', amountPaise: rs(200), occurredAt: '2026-11-03T08:00:00+05:30' }),
        txn({ amountPaise: rs(9_999), occurredAt: '2026-11-02T08:00:00+05:30' }),
      ],
    );
    expect(balance).toBe(rs(5_000 - 500 + 200));
  });

  it('skips ignored captures, cards, wallets that are archived and other accounts’ spending', () => {
    const balance = currentBalancePaise(
      [
        account(),
        account({ id: 'card', type: 'CREDIT_CARD', balancePaise: rs(50_000) }),
        account({ id: 'old', archived: true, balancePaise: rs(70_000) }),
      ],
      [txn({ status: 'IGNORED' }), txn({ accountId: 'card', amountPaise: rs(10) })],
    );
    expect(balance).toBe(rs(5_000));
  });

  it('moves money between accounts without changing the total', () => {
    const cash = account({ id: 'cash', type: 'CASH', balancePaise: 0, balanceAsOf: '2026-11-03' });
    const accounts = [account(), cash];
    const transfer = txn({ type: 'TRANSFER', accountId: 'bank', toAccountId: 'cash' });
    expect(currentBalancePaise(accounts, [transfer])).toBe(rs(5_000));
  });

  it('counts from the day the account was created when no balance date was set', () => {
    const balance = currentBalancePaise(
      [account({ balanceAsOf: null, createdAt: '2026-11-04T09:00:00+05:30' })],
      [txn({ occurredAt: '2026-11-03T09:00:00+05:30' }), txn({})],
    );
    expect(balance).toBe(rs(5_000 - 500));
  });
});

describe('pickSweepLoan', () => {
  it('prefers the chosen loan, then the active flexible loan costing most', () => {
    const cheap = loan({ id: 'cheap', annualRateBps: 500 });
    const dear = loan({ id: 'dear', annualRateBps: 1200 });
    expect(pickSweepLoan([cheap, dear])?.id).toBe('dear');
    expect(pickSweepLoan([cheap, dear], 'cheap')?.id).toBe('cheap');
  });

  it('ignores closed, fixed-instalment and cleared loans', () => {
    expect(
      pickSweepLoan([
        loan({ id: 'closed', status: 'CLOSED' }),
        loan({ id: 'emi', kind: 'EMI' }),
        loan({ id: 'cleared', outstandingPaise: 0 }),
        loan({ id: 'nobalance', outstandingPaise: null, annualRateBps: null }),
      ]),
    ).toBeNull();
  });

  it('ignores a chosen loan that is closed', () => {
    expect(pickSweepLoan([loan({ status: 'CLOSED' })], 'loan')).toBeNull();
  });
});

describe('buildPlanFromSnapshot', () => {
  it('builds this month from bills, receivables, the goal share and the balance', () => {
    const built = buildPlanFromSnapshot(snapshot());
    const nov = built.plan.months[0]!;
    expect(built.startMonth).toBe('2026-11-01');
    expect(nov.incomePaise).toBe(rs(80_000)); // salary + bonus
    expect(nov.fixedOutgoingsPaise).toBe(rs(7_000)); // the card bill is already paid
    expect(nov.oneOffsPaise).toBe(rs(25_000));
    expect(nov.receivablesPaise).toBe(rs(15_000));
    expect(nov.leftoverPaise).toBe(rs(68_000));
    expect(nov.loan).toMatchObject({ interestPaise: rs(3_750), closingPaise: rs(435_750) });
    expect(nov.sparePaise).toBe(0);
    expect(nov.flags).toEqual([]);
  });

  it('sends earmarked income to the loan once a rule says so', () => {
    const dec = buildPlanFromSnapshot(snapshot()).plan.months[1]!;
    expect(dec.earmarkedPaise).toBe(rs(50_000));
    expect(dec.allocations.toLoanPaise).toBe(rs(50_000));
    expect(dec.leftoverPaise).toBe(rs(38_000));
    expect(dec.availablePaise).toBe(rs(88_000));
  });

  it('asks where earmarked money should go when there is no rule', () => {
    const built = buildPlanFromSnapshot(snapshot({ allocations: [] }));
    expect(built.plan.pendingDecisions[0]).toMatchObject({
      month: '2026-12-01',
      streamId: 'family',
    });
    expect(built.plan.months[1]!.flags).toContain('PENDING_DECISION');
  });

  it('uses a manual payment for a month instead of everything available', () => {
    const built = buildPlanFromSnapshot(
      snapshot({
        plannedPayments: [
          { id: 'p', loanId: 'loan', month: '2026-11-01', amountPaise: rs(10_000), ...META },
        ],
      }),
    );
    const nov = built.plan.months[0]!;
    expect(nov.loanPaymentPaise).toBe(rs(10_000));
    expect(nov.sparePaise).toBe(rs(58_000));
  });

  it('starts the loan from the last recorded month', () => {
    const built = buildPlanFromSnapshot(
      snapshot({
        ledger: [
          {
            id: 'e1',
            loanId: 'loan',
            kind: 'PAYMENT',
            month: '2026-11-01',
            effectiveDate: '2026-11-04',
            amountPaise: rs(50_000),
            balanceAfterPaise: rs(453_750),
            ...META,
          },
        ],
      }),
    );
    expect(built.sweepState?.nextMonth).toBe('2026-12-01');
    expect(built.plan.months[0]!.loan).toBeNull();
    expect(built.plan.months[1]!.loan?.openingPaise).toBe(rs(453_750));
  });

  it('counts an overdue receivable in the first month and leaves received ones out', () => {
    const overdue: ReceivableDto = {
      id: 'late',
      kind: 'EXPECTED_INCOME',
      counterparty: 'A client',
      amountPaise: rs(9_000),
      expectedDate: '2026-10-20',
      status: 'EXPECTED',
      ...META,
    };
    const done: ReceivableDto = { ...overdue, id: 'done', status: 'RECEIVED' };
    const nov = buildPlanFromSnapshot(
      snapshot({ receivables: [...snapshot().receivables, overdue, done] }),
    ).plan.months[0]!;
    expect(nov.income.map((l) => l.id)).toContain('late');
    expect(nov.income.map((l) => l.id)).not.toContain('done');
  });

  it('plans a goal share in the goal’s month, or this month without a target date', () => {
    const later = buildPlanFromSnapshot(
      snapshot({
        goals: [{ ...snapshot().goals[0]!, targetDate: '2026-12-15' }],
      }),
    ).plan.months;
    expect(later[0]!.oneOffsPaise).toBe(0);
    expect(later[1]!.oneOffsPaise).toBe(rs(25_000));

    const undated = buildPlanFromSnapshot(
      snapshot({ goals: [{ ...snapshot().goals[0]!, targetDate: null }] }),
    ).plan.months[0]!;
    expect(undated.oneOffsPaise).toBe(rs(25_000));

    const past = buildPlanFromSnapshot(
      snapshot({ goals: [{ ...snapshot().goals[0]!, targetDate: '2026-09-01' }] }),
    ).plan.months[0]!;
    expect(past.oneOffsPaise).toBe(rs(25_000));
  });

  it('leaves out shares that are received, other people’s, or for a goal that is done', () => {
    const base = snapshot();
    const mine = base.contributions[0]!;
    for (const contributions of [
      [{ ...mine, status: 'RECEIVED' as const }],
      [{ ...mine, isSelf: false }],
      [{ ...mine, goalId: 'missing' }],
    ]) {
      expect(buildPlanFromSnapshot({ ...base, contributions }).plan.months[0]!.oneOffsPaise).toBe(
        0,
      );
    }
    const achieved = { ...base.goals[0]!, status: 'ACHIEVED' as const };
    expect(buildPlanFromSnapshot({ ...base, goals: [achieved] }).plan.months[0]!.oneOffsPaise).toBe(
      0,
    );
  });

  it('skips inactive bills and keeps optional loan and rule fields optional', () => {
    const base = snapshot();
    const built = buildPlanFromSnapshot({
      ...base,
      items: base.items.map((i) => (i.id === 'food' ? { ...i, active: false } : i)),
      allocations: [
        {
          ...base.allocations[0]!,
          target: 'RETURN_TO_SOURCE',
          loanId: null,
          endMonth: '2026-12-01',
        },
      ],
    });
    expect(built.plan.months[0]!.fixedOutgoingsPaise).toBe(rs(4_000));
    expect(built.plan.months[1]!.allocations.returnedPaise).toBe(rs(50_000));
  });

  it('plans without a loan when none is active', () => {
    const built = buildPlanFromSnapshot(snapshot({ loans: [], allocations: [] }));
    expect(built.sweepLoan).toBeNull();
    expect(built.plan.loan).toBeNull();
    expect(built.plan.months[0]!.sparePaise).toBe(rs(68_000));
  });

  it('warns about a loan with no balance, and about months not yet recorded', () => {
    const noBalance = buildPlanFromSnapshot(
      snapshot({ loans: [loan({ outstandingPaise: null, annualRateBps: 900, kind: 'EMI' })] }),
    );
    expect(noBalance.warnings).toEqual([]); // an EMI loan is not swept, so it is not a planning problem

    const stale = buildPlanFromSnapshot(
      snapshot({ loans: [loan({ outstandingAsOf: '2026-09-01' })] }),
    );
    expect(stale.warnings[0]).toContain('2026-09');

    const chosen = buildPlanFromSnapshot(
      snapshot({ loans: [loan({ outstandingPaise: null })], sweepLoanId: 'loan' }),
    );
    expect(chosen.warnings[0]).toContain('no balance');
  });

  it('flags a bill that falls due before the money to pay it arrives', () => {
    const built = buildPlanFromSnapshot(snapshot());
    expect(built.risks.map((r) => r.label)).toContain('emi');
    const safe = buildPlanFromSnapshot(
      snapshot({ accounts: [account({ balancePaise: rs(50_000) })] }),
    );
    expect(safe.risks).toEqual([]);
    const buffered = buildPlanFromSnapshot(
      snapshot({ accounts: [account({ balancePaise: rs(50_000) })], bufferPaise: rs(60_000) }),
    );
    expect(buffered.risks.length).toBeGreaterThan(0);
    expect(buffered.bufferPaise).toBe(rs(60_000));
    expect(safe.bufferPaise).toBe(0);
  });

  it('never starts from a negative balance', () => {
    const built = buildPlanFromSnapshot(
      snapshot({ accounts: [account({ balancePaise: 0 })], transactions: [txn({})] }),
    );
    expect(built.openingBalancePaise).toBe(0);
  });
});
