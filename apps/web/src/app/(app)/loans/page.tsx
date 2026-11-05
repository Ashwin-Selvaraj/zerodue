'use client';

import { formatINR } from '@zerodue/shared';
import Link from 'next/link';
import { ui } from '@/components/ui';
import { formatRate, monthLabel } from '@/lib/format';
import { useLoans } from '@/lib/queries';

export default function LoansPage() {
  const loans = useLoans();

  return (
    <main className={ui.page}>
      <header className="flex items-center justify-between">
        <h1 className={ui.title}>Loans</h1>
        <Link href="/loans/new" className={ui.primary + ' flex items-center'}>
          Add loan
        </Link>
      </header>

      {loans === undefined && (
        <p className={ui.muted} role="status">
          Loading…
        </p>
      )}
      {loans?.length === 0 && (
        <p className={ui.muted}>No loans yet. Add one to see its schedule and plan its payoff.</p>
      )}

      <ul className="flex flex-col gap-3">
        {loans?.map(({ loan, state }) => {
          const start = loan.originalPaise ?? loan.outstandingPaise ?? 0;
          const paid =
            start > 0 ? Math.min(100, Math.round(((start - state.openingPaise) * 100) / start)) : 0;
          return (
            <li key={loan.id}>
              <Link href={`/loans/${loan.id}`} className={ui.card + ' flex flex-col gap-2'}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{loan.name}</span>
                  <span className="rounded-full border border-slate-300 px-3 py-0.5 text-xs dark:border-slate-700">
                    {loan.status === 'CLOSED' ? 'Closed' : state.cleared ? 'Cleared' : 'Active'}
                  </span>
                </div>
                <p className="text-xl font-semibold">
                  {state.needsBalance ? 'Balance not entered' : formatINR(state.openingPaise)}
                </p>
                <p className={ui.muted}>
                  {loan.kind === 'EMI' ? 'Fixed EMI' : 'Flexible'} ·{' '}
                  {formatRate(loan.annualRateBps)} a year
                  {loan.status === 'ACTIVE' &&
                    !state.cleared &&
                    ` · next: ${monthLabel(state.nextMonth)}`}
                </p>
                {start > 0 && (
                  <div
                    role="progressbar"
                    aria-label="Repaid"
                    aria-valuenow={paid}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
                  >
                    <div
                      className="h-full rounded-full bg-teal-700 dark:bg-teal-500"
                      style={{ width: `${paid}%` }}
                    />
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
