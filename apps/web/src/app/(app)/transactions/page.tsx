'use client';

import {
  addMonths,
  formatDate,
  formatINR,
  formatINRSigned,
  formatMonth,
  isoDateIST,
  monthKey,
  type TransactionDto,
} from '@zerodue/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ui } from '@/components/ui';
import { nameMap } from '@/lib/categories';
import { useAccounts, useCategories, useTransactions } from '@/lib/queries';
import { bulkCategorise } from '@/lib/repo';

const signed = (t: TransactionDto): number =>
  t.type === 'INCOME' ? t.amountPaise : t.type === 'EXPENSE' ? -t.amountPaise : 0;

export default function TransactionsPage() {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');

  const transactions = useTransactions(month, query, categoryId);
  const categories = useCategories();
  const accounts = useAccounts();
  const categoryNames = nameMap(categories);
  const accountNames = nameMap(accounts);

  const { groups, income, spent } = useMemo(() => {
    const byDay = new Map<string, TransactionDto[]>();
    let incomeTotal = 0;
    let spentTotal = 0;
    for (const t of transactions ?? []) {
      const day = isoDateIST(t.occurredAt);
      byDay.set(day, [...(byDay.get(day) ?? []), t]);
      if (t.type === 'INCOME') incomeTotal += t.amountPaise;
      if (t.type === 'EXPENSE') spentTotal += t.amountPaise;
    }
    return { groups: [...byDay], income: incomeTotal, spent: spentTotal };
  }, [transactions]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function applyBulk() {
    if (!bulkCategory || selected.size === 0) return;
    await bulkCategorise([...selected], bulkCategory);
    setSelected(new Set());
    setSelecting(false);
    setBulkCategory('');
  }

  return (
    <main className={ui.page}>
      <header className="flex items-center justify-between">
        <h1 className={ui.title}>Transactions</h1>
        <button
          type="button"
          className={ui.link + ' min-h-12'}
          onClick={() => {
            setSelecting(!selecting);
            setSelected(new Set());
          }}
        >
          {selecting ? 'Cancel' : 'Select'}
        </button>
      </header>

      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          className="min-h-12 min-w-12 text-xl"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          ‹
        </button>
        <h2 className="font-medium" aria-live="polite">
          {formatMonth(month)}
        </h2>
        <button
          type="button"
          aria-label="Next month"
          className="min-h-12 min-w-12 text-xl"
          onClick={() => setMonth(addMonths(month, 1))}
        >
          ›
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className={ui.card}>
          <dt className={ui.muted}>Income</dt>
          <dd className="text-lg font-semibold">{formatINR(income)}</dd>
        </div>
        <div className={ui.card}>
          <dt className={ui.muted}>Spent</dt>
          <dd className="text-lg font-semibold">{formatINR(spent)}</dd>
        </div>
      </dl>

      <div className="flex gap-2">
        <input
          className={ui.input}
          type="search"
          placeholder="Search merchant or note"
          aria-label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={ui.input + ' max-w-[9rem]'}
          aria-label="Filter by category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">All</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {transactions === undefined ? (
        <p className={ui.muted} role="status">
          Loading…
        </p>
      ) : groups.length === 0 ? (
        <div className={ui.card + ' text-center'}>
          <p className={ui.muted}>
            {query || categoryId ? 'Nothing matches.' : 'No transactions this month.'}
          </p>
          <Link href="/add" className={ui.link + ' mt-2 inline-block'}>
            Add one
          </Link>
        </div>
      ) : (
        groups.map(([day, rows]) => (
          <section key={day} aria-label={formatDate(day + 'T12:00:00+05:30')}>
            <h3 className={ui.muted + ' mb-1'}>{formatDate(day + 'T12:00:00+05:30')}</h3>
            <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {rows.map((t) => {
                const title =
                  t.merchant ||
                  (t.categoryId && categoryNames.get(t.categoryId)) ||
                  (t.type === 'TRANSFER' ? 'Transfer' : 'Transaction');
                const amount = signed(t);
                const row = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{title}</span>
                      <span className={ui.muted + ' block truncate'}>
                        {t.categoryId
                          ? categoryNames.get(t.categoryId)
                          : t.type === 'TRANSFER'
                            ? 'Transfer'
                            : 'Uncategorised'}
                        {' · '}
                        {accountNames.get(t.accountId) ?? ''}
                      </span>
                    </span>
                    <span
                      className={`font-medium tabular-nums ${t.type === 'INCOME' ? 'text-teal-700 dark:text-teal-400' : ''}`}
                    >
                      {amount === 0 ? formatINR(t.amountPaise) : formatINRSigned(amount)}
                    </span>
                  </>
                );
                return (
                  <li key={t.id}>
                    {selecting ? (
                      <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={selected.has(t.id)}
                          onChange={() => toggle(t.id)}
                          aria-label={`Select ${title}`}
                        />
                        {row}
                      </label>
                    ) : (
                      <Link
                        href={`/transactions/${t.id}`}
                        className="flex min-h-14 items-center gap-3 px-4 py-2"
                      >
                        {row}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-14 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="mx-auto flex max-w-md gap-2 md:max-w-2xl">
            <select
              className={ui.input}
              aria-label="Set category"
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
            >
              <option value="">Set category…</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={ui.primary}
              disabled={!bulkCategory || selected.size === 0}
              onClick={() => void applyBulk()}
            >
              Apply to {selected.size}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
