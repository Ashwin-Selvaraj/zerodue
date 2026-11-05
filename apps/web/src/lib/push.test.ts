import { describe, expect, it } from 'vitest';
import { subscriptionBody, urlBase64ToUint8Array } from './push';
import { visibleReminders, type Reminder } from './reminders';

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 with and without padding', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('AQI')]).toEqual([1, 2]);
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]);
  });
});

describe('subscriptionBody', () => {
  const subscription = (json: unknown) => ({ toJSON: () => json });

  it('keeps the endpoint and keys the server needs', () => {
    expect(
      subscriptionBody(
        subscription({
          endpoint: 'https://push.example/x',
          keys: { p256dh: 'p', auth: 'a' },
          extra: 1,
        }),
      ),
    ).toEqual({ endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } });
  });

  it('refuses an incomplete subscription', () => {
    expect(() => subscriptionBody(subscription({ endpoint: 'https://x' }))).toThrow('incomplete');
    expect(() => subscriptionBody(subscription({ keys: { p256dh: 'p', auth: 'a' } }))).toThrow(
      'incomplete',
    );
    expect(() =>
      subscriptionBody(subscription({ endpoint: 'https://x', keys: { p256dh: 'p' } })),
    ).toThrow('incomplete');
  });
});

describe('visibleReminders', () => {
  const reminder = (id: string, occurrenceId: string | null): Reminder => ({
    id,
    occurrenceId,
    title: id,
    body: '',
    dueDate: null,
    amountPaise: null,
    scheduledFor: '2026-11-04T03:30:00.000Z',
    readAt: null,
  });

  it('hides reminders for bills already paid or skipped on this device', () => {
    const rows = [
      reminder('a', 'o1'),
      reminder('b', 'o2'),
      reminder('c', 'o3'),
      reminder('d', null),
    ];
    const shown = visibleReminders(rows, [
      { id: 'o1', status: 'PAID' },
      { id: 'o2', status: 'UPCOMING' },
      { id: 'o3', status: 'SKIPPED' },
    ]);
    expect(shown.map((r) => r.id)).toEqual(['b', 'd']);
  });

  it('keeps a reminder for a bill this device has not heard of yet', () => {
    expect(visibleReminders([reminder('a', 'new')], []).map((r) => r.id)).toEqual(['a']);
  });
});
