'use client';

import {
  APP_NAME,
  APP_TAGLINE,
  formatDate,
  formatINR,
  isoDateIST,
  monthKey,
} from '@zerodue/shared';
import Link from 'next/link';
import { ui } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useOccurrences, useTransactions } from '@/lib/queries';

/** Home: this month at a glance, from data on this device. (The full dashboard arrives in M4.) */
export default function HomePage() {
  const { user } = useAuth();
  const month = monthKey(new Date());
  const transactions = useTransactions(month);
  const occurrences = useOccurrences();
  const today = isoDateIST(new Date());

  let income = 0;
  let spent = 0;
  let uncategorised = 0;
  for (const t of transactions ?? []) {
    if (t.type === 'INCOME') income += t.amountPaise;
    if (t.type === 'EXPENSE') spent += t.amountPaise;
    if (t.type !== 'TRANSFER' && !t.categoryId) uncategorised++;
  }
  const upcoming = (occurrences ?? []).filter((o) => o.status === 'UPCOMING').slice(0, 4);

  return (
    <main className={ui.page}>
      <header>
        <h1 className={ui.title}>{APP_NAME}</h1>
        <p className={ui.muted}>{APP_TAGLINE}</p>
        {user && <p className={ui.muted}>Hello, {user.name ?? user.email}</p>}
      </header>

      <section aria-label="This month" className="grid grid-cols-2 gap-3">
        <div className={ui.card}>
          <p className={ui.muted}>Income</p>
          <p className="text-lg font-semibold">{formatINR(income)}</p>
        </div>
        <div className={ui.card}>
          <p className={ui.muted}>Spent</p>
          <p className="text-lg font-semibold">{formatINR(spent)}</p>
        </div>
        <div className={ui.card + ' col-span-2'}>
          <p className={ui.muted}>Left this month</p>
          <p className="text-2xl font-semibold">
            {formatINR(income - spent < 0 ? 0 : income - spent)}
          </p>
        </div>
      </section>

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

      <Link href="/add" className={ui.primary + ' flex items-center justify-center'}>
        Add transaction
      </Link>
    </main>
  );
}
