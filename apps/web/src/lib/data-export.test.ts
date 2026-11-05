import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from './db';
import { resetDeviceIdCacheForTests } from './device';
import {
  applyRestore,
  dataDocumentText,
  encryptedBackupText,
  exportFilename,
  isPlainExport,
  planRestore,
  rangeDates,
  readBackupFile,
  transactionsCsv,
} from './data-export';

let n = 0;
const NOW = new Date('2026-11-05T10:00:00Z');
const STAMP = '2026-11-01T00:00:00.000Z';
const META = {
  version: 2,
  createdAt: STAMP,
  updatedAt: STAMP,
  editedAt: STAMP,
  deletedAt: null,
  lastDeviceId: null,
};
const BANK = '33333333-3333-4333-8333-333333333333';
const FUEL = '11111111-1111-4111-8111-111111111111';
const LOAN = '44444444-4444-4444-8444-444444444444';

async function seed() {
  const db = getDb();
  await db.accounts.put({
    id: BANK,
    name: 'Salary',
    type: 'BANK',
    balancePaise: 100000,
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
  const txn = (id: string, occurredAt: string, extra: Record<string, unknown> = {}) =>
    db.transactions.put({
      id,
      type: 'EXPENSE',
      amountPaise: 45000,
      accountId: BANK,
      categoryId: FUEL,
      occurredAt,
      status: 'POSTED',
      source: 'MANUAL',
      tags: [],
      ...META,
      ...extra,
    } as never);
  await txn('00000000-0000-4000-8000-000000000001', '2026-11-04T10:00:00Z', { merchant: 'SHELL' });
  await txn('00000000-0000-4000-8000-000000000002', '2026-10-10T10:00:00Z');
  await txn('00000000-0000-4000-8000-000000000003', '2026-11-04T11:00:00Z', { status: 'IGNORED' });
}

beforeEach(() => {
  resetDbForTests(`export-${++n}`);
  resetDeviceIdCacheForTests();
});

describe('export ranges', () => {
  it('covers calendar months, including across a year end', () => {
    expect(rangeDates('month', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(rangeDates('last-month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    const january = new Date('2027-01-10T10:00:00Z');
    expect(rangeDates('last-month', january)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(rangeDates('month', new Date('2026-12-10T10:00:00Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('covers the Indian financial year', () => {
    expect(rangeDates('fy', NOW)).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(rangeDates('fy', new Date('2027-02-01T10:00:00Z'))).toEqual({
      from: '2026-04-01',
      to: '2027-03-31',
    });
    expect(rangeDates('last-fy', NOW)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(rangeDates('all', NOW)).toEqual({});
  });

  it('names files by date', () => {
    expect(exportFilename('transactions', 'csv', NOW)).toBe('zerodue-transactions-2026-11-05.csv');
  });
});

describe('transactions csv', () => {
  it('limits to the range and leaves out ignored payments', async () => {
    await seed();
    const month = (await transactionsCsv('month', NOW)).trim().split('\r\n');
    expect(month).toHaveLength(2);
    expect(month[1]).toContain('SHELL');
    expect(month[1]).toContain('Salary,,Fuel');
    expect((await transactionsCsv('all', NOW)).trim().split('\r\n')).toHaveLength(3);
  });
});

describe('backup and restore', () => {
  it('exports every record without deleted ones', async () => {
    await seed();
    await getDb().accounts.put({
      id: LOAN,
      name: 'Gone',
      type: 'CASH',
      balancePaise: 0,
      archived: false,
      ...META,
      deletedAt: STAMP,
    });
    const doc = JSON.parse(await dataDocumentText(NOW));
    expect(doc.format).toBe('zerodue-data');
    expect(doc.tables.account.map((a: { name: string }) => a.name)).toEqual(['Salary']);
    expect(doc.tables.transaction).toHaveLength(3);
  });

  it('restores an encrypted backup into an empty device and queues it to sync', async () => {
    await seed();
    const text = await encryptedBackupText('a long passphrase', NOW);
    expect(text).not.toContain('SHELL');
    expect(isPlainExport(text)).toBe(false);

    resetDbForTests(`export-${++n}`);
    const data = await readBackupFile(text, 'a long passphrase');
    const plan = await planRestore(data);
    expect(plan.counts.account).toEqual({ add: 1, change: 0, same: 0 });
    expect(plan.counts.transaction).toEqual({ add: 3, change: 0, same: 0 });

    const progress: number[] = [];
    const { written } = await applyRestore(data, 'missing', (done) => progress.push(done));
    expect(written).toBe(5);
    expect(progress.at(-1)).toBe(5);
    const db = getDb();
    expect(await db.transactions.count()).toBe(3);
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(5);
    // parents are queued before what points at them
    const order = ops.map((o) => o.entity);
    expect(order.indexOf('account')).toBeLessThan(order.indexOf('transaction'));
    expect(order.indexOf('category')).toBeLessThan(order.indexOf('transaction'));
    expect(ops.every((o) => o.baseVersion === 0 && o.op === 'upsert')).toBe(true);
  });

  it('rejects a wrong passphrase and files that are not ours', async () => {
    await seed();
    const text = await encryptedBackupText('a long passphrase', NOW);
    await expect(readBackupFile(text, 'not the passphrase')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
    await expect(readBackupFile('hello', 'x')).rejects.toMatchObject({ code: 'NOT_A_BACKUP' });
    expect(isPlainExport('hello')).toBe(false);
  });

  it('restores a plain export without a passphrase', async () => {
    await seed();
    const text = await dataDocumentText(NOW);
    expect(isPlainExport(text)).toBe(true);
    const data = await readBackupFile(text, '');
    expect(data.records.account).toHaveLength(1);
  });

  it('adds only what is missing, or also puts back changed records', async () => {
    await seed();
    const data = await readBackupFile(await dataDocumentText(NOW), '');
    const db = getDb();
    await db.accounts.update(BANK, { name: 'Renamed' });
    await db.transactions.delete('00000000-0000-4000-8000-000000000002');

    const plan = await planRestore(data);
    expect(plan.counts.account).toEqual({ add: 0, change: 1, same: 0 });
    expect(plan.counts.transaction).toEqual({ add: 1, change: 0, same: 2 });

    expect((await applyRestore(data, 'missing')).written).toBe(1);
    expect((await db.accounts.get(BANK))?.name).toBe('Renamed');
    expect(await db.transactions.count()).toBe(3);

    expect((await applyRestore(data, 'all')).written).toBe(1);
    expect((await db.accounts.get(BANK))?.name).toBe('Salary');
  });

  it('skips due dates and says how many', async () => {
    await seed();
    await getDb().occurrences.put({
      id: '55555555-5555-4555-8555-555555555555',
      recurringItemId: '66666666-6666-4666-8666-666666666666',
      dueDate: '2026-11-10',
      expectedAmountPaise: 100,
      status: 'UPCOMING',
      ...META,
    } as never);
    const data = await readBackupFile(await dataDocumentText(NOW), '');
    expect((await planRestore(data)).skipped).toBe(1);
    await applyRestore(data, 'all');
    expect(await getDb().outbox.where('entity').equals('recurringOccurrence').count()).toBe(0);
  });
});
