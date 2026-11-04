'use client';

import { formatDateTime, formatINR } from '@zerodue/shared';
import { useState, type FormEvent } from 'react';
import { ui } from '@/components/ui';
import { typedToPaise } from '@/lib/amount';
import { useAuth } from '@/lib/auth-context';
import { getDb } from '@/lib/db';
import { useAccounts, useCategories, useOutboxCounts, useSyncState } from '@/lib/queries';
import { deleteRecord, saveRecord } from '@/lib/repo';
import { syncNow } from '@/lib/sync';

const ACCOUNT_TYPES = [
  ['BANK', 'Bank account'],
  ['CREDIT_CARD', 'Credit card'],
  ['CASH', 'Cash'],
  ['WALLET', 'Wallet'],
] as const;

export default function MorePage() {
  const { user, logout } = useAuth();
  const sync = useSyncState();
  const outbox = useOutboxCounts();
  const accounts = useAccounts();
  const categories = useCategories();
  const [error, setError] = useState<string | null>(null);

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return setError('Give the account a name.');
    const balancePaise = typedToPaise(String(form.get('balance') ?? '').replace(/[,₹\s]/g, ''));
    await saveRecord('account', {
      name,
      type: String(form.get('type')),
      balancePaise,
      balanceAsOf: new Date().toISOString().slice(0, 10),
      archived: false,
    });
    setError(null);
    event.currentTarget.reset();
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return setError('Give the category a name.');
    await saveRecord('category', {
      name,
      kind: String(form.get('kind')),
      parentId: null,
      sortOrder: (categories?.length ?? 0) + 1,
      quickPick: false,
    });
    setError(null);
    event.currentTarget.reset();
  }

  return (
    <main className={ui.page}>
      <h1 className={ui.title}>More</h1>

      <section aria-label="Sync" className={ui.card}>
        <h2 className="mb-1 font-medium">Sync</h2>
        <p className={ui.muted}>
          {sync.status === 'offline' &&
            'You are offline. Changes are saved here and sent when you reconnect.'}
          {sync.status === 'syncing' && 'Syncing…'}
          {sync.status === 'error' && `Sync problem: ${sync.error}`}
          {sync.status === 'idle' &&
            (sync.lastSyncedAt
              ? `Last synced ${formatDateTime(sync.lastSyncedAt)}.`
              : 'Not synced yet.')}{' '}
          {outbox ? `${outbox.pending} change${outbox.pending === 1 ? '' : 's'} waiting.` : ''}
        </p>
        {outbox && outbox.failed.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {outbox.failed.map((op) => (
              <li key={op.id} className={ui.error}>
                <p>
                  A {op.entity} change was refused: {op.error}
                </p>
                <button
                  type="button"
                  className={ui.link}
                  onClick={() => void getDb().outbox.delete(op.id!)}
                >
                  Discard
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className={ui.secondary + ' mt-3'}
          onClick={() => void syncNow()}
          disabled={sync.status === 'syncing'}
        >
          Sync now
        </button>
      </section>

      <section aria-label="Accounts" className={ui.card}>
        <h2 className="mb-2 font-medium">Accounts</h2>
        <ul className="mb-3 flex flex-col gap-1">
          {accounts?.map((a) => (
            <li key={a.id} className="flex min-h-12 items-center justify-between">
              <span>
                {a.name}{' '}
                <span className={ui.muted}>· {a.type.replace('_', ' ').toLowerCase()}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{formatINR(a.balancePaise)}</span>
                <button
                  type="button"
                  className={ui.link + ' min-h-12'}
                  onClick={() =>
                    window.confirm(`Delete ${a.name}?`) && void deleteRecord('account', a.id)
                  }
                  aria-label={`Delete ${a.name}`}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={addAccount} className="flex flex-col gap-3" noValidate>
          <label className={ui.label}>
            Name
            <input name="name" className={ui.input} placeholder="ICICI salary" />
          </label>
          <label className={ui.label}>
            Type
            <select name="type" className={ui.input} defaultValue="BANK">
              {ACCOUNT_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={ui.label}>
            Current balance (₹)
            <input name="balance" className={ui.input} inputMode="decimal" placeholder="0" />
          </label>
          <button type="submit" className={ui.secondary}>
            Add account
          </button>
        </form>
      </section>

      <section aria-label="Categories" className={ui.card}>
        <h2 className="mb-2 font-medium">Categories</h2>
        <p className={ui.muted + ' mb-2'}>
          Quick-pick categories appear as buttons on payment notifications.
        </p>
        <ul className="mb-3 flex flex-col gap-1">
          {categories?.map((c) => (
            <li key={c.id} className="flex min-h-12 items-center justify-between gap-2">
              <span className={c.parentId ? 'pl-4' : ''}>{c.name}</span>
              <span className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={c.quickPick}
                    onChange={() => void saveRecord('category', { ...c, quickPick: !c.quickPick })}
                    aria-label={`${c.name} is a quick pick`}
                  />
                  Quick
                </label>
                <button
                  type="button"
                  className={ui.link + ' min-h-12'}
                  onClick={() =>
                    window.confirm(`Delete ${c.name}?`) && void deleteRecord('category', c.id)
                  }
                  aria-label={`Delete ${c.name}`}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={addCategory} className="flex flex-col gap-3" noValidate>
          <label className={ui.label}>
            Name
            <input name="name" className={ui.input} placeholder="Groceries" />
          </label>
          <label className={ui.label}>
            For
            <select name="kind" className={ui.input} defaultValue="EXPENSE">
              <option value="EXPENSE">Expenses</option>
              <option value="INCOME">Income</option>
              <option value="BOTH">Both</option>
            </select>
          </label>
          <button type="submit" className={ui.secondary}>
            Add category
          </button>
        </form>
      </section>

      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}

      <section aria-label="Account" className={ui.card}>
        <p className={ui.muted}>Signed in as {user?.email}</p>
        <button
          type="button"
          className={ui.secondary + ' mt-3 w-full'}
          onClick={() => void logout()}
        >
          Sign out
        </button>
      </section>
    </main>
  );
}
