import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import type { WriteContext } from '../records/records.service';
import { RecurringService } from '../tracking/recurring.service';
import { dedupeKey, describeReminder, reminderSlots } from './plan';
import { PushSender, type PushMessage } from './push.sender';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Look this far ahead for bills to remind about. */
const HORIZON_DAYS = 35;
/** A reminder whose time passed more than this long ago is not sent (the app was off, say). */
const STALE_MS = DAY_MS;

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export interface ReminderView {
  id: string;
  occurrenceId: string | null;
  title: string;
  body: string;
  dueDate: string | null;
  amountPaise: number | null;
  scheduledFor: string;
  readAt: string | null;
}

/**
 * Turns upcoming bills into reminders and delivers them. Reminders are rows in the database (so they
 * show in the app whether or not push is set up); the scheduler calls `plan` and `dispatch` every minute.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly sender: PushSender,
    private readonly recurring: RecurringService,
  ) {}

  /** Creates a reminder for every bill and lead time that does not have one yet. Safe to run repeatedly. */
  async plan(): Promise<number> {
    const now = this.clock.now();
    const from = new Date(now.getTime() - 2 * DAY_MS);
    const to = new Date(now.getTime() + HORIZON_DAYS * DAY_MS);
    const occurrences = await this.prisma.recurringOccurrence.findMany({
      where: {
        status: 'UPCOMING',
        deletedAt: null,
        dueDate: { gte: from, lte: to },
        item: { deletedAt: null, active: true, NOT: { reminderLeadDays: { isEmpty: true } } },
      },
      include: { item: true },
    });

    const rows: Prisma.ReminderCreateManyInput[] = [];
    for (const occurrence of occurrences) {
      const dueDate = iso(occurrence.dueDate);
      for (const slot of reminderSlots(dueDate, occurrence.item.reminderLeadDays)) {
        if (slot.at.getTime() < now.getTime() - STALE_MS) continue;
        rows.push({
          userId: occurrence.userId,
          occurrenceId: occurrence.id,
          scheduledFor: slot.at,
          channel: 'WEB_PUSH',
          state: 'SCHEDULED',
          dedupeKey: dedupeKey(occurrence.id, slot.leadDays),
          payload: { leadDays: slot.leadDays },
          ...describeReminder({
            name: occurrence.item.name,
            kind: occurrence.item.kind,
            amountPaise: occurrence.expectedAmountPaise,
            dueDate,
            leadDays: slot.leadDays,
          }),
        });
      }
    }
    if (rows.length === 0) return 0;
    const created = await this.prisma.reminder.createMany({ data: rows, skipDuplicates: true });
    return created.count;
  }

  /** Delivers reminders that are due. Returns how many were sent or shown. */
  async dispatch(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.reminder.findMany({
      where: { state: 'SCHEDULED', scheduledFor: { lte: now } },
      include: { occurrence: { include: { item: true } } },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: 200,
    });

    let delivered = 0;
    for (const reminder of due) {
      const occurrence = reminder.occurrence;
      if (!occurrence || occurrence.deletedAt || occurrence.status !== 'UPCOMING') {
        await this.prisma.reminder.update({
          where: { id: reminder.id },
          data: { state: 'DISMISSED' },
        });
        continue;
      }
      const lead = (reminder.payload as { leadDays?: number } | null)?.leadDays ?? 0;
      const text = describeReminder({
        name: occurrence.item.name,
        kind: occurrence.item.kind,
        amountPaise: occurrence.expectedAmountPaise,
        dueDate: iso(occurrence.dueDate),
        leadDays: lead,
      });
      await this.pushToUser(reminder.userId, {
        ...text,
        reminderId: reminder.id,
        occurrenceId: occurrence.id,
        url: '/bills',
        actions:
          occurrence.item.kind === 'EXPENSE'
            ? [
                { action: 'paid', title: 'Mark paid' },
                { action: 'snooze', title: 'Remind me later' },
              ]
            : [],
      });
      await this.prisma.reminder.update({
        where: { id: reminder.id },
        data: { state: 'SENT', sentAt: now, ...text },
      });
      delivered++;
    }
    return delivered;
  }

  /** Sends to every device the user has subscribed, forgetting any the browser says are gone. */
  private async pushToUser(userId: string, message: PushMessage): Promise<void> {
    if (!this.sender.enabled) return;
    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
    for (const sub of subscriptions) {
      const result = await this.sender.send(sub, message);
      if (result === 'gone') {
        await this.prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
        this.logger.log('Removed a push subscription the browser no longer accepts');
      }
    }
  }

  // ───────────────────────── what the app shows ─────────────────────────

  /** Reminders that have come due and still need attention, newest first. */
  async list(userId: string): Promise<ReminderView[]> {
    const rows = await this.prisma.reminder.findMany({
      where: {
        userId,
        state: { in: ['SCHEDULED', 'SENT'] },
        scheduledFor: { lte: this.clock.now() },
        occurrence: { status: 'UPCOMING', deletedAt: null },
      },
      include: { occurrence: true },
      orderBy: [{ scheduledFor: 'desc' }, { id: 'asc' }],
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      occurrenceId: r.occurrenceId,
      title: r.title,
      body: r.body,
      dueDate: r.occurrence ? iso(r.occurrence.dueDate) : null,
      amountPaise: r.occurrence?.expectedAmountPaise ?? null,
      scheduledFor: r.scheduledFor.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
    }));
  }

  private async owned(userId: string, id: string) {
    const reminder = await this.prisma.reminder.findFirst({ where: { id, userId } });
    if (!reminder) throw new NotFoundException('Reminder not found');
    return reminder;
  }

  async markRead(userId: string, id: string): Promise<void> {
    const reminder = await this.owned(userId, id);
    if (!reminder.readAt) {
      await this.prisma.reminder.update({ where: { id }, data: { readAt: this.clock.now() } });
    }
  }

  async dismiss(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.prisma.reminder.update({ where: { id }, data: { state: 'DISMISSED' } });
  }

  /** Brings the reminder back after `minutes`. */
  async snooze(userId: string, id: string, minutes: number): Promise<{ scheduledFor: string }> {
    await this.owned(userId, id);
    const scheduledFor = new Date(this.clock.now().getTime() + minutes * 60_000);
    await this.prisma.reminder.update({
      where: { id },
      data: { state: 'SCHEDULED', scheduledFor, sentAt: null, readAt: null },
    });
    return { scheduledFor: scheduledFor.toISOString() };
  }

  /**
   * "Mark paid" from a notification. If the bill has an account the payment is recorded as an expense
   * from it, as in the app; otherwise only the due date is marked paid.
   */
  async markPaid(
    userId: string,
    id: string,
    ctx: WriteContext,
  ): Promise<{ recordedTransaction: boolean }> {
    const reminder = await this.owned(userId, id);
    if (!reminder.occurrenceId) throw new NotFoundException('This reminder has no bill');
    const occurrence = await this.prisma.recurringOccurrence.findFirst({
      where: { id: reminder.occurrenceId, userId },
      include: { item: { select: { accountId: true } } },
    });
    const recordedTransaction = occurrence?.item.accountId != null && occurrence.status !== 'PAID';
    await this.recurring.markPaid(
      userId,
      reminder.occurrenceId,
      { createTransaction: recordedTransaction },
      ctx,
    );
    await this.prisma.reminder.update({ where: { id }, data: { state: 'ACTED' } });
    return { recordedTransaction };
  }

  // ───────────────────────── push subscriptions ─────────────────────────

  async subscribe(
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string },
    deviceId: string | null,
  ): Promise<{ id: string }> {
    const saved = await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, deviceId, ...sub },
      update: { userId, deviceId, p256dh: sub.p256dh, auth: sub.auth },
    });
    return { id: saved.id };
  }

  async unsubscribe(userId: string, id: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { id, userId } });
  }
}
