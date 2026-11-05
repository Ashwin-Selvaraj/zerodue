import { formatMonth, type MonthKey } from '@zerodue/shared';

/** "Apr 2027" for a month key (2027-04-01). */
export function monthLabel(month: MonthKey): string {
  return formatMonth(`${month}T12:00:00+05:30`);
}

/** Basis points as a percentage: 850 → "8.5%". */
export function formatRate(bps: number | null | undefined): string {
  if (bps == null) return '—';
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

/** A typed percentage ("8.5") as basis points (850); NaN and negatives become 0. */
export function percentToBps(text: string): number {
  const value = Number.parseFloat(text.replace(/[%\s]/g, ''));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
}

/** Short rupee amount for chart axes in the Indian system: 4,500 → "4.5K", 1,50,000 → "1.5L", 2,00,00,000 → "2Cr". */
export function compactINR(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  const sign = paise < 0 ? '-' : '';
  const trim = (n: number): string => n.toFixed(1).replace(/\.0$/, '');
  if (rupees >= 1_00_00_000) return `${sign}${trim(rupees / 1_00_00_000)}Cr`;
  if (rupees >= 1_00_000) return `${sign}${trim(rupees / 1_00_000)}L`;
  if (rupees >= 1_000) return `${sign}${trim(rupees / 1_000)}K`;
  return `${sign}${Math.round(rupees)}`;
}

/** Round-number axis ticks from 0 up to cover `max`: about `count` of them, steps of 1, 2 or 5 × 10^k. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((m) => m * power >= rough) ?? 10) * power;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) {
    ticks.push(value);
    if (value >= max) break;
  }
  return ticks;
}
