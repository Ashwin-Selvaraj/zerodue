import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, idByName, registerUser, resetDatabase, type TestUser } from './helpers';

describe('accounts, categories, transactions (e2e)', () => {
  let app: INestApplication;
  let user: TestUser;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    user = await registerUser(app);
  });

  const makeTxn = async (body: Record<string, unknown>, status = 201) => {
    const cash = await idByName(app, user, '/accounts', 'Cash');
    return http()
      .post('/transactions')
      .set(user.auth)
      .send({
        type: 'EXPENSE',
        amountPaise: 45_000,
        accountId: cash,
        occurredAt: '2026-11-03T10:00:00+05:30',
        ...body,
      })
      .expect(status);
  };

  describe('sign-up defaults', () => {
    it('seeds the categories, the four quick-picks and a Cash account', async () => {
      const categories = (await http().get('/categories').set(user.auth).expect(200)).body as {
        name: string;
        parentId: string | null;
        quickPick: boolean;
      }[];
      const names = categories.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'Fuel',
          'Food & going out',
          'Card',
          'EMI',
          'Gold',
          'Loans',
          'Misc',
          'Income',
          'Salary',
          'Bonus',
          'Brother',
        ]),
      );
      const income = categories.find((c) => c.name === 'Income')!;
      expect(categories.find((c) => c.name === 'Salary')!.parentId).toBe(
        (income as unknown as { id: string }).id,
      );

      const picks = (await http().get('/categories/quick-picks').set(user.auth).expect(200))
        .body as { name: string }[];
      expect(picks.map((c) => c.name).sort()).toEqual(['Card', 'Food & going out', 'Fuel', 'Misc']);

      const accounts = (await http().get('/accounts').set(user.auth).expect(200)).body as {
        name: string;
        type: string;
      }[];
      expect(accounts).toEqual([
        expect.objectContaining({ name: 'Cash', type: 'CASH', balancePaise: 0 }),
      ]);
    });

    it('requires a token', async () => {
      for (const path of [
        '/accounts',
        '/categories',
        '/transactions',
        '/recurring',
        '/sync/pull',
        '/audit',
      ]) {
        await http().get(path).expect(401);
      }
    });
  });

  describe('accounts', () => {
    it('creates, edits and deletes an account', async () => {
      const created = await http()
        .post('/accounts')
        .set(user.auth)
        .send({
          name: 'ICICI salary',
          type: 'BANK',
          last4: '1234',
          balancePaise: 500_000,
          balanceAsOf: '2026-11-03',
        })
        .expect(201);
      expect(created.body).toMatchObject({
        name: 'ICICI salary',
        balancePaise: 500_000,
        balanceAsOf: '2026-11-03',
        version: 1,
        deletedAt: null,
      });
      expect(created.body).not.toHaveProperty('userId');

      const patched = await http()
        .patch(`/accounts/${created.body.id}`)
        .set(user.auth)
        .send({ balancePaise: 600_000 })
        .expect(200);
      expect(patched.body).toMatchObject({
        balancePaise: 600_000,
        name: 'ICICI salary',
        version: 2,
      });

      await http().delete(`/accounts/${created.body.id}`).set(user.auth).expect(204);
      await http().get(`/accounts/${created.body.id}`).set(user.auth).expect(404);
      const list = (await http().get('/accounts').set(user.auth)).body as { id: string }[];
      expect(list.map((a) => a.id)).not.toContain(created.body.id);
    });

    it('validates input', async () => {
      await http()
        .post('/accounts')
        .set(user.auth)
        .send({ name: 'x', type: 'BANK', last4: '12' })
        .expect(400);
      await http().post('/accounts').set(user.auth).send({ name: '', type: 'BANK' }).expect(400);
      await http()
        .post('/accounts')
        .set(user.auth)
        .send({ name: 'x', type: 'BANK', balancePaise: 10.5 })
        .expect(400);
    });

    it("keeps each user's data private", async () => {
      const other = await registerUser(app, 'other@example.com');
      const mine = await http()
        .post('/accounts')
        .set(user.auth)
        .send({ name: 'Mine', type: 'BANK' })
        .expect(201);
      await http().get(`/accounts/${mine.body.id}`).set(other.auth).expect(404);
      await http()
        .patch(`/accounts/${mine.body.id}`)
        .set(other.auth)
        .send({ name: 'Hijack' })
        .expect(404);
      await http().delete(`/accounts/${mine.body.id}`).set(other.auth).expect(404);
      const theirs = (await http().get('/accounts').set(other.auth)).body as { name: string }[];
      expect(theirs.map((a) => a.name)).toEqual(['Cash']);
    });
  });

  describe('categories', () => {
    it('nests one level deep only', async () => {
      const parent = await http()
        .post('/categories')
        .set(user.auth)
        .send({ name: 'Travel' })
        .expect(201);
      const child = await http()
        .post('/categories')
        .set(user.auth)
        .send({ name: 'Flights', parentId: parent.body.id })
        .expect(201);
      await http()
        .post('/categories')
        .set(user.auth)
        .send({ name: 'Cabin', parentId: child.body.id })
        .expect(400);
      await http()
        .patch(`/categories/${parent.body.id}`)
        .set(user.auth)
        .send({ parentId: parent.body.id })
        .expect(400);
      const other = await http()
        .post('/categories')
        .set(user.auth)
        .send({ name: 'Other' })
        .expect(201);
      await http()
        .patch(`/categories/${parent.body.id}`)
        .set(user.auth)
        .send({ parentId: other.body.id })
        .expect(400);
    });

    it('edits and deletes', async () => {
      const created = await http()
        .post('/categories')
        .set(user.auth)
        .send({ name: 'Pets', color: '#112233', quickPick: true })
        .expect(201);
      expect(created.body).toMatchObject({ name: 'Pets', quickPick: true, kind: 'EXPENSE' });
      await http()
        .patch(`/categories/${created.body.id}`)
        .set(user.auth)
        .send({ name: 'Pet care' })
        .expect(200);
      await http()
        .post('/categories')
        .set(user.auth)
        .send({ name: 'Bad', color: 'red' })
        .expect(400);
      await http().delete(`/categories/${created.body.id}`).set(user.auth).expect(204);
      await http().get(`/categories/${created.body.id}`).set(user.auth).expect(404);
    });
  });

  describe('transactions', () => {
    it('creates an expense and records how it was categorised', async () => {
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      const res = await makeTxn({ categoryId: fuel, merchant: 'Shell', tags: ['car'] }, 201);
      expect(res.body).toMatchObject({
        type: 'EXPENSE',
        amountPaise: 45_000,
        categoryId: fuel,
        categorisedVia: 'MANUAL',
        status: 'POSTED',
        source: 'MANUAL',
        tags: ['car'],
        version: 1,
      });
      expect(res.body.occurredAt).toBe('2026-11-03T04:30:00.000Z');
    });

    it('accepts an uncategorised expense (quick-add without a category)', async () => {
      const res = await makeTxn({}, 201);
      expect(res.body).toMatchObject({ categoryId: null, categorisedVia: null });
    });

    it('rejects bad amounts and shapes', async () => {
      await makeTxn({ amountPaise: 0 }, 400);
      await makeTxn({ amountPaise: -5 }, 400);
      await makeTxn({ amountPaise: 99.5 }, 400);
      await makeTxn({ occurredAt: 'yesterday' }, 400);
    });

    it('validates transfers', async () => {
      const cash = await idByName(app, user, '/accounts', 'Cash');
      const bank = (
        await http()
          .post('/accounts')
          .set(user.auth)
          .send({ name: 'Bank', type: 'BANK' })
          .expect(201)
      ).body.id;
      await makeTxn({ type: 'TRANSFER' }, 400); // no destination
      await makeTxn({ type: 'TRANSFER', toAccountId: cash }, 400); // same account
      await makeTxn({ type: 'EXPENSE', toAccountId: bank }, 400); // not a transfer
      const ok = await makeTxn({ type: 'TRANSFER', toAccountId: bank }, 201);
      expect(ok.body.toAccountId).toBe(bank);
    });

    it('checks that the category suits the transaction type', async () => {
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      const salary = await idByName(app, user, '/categories', 'Salary');
      await makeTxn({ type: 'INCOME', categoryId: fuel }, 400);
      await makeTxn({ type: 'EXPENSE', categoryId: salary }, 400);
      await makeTxn({ type: 'INCOME', categoryId: salary }, 201);
    });

    it("refuses to reference another user's account or category", async () => {
      const other = await registerUser(app, 'other@example.com');
      const theirCash = await idByName(app, other, '/accounts', 'Cash');
      const theirFuel = await idByName(app, other, '/categories', 'Fuel');
      await makeTxn({ accountId: theirCash }, 400);
      await makeTxn({ categoryId: theirFuel }, 400);
    });

    it('edits, recategorises and deletes, keeping an audit trail', async () => {
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      const food = await idByName(app, user, '/categories', 'Food & going out');
      const { body: txn } = await makeTxn({ categoryId: fuel }, 201);

      const patched = await http()
        .patch(`/transactions/${txn.id}`)
        .set(user.auth)
        .send({ categoryId: food, note: 'lunch' })
        .expect(200);
      expect(patched.body).toMatchObject({
        categoryId: food,
        note: 'lunch',
        categorisedVia: 'MANUAL',
        version: 2,
        amountPaise: 45_000,
      });
      await http()
        .patch(`/transactions/${txn.id}`)
        .set(user.auth)
        .send({ categoryId: null })
        .expect(200);
      await http().delete(`/transactions/${txn.id}`).set(user.auth).expect(204);
      await http().get(`/transactions/${txn.id}`).set(user.auth).expect(404);

      const audit = (
        await http().get(`/audit?entity=transaction&entityId=${txn.id}`).set(user.auth).expect(200)
      ).body as { action: string; before: unknown; after: unknown }[];
      expect(audit.map((a) => a.action).sort()).toEqual(['CREATE', 'DELETE', 'UPDATE', 'UPDATE']);
      const update = audit.find(
        (a) => a.action === 'UPDATE' && (a.after as { categoryId?: string }).categoryId === food,
      )!;
      expect((update.before as { categoryId: string }).categoryId).toBe(fuel);
    });

    it("hides other users' transactions", async () => {
      const other = await registerUser(app, 'other@example.com');
      const { body: txn } = await makeTxn({}, 201);
      await http().get(`/transactions/${txn.id}`).set(other.auth).expect(404);
      await http().patch(`/transactions/${txn.id}`).set(other.auth).send({ note: 'x' }).expect(404);
      const list = (await http().get('/transactions').set(other.auth).expect(200)).body;
      expect(list.items).toEqual([]);
    });
  });

  describe('merchant rules', () => {
    it('categorises a new transaction from a matching rule, and records that', async () => {
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      await http()
        .post('/rules')
        .set(user.auth)
        .send({ matchType: 'MERCHANT_CONTAINS', pattern: 'shell', categoryId: fuel })
        .expect(201);
      const res = await makeTxn({ merchant: 'SHELL Pune' }, 201);
      expect(res.body).toMatchObject({ categoryId: fuel, categorisedVia: 'RULE' });
      const unmatched = await makeTxn({ merchant: 'Corner shop' }, 201);
      expect(unmatched.body.categoryId).toBeNull();
    });

    it('does not override a category the user chose, a disabled rule, or a mismatched type', async () => {
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      const food = await idByName(app, user, '/categories', 'Food & going out');
      const rule = await http()
        .post('/rules')
        .set(user.auth)
        .send({ matchType: 'MERCHANT_EQUALS', pattern: 'Shell', categoryId: fuel })
        .expect(201);
      const chosen = await makeTxn({ merchant: 'Shell', categoryId: food }, 201);
      expect(chosen.body).toMatchObject({ categoryId: food, categorisedVia: 'MANUAL' });

      const asIncome = await makeTxn({ merchant: 'Shell', type: 'INCOME' }, 201);
      expect(asIncome.body.categoryId).toBeNull(); // a fuel rule must not label income

      await http()
        .patch(`/rules/${rule.body.id}`)
        .set(user.auth)
        .send({ enabled: false })
        .expect(200);
      const off = await makeTxn({ merchant: 'Shell' }, 201);
      expect(off.body.categoryId).toBeNull();
    });

    it('does not re-apply rules when an edit clears the category', async () => {
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      await http()
        .post('/rules')
        .set(user.auth)
        .send({ matchType: 'MERCHANT_CONTAINS', pattern: 'shell', categoryId: fuel })
        .expect(201);
      const { body } = await makeTxn({ merchant: 'Shell' }, 201);
      const cleared = await http()
        .patch(`/transactions/${body.id}`)
        .set(user.auth)
        .send({ categoryId: null })
        .expect(200);
      expect(cleared.body).toMatchObject({ categoryId: null, categorisedVia: null });
    });

    it('lists and deletes rules', async () => {
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      const rule = await http()
        .post('/rules')
        .set(user.auth)
        .send({ matchType: 'VPA_EQUALS', pattern: 'pump@upi', categoryId: fuel })
        .expect(201);
      expect(((await http().get('/rules').set(user.auth)).body as unknown[]).length).toBe(1);
      await http().delete(`/rules/${rule.body.id}`).set(user.auth).expect(204);
      expect(((await http().get('/rules').set(user.auth)).body as unknown[]).length).toBe(0);
      await http()
        .post('/rules')
        .set(user.auth)
        .send({ matchType: 'VPA_EQUALS', pattern: 'x', categoryId: randomUUID() })
        .expect(400);
    });
  });

  describe('listing, filters and paging', () => {
    it('filters by month in IST, category, account, status, tag and text', async () => {
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      const bank = (
        await http()
          .post('/accounts')
          .set(user.auth)
          .send({ name: 'Bank', type: 'BANK' })
          .expect(201)
      ).body.id;
      // 20:00 UTC on 30 Nov is already 1 Dec in India
      await makeTxn(
        {
          occurredAt: '2026-11-30T20:00:00Z',
          merchant: 'December in IST',
          categoryId: fuel,
          tags: ['car'],
        },
        201,
      );
      await makeTxn(
        {
          occurredAt: '2026-11-15T10:00:00+05:30',
          merchant: 'Mid November',
          accountId: bank,
          note: 'Groceries',
        },
        201,
      );
      await makeTxn(
        {
          occurredAt: '2026-10-31T23:59:00+05:30',
          merchant: 'Last of October',
          status: 'PENDING_CATEGORY',
        },
        201,
      );

      const merchants = async (query: string) =>
        (
          (await http().get(`/transactions?${query}`).set(user.auth).expect(200)).body.items as {
            merchant: string;
          }[]
        ).map((t) => t.merchant);

      expect(await merchants('month=2026-12-01')).toEqual(['December in IST']);
      expect(await merchants('month=2026-11-01')).toEqual(['Mid November']);
      expect(await merchants('month=2026-10-01')).toEqual(['Last of October']);
      expect(await merchants(`categoryId=${fuel}`)).toEqual(['December in IST']);
      expect(await merchants(`accountId=${bank}`)).toEqual(['Mid November']);
      expect(await merchants('status=PENDING_CATEGORY')).toEqual(['Last of October']);
      expect(await merchants('tag=car')).toEqual(['December in IST']);
      expect(await merchants('q=grocer')).toEqual(['Mid November']);
      expect(await merchants('q=DECEMBER')).toEqual(['December in IST']);
      expect(await merchants('')).toEqual(['December in IST', 'Mid November', 'Last of October']); // newest first
    });

    it('pages through results with a cursor, with no gaps or repeats', async () => {
      for (let day = 1; day <= 7; day++) {
        await makeTxn(
          { occurredAt: `2026-11-0${day}T10:00:00+05:30`, merchant: `Day ${day}` },
          201,
        );
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await http()
          .get(`/transactions?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
          .set(user.auth)
          .expect(200);
        seen.push(...(res.body.items as { merchant: string }[]).map((t) => t.merchant));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toEqual(['Day 7', 'Day 6', 'Day 5', 'Day 4', 'Day 3', 'Day 2', 'Day 1']);
      await http().get('/transactions?cursor=garbage').set(user.auth).expect(400);
      await http().get('/transactions?limit=0').set(user.auth).expect(400);
    });

    it('recategorises many at once and rejects unknown ids', async () => {
      const food = await idByName(app, user, '/categories', 'Food & going out');
      const a = (await makeTxn({}, 201)).body.id;
      const b = (await makeTxn({}, 201)).body.id;
      const res = await http()
        .post('/transactions/bulk-categorise')
        .set(user.auth)
        .send({ ids: [a, b], categoryId: food })
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(
        res.body.every(
          (t: { categoryId: string; categorisedVia: string }) =>
            t.categoryId === food && t.categorisedVia === 'MANUAL',
        ),
      ).toBe(true);
      await http()
        .post('/transactions/bulk-categorise')
        .set(user.auth)
        .send({ ids: [a, randomUUID()], categoryId: food })
        .expect(404);
      await http()
        .post('/transactions/bulk-categorise')
        .set(user.auth)
        .send({ ids: [], categoryId: food })
        .expect(400);
    });
  });
});
