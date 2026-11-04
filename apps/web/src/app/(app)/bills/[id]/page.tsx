'use client';

import { formatDate, formatINR, isoDateIST } from '@zerodue/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ui } from '@/components/ui';
import { typedToPaise } from '@/lib/amount';
import { useRecurringItem } from '@/lib/queries';
import { deleteRecurringItem, saveRecord, setAmountFrom } from '@/lib/repo';

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const data = useRecurringItem(id);
  const [error, setError] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <main className={ui.page}>
        <p className={ui.muted} role="status">
          Loading…
        </p>
      </main>
    );
  }
  if (data === null) {
    return (
      <main className={ui.page}>
        <h1 className={ui.title}>Not found</h1>
        <Link href="/bills" className={ui.link}>
          Back to bills
        </Link>
      </main>
    );
  }
  const { item, periods } = data;

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const endDate = String(form.get('endDate') ?? '');
    if (!name) return setError('Give the bill a name.');
    await saveRecord('recurringItem', { ...item, name, endDate: endDate || null });
    setError(null);
  }

  async function changeAmount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountPaise = typedToPaise(String(form.get('amount') ?? '').replace(/[,₹\s]/g, ''));
    const from = String(form.get('from') ?? '');
    if (amountPaise < 1 || !from) return setError('Enter an amount and the date it starts from.');
    await setAmountFrom(id, from, amountPaise);
    setError(null);
    event.currentTarget.reset();
  }

  async function remove() {
    if (!window.confirm(`Delete "${item.name}" and its upcoming due dates?`)) return;
    await deleteRecurringItem(id);
    router.replace('/bills');
  }

  return (
    <main className={ui.page}>
      <header className="flex items-center justify-between">
        <h1 className={ui.title}>{item.name}</h1>
        <Link href="/bills" className={ui.link + ' min-h-12'}>
          Back
        </Link>
      </header>

      <section aria-label="Amounts" className={ui.card}>
        <h2 className="mb-2 font-medium">Amount</h2>
        <ul className="flex flex-col gap-1">
          {periods.map((p) => (
            <li key={p.id} className="flex justify-between">
              <span className={ui.muted}>
                From {formatDate(`${p.effectiveFrom}T12:00:00+05:30`)}
              </span>
              <span className="tabular-nums">{formatINR(p.amountPaise)}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={changeAmount} className="mt-4 flex flex-col gap-3" noValidate>
          <p className={ui.muted}>
            Change the amount from a date (for example when a bill drops after an EMI ends).
          </p>
          <label className={ui.label}>
            New amount (₹)
            <input name="amount" className={ui.input} inputMode="decimal" />
          </label>
          <label className={ui.label}>
            From
            <input
              name="from"
              className={ui.input}
              type="date"
              defaultValue={isoDateIST(new Date())}
            />
          </label>
          <button type="submit" className={ui.secondary}>
            Set new amount
          </button>
        </form>
      </section>

      <form onSubmit={saveDetails} className="flex flex-col gap-4" noValidate>
        <label className={ui.label}>
          Name
          <input name="name" className={ui.input} defaultValue={item.name} />
        </label>
        <label className={ui.label}>
          Ends (optional)
          <input
            name="endDate"
            className={ui.input}
            type="date"
            defaultValue={item.endDate ?? ''}
          />
        </label>
        <button type="submit" className={ui.primary}>
          Save
        </button>
      </form>

      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
      <button type="button" className={ui.danger} onClick={() => void remove()}>
        Delete bill
      </button>
    </main>
  );
}
