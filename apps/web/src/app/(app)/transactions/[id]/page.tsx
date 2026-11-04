'use client';

import { formatINR, toRupees } from '@zerodue/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ui } from '@/components/ui';
import { typedToPaise } from '@/lib/amount';
import { pickableCategories } from '@/lib/categories';
import { useAccounts, useCategories, useTransaction } from '@/lib/queries';
import { deleteTransaction, updateTransaction } from '@/lib/repo';

/** `datetime-local` wants the browser's local time without a zone. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export default function EditTransactionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const transaction = useTransaction(id);
  const categories = useCategories();
  const accounts = useAccounts();

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Fill the form once the record has loaded (and not again, so typing isn't overwritten by a sync).
  useEffect(() => {
    if (!transaction || ready) return;
    setAmount(String(toRupees(transaction.amountPaise)));
    setCategoryId(transaction.categoryId ?? '');
    setAccountId(transaction.accountId);
    setMerchant(transaction.merchant ?? '');
    setNote(transaction.note ?? '');
    setWhen(toLocalInput(transaction.occurredAt));
    setReady(true);
  }, [transaction, ready]);

  const choices = useMemo(
    () => pickableCategories(categories ?? [], transaction?.type ?? 'EXPENSE'),
    [categories, transaction?.type],
  );

  if (transaction === undefined) {
    return (
      <main className={ui.page}>
        <p className={ui.muted} role="status">
          Loading…
        </p>
      </main>
    );
  }
  if (!transaction) {
    return (
      <main className={ui.page}>
        <h1 className={ui.title}>Not found</h1>
        <p className={ui.muted}>This transaction was deleted or never synced to this device.</p>
        <Link href="/transactions" className={ui.link}>
          Back to transactions
        </Link>
      </main>
    );
  }

  async function save() {
    const amountPaise = typedToPaise(amount);
    if (amountPaise < 1) {
      setError('Enter an amount above zero.');
      return;
    }
    try {
      await updateTransaction(id, {
        amountPaise,
        categoryId: categoryId || null,
        accountId,
        merchant: merchant.trim() || null,
        note: note.trim() || null,
        occurredAt: new Date(when).toISOString(),
      });
      router.replace('/transactions');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }

  async function remove() {
    if (!window.confirm(`Delete this ${formatINR(transaction!.amountPaise)} transaction?`)) return;
    await deleteTransaction(id);
    router.replace('/transactions');
  }

  return (
    <main className={ui.page}>
      <header className="flex items-center justify-between">
        <h1 className={ui.title}>Edit {transaction.type.toLowerCase()}</h1>
        <Link href="/transactions" className={ui.link + ' min-h-12'}>
          Cancel
        </Link>
      </header>

      <label className={ui.label}>
        Amount (₹)
        <input
          className={ui.input}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label className={ui.label}>
        Category
        <select
          className={ui.input}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Uncategorised</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
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
        Date and time
        <input
          className={ui.input}
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </label>

      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
      <button type="button" className={ui.primary} onClick={() => void save()}>
        Save changes
      </button>
      <button type="button" className={ui.danger} onClick={() => void remove()}>
        Delete
      </button>
    </main>
  );
}
