import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMonth, isoDateIST, monthKey } from './dates';

describe('IST date formatting', () => {
  it('formats DD MMM YYYY', () => {
    expect(formatDate('2026-12-05T10:00:00+05:30')).toBe('05 Dec 2026');
    expect(formatDate('2026-09-01T10:00:00+05:30')).toBe('01 Sep 2026');
  });

  it('uses Asia/Kolkata, not UTC, to decide the calendar day', () => {
    // 20:00 UTC on 31 Mar is already 01:30 on 01 Apr in IST
    expect(formatDate('2027-03-31T20:00:00Z')).toBe('01 Apr 2027');
    expect(isoDateIST('2027-03-31T20:00:00Z')).toBe('2027-04-01');
    expect(monthKey('2027-03-31T20:00:00Z')).toBe('2027-04-01');
  });

  it('formats time in 12-hour IST', () => {
    expect(formatDateTime('2026-11-03T08:44:00Z')).toBe('03 Nov 2026, 02:14 pm');
    expect(formatDateTime('2026-11-02T18:35:00Z')).toBe('03 Nov 2026, 12:05 am');
  });

  it('formats month labels', () => {
    expect(formatMonth('2027-02-14T00:00:00+05:30')).toBe('Feb 2027');
  });

  it('rejects invalid dates', () => {
    expect(() => formatDate('not-a-date')).toThrow(RangeError);
  });
});
