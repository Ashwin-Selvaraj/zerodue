'use client';

import { useCallback, useEffect, useState } from 'react';
import { request } from './api';
import { getDb } from './db';
import { markOccurrencePaid } from './repo';

export interface Reminder {
  id: string;
  occurrenceId: string | null;
  title: string;
  body: string;
  dueDate: string | null;
  amountPaise: number | null;
  scheduledFor: string;
  readAt: string | null;
}

/**
 * Reminders whose bill is already dealt with on this device are hidden straight away, without waiting
 * for the server to notice.
 */
export function visibleReminders(
  reminders: Reminder[],
  occurrences: { id: string; status: string }[],
): Reminder[] {
  const state = new Map(occurrences.map((o) => [o.id, o.status]));
  return reminders.filter(
    (r) => !r.occurrenceId || (state.get(r.occurrenceId) ?? 'UPCOMING') === 'UPCOMING',
  );
}

const REFRESH_MS = 60_000;

/** Due reminders from the server, refreshed every minute and when the app comes back to the foreground. */
export function useReminders(): {
  reminders: Reminder[] | undefined;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [reminders, setReminders] = useState<Reminder[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await request<Reminder[]>('/reminders');
      const occurrences = await getDb().occurrences.toArray();
      setReminders(visibleReminders(rows, occurrences));
      setError(null);
    } catch {
      // offline or signed out: keep what we have; reminders are a convenience on top of the bills list
      setError('Could not load reminders.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { reminders, error, refresh };
}

/** Marks the bill paid on this device (recording the expense when the bill has an account), then clears the reminder. */
export async function payFromReminder(reminder: Reminder): Promise<void> {
  if (!reminder.occurrenceId) return;
  const db = getDb();
  const occurrence = await db.occurrences.get(reminder.occurrenceId);
  const item = occurrence && (await db.recurringItems.get(occurrence.recurringItemId));
  await markOccurrencePaid(reminder.occurrenceId, { createTransaction: Boolean(item?.accountId) });
  await request<void>(`/reminders/${reminder.id}/dismiss`, { method: 'POST' }).catch(
    () => undefined,
  );
}

export const snoozeReminder = (id: string, minutes: number) =>
  request(`/reminders/${id}/snooze`, { method: 'POST', body: { minutes } });
export const dismissReminder = (id: string) =>
  request<void>(`/reminders/${id}/dismiss`, { method: 'POST' });
