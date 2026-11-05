import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from './db';
import { resetDeviceIdCacheForTests } from './device';
import {
  addAllocation,
  addContribution,
  addGoal,
  addReceivable,
  cancelReceivable,
  closeLoan,
  createLoan,
  deleteAllocation,
  deleteGoal,
  deleteScenario,
  receiveContribution,
  receiveReceivable,
  recordLoanPayment,
  reopenLoan,
  saveScenario,
  setPlannedPayment,
  undoLastLoanMonth,
  undoReceive,
  updateLoan,
} from './repo-planning';

let n = 0;
const BANK = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';

beforeEach(async () => {
  resetDbForTests(`planning-${++n}`);
  resetDeviceIdCacheForTests();
  const now = '2026-11-03T10:00:00.000Z';
  await getDb().accounts.put({
    id: BANK,
    name: 'Bank',
    type: 'BANK',
    balancePaise: 500_000,
    balanceAsOf: '2026-11-03',
    archived: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
    editedAt: now,
    deletedAt: null,
    lastDeviceId: null,
  });
});

const newLoan = () =>
  createLoan({
    name: 'Test loan',
    kind: 'FLEXIBLE',
    status: 'ACTIVE',
    outstandingPaise: 500_000_00,
    outstandingAsOf: '2026-11-01',
    annualRateBps: 900,
    interestStartMonth: '2026-11-01',
  });

describe('loans', () => {
  it('records a month’s interest and payment, and queues them for sync', async () => {
    const loan = await newLoan();
    const result = await recordLoanPayment(loan.id, {
      paymentPaise: 80_000_00,
      effectiveDate: '2026-11-30',
    });
    expect(result).toEqual({ month: '2026-11-01', closingPaise: 423_750_00 });
    const ledger = await getDb().loanLedger.toArray();
    expect(ledger.map((e) => [e.kind, e.amountPaise]).sort()).toEqual([
      ['INTEREST', 3_750_00],
      ['PAYMENT', 80_000_00],
    ]);
    const queued = await getDb().outbox.toArray();
    expect(queued.map((op) => op.entity).sort()).toEqual([
      'loan',
      'loanLedgerEntry',
      'loanLedgerEntry',
    ]);
  });

  it('records the next month after that, carrying the balance forward', async () => {
    const loan = await newLoan();
    await recordLoanPayment(loan.id, { paymentPaise: 80_000_00, effectiveDate: '2026-11-30' });
    const second = await recordLoanPayment(loan.id, {
      paymentPaise: 80_000_00,
      effectiveDate: '2026-12-31',
    });
    expect(second.month).toBe('2026-12-01');
    expect(second.closingPaise).toBeLessThan(423_750_00);
  });

  it('can also record the payment as an expense linked to the loan', async () => {
    const loan = await newLoan();
    await recordLoanPayment(loan.id, {
      paymentPaise: 80_000_00,
      effectiveDate: '2026-11-30',
      accountId: BANK,
    });
    const [txn] = await getDb().transactions.toArray();
    expect(txn).toMatchObject({
      type: 'EXPENSE',
      amountPaise: 80_000_00,
      merchant: 'Test loan',
      loanId: loan.id,
    });
    const payment = (await getDb().loanLedger.toArray()).find((e) => e.kind === 'PAYMENT');
    expect(payment?.transactionId).toBe(txn!.id);
  });

  it('undoes the latest month and the expense it created', async () => {
    const loan = await newLoan();
    await recordLoanPayment(loan.id, { paymentPaise: 80_000_00, effectiveDate: '2026-11-30' });
    await recordLoanPayment(loan.id, {
      paymentPaise: 80_000_00,
      effectiveDate: '2026-12-31',
      accountId: BANK,
    });
    await undoLastLoanMonth(loan.id);
    expect((await getDb().loanLedger.toArray()).every((e) => e.month === '2026-11-01')).toBe(true);
    expect(await getDb().transactions.count()).toBe(0);
    await undoLastLoanMonth(loan.id);
    await undoLastLoanMonth(loan.id); // nothing left to undo
    expect(await getDb().loanLedger.count()).toBe(0);
  });

  it('refuses to record when there is nothing to record or the loan is unknown', async () => {
    const free = await createLoan({
      name: 'Interest free',
      kind: 'EMI',
      status: 'ACTIVE',
      outstandingPaise: 1_000_00,
      outstandingAsOf: '2026-11-01',
    });
    await expect(
      recordLoanPayment(free.id, { paymentPaise: 0, effectiveDate: '2026-11-30' }),
    ).rejects.toThrow('Nothing to record');
    await expect(
      recordLoanPayment('missing', { paymentPaise: 1, effectiveDate: '2026-11-30' }),
    ).rejects.toThrow('Loan not found');
    await expect(updateLoan('missing', { name: 'x' })).rejects.toThrow('Loan not found');
  });

  it('closes and reopens a loan', async () => {
    const loan = await newLoan();
    await closeLoan(loan.id);
    expect(await getDb().loans.get(loan.id)).toMatchObject({ status: 'CLOSED' });
    expect((await getDb().loans.get(loan.id))?.closedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await reopenLoan(loan.id);
    expect(await getDb().loans.get(loan.id)).toMatchObject({ status: 'ACTIVE', closedAt: null });
  });

  it('sets, changes and clears a manual payment for a month', async () => {
    const loan = await newLoan();
    await setPlannedPayment(loan.id, '2026-12-01', 10_000_00);
    await setPlannedPayment(loan.id, '2026-12-01', 20_000_00);
    const rows = await getDb().plannedPayments.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountPaise).toBe(20_000_00);
    await setPlannedPayment(loan.id, '2026-12-01', null);
    await setPlannedPayment(loan.id, '2027-01-01', null); // clearing a month with none is a no-op
    expect(await getDb().plannedPayments.count()).toBe(0);
  });

  it('saves and deletes what-if scenarios', async () => {
    const loan = await newLoan();
    await saveScenario(loan.id, 'Extra', { extraPayments: [], targetMonth: '2027-03-01' });
    const [saved] = await getDb().scenarios.toArray();
    await saveScenario(loan.id, 'Extra, renamed', { extraPayments: [] }, saved!.id);
    expect((await getDb().scenarios.toArray()).map((s) => s.name)).toEqual(['Extra, renamed']);
    await deleteScenario(saved!.id);
    expect(await getDb().scenarios.count()).toBe(0);
  });
});

describe('receivables', () => {
  const owed = () =>
    addReceivable({
      kind: 'OWED_TO_ME',
      counterparty: 'A friend',
      amountPaise: 15_000_00,
      expectedDate: '2026-12-05',
    });

  it('records income when money is received, and undoes it', async () => {
    const receivable = await owed();
    await receiveReceivable(receivable.id, { accountId: BANK });
    await receiveReceivable(receivable.id, { accountId: BANK }); // already received: no second income
    expect(await getDb().receivables.get(receivable.id)).toMatchObject({ status: 'RECEIVED' });
    const incomes = await getDb().transactions.toArray();
    expect(incomes).toHaveLength(1);
    expect(incomes[0]).toMatchObject({
      type: 'INCOME',
      amountPaise: 15_000_00,
      receivableId: receivable.id,
    });

    await undoReceive(receivable.id);
    expect(await getDb().receivables.get(receivable.id)).toMatchObject({
      status: 'EXPECTED',
      receivedAt: null,
    });
    expect(await getDb().transactions.count()).toBe(0);
  });

  it('accepts a different amount than expected, and handles unknown ids', async () => {
    const receivable = await owed();
    await receiveReceivable(receivable.id, { accountId: BANK, amountPaise: 10_000_00 });
    expect((await getDb().transactions.toArray())[0]!.amountPaise).toBe(10_000_00);
    await expect(receiveReceivable('missing', { accountId: BANK })).rejects.toThrow('not found');
    await undoReceive('missing');
    await cancelReceivable('missing');
  });

  it('can be cancelled', async () => {
    const receivable = await owed();
    await cancelReceivable(receivable.id);
    expect(await getDb().receivables.get(receivable.id)).toMatchObject({ status: 'CANCELLED' });
  });
});

describe('goals', () => {
  it('collects contributions, with income recorded only for other people’s money', async () => {
    const goal = await addGoal({ name: 'Purchase', targetAmountPaise: 100_000_00 });
    const mine = await addContribution({
      goalId: goal.id,
      contributor: 'Me',
      isSelf: true,
      amountPaise: 25_000_00,
    });
    const theirs = await addContribution({
      goalId: goal.id,
      contributor: 'Someone',
      isSelf: false,
      amountPaise: 20_000_00,
    });
    await receiveContribution(mine.id, BANK);
    await receiveContribution(theirs.id, BANK);
    await receiveContribution(theirs.id, BANK); // already received
    const statuses = (await getDb().goalContributions.toArray()).map((c) => c.status);
    expect(statuses).toEqual(['RECEIVED', 'RECEIVED']);
    const txns = await getDb().transactions.toArray();
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ goalContributionId: theirs.id, amountPaise: 20_000_00 });
    await expect(receiveContribution('missing')).rejects.toThrow('not found');
  });

  it('marks a contribution received without a transaction when no account is given', async () => {
    const goal = await addGoal({ name: 'Purchase', targetAmountPaise: 100_000_00 });
    const c = await addContribution({
      goalId: goal.id,
      contributor: 'Someone',
      isSelf: false,
      amountPaise: 1_000_00,
    });
    await receiveContribution(c.id);
    expect(await getDb().transactions.count()).toBe(0);
  });

  it('deletes a goal together with its contributions', async () => {
    const goal = await addGoal({ name: 'Purchase', targetAmountPaise: 100_000_00 });
    await addContribution({ goalId: goal.id, contributor: 'Me', isSelf: true, amountPaise: 1_00 });
    await deleteGoal(goal.id);
    expect(await getDb().goals.count()).toBe(0);
    expect(await getDb().goalContributions.count()).toBe(0);
  });
});

describe('allocation rules', () => {
  it('adds and removes a rule', async () => {
    const rule = await addAllocation({
      recurringItemId: ITEM,
      target: 'UNALLOCATED',
      startMonth: '2026-12-01',
      endsWhenLoanCleared: true,
      priority: 100,
    });
    expect(await getDb().allocationRules.count()).toBe(1);
    await deleteAllocation(rule.id);
    expect(await getDb().allocationRules.count()).toBe(0);
  });
});
