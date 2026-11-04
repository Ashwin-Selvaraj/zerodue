import Dexie, { type Table } from 'dexie';

/** Small key/value store, e.g. the cached profile used to open the app while offline. */
export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * A local change waiting to be sent to POST /sync/push (see docs: offline sync).
 * Entity tables (transactions, loans, ...) are added by the milestones that introduce them.
 */
export interface OutboxOp {
  id?: number;
  entity: string;
  entityId: string;
  op: 'upsert' | 'delete';
  data?: unknown;
  createdAt: number;
  attempts: number;
}

class ZeroDueDB extends Dexie {
  meta!: Table<MetaRow, string>;
  outbox!: Table<OutboxOp, number>;

  constructor() {
    super('zerodue');
    this.version(1).stores({
      meta: 'key',
      outbox: '++id, entity, createdAt',
    });
  }
}

let instance: ZeroDueDB | undefined;

/** Lazily opened so server-side rendering never touches IndexedDB. */
export function getDb(): ZeroDueDB {
  instance ??= new ZeroDueDB();
  return instance;
}

export async function readMeta<T>(key: string): Promise<T | undefined> {
  try {
    return (await getDb().meta.get(key))?.value as T | undefined;
  } catch {
    return undefined; // private mode or blocked storage: behave as if empty
  }
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  try {
    await getDb().meta.put({ key, value });
  } catch {
    /* storage unavailable; the app still works online */
  }
}

export async function clearLocalData(): Promise<void> {
  try {
    await Promise.all([getDb().meta.clear(), getDb().outbox.clear()]);
  } catch {
    /* nothing to clear */
  }
}
