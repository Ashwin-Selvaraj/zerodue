import { describe, expect, it } from 'vitest';
import { matchCategoryRule, type MatchableRule } from './rules';

const rule = (over: Partial<MatchableRule>): MatchableRule => ({
  matchType: 'MERCHANT_CONTAINS',
  pattern: 'shell',
  categoryId: 'fuel',
  priority: 100,
  enabled: true,
  ...over,
});

describe('matchCategoryRule', () => {
  it('matches a merchant by equality or substring, ignoring case', () => {
    expect(
      matchCategoryRule([rule({ matchType: 'MERCHANT_EQUALS', pattern: 'SHELL' })], {
        merchant: 'shell',
      }),
    ).toBe('fuel');
    expect(
      matchCategoryRule([rule({ matchType: 'MERCHANT_EQUALS' })], { merchant: 'Shell Pune' }),
    ).toBeNull();
    expect(matchCategoryRule([rule({})], { merchant: 'Shell Pune' })).toBe('fuel');
    expect(matchCategoryRule([rule({})], { merchant: 'Indian Oil' })).toBeNull();
  });

  it('never matches when the merchant is missing', () => {
    expect(matchCategoryRule([rule({})], {})).toBeNull();
    expect(
      matchCategoryRule([rule({ matchType: 'MERCHANT_EQUALS' })], { merchant: null }),
    ).toBeNull();
  });

  it('matches a UPI id exactly', () => {
    const r = rule({ matchType: 'VPA_EQUALS', pattern: 'Shop@Upi', categoryId: 'misc' });
    expect(matchCategoryRule([r], { vpa: 'shop@upi' })).toBe('misc');
    expect(matchCategoryRule([r], { vpa: 'other@upi' })).toBeNull();
    expect(matchCategoryRule([r], {})).toBeNull();
    expect(
      matchCategoryRule([rule({ matchType: 'VPA_EQUALS', pattern: ' ' })], { vpa: '' }),
    ).toBeNull();
  });

  it('matches a regex against merchant and note, and ignores an invalid pattern', () => {
    const r = rule({ matchType: 'REMARKS_REGEX', pattern: 'petrol|diesel', categoryId: 'fuel' });
    expect(matchCategoryRule([r], { merchant: 'Pump', note: 'Diesel fill' })).toBe('fuel');
    expect(matchCategoryRule([r], { note: 'groceries' })).toBeNull();
    expect(matchCategoryRule([r], {})).toBeNull();
    expect(
      matchCategoryRule([rule({ matchType: 'REMARKS_REGEX', pattern: '(' })], { merchant: 'x' }),
    ).toBeNull();
  });

  it('skips disabled rules and prefers lower priority numbers, then list order', () => {
    const a = rule({ categoryId: 'a', priority: 50 });
    const b = rule({ categoryId: 'b', priority: 10 });
    const c = rule({ categoryId: 'c', priority: 10 });
    expect(matchCategoryRule([a, b, c], { merchant: 'shell' })).toBe('b');
    expect(
      matchCategoryRule([a, rule({ categoryId: 'b', priority: 1, enabled: false })], {
        merchant: 'shell',
      }),
    ).toBe('a');
    expect(matchCategoryRule([], { merchant: 'shell' })).toBeNull();
  });
});
