import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, idByName, registerUser, resetDatabase, type TestUser } from './helpers';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('loans, receivables, goals and allocation (e2e)', () => {
  let app: INestApplication;
  let user: TestUser;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp(() => new Date('2026-11-03T10:00:00+05:30'));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    user = await registerUser(app);
  });

  const create = async (path: string, body: Json, status = 201) =>
    (await http().post(path).set(user.auth).send(body).expect(status)).body as Json;

  const makeLoan = (overrides: Json = {}) =>
    create('/loans', {
      name: 'Test loan',
      kind: 'FLEXIBLE',
      outstandingPaise: 50_000_00,
      outstandingAsOf: '2026-11-01',
      annualRateBps: 900,
      interestStartMonth: '2026-11-01',
      ...overrides,
    });

  describe('loans', () => {
    it('stores a flexible loan with its rate and interest start month', async () => {
      const loan = await makeLoan();
      expect(loan).toMatchObject({
        status: 'ACTIVE',
        outstandingPaise: 5_000_000,
        annualRateBps: 900,
        interestStartMonth: '2026-11-01',
        outstandingAsOf: '2026-11-01',
      });
      const list = (await http().get('/loans').set(user.auth).expect(200)).body as Json[];
      expect(list.map((l) => l.id)).toEqual([loan.id]);
    });

    it('rejects a rate above 100% and a start month that is not the 1st', async () => {
      await create('/loans', { name: 'x', kind: 'EMI', annualRateBps: 10_001 }, 400);
      await create('/loans', { name: 'x', kind: 'EMI', interestStartMonth: '2026-11-15' }, 400);
    });

    it('closes a loan and keeps its history', async () => {
      const loan = await makeLoan();
      const closed = (
        await http()
          .patch(`/loans/${loan.id}`)
          .set(user.auth)
          .send({ status: 'CLOSED', closedAt: '2026-12-31' })
          .expect(200)
      ).body as Json;
      expect(closed).toMatchObject({ status: 'CLOSED', closedAt: '2026-12-31' });
    });

    it('records interest and payments in the ledger against the loan', async () => {
      const loan = await makeLoan();
      const interest = await create('/loan-ledger', {
        loanId: loan.id,
        kind: 'INTEREST',
        month: '2026-11-01',
        effectiveDate: '2026-11-30',
        amountPaise: 37_500,
        balanceAfterPaise: 5_037_500,
      });
      const payment = await create('/loan-ledger', {
        loanId: loan.id,
        kind: 'PAYMENT',
        month: '2026-11-01',
        effectiveDate: '2026-11-30',
        amountPaise: 1_000_000,
        balanceAfterPaise: 4_037_500,
      });
      const list = (await http().get('/loan-ledger').set(user.auth).expect(200)).body as Json[];
      expect(list.map((e) => e.id).sort()).toEqual([interest.id, payment.id].sort());
    });

    it('does not accept ledger entries for a loan that is not yours', async () => {
      const loan = await makeLoan();
      const other = await registerUser(app, 'other@example.com');
      await http()
        .post('/loan-ledger')
        .set(other.auth)
        .send({
          loanId: loan.id,
          kind: 'PAYMENT',
          month: '2026-11-01',
          effectiveDate: '2026-11-30',
          amountPaise: 100,
          balanceAfterPaise: 0,
        })
        .expect(400);
    });

    it('lets a manual payment be set for a month and changed', async () => {
      const loan = await makeLoan();
      const planned = await create('/planned-payments', {
        loanId: loan.id,
        month: '2026-12-01',
        amountPaise: 2_000_000,
      });
      const changed = (
        await http()
          .patch(`/planned-payments/${planned.id}`)
          .set(user.auth)
          .send({ amountPaise: 2_500_000 })
          .expect(200)
      ).body as Json;
      expect(changed.amountPaise).toBe(2_500_000);
    });

    it('saves a what-if scenario with its parameters', async () => {
      const loan = await makeLoan();
      const scenario = await create('/scenarios', {
        loanId: loan.id,
        name: 'Extra in Jan',
        params: { extraPayments: [{ month: '2027-01-01', amountPaise: 1_000_000 }] },
      });
      expect(scenario.params).toEqual({
        extraPayments: [{ month: '2027-01-01', amountPaise: 1_000_000 }],
      });
      await create('/scenarios', { name: 'bad', params: { targetMonth: '2027-01-09' } }, 400);
    });
  });

  describe('receivables', () => {
    it('stores money owed to you and money you expect to earn', async () => {
      const owed = await create('/receivables', {
        kind: 'OWED_TO_ME',
        counterparty: 'A friend',
        amountPaise: 2_000_000,
        expectedDate: '2026-12-05',
      });
      const earn = await create('/receivables', {
        kind: 'EXPECTED_INCOME',
        counterparty: 'A client',
        amountPaise: 7_000_000,
        expectedDate: '2026-11-16',
      });
      expect(owed.status).toBe('EXPECTED');
      expect(earn.expectedDate).toBe('2026-11-16');
    });

    it('marks one received and lets a transaction point at it', async () => {
      const receivable = await create('/receivables', {
        kind: 'OWED_TO_ME',
        counterparty: 'A friend',
        amountPaise: 2_000_000,
        expectedDate: '2026-12-05',
      });
      const received = (
        await http()
          .patch(`/receivables/${receivable.id}`)
          .set(user.auth)
          .send({ status: 'RECEIVED', receivedAt: '2026-12-04T11:00:00+05:30' })
          .expect(200)
      ).body as Json;
      expect(received.status).toBe('RECEIVED');

      const txn = await create('/transactions', {
        type: 'INCOME',
        amountPaise: 2_000_000,
        accountId: await idByName(app, user, '/accounts', 'Cash'),
        occurredAt: '2026-12-04T11:00:00+05:30',
        receivableId: receivable.id,
      });
      expect(txn.receivableId).toBe(receivable.id);
    });
  });

  describe('goals', () => {
    it('keeps contributions from several people against a goal', async () => {
      const goal = await create('/goals', {
        name: 'New purchase',
        targetAmountPaise: 10_000_000,
        targetDate: '2027-02-01',
        metadata: { item: 'example' },
      });
      await create('/goal-contributions', {
        goalId: goal.id,
        contributor: 'Me',
        isSelf: true,
        amountPaise: 3_000_000,
        status: 'RECEIVED',
        receivedOn: '2026-11-03',
      });
      const pledged = await create('/goal-contributions', {
        goalId: goal.id,
        contributor: 'Someone else',
        amountPaise: 2_500_000,
      });
      expect(pledged).toMatchObject({ status: 'PLEDGED', isSelf: false });
      const list = (await http().get('/goal-contributions').set(user.auth).expect(200))
        .body as Json[];
      expect(list).toHaveLength(2);
    });

    it('rejects a contribution to a goal that does not exist', async () => {
      await create(
        '/goal-contributions',
        { goalId: randomUUID(), contributor: 'Me', amountPaise: 100 },
        400,
      );
    });
  });

  describe('allocation rules', () => {
    const makeStream = async () =>
      (
        await http()
          .post('/recurring')
          .set(user.auth)
          .send({
            kind: 'INCOME',
            name: 'Family support',
            frequency: 'MONTHLY',
            dueDay: 1,
            startDate: '2026-12-01',
            fixedOutgoing: false,
            periods: [{ effectiveFrom: '2026-12-01', amountPaise: 6_000_000 }],
          })
          .expect(201)
      ).body as Json;

    it('sends earmarked income to a loan', async () => {
      const loan = await makeLoan();
      const stream = await makeStream();
      const rule = await create('/allocation-rules', {
        recurringItemId: stream.id,
        target: 'LOAN',
        loanId: loan.id,
        startMonth: '2026-12-01',
      });
      expect(rule).toMatchObject({ target: 'LOAN', endsWhenLoanCleared: true, priority: 100 });
    });

    it('needs a loan for a loan rule, a goal for a goal rule, and a sensible date range', async () => {
      const stream = await makeStream();
      const base = { recurringItemId: stream.id, startMonth: '2026-12-01' };
      await create('/allocation-rules', { ...base, target: 'LOAN' }, 400);
      await create('/allocation-rules', { ...base, target: 'GOAL' }, 400);
      await create(
        '/allocation-rules',
        { ...base, target: 'RETURN_TO_SOURCE', endMonth: '2026-11-01' },
        400,
      );
      await create('/allocation-rules', { ...base, target: 'UNALLOCATED' });
    });
  });

  describe('sync', () => {
    const device = randomUUID();
    const upsert = (entity: string, id: string, data: Json, baseVersion = 0): Json => ({
      entity,
      op: 'upsert',
      id,
      data,
      editedAt: '2026-11-03T10:00:00+05:30',
      baseVersion,
    });
    const push = async (ops: Json[]) =>
      (await http().post('/sync/push').set(user.auth).send({ deviceId: device, ops }).expect(200))
        .body.results as Json[];

    it('carries a loan, its ledger and a goal to another device in order', async () => {
      const loanId = randomUUID();
      const ledgerId = randomUUID();
      const goalId = randomUUID();
      const results = await push([
        upsert('loan', loanId, { name: 'Test loan', kind: 'FLEXIBLE', annualRateBps: 900 }),
        upsert('loanLedgerEntry', ledgerId, {
          loanId,
          kind: 'INTEREST',
          month: '2026-11-01',
          effectiveDate: '2026-11-30',
          amountPaise: 3_750_00,
          balanceAfterPaise: 603_750_00,
        }),
        upsert('goal', goalId, { name: 'Purchase', targetAmountPaise: 1_000_000 }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);

      const pulled = (await http().get('/sync/pull').set(user.auth).expect(200)).body as Json;
      expect(pulled.changes.loan.map((r: Json) => r.id)).toEqual([loanId]);
      expect(pulled.changes.loanLedgerEntry[0]).toMatchObject({
        loanId,
        amountPaise: 375_000,
        month: '2026-11-01',
      });
      expect(pulled.changes.goal.map((r: Json) => r.id)).toEqual([goalId]);
    });

    it('rejects a ledger entry whose loan has not been sent', async () => {
      const [result] = await push([
        upsert('loanLedgerEntry', randomUUID(), {
          loanId: randomUUID(),
          kind: 'PAYMENT',
          month: '2026-11-01',
          effectiveDate: '2026-11-30',
          amountPaise: 100,
          balanceAfterPaise: 0,
        }),
      ]);
      expect(result?.status).toBe('rejected');
    });

    it('tells other devices about a deleted planned payment', async () => {
      const loanId = randomUUID();
      const plannedId = randomUUID();
      await push([
        upsert('loan', loanId, { name: 'Test loan', kind: 'FLEXIBLE' }),
        upsert('loanPlannedPayment', plannedId, {
          loanId,
          month: '2026-12-01',
          amountPaise: 1_000_000,
        }),
      ]);
      const first = (await http().get('/sync/pull').set(user.auth).expect(200)).body as Json;
      const [deleted] = await push([
        {
          entity: 'loanPlannedPayment',
          op: 'delete',
          id: plannedId,
          editedAt: '2026-11-03T11:00:00+05:30',
          baseVersion: 1,
        },
      ]);
      expect(deleted?.status).toBe('applied');
      const pulled = (
        await http().get('/sync/pull').query({ cursor: first.cursor }).set(user.auth).expect(200)
      ).body as Json;
      expect(pulled.changes.loanPlannedPayment).toHaveLength(1);
      expect(pulled.changes.loanPlannedPayment[0]).toMatchObject({ id: plannedId });
      expect(pulled.changes.loanPlannedPayment[0].deletedAt).not.toBeNull();
    });
  });
});
