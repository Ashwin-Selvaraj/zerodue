'use client';

import { addMonths, type CategoryDto, type TransactionDto } from '@zerodue/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { getDb } from './db';
import { getSyncState, subscribeSync } from './sync';

/** Live views over the local database: they re-render whenever the data (or a sync) changes it. */

export function useAccounts() {
  return useLiveQuery(() => getDb().accounts.toArray(), []);
}

export function useCategories(): CategoryDto[] | undefined {
  return useLiveQuery(
    async () => (await getDb().categories.toArray()).sort((a, b) => a.sortOrder - b.sortOrder),
    [],
  );
}

/** Transactions in an IST month (`YYYY-MM-01`), newest first. Search and category filter apply locally. */
export function useTransactions(
  month: string,
  query = '',
  categoryId = '',
): TransactionDto[] | undefined {
  return useLiveQuery(async () => {
    const start = new Date(`${month}T00:00:00+05:30`).toISOString();
    const end = new Date(`${addMonths(month, 1)}T00:00:00+05:30`).toISOString();
    const rows = await getDb()
      .transactions.where('occurredAt')
      .between(start, end, true, false)
      .reverse()
      .toArray();
    const needle = query.trim().toLowerCase();
    return rows.filter((t) => {
      if (categoryId && t.categoryId !== categoryId) return false;
      if (!needle) return true;
      return [t.merchant, t.note, t.vpa].some((field) => field?.toLowerCase().includes(needle));
    });
  }, [month, query, categoryId]);
}

export function useTransaction(id: string) {
  return useLiveQuery(() => getDb().transactions.get(id), [id]);
}

export function useRecurringItems() {
  return useLiveQuery(() => getDb().recurringItems.toArray(), []);
}

export function useRecurringItem(id: string) {
  return useLiveQuery(async () => {
    const item = await getDb().recurringItems.get(id);
    if (!item) return null;
    const periods = (
      await getDb().recurringPeriods.where('recurringItemId').equals(id).toArray()
    ).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    return { item, periods };
  }, [id]);
}

/** Due dates joined with their item's name and kind. */
export function useOccurrences() {
  return useLiveQuery(async () => {
    const db = getDb();
    const [occurrences, items] = await Promise.all([
      db.occurrences.toArray(),
      db.recurringItems.toArray(),
    ]);
    const byId = new Map(items.map((item) => [item.id, item]));
    return occurrences
      .flatMap((occurrence) => {
        const item = byId.get(occurrence.recurringItemId);
        return item ? [{ ...occurrence, name: item.name, kind: item.kind }] : [];
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, []);
}

export function useOutboxCounts() {
  return useLiveQuery(async () => {
    const ops = await getDb().outbox.toArray();
    return {
      pending: ops.filter((op) => !op.failed).length,
      failed: ops.filter((op) => op.failed),
    };
  }, []);
}

export function useSyncState() {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState);
}
