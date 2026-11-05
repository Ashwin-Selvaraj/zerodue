import 'fake-indexeddb/auto';
import type { StatementRow, TransactionDto } from '@zerodue/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from './db';
import { resetDeviceIdCacheForTests } from './device';
import { importRows, planImport, rowsBeforeBalanceDate } from './statement-import';

let n = 0;
const BANK = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const FUEL = '11111111-1111-4111-8111-111111111111';
const STAMP = '2026-11-01T00:00:00.000Z';
const META = {
  version: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
  editedAt: STAMP,
  deletedAt: null,
  lastDeviceId: null,
};

const row = (over: Partial<StatementRow> = {}): StatementRow => ({
  row: 2,
  date: '2026-11-03',
  type: 'EXPENSE',
  amountPaise: 45000,
  description: 'UPI/412345678901/Payment/shell@okaxis/SHELL',
  merchant: 'SHELL',
  vpa: 'shell@okaxis',
  upiRef: null,
  balancePaise: null,
  ...over,
});

let counter = 0;
const txn = (over: Partial<TransactionDto> = {}): TransactionDto =>
  ({
    id: `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    type: 'EXPENSE',
    status: 'POSTED',
    amountPaise: 45000,
    accountId: BANK,
    categoryId: null,
    occurredAt: '2026-11-03T10:00:00+05:30',
    tags: [],
    source: 'SMS_BANK',
    upiRef: null,
    occurrenceId: null,
    ...META,
    ...over,
  }) as TransactionDto;

beforeEach(() => {
  resetDbForTests(`import-${++n}`);
  resetDeviceIdCacheForTests();
  counter = 0;
});

describe('planning an import', () => {
  it('marks a row that was already captured the same day', () => {
    const existing = txn();
    const [planned] = planImport([row()], BANK, [existing]);
    expect(planned!.duplicateOf).toBe(existing.id);
  });

  it('allows a day either side, but not two', () => {
    const dayBefore = txn({ occurredAt: '2026-11-02T23:30:00+05:30' });
    const twoApart = txn({ occurredAt: '2026-11-01T10:00:00+05:30' });
    expect(planImport([row()], BANK, [dayBefore])[0]!.duplicateOf).toBe(dayBefore.id);
    expect(planImport([row()], BANK, [twoApart])[0]!.duplicateOf).toBeNull();
  });

  it('needs the same direction and amount', () => {
    expect(planImport([row()], BANK, [txn({ type: 'INCOME' })])[0]!.duplicateOf).toBeNull();
    expect(planImport([row()], BANK, [txn({ amountPaise: 45001 })])[0]!.duplicateOf).toBeNull();
  });

  it('ignores ignored payments and transfers', () => {
    expect(planImport([row()], BANK, [txn({ status: 'IGNORED' })])[0]!.duplicateOf).toBeNull();
    expect(planImport([row()], BANK, [txn({ type: 'TRANSFER' })])[0]!.duplicateOf).toBeNull();
  });

  it('trusts a shared UPI reference, and refuses different ones', () => {
    const sameRef = txn({ upiRef: '412345678901', occurredAt: '2026-10-20T10:00:00+05:30' });
    expect(planImport([row({ upiRef: '412345678901' })], BANK, [sameRef])[0]!.duplicateOf).toBe(
      sameRef.id,
    );
    const otherRef = txn({ upiRef: '999999999999' });
    expect(
      planImport([row({ upiRef: '412345678901' })], BANK, [otherRef])[0]!.duplicateOf,
    ).toBeNull();
    // only one side has a reference: fall back to amount and date
    expect(
      planImport([row({ upiRef: '412345678901' })], BANK, [txn()])[0]!.duplicateOf,
    ).not.toBeNull();
  });

  it('matches each recorded payment to one row only', () => {
    const planned = planImport([row({ row: 2 }), row({ row: 3 })], BANK, [txn()]);
    expect(planned.map((p) => p.duplicateOf !== null)).toEqual([true, false]);
    expect(
      planImport([row({ row: 2 }), row({ row: 3 })], BANK, [txn(), txn()]).every(
        (p) => p.duplicateOf,
      ),
    ).toBe(true);
  });

  it('prefers the closest day, then the same account', () => {
    const farther = txn({ occurredAt: '2026-11-04T10:00:00+05:30' });
    const nearer = txn({ occurredAt: '2026-11-03T10:00:00+05:30' });
    expect(planImport([row()], BANK, [farther, nearer])[0]!.duplicateOf).toBe(nearer.id);
    const otherAccount = txn({ accountId: OTHER });
    const sameAccount = txn({ accountId: BANK });
    expect(planImport([row()], BANK, [otherAccount, sameAccount])[0]!.duplicateOf).toBe(
      sameAccount.id,
    );
  });

  it('recognises a statement that was imported before', async () => {
    await getDb().accounts.put({
      id: BANK,
      name: 'Salary',
      type: 'BANK',
      balancePaise: 0,
      archived: false,
      ...META,
    });
    const rows = [row({ row: 2 }), row({ row: 3, amountPaise: 9900, date: '2026-11-04' })];
    await importRows(rows, BANK);
    const again = planImport(rows, BANK, await getDb().transactions.toArray());
    expect(again.every((p) => p.duplicateOf)).toBe(true);
  });
});

describe('importing', () => {
  beforeEach(async () => {
    const db = getDb();
    await db.accounts.put({
      id: BANK,
      name: 'Salary',
      type: 'BANK',
      balancePaise: 0,
      archived: false,
      ...META,
    });
    await db.categories.put({
      id: FUEL,
      name: 'Fuel',
      kind: 'EXPENSE',
      sortOrder: 0,
      quickPick: true,
      ...META,
    });
    await db.categoryRules.put({
      id: '55555555-5555-4555-8555-555555555555',
      matchType: 'MERCHANT_CONTAINS',
      pattern: 'shell',
      categoryId: FUEL,
      priority: 10,
      enabled: true,
      ...META,
    });
  });

  it('records rows at noon IST, files what a rule knows and leaves the rest for the inbox', async () => {
    const progress: number[] = [];
    const count = await importRows(
      [row(), row({ merchant: 'MYSTERY', description: 'POS 1234', vpa: null, date: '2026-11-04' })],
      BANK,
      (done) => progress.push(done),
    );
    expect(count).toBe(2);
    expect(progress).toEqual([1, 2]);
    const saved = (await getDb().transactions.toArray()).sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt),
    );
    expect(saved[0]).toMatchObject({
      occurredAt: '2026-11-03T06:30:00.000Z', // noon IST
      source: 'STATEMENT_IMPORT',
      status: 'POSTED',
      categoryId: FUEL,
      vpa: 'shell@okaxis',
      note: 'UPI/412345678901/Payment/shell@okaxis/SHELL',
    });
    expect(saved[1]).toMatchObject({ status: 'PENDING_CATEGORY' });
    expect(saved[1]!.categoryId ?? null).toBeNull();
    expect(await getDb().outbox.count()).toBe(2);
  });

  it('counts rows older than the balance date', () => {
    const rows = [row({ date: '2026-10-31' }), row({ date: '2026-11-01' })];
    expect(rowsBeforeBalanceDate(rows, '2026-11-01')).toBe(1);
    expect(rowsBeforeBalanceDate(rows, null)).toBe(0);
  });
});
