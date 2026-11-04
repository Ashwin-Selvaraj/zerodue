import type { ruleMatchTypes } from './dto/records';

export interface MatchableRule {
  matchType: (typeof ruleMatchTypes)[number];
  pattern: string;
  categoryId: string;
  priority: number;
  enabled: boolean;
}

export interface MatchableTransaction {
  merchant?: string | null;
  vpa?: string | null;
  note?: string | null;
}

function ruleMatches(rule: MatchableRule, txn: MatchableTransaction): boolean {
  const pattern = rule.pattern.trim().toLowerCase();
  const merchant = (txn.merchant ?? '').trim().toLowerCase();
  switch (rule.matchType) {
    case 'MERCHANT_EQUALS':
      return merchant !== '' && merchant === pattern;
    case 'MERCHANT_CONTAINS':
      return merchant !== '' && merchant.includes(pattern);
    case 'VPA_EQUALS':
      return (txn.vpa ?? '').trim().toLowerCase() === pattern && pattern !== '';
    case 'REMARKS_REGEX':
      try {
        return new RegExp(rule.pattern, 'i').test(
          [txn.merchant, txn.note].filter(Boolean).join(' '),
        );
      } catch {
        return false; // an invalid pattern never matches rather than breaking every transaction
      }
  }
}

/**
 * The category of the first enabled rule that matches, lowest priority number first
 * (ties keep the order given). Used on the server and offline in the web app, so the same
 * merchant is categorised the same way everywhere.
 */
export function matchCategoryRule(
  rules: MatchableRule[],
  txn: MatchableTransaction,
): string | null {
  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled)
    .sort((a, b) => a.rule.priority - b.rule.priority || a.index - b.index);
  return ordered.find(({ rule }) => ruleMatches(rule, txn))?.rule.categoryId ?? null;
}
