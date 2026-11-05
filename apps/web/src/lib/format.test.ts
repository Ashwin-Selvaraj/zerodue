import { describe, expect, it } from 'vitest';
import { compactINR, formatRate, monthLabel, niceTicks, percentToBps } from './format';

describe('format helpers', () => {
  it('labels a month', () => {
    expect(monthLabel('2027-04-01')).toBe('Apr 2027');
    expect(monthLabel('2026-12-01')).toBe('Dec 2026');
  });
  it('shows basis points as a percentage', () => {
    expect(formatRate(900)).toBe('9%');
    expect(formatRate(1050)).toBe('10.5%');
    expect(formatRate(825)).toBe('8.25%');
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(null)).toBe('—');
    expect(formatRate(undefined)).toBe('—');
  });
  it('reads a typed percentage', () => {
    expect(percentToBps('9')).toBe(900);
    expect(percentToBps('10.5%')).toBe(1050);
    expect(percentToBps(' 8.25 ')).toBe(825);
    expect(percentToBps('abc')).toBe(0);
    expect(percentToBps('-3')).toBe(0);
  });

  it('shortens amounts for chart axes', () => {
    expect(compactINR(0)).toBe('0');
    expect(compactINR(95_000)).toBe('950');
    expect(compactINR(450_000)).toBe('4.5K');
    expect(compactINR(1_000_000)).toBe('10K');
    expect(compactINR(15_000_000)).toBe('1.5L');
    expect(compactINR(2_000_000_000)).toBe('2Cr');
    expect(compactINR(-250_000)).toBe('-2.5K');
  });
  it('picks round axis ticks', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
    expect(niceTicks(8_700_000)).toEqual([0, 5_000_000, 10_000_000]);
    const ticks = niceTicks(9_300);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(9_300);
    expect(new Set(ticks.slice(1).map((t, i) => t - ticks[i]!)).size).toBe(1);
    expect(niceTicks(1_000)).toEqual([0, 500, 1000]);
  });
});
