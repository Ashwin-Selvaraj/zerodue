'use client';

import { formatDate, formatINR, isoDateIST } from '@zerodue/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ui } from '@/components/ui';
import { useAccounts, useOccurrences, useRecurringItems } from '@/lib/queries';
import { markOccurrencePaid, skipOccurrence, unmarkOccurrence } from '@/lib/repo';

const day = (iso: string) => formatDate(`${iso}T12:00:00+05:30`);

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type Row = NonNullable<ReturnType<typeof useOccurrences>>[number];

export default function BillsPage() {
  const occurrences = useOccurrences();
  const items = useRecurringItems();
  const accounts = useAccounts();
  const today = isoDateIST(new Date());
  const [recordPayment, setRecordPayment] = useState(true);

  useEffect(() => {
    try {
      setRecordPayment(localStorage.getItem('zd.recordPayment') !== 'false');
    } catch {
      /* storage blocked: keep the default */
    }
  }, []);

  const rows = occurrences ?? [];
  const overdue = rows.filter((o) => o.status === 'UPCOMING' && o.dueDate < today);
  const soon = rows.filter(
    (o) => o.status === 'UPCOMING' && o.dueDate >= today && o.dueDate <= addDays(today, 14),
  );
  const later = rows.filter((o) => o.status === 'UPCOMING' && o.dueDate > addDays(today, 14));
  const paid = rows
    .filter((o) => o.status === 'PAID' && o.dueDate >= addDays(today, -60))
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));

  async function pay(row: Row) {
    const item = items?.find((i) => i.id === row.recurringItemId);
    await markOccurrencePaid(row.id, {
      createTransaction: recordPayment,
      accountId: item?.accountId ?? accounts?.[0]?.id,
    });
  }

  function section(title: string, list: Row[], tone = '') {
    if (list.length === 0) return null;
    return (
      <section aria-label={title}>
        <h2 className={`mb-1 font-medium ${tone}`}>{title}</h2>
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {list.map((o) => (
            <li key={o.id} className="flex min-h-16 items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{o.name}</span>
                <span className={ui.muted}>
                  {day(o.dueDate)} ·{' '}
                  {formatINR(
                    o.status === 'PAID'
                      ? (o.paidAmountPaise ?? o.expectedAmountPaise)
                      : o.expectedAmountPaise,
                  )}
                </span>
              </span>
              {o.status === 'UPCOMING' ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    className={ui.link + ' min-h-12 px-2'}
                    onClick={() => void skipOccurrence(o.id)}
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    className={ui.primary + ' !px-3'}
                    onClick={() => void pay(o)}
                    aria-label={`Mark ${o.name} paid`}
                  >
                    {o.kind === 'INCOME' ? 'Received' : 'Paid'}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className={ui.link + ' min-h-12'}
                  onClick={() => void unmarkOccurrence(o.id)}
                  aria-label={`Undo ${o.name}`}
                >
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const nothing = overdue.length + soon.length + later.length + paid.length === 0;

  return (
    <main className={ui.page}>
      <header className="flex items-center justify-between">
        <h1 className={ui.title}>Bills</h1>
        <Link href="/bills/new" className={ui.primary + ' flex items-center'}>
          Add bill
        </Link>
      </header>

      <label className="flex min-h-12 items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={recordPayment}
          onChange={(e) => {
            setRecordPayment(e.target.checked);
            try {
              localStorage.setItem('zd.recordPayment', String(e.target.checked));
            } catch {
              /* ignore */
            }
          }}
        />
        Also record a transaction when I mark a bill paid
      </label>

      {occurrences === undefined ? (
        <p className={ui.muted} role="status">
          Loading…
        </p>
      ) : nothing ? (
        <div className={ui.card + ' text-center'}>
          <p className={ui.muted}>
            {items && items.length > 0
              ? 'Due dates appear after the next sync. Connect to the internet once.'
              : 'No bills yet. Add your EMIs, card bill and other regular payments.'}
          </p>
        </div>
      ) : (
        <>
          {section('Overdue', overdue, 'text-red-700 dark:text-red-400')}
          {section('Due soon', soon)}
          {section('Later', later)}
          {section('Paid', paid)}
        </>
      )}

      {items && items.length > 0 && (
        <section aria-label="Your bills">
          <h2 className="mb-1 font-medium">Your bills</h2>
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/bills/${item.id}`}
                  className="flex min-h-14 items-center justify-between px-4 py-2"
                >
                  <span>{item.name}</span>
                  <span className={ui.muted}>{item.frequency.toLowerCase().replace('_', '-')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
