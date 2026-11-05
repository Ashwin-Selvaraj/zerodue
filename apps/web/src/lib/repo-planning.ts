import {
  isoDateIST,
  monthKey,
  type AllocationRuleInput,
  type LoanDto,
  type LoanInput,
  type ScenarioParams,
} from '@zerodue/shared';
import { getDb } from './db';
import { loanState, postMonth } from './loan-state';
import { addTransaction, deleteRecord, deleteTransaction, saveRecord } from './repo';

/** Writes for loans, receivables, goals and allocation. Like repo.ts, everything lands locally first. */

// ───────────────────────────── loans ─────────────────────────────

export async function createLoan(input: LoanInput): Promise<LoanDto> {
  return (await saveRecord('loan', { ...input })) as unknown as LoanDto;
}

export async function updateLoan(id: string, patch: Partial<LoanInput>): Promise<void> {
  const existing = await getDb().loans.get(id);
  if (!existing) throw new Error('Loan not found');
  await saveRecord('loan', { ...existing, ...patch });
}

export async function closeLoan(id: string): Promise<void> {
  await updateLoan(id, { status: 'CLOSED', closedAt: isoDateIST(new Date()) });
}

export async function reopenLoan(id: string): Promise<void> {
  await updateLoan(id, { status: 'ACTIVE', closedAt: null });
}

export interface LoanPaymentOptions {
  paymentPaise: number;
  /** Day the money left the account, YYYY-MM-DD. */
  effectiveDate: string;
  /** What the lender actually charged, if it differs from the computed interest. */
  interestPaise?: number;
  /** Also record the money going out as an expense. */
  accountId?: string | null;
  categoryId?: string | null;
}

/** Records the next unrecorded month on a loan: its interest, then the payment. */
export async function recordLoanPayment(
  loanId: string,
  options: LoanPaymentOptions,
): Promise<{ month: string; closingPaise: number }> {
  const db = getDb();
  const loan = await db.loans.get(loanId);
  if (!loan) throw new Error('Loan not found');
  const ledger = await db.loanLedger.where('loanId').equals(loanId).toArray();
  const state = loanState(loan, ledger, monthKey(new Date()));
  const posted = postMonth(loan, state, options);
  if (!posted) throw new Error('Nothing to record: there is no interest and no payment.');

  let transactionId: string | null = null;
  if (options.accountId && posted.paymentPaise > 0) {
    const txn = await addTransaction({
      type: 'EXPENSE',
      amountPaise: posted.paymentPaise,
      accountId: options.accountId,
      categoryId: options.categoryId ?? null,
      occurredAt: new Date(`${options.effectiveDate}T12:00:00+05:30`).toISOString(),
      merchant: loan.name,
      loanId,
    });
    transactionId = txn.id;
  }
  for (const entry of posted.entries) {
    await saveRecord('loanLedgerEntry', {
      ...entry,
      transactionId: entry.kind === 'PAYMENT' ? transactionId : null,
    });
  }
  return { month: posted.month, closingPaise: posted.closingPaise };
}

/** Removes the most recently recorded month (and the expense it created), e.g. after a typo. */
export async function undoLastLoanMonth(loanId: string): Promise<void> {
  const db = getDb();
  const entries = await db.loanLedger.where('loanId').equals(loanId).toArray();
  const last = entries
    .map((e) => e.month)
    .sort()
    .pop();
  if (!last) return;
  for (const entry of entries.filter((e) => e.month === last)) {
    await deleteRecord('loanLedgerEntry', entry.id);
    if (entry.transactionId) await deleteTransaction(entry.transactionId);
  }
}

/** Sets what to pay in a month, or goes back to "everything available" with null. */
export async function setPlannedPayment(
  loanId: string,
  month: string,
  amountPaise: number | null,
): Promise<void> {
  const existing = (await getDb().plannedPayments.where('loanId').equals(loanId).toArray()).find(
    (p) => p.month === month,
  );
  if (amountPaise === null) {
    if (existing) await deleteRecord('loanPlannedPayment', existing.id);
    return;
  }
  await saveRecord('loanPlannedPayment', { ...(existing ?? {}), loanId, month, amountPaise });
}

export async function saveScenario(
  loanId: string,
  name: string,
  params: ScenarioParams,
  id?: string,
): Promise<void> {
  await saveRecord('scenario', { ...(id ? { id } : {}), loanId, name, params });
}

export const deleteScenario = (id: string) => deleteRecord('scenario', id);

// ───────────────────────────── receivables ─────────────────────────────

export interface NewReceivable {
  kind: 'OWED_TO_ME' | 'EXPECTED_INCOME';
  counterparty: string;
  description?: string | null;
  amountPaise: number;
  expectedDate: string;
}

export const addReceivable = (input: NewReceivable) =>
  saveRecord('receivable', { ...input, status: 'EXPECTED' });

/** Marks money as received and records it as income in an account. */
export async function receiveReceivable(
  id: string,
  options: { accountId: string; categoryId?: string | null; amountPaise?: number },
): Promise<void> {
  const receivable = await getDb().receivables.get(id);
  if (!receivable) throw new Error('Receivable not found');
  if (receivable.status === 'RECEIVED') return;
  const receivedAt = new Date().toISOString();
  await addTransaction({
    type: 'INCOME',
    amountPaise: options.amountPaise ?? receivable.amountPaise,
    accountId: options.accountId,
    categoryId: options.categoryId ?? receivable.categoryId ?? null,
    occurredAt: receivedAt,
    merchant: receivable.counterparty,
    receivableId: id,
  });
  await saveRecord('receivable', { ...receivable, status: 'RECEIVED', receivedAt });
}

/** Puts a receivable back to expected and removes the income it created. */
export async function undoReceive(id: string): Promise<void> {
  const db = getDb();
  const receivable = await db.receivables.get(id);
  if (!receivable) return;
  const created = await db.transactions.filter((t) => t.receivableId === id).toArray();
  for (const txn of created) await deleteTransaction(txn.id);
  await saveRecord('receivable', { ...receivable, status: 'EXPECTED', receivedAt: null });
}

export const cancelReceivable = async (id: string) => {
  const receivable = await getDb().receivables.get(id);
  if (receivable) await saveRecord('receivable', { ...receivable, status: 'CANCELLED' });
};

// ───────────────────────────── goals ─────────────────────────────

export interface NewGoal {
  name: string;
  targetAmountPaise: number;
  targetDate?: string | null;
}

export const addGoal = (input: NewGoal) => saveRecord('goal', { ...input, status: 'ACTIVE' });

export interface NewContribution {
  goalId: string;
  contributor: string;
  isSelf: boolean;
  amountPaise: number;
}

export const addContribution = (input: NewContribution) =>
  saveRecord('goalContribution', { ...input, status: 'PLEDGED' });

/**
 * Marks a contribution received. Money from other people also arrives as income in an account;
 * your own share is already your money, so it needs no transaction.
 */
export async function receiveContribution(id: string, accountId?: string | null): Promise<void> {
  const db = getDb();
  const contribution = await db.goalContributions.get(id);
  if (!contribution) throw new Error('Contribution not found');
  if (contribution.status === 'RECEIVED') return;
  if (accountId && !contribution.isSelf) {
    await addTransaction({
      type: 'INCOME',
      amountPaise: contribution.amountPaise,
      accountId,
      occurredAt: new Date().toISOString(),
      merchant: contribution.contributor,
      goalContributionId: id,
    });
  }
  await saveRecord('goalContribution', {
    ...contribution,
    status: 'RECEIVED',
    receivedOn: isoDateIST(new Date()),
  });
}

export async function deleteGoal(id: string): Promise<void> {
  const db = getDb();
  const contributions = await db.goalContributions.where('goalId').equals(id).toArray();
  await deleteRecord('goal', id);
  for (const contribution of contributions) await deleteRecord('goalContribution', contribution.id);
}

// ───────────────────────────── allocation ─────────────────────────────

export const addAllocation = (input: AllocationRuleInput) => saveRecord('allocationRule', input);
export const deleteAllocation = (id: string) => deleteRecord('allocationRule', id);
