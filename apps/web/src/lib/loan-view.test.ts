import type { LoanDto, PlannedPaymentDto } from '@zerodue/shared';
import { describe, expect, it } from 'vitest';
import { loanState } from './loan-state';
import { availabilityFor, baseProjection, scenarioOf } from './loan-view';
import type { BuiltPlan } from './plan-input';

const META = {
  version: 1,
  createdAt: '2026-11-01T00:00:00+05:30',
  updatedAt: '2026-11-01T00:00:00+05:30',
  editedAt: '2026-11-01T00:00:00+05:30',
  deletedAt: null,
  lastDeviceId: null,
};
const loan = (overrides: Partial<LoanDto> = {}): LoanDto => ({
  id: 'loan',
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
const manual = (month: string, amountPaise: number): PlannedPaymentDto => ({
  id: month,
  loanId: 'loan',
  month,
  amountPaise,
  ...META,
});

const built = (): BuiltPlan =>
  ({
    sweepLoan: loan(),
    plan: {
      months: [
        { month: '2026-11-01', loan: {}, loanPaymentPaise: 60_000_00, availablePaise: 60_000_00 },
        { month: '2026-12-01', loan: {}, loanPaymentPaise: 70_000_00, availablePaise: 70_000_00 },
        { month: '2027-01-01', loan: null, loanPaymentPaise: 0, availablePaise: 5_000_00 },
      ],
    },
  }) as unknown as BuiltPlan;

describe('baseProjection', () => {
  it('follows the plan for the loan it sweeps into, with manual payments taking priority', () => {
    const l = loan();
    const base = baseProjection(l, loanState(l, [], '2026-11-01'), built(), [
      manual('2026-12-01', 1_000_00),
    ]);
    expect(base).toMatchObject({
      openingBalancePaise: 500_000_00,
      firstMonth: '2026-11-01',
      annualRateBps: 900,
    });
    expect(base.payments.byMonth).toEqual({ '2026-11-01': 60_000_00, '2026-12-01': 1_000_00 });
    expect(base.payments.defaultPaymentPaise).toBeUndefined();
  });

  it('uses the fixed instalment for a loan the plan does not sweep into', () => {
    const l = loan({ kind: 'EMI', emiPaise: 4_000_00 });
    const other = { ...built(), sweepLoan: null } as unknown as BuiltPlan;
    const base = baseProjection(l, loanState(l, [], '2026-11-01'), other, []);
    expect(base.payments).toEqual({ byMonth: {}, defaultPaymentPaise: 4_000_00 });
  });

  it('works before the plan is ready', () => {
    const l = loan({ emiPaise: null });
    const base = baseProjection(l, loanState(l, [], '2026-11-01'), undefined, []);
    expect(base.payments.defaultPaymentPaise).toBeUndefined();
  });
});

describe('scenarioOf', () => {
  it('turns saved parameters into an engine scenario', () => {
    expect(
      scenarioOf(
        {
          extraPayments: [{ month: '2027-01-01', amountPaise: 1_00 }],
          monthlyPaymentPaise: 5_00,
          annualRateBps: 800,
          targetMonth: '2027-06-01',
        },
        'Plan B',
      ),
    ).toEqual({
      name: 'Plan B',
      extraPayments: [{ month: '2027-01-01', amountPaise: 1_00 }],
      monthlyPaymentPaise: 5_00,
      annualRateBps: 800,
      targetMonth: '2027-06-01',
    });
  });
  it('leaves unset options out', () => {
    const scenario = scenarioOf({
      extraPayments: [],
      monthlyPaymentPaise: null,
      annualRateBps: null,
    });
    expect(scenario.monthlyPaymentPaise).toBeUndefined();
    expect(scenario.annualRateBps).toBeUndefined();
    expect(scenario.targetMonth).toBeUndefined();
  });
});

describe('availabilityFor', () => {
  it('gives the plan’s monthly availability only for the swept loan', () => {
    expect(availabilityFor(built(), 'loan')).toEqual({
      '2026-11-01': 60_000_00,
      '2026-12-01': 70_000_00,
      '2027-01-01': 5_000_00,
    });
    expect(availabilityFor(built(), 'other')).toBeNull();
    expect(availabilityFor(undefined, 'loan')).toBeNull();
  });
});
