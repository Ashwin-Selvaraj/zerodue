/**
 * Money helpers. All amounts are integer paise; never floats.
 * Display uses Indian digit grouping: ₹1,29,300 / ₹6,00,000.
 */

const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const inrFractional = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrNumber = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function assertPaise(paise: number): void {
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(`Amount must be an integer number of paise, got ${paise}`);
  }
}

/** Formats paise as ₹ with Indian grouping. Whole rupees drop the decimals: ₹1,29,300; ₹123.45 keeps them. */
export function formatINR(paise: number): string {
  assertPaise(paise);
  const rupees = paise / 100;
  return paise % 100 === 0 ? inrWhole.format(rupees) : inrFractional.format(rupees);
}

/** Like {@link formatINR} but without the ₹ sign, for table cells and exports: 1,29,300 */
export function formatINRNumber(paise: number): string {
  assertPaise(paise);
  return inrNumber.format(paise / 100);
}

/** Signed form for deltas in a waterfall: "+₹20,000" / "−₹4,500". */
export function formatINRSigned(paise: number): string {
  assertPaise(paise);
  if (paise === 0) return formatINR(0);
  return `${paise > 0 ? '+' : '−'}${formatINR(Math.abs(paise))}`;
}

/**
 * Converts a rupee amount to integer paise.
 * Strings (e.g. "1,29,300.50") are parsed strictly: more than two decimals is an error.
 * Numbers are rounded to the nearest paisa, since a float may carry noise like 0.30000000000000004.
 * Prefer passing the raw string from an input field.
 */
export function toPaise(rupees: number | string): number {
  if (typeof rupees === 'number') {
    if (!Number.isFinite(rupees)) throw new RangeError(`Invalid rupee amount: ${rupees}`);
    return Math.round(rupees * 100);
  }
  const text = rupees.replace(/[₹,\s]/g, '');
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new RangeError(`Invalid rupee amount: ${String(rupees)}`);
  const [, sign, whole, frac = ''] = match;
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return sign ? -paise : paise;
}

/** Converts integer paise to a rupee number. Only for display/charting, never for further money math. */
export function toRupees(paise: number): number {
  assertPaise(paise);
  return paise / 100;
}
