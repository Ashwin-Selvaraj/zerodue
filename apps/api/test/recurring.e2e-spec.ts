import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, idByName, registerUser, resetDatabase, type TestUser } from './helpers';

interface Occurrence {
  id: string;
  dueDate: string;
  status: string;
  expectedAmountPaise: number;
  paidAmountPaise: number | null;
  paidAt: string | null;
  name: string;
  kind: string;
  overdue: boolean;
}

describe('recurring items and bills (e2e)', () => {
  let app: INestApplication;
  let user: TestUser;
  let now: Date;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp(() => now);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    now = new Date('2026-11-03T10:00:00+05:30'); // the day this project started
    await resetDatabase(app);
    user = await registerUser(app);
  });

  const emi = (extra: Record<string, unknown> = {}) => ({
    kind: 'EXPENSE',
    name: 'Personal loan EMI',
    frequency: 'MONTHLY',
    dueDay: 5,
    startDate: '2026-11-01',
    periods: [{ effectiveFrom: '2026-11-01', amountPaise: 450_000 }],
    ...extra,
  });
  const createItem = async (body: Record<string, unknown>, status = 201) =>
    (await http().post('/recurring').set(user.auth).send(body).expect(status)).body;
  const occurrences = async (query = ''): Promise<Occurrence[]> =>
    (await http().get(`/recurring/occurrences${query}`).set(user.auth).expect(200)).body;

  describe('creating items and generating due dates', () => {
    it('creates an item with its amount schedule and generates upcoming occurrences', async () => {
      const item = await createItem(emi());
      expect(item).toMatchObject({
        name: 'Personal loan EMI',
        dueDay: 5,
        active: true,
        version: 1,
      });
      expect(item.periods).toHaveLength(1);
      expect(item.periods[0]).toMatchObject({ effectiveFrom: '2026-11-01', amountPaise: 450_000 });

      const list = await occurrences();
      expect(list.map((o) => o.dueDate)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']); // default window: -1 to +2 months
      expect(list[0]).toMatchObject({
        name: 'Personal loan EMI',
        kind: 'EXPENSE',
        status: 'UPCOMING',
        expectedAmountPaise: 450_000,
        overdue: false,
      });
    });

    it('steps the amount: card bill is ₹20,000 until the March bill, then ₹12,000', async () => {
      await createItem({
        kind: 'EXPENSE',
        name: 'Credit card bill',
        frequency: 'MONTHLY',
        dueDay: 4,
        startDate: '2026-11-04',
        periods: [
          {
            effectiveFrom: '2026-11-04',
            amountPaise: 2_000_000,
            label: 'Fuel + mobile EMI + buffer',
            breakdown: { Fuel: 700_000, 'Mobile EMI': 800_000, Buffer: 500_000 },
          },
          { effectiveFrom: '2027-05-04', amountPaise: 1_200_000, label: 'Fuel + buffer' },
        ],
      });
      const list = await occurrences('?from=2027-03-01&to=2027-06-30');
      expect(list.map((o) => [o.dueDate, o.expectedAmountPaise])).toEqual([
        ['2027-03-04', 2_000_000],
        ['2027-04-04', 2_000_000],
        ['2027-05-04', 1_200_000],
        ['2027-06-04', 1_200_000],
      ]);
      const [card] = (await http().get('/recurring').set(user.auth)).body;
      expect(card.periods[0].breakdown).toEqual({
        Fuel: 700_000,
        'Mobile EMI': 800_000,
        Buffer: 500_000,
      });
    });

    it('generates quarterly income on its cycle and clamps the due day to short months', async () => {
      await createItem({
        kind: 'INCOME',
        name: 'Bonus',
        frequency: 'QUARTERLY',
        dueDay: 30,
        anchorMonth: '2026-11-01',
        startDate: '2026-11-01',
        periods: [{ effectiveFrom: '2026-11-01', amountPaise: 3_000_000 }],
      });
      expect((await occurrences('?from=2026-11-01&to=2027-06-30')).map((o) => o.dueDate)).toEqual([
        '2026-11-30',
        '2027-02-28',
        '2027-05-30',
      ]);
    });

    it('rejects invalid items without leaving anything behind', async () => {
      await createItem(emi({ dueDay: 32 }), 400);
      await createItem(emi({ frequency: 'WEEKLY' }), 400);
      await createItem(emi({ periods: [{ effectiveFrom: '2026-11-01', amountPaise: -5 }] }), 400);
      const other = await registerUser(app, 'other@example.com');
      await createItem(emi({ categoryId: await idByName(app, other, '/categories', 'EMI') }), 400);
      expect((await http().get('/recurring').set(user.auth)).body).toEqual([]);
    });

    it('keeps items private to their owner', async () => {
      const item = await createItem(emi());
      const other = await registerUser(app, 'other@example.com');
      await http().get(`/recurring/${item.id}`).set(other.auth).expect(404);
      await http().patch(`/recurring/${item.id}`).set(other.auth).send({ name: 'x' }).expect(404);
      expect((await http().get('/recurring/occurrences').set(other.auth)).body).toEqual([]);
    });
  });

  describe('overdue and paid', () => {
    it('flags an unpaid occurrence as overdue once its date has passed', async () => {
      await createItem(emi());
      expect((await occurrences())[0]!.overdue).toBe(false); // due 5 Nov, today is 3 Nov
      now = new Date('2026-11-06T09:00:00+05:30');
      const [nov] = await occurrences();
      expect(nov).toMatchObject({ dueDate: '2026-11-05', overdue: true });
      await http()
        .post(`/recurring/occurrences/${nov!.id}/mark-paid`)
        .set(user.auth)
        .send({})
        .expect(200);
      expect((await occurrences())[0]).toMatchObject({ status: 'PAID', overdue: false });
    });

    it('marks paid and records the transaction, idempotently', async () => {
      const emiCategory = await idByName(app, user, '/categories', 'EMI');
      const cash = await idByName(app, user, '/accounts', 'Cash');
      await createItem(emi({ categoryId: emiCategory, accountId: cash }));
      const [nov] = await occurrences();

      const paid = await http()
        .post(`/recurring/occurrences/${nov!.id}/mark-paid`)
        .set(user.auth)
        .send({ createTransaction: true })
        .expect(200);
      expect(paid.body).toMatchObject({
        status: 'PAID',
        paidAmountPaise: 450_000,
        name: 'Personal loan EMI',
      });
      expect(paid.body.paidAt).toEqual(expect.any(String));

      const again = await http()
        .post(`/recurring/occurrences/${nov!.id}/mark-paid`)
        .set(user.auth)
        .send({ createTransaction: true })
        .expect(200);
      expect(again.body.status).toBe('PAID');

      const txns = (await http().get('/transactions').set(user.auth)).body.items;
      expect(txns).toHaveLength(1); // not duplicated by the repeat
      expect(txns[0]).toMatchObject({
        type: 'EXPENSE',
        amountPaise: 450_000,
        merchant: 'Personal loan EMI',
        source: 'RECURRING',
        categoryId: emiCategory,
        accountId: cash,
        occurrenceId: nov!.id,
      });
    });

    it('needs an account to record a transaction, and takes a custom amount', async () => {
      await createItem(emi());
      const [nov, dec] = await occurrences();
      await http()
        .post(`/recurring/occurrences/${nov!.id}/mark-paid`)
        .set(user.auth)
        .send({ createTransaction: true })
        .expect(400);
      expect((await occurrences())[0]!.status).toBe('UPCOMING'); // nothing half-done

      const cash = await idByName(app, user, '/accounts', 'Cash');
      const custom = await http()
        .post(`/recurring/occurrences/${dec!.id}/mark-paid`)
        .set(user.auth)
        .send({ amountPaise: 400_000, accountId: cash, createTransaction: true })
        .expect(200);
      expect(custom.body.paidAmountPaise).toBe(400_000);
      expect((await http().get('/transactions').set(user.auth)).body.items[0].amountPaise).toBe(
        400_000,
      );

      const jan = (await occurrences())[2]!;
      const plain = await http()
        .post(`/recurring/occurrences/${jan.id}/mark-paid`)
        .set(user.auth)
        .send({})
        .expect(200);
      expect(plain.body.status).toBe('PAID');
      expect((await http().get('/transactions').set(user.auth)).body.items).toHaveLength(1); // no transaction was asked for
    });

    it('undoes a payment: due again, and its transaction is removed', async () => {
      const cash = await idByName(app, user, '/accounts', 'Cash');
      await createItem(emi({ accountId: cash }));
      const [nov] = await occurrences();
      await http()
        .post(`/recurring/occurrences/${nov!.id}/mark-paid`)
        .set(user.auth)
        .send({ createTransaction: true })
        .expect(200);

      const undone = await http()
        .post(`/recurring/occurrences/${nov!.id}/unmark`)
        .set(user.auth)
        .send({})
        .expect(200);
      expect(undone.body).toMatchObject({
        status: 'UPCOMING',
        paidAt: null,
        paidAmountPaise: null,
      });
      expect((await http().get('/transactions').set(user.auth)).body.items).toEqual([]);
    });

    it('can skip an occurrence', async () => {
      await createItem(emi());
      const [nov] = await occurrences();
      const skipped = await http()
        .post(`/recurring/occurrences/${nov!.id}/skip`)
        .set(user.auth)
        .send({})
        .expect(200);
      expect(skipped.body.status).toBe('SKIPPED');
      expect((await occurrences('?status=SKIPPED')).map((o) => o.id)).toEqual([nov!.id]);
      await http()
        .post(`/recurring/occurrences/${randomUUID()}/skip`)
        .set(user.auth)
        .send({})
        .expect(404);
    });
  });

  describe('changing an item after the fact', () => {
    it('re-prices upcoming occurrences but never rewrites ones already paid', async () => {
      const item = await createItem(emi());
      const [nov] = await occurrences();
      await http()
        .post(`/recurring/occurrences/${nov!.id}/mark-paid`)
        .set(user.auth)
        .send({})
        .expect(200);

      await http()
        .put(`/recurring/${item.id}/periods`)
        .set(user.auth)
        .send({ periods: [{ effectiveFrom: '2026-11-01', amountPaise: 500_000 }] })
        .expect(200);
      const list = await occurrences();
      expect(list.map((o) => [o.dueDate, o.status, o.expectedAmountPaise])).toEqual([
        ['2026-11-05', 'PAID', 450_000],
        ['2026-12-05', 'UPCOMING', 500_000],
        ['2027-01-05', 'UPCOMING', 500_000],
      ]);
    });

    it('replaces the schedule: adds, updates and removes periods, and rejects duplicate dates', async () => {
      const item = await createItem(emi());
      const next = await http()
        .put(`/recurring/${item.id}/periods`)
        .set(user.auth)
        .send({
          periods: [
            { effectiveFrom: '2026-11-01', amountPaise: 450_000 },
            { effectiveFrom: '2027-01-01', amountPaise: 480_000 },
          ],
        })
        .expect(200);
      expect(next.body.periods).toHaveLength(2);
      expect((await occurrences()).map((o) => o.expectedAmountPaise)).toEqual([
        450_000, 450_000, 480_000,
      ]);

      const only = await http()
        .put(`/recurring/${item.id}/periods`)
        .set(user.auth)
        .send({ periods: [{ effectiveFrom: '2027-01-01', amountPaise: 480_000 }] })
        .expect(200);
      expect(only.body.periods.map((p: { effectiveFrom: string }) => p.effectiveFrom)).toEqual([
        '2027-01-01',
      ]);
      // earlier dates now have no amount, so only January remains
      expect((await occurrences()).map((o) => o.dueDate)).toEqual(['2027-01-05']);

      await http()
        .put(`/recurring/${item.id}/periods`)
        .set(user.auth)
        .send({
          periods: [
            { effectiveFrom: '2027-01-01', amountPaise: 1 },
            { effectiveFrom: '2027-01-01', amountPaise: 2 },
          ],
        })
        .expect(400);
      // a removed date can be added back
      await http()
        .put(`/recurring/${item.id}/periods`)
        .set(user.auth)
        .send({ periods: [{ effectiveFrom: '2026-11-01', amountPaise: 450_000 }] })
        .expect(200);
      expect((await occurrences()).map((o) => o.dueDate)).toEqual([
        '2026-11-05',
        '2026-12-05',
        '2027-01-05',
      ]);
    });

    it('drops later occurrences when the end date moves up, or the item is paused', async () => {
      const item = await createItem(emi());
      await http()
        .patch(`/recurring/${item.id}`)
        .set(user.auth)
        .send({ endDate: '2026-12-31' })
        .expect(200);
      expect((await occurrences()).map((o) => o.dueDate)).toEqual(['2026-11-05', '2026-12-05']);

      await http()
        .patch(`/recurring/${item.id}`)
        .set(user.auth)
        .send({ active: false })
        .expect(200);
      expect(await occurrences()).toEqual([]);
      await http()
        .patch(`/recurring/${item.id}`)
        .set(user.auth)
        .send({ active: true, endDate: null })
        .expect(200);
      expect((await occurrences()).map((o) => o.dueDate)).toEqual([
        '2026-11-05',
        '2026-12-05',
        '2027-01-05',
      ]);
    });

    it('deleting an item removes it, its amounts and its upcoming due dates', async () => {
      const item = await createItem(emi());
      await occurrences();
      await http().delete(`/recurring/${item.id}`).set(user.auth).expect(204);
      await http().get(`/recurring/${item.id}`).set(user.auth).expect(404);
      expect((await http().get('/recurring').set(user.auth)).body).toEqual([]);
      expect(await occurrences()).toEqual([]);
    });
  });
});
