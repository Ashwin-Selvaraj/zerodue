import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { claimLocalData, getDb, readMeta, resetDbForTests, writeMeta } from './db';

let n = 0;
beforeEach(() => {
  resetDbForTests(`db-${++n}`);
});

describe('claimLocalData', () => {
  it('keeps data that already belongs to the user', async () => {
    await claimLocalData('user-a');
    await writeMeta('note', 'kept');
    expect(await claimLocalData('user-a')).toBe(false);
    expect(await readMeta('note')).toBe('kept');
  });

  it('wipes another user’s data, but keeps the device id', async () => {
    await writeMeta('deviceId', 'device-1');
    await claimLocalData('user-a');
    await getDb().outbox.add({
      entity: 'account',
      entityId: 'x',
      op: 'delete',
      editedAt: '2026-11-05T10:00:00+05:30',
      baseVersion: 1,
      createdAt: 1,
      rev: 1,
      attempts: 0,
    });
    await writeMeta('syncCursor', 'abc');

    expect(await claimLocalData('user-b')).toBe(true);
    expect(await getDb().outbox.count()).toBe(0);
    expect(await readMeta('syncCursor')).toBeUndefined();
    expect(await readMeta('deviceId')).toBe('device-1');
    expect(await readMeta('dataOwner')).toBe('user-b');
  });

  it('recognises data saved before owners were recorded by the cached profile', async () => {
    await writeMeta('profile', { id: 'user-a' });
    expect(await claimLocalData('user-a')).toBe(false);
    await getDb().meta.delete('dataOwner');
    expect(await claimLocalData('user-b')).toBe(true);
  });

  it('claims an empty database without clearing anything', async () => {
    expect(await claimLocalData('user-a')).toBe(false);
    expect(await readMeta('dataOwner')).toBe('user-a');
  });
});
