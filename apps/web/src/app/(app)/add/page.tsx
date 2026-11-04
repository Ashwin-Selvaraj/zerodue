'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { chip, ui } from '@/components/ui';
import { displayTyped, pressKey, typedToPaise } from '@/lib/amount';
import { pickableCategories } from '@/lib/categories';
import { readMeta, writeMeta } from '@/lib/db';
import { useAccounts, useCategories } from '@/lib/queries';
import { addTransaction } from '@/lib/repo';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

/** Quick Add: amount on a keypad, one tap for the category, Save. Works offline. */
export default function QuickAddPage() {
  const router = useRouter();
  const categories = useCategories();
  const accounts = useAccounts();

  const [type, setType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [typed, setTyped] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = useMemo(() => pickableCategories(categories ?? [], type), [categories, type]);

  // Suggest the account and category you used last time.
  useEffect(() => {
    if (accountId || !accounts?.length) return;
    void readMeta<string>('lastAccount').then((last) => {
      setAccountId(accounts.some((a) => a.id === last) ? (last as string) : accounts[0]!.id);
    });
  }, [accounts, accountId]);

  useEffect(() => {
    setCategoryId('');
    void readMeta<string>(`lastCategory:${type}`).then((last) => {
      if (last && choices.some((c) => c.id === last)) setCategoryId(last);
    });
    // choices is intentionally not a dependency: only re-suggest when the type changes or categories first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, categories !== undefined]);

  const amountPaise = typedToPaise(typed);

  async function save() {
    if (amountPaise < 1 || !accountId) return;
    setSaving(true);
    setError(null);
    try {
      await addTransaction({
        type,
        amountPaise,
        accountId,
        categoryId: categoryId || null,
        occurredAt: when ? new Date(when).toISOString() : new Date().toISOString(),
        merchant: merchant.trim() || null,
        note: note.trim() || null,
      });
      await writeMeta('lastAccount', accountId);
      if (categoryId) await writeMeta(`lastCategory:${type}`, categoryId);
      router.replace('/transactions');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-4 pb-6 pt-4">
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          className="min-h-12 min-w-12 text-xl"
          aria-label="Close"
        >
          ✕
        </button>
        <div role="group" aria-label="Type" className="flex gap-2">
          <button
            type="button"
            aria-pressed={type === 'EXPENSE'}
            className={chip(type === 'EXPENSE')}
            onClick={() => setType('EXPENSE')}
          >
            Expense
          </button>
          <button
            type="button"
            aria-pressed={type === 'INCOME'}
            className={chip(type === 'INCOME')}
            onClick={() => setType('INCOME')}
          >
            Income
          </button>
        </div>
      </header>

      <p
        className="text-center text-5xl font-semibold tabular-nums"
        aria-live="polite"
        aria-label={`Amount ${displayTyped(typed)} rupees`}
      >
        <span className="text-slate-500">₹</span>
        {displayTyped(typed)}
      </p>

      <section aria-label="Category">
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={categoryId === c.id}
              className={chip(categoryId === c.id)}
              onClick={() => setCategoryId(categoryId === c.id ? '' : c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </section>

      <label className={ui.label}>
        Account
        <select
          className={ui.input}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={ui.link + ' self-start'}
        onClick={() => setShowMore(!showMore)}
        aria-expanded={showMore}
      >
        {showMore ? 'Fewer details' : 'Add details'}
      </button>
      {showMore && (
        <div className="flex flex-col gap-3">
          <label className={ui.label}>
            Merchant or payee
            <input
              className={ui.input}
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </label>
          <label className={ui.label}>
            Note
            <input className={ui.input} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className={ui.label}>
            Date and time (default: now)
            <input
              className={ui.input}
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
        </div>
      )}

      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}

      <div className="mt-auto grid grid-cols-3 gap-2" role="group" aria-label="Keypad">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTyped(pressKey(typed, key))}
            aria-label={key === '⌫' ? 'Delete' : key === '.' ? 'Decimal point' : key}
            className="min-h-14 rounded-xl border border-slate-200 text-2xl active:bg-slate-100 dark:border-slate-800 dark:active:bg-slate-900"
          >
            {key}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={ui.primary}
        disabled={amountPaise < 1 || !accountId || saving}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </main>
  );
}
