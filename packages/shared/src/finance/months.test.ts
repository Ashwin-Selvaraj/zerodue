import { describe, expect, it } from 'vitest';
import { assertBps, assertPaise, divRound } from './guards';
import {
  addMonths,
  dateInMonth,
  daysInMonth,
  lastDateOfMonth,
  monthOfDate,
  monthRange,
  monthsBetween,
  parseMonthKey,
} from './months';

describe('guards', () => {
  it('accepts non-negative integers and rejects everything else', () => {
    expect(() => assertPaise(0, 'x')).not.toThrow();
    for (const bad of [-1, 1.5, Number.NaN, Infinity]) {
      expect(() => assertPaise(bad, 'x')).toThrow(RangeError);
      expect(() => assertBps(bad, 'x')).toThrow(RangeError);
    }
    expect(() => assertBps(850, 'x')).not.toThrow();
  });

  it('divides rounding half up', () => {
    expect(divRound(7, 2)).toBe(4);
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(4, 2)).toBe(2);
    expect(divRound(0, 7)).toBe(0);
  });
});

describe('month keys', () => {
  it('parses and rejects malformed keys', () => {
    expect(parseMonthKey('2030-02-01')).toEqual({ year: 2030, month: 2 });
    for (const bad of ['2030-02-15', '2030-13-01', '2030-2-01', 'nope', '']) {
      expect(() => parseMonthKey(bad)).toThrow(RangeError);
    }
  });

  it('adds months across year boundaries in both directions', () => {
    expect(addMonths('2030-11-01', 3)).toBe('2031-02-01');
    expect(addMonths('2030-01-01', -1)).toBe('2029-12-01');
    expect(addMonths('2030-05-01', 0)).toBe('2030-05-01');
    expect(addMonths('2030-01-01', 24)).toBe('2032-01-01');
    expect(addMonths('0999-12-01', 1)).toBe('1000-01-01');
    expect(addMonths('0500-01-01', 0)).toBe('0500-01-01');
  });

  it('counts months between keys', () => {
    expect(monthsBetween('2030-11-01', '2031-03-01')).toBe(4);
    expect(monthsBetween('2031-03-01', '2030-11-01')).toBe(-4);
    expect(monthsBetween('2030-05-01', '2030-05-01')).toBe(0);
  });

  it('builds ranges', () => {
    expect(monthRange('2030-11-01', 3)).toEqual(['2030-11-01', '2030-12-01', '2031-01-01']);
    expect(monthRange('2030-11-01', 0)).toEqual([]);
    expect(() => monthRange('2030-11-01', -1)).toThrow(RangeError);
    expect(() => monthRange('2030-11-01', 1.5)).toThrow(RangeError);
  });
});

describe('dates', () => {
  it('knows month lengths including leap years', () => {
    expect(daysInMonth('2030-02-01')).toBe(28);
    expect(daysInMonth('2032-02-01')).toBe(29);
    expect(daysInMonth('2030-12-01')).toBe(31);
    expect(daysInMonth('2030-04-01')).toBe(30);
  });

  it('maps a date to its month and validates it', () => {
    expect(monthOfDate('2030-02-28')).toBe('2030-02-01');
    expect(() => monthOfDate('2030-02-30')).toThrow(RangeError);
    expect(() => monthOfDate('2030-02-00')).toThrow(RangeError);
    expect(() => monthOfDate('2030/02/10')).toThrow(RangeError);
    expect(() => monthOfDate('2030-13-10')).toThrow(RangeError);
  });

  it('clamps a due day to the month length', () => {
    expect(dateInMonth('2030-03-01', 5)).toBe('2030-03-05');
    expect(dateInMonth('2030-02-01', 31)).toBe('2030-02-28');
    expect(dateInMonth('2032-02-01', 31)).toBe('2032-02-29');
    expect(lastDateOfMonth('2030-04-01')).toBe('2030-04-30');
    expect(() => dateInMonth('2030-03-01', 0)).toThrow(RangeError);
    expect(() => dateInMonth('2030-03-01', 2.5)).toThrow(RangeError);
  });
});
