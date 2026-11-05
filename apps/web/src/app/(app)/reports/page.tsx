'use client';

import { addMonths, formatINR, monthKey, projectLoan } from '@zerodue/shared';
import { useMemo, useState } from 'react';
import { ColumnChart, Donut, LineChart } from '@/components/charts';
import { ui } from '@/components/ui';
import { monthLabel } from '@/lib/format';
import { baseProjection } from '@/lib/loan-view';
import { useCategories, useLoans, usePlan, useTransactionRange } from '@/lib/queries';
import { categoryBreakdown, loanBalanceSeries, monthlyTrend } from '@/lib/reports';

type View = 'category' | 'trend' | 'loans';

export default function ReportsPage() {
  const [view, setView] = useState<View>('category');
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const thisMonth = monthKey(new Date());
  const transactions = useTransactionRange(thisMonth, 12);
  const categories = useCategories();
  const loans = useLoans();
  const built = usePlan(60);
  const [loanId, setLoanId] = useState('');

  const inMonth = useMemo(
    () => (transactions ?? []).filter((t) => monthKey(t.occurredAt) === month),
    [transactions, month],
  );
  const slices = useMemo(() => categoryBreakdown(inMonth, categories ?? []), [inMonth, categories]);
  const trend = useMemo(
    () => monthlyTrend(transactions ?? [], thisMonth, 6),
    [transactions, thisMonth],
  );

  const chosen =
    loans?.find((l) => l.loan.id === loanId) ??
    loans?.find((l) => l.loan.status === 'ACTIVE') ??
    loans?.[0];
  const loanSeries = useMemo(() => {
    if (!chosen) return null;
    const base = baseProjection(chosen.loan, chosen.state, built, []);
    return loanBalanceSeries(chosen.state, projectLoan(base));
  }, [chosen, built]);

  return (
    <main className={ui.page}>
      <h1 className={ui.title}>Reports</h1>
      <div role="tablist" aria-label="Report" className="grid grid-cols-3 gap-2">
        {(
          [
            ['category', 'Category'],
            ['trend', 'Trend'],
            ['loans', 'Loans'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={`${ui.chip} ${view === key ? ui.chipOn : ui.chipOff}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'category' && (
        <section className={ui.card + ' flex flex-col gap-3'}>
          <div className="flex items-center justify-between">
            <button
              className={ui.secondary}
              aria-label="Previous month"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              ‹
            </button>
            <span className="font-medium">{monthLabel(month)}</span>
            <button
              className={ui.secondary}
              aria-label="Next month"
              disabled={month >= thisMonth}
              onClick={() => setMonth(addMonths(month, 1))}
            >
              ›
            </button>
          </div>
          <Donut title={`Spending in ${monthLabel(month)}`} slices={slices} />
        </section>
      )}

      {view === 'trend' && (
        <section className={ui.card}>
          <ColumnChart
            title="Income and spending, last 6 months"
            categories={trend.months.map((m) => monthLabel(m).slice(0, 3))}
            series={[
              { name: 'Income', slot: 1, values: trend.incomePaise },
              { name: 'Spent', slot: 2, values: trend.spentPaise },
            ]}
          />
          <p className={ui.muted + ' mt-2'}>
            Left over this month:{' '}
            {formatINR(Math.max(0, trend.incomePaise[5]! - trend.spentPaise[5]!))}
          </p>
        </section>
      )}

      {view === 'loans' && (
        <section className={ui.card + ' flex flex-col gap-3'}>
          {!chosen || !loanSeries ? (
            <p className={ui.muted}>No loans to chart.</p>
          ) : (
            <>
              {loans && loans.length > 1 && (
                <label className={ui.label}>
                  Loan
                  <select
                    className={ui.input}
                    value={chosen.loan.id}
                    onChange={(e) => setLoanId(e.target.value)}
                  >
                    {loans.map(({ loan }) => (
                      <option key={loan.id} value={loan.id}>
                        {loan.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <LineChart title={`${chosen.loan.name}: what you owe`} points={loanSeries} />
              <p className={ui.muted}>
                Paid so far {formatINR(chosen.state.paidToDatePaise)} · interest so far{' '}
                {formatINR(chosen.state.interestToDatePaise)}
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
