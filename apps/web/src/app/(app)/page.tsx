'use client';

import {
  addMonths,
  APP_NAME,
  APP_TAGLINE,
  formatDate,
  formatINR,
  goalProgress,
  isoDateIST,
  monthKey,
} from '@zerodue/shared';
import Link from 'next/link';
import { RemindersCard } from '@/components/reminders-card';
import { ui } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { monthLabel } from '@/lib/format';
import { useGoals, useOccurrences, usePlan, useTransactions } from '@/lib/queries';
import { monthTotals } from '@/lib/reports';

/** Home: this month at a glance, the loan being paid down, the goal, and what needs attention. */
export default function HomePage() {
  const { user } = useAuth();
  const month = monthKey(new Date());
  const transactions = useTransactions(month);
  const occurrences = useOccurrences();
  const built = usePlan(12);
  const goals = useGoals();
  const today = isoDateIST(new Date());

  const { incomePaise, spentPaise, uncategorised } = monthTotals(transactions ?? []);
  const upcoming = (occurrences ?? []).filter((o) => o.status === 'UPCOMING').slice(0, 4);
  const thisMonth = built?.plan.months[0];
  const loan = built?.sweepLoan;
  const goal = goals?.find((g) => g.goal.status === 'ACTIVE');
  const progress = goal && goalProgress(goal.goal.targetAmountPaise, goal.contributions);
  const attention = [
    ...(built?.plan.pendingDecisions.some((d) => d.month <= addMonths(month, 2))
      ? [{ text: 'Money is coming soon with no plan for it.', href: '/plan' }]
      : []),
    ...(built?.risks.length
      ? [{ text: 'A bill falls due before the money to pay it.', href: '/plan' }]
      : []),
    ...(built?.warnings.map((text) => ({ text, href: '/loans' })) ?? []),
  ];

  return (
    <main className={ui.page}>
      <header>
        <h1 className={ui.title}>{APP_NAME}</h1>
        <p className={ui.muted}>{APP_TAGLINE}</p>
        {user && <p className={ui.muted}>Hello, {user.name ?? user.email}</p>}
      </header>

      {attention.map((a) => (
        <Link key={a.text} href={a.href} className={ui.error}>
          {a.text} <span className="underline">Look</span>
        </Link>
      ))}

      <RemindersCard />

      <section aria-label="This month" className="grid grid-cols-2 gap-3">
        <div className={ui.card}>
          <p className={ui.muted}>Income</p>
          <p className="text-lg font-semibold">{formatINR(incomePaise)}</p>
        </div>
        <div className={ui.card}>
          <p className={ui.muted}>Spent</p>
          <p className="text-lg font-semibold">{formatINR(spentPaise)}</p>
        </div>
      </section>

      {thisMonth && (
        <Link
          href="/plan"
          className={ui.card + ' flex flex-col gap-1'}
          aria-label="Plan for this month"
        >
          <p className={ui.muted}>
            {monthLabel(month)}: free after bills{loan && thisMonth.loan ? ` → ${loan.name}` : ''}
          </p>
          <p className="text-3xl font-semibold">{formatINR(thisMonth.availablePaise)}</p>
          {thisMonth.loan && (
            <p className={ui.muted}>
              {formatINR(thisMonth.loanPaymentPaise)} goes to the loan ·{' '}
              {formatINR(thisMonth.sparePaise)} spare
            </p>
          )}
        </Link>
      )}

      {uncategorised > 0 && (
        <Link href="/transactions" className={ui.card + ' flex items-center justify-between'}>
          <span>
            {uncategorised} uncategorised transaction{uncategorised > 1 ? 's' : ''}
          </span>
          <span className={ui.link}>Review</span>
        </Link>
      )}

      <section aria-label="Upcoming">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">Upcoming dues</h2>
          <Link href="/bills" className={ui.link}>
            All bills
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className={ui.muted}>Nothing due. Add your bills under Bills.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {upcoming.map((o) => (
              <li key={o.id} className="flex min-h-14 items-center justify-between px-4 py-2">
                <span>
                  <span className="block font-medium">{o.name}</span>
                  <span className={ui.muted + (o.dueDate < today ? ' !text-red-700' : '')}>
                    {o.dueDate < today ? 'Overdue · ' : ''}
                    {formatDate(o.dueDate + 'T12:00:00+05:30')}
                  </span>
                </span>
                <span className="tabular-nums">{formatINR(o.expectedAmountPaise)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loan && built?.sweepState && built.plan.loan && (
        <Link href={`/loans/${loan.id}`} className={ui.card + ' flex flex-col gap-1'}>
          <p className={ui.muted}>{loan.name}</p>
          <p className="text-2xl font-semibold">{formatINR(built.sweepState.openingPaise)}</p>
          <p className={ui.muted}>
            {built.plan.loan.payoffMonth
              ? `Clears ${monthLabel(built.plan.loan.payoffMonth)} at the current pace`
              : 'Not cleared within the next year'}
            {' · '}interest so far {formatINR(built.sweepState.interestToDatePaise)}
          </p>
        </Link>
      )}

      {goal && progress && (
        <Link href="/goals" className={ui.card + ' flex flex-col gap-2'}>
          <div className="flex items-center justify-between">
            <span className="font-medium">{goal.goal.name}</span>
            <span className="tabular-nums">
              {formatINR(progress.fundedPaise)} / {formatINR(progress.targetPaise)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Funded"
            aria-valuenow={progress.percentFunded}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          >
            <div
              className="h-full rounded-full bg-teal-700 dark:bg-teal-500"
              style={{ width: `${progress.percentFunded}%` }}
            />
          </div>
          <p className={ui.muted}>
            {progress.gapPaise > 0
              ? `Still needed ${formatINR(progress.gapPaise)}`
              : 'Fully funded'}
          </p>
        </Link>
      )}

      <Link href="/add" className={ui.primary + ' flex items-center justify-center'}>
        Add transaction
      </Link>
    </main>
  );
}
