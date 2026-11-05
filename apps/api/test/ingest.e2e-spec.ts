import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, idByName, registerUser, resetDatabase, type TestUser } from './helpers';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('phone pairing and SMS capture (e2e)', () => {
  let app: INestApplication;
  let user: TestUser;
  let now = new Date('2026-11-05T10:00:00+05:30');
  const http = () => request(app.getHttpServer());
  const prisma = () => app.get(PrismaService);

  beforeAll(async () => {
    app = await createTestApp(() => now);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    user = await registerUser(app);
    now = new Date('2026-11-05T10:00:00+05:30');
  });

  const pairPhone = async (owner: TestUser = user, name = 'Pixel') => {
    const code = (await http().post('/devices/pairing-codes').set(owner.auth).expect(201)).body;
    const paired = (
      await http().post('/devices/pair').send({ code: code.code, deviceName: name }).expect(200)
    ).body;
    return { ...paired, auth: { Authorization: `Bearer ${paired.deviceToken}` } } as {
      deviceId: string;
      deviceToken: string;
      auth: { Authorization: string };
    };
  };

  const event = (parsed: Json = {}, overrides: Json = {}): Json => ({
    clientEventId: randomUUID(),
    senderId: 'VM-ICICIB',
    receivedAt: '2026-11-05T10:00:00+05:30',
    messageHash: randomUUID().replace(/-/g, ''),
    parsed: {
      direction: 'DEBIT',
      amountPaise: 45_000,
      merchant: 'SHELL',
      channel: 'SMS_BANK',
      confidence: 0.85,
      ...parsed,
    },
    ...overrides,
  });
  const send = async (phone: { auth: Json }, body: Json, status = 200) =>
    (await http().post('/ingest/sms').set(phone.auth).send(body).expect(status)).body as Json;
  const transactions = async () =>
    (await http().get('/transactions').set(user.auth).expect(200)).body.items as Json[];

  describe('pairing', () => {
    it('gives a short code that works once, and a token that is shown once', async () => {
      const code = (await http().post('/devices/pairing-codes').set(user.auth).expect(201)).body;
      expect(code.code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
      expect(code.qrPayload).toEqual({ apiUrl: expect.stringMatching(/^http/), code: code.code });
      expect(code.expiresAt).toBe('2026-11-05T04:35:00.000Z');

      const paired = (
        await http()
          .post('/devices/pair')
          .send({ code: code.code.toLowerCase(), deviceName: 'Pixel' })
          .expect(200)
      ).body;
      expect(paired.deviceToken).toMatch(/^zd_dev_/);
      await http().post('/devices/pair').send({ code: code.code, deviceName: 'Again' }).expect(400);

      const stored = await prisma().device.findUniqueOrThrow({ where: { id: paired.deviceId } });
      expect(stored.tokenHash).not.toContain(paired.deviceToken);
      expect(stored.kind).toBe('ANDROID_COMPANION');
    });

    it('rejects a wrong code and an expired one', async () => {
      await http().post('/devices/pair').send({ code: 'WRONG123', deviceName: 'x' }).expect(400);
      const code = (await http().post('/devices/pairing-codes').set(user.auth).expect(201)).body;
      now = new Date('2026-11-05T10:06:00+05:30');
      await http().post('/devices/pair').send({ code: code.code, deviceName: 'x' }).expect(400);
    });

    it('lets only one of two phones racing for the same code win', async () => {
      const code = (await http().post('/devices/pairing-codes').set(user.auth).expect(201)).body;
      const attempts = await Promise.all(
        ['A', 'B'].map((name) =>
          http().post('/devices/pair').send({ code: code.code, deviceName: name }),
        ),
      );
      expect(attempts.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it('needs sign-in to make a code, list phones or remove one', async () => {
      await http().post('/devices/pairing-codes').expect(401);
      await http().get('/devices').expect(401);
      await http().delete(`/devices/${randomUUID()}`).expect(401);
    });

    it('lists phones with when they were last seen, and revokes one for good', async () => {
      const phone = await pairPhone();
      await http().get('/ingest/config').set(phone.auth).expect(200);
      const [listed] = (await http().get('/devices').set(user.auth).expect(200)).body as Json[];
      expect(listed).toMatchObject({ id: phone.deviceId, name: 'Pixel', revokedAt: null });
      expect(listed?.lastSeenAt).not.toBeNull();

      await http().delete(`/devices/${phone.deviceId}`).set(user.auth).expect(204);
      await http().get('/ingest/config').set(phone.auth).expect(401);
      expect(
        ((await http().get('/devices').set(user.auth)).body as Json[])[0]!.revokedAt,
      ).not.toBeNull();
    });

    it('does not let another user revoke your phone', async () => {
      const phone = await pairPhone();
      const other = await registerUser(app, 'other@example.com');
      await http().delete(`/devices/${phone.deviceId}`).set(other.auth).expect(204);
      await http().get('/ingest/config').set(phone.auth).expect(200);
    });

    it('limits a phone to capture, categorising and the inbox', async () => {
      const phone = await pairPhone();
      for (const path of [
        '/ingest/config',
        '/categories/quick-picks',
        '/transactions/uncategorised',
      ]) {
        await http().get(path).set(phone.auth).expect(200);
      }
      for (const path of [
        '/transactions',
        '/accounts',
        '/loans',
        '/devices',
        '/sync/pull',
        '/reminders',
      ]) {
        await http().get(path).set(phone.auth).expect(401);
      }
      await http().post('/devices/pairing-codes').set(phone.auth).expect(401);
      await http()
        .get('/ingest/config')
        .set({ Authorization: 'Bearer zd_dev_nonsense' })
        .expect(401);
    });
  });

  describe('capture', () => {
    it('records a payment waiting for a category, with the buttons for the notification', async () => {
      const phone = await pairPhone();
      const result = await send(phone, event());
      expect(result).toMatchObject({
        deduped: false,
        status: 'PENDING_CATEGORY',
        categoryId: null,
        title: '₹450 paid to SHELL',
      });
      expect(result.quickPicks.map((q: Json) => q.name)).toEqual([
        'Fuel',
        'Food & going out',
        'Card',
        'Misc',
      ]);
      const [txn] = await transactions();
      expect(txn).toMatchObject({
        id: result.transactionId,
        type: 'EXPENSE',
        amountPaise: 45_000,
        merchant: 'SHELL',
        source: 'SMS_BANK',
        lastDeviceId: phone.deviceId,
        occurredAt: '2026-11-05T04:30:00.000Z',
      });
    });

    it('records money received as income', async () => {
      const phone = await pairPhone();
      const result = await send(
        phone,
        event({ direction: 'CREDIT', amountPaise: 500_000, merchant: 'A FRIEND' }),
      );
      expect(result.title).toBe('₹5,000 received from A FRIEND');
      expect((await transactions())[0]).toMatchObject({ type: 'INCOME', amountPaise: 500_000 });
    });

    it('names the payee by UPI address when there is no merchant, and by nothing when neither', async () => {
      const phone = await pairPhone();
      expect((await send(phone, event({ merchant: undefined, vpa: 'shell@icici' }))).title).toBe(
        '₹450 paid to shell@icici',
      );
      expect((await send(phone, event({ merchant: undefined, amountPaise: 1_000 }))).title).toBe(
        '₹10 paid',
      );
    });

    it('counts a retry of the same message as the same payment', async () => {
      const phone = await pairPhone();
      const body = event();
      const first = await send(phone, body);
      const again = await send(phone, { ...body, clientEventId: randomUUID() });
      expect(again).toMatchObject({ transactionId: first.transactionId, deduped: true });
      expect(await transactions()).toHaveLength(1);
      expect(await prisma().transactionSource.count()).toBe(1);
    });

    it('joins the bank’s message and the UPI app’s message about one payment, keeping what each knows', async () => {
      const phone = await pairPhone();
      const bank = await send(phone, event({ merchant: undefined }));
      const upi = await send(
        phone,
        event(
          { channel: 'SMS_UPI', merchant: 'SHELL', vpa: 'shell@icici', upiRef: '312345678901' },
          { receivedAt: '2026-11-05T10:03:00+05:30' },
        ),
      );
      expect(upi).toMatchObject({ transactionId: bank.transactionId, deduped: true });
      const all = await transactions();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        merchant: 'SHELL',
        vpa: 'shell@icici',
        upiRef: '312345678901',
      });
      expect(await prisma().transactionSource.count()).toBe(2);
    });

    it('trusts a shared UPI reference even when the messages are hours apart', async () => {
      const phone = await pairPhone();
      const first = await send(phone, event({ channel: 'SMS_UPI', upiRef: '312345678901' }));
      const later = await send(
        phone,
        event(
          { channel: 'SMS_UPI', upiRef: '312345678901' },
          { receivedAt: '2026-11-05T18:00:00+05:30' },
        ),
      );
      expect(later).toMatchObject({ transactionId: first.transactionId, deduped: true });
    });

    it('keeps two identical purchases apart when they are the same kind of message', async () => {
      const phone = await pairPhone();
      await send(phone, event());
      await send(phone, event({}, { receivedAt: '2026-11-05T10:02:00+05:30' }));
      expect(await transactions()).toHaveLength(2);
    });

    it('keeps payments apart when their references differ, or the account differs, or the time does', async () => {
      const phone = await pairPhone();
      await send(phone, event({ channel: 'SMS_UPI', upiRef: '111111111111', accountTail: '123' }));
      await send(phone, event({ channel: 'SMS_BANK', upiRef: '222222222222', accountTail: '123' }));
      await send(phone, event({ channel: 'SMS_BANK', accountTail: '999' }));
      await send(
        phone,
        event(
          { channel: 'SMS_UPI', accountTail: '123' },
          { receivedAt: '2026-11-05T11:00:00+05:30' },
        ),
      );
      expect(await transactions()).toHaveLength(4);
    });

    it('does not join a payment in the other direction or for another amount', async () => {
      const phone = await pairPhone();
      await send(phone, event());
      await send(phone, event({ channel: 'SMS_UPI', direction: 'CREDIT' }));
      await send(phone, event({ channel: 'SMS_UPI', amountPaise: 45_001 }));
      expect(await transactions()).toHaveLength(3);
    });

    it('joins a payment you already typed in by hand', async () => {
      const phone = await pairPhone();
      const cash = await idByName(app, user, '/accounts', 'Cash');
      const manual = (
        await http()
          .post('/transactions')
          .set(user.auth)
          .send({
            type: 'EXPENSE',
            amountPaise: 45_000,
            accountId: cash,
            occurredAt: '2026-11-05T10:01:00+05:30',
            note: 'petrol',
          })
          .expect(201)
      ).body;
      const result = await send(phone, event());
      expect(result).toMatchObject({ transactionId: manual.id, deduped: true });
      expect((await transactions())[0]).toMatchObject({ note: 'petrol', merchant: 'SHELL' });
    });

    it('ignores a transaction that was ignored when looking for a match', async () => {
      const phone = await pairPhone();
      const first = await send(phone, event());
      await http().post(`/transactions/${first.transactionId}/ignore`).set(phone.auth).expect(200);
      const second = await send(phone, event({ channel: 'SMS_UPI' }));
      expect(second.transactionId).not.toBe(first.transactionId);
    });

    it('uses the message’s own date when it is a different day from when it arrived', async () => {
      const phone = await pairPhone();
      await send(
        phone,
        event(
          { occurredAt: '2026-11-03T21:15:00+05:30' },
          { receivedAt: '2026-11-05T10:00:00+05:30' },
        ),
      );
      expect((await transactions())[0]!.occurredAt).toBe('2026-11-03T15:45:00.000Z');
    });

    it('puts it in the account whose number matches, else the main bank account', async () => {
      const phone = await pairPhone();
      const bank = (
        await http()
          .post('/accounts')
          .set(user.auth)
          .send({ name: 'Salary', type: 'BANK', last4: '1234' })
          .expect(201)
      ).body;
      const card = (
        await http()
          .post('/accounts')
          .set(user.auth)
          .send({ name: 'Card', type: 'CREDIT_CARD', last4: '4567' })
          .expect(201)
      ).body;
      await send(phone, event({ accountTail: '4567', amountPaise: 1_00 }));
      await send(phone, event({ accountTail: '234', amountPaise: 2_00 }));
      await send(phone, event({ amountPaise: 3_00 }));
      const byAmount = Object.fromEntries((await transactions()).map((t) => [t.amountPaise, t]));
      expect(byAmount[100].accountId).toBe(card.id);
      expect(byAmount[200].accountId).toBe(bank.id);
      expect(byAmount[300].accountId).toBe(bank.id);
      expect(byAmount[100].last4).toBe('4567');
      expect(byAmount[200].last4).toBeNull();
    });

    it('categorises on arrival when a merchant rule applies', async () => {
      const phone = await pairPhone();
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      await http()
        .post('/rules')
        .set(user.auth)
        .send({ matchType: 'MERCHANT_EQUALS', pattern: 'SHELL', categoryId: fuel })
        .expect(201);
      const result = await send(phone, event());
      expect(result).toMatchObject({ status: 'POSTED', categoryId: fuel });
      expect((await transactions())[0]).toMatchObject({ categorisedVia: 'RULE' });
    });

    it('stores the message text only when you have asked for that', async () => {
      const phone = await pairPhone();
      await send(phone, event({}, { rawBody: 'secret text' }));
      expect((await prisma().transactionSource.findMany())[0]!.rawBody).toBeNull();

      await prisma().userSettings.upsert({
        where: { userId: user.id },
        create: { userId: user.id, storeRawSms: true },
        update: { storeRawSms: true },
      });
      await send(phone, event({ amountPaise: 5_00 }, { rawBody: 'secret text' }));
      const stored = await prisma().transactionSource.findMany({ orderBy: { createdAt: 'desc' } });
      expect(stored[0]!.rawBody).toBe('secret text');
    });

    it('hands the phone its allow-list and buttons, and takes a changed list', async () => {
      const phone = await pairPhone();
      const first = (await http().get('/ingest/config').set(phone.auth).expect(200)).body;
      expect(first.allowList).toEqual(['*-ICICIB', '*-ICICIT', '*-ICICIS']);
      expect(first.quickPicks).toHaveLength(4);
      await prisma().userSettings.upsert({
        where: { userId: user.id },
        create: { userId: user.id, smsSenderAllowList: ['*-OTHERB'] },
        update: { smsSenderAllowList: ['*-OTHERB'] },
      });
      expect((await http().get('/ingest/config').set(phone.auth)).body.allowList).toEqual([
        '*-OTHERB',
      ]);
    });

    it('takes a queue of messages at once and reports each', async () => {
      const phone = await pairPhone();
      const one = event();
      const two = event({ amountPaise: 7_00 });
      await send(phone, one);
      const res = (
        await http()
          .post('/ingest/sms/batch')
          .set(phone.auth)
          .send({ events: [one, two] })
          .expect(200)
      ).body;
      expect(res.results.map((r: Json) => [r.clientEventId, r.result.deduped])).toEqual([
        [one.clientEventId, true],
        [two.clientEventId, false],
      ]);
      expect(await transactions()).toHaveLength(2);
    });

    it('reports a message it cannot record without losing the rest of the batch', async () => {
      const phone = await pairPhone();
      await prisma().account.deleteMany({ where: { userId: user.id } });
      const res = (
        await http()
          .post('/ingest/sms/batch')
          .set(phone.auth)
          .send({ events: [event()] })
          .expect(200)
      ).body;
      expect(res.results[0]).toMatchObject({ error: 'Add an account first' });
    });

    it('refuses malformed messages and a wrongly big batch', async () => {
      const phone = await pairPhone();
      await send(phone, event({ amountPaise: 0 }), 400);
      await send(phone, event({ accountTail: '12' }), 400);
      await send(phone, event({}, { messageHash: 'x' }), 400);
      await send(phone, { ...event(), parsed: undefined }, 400);
      const events = Array.from({ length: 51 }, () => event());
      await http().post('/ingest/sms/batch').set(phone.auth).send({ events }).expect(400);
      await http().post('/ingest/sms/batch').set(phone.auth).send({ events: [] }).expect(400);
    });

    it('needs a phone or a signed-in user', async () => {
      await http().post('/ingest/sms').send(event()).expect(401);
      await http().post('/ingest/sms').set(user.auth).send(event()).expect(200); // the web app may post too
    });
  });

  describe('one-tap categorising', () => {
    const setup = async () => {
      const phone = await pairPhone();
      const captured = await send(phone, event());
      const ids = {
        fuel: await idByName(app, user, '/categories', 'Fuel'),
        food: await idByName(app, user, '/categories', 'Food & going out'),
        salary: await idByName(app, user, '/categories', 'Salary'),
      };
      return { phone, id: captured.transactionId as string, ids };
    };
    const categorise = (auth: Json, id: string, body: Json, status = 200) =>
      http().post(`/transactions/${id}/categorise`).set(auth).send(body).expect(status);

    it('shows captured payments waiting for a category, and how many', async () => {
      const { phone } = await setup();
      await send(phone, event({ amountPaise: 9_00 }));
      const inbox = (await http().get('/transactions/uncategorised').set(phone.auth).expect(200))
        .body;
      expect(inbox.count).toBe(2);
      expect(inbox.items.map((t: Json) => t.status)).toEqual([
        'PENDING_CATEGORY',
        'PENDING_CATEGORY',
      ]);
    });

    it('sets the category, marks it posted and drops it from the inbox', async () => {
      const { phone, id, ids } = await setup();
      const done = (await categorise(phone.auth, id, { categoryId: ids.fuel, via: 'FLUTTER' }))
        .body;
      expect(done).toMatchObject({
        categoryId: ids.fuel,
        categorisedVia: 'FLUTTER',
        status: 'POSTED',
      });
      const inbox = (await http().get('/transactions/uncategorised').set(phone.auth)).body;
      expect(inbox).toEqual({ items: [], count: 0 });
    });

    it('lets the first answer win: the same again is fine, a different one from a phone is refused', async () => {
      const { phone, id, ids } = await setup();
      await categorise(phone.auth, id, { categoryId: ids.fuel, via: 'FLUTTER' });
      await categorise(phone.auth, id, { categoryId: ids.fuel, via: 'PUSH' });
      const refused = (await categorise(phone.auth, id, { categoryId: ids.food, via: 'PUSH' }, 409))
        .body;
      expect(refused).toMatchObject({ statusCode: 409, currentCategoryId: ids.fuel });
      expect((await transactions())[0]!.categoryId).toBe(ids.fuel);
    });

    it('always lets an edit made in the app override', async () => {
      const { phone, id, ids } = await setup();
      await categorise(phone.auth, id, { categoryId: ids.fuel, via: 'FLUTTER' });
      const changed = (await categorise(user.auth, id, { categoryId: ids.food, via: 'WEB' })).body;
      expect(changed).toMatchObject({ categoryId: ids.food, categorisedVia: 'MANUAL' });
    });

    it('refuses an income category for a payment and a transaction that is not yours', async () => {
      const { phone, id, ids } = await setup();
      await categorise(phone.auth, id, { categoryId: ids.salary, via: 'FLUTTER' }, 400);
      const other = await registerUser(app, 'other@example.com');
      await categorise(other.auth, id, { categoryId: ids.fuel, via: 'WEB' }, 404);
      await categorise(phone.auth, id, { via: 'FLUTTER' }, 400);
      await categorise(phone.auth, id, { categoryId: ids.fuel, via: 'SOMEHOW' }, 400);
    });

    it('remembers the merchant when asked, so the next payment needs no tap', async () => {
      const { phone, id, ids } = await setup();
      await categorise(phone.auth, id, { categoryId: ids.fuel, via: 'FLUTTER', createRule: true });
      await categorise(phone.auth, id, { categoryId: ids.fuel, via: 'FLUTTER', createRule: true });
      const rules = (await http().get('/rules').set(user.auth)).body as Json[];
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({
        matchType: 'MERCHANT_EQUALS',
        pattern: 'SHELL',
        categoryId: ids.fuel,
      });

      const next = await send(phone, event({ amountPaise: 6_00 }));
      expect(next).toMatchObject({ status: 'POSTED', categoryId: ids.fuel });
    });

    it('remembers a UPI address when there is no merchant name, and nothing when neither', async () => {
      const phone = await pairPhone();
      const fuel = await idByName(app, user, '/categories', 'Fuel');
      const byVpa = await send(
        phone,
        event({ merchant: undefined, vpa: 'shell@icici', amountPaise: 1_00 }),
      );
      const neither = await send(phone, event({ merchant: undefined, amountPaise: 2_00 }));
      await categorise(phone.auth, byVpa.transactionId, {
        categoryId: fuel,
        via: 'FLUTTER',
        createRule: true,
      });
      await categorise(phone.auth, neither.transactionId, {
        categoryId: fuel,
        via: 'FLUTTER',
        createRule: true,
      });
      const rules = (await http().get('/rules').set(user.auth)).body as Json[];
      expect(rules.map((r) => [r.matchType, r.pattern])).toEqual([['VPA_EQUALS', 'shell@icici']]);
    });

    it('can mark a misread message as not a payment, leaving it out of the inbox and the totals', async () => {
      const { phone, id } = await setup();
      const ignored = (await http().post(`/transactions/${id}/ignore`).set(phone.auth).expect(200))
        .body;
      expect(ignored.status).toBe('IGNORED');
      expect((await http().get('/transactions/uncategorised').set(phone.auth)).body.count).toBe(0);
    });
  });

  describe('trying a message', () => {
    it('shows how a pasted message would be read, and whether the sender would be accepted', async () => {
      const body = 'Rs 450.00 debited at SHELL on 05-Nov-26';
      const plain = (
        await http().post('/ingest/parse-test').set(user.auth).send({ body }).expect(200)
      ).body;
      expect(plain).toMatchObject({
        kind: 'payment',
        payment: { amountPaise: 45_000, merchant: 'SHELL' },
      });
      const good = (
        await http()
          .post('/ingest/parse-test')
          .set(user.auth)
          .send({ body, sender: 'VM-ICICIB' })
          .expect(200)
      ).body;
      expect(good.kind).toBe('payment');
      const bad = (
        await http()
          .post('/ingest/parse-test')
          .set(user.auth)
          .send({ body, sender: 'AD-SHOP' })
          .expect(200)
      ).body;
      expect(bad).toEqual({ kind: 'ignored', reason: 'NOT_ALLOWED_SENDER' });
      await http().post('/ingest/parse-test').send({ body }).expect(401);
    });
  });
});
