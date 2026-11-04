import {
  syncEntities,
  type SyncOpResult,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@zerodue/shared';
import { NetworkError, request } from './api';
import { getDb, readMeta, writeMeta, type OutboxOp } from './db';
import { getDeviceId } from './device';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
}

const CURSOR_KEY = 'syncCursor';
const LAST_SYNC_KEY = 'lastSyncedAt';
const PUSH_BATCH = 100;
const PULL_PAGE = 200;

let state: SyncState = { status: 'idle', lastSyncedAt: null, error: null };
const listeners = new Set<() => void>();

function setState(next: Partial<SyncState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ───────────────────────── push ─────────────────────────

/** The op as it is stored now: it may have been edited again while a push was in flight. */
async function settle(sent: OutboxOp, result: SyncOpResult): Promise<void> {
  const db = getDb();
  const table = db.tableFor(sent.entity);
  const current = await db.outbox.get(sent.id!);

  if (result.status === 'rejected') {
    if (current)
      await db.outbox.update(sent.id!, {
        failed: true,
        error: result.error ?? 'Rejected',
        attempts: (current.attempts ?? 0) + 1,
      });
    return;
  }

  if (result.status === 'conflict') {
    // Another edit was newer. The server keeps it; take it as ours and drop the losing change.
    if (result.serverRow) await table.put(result.serverRow as { id: string; version: number });
    if (current && current.rev === sent.rev) await db.outbox.delete(sent.id!);
    return;
  }

  // applied
  const editedAgain = current !== undefined && current.rev !== sent.rev;
  if (editedAgain) {
    // the user changed the record again during the push: that newer edit is built on the new version
    await db.outbox.update(sent.id!, { baseVersion: result.version ?? current.baseVersion });
  } else {
    await db.outbox.delete(sent.id!);
    if (sent.op === 'upsert') {
      const row = (await table.get(sent.entityId)) as { id: string; version: number } | undefined;
      if (result.serverRow) await table.put(result.serverRow as { id: string; version: number });
      else if (row && result.version !== undefined)
        await table.update(sent.entityId, { version: result.version });
    }
  }
}

async function pushOutbox(deviceId: string): Promise<void> {
  const db = getDb();
  for (;;) {
    const ops = (await db.outbox.orderBy('id').toArray())
      .filter((op) => !op.failed)
      .slice(0, PUSH_BATCH);
    if (ops.length === 0) return;
    const { results } = await request<SyncPushResponse>('/sync/push', {
      method: 'POST',
      body: {
        deviceId,
        ops: ops.map((op) => ({
          entity: op.entity,
          op: op.op,
          id: op.entityId,
          data: op.data,
          editedAt: op.editedAt,
          baseVersion: op.baseVersion,
        })),
      },
    });
    for (const [index, op] of ops.entries()) {
      const result = results[index];
      if (result) await settle(op, result);
    }
    // stop if an op we just sent is still queued unchanged (the server said nothing about it): no progress
    const queued = await db.outbox.toArray();
    if (
      ops.some((sent) =>
        queued.some((op) => op.id === sent.id && op.rev === sent.rev && !op.failed),
      )
    )
      return;
  }
}

// ───────────────────────── pull ─────────────────────────

async function applyPulled(changes: SyncPullResponse['changes']): Promise<void> {
  const db = getDb();
  for (const entity of syncEntities) {
    const rows = (changes[entity] ?? []) as {
      id: string;
      version: number;
      deletedAt?: string | null;
    }[];
    if (rows.length === 0) continue;
    const table = db.tableFor(entity);
    await db.transaction('rw', [table, db.outbox], async () => {
      const pending = new Set(
        (await db.outbox.toArray())
          .filter((op) => op.entity === entity && !op.failed)
          .map((op) => op.entityId),
      );
      for (const row of rows) {
        if (pending.has(row.id)) continue; // our unsent edit is newer; the push will settle it
        if (row.deletedAt) await table.delete(row.id);
        else await table.put(row);
      }
    });
  }
}

async function pullAll(deviceId: string): Promise<void> {
  let cursor = await readMeta<string>(CURSOR_KEY);
  for (;;) {
    const query = new URLSearchParams({ deviceId, limit: String(PULL_PAGE) });
    if (cursor) query.set('cursor', cursor);
    const page = await request<SyncPullResponse>(`/sync/pull?${query}`);
    await applyPulled(page.changes);
    cursor = page.cursor;
    await writeMeta(CURSOR_KEY, cursor);
    if (!page.hasMore) return;
  }
}

// ───────────────────────── orchestration ─────────────────────────

let inFlight: Promise<void> | null = null;
let rerun = false;

/**
 * Sends local changes, then fetches remote ones. Safe to call at any time: concurrent calls share one
 * run, and a call made mid-run triggers one more pass so nothing waits for the next timer.
 */
export function syncNow(): Promise<void> {
  if (inFlight) {
    rerun = true;
    return inFlight;
  }
  inFlight = (async () => {
    setState({ status: 'syncing', error: null });
    try {
      do {
        rerun = false;
        const deviceId = await getDeviceId();
        await pushOutbox(deviceId);
        await pullAll(deviceId);
      } while (rerun);
      const lastSyncedAt = new Date().toISOString();
      await writeMeta(LAST_SYNC_KEY, lastSyncedAt);
      setState({ status: 'idle', lastSyncedAt });
    } catch (error) {
      if (error instanceof NetworkError) setState({ status: 'offline' });
      else
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : 'Sync failed',
        });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

let debounce: ReturnType<typeof setTimeout> | undefined;

/** Called after every local write: sync shortly after, batching quick successive edits. */
export function scheduleSync(delayMs = 1200): void {
  if (typeof window === 'undefined') return;
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), delayMs);
}

/** Starts background syncing (on load, on reconnect, when the tab returns, and every 30 s). */
export function startSyncing(): () => void {
  void readMeta<string>(LAST_SYNC_KEY).then((value) => value && setState({ lastSyncedAt: value }));
  void syncNow();
  const onOnline = () => void syncNow();
  const onVisible = () => document.visibilityState === 'visible' && void syncNow();
  const timer = setInterval(() => void syncNow(), 30_000);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    clearTimeout(debounce);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export function resetSyncStateForTests(): void {
  state = { status: 'idle', lastSyncedAt: null, error: null };
  inFlight = null;
  rerun = false;
}
