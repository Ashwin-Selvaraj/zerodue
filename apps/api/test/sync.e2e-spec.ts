import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp, idByName, registerUser, resetDatabase, type TestUser } from './helpers';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PHONE = randomUUID();
const LAPTOP = randomUUID();
const at = (hhmm: string) => `2026-11-03T${hhmm}:00+05:30`;

describe('offline sync (e2e)', () => {
  let app: INestApplication;
  let user: TestUser;
  let cash: string;
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
    cash = await idByName(app, user, '/accounts', 'Cash');
  });

  const push = async (ops: Json[], device = PHONE) =>
    (await http().post('/sync/push').set(user.auth).send({ deviceId: device, ops }).expect(200))
      .body.results as Json[];
  const pull = async (query = '') =>
    (await http().get(`/sync/pull?${query}`).set(user.auth).expect(200)).body as Json;
  const upsert = (
    entity: string,
    id: string,
    data: Json,
    editedAt: string,
    baseVersion = 0,
  ): Json => ({
    entity,
    op: 'upsert',
    id,
    data,
    editedAt,
    baseVersion,
  });
  const del = (entity: string, id: string, editedAt: string, baseVersion: number): Json => ({
    entity,
    op: 'delete',
    id,
    editedAt,
    baseVersion,
  });
  const txn = (over: Json = {}): Json => ({
    type: 'EXPENSE',
    amountPaise: 10_000,
    accountId: cash,
    occurredAt: at('09:00'),
    ...over,
  });
  const fetchTxn = async (id: string, status = 200) =>
    (await http().get(`/transactions/${id}`).set(user.auth).expect(status)).body as Json;
  const conflictsFor = async (id: string) =>
    (
      (await http().get(`/audit?entity=transaction&entityId=${id}`).set(user.auth)).body as Json[]
    ).filter((a) => a.action === 'CONFLICT_OVERWRITTEN');

  describe('pushing offline changes', () => {
    it("stores a record created offline under the device's own id and edit time", async () => {
      const id = randomUUID();
      const [result] = await push([
        upsert('transaction', id, txn({ merchant: 'Chai' }), at('09:30')),
      ]);
      expect(result).toMatchObject({ entity: 'transaction', id, status: 'applied' });
      expect(await fetchTxn(id)).toMatchObject({
        id,
        merchant: 'Chai',
        version: 1,
        lastDeviceId: PHONE,
        editedAt: '2026-11-03T04:00:00.000Z',
      });
    });

    it('applies a batch in order, so a record can depend on one created just before it', async () => {
      const account = randomUUID();
      const t = randomUUID();
      const results = await push([
        upsert('account', account, { name: 'Wallet', type: 'WALLET' }, at('09:00')),
        upsert('transaction', t, txn({ accountId: account }), at('09:01')),
      ]);
      expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
      expect((await fetchTxn(t)).accountId).toBe(account);
    });

    it('rejects a bad op without blocking the others', async () => {
      const good = randomUUID();
      const results = await push([
        upsert('transaction', randomUUID(), txn({ accountId: randomUUID() }), at('09:00')), // unknown account
        upsert('transaction', randomUUID(), txn({ amountPaise: -1 }), at('09:00')), // invalid
        {
          entity: 'transaction',
          op: 'upsert',
          id: randomUUID(),
          editedAt: at('09:00'),
          baseVersion: 0,
        }, // no data
        upsert('transaction', good, txn(), at('09:00')),
      ]);
      expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'applied']);
      expect(results[0]!.error).toMatch(/account/);
      expect(results[2]!.error).toMatch(/data is required/);
      await fetchTxn(good);
    });

    it('refuses an id that belongs to another user, and malformed batches', async () => {
      const other = await registerUser(app, 'other@example.com');
      const theirs = randomUUID();
      await http()
        .post('/sync/push')
        .set(other.auth)
        .send({
          deviceId: PHONE,
          ops: [upsert('account', theirs, { name: 'Theirs', type: 'BANK' }, at('09:00'))],
        })
        .expect(200);
      const [result] = await push([
        upsert('account', theirs, { name: 'Mine now', type: 'BANK' }, at('10:00')),
      ]);
      expect(result).toMatchObject({ status: 'rejected' });

      await http()
        .post('/sync/push')
        .set(user.auth)
        .send({ deviceId: 'not-a-uuid', ops: [] })
        .expect(400);
      await http()
        .post('/sync/push')
        .set(user.auth)
        .send({
          deviceId: PHONE,
          ops: [{ entity: 'loan', op: 'upsert', id: randomUUID(), editedAt: at('09:00') }],
        })
        .expect(400);
      const tooMany = Array.from({ length: 201 }, () =>
        upsert('transaction', randomUUID(), txn(), at('09:00')),
      );
      await http()
        .post('/sync/push')
        .set(user.auth)
        .send({ deviceId: PHONE, ops: tooMany })
        .expect(400);
    });

    it('treats a retry of an edit that already landed as a success, with no duplicate history', async () => {
      const id = randomUUID();
      const op = upsert('transaction', id, txn(), at('09:00'));
      expect((await push([op]))[0]!.status).toBe('applied');
      expect((await push([op]))[0]!.status).toBe('applied'); // the response was lost; the phone tries again
      expect((await fetchTxn(id)).version).toBe(1);
      const history = (await http().get(`/audit?entity=transaction&entityId=${id}`).set(user.auth))
        .body as Json[];
      expect(history.filter((a) => a.action === 'CREATE')).toHaveLength(1);
      expect(await conflictsFor(id)).toEqual([]);
    });

    it('applies an edit based on the latest version and bumps the version', async () => {
      const id = randomUUID();
      await push([upsert('transaction', id, txn({ note: 'v1' }), at('09:00'))]);
      const [result] = await push([upsert('transaction', id, txn({ note: 'v2' }), at('09:05'), 1)]);
      expect(result!.status).toBe('applied');
      expect(await fetchTxn(id)).toMatchObject({ note: 'v2', version: 2 });
      expect(await conflictsFor(id)).toEqual([]);
    });

    it('sends back what the server filled in, since a device never hears its own writes on pull', async () => {
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      await http()
        .post('/rules')
        .set(user.auth)
        .send({ matchType: 'MERCHANT_CONTAINS', pattern: 'shell', categoryId: fuel })
        .expect(201);
      const id = randomUUID();
      const [result] = await push([
        upsert('transaction', id, txn({ merchant: 'Shell Pune' }), at('09:00')),
      ]);
      expect(result).toMatchObject({
        status: 'applied',
        serverRow: { id, categoryId: fuel, categorisedVia: 'RULE' },
      });
      const [plain] = await push([
        upsert('transaction', randomUUID(), txn({ merchant: 'Corner shop' }), at('09:00')),
      ]);
      expect(plain).not.toHaveProperty('serverRow');
    });
  });

  describe('newest edit wins', () => {
    const seed = async (): Promise<string> => {
      const id = randomUUID();
      await push([upsert('transaction', id, txn({ note: 'original' }), at('09:00'))]);
      return id;
    };

    it("keeps the server version when it was edited later than the device's edit, and audits the loser", async () => {
      const id = await seed();
      // the laptop edits at 12:00 and syncs first
      await push([upsert('transaction', id, txn({ note: 'from laptop' }), at('12:00'), 1)], LAPTOP);
      // the phone made its edit at 11:00, offline, from version 1, and syncs afterwards
      const [result] = await push(
        [upsert('transaction', id, txn({ note: 'from phone' }), at('11:00'), 1)],
        PHONE,
      );

      expect(result).toMatchObject({
        status: 'conflict',
        serverRow: { note: 'from laptop', version: 2 },
      });
      expect((await fetchTxn(id)).note).toBe('from laptop');
      const conflict = (await conflictsFor(id))[0]!;
      expect(conflict.before.note).toBe('from phone'); // the version that lost is kept in the audit log
      expect(conflict.after.note).toBe('from laptop');
      expect(conflict.deviceId).toBe(PHONE);
    });

    it("replaces the server version when the device's edit is later, and audits what it overwrote", async () => {
      const id = await seed();
      await push([upsert('transaction', id, txn({ note: 'from laptop' }), at('11:00'), 1)], LAPTOP);
      const [result] = await push(
        [upsert('transaction', id, txn({ note: 'from phone' }), at('12:00'), 1)],
        PHONE,
      );

      expect(result!.status).toBe('applied');
      expect(await fetchTxn(id)).toMatchObject({
        note: 'from phone',
        version: 3,
        editedAt: '2026-11-03T06:30:00.000Z',
      });
      const conflict = (await conflictsFor(id))[0]!;
      expect(conflict.before.note).toBe('from laptop');
      expect(conflict.after.note).toBe('from phone');
    });

    it('does not call it a conflict when the device saw the latest version, even if its clock runs behind', async () => {
      const id = await seed(); // editedAt 09:00
      const [result] = await push([
        upsert('transaction', id, txn({ note: 'clock is slow' }), at('08:00'), 1),
      ]);
      expect(result!.status).toBe('applied');
      const row = await fetchTxn(id);
      expect(row.note).toBe('clock is slow');
      expect(row.editedAt).toBe('2026-11-03T03:30:00.000Z'); // never moves backwards: still the 09:00 edit
      expect(await conflictsFor(id)).toEqual([]);
    });

    it('breaks an exact tie the same way every time', async () => {
      const id = await seed();
      await push([upsert('transaction', id, txn({ note: 'laptop' }), at('11:00'), 1)], LAPTOP);
      const [tie] = await push(
        [upsert('transaction', id, txn({ note: 'phone' }), at('11:00'), 1)],
        PHONE,
      );
      const winner = PHONE > LAPTOP ? 'phone' : 'laptop';
      expect((await fetchTxn(id)).note).toBe(winner);
      expect(tie!.status).toBe(winner === 'phone' ? 'applied' : 'conflict');
    });

    it('lets a deletion made later win, and a stale deletion lose to a newer edit', async () => {
      const a = await seed();
      await push([upsert('transaction', a, txn({ note: 'edited' }), at('12:00'), 1)], LAPTOP);
      const [lost] = await push([del('transaction', a, at('11:00'), 1)], PHONE);
      expect(lost).toMatchObject({ status: 'conflict', serverRow: { note: 'edited' } });
      await fetchTxn(a); // still there

      const b = await seed();
      const [won] = await push([del('transaction', b, at('13:00'), 1)], PHONE);
      expect(won!.status).toBe('applied');
      await fetchTxn(b, 404);

      // a deletion that lands after a newer concurrent edit
      const c = await seed();
      await push([upsert('transaction', c, txn({ note: 'laptop edit' }), at('11:00'), 1)], LAPTOP);
      expect((await push([del('transaction', c, at('12:00'), 1)], PHONE))[0]!.status).toBe(
        'applied',
      );
      expect((await conflictsFor(c))[0]!.before.note).toBe('laptop edit');
    });
  });

  describe('deleting and restoring', () => {
    it('propagates a deletion as a tombstone, and an offline delete of something already gone is fine', async () => {
      const id = randomUUID();
      await push([upsert('transaction', id, txn(), at('09:00'))]);
      const first = await pull(`deviceId=${LAPTOP}`);
      expect(first.changes.transaction.map((t: Json) => t.id)).toContain(id);

      expect((await push([del('transaction', id, at('10:00'), 1)]))[0]!.status).toBe('applied');
      const next = await pull(`deviceId=${LAPTOP}&cursor=${first.cursor}`);
      const tombstone = next.changes.transaction.find((t: Json) => t.id === id);
      expect(tombstone).toMatchObject({ id, deletedAt: expect.any(String) });
      await fetchTxn(id, 404);

      expect((await push([del('transaction', id, at('10:30'), 2)]))[0]!.status).toBe('applied'); // idempotent
      expect((await push([del('transaction', randomUUID(), at('10:30'), 0)]))[0]!.status).toBe(
        'applied',
      ); // never existed
    });

    it('brings a record back when a newer edit arrives for a deleted one', async () => {
      const id = randomUUID();
      await push([upsert('transaction', id, txn({ note: 'before' }), at('09:00'))]);
      await push([del('transaction', id, at('10:00'), 1)]);
      const [back] = await push([
        upsert('transaction', id, txn({ note: 'restored' }), at('11:00'), 2),
      ]);
      expect(back!.status).toBe('applied');
      expect(await fetchTxn(id)).toMatchObject({ note: 'restored', deletedAt: null });
    });

    it('does not let a device delete a generated occurrence; occurrences are skipped instead', async () => {
      const item = randomUUID();
      await push([
        upsert(
          'recurringItem',
          item,
          {
            kind: 'EXPENSE',
            name: 'EMI',
            frequency: 'MONTHLY',
            dueDay: 5,
            startDate: '2026-11-01',
          },
          at('09:00'),
        ),
        upsert(
          'recurringAmountPeriod',
          randomUUID(),
          { recurringItemId: item, effectiveFrom: '2026-11-01', amountPaise: 450_000 },
          at('09:01'),
        ),
      ]);
      const { changes } = await pull();
      const occurrence = changes.recurringOccurrence[0];
      expect(
        (await push([del('recurringOccurrence', occurrence.id, at('10:00'), 1)]))[0],
      ).toMatchObject({ status: 'rejected' });
    });
  });

  describe('pulling changes', () => {
    it('gives a new device everything, then only what changed', async () => {
      const t1 = randomUUID();
      await push([upsert('transaction', t1, txn({ merchant: 'First' }), at('09:00'))]);

      const first = await pull(`deviceId=${LAPTOP}`);
      expect(first.hasMore).toBe(false);
      expect(first.changes.transaction.map((t: Json) => t.id)).toEqual([t1]);
      expect(first.changes.category.length).toBeGreaterThan(8); // the seeded categories
      expect(first.changes.account.map((a: Json) => a.name)).toEqual(['Cash']);

      const quiet = await pull(`deviceId=${LAPTOP}&cursor=${first.cursor}`);
      expect(Object.values(quiet.changes).every((rows) => (rows as unknown[]).length === 0)).toBe(
        true,
      );

      const t2 = randomUUID();
      await push([upsert('transaction', t2, txn({ merchant: 'Second' }), at('10:00'))]);
      const delta = await pull(`deviceId=${LAPTOP}&cursor=${quiet.cursor}`);
      expect(delta.changes.transaction.map((t: Json) => t.id)).toEqual([t2]);
      expect(delta.changes.category).toEqual([]);
    });

    it('does not send a device its own writes back', async () => {
      const id = randomUUID();
      await push([upsert('transaction', id, txn(), at('09:00'))], PHONE);
      expect((await pull(`deviceId=${PHONE}`)).changes.transaction).toEqual([]);
      expect((await pull(`deviceId=${LAPTOP}`)).changes.transaction.map((t: Json) => t.id)).toEqual(
        [id],
      );
      expect((await pull()).changes.transaction.map((t: Json) => t.id)).toEqual([id]); // no device given: everything
    });

    it('pages with a cursor and loses nothing', async () => {
      const ids = Array.from({ length: 5 }, () => randomUUID());
      await push(
        ids.map((id, i) => upsert('transaction', id, txn({ merchant: `T${i}` }), at(`09:0${i}`))),
      );

      const seen = new Map<string, Set<string>>();
      let cursor = '';
      let pages = 0;
      for (;;) {
        const page = await pull(`limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        for (const [entity, rows] of Object.entries(page.changes as Record<string, Json[]>)) {
          const set = seen.get(entity) ?? new Set<string>();
          for (const row of rows) {
            expect(set.has(row.id)).toBe(false); // never repeated
            set.add(row.id);
          }
          seen.set(entity, set);
        }
        cursor = page.cursor;
        pages++;
        if (!page.hasMore) break;
        expect(pages).toBeLessThan(30);
      }
      expect([...(seen.get('transaction') ?? [])].sort()).toEqual([...ids].sort());
      expect(seen.get('category')!.size).toBeGreaterThan(8);
      expect(pages).toBeGreaterThan(2);
    });

    it('skips records already deleted on a first sync', async () => {
      const id = randomUUID();
      await push([upsert('transaction', id, txn(), at('09:00'))]);
      await push([del('transaction', id, at('10:00'), 1)]);
      expect((await pull(`deviceId=${LAPTOP}`)).changes.transaction).toEqual([]);
    });

    it('is private to each user and rejects a bad cursor', async () => {
      const other = await registerUser(app, 'other@example.com');
      await push([upsert('transaction', randomUUID(), txn(), at('09:00'))]);
      const theirs = (await http().get('/sync/pull').set(other.auth).expect(200)).body as Json;
      expect(theirs.changes.transaction).toEqual([]);
      await http().get('/sync/pull?cursor=garbage').set(user.auth).expect(400);
      await http().get('/sync/pull?limit=0').set(user.auth).expect(400);
    });
  });

  describe('recurring bills across devices', () => {
    it('generates due dates on the server and lets another device mark one paid offline', async () => {
      const item = randomUUID();
      await push(
        [
          upsert(
            'recurringItem',
            item,
            {
              kind: 'EXPENSE',
              name: 'Personal loan EMI',
              frequency: 'MONTHLY',
              dueDay: 5,
              startDate: '2026-11-01',
            },
            at('09:00'),
          ),
          upsert(
            'recurringAmountPeriod',
            randomUUID(),
            { recurringItemId: item, effectiveFrom: '2026-11-01', amountPaise: 450_000 },
            at('09:01'),
          ),
        ],
        PHONE,
      );

      // the server created the occurrences; both devices receive them (they were not written by either)
      const onPhone = await pull(`deviceId=${PHONE}`);
      const onLaptop = await pull(`deviceId=${LAPTOP}`);
      const dates = (rows: Json[]) => rows.map((o) => o.dueDate).sort();
      expect(dates(onPhone.changes.recurringOccurrence)).toEqual(
        expect.arrayContaining(['2026-11-05', '2026-12-05', '2027-01-05']),
      );
      expect(onLaptop.changes.recurringOccurrence.length).toBeGreaterThan(10);
      expect(onLaptop.changes.recurringItem.map((i: Json) => i.name)).toEqual([
        'Personal loan EMI',
      ]);

      // the laptop marks November paid while offline
      const november = onLaptop.changes.recurringOccurrence.find(
        (o: Json) => o.dueDate === '2026-11-05',
      );
      const [result] = await push(
        [
          upsert(
            'recurringOccurrence',
            november.id,
            {
              ...november,
              status: 'PAID',
              paidAt: at('09:30'),
              paidAmountPaise: 450_000,
            },
            at('09:30'),
            november.version,
          ),
        ],
        LAPTOP,
      );
      expect(result!.status).toBe('applied');

      const view = (
        await http()
          .get('/recurring/occurrences?from=2026-11-01&to=2026-11-30')
          .set(user.auth)
          .expect(200)
      ).body as Json[];
      expect(view[0]).toMatchObject({
        dueDate: '2026-11-05',
        status: 'PAID',
        paidAmountPaise: 450_000,
      });
    });
  });
});
