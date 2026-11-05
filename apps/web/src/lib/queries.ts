'use client';

import { addMonths, isoDateIST, type CategoryDto, type TransactionDto } from '@zerodue/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { getDb, readMeta } from './db';
import { loanState } from './loan-state';
import { buildPlanFromSnapshot, type BuiltPlan } from './plan-input';
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

// ───────────────────────── loans, plan, goals ─────────────────────────

export const SWEEP_LOAN_KEY = 'sweepLoanId';
export const BUFFER_KEY = 'cashBufferPaise';

export function useLoans() {
  return useLiveQuery(async () => {
    const db = getDb();
    const [loans, ledger] = await Promise.all([db.loans.toArray(), db.loanLedger.toArray()]);
    const thisMonth = `${isoDateIST(new Date()).slice(0, 7)}-01`;
    return loans
      .map((loan) => ({ loan, state: loanState(loan, ledger, thisMonth) }))
      .sort(
        (a, b) =>
          Number(a.loan.status === 'CLOSED') - Number(b.loan.status === 'CLOSED') ||
          a.loan.name.localeCompare(b.loan.name),
      );
  }, []);
}

/** A loan with its recorded history, manual payments and saved scenarios; null when it doesn't exist. */
export function useLoan(id: string) {
  return useLiveQuery(async () => {
    const db = getDb();
    const loan = await db.loans.get(id);
    if (!loan) return null;
    const [ledger, planned, scenarios] = await Promise.all([
      db.loanLedger.where('loanId').equals(id).toArray(),
      db.plannedPayments.where('loanId').equals(id).toArray(),
      db.scenarios.where('loanId').equals(id).toArray(),
    ]);
    const thisMonth = `${isoDateIST(new Date()).slice(0, 7)}-01`;
    return { loan, ledger, planned, scenarios, state: loanState(loan, ledger, thisMonth) };
  }, [id]);
}

/** The cash plan for the next `months` months, recomputed whenever any input changes. */
export function usePlan(months: number): BuiltPlan | undefined {
  return useLiveQuery(async () => {
    const db = getDb();
    const [
      accounts,
      transactions,
      items,
      periods,
      occurrences,
      receivables,
      allocations,
      loans,
      ledger,
      plannedPayments,
      goals,
      contributions,
      sweepLoanId,
      bufferPaise,
    ] = await Promise.all([
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.recurringItems.toArray(),
      db.recurringPeriods.toArray(),
      db.occurrences.toArray(),
      db.receivables.toArray(),
      db.allocationRules.toArray(),
      db.loans.toArray(),
      db.loanLedger.toArray(),
      db.plannedPayments.toArray(),
      db.goals.toArray(),
      db.goalContributions.toArray(),
      readMeta<string>(SWEEP_LOAN_KEY),
      readMeta<number>(BUFFER_KEY),
    ]);
    return buildPlanFromSnapshot({
      today: isoDateIST(new Date()),
      months,
      accounts,
      transactions,
      items,
      periods,
      occurrences,
      receivables,
      allocations,
      loans,
      ledger,
      plannedPayments,
      goals,
      contributions,
      sweepLoanId,
      bufferPaise,
    });
  }, [months]);
}

export function useReceivables() {
  return useLiveQuery(
    async () =>
      (await getDb().receivables.toArray()).sort((a, b) =>
        a.expectedDate.localeCompare(b.expectedDate),
      ),
    [],
  );
}

export function useGoals() {
  return useLiveQuery(async () => {
    const db = getDb();
    const [goals, contributions] = await Promise.all([
      db.goals.toArray(),
      db.goalContributions.toArray(),
    ]);
    return goals.map((goal) => ({
      goal,
      contributions: contributions.filter((c) => c.goalId === goal.id),
    }));
  }, []);
}

export function useAllocations() {
  return useLiveQuery(() => getDb().allocationRules.toArray(), []);
}

/** Transactions in the `count` IST months ending at `endMonth` (YYYY-MM-01). */
export function useTransactionRange(endMonth: string, count: number): TransactionDto[] | undefined {
  return useLiveQuery(async () => {
    const start = new Date(`${addMonths(endMonth, 1 - count)}T00:00:00+05:30`).toISOString();
    const end = new Date(`${addMonths(endMonth, 1)}T00:00:00+05:30`).toISOString();
    return getDb().transactions.where('occurredAt').between(start, end, true, false).toArray();
  }, [endMonth, count]);
}
