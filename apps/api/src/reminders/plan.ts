import { formatDate, formatINR } from '@zerodue/shared';

/** A reminder goes out at 9 in the morning, India time. */
const SEND_HOUR_IST = '09:00:00+05:30';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Lead value used for the nudge the day after a bill was due and is still unpaid. */
export const OVERDUE_LEAD = -1;

export interface ReminderSlot {
  /** Days before the due date; 0 is the due day; {@link OVERDUE_LEAD} is the day after. */
  leadDays: number;
  at: Date;
}

/** When to remind about a bill due on `dueDate` (YYYY-MM-DD): each chosen lead, plus a nudge if it goes overdue. */
export function reminderSlots(dueDate: string, leadDays: number[]): ReminderSlot[] {
  if (leadDays.length === 0) return [];
  const due = new Date(`${dueDate}T${SEND_HOUR_IST}`).getTime();
  const slots = [...new Set(leadDays)].map((lead) => ({
    leadDays: lead,
    at: new Date(due - lead * DAY_MS),
  }));
  slots.push({ leadDays: OVERDUE_LEAD, at: new Date(due + DAY_MS) });
  return slots.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function dedupeKey(occurrenceId: string, leadDays: number): string {
  return `${occurrenceId}:${leadDays}:WEB_PUSH`;
}

export interface Described {
  title: string;
  body: string;
}

/** The notification text, worked out fresh each time so it reflects the current amount. */
export function describeReminder(input: {
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  amountPaise: number;
  dueDate: string;
  leadDays: number;
}): Described {
  const { name, kind, amountPaise, dueDate, leadDays } = input;
  const verb = kind === 'INCOME' ? 'expected' : 'due';
  const when =
    leadDays === OVERDUE_LEAD
      ? null
      : leadDays === 0
        ? 'today'
        : leadDays === 1
          ? 'tomorrow'
          : `in ${leadDays} days`;
  const title =
    when === null
      ? `${name} is overdue`
      : `${name} ${kind === 'INCOME' ? 'expected' : 'due'} ${when}`;
  const on = formatDate(`${dueDate}T12:00:00+05:30`);
  return { title, body: `${formatINR(amountPaise)} · ${verb} ${on}` };
}
