import type { CategoryDto, Projection, TransactionDto } from '@zerodue/shared';
import { describe, expect, it } from 'vitest';
import type { LoanState } from './loan-state';
import { categoryBreakdown, loanBalanceSeries, monthlyTrend, monthTotals } from './reports';

const META = {
  version: 1,
  createdAt: '2026-11-01T00:00:00+05:30',
  updatedAt: '2026-11-01T00:00:00+05:30',
  editedAt: '2026-11-01T00:00:00+05:30',
  deletedAt: null,
  lastDeviceId: null,
};
const txn = (overrides: Partial<TransactionDto>): TransactionDto => ({
  id: crypto.randomUUID(),
  type: 'EXPENSE',
  status: 'POSTED',
  amountPaise: 100_00,
  accountId: 'a',
  categoryId: 'food',
  occurredAt: '2026-11-03T10:00:00+05:30',
  tags: [],
  source: 'MANUAL',
  occurrenceId: null,
  ...META,
  ...overrides,
});
const category = (id: string, name: string): CategoryDto => ({
  id,
  name,
  kind: 'EXPENSE',
  sortOrder: 0,
  quickPick: false,
  ...META,
});

describe('monthTotals', () => {
  it('adds income and spending, ignoring transfers and ignored captures', () => {
    expect(
      monthTotals([
        txn({ type: 'INCOME', amountPaise: 1_000_00 }),
        txn({ amountPaise: 300_00 }),
        txn({ amountPaise: 50_00, categoryId: null }),
        txn({ type: 'TRANSFER', amountPaise: 9_999_00, categoryId: null, toAccountId: 'b' }),
        txn({ status: 'IGNORED', amountPaise: 7_777_00, categoryId: null }),
      ]),
    ).toEqual({ incomePaise: 1_000_00, spentPaise: 350_00, uncategorised: 1 });
  });
});

describe('categoryBreakdown', () => {
  const categories = [category('food', 'Food'), category('fuel', 'Fuel')];

  it('totals expenses by category, biggest first', () => {
    expect(
      categoryBreakdown(
        [
          txn({ amountPaise: 100_00 }),
          txn({ amountPaise: 300_00, categoryId: 'fuel' }),
          txn({ amountPaise: 50_00, categoryId: 'food' }),
          txn({ amountPaise: 20_00, categoryId: null }),
          txn({ type: 'INCOME', amountPaise: 99_999_00 }),
          txn({ status: 'IGNORED', amountPaise: 99_999_00 }),
        ],
        categories,
      ),
    ).toEqual([
      { label: 'Fuel', valuePaise: 300_00 },
      { label: 'Food', valuePaise: 150_00 },
      { label: 'Uncategorised', valuePaise: 20_00 },
    ]);
  });

  it('names a category the device doesn’t know as uncategorised', () => {
    expect(categoryBreakdown([txn({ categoryId: 'gone' })], categories)).toEqual([
      { label: 'Uncategorised', valuePaise: 100_00 },
    ]);
  });

  it('folds the smallest into Other beyond the limit, and breaks ties by name', () => {
    const many = Array.from({ length: 8 }, (_, i) => category(`c${i}`, `Cat ${i}`));
    const slices = categoryBreakdown(
      many.map((c, i) => txn({ categoryId: c.id, amountPaise: (10 - i) * 100_00 })),
      many,
      3,
    );
    expect(slices.map((s) => s.label)).toEqual(['Cat 0', 'Cat 1', 'Cat 2', 'Other']);
    expect(slices[3]!.valuePaise).toBe((7 + 6 + 5 + 4 + 3) * 100_00);

    const tied = categoryBreakdown(
      [txn({ categoryId: 'fuel' }), txn({ categoryId: 'food' })],
      categories,
    );
    expect(tied.map((s) => s.label)).toEqual(['Food', 'Fuel']);
  });

  it('does not fold a single leftover category', () => {
    const many = Array.from({ length: 3 }, (_, i) => category(`c${i}`, `Cat ${i}`));
    const slices = categoryBreakdown(
      many.map((c, i) => txn({ categoryId: c.id, amountPaise: (3 - i) * 100_00 })),
      many,
      2,
    );
    expect(slices.map((s) => s.label)).toEqual(['Cat 0', 'Cat 1', 'Cat 2']);
  });
});

describe('monthlyTrend', () => {
  it('lists the months ending at the given one with income and spending in each', () => {
    const trend = monthlyTrend(
      [
        txn({ type: 'INCOME', amountPaise: 500_00, occurredAt: '2026-10-31T23:30:00+05:30' }),
        txn({ amountPaise: 200_00, occurredAt: '2026-11-01T00:30:00+05:30' }),
        txn({ amountPaise: 40_00, occurredAt: '2026-08-01T00:30:00+05:30' }),
        txn({ amountPaise: 9_999_00, occurredAt: '2026-11-02T00:30:00+05:30', status: 'IGNORED' }),
        txn({ type: 'TRANSFER', amountPaise: 8_888_00, occurredAt: '2026-11-02T00:30:00+05:30' }),
      ],
      '2026-11-01',
      3,
    );
    expect(trend.months).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    expect(trend.incomePaise).toEqual([0, 500_00, 0]);
    expect(trend.spentPaise).toEqual([0, 0, 200_00]);
  });
});

describe('loanBalanceSeries', () => {
  const projection = (rows: { month: string; closingPaise: number }[]) =>
    ({ rows }) as unknown as Projection;
  const state = (actual: LoanState['actual']) =>
    ({ actual, nextMonth: '2026-12-01', openingPaise: 80_000_00 }) as unknown as LoanState;

  it('joins what happened to what is expected at the last recorded month', () => {
    const points = loanBalanceSeries(
      state([
        {
          month: '2026-10-01',
          openingPaise: 100_000_00,
          interestPaise: 0,
          paymentPaise: 0,
          closingPaise: 90_000_00,
        },
        {
          month: '2026-11-01',
          openingPaise: 90_000_00,
          interestPaise: 0,
          paymentPaise: 0,
          closingPaise: 80_000_00,
        },
      ]),
      projection([
        { month: '2026-12-01', closingPaise: 60_000_00 },
        { month: '2027-01-01', closingPaise: 0 },
      ]),
    );
    expect(points).toEqual([
      { label: 'Oct', actual: 100_000_00 },
      { label: 'Oct', actual: 90_000_00 },
      { label: 'Nov', actual: 80_000_00, projected: 80_000_00 },
      { label: 'Dec', projected: 60_000_00 },
      { label: 'Jan', projected: 0 },
    ]);
  });

  it('starts from the balance entered when nothing is recorded yet', () => {
    const points = loanBalanceSeries(
      state([]),
      projection([{ month: '2026-12-01', closingPaise: 0 }]),
    );
    expect(points).toEqual([
      { label: 'Dec', projected: 80_000_00 },
      { label: 'Dec', projected: 0 },
    ]);
  });
});
