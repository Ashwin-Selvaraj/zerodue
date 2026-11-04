import { describe, expect, it } from 'vitest';
import { displayTyped, pressKey, typedToPaise } from './amount';

const type = (keys: string) => [...keys].reduce((typed, key) => pressKey(typed, key), '');

describe('pressKey', () => {
  it('builds an amount digit by digit', () => {
    expect(type('450')).toBe('450');
    expect(type('12.5')).toBe('12.5');
  });

  it('limits to two decimals and one point', () => {
    expect(type('1.234')).toBe('1.23');
    expect(type('1.2.3')).toBe('1.23');
  });

  it('starts a decimal with a leading zero and drops leading zeros', () => {
    expect(type('.5')).toBe('0.5');
    expect(type('007')).toBe('7');
    expect(type('0')).toBe('0');
  });

  it('caps the whole part and ignores unknown keys', () => {
    expect(type('1234567890')).toBe('123456789');
    expect(pressKey('12', 'x')).toBe('12');
  });

  it('deletes the last character', () => {
    expect(pressKey('12.5', '⌫')).toBe('12.');
    expect(pressKey('', '⌫')).toBe('');
  });
});

describe('typedToPaise and displayTyped', () => {
  it('converts what was typed to paise exactly', () => {
    expect(typedToPaise('')).toBe(0);
    expect(typedToPaise('.')).toBe(0);
    expect(typedToPaise('450')).toBe(45_000);
    expect(typedToPaise('1234.5')).toBe(123_450);
    expect(typedToPaise('0.07')).toBe(7);
    expect(typedToPaise('12.')).toBe(1_200);
  });

  it('shows Indian grouping while typing', () => {
    expect(displayTyped('')).toBe('0');
    expect(displayTyped('129300')).toBe('1,29,300');
    expect(displayTyped('600000.5')).toBe('6,00,000.5');
    expect(displayTyped('12.')).toBe('12.');
  });
});
