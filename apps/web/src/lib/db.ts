import type {
  AccountDto,
  AllocationRuleDto,
  AmountPeriodDto,
  CategoryDto,
  CategoryRuleDto,
  GoalContributionDto,
  GoalDto,
  LoanDto,
  LoanLedgerDto,
  OccurrenceDto,
  PlannedPaymentDto,
  ReceivableDto,
  RecurringItemDto,
  ScenarioDto,
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
  loan: 'loans',
  loanLedgerEntry: 'loanLedger',
  loanPlannedPayment: 'plannedPayments',
  scenario: 'scenarios',
  receivable: 'receivables',
  goal: 'goals',
  goalContribution: 'goalContributions',
  allocationRule: 'allocationRules',
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
  loans!: Table<LoanDto, string>;
  loanLedger!: Table<LoanLedgerDto, string>;
  plannedPayments!: Table<PlannedPaymentDto, string>;
  scenarios!: Table<ScenarioDto, string>;
  receivables!: Table<ReceivableDto, string>;
  goals!: Table<GoalDto, string>;
  goalContributions!: Table<GoalContributionDto, string>;
  allocationRules!: Table<AllocationRuleDto, string>;

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
    this.version(3).stores({
      loans: 'id, status',
      loanLedger: 'id, loanId, month',
      plannedPayments: 'id, loanId, month',
      scenarios: 'id, loanId',
      receivables: 'id, status, expectedDate',
      goals: 'id',
      goalContributions: 'id, goalId',
      allocationRules: 'id, recurringItemId',
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
const OWNER_KEY = 'dataOwner';
const PROFILE_KEY = 'profile';

/**
 * Makes sure what is stored here belongs to this user. If someone else's data is found (an account
 * was deleted or switched without signing out), it is wiped before the new user's data is fetched.
 * Data with no recorded owner is also wiped when nothing is waiting to be sent, since it can all be
 * fetched again; if changes are waiting it is kept, so nothing the user typed is lost.
 * Returns true when data was cleared.
 */
export async function claimLocalData(userId: string): Promise<boolean> {
  const owner =
    (await readMeta<string>(OWNER_KEY)) ?? (await readMeta<{ id?: string }>(PROFILE_KEY))?.id;
  let clear = owner !== undefined && owner !== userId;
  if (owner === undefined) {
    try {
      const db = getDb();
      clear = (await db.outbox.count()) === 0 && (await db.accounts.count()) > 0;
    } catch {
      clear = false; // storage unavailable: nothing to protect or clear
    }
  }
  if (clear) await clearLocalData();
  await writeMeta(OWNER_KEY, userId);
  return clear;
}
