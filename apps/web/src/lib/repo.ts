import {
  matchCategoryRule,
  type CategoryDto,
  type OccurrenceDto,
  type RecurringItemDto,
  type SyncEntity,
  type TransactionDto,
} from '@zerodue/shared';
import { getDb, type OutboxOp, type ZeroDueDB } from './db';
import { getDeviceId } from './device';
import { scheduleSync } from './sync';

/**
 * Every write goes to the local database first and joins the outbox, so the app works the same offline.
 * The sync engine sends the outbox when the network allows.
 */

type Row = Record<string, unknown> & { id: string; version: number };

const META_KEYS = ['version', 'createdAt', 'updatedAt', 'editedAt', 'deletedAt', 'lastDeviceId'];

/** The fields a client may write (the server ignores metadata, so don't send it). */
function toWire(row: Row): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !META_KEYS.includes(key)));
}

/**
 * Adds an op to the outbox, folding it into any op already pending for the same record so there is
 * at most one per record. Call inside a transaction that also includes the outbox table.
 */
export async function enqueue(
  db: ZeroDueDB,
  op: Pick<OutboxOp, 'entity' | 'entityId' | 'op' | 'data' | 'editedAt' | 'baseVersion'>,
): Promise<void> {
  const pending = (
    await db.outbox.where('[entity+entityId]').equals([op.entity, op.entityId]).toArray()
  ).find((existing) => !existing.failed);

  if (!pending) {
    await db.outbox.add({ ...op, createdAt: Date.now(), rev: 1, attempts: 0 });
    return;
  }
  if (op.op === 'delete' && pending.op === 'upsert' && pending.baseVersion === 0) {
    // created and deleted before ever syncing: the server never needs to hear of it
    await db.outbox.delete(pending.id!);
    return;
  }
  if (op.op === 'delete' && pending.op === 'delete') return;
  // keep the original baseVersion: it is the version the server last confirmed
  await db.outbox.put({
    ...pending,
    op: op.op,
    data: op.data,
    editedAt: op.editedAt,
    rev: pending.rev + 1,
    attempts: 0,
  });
}

export async function saveRecord(entity: SyncEntity, data: Record<string, unknown>): Promise<Row> {
  const db = getDb();
  const table = db.tableFor(entity);
  const deviceId = await getDeviceId();
  const now = new Date().toISOString();
  const id = typeof data.id === 'string' ? data.id : crypto.randomUUID();
  let saved!: Row;

  await db.transaction('rw', [table, db.outbox], async () => {
    const existing = (await table.get(id)) as Row | undefined;
    saved = {
      ...existing,
      ...data,
      id,
      version: existing?.version ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      editedAt: now,
      deletedAt: null,
      lastDeviceId: deviceId,
    };
    await table.put(saved);
    await enqueue(db, {
      entity,
      entityId: id,
      op: 'upsert',
      data: toWire(saved),
      editedAt: now,
      baseVersion: saved.version,
    });
  });
  scheduleSync();
  return saved;
}

export async function deleteRecord(entity: SyncEntity, id: string): Promise<void> {
  const db = getDb();
  const table = db.tableFor(entity);
  await db.transaction('rw', [table, db.outbox], async () => {
    const existing = (await table.get(id)) as Row | undefined;
    if (!existing) return;
    await table.delete(id);
    await enqueue(db, {
      entity,
      entityId: id,
      op: 'delete',
      editedAt: new Date().toISOString(),
      baseVersion: existing.version,
    });
  });
  scheduleSync();
}

// ───────────────────────── transactions ─────────────────────────

export interface NewTransaction {
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amountPaise: number;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  occurredAt: string;
  merchant?: string | null;
  note?: string | null;
  tags?: string[];
  source?: TransactionDto['source'];
  loanId?: string | null;
  receivableId?: string | null;
  goalContributionId?: string | null;
}

/** Mirrors the server's rules so a transaction is categorised the same way offline as online. */
async function applyCategoryRules(
  txn: Record<string, unknown>,
  existing: Row | undefined,
): Promise<Record<string, unknown>> {
  const db = getDb();
  const out = { ...txn };
  const type = out.type as TransactionDto['type'];
  const categories: CategoryDto[] = await db.categories.toArray();
  const fits = (categoryId: string): boolean => {
    const kind = categories.find((c) => c.id === categoryId)?.kind;
    return kind !== undefined && (type === 'TRANSFER' || kind === 'BOTH' || kind === type);
  };

  if (!existing && !out.categoryId && type !== 'TRANSFER' && (out.merchant || out.note)) {
    const rules = await db.categoryRules.toArray();
    const matched = matchCategoryRule(rules, {
      merchant: out.merchant as string | undefined,
      note: out.note as string | undefined,
    });
    if (matched && fits(matched)) {
      out.categoryId = matched;
      out.categorisedVia = 'RULE';
    }
  }
  const changed = (out.categoryId ?? null) !== ((existing?.categoryId as string | null) ?? null);
  if (changed && out.categoryId && out.categorisedVia !== 'RULE') out.categorisedVia = 'MANUAL';
  if (changed && !out.categoryId) out.categorisedVia = null;
  if (out.categoryId && out.status === 'PENDING_CATEGORY') out.status = 'POSTED';
  return out;
}

export async function addTransaction(input: NewTransaction): Promise<Row> {
  const prepared = await applyCategoryRules(
    { status: 'POSTED', source: 'MANUAL', tags: [], ...input },
    undefined,
  );
  return saveRecord('transaction', prepared);
}

export async function updateTransaction(id: string, patch: Partial<NewTransaction>): Promise<Row> {
  const existing = (await getDb().transactions.get(id)) as unknown as Row | undefined;
  if (!existing) throw new Error('Transaction not found');
  return saveRecord('transaction', await applyCategoryRules({ ...existing, ...patch }, existing));
}

export const deleteTransaction = (id: string) => deleteRecord('transaction', id);

export async function bulkCategorise(ids: string[], categoryId: string): Promise<void> {
  for (const id of ids) await updateTransaction(id, { categoryId });
}

// ───────────────────────── recurring bills ─────────────────────────

export interface NewRecurringItem {
  kind: 'INCOME' | 'EXPENSE';
  name: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'ONE_TIME';
  dueDay?: number | null;
  startDate: string;
  endDate?: string | null;
  categoryId?: string | null;
  accountId?: string | null;
  reminderLeadDays?: number[];
  amountPaise: number;
}

/** The item and its first amount period are queued in that order, so the server sees the item first. */
export async function createRecurringItem(input: NewRecurringItem): Promise<Row> {
  const { amountPaise, ...item } = input;
  const saved = await saveRecord('recurringItem', {
    fixedOutgoing: true,
    active: true,
    reminderLeadDays: [],
    ...item,
  });
  await saveRecord('recurringAmountPeriod', {
    recurringItemId: saved.id,
    effectiveFrom: input.startDate,
    amountPaise,
  });
  return saved;
}

/** Adds (or replaces) the amount that applies from a date onward, e.g. a bill that drops after March. */
export async function setAmountFrom(
  itemId: string,
  effectiveFrom: string,
  amountPaise: number,
): Promise<void> {
  const existing = (
    await getDb().recurringPeriods.where('recurringItemId').equals(itemId).toArray()
  ).find((p) => p.effectiveFrom === effectiveFrom);
  await saveRecord('recurringAmountPeriod', {
    ...(existing ?? {}),
    recurringItemId: itemId,
    effectiveFrom,
    amountPaise,
  });
}

export async function deleteRecurringItem(id: string): Promise<void> {
  const db = getDb();
  const periods = await db.recurringPeriods.where('recurringItemId').equals(id).toArray();
  await deleteRecord('recurringItem', id);
  for (const period of periods) await deleteRecord('recurringAmountPeriod', period.id);
  // generated due dates are removed by the server and arrive on the next sync; hide them now
  const dates = await db.occurrences.where('recurringItemId').equals(id).toArray();
  await db.occurrences.bulkDelete(dates.filter((o) => o.status === 'UPCOMING').map((o) => o.id));
}

export interface MarkPaidOptions {
  amountPaise?: number;
  accountId?: string | null;
  createTransaction?: boolean;
}

export async function markOccurrencePaid(id: string, options: MarkPaidOptions = {}): Promise<void> {
  const db = getDb();
  const occurrence = await db.occurrences.get(id);
  if (!occurrence) throw new Error('Due date not found');
  if (occurrence.status === 'PAID') return;
  const item = (await db.recurringItems.get(occurrence.recurringItemId)) as
    RecurringItemDto | undefined;
  const paidAt = new Date().toISOString();
  const amountPaise = options.amountPaise ?? occurrence.expectedAmountPaise;

  const accountId = options.accountId ?? item?.accountId;
  if (options.createTransaction && item && accountId) {
    await addTransaction({
      type: item.kind,
      amountPaise,
      accountId,
      categoryId: item.categoryId,
      occurredAt: paidAt,
      merchant: item.name,
      source: 'RECURRING',
    });
  }
  await saveRecord('recurringOccurrence', {
    ...occurrence,
    status: 'PAID',
    paidAt,
    paidAmountPaise: amountPaise,
  } satisfies Partial<OccurrenceDto>);
}

export async function unmarkOccurrence(id: string): Promise<void> {
  const occurrence = await getDb().occurrences.get(id);
  if (!occurrence) return;
  await saveRecord('recurringOccurrence', {
    ...occurrence,
    status: 'UPCOMING',
    paidAt: null,
    paidAmountPaise: null,
  });
}

export async function skipOccurrence(id: string): Promise<void> {
  const occurrence = await getDb().occurrences.get(id);
  if (occurrence) await saveRecord('recurringOccurrence', { ...occurrence, status: 'SKIPPED' });
}
