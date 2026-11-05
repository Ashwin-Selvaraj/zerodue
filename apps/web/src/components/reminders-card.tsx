'use client';

import Link from 'next/link';
import { useState } from 'react';
import { dismissReminder, payFromReminder, snoozeReminder, useReminders } from '@/lib/reminders';
import { ui } from './ui';

/** Bills that are due or coming up, with one-tap Mark paid, later and dismiss. */
export function RemindersCard() {
  const { reminders, refresh } = useReminders();
  const [busy, setBusy] = useState<string | null>(null);
  if (!reminders || reminders.length === 0) return null;

  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id);
    try {
      await action();
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Reminders" className="flex flex-col gap-3">
      <h2 className="font-medium">Reminders</h2>
      <ul className="flex flex-col gap-3">
        {reminders.slice(0, 3).map((r) => (
          <li key={r.id} className={ui.card + ' flex flex-col gap-2'}>
            <div>
              <p className="font-medium">{r.title}</p>
              <p className={ui.muted}>{r.body}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.occurrenceId && (
                <button
                  className={ui.primary}
                  disabled={busy === r.id}
                  onClick={() => run(r.id, () => payFromReminder(r))}
                >
                  Mark paid
                </button>
              )}
              <button
                className={ui.secondary}
                disabled={busy === r.id}
                onClick={() => run(r.id, () => snoozeReminder(r.id, 180))}
              >
                Later
              </button>
              <button
                className={ui.secondary}
                disabled={busy === r.id}
                onClick={() => run(r.id, () => dismissReminder(r.id))}
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
      {reminders.length > 3 && (
        <Link href="/bills" className={ui.link}>
          {reminders.length - 3} more in Bills
        </Link>
      )}
    </section>
  );
}
