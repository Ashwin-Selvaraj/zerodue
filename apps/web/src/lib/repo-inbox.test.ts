import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from './db';
import { resetDeviceIdCacheForTests } from './device';
import { categorisePending, ignoreTransaction } from './repo';

let n = 0;
const FUEL = '11111111-1111-4111-8111-111111111111';
const BANK = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-11-05T10:00:00.000Z';
const META = {
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  editedAt: NOW,
  deletedAt: null,
  lastDeviceId: null,
};

beforeEach(async () => {
  resetDbForTests(`inbox-${++n}`);
  resetDeviceIdCacheForTests();
  await getDb().categories.put({
    id: FUEL,
    name: 'Fuel',
    kind: 'EXPENSE',
    parentId: null,
    icon: null,
    color: null,
    sortOrder: 0,
    quickPick: true,
    ...META,
  });
});

const captured = async (overrides: Record<string, unknown> = {}) => {
  const row = {
    id: crypto.randomUUID(),
    type: 'EXPENSE' as const,
    status: 'PENDING_CATEGORY' as const,
    amountPaise: 45_000,
    accountId: BANK,
    occurredAt: NOW,
    merchant: 'SHELL',
    tags: [],
    source: 'SMS_BANK' as const,
    occurrenceId: null,
    ...META,
    ...overrides,
  };
  await getDb().transactions.put(row as never);
  return row.id;
};

describe('categorisePending', () => {
  it('categorises the payment, posts it, and queues the change', async () => {
    const id = await captured();
    await categorisePending(id, FUEL, false);
    expect(await getDb().transactions.get(id)).toMatchObject({
      categoryId: FUEL,
      status: 'POSTED',
      categorisedVia: 'MANUAL',
    });
    expect((await getDb().outbox.toArray()).map((o) => o.entity)).toEqual(['transaction']);
    expect(await getDb().categoryRules.count()).toBe(0);
  });

  it('remembers the merchant when asked, once', async () => {
    const first = await captured();
    const second = await captured();
    await categorisePending(first, FUEL, true);
    await categorisePending(second, FUEL, true);
    const rules = await getDb().categoryRules.toArray();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      matchType: 'MERCHANT_EQUALS',
      pattern: 'SHELL',
      categoryId: FUEL,
    });
  });

  it('treats a rule for the same merchant in another case as the same rule', async () => {
    await categorisePending(await captured({ merchant: 'Shell' }), FUEL, true);
    await categorisePending(await captured({ merchant: 'SHELL' }), FUEL, true);
    expect(await getDb().categoryRules.count()).toBe(1);
  });

  it('remembers nothing when there is no merchant, and rejects an unknown payment', async () => {
    await categorisePending(await captured({ merchant: null, vpa: 'x@y' }), FUEL, true);
    expect(await getDb().categoryRules.count()).toBe(0);
    await expect(categorisePending('missing', FUEL, false)).rejects.toThrow('not found');
  });
});

describe('ignoreTransaction', () => {
  it('marks the payment ignored', async () => {
    const id = await captured();
    await ignoreTransaction(id);
    expect(await getDb().transactions.get(id)).toMatchObject({ status: 'IGNORED' });
    await expect(ignoreTransaction('missing')).rejects.toThrow('not found');
  });
});
