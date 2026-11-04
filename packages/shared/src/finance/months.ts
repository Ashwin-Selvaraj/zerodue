/**
 * Calendar helpers on plain strings, so the engine never depends on the machine's timezone.
 * A month is its first day, `YYYY-MM-01`; a date is `YYYY-MM-DD`. Both are IST calendar values.
 */

export type MonthKey = string;
export type DateString = string;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])-01$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function parseMonthKey(key: MonthKey): { year: number; month: number } {
  const match = MONTH_RE.exec(key);
  if (!match) throw new RangeError(`Invalid month key (expected YYYY-MM-01): ${key}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function monthIndex(key: MonthKey): number {
  const { year, month } = parseMonthKey(key);
  return year * 12 + (month - 1);
}

function fromMonthIndex(index: number): MonthKey {
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${pad2(index - year * 12 + 1)}-01`;
}

export function addMonths(key: MonthKey, count: number): MonthKey {
  return fromMonthIndex(monthIndex(key) + count);
}

/** Whole months from `from` to `to` (negative when `to` is earlier). */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
  return monthIndex(to) - monthIndex(from);
}

export function daysInMonth(key: MonthKey): number {
  const { year, month } = parseMonthKey(key);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthOfDate(date: DateString): MonthKey {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`Invalid date (expected YYYY-MM-DD): ${date}`);
  const key = `${match[1]}-${match[2]}-01`;
  const day = Number(match[3]);
  if (day < 1 || day > daysInMonth(key)) throw new RangeError(`Invalid date: ${date}`);
  return key;
}

/** The given day of a month, clamped to the month's length (day 31 in February becomes the 28th/29th). */
export function dateInMonth(key: MonthKey, day: number): DateString {
  if (!Number.isInteger(day) || day < 1) throw new RangeError(`Invalid day of month: ${day}`);
  return `${key.slice(0, 8)}${pad2(Math.min(day, daysInMonth(key)))}`;
}

export function lastDateOfMonth(key: MonthKey): DateString {
  return dateInMonth(key, daysInMonth(key));
}

export function monthRange(start: MonthKey, count: number): MonthKey[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Invalid month count: ${count}`);
  return Array.from({ length: count }, (_, i) => addMonths(start, i));
}
