import type {
  AccountDto,
  AmountPeriodDto,
  CategoryDto,
  CategoryRuleDto,
  OccurrenceDto,
  RecurringItemDto,
  SyncEntity,
  TransactionDto,
} from '@zerodue/shared';
import Dexie, { type Table } from 'dexie';

/** Small key/value store: the cached profile, the sync cursor, this device's id. */
export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * A local change waiting to be sent to POST /sync/push. There is at most one pending op per record:
 * later edits to the same record are merged into it (see `enqueue` in repo.ts).
 */
export interface OutboxOp {
  id?: number;
  entity: SyncEntity;
  entityId: string;
  op: 'upsert' | 'delete';
  /** Full record for an upsert. */
  data?: Record<string, unknown>;
  /** When the user made the edit on this device; the server uses it to settle conflicts. */
  editedAt: string;
  /** The record version this edit was built on (0 for a record the server has never seen). */
  baseVersion: number;
  createdAt: number;
  /** Bumped on every edit folded into this op, so a push can tell it was changed while in flight. */
  rev: number;
  attempts: number;
  /** The server refused this op permanently; it is kept so the user can see and discard it. */
  failed?: boolean;
  error?: string;
}

/** Table name for each synced record type. (`transaction` would shadow Dexie's own method.) */
export const TABLE_NAMES: Record<SyncEntity, string> = {
  account: 'accounts',
  category: 'categories',
  categoryRule: 'categoryRules',
  transaction: 'transactions',
  recurringItem: 'recurringItems',
  recurringAmountPeriod: 'recurringPeriods',
  recurringOccurrence: 'occurrences',
};

export class ZeroDueDB extends Dexie {
  meta!: Table<MetaRow, string>;
  outbox!: Table<OutboxOp, number>;
  accounts!: Table<AccountDto, string>;
  categories!: Table<CategoryDto, string>;
  categoryRules!: Table<CategoryRuleDto, string>;
  transactions!: Table<TransactionDto, string>;
  recurringItems!: Table<RecurringItemDto, string>;
  recurringPeriods!: Table<AmountPeriodDto, string>;
  occurrences!: Table<OccurrenceDto, string>;

  constructor(name = 'zerodue') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      outbox: '++id, entity, createdAt',
    });
    this.version(2).stores({
      meta: 'key',
      outbox: '++id, [entity+entityId], createdAt',
      accounts: 'id',
      categories: 'id, parentId',
      categoryRules: 'id',
      transactions: 'id, occurredAt, accountId, categoryId',
      recurringItems: 'id',
      recurringPeriods: 'id, recurringItemId',
      occurrences: 'id, dueDate, recurringItemId, status',
    });
  }

  /** The table holding a given record type. */
  tableFor(entity: SyncEntity): Table<{ id: string; version: number }, string> {
    return this.table(TABLE_NAMES[entity]);
  }
}

let instance: ZeroDueDB | undefined;

/** Lazily opened so server-side rendering never touches IndexedDB. */
export function getDb(): ZeroDueDB {
  instance ??= new ZeroDueDB();
  return instance;
}

/** Test hook: use a fresh database. */
export function resetDbForTests(name: string): ZeroDueDB {
  instance = new ZeroDueDB(name);
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

/** Wipes everything stored on this device (sign-out). The device id is kept so it stays recognisable. */
export async function clearLocalData(): Promise<void> {
  try {
    const db = getDb();
    const deviceId = (await db.meta.get(DEVICE_ID_KEY))?.value;
    await Promise.all(db.tables.map((table) => table.clear()));
    if (deviceId) await db.meta.put({ key: DEVICE_ID_KEY, value: deviceId });
  } catch {
    /* nothing to clear */
  }
}

export const DEVICE_ID_KEY = 'deviceId';
