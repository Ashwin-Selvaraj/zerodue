import {
  addMonths,
  monthKey,
  type CategoryDto,
  type MonthKey,
  type Projection,
  type TransactionDto,
} from '@zerodue/shared';
import type { LinePoint, DonutSlice } from '@/components/charts';
import type { LoanState } from './loan-state';
import { monthLabel } from './format';

export interface MonthTotals {
  incomePaise: number;
  spentPaise: number;
  uncategorised: number;
}

/** What came in and went out; transfers between your own accounts are neither. */
export function monthTotals(transactions: TransactionDto[]): MonthTotals {
  const totals: MonthTotals = { incomePaise: 0, spentPaise: 0, uncategorised: 0 };
  for (const t of transactions) {
    if (t.status === 'IGNORED') continue;
    if (t.type === 'INCOME') totals.incomePaise += t.amountPaise;
    if (t.type === 'EXPENSE') totals.spentPaise += t.amountPaise;
    if (t.type !== 'TRANSFER' && !t.categoryId) totals.uncategorised++;
  }
  return totals;
}

/** Spending by category, biggest first: the top `max` as they are and the rest as "Other". */
export function categoryBreakdown(
  transactions: TransactionDto[],
  categories: CategoryDto[],
  max = 5,
): DonutSlice[] {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== 'EXPENSE' || t.status === 'IGNORED') continue;
    const label = (t.categoryId && names.get(t.categoryId)) || 'Uncategorised';
    totals.set(label, (totals.get(label) ?? 0) + t.amountPaise);
  }
  const ranked = [...totals]
    .map(([label, valuePaise]) => ({ label, valuePaise }))
    .sort((a, b) => b.valuePaise - a.valuePaise || a.label.localeCompare(b.label));
  if (ranked.length <= max + 1) return ranked;
  const rest = ranked.slice(max);
  return [
    ...ranked.slice(0, max),
    { label: 'Other', valuePaise: rest.reduce((sum, s) => sum + s.valuePaise, 0) },
  ];
}

export interface Trend {
  months: MonthKey[];
  incomePaise: number[];
  spentPaise: number[];
}

/** The `count` months ending at `endMonth`, with income and spending in each. */
export function monthlyTrend(transactions: TransactionDto[], endMonth: MonthKey, count = 6): Trend {
  const months = Array.from({ length: count }, (_, i) => addMonths(endMonth, i - count + 1));
  const index = new Map(months.map((m, i) => [m, i]));
  const incomePaise = months.map(() => 0);
  const spentPaise = months.map(() => 0);
  for (const t of transactions) {
    const i = index.get(monthKey(t.occurredAt));
    if (i === undefined || t.status === 'IGNORED') continue;
    if (t.type === 'INCOME') incomePaise[i]! += t.amountPaise;
    if (t.type === 'EXPENSE') spentPaise[i]! += t.amountPaise;
  }
  return { months, incomePaise, spentPaise };
}

/** What you owed after each recorded month (solid) and what is expected from here (dashed). */
export function loanBalanceSeries(state: LoanState, projection: Projection): LinePoint[] {
  const first = state.actual[0];
  const points: LinePoint[] = [];
  if (first)
    points.push({ label: monthLabel(first.month).slice(0, 3), actual: first.openingPaise });
  for (const m of state.actual) {
    points.push({ label: monthLabel(m.month).slice(0, 3), actual: m.closingPaise });
  }
  const join = points[points.length - 1];
  if (join) join.projected = join.actual;
  else
    points.push({ label: monthLabel(state.nextMonth).slice(0, 3), projected: state.openingPaise });
  for (const row of projection.rows) {
    points.push({ label: monthLabel(row.month).slice(0, 3), projected: row.closingPaise });
  }
  return points;
}
