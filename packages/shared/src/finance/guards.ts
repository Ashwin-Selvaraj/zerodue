/** Input checks shared by the finance engine. Money is integer paise, never floats. */

export function assertPaise(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer number of paise, got ${value}`);
  }
}

export function assertBps(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer of basis points, got ${value}`);
  }
}

/** Integer division rounded half up, for non-negative integers. */
export function divRound(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}
