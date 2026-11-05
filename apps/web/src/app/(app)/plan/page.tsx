'use client';

import { formatDate, formatINR, formatINRSigned } from '@zerodue/shared';
import Link from 'next/link';
import { useState } from 'react';
import { ColumnChart } from '@/components/charts';
import { ui } from '@/components/ui';
import { typedToPaise } from '@/lib/amount';
import { writeMeta } from '@/lib/db';
import { monthLabel } from '@/lib/format';
import { BUFFER_KEY, SWEEP_LOAN_KEY, useLoans, usePlan } from '@/lib/queries';
import { addAllocation } from '@/lib/repo-planning';

const FLAG_TEXT = {
  SHORTFALL: 'Short this month',
  PENDING_DECISION: 'Needs a decision',
  OVERCOMMITTED: 'More than you have',
} as const;

export default function PlanPage() {
  const [months, setMonths] = useState(12);
  const built = usePlan(months);
  const loans = useLoans();

  if (!built) {
    return (
      <main className={ui.page}>
        <p className={ui.muted} role="status">
          Loading…
        </p>
      </main>
    );
  }
  const { plan, sweepLoan, risks, warnings, openingBalancePaise } = built;
  const candidates = (loans ?? []).filter(
    ({ loan }) => loan.status === 'ACTIVE' && loan.kind === 'FLEXIBLE',
  );
  // one question per money stream: a rule from the first month covers the months after it
  const decisions = plan.pendingDecisions.filter(
    (d, i, all) => all.findIndex((x) => x.streamId === d.streamId) === i,
  );

  async function decide(
    streamId: string,
    month: string,
    target: 'LOAN' | 'RETURN_TO_SOURCE' | 'UNALLOCATED',
  ) {
    await addAllocation({
      recurringItemId: streamId,
      target,
      loanId: target === 'LOAN' ? sweepLoan?.id : null,
      startMonth: month,
      endsWhenLoanCleared: true,
      priority: 100,
    });
  }

  return (
    <main className={ui.page}>
      <header className="flex items-center justify-between">
        <h1 className={ui.title}>Plan</h1>
        <label className="flex items-center gap-2 text-sm">
          Show
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="min-h-11 rounded-xl border border-slate-300 bg-transparent px-3 dark:border-slate-700"
          >
            {[6, 12, 18, 24].map((n) => (
              <option key={n} value={n}>
                {n} months
              </option>
            ))}
          </select>
        </label>
      </header>

      {warnings.map((w) => (
        <p key={w} className={ui.error} role="status">
          {w}
        </p>
      ))}

      <section aria-label="Summary" className={ui.card + ' flex flex-col gap-1'}>
        <p className={ui.muted}>In your accounts now</p>
        <p className="text-2xl font-semibold">{formatINR(openingBalancePaise)}</p>
        {sweepLoan && plan.loan && (
          <p className={ui.muted}>
            Spare money goes to{' '}
            <Link href={`/loans/${sweepLoan.id}`} className={ui.link}>
              {sweepLoan.name}
            </Link>
            :{' '}
            {plan.loan.payoffMonth
              ? `cleared ${monthLabel(plan.loan.payoffMonth)}, ${formatINR(plan.loan.totalInterestPaise)} interest`
              : `still ${formatINR(plan.loan.endingBalancePaise)} after ${months} months`}
            .
          </p>
        )}
        {!sweepLoan && <p className={ui.muted}>No loan to pay down. Spare money stays with you.</p>}
      </section>

      {decisions.map((d) => (
        <section
          key={d.streamId}
          aria-label="Decision"
          className={ui.card + ' flex flex-col gap-3'}
        >
          <p>
            Where should <strong>{d.label}</strong> ({formatINR(d.amountPaise)}) go from{' '}
            <strong>{monthLabel(d.month)}</strong>?
          </p>
          <div className="flex flex-wrap gap-2">
            {sweepLoan && (
              <button className={ui.primary} onClick={() => decide(d.streamId, d.month, 'LOAN')}>
                Pay down {sweepLoan.name}
              </button>
            )}
            <button
              className={ui.secondary}
              onClick={() => decide(d.streamId, d.month, 'RETURN_TO_SOURCE')}
            >
              Give it back
            </button>
            <button
              className={ui.secondary}
              onClick={() => decide(d.streamId, d.month, 'UNALLOCATED')}
            >
              Keep it aside
            </button>
          </div>
        </section>
      ))}

      {risks.length > 0 && (
        <section aria-label="Timing" className={ui.card + ' flex flex-col gap-2'}>
          <h2 className="font-medium">Timing risks</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {risks.slice(0, 5).map((r) => (
              <li key={`${r.date}-${r.label}`}>
                <strong>{formatDate(`${r.date}T12:00:00+05:30`)}</strong>: {r.label} would leave you{' '}
                {formatINR(r.shortfallPaise)} short.
              </li>
            ))}
          </ul>
          <p className={ui.muted}>
            These bills fall due before the money that covers them arrives.
          </p>
        </section>
      )}

      <section className={ui.card}>
        <ColumnChart
          title="Money free each month and what goes to the loan"
          categories={plan.months.map((m) => monthLabel(m.month).slice(0, 3))}
          series={[
            {
              name: 'Available',
              slot: 1,
              values: plan.months.map((m) => Math.max(0, m.availablePaise)),
            },
            { name: 'To loan', slot: 2, values: plan.months.map((m) => m.loanPaymentPaise) },
          ]}
        />
      </section>

      <section aria-label="Months" className="flex flex-col gap-3">
        {plan.months.map((m, index) => (
          <details key={m.month} open={index === 0} className={ui.card}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between">
              <span className="font-medium">{monthLabel(m.month)}</span>
              <span className="text-right text-sm tabular-nums">
                {formatINR(m.availablePaise)} free
                {sweepLoan && m.loan && <> · {formatINR(m.loanPaymentPaise)} to loan</>}
              </span>
            </summary>
            {m.flags.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-2">
                {m.flags.map((f) => (
                  <span
                    key={f}
                    className="rounded-full border border-red-300 px-3 py-0.5 text-xs text-red-700 dark:border-red-900 dark:text-red-300"
                  >
                    {FLAG_TEXT[f]}
                  </span>
                ))}
              </p>
            )}
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">{monthLabel(m.month)} step by step</caption>
              <tbody className="tabular-nums [&_td:not(:first-child)]:whitespace-nowrap [&_td:not(:first-child)]:pl-2">
                {m.steps.map((s, i) => (
                  <tr
                    key={`${s.label}-${i}`}
                    className="border-t border-slate-200 dark:border-slate-800"
                  >
                    <td className="py-2">{s.label}</td>
                    <td className="text-right">{formatINRSigned(s.deltaPaise)}</td>
                    <td className="w-24 text-right text-slate-600 dark:text-slate-400">
                      {formatINR(s.runningPaise)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-300 font-medium dark:border-slate-700">
                  <td className="py-2">Left over</td>
                  <td />
                  <td className="text-right">{formatINR(m.leftoverPaise)}</td>
                </tr>
                {m.allocations.toLoanPaise > 0 && (
                  <tr>
                    <td className="py-1">+ Set aside for the loan</td>
                    <td className="text-right">{formatINRSigned(m.allocations.toLoanPaise)}</td>
                    <td />
                  </tr>
                )}
                {m.earmarkedPaise > 0 && m.allocations.toLoanPaise === 0 && (
                  <tr>
                    <td className="py-1 text-slate-600 dark:text-slate-400" colSpan={3}>
                      {formatINR(m.earmarkedPaise)} arrives that isn’t yours to spend
                      {m.allocations.returnedPaise > 0 && ' (given back)'}
                      {m.allocations.heldPaise > 0 && ' (kept aside)'}.
                    </td>
                  </tr>
                )}
                {m.loan && (
                  <>
                    <tr className="border-t border-slate-200 dark:border-slate-800">
                      <td className="py-2">Loan interest</td>
                      <td className="text-right">{formatINR(m.loan.interestPaise)}</td>
                      <td />
                    </tr>
                    <tr>
                      <td className="py-2">Paid to loan</td>
                      <td className="text-right">{formatINR(m.loanPaymentPaise)}</td>
                      <td className="text-right text-slate-600 dark:text-slate-400">
                        {formatINR(m.loan.closingPaise)} left
                      </td>
                    </tr>
                  </>
                )}
                <tr className="border-t border-slate-300 font-medium dark:border-slate-700">
                  <td className="py-2">Spare</td>
                  <td />
                  <td className="text-right">{formatINR(m.sparePaise)}</td>
                </tr>
              </tbody>
            </table>
          </details>
        ))}
      </section>

      <section aria-label="Settings" className={ui.card + ' flex flex-col gap-3'}>
        <h2 className="font-medium">Plan settings</h2>
        {candidates.length > 1 && (
          <label className={ui.label}>
            Spare money goes to
            <select
              className={ui.input}
              value={sweepLoan?.id ?? ''}
              onChange={(e) => writeMeta(SWEEP_LOAN_KEY, e.target.value)}
            >
              {candidates.map(({ loan }) => (
                <option key={loan.id} value={loan.id}>
                  {loan.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={ui.label}>
          Keep at least (₹) in the account
          <input
            inputMode="decimal"
            className={ui.input}
            defaultValue={built.bufferPaise ? String(built.bufferPaise / 100) : ''}
            key={built.bufferPaise}
            placeholder="0"
            onBlur={(e) =>
              writeMeta(BUFFER_KEY, typedToPaise(e.target.value.replace(/[,₹\s]/g, '')))
            }
          />
          <span className={ui.muted}>
            Timing risks are flagged when the balance would drop below this.
          </span>
        </label>
        <Link href="/bills" className={ui.link}>
          Bills and due dates
        </Link>
      </section>
    </main>
  );
}
