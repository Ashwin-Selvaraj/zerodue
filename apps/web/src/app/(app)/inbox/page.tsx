'use client';

import { formatDateTime, formatINR } from '@zerodue/shared';
import Link from 'next/link';
import { useState } from 'react';
import { ui, chip } from '@/components/ui';
import { pickableCategories } from '@/lib/categories';
import { useCategories, usePendingTransactions } from '@/lib/queries';
import { categorisePending, ignoreTransaction } from '@/lib/repo';

/** Payments captured from your messages that still need a category: tap one and it's done. */
export default function InboxPage() {
  const pending = usePendingTransactions();
  const categories = useCategories();
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [more, setMore] = useState<string | null>(null);

  return (
    <main className={ui.page}>
      <Link href="/" className={ui.link}>
        ‹ Home
      </Link>
      <h1 className={ui.title}>Inbox{pending ? ` (${pending.length})` : ''}</h1>

      {pending === undefined && (
        <p className={ui.muted} role="status">
          Loading…
        </p>
      )}
      {pending?.length === 0 && (
        <p className={ui.muted}>
          All caught up. Payments read from your messages show up here until you give them a
          category.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {pending?.map((t) => {
          const options = pickableCategories(categories ?? [], t.type);
          const quick = options.filter((c) => c.quickPick).slice(0, 4);
          const rest = options.filter((c) => !quick.includes(c));
          const who = t.merchant ?? t.vpa;
          return (
            <li key={t.id} className={ui.card + ' flex flex-col gap-3'}>
              <div>
                <p className="text-lg font-semibold">
                  {t.type === 'INCOME' ? '+' : ''}
                  {formatINR(t.amountPaise)}{' '}
                  {who ? (t.type === 'INCOME' ? `from ${who}` : `to ${who}`) : ''}
                </p>
                <p className={ui.muted}>
                  {t.source === 'SMS_UPI' ? 'UPI' : 'Bank'} message · {formatDateTime(t.occurredAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {quick.map((c) => (
                  <button
                    key={c.id}
                    className={chip(false)}
                    onClick={() => categorisePending(t.id, c.id, remember[t.id] ?? false)}
                  >
                    {c.name}
                  </button>
                ))}
                {rest.length > 0 && (
                  <button
                    className={chip(more === t.id)}
                    onClick={() => setMore(more === t.id ? null : t.id)}
                  >
                    More…
                  </button>
                )}
              </div>
              {more === t.id && (
                <select
                  aria-label="Other categories"
                  className={ui.input}
                  defaultValue=""
                  onChange={(e) =>
                    e.target.value &&
                    categorisePending(t.id, e.target.value, remember[t.id] ?? false)
                  }
                >
                  <option value="">Choose a category</option>
                  {rest.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              {t.merchant && (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={remember[t.id] ?? false}
                    onChange={(e) => setRemember({ ...remember, [t.id]: e.target.checked })}
                  />
                  Always use this category for {t.merchant}
                </label>
              )}
              <button
                className="min-h-11 self-start px-1 text-sm underline"
                onClick={() => ignoreTransaction(t.id)}
              >
                Not a payment: ignore
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
