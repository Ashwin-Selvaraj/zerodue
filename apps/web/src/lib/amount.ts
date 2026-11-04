import { toPaise } from '@zerodue/shared';

const MAX_INTEGER_DIGITS = 9;

/** Applies one keypad press to the amount being typed, in rupees ("1234.5"). */
export function pressKey(current: string, key: string): string {
  if (key === '⌫') return current.slice(0, -1);
  if (key === '.') return current.includes('.') ? current : `${current || '0'}.`;
  if (!/^\d$/.test(key)) return current;
  const [whole = '', fraction] = current.split('.');
  if (fraction !== undefined) return fraction.length >= 2 ? current : current + key;
  if (whole === '0') return key; // no leading zeros
  return whole.length >= MAX_INTEGER_DIGITS ? current : current + key;
}

/** Typed rupees to paise; empty or a lone "." is zero. */
export function typedToPaise(typed: string): number {
  const cleaned = typed.endsWith('.') ? typed.slice(0, -1) : typed;
  return cleaned === '' ? 0 : toPaise(cleaned);
}

/** The typed amount with Indian grouping as you go: "123456.5" → "1,23,456.5". */
export function displayTyped(typed: string): string {
  if (typed === '') return '0';
  const [whole = '0', fraction] = typed.split('.');
  const grouped = new Intl.NumberFormat('en-IN').format(Number(whole));
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
