import { assertBps, assertPaise, divRound } from './guards';

/**
 * ROUND_HALF_UP_RUPEE – interest is rounded to the nearest whole rupee each month (the default).
 * CARRY_PAISE        – interest is kept to the paisa, with no rupee rounding.
 */
export type InterestRounding = 'ROUND_HALF_UP_RUPEE' | 'CARRY_PAISE';

/**
 * One month of interest: opening balance × annual rate ÷ 12, in integer arithmetic.
 * `annualRateBps` is basis points (8.5% = 850).
 */
export function monthlyInterest(
  openingPaise: number,
  annualRateBps: number,
  rounding: InterestRounding,
): number {
  assertPaise(openingPaise, 'openingPaise');
  assertBps(annualRateBps, 'annualRateBps');
  const scaled = openingPaise * annualRateBps; // paise × bps; safe up to ~₹9 lakh crore at 100%
  return rounding === 'ROUND_HALF_UP_RUPEE'
    ? divRound(scaled, 12 * 10_000 * 100) * 100
    : divRound(scaled, 12 * 10_000);
}
