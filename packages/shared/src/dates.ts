import { APP_TIMEZONE } from './brand';

/** English month abbreviations, fixed so ICU variants (e.g. "Sept") can't leak into the UI. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const istParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** Calendar parts of an instant, as seen in Asia/Kolkata. */
export function istPartsOf(instant: Date | string | number): IstParts {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
  const parts = Object.fromEntries(istParts.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** "05 Dec 2026" in IST. */
export function formatDate(instant: Date | string | number): string {
  const { year, month, day } = istPartsOf(instant);
  return `${pad(day)} ${MONTHS[month - 1]} ${year}`;
}

/** "05 Dec 2026, 02:14 pm" in IST. */
export function formatDateTime(instant: Date | string | number): string {
  const { hour, minute } = istPartsOf(instant);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${formatDate(instant)}, ${pad(h12)}:${pad(minute)} ${hour < 12 ? 'am' : 'pm'}`;
}

/** "Dec 2026" label for a month. Accepts any instant inside the month (IST). */
export function formatMonth(instant: Date | string | number): string {
  const { year, month } = istPartsOf(instant);
  return `${MONTHS[month - 1]} ${year}`;
}

/** First-of-month key `YYYY-MM-01` for the IST month containing the instant. */
export function monthKey(instant: Date | string | number): string {
  const { year, month } = istPartsOf(instant);
  return `${year}-${pad(month)}-01`;
}

/** Calendar date `YYYY-MM-DD` of an instant in IST. */
export function isoDateIST(instant: Date | string | number): string {
  const { year, month, day } = istPartsOf(instant);
  return `${year}-${pad(month)}-${pad(day)}`;
}
