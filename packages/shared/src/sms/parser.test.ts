import { describe, expect, it } from 'vitest';
import fixtures from './fixtures.json';
import { parseSms, readSms, senderAllowed } from './parser';

const ALLOW = ['*-ICICIB', '*-ICICIT', '*-ICICIS'];

describe('shared message fixtures', () => {
  it.each(fixtures)('$name', ({ sender, body, expected }) => {
    expect(readSms(sender, body, ALLOW)).toEqual(expected);
  });
});

describe('senderAllowed', () => {
  it('matches patterns with * as anything, ignoring case and spaces around the sender', () => {
    expect(senderAllowed('VM-ICICIB', ALLOW)).toBe(true);
    expect(senderAllowed(' vk-icicis ', ALLOW)).toBe(true);
    expect(senderAllowed('VM-ICICIBX', ALLOW)).toBe(false);
    expect(senderAllowed('ICICIB', ALLOW)).toBe(false);
  });

  it('treats other characters in a pattern literally', () => {
    expect(senderAllowed('A.B', ['A.B'])).toBe(true);
    expect(senderAllowed('AXB', ['A.B'])).toBe(false);
    expect(senderAllowed('X', [])).toBe(false);
  });
});

describe('parseSms', () => {
  it('reads a message regardless of line breaks and extra spaces', () => {
    const result = parseSms('Rs  450.00\n debited   at  SHELL  on 03-Nov-26');
    expect(result).toMatchObject({
      kind: 'payment',
      payment: { amountPaise: 45000, merchant: 'SHELL' },
    });
  });

  it('keeps paise exact for one-digit fractions and no fraction', () => {
    const amount = (body: string) =>
      (parseSms(body) as { payment: { amountPaise: number } }).payment.amountPaise;
    expect(amount('Rs 10.5 debited')).toBe(1050);
    expect(amount('Rs 10 debited')).toBe(1000);
    expect(amount('Rs 1,23,456.07 debited')).toBe(12345607);
  });

  it('calls it a credit when that comes first, and a debit when that does', () => {
    expect(parseSms('Rs 5 credited, SHELL debited')).toMatchObject({
      payment: { direction: 'CREDIT' },
    });
    expect(parseSms('Rs 5 debited; SHELL credited')).toMatchObject({
      payment: { direction: 'DEBIT' },
    });
  });

  it('only reports a merchant name of two or more characters', () => {
    const result = parseSms('Rs 5 debited at X.');
    expect(result).toMatchObject({ kind: 'payment' });
    expect((result as { payment: { merchant?: string } }).payment.merchant).toBeUndefined();
  });
});
