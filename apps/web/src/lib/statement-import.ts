import { isoDateIST, type StatementRow, type TransactionDto } from '@zerodue/shared';
import { getDb } from './db';
import { addTransaction } from './repo';

/** Importing a bank statement: which rows are already recorded, and recording the rest. */

export interface PlannedRow {
  row: StatementRow;
  /** The payment already recorded that this row is the same as, if any. */
  duplicateOf: string | null;
}

const dayNumber = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * Marks the rows that are already recorded, e.g. captured from the bank's SMS or imported before.
 * A row matches a payment of the same direction and amount on the same day or a day either side; if
 * both carry a UPI reference the references must agree. Each recorded payment matches one row only,
 * so two identical coffees on one day are still two payments.
 */
export function planImport(
  rows: StatementRow[],
  accountId: string,
  existing: TransactionDto[],
): PlannedRow[] {
  const pool = existing.filter((t) => t.status !== 'IGNORED' && t.type !== 'TRANSFER');
  const taken = new Set<string>();
  const matched = new Map<StatementRow, string>();

  // a shared UPI reference is the strongest evidence, so settle those first
  for (const row of rows) {
    if (!row.upiRef) continue;
    const found = pool.find(
      (t) =>
        !taken.has(t.id) &&
        t.upiRef === row.upiRef &&
        t.type === row.type &&
        t.amountPaise === row.amountPaise,
    );
    if (found) {
      taken.add(found.id);
      matched.set(row, found.id);
    }
  }

  for (const row of rows) {
    if (matched.has(row)) continue;
    const wanted = dayNumber(row.date);
    const candidates = pool
      .filter((t) => {
        if (taken.has(t.id) || t.type !== row.type || t.amountPaise !== row.amountPaise)
          return false;
        if (t.upiRef && row.upiRef && t.upiRef !== row.upiRef) return false;
        return Math.abs(dayNumber(isoDateIST(t.occurredAt)) - wanted) <= 1;
      })
      .map((t) => ({
        t,
        apart: Math.abs(dayNumber(isoDateIST(t.occurredAt)) - wanted),
        sameAccount: t.accountId === accountId ? 0 : 1,
      }))
      .sort((a, b) => a.apart - b.apart || a.sameAccount - b.sameAccount);
    const best = candidates[0];
    if (best) {
      taken.add(best.t.id);
      matched.set(row, best.t.id);
    }
  }
  return rows.map((row) => ({ row, duplicateOf: matched.get(row) ?? null }));
}

export async function existingTransactions(): Promise<TransactionDto[]> {
  return getDb().transactions.toArray();
}

/**
 * Records the given rows in an account. Statements carry no time, so each is placed at noon IST of
 * its date. Rows that a rule can categorise are filed; the rest wait in the Inbox.
 */
export async function importRows(
  rows: StatementRow[],
  accountId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  let done = 0;
  for (const row of rows) {
    await addTransaction({
      type: row.type,
      amountPaise: row.amountPaise,
      accountId,
      occurredAt: new Date(`${row.date}T12:00:00+05:30`).toISOString(),
      merchant: row.merchant,
      vpa: row.vpa,
      upiRef: row.upiRef,
      note: row.description || null,
      source: 'STATEMENT_IMPORT',
      status: 'PENDING_CATEGORY',
    });
    onProgress?.(++done, rows.length);
  }
  return done;
}

/** How many rows are older than the account's balance date, so they will not change its balance. */
export function rowsBeforeBalanceDate(
  rows: StatementRow[],
  balanceAsOf: string | null | undefined,
): number {
  return balanceAsOf ? rows.filter((r) => r.date < balanceAsOf).length : 0;
}
