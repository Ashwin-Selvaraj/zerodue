import 'fake-indexeddb/auto';
import type { AccountDto } from '@zerodue/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from './api';
import { getDb, readMeta, resetDbForTests } from './db';
import { resetDeviceIdCacheForTests } from './device';
import { saveRecord } from './repo';
import { getSyncState, resetSyncStateForTests, startSyncing, syncNow } from './sync';

let n = 0;
type PushOp = {
  entity: string;
  op: string;
  id: string;
  data?: Record<string, unknown>;
  baseVersion: number;
  editedAt: string;
};
type PushBody = { deviceId: string; ops: PushOp[] };
const fetchMock = vi.fn<typeof fetch>();
const NOW = '2026-11-03T10:00:00.000Z';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const emptyPull = (cursor = 'c0', hasMore = false) => json({ changes: {}, cursor, hasMore });
const accountRow = (id: string, over: Partial<AccountDto> = {}): AccountDto => ({
  id,
  name: 'Wallet',
  type: 'WALLET',
  last4: null,
  balancePaise: 0,
  balanceAsOf: null,
  creditLimitPaise: null,
  archived: false,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  editedAt: NOW,
  deletedAt: null,
  lastDeviceId: null,
  ...over,
});

/** Routes by path; `push` and `pull` are called with the parsed request. */
function server(handlers: {
  push?: (body: PushBody) => Response | Promise<Response>;
  pull?: (url: URL) => Response | Promise<Response>;
}) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/sync/push')
      return handlers.push ? handlers.push(JSON.parse(String(init?.body))) : json({ results: [] });
    if (url.pathname === '/sync/pull') return handlers.pull ? handlers.pull(url) : emptyPull();
    return json({ message: 'not found' }, 404);
  });
}
const pushes = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/sync/push'));

beforeEach(() => {
  resetDbForTests(`sync-${++n}`);
  resetDeviceIdCacheForTests();
  resetSyncStateForTests();
  setAccessToken('token');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('pushing', () => {
  it('sends the outbox, then records the version the server assigned', async () => {
    const row = await saveRecord('account', { name: 'Wallet', type: 'WALLET' });
    server({
      push: (body) =>
        json({
          results: body.ops.map((op: PushOp) => ({
            entity: op.entity,
            id: op.id,
            status: 'applied',
            version: 1,
          })),
        }),
    });
    await syncNow();

    const [[, init]] = pushes() as [[unknown, RequestInit]];
    const body = JSON.parse(String(init.body));
    expect(body.deviceId).toEqual(expect.any(String));
    expect(body.ops[0]).toMatchObject({
      entity: 'account',
      op: 'upsert',
      id: row.id,
      baseVersion: 0,
    });
    expect(await getDb().outbox.count()).toBe(0);
    expect((await getDb().accounts.get(row.id))!.version).toBe(1); // so the next edit is built on version 1
    expect(getSyncState().status).toBe('idle');
    expect(getSyncState().lastSyncedAt).not.toBeNull();
  });

  it("takes the server's record when it changed something while applying ours", async () => {
    const row = await saveRecord('account', { name: 'Wallet', type: 'WALLET' });
    server({
      push: () =>
        json({
          results: [
            {
              entity: 'account',
              id: row.id,
              status: 'applied',
              version: 1,
              serverRow: accountRow(row.id, { name: 'Wallet (server)' }),
            },
          ],
        }),
    });
    await syncNow();
    expect((await getDb().accounts.get(row.id))!.name).toBe('Wallet (server)');
  });

  it("accepts the server's newer version when ours lost a conflict", async () => {
    const row = await saveRecord('account', { name: 'Mine', type: 'WALLET' });
    server({
      push: () =>
        json({
          results: [
            {
              entity: 'account',
              id: row.id,
              status: 'conflict',
              serverRow: accountRow(row.id, { name: 'Theirs', version: 4 }),
            },
          ],
        }),
    });
    await syncNow();
    expect(await getDb().accounts.get(row.id)).toMatchObject({ name: 'Theirs', version: 4 });
    expect(await getDb().outbox.count()).toBe(0);
  });

  it('keeps a refused change visible, never resends it, and carries on with the rest', async () => {
    const bad = await saveRecord('account', { name: 'Bad', type: 'WALLET' });
    const good = await saveRecord('account', { name: 'Good', type: 'WALLET' });
    server({
      push: (body) =>
        json({
          results: body.ops.map((op: PushOp) =>
            op.id === bad.id
              ? { entity: op.entity, id: op.id, status: 'rejected', error: 'name: too long' }
              : { entity: op.entity, id: op.id, status: 'applied', version: 1 },
          ),
        }),
    });
    await syncNow();
    const left = await getDb().outbox.toArray();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ entityId: bad.id, failed: true, error: 'name: too long' });
    expect((await getDb().accounts.get(good.id))!.version).toBe(1);

    await syncNow();
    expect(pushes()).toHaveLength(1); // the refused change is not retried
  });

  it('keeps everything queued when offline and reports it', async () => {
    await saveRecord('account', { name: 'Wallet', type: 'WALLET' });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await syncNow();
    expect(await getDb().outbox.count()).toBe(1);
    expect(getSyncState().status).toBe('offline');
  });

  it('reports a server failure as an error and keeps the changes', async () => {
    await saveRecord('account', { name: 'Wallet', type: 'WALLET' });
    server({ push: () => json({ message: 'Internal server error' }, 500) });
    await syncNow();
    expect(await getDb().outbox.count()).toBe(1);
    expect(getSyncState()).toMatchObject({ status: 'error', error: 'Internal server error' });
  });

  it('does not lose an edit made while the push was in flight', async () => {
    const row = await saveRecord('account', { name: 'First', type: 'WALLET' });
    let call = 0;
    server({
      push: async (body) => {
        call++;
        if (call === 1) await saveRecord('account', { id: row.id, name: 'Second' }); // user edits mid-push
        return json({
          results: body.ops.map((op: PushOp) => ({
            entity: op.entity,
            id: op.id,
            status: 'applied',
            version: call,
          })),
        });
      },
    });
    await syncNow();

    expect(pushes()).toHaveLength(2);
    const second = JSON.parse(String((pushes()[1] as [unknown, RequestInit])[1].body));
    expect(second.ops[0]).toMatchObject({
      baseVersion: 1,
      data: expect.objectContaining({ name: 'Second' }),
    });
    expect(await getDb().outbox.count()).toBe(0);
    expect((await getDb().accounts.get(row.id))!.name).toBe('Second');
  });

  it('does not lose an edit made in the very same millisecond as the one being pushed', async () => {
    const frozen = vi
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2026-11-03T10:00:00.000Z');
    try {
      const row = await saveRecord('account', { name: 'First', type: 'WALLET' });
      let call = 0;
      server({
        push: async (body) => {
          call++;
          if (call === 1) await saveRecord('account', { id: row.id, name: 'Second' }); // identical edit time
          return json({
            results: body.ops.map((op: PushOp) => ({
              entity: op.entity,
              id: op.id,
              status: 'applied',
              version: call,
            })),
          });
        },
      });
      await syncNow();
      expect(pushes()).toHaveLength(2);
      expect(await getDb().outbox.count()).toBe(0);
      expect((await getDb().accounts.get(row.id))!.name).toBe('Second');
    } finally {
      frozen.mockRestore();
    }
  });

  it('does not spin when the server leaves an op unanswered', async () => {
    await saveRecord('account', { name: 'Wallet', type: 'WALLET' });
    server({ push: () => json({ results: [] }) });
    await syncNow();
    expect(pushes()).toHaveLength(1);
    expect(await getDb().outbox.count()).toBe(1);
  });
});

describe('pulling', () => {
  it('stores what changed, removes deleted records, and remembers the cursor', async () => {
    await getDb().accounts.put(accountRow('gone'));
    server({
      pull: (url) =>
        url.searchParams.get('cursor')
          ? emptyPull('c2')
          : json({
              changes: { account: [accountRow('a1'), accountRow('gone', { deletedAt: NOW })] },
              cursor: 'c1',
              hasMore: false,
            }),
    });
    await syncNow();
    expect((await getDb().accounts.toArray()).map((a) => a.id)).toEqual(['a1']);
    expect(await readMeta('syncCursor')).toBe('c1');

    await syncNow();
    const calls = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    expect(calls.at(-1)!.searchParams.get('cursor')).toBe('c1'); // continues from where it stopped
    expect(calls[0]!.searchParams.get('deviceId')).toEqual(expect.any(String));
  });

  it('follows pages until there are no more', async () => {
    server({
      pull: (url) => {
        const cursor = url.searchParams.get('cursor');
        if (!cursor)
          return json({ changes: { account: [accountRow('p1')] }, cursor: 'page1', hasMore: true });
        if (cursor === 'page1')
          return json({ changes: { account: [accountRow('p2')] }, cursor: 'page2', hasMore: true });
        return json({ changes: { account: [accountRow('p3')] }, cursor: 'page3', hasMore: false });
      },
    });
    await syncNow();
    expect((await getDb().accounts.toArray()).map((a) => a.id).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(await readMeta('syncCursor')).toBe('page3');
  });

  it('leaves a record alone while we hold an unsent edit to it', async () => {
    const row = await saveRecord('account', { name: 'Mine, unsent', type: 'WALLET' });
    server({
      push: () => json({ results: [] }), // the server did not answer for our op, so it stays queued
      pull: () =>
        json({
          changes: { account: [accountRow(row.id, { name: 'From server' })] },
          cursor: 'c1',
          hasMore: false,
        }),
    });
    await syncNow();
    expect((await getDb().accounts.get(row.id))!.name).toBe('Mine, unsent');
    expect(await getDb().outbox.count()).toBe(1);
  });

  it("lets the server's record replace ours once our edit was refused", async () => {
    const row = await saveRecord('account', { name: 'Refused', type: 'WALLET' });
    server({
      push: (body) =>
        json({
          results: body.ops.map((op: PushOp) => ({
            entity: op.entity,
            id: op.id,
            status: 'rejected',
            error: 'no',
          })),
        }),
      pull: () =>
        json({
          changes: { account: [accountRow(row.id, { name: 'From server' })] },
          cursor: 'c1',
          hasMore: false,
        }),
    });
    await syncNow();
    expect((await getDb().accounts.get(row.id))!.name).toBe('From server');
  });
});

describe('orchestration', () => {
  it('shares one run between simultaneous calls, then runs once more if asked mid-run', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let pulls = 0;
    server({
      pull: async () => {
        pulls++;
        if (pulls === 1) await gate;
        return emptyPull();
      },
    });
    const first = syncNow();
    const second = syncNow(); // arrives while the first is running
    expect(second).toBe(first);
    release();
    await first;
    expect(pulls).toBe(2); // the extra request caused one more pass
  });

  it('is idle again after a failure so the next attempt can run', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await syncNow();
    expect(getSyncState().status).toBe('offline');
    server({});
    await syncNow();
    expect(getSyncState().status).toBe('idle');
  });
});

describe('connection changes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows offline as soon as the connection drops, and syncs when it returns', async () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    server({});
    const stop = startSyncing();
    await vi.waitFor(() => expect(getSyncState().status).toBe('idle'));

    win.dispatchEvent(new Event('offline'));
    expect(getSyncState().status).toBe('offline');

    win.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(getSyncState().status).toBe('idle'));

    stop();
    win.dispatchEvent(new Event('offline'));
    expect(getSyncState().status).toBe('idle'); // no longer listening
  });
});
