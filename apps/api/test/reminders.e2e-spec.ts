import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  PushSender,
  type PushMessage,
  type PushResult,
  type PushTarget,
} from '../src/reminders/push.sender';
import { RemindersService } from '../src/reminders/reminders.service';
import { createTestApp, idByName, registerUser, resetDatabase, type TestUser } from './helpers';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Records what would have been pushed instead of calling a push service. */
class FakeSender {
  enabled = true;
  publicKey: string | null = 'test-public-key';
  sent: { target: PushTarget; message: PushMessage }[] = [];
  result: PushResult = 'sent';
  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    this.sent.push({ target, message });
    return this.result;
  }
}

describe('reminders and push (e2e)', () => {
  let app: INestApplication;
  let user: TestUser;
  let now = new Date('2026-11-01T10:00:00+05:30');
  const sender = new FakeSender();
  const http = () => request(app.getHttpServer());
  const reminders = () => app.get(RemindersService);
  const prisma = () => app.get(PrismaService);

  beforeAll(async () => {
    app = await createTestApp(
      () => now,
      (builder) => builder.overrideProvider(PushSender).useValue(sender),
    );
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    user = await registerUser(app);
    now = new Date('2026-11-01T10:00:00+05:30');
    Object.assign(sender, { enabled: true, result: 'sent', sent: [] });
  });

  const makeBill = async (overrides: Json = {}): Promise<Json> =>
    (
      await http()
        .post('/recurring')
        .set(user.auth)
        .send({
          kind: 'EXPENSE',
          name: 'Rent',
          frequency: 'MONTHLY',
          dueDay: 5,
          startDate: '2026-11-01',
          reminderLeadDays: [3, 1],
          periods: [{ effectiveFrom: '2026-11-01', amountPaise: 450_000 }],
          ...overrides,
        })
        .expect(201)
    ).body;

  const occurrenceOn = async (itemId: string, dueDate: string): Promise<Json> => {
    const all = (await http().get('/recurring/occurrences').set(user.auth).expect(200))
      .body as Json[];
    return all.find((o) => o.recurringItemId === itemId && o.dueDate === dueDate)!;
  };
  const subscribe = (endpoint = 'https://push.example/abc') =>
    http()
      .post('/push/subscriptions')
      .set(user.auth)
      .send({ endpoint, keys: { p256dh: 'p', auth: 'a' } })
      .expect(201);
  const list = async () =>
    (await http().get('/reminders').set(user.auth).expect(200)).body as Json[];

  describe('planning', () => {
    it('creates a reminder for each lead day and one for when the bill goes overdue', async () => {
      await makeBill();
      expect(await reminders().plan()).toBeGreaterThanOrEqual(3);
      const rows = await prisma().reminder.findMany({
        where: { occurrence: { dueDate: new Date('2026-11-05') } },
        orderBy: { scheduledFor: 'asc' },
      });
      expect(rows.map((r) => [r.scheduledFor.toISOString(), r.title])).toEqual([
        ['2026-11-02T03:30:00.000Z', 'Rent due in 3 days'],
        ['2026-11-04T03:30:00.000Z', 'Rent due tomorrow'],
        ['2026-11-06T03:30:00.000Z', 'Rent is overdue'],
      ]);
    });

    it('does not create duplicates when run again', async () => {
      await makeBill();
      await reminders().plan();
      const before = await prisma().reminder.count();
      expect(await reminders().plan()).toBe(0);
      expect(await prisma().reminder.count()).toBe(before);
    });

    it('leaves out bills with no reminders chosen, and reminders long past', async () => {
      await makeBill({ name: 'Quiet', reminderLeadDays: [] });
      now = new Date('2026-11-04T20:00:00+05:30');
      await makeBill({ name: 'Late' });
      await reminders().plan();
      expect(await prisma().reminder.count({ where: { title: { startsWith: 'Quiet' } } })).toBe(0);
      const november = await prisma().reminder.findMany({
        where: { title: { startsWith: 'Late' }, occurrence: { dueDate: new Date('2026-11-05') } },
      });
      // the 3-day reminder (2 Nov, 9am) is more than a day old by now, so only the later two exist
      expect(november.map((r) => r.title).sort()).toEqual(['Late due tomorrow', 'Late is overdue']);
    });

    it('does not remind about bills already paid or skipped', async () => {
      const bill = await makeBill();
      const nov = await occurrenceOn(bill.id, '2026-11-05');
      await http().post(`/recurring/occurrences/${nov.id}/skip`).set(user.auth).expect(200);
      await reminders().plan();
      expect(await prisma().reminder.count({ where: { occurrenceId: nov.id } })).toBe(0);
    });
  });

  describe('delivery', () => {
    it('sends a push to each subscribed device when a reminder comes due', async () => {
      await subscribe('https://push.example/phone');
      await subscribe('https://push.example/laptop');
      await makeBill();
      await reminders().plan();

      expect(await reminders().dispatch()).toBe(0); // nothing is due on 1 Nov at 10am
      now = new Date('2026-11-02T10:00:00+05:30');
      expect(await reminders().dispatch()).toBe(1);
      expect(sender.sent.map((s) => s.target.endpoint).sort()).toEqual([
        'https://push.example/laptop',
        'https://push.example/phone',
      ]);
      expect(sender.sent[0]!.message).toMatchObject({
        title: 'Rent due in 3 days',
        body: '₹4,500 · due 05 Nov 2026',
        url: '/bills',
        actions: [
          { action: 'paid', title: 'Mark paid' },
          { action: 'snooze', title: 'Remind me later' },
        ],
      });
      expect(await reminders().dispatch()).toBe(0); // sent once only
    });

    it('offers no "Mark paid" for income', async () => {
      await subscribe();
      await makeBill({ kind: 'INCOME', name: 'Salary' });
      await reminders().plan();
      now = new Date('2026-11-02T10:00:00+05:30');
      await reminders().dispatch();
      expect(sender.sent[0]!.message.actions).toEqual([]);
      expect(sender.sent[0]!.message.title).toBe('Salary expected in 3 days');
    });

    it('forgets a device the browser has dropped', async () => {
      await subscribe();
      await makeBill();
      await reminders().plan();
      sender.result = 'gone';
      now = new Date('2026-11-02T10:00:00+05:30');
      await reminders().dispatch();
      expect(await prisma().pushSubscription.count()).toBe(0);
    });

    it('still shows the reminder in the app when push is not set up', async () => {
      sender.enabled = false;
      await subscribe();
      await makeBill();
      await reminders().plan();
      now = new Date('2026-11-02T10:00:00+05:30');
      expect(await reminders().dispatch()).toBe(1);
      expect(sender.sent).toEqual([]);
      expect((await list()).map((r) => r.title)).toEqual(['Rent due in 3 days']);
    });

    it('drops a reminder whose bill was paid before it came due', async () => {
      const bill = await makeBill();
      await reminders().plan();
      const nov = await occurrenceOn(bill.id, '2026-11-05');
      await http()
        .post(`/recurring/occurrences/${nov.id}/mark-paid`)
        .set(user.auth)
        .send({})
        .expect(200);
      now = new Date('2026-11-02T10:00:00+05:30');
      expect(await reminders().dispatch()).toBe(0);
      expect(await list()).toEqual([]);
    });

    it('uses the current amount in the text', async () => {
      const bill = await makeBill();
      await reminders().plan();
      await http()
        .put(`/recurring/${bill.id}/periods`)
        .set(user.auth)
        .send({ periods: [{ effectiveFrom: '2026-11-01', amountPaise: 500_000 }] })
        .expect(200);
      now = new Date('2026-11-02T10:00:00+05:30');
      await reminders().dispatch();
      expect((await list())[0]!.body).toBe('₹5,000 · due 05 Nov 2026');
    });
  });

  describe('in the app', () => {
    const dueReminder = async (billOverrides: Json = {}) => {
      const bill = await makeBill(billOverrides);
      await reminders().plan();
      now = new Date('2026-11-04T10:00:00+05:30');
      await reminders().dispatch();
      return { bill, reminder: (await list())[0]! };
    };

    it('lists what has come due, newest first, with the bill’s details', async () => {
      await dueReminder();
      const rows = await list();
      expect(rows.map((r) => r.title)).toEqual(['Rent due tomorrow', 'Rent due in 3 days']);
      expect(rows[0]).toMatchObject({ dueDate: '2026-11-05', amountPaise: 450_000, readAt: null });
    });

    it('marks a reminder read, and dismisses it', async () => {
      const { reminder } = await dueReminder();
      await http().post(`/reminders/${reminder.id}/read`).set(user.auth).expect(204);
      expect((await list())[0]!.readAt).not.toBeNull();
      await http().post(`/reminders/${reminder.id}/dismiss`).set(user.auth).expect(204);
      expect((await list()).map((r) => r.id)).not.toContain(reminder.id);
    });

    it('snoozes a reminder and brings it back when the time is up', async () => {
      const { reminder } = await dueReminder();
      const res = await http()
        .post(`/reminders/${reminder.id}/snooze`)
        .set(user.auth)
        .send({ minutes: 120 })
        .expect(200);
      expect(res.body.scheduledFor).toBe('2026-11-04T06:30:00.000Z');
      expect((await list()).map((r) => r.id)).not.toContain(reminder.id);

      now = new Date('2026-11-04T13:00:00+05:30');
      sender.sent = [];
      await subscribe();
      await reminders().dispatch();
      expect(sender.sent).toHaveLength(1);
      expect((await list()).map((r) => r.id)).toContain(reminder.id);
    });

    it('rejects a snooze that is too long or too short', async () => {
      const { reminder } = await dueReminder();
      for (const minutes of [0, 8 * 24 * 60]) {
        await http()
          .post(`/reminders/${reminder.id}/snooze`)
          .set(user.auth)
          .send({ minutes })
          .expect(400);
      }
    });

    it('marks the bill paid from the reminder and records the expense when the bill has an account', async () => {
      const cash = await idByName(app, user, '/accounts', 'Cash');
      const { bill, reminder } = await dueReminder({ accountId: cash });
      const res = await http()
        .post(`/reminders/${reminder.id}/mark-paid`)
        .set(user.auth)
        .expect(200);
      expect(res.body).toEqual({ recordedTransaction: true });

      const nov = await occurrenceOn(bill.id, '2026-11-05');
      expect(nov).toMatchObject({ status: 'PAID', paidAmountPaise: 450_000 });
      const txns = (await http().get('/transactions').set(user.auth).expect(200)).body
        .items as Json[];
      expect(txns).toHaveLength(1);
      expect(txns[0]).toMatchObject({
        amountPaise: 450_000,
        source: 'RECURRING',
        occurrenceId: nov.id,
      });
      expect(await list()).toEqual([]);
      await http().post(`/reminders/${reminder.id}/mark-paid`).set(user.auth).expect(200); // safe to repeat
      expect(((await http().get('/transactions').set(user.auth)).body.items as Json[]).length).toBe(
        1,
      );
    });

    it('marks the bill paid without an expense when no account is set', async () => {
      const { reminder } = await dueReminder();
      const res = await http()
        .post(`/reminders/${reminder.id}/mark-paid`)
        .set(user.auth)
        .expect(200);
      expect(res.body).toEqual({ recordedTransaction: false });
      expect(((await http().get('/transactions').set(user.auth)).body.items as Json[]).length).toBe(
        0,
      );
    });

    it('keeps reminders private to their owner', async () => {
      const { reminder } = await dueReminder();
      const other = await registerUser(app, 'other@example.com');
      for (const action of ['read', 'dismiss', 'snooze', 'mark-paid']) {
        await http()
          .post(`/reminders/${reminder.id}/${action}`)
          .set(other.auth)
          .send({})
          .expect(404);
      }
      expect(((await http().get('/reminders').set(other.auth)).body as Json[]).length).toBe(0);
      await http().get('/reminders').expect(401);
    });

    it('refuses to mark paid a reminder that has no bill', async () => {
      const row = await prisma().reminder.create({
        data: {
          userId: user.id,
          title: 'Note',
          body: '',
          scheduledFor: new Date(),
          dedupeKey: randomUUID(),
        },
      });
      await http().post(`/reminders/${row.id}/mark-paid`).set(user.auth).expect(404);
    });
  });

  describe('push subscriptions', () => {
    it('shares the public key without signing in', async () => {
      const res = await http().get('/push/vapid-public-key').expect(200);
      expect(res.body).toEqual({ publicKey: 'test-public-key' });
    });

    it('saves a device once however many times it subscribes, and removes it', async () => {
      const first = (await subscribe()).body;
      const again = (await subscribe()).body;
      expect(again.id).toBe(first.id);
      expect(await prisma().pushSubscription.count()).toBe(1);
      await http().delete(`/push/subscriptions/${first.id}`).set(user.auth).expect(204);
      expect(await prisma().pushSubscription.count()).toBe(0);
    });

    it('does not let one user remove another’s device, and validates input', async () => {
      const mine = (await subscribe()).body;
      const other = await registerUser(app, 'other@example.com');
      await http().delete(`/push/subscriptions/${mine.id}`).set(other.auth).expect(204);
      expect(await prisma().pushSubscription.count()).toBe(1);
      await http()
        .post('/push/subscriptions')
        .set(user.auth)
        .send({ endpoint: 'not a url', keys: { p256dh: 'p', auth: 'a' } })
        .expect(400);
    });

    it('moves a device to whoever subscribes from it last', async () => {
      await subscribe('https://push.example/shared');
      const other = await registerUser(app, 'other@example.com');
      await http()
        .post('/push/subscriptions')
        .set(other.auth)
        .send({ endpoint: 'https://push.example/shared', keys: { p256dh: 'p2', auth: 'a2' } })
        .expect(201);
      const [sub] = await prisma().pushSubscription.findMany();
      expect(sub).toMatchObject({ userId: other.id, p256dh: 'p2' });
    });
  });
});
