import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from './db';
import { resetDeviceIdCacheForTests } from './device';
import {
  addTransaction,
  bulkCategorise,
  createRecurringItem,
  deleteRecord,
  deleteRecurringItem,
  deleteTransaction,
  markOccurrencePaid,
  saveRecord,
  setAmountFrom,
  skipOccurrence,
  unmarkOccurrence,
  updateTransaction,
} from './repo';

let n = 0;
const FUEL = '11111111-1111-4111-8111-111111111111';
const SALARY = '22222222-2222-4222-8222-222222222222';
const CASH = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-11-03T10:00:00.000Z';

beforeEach(async () => {
  resetDbForTests(`repo-${++n}`);
  resetDeviceIdCacheForTests();
  const db = getDb();
  const meta = {
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    editedAt: NOW,
    deletedAt: null,
    lastDeviceId: null,
  };
  await db.categories.bulkPut([
    {
      id: FUEL,
      name: 'Fuel',
      kind: 'EXPENSE',
      parentId: null,
      icon: null,
      color: null,
      sortOrder: 0,
      quickPick: true,
      ...meta,
    },
    {
      id: SALARY,
      name: 'Salary',
      kind: 'INCOME',
      parentId: null,
      icon: null,
      color: null,
      sortOrder: 1,
      quickPick: false,
      ...meta,
    },
  ]);
});

const outbox = () => getDb().outbox.orderBy('id').toArray();
const base = { type: 'EXPENSE' as const, amountPaise: 45_000, accountId: CASH, occurredAt: NOW };

describe('saveRecord', () => {
  it('writes locally first and queues the change for the server', async () => {
    const row = await saveRecord('account', {
      name: 'Wallet',
      type: 'WALLET',
      balancePaise: 0,
      archived: false,
    });
    expect(await getDb().accounts.get(row.id)).toMatchObject({
      name: 'Wallet',
      version: 0,
      deletedAt: null,
    });
    const [op] = await outbox();
    expect(op).toMatchObject({
      entity: 'account',
      entityId: row.id,
      op: 'upsert',
      baseVersion: 0,
      attempts: 0,
    });
    expect(op!.data).toMatchObject({ id: row.id, name: 'Wallet' });
    expect(op!.data).not.toHaveProperty('version'); // metadata is not sent
    expect(op!.data).not.toHaveProperty('editedAt');
    expect(Date.parse(op!.editedAt)).not.toBeNaN();
  });

  it('records the device that made the edit', async () => {
    const row = await saveRecord('account', { name: 'Wallet', type: 'WALLET' });
    expect(row.lastDeviceId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it('merges repeated edits to one record into a single op that keeps the confirmed base version', async () => {
    await getDb().accounts.put({
      id: 'acc-1',
      name: 'Old',
      type: 'BANK',
      last4: null,
      balancePaise: 0,
      balanceAsOf: null,
      creditLimitPaise: null,
      archived: false,
      version: 3,
      createdAt: NOW,
      updatedAt: NOW,
      editedAt: NOW,
      deletedAt: null,
      lastDeviceId: null,
    });
    await saveRecord('account', { id: 'acc-1', name: 'First edit' });
    await saveRecord('account', { id: 'acc-1', name: 'Second edit' });
    const ops = await outbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ baseVersion: 3, op: 'upsert' });
    expect(ops[0]!.data).toMatchObject({ name: 'Second edit' });
  });
});

describe('deleteRecord', () => {
  it('forgets a record created and deleted before it ever synced', async () => {
    const row = await saveRecord('account', { name: 'Temp', type: 'CASH' });
    await deleteRecord('account', row.id);
    expect(await getDb().accounts.get(row.id)).toBeUndefined();
    expect(await outbox()).toEqual([]);
  });

  it('queues one delete for a synced record, even after pending edits', async () => {
    await getDb().accounts.put({
      id: 'acc-2',
      name: 'Synced',
      type: 'BANK',
      last4: null,
      balancePaise: 0,
      balanceAsOf: null,
      creditLimitPaise: null,
      archived: false,
      version: 5,
      createdAt: NOW,
      updatedAt: NOW,
      editedAt: NOW,
      deletedAt: null,
      lastDeviceId: null,
    });
    await saveRecord('account', { id: 'acc-2', name: 'Edited' });
    await deleteRecord('account', 'acc-2');
    await deleteRecord('account', 'acc-2'); // nothing left locally: a no-op
    const ops = await outbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'delete', baseVersion: 5 });
    expect(await getDb().accounts.get('acc-2')).toBeUndefined();
  });

  it('turns a delete back into an edit if the record is saved again', async () => {
    await getDb().accounts.put({
      id: 'acc-3',
      name: 'Synced',
      type: 'BANK',
      last4: null,
      balancePaise: 0,
      balanceAsOf: null,
      creditLimitPaise: null,
      archived: false,
      version: 2,
      createdAt: NOW,
      updatedAt: NOW,
      editedAt: NOW,
      deletedAt: null,
      lastDeviceId: null,
    });
    await deleteRecord('account', 'acc-3');
    await saveRecord('account', { id: 'acc-3', name: 'Back', type: 'BANK' });
    const ops = await outbox();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'upsert', baseVersion: 2 });
  });

  it('ignores a record that does not exist', async () => {
    await deleteRecord('account', 'nope');
    expect(await outbox()).toEqual([]);
  });
});

describe('transactions', () => {
  it('adds an expense with sensible defaults', async () => {
    const row = await addTransaction({ ...base, categoryId: FUEL, merchant: 'Shell' });
    expect(row).toMatchObject({
      type: 'EXPENSE',
      amountPaise: 45_000,
      status: 'POSTED',
      source: 'MANUAL',
      tags: [],
      categoryId: FUEL,
      categorisedVia: 'MANUAL',
    });
    expect(await getDb().transactions.count()).toBe(1);
  });

  it('categorises from a merchant rule offline, exactly as the server would', async () => {
    await getDb().categoryRules.put({
      id: 'r1',
      matchType: 'MERCHANT_CONTAINS',
      pattern: 'shell',
      categoryId: FUEL,
      priority: 100,
      enabled: true,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
      editedAt: NOW,
      deletedAt: null,
      lastDeviceId: null,
    });
    expect(await addTransaction({ ...base, merchant: 'SHELL Pune' })).toMatchObject({
      categoryId: FUEL,
      categorisedVia: 'RULE',
    });
    expect((await addTransaction({ ...base, merchant: 'Corner shop' })).categoryId).toBeUndefined();
    // a fuel rule must not label income, and an explicit choice is never overridden
    expect(
      (await addTransaction({ ...base, type: 'INCOME', merchant: 'Shell' })).categoryId,
    ).toBeUndefined();
    expect(
      await addTransaction({ ...base, merchant: 'Shell', categoryId: SALARY, type: 'INCOME' }),
    ).toMatchObject({ categoryId: SALARY, categorisedVia: 'MANUAL' });
  });

  it('edits, recategorises and clears the category', async () => {
    const { id } = await addTransaction({ ...base, categoryId: FUEL });
    expect(await updateTransaction(id, { note: 'petrol' })).toMatchObject({
      note: 'petrol',
      categoryId: FUEL,
      categorisedVia: 'MANUAL',
    });
    expect(await updateTransaction(id, { categoryId: null })).toMatchObject({
      categoryId: null,
      categorisedVia: null,
    });
    await expect(updateTransaction('missing', { note: 'x' })).rejects.toThrow('not found');
  });

  it('recategorises many at once, and deletes', async () => {
    const a = await addTransaction(base);
    const b = await addTransaction(base);
    await bulkCategorise([a.id, b.id], FUEL);
    expect((await getDb().transactions.bulkGet([a.id, b.id])).map((t) => t?.categoryId)).toEqual([
      FUEL,
      FUEL,
    ]);
    await deleteTransaction(a.id);
    expect(await getDb().transactions.get(a.id)).toBeUndefined();
  });

  it('keeps the pending create as the only op for a transaction edited before syncing', async () => {
    const { id } = await addTransaction(base);
    await updateTransaction(id, { note: 'edited' });
    const ops = (await outbox()).filter((op) => op.entityId === id);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ baseVersion: 0 });
    expect(ops[0]!.data).toMatchObject({ note: 'edited' });
  });
});

describe('recurring bills', () => {
  const emi = {
    kind: 'EXPENSE' as const,
    name: 'Personal loan EMI',
    frequency: 'MONTHLY' as const,
    dueDay: 5,
    startDate: '2026-11-01',
    amountPaise: 450_000,
  };

  it('queues the item before its first amount, so the server sees them in dependency order', async () => {
    const item = await createRecurringItem(emi);
    const ops = await outbox();
    expect(ops.map((op) => op.entity)).toEqual(['recurringItem', 'recurringAmountPeriod']);
    expect(ops[1]!.data).toMatchObject({
      recurringItemId: item.id,
      effectiveFrom: '2026-11-01',
      amountPaise: 450_000,
    });
    expect(ops[0]!.data).not.toHaveProperty('amountPaise');
  });

  it('changes the amount from a date, updating an existing period in place', async () => {
    const item = await createRecurringItem(emi);
    await setAmountFrom(item.id, '2027-05-01', 120_000);
    await setAmountFrom(item.id, '2027-05-01', 130_000);
    const periods = await getDb()
      .recurringPeriods.where('recurringItemId')
      .equals(item.id)
      .toArray();
    expect(periods.map((p) => [p.effectiveFrom, p.amountPaise]).sort()).toEqual([
      ['2026-11-01', 450_000],
      ['2027-05-01', 130_000],
    ]);
  });

  const seedOccurrence = async (itemId: string, over: Record<string, unknown> = {}) => {
    const occurrence = {
      id: 'occ-1',
      recurringItemId: itemId,
      dueDate: '2026-11-05',
      label: null,
      expectedAmountPaise: 450_000,
      status: 'UPCOMING' as const,
      paidAt: null,
      paidAmountPaise: null,
      snoozedUntil: null,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
      editedAt: NOW,
      deletedAt: null,
      lastDeviceId: null,
      ...over,
    };
    await getDb().occurrences.put(occurrence);
    return occurrence;
  };

  it('marks a due date paid and records the transaction when asked', async () => {
    const item = await createRecurringItem({ ...emi, accountId: CASH, categoryId: FUEL });
    await seedOccurrence(item.id);
    await markOccurrencePaid('occ-1', { createTransaction: true });
    expect(await getDb().occurrences.get('occ-1')).toMatchObject({
      status: 'PAID',
      paidAmountPaise: 450_000,
    });
    const [txn] = await getDb().transactions.toArray();
    expect(txn).toMatchObject({
      type: 'EXPENSE',
      amountPaise: 450_000,
      merchant: 'Personal loan EMI',
      source: 'RECURRING',
      accountId: CASH,
    });
  });

  it('marks paid with a custom amount, without a transaction, and repeating changes nothing', async () => {
    const item = await createRecurringItem(emi);
    await seedOccurrence(item.id);
    await markOccurrencePaid('occ-1', { amountPaise: 400_000 });
    await markOccurrencePaid('occ-1', { amountPaise: 1 });
    expect(await getDb().occurrences.get('occ-1')).toMatchObject({
      status: 'PAID',
      paidAmountPaise: 400_000,
    });
    expect(await getDb().transactions.count()).toBe(0);
    await expect(markOccurrencePaid('missing')).rejects.toThrow('not found');
  });

  it('undoes and skips a due date', async () => {
    const item = await createRecurringItem(emi);
    await seedOccurrence(item.id, { status: 'PAID', paidAt: NOW, paidAmountPaise: 450_000 });
    await unmarkOccurrence('occ-1');
    expect(await getDb().occurrences.get('occ-1')).toMatchObject({
      status: 'UPCOMING',
      paidAt: null,
      paidAmountPaise: null,
    });
    await skipOccurrence('occ-1');
    expect((await getDb().occurrences.get('occ-1'))!.status).toBe('SKIPPED');
    await unmarkOccurrence('missing');
    await skipOccurrence('missing');
  });

  it('deleting an item hides its upcoming due dates at once but keeps paid history', async () => {
    const item = await createRecurringItem(emi);
    await seedOccurrence(item.id, { id: 'up' });
    await seedOccurrence(item.id, { id: 'paid', status: 'PAID' });
    await deleteRecurringItem(item.id);
    expect(await getDb().recurringItems.get(item.id)).toBeUndefined();
    expect(await getDb().occurrences.get('up')).toBeUndefined();
    expect(await getDb().occurrences.get('paid')).toBeDefined();
  });
});
