'use client';

import { isoDateIST } from '@zerodue/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { ui } from '@/components/ui';
import { typedToPaise } from '@/lib/amount';
import { pickableCategories } from '@/lib/categories';
import { useAccounts, useCategories } from '@/lib/queries';
import { createRecurringItem } from '@/lib/repo';

const REMINDERS: Record<string, number[]> = { none: [], one: [1], two: [3, 1] };

export default function NewBillPage() {
  const router = useRouter();
  const categories = useCategories();
  const accounts = useAccounts();
  const [kind, setKind] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [frequency, setFrequency] = useState<'MONTHLY' | 'QUARTERLY' | 'ONE_TIME'>('MONTHLY');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = useMemo(() => pickableCategories(categories ?? [], kind), [categories, kind]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const amountPaise = typedToPaise(String(form.get('amount') ?? '').replace(/[,₹\s]/g, ''));
    const startDate = String(form.get('startDate') ?? '');
    const dueDay = Number(form.get('dueDay') || 0);
    const endDate = String(form.get('endDate') ?? '');

    if (!name) return setError('Give the bill a name.');
    if (amountPaise < 1) return setError('Enter the amount.');
    if (!startDate) return setError('Choose when it starts.');
    if (frequency !== 'ONE_TIME' && (dueDay < 1 || dueDay > 31))
      return setError('Due day must be between 1 and 31.');
    if (endDate && endDate < startDate) return setError('The end date is before the start date.');

    setBusy(true);
    setError(null);
    try {
      await createRecurringItem({
        kind,
        name,
        frequency,
        dueDay: frequency === 'ONE_TIME' ? null : dueDay,
        anchorMonth: undefined,
        startDate,
        endDate: endDate || null,
        categoryId: String(form.get('categoryId') ?? '') || null,
        accountId: String(form.get('accountId') ?? '') || null,
        reminderLeadDays: REMINDERS[String(form.get('reminder') ?? 'none')] ?? [],
        amountPaise,
      } as Parameters<typeof createRecurringItem>[0]);
      router.replace('/bills');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <main className={ui.page}>
      <header className="flex items-center justify-between">
        <h1 className={ui.title}>Add bill</h1>
        <Link href="/bills" className={ui.link + ' min-h-12'}>
          Cancel
        </Link>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <label className={ui.label}>
          Name
          <input name="name" className={ui.input} placeholder="Personal loan EMI" required />
        </label>
        <label className={ui.label}>
          Type
          <select
            className={ui.input}
            value={kind}
            onChange={(e) => setKind(e.target.value as 'EXPENSE' | 'INCOME')}
          >
            <option value="EXPENSE">Bill or payment (money out)</option>
            <option value="INCOME">Regular income (money in)</option>
          </select>
        </label>
        <label className={ui.label}>
          Amount (₹)
          <input
            name="amount"
            className={ui.input}
            inputMode="decimal"
            placeholder="4500"
            required
          />
        </label>
        <label className={ui.label}>
          How often
          <select
            className={ui.input}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          >
            <option value="MONTHLY">Every month</option>
            <option value="QUARTERLY">Every 3 months</option>
            <option value="ONE_TIME">Once</option>
          </select>
        </label>
        {frequency !== 'ONE_TIME' && (
          <label className={ui.label}>
            Due on day of month
            <input
              name="dueDay"
              className={ui.input}
              type="number"
              min={1}
              max={31}
              placeholder="5"
            />
          </label>
        )}
        <label className={ui.label}>
          {frequency === 'ONE_TIME' ? 'Date' : 'Starts'}
          <input
            name="startDate"
            className={ui.input}
            type="date"
            defaultValue={isoDateIST(new Date())}
            required
          />
        </label>
        {frequency !== 'ONE_TIME' && (
          <label className={ui.label}>
            Ends (optional)
            <input name="endDate" className={ui.input} type="date" />
          </label>
        )}
        <label className={ui.label}>
          Category
          <select name="categoryId" className={ui.input} defaultValue="">
            <option value="">None</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Paid from
          <select name="accountId" className={ui.input} defaultValue="">
            <option value="">Not set</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          Remind me
          <select name="reminder" className={ui.input} defaultValue="none">
            <option value="none">No reminder</option>
            <option value="one">1 day before</option>
            <option value="two">3 days and 1 day before</option>
          </select>
        </label>

        {error && (
          <p role="alert" className={ui.error}>
            {error}
          </p>
        )}
        <button type="submit" className={ui.primary} disabled={busy}>
          {busy ? 'Saving…' : 'Save bill'}
        </button>
      </form>
    </main>
  );
}
