import { describe, expect, it } from 'vitest';
import { formatINR, formatINRNumber, formatINRSigned, toPaise, toRupees } from './money';

describe('formatINR', () => {
  it.each([
    [12_930_000, '₹1,29,300'],
    [60_000_000, '₹6,00,000'],
    [50_831_000, '₹5,08,310'],
    [51_256_000, '₹5,12,560'],
    [450_000, '₹4,500'],
    [0, '₹0'],
    [12_345, '₹123.45'],
    [100, '₹1'],
    [1_00_00_00_000, '₹1,00,00,000'],
    [-450_000, '-₹4,500'],
  ])('formats %i paise as %s', (paise, expected) => {
    expect(formatINR(paise)).toBe(expected);
  });

  it('rejects non-integer paise', () => {
    expect(() => formatINR(10.5)).toThrow(RangeError);
    expect(() => formatINR(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatINRNumber / formatINRSigned', () => {
  it('omits the rupee sign', () => {
    expect(formatINRNumber(12_930_000)).toBe('1,29,300');
    expect(formatINRNumber(12_345)).toBe('123.45');
  });

  it('shows explicit signs for deltas', () => {
    expect(formatINRSigned(2_000_000)).toBe('+₹20,000');
    expect(formatINRSigned(-450_000)).toBe('−₹4,500');
    expect(formatINRSigned(0)).toBe('₹0');
  });
});

describe('toPaise / toRupees', () => {
  it.each([
    [66_800, 6_680_000],
    ['1,29,300', 12_930_000],
    ['₹4,500', 450_000],
    ['123.4', 12_340],
    ['123.45', 12_345],
    ['0.07', 7],
    ['-20,000', -2_000_000],
    [0.3, 30],
    [0.1 + 0.2, 30], // 0.30000000000000004 must not leak sub-paise noise
  ])('converts %s to %i paise', (input, expected) => {
    expect(toPaise(input)).toBe(expected);
  });

  it('rejects malformed input and sub-paise precision', () => {
    expect(() => toPaise('12.345')).toThrow(RangeError);
    expect(() => toPaise('abc')).toThrow(RangeError);
    expect(() => toPaise('')).toThrow(RangeError);
  });

  it('round-trips', () => {
    expect(toRupees(toPaise('1,29,300.50'))).toBe(129_300.5);
  });
});
