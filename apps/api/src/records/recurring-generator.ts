import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addMonths, monthKey, monthRange, occurrenceInMonth, type Stream } from '@zerodue/shared';
import { randomUUID } from 'node:crypto';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';

/** Occurrences are kept for this many months back and ahead of the current month. */
const MONTHS_BACK = 3;
const MONTHS_AHEAD = 12;

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Keeps the dated occurrences ("5 Dec: Personal EMI") of recurring items in step with the item and its
 * amount periods, using the same engine the planner uses. Paid and skipped occurrences are history and
 * are never changed. Users skip occurrences rather than delete them, so removed ones can come back.
 */
@Injectable()
export class RecurringGenerator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async regenerateAll(userId: string): Promise<void> {
    const items = await this.prisma.recurringItem.findMany({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    for (const item of items) await this.regenerate(userId, item.id);
  }

  async regenerate(userId: string, itemId: string): Promise<void> {
    const item = await this.prisma.recurringItem.findFirst({
      where: { id: itemId, userId },
      include: { periods: { where: { deletedAt: null } } },
    });
    if (!item) return;

    const now = this.clock.now();
    const stillActive = item.deletedAt === null && item.active;
    const thisMonth = monthKey(now);
    const first = addMonths(thisMonth, -MONTHS_BACK);
    const window = monthRange(first, MONTHS_BACK + MONTHS_AHEAD + 1);

    const stream: Stream = {
      id: item.id,
      name: item.name,
      kind: item.kind,
      frequency: item.frequency,
      dueDay: item.dueDay ?? undefined,
      anchorMonth: item.anchorMonth ? `${iso(item.anchorMonth).slice(0, 8)}01` : undefined,
      startDate: iso(item.startDate),
      endDate: item.endDate ? iso(item.endDate) : undefined,
      periods: item.periods.map((p) => ({
        effectiveFrom: iso(p.effectiveFrom),
        amountPaise: p.amountPaise,
      })),
      earmarked: item.kind === 'INCOME' && !item.fixedOutgoing,
    };

    const desired = new Map<string, number>();
    if (stillActive) {
      for (const month of window) {
        const occurrence = occurrenceInMonth(stream, month);
        if (occurrence) desired.set(occurrence.dueDate, occurrence.amountPaise);
      }
    }

    const existing = await this.prisma.recurringOccurrence.findMany({
      where: { recurringItemId: item.id, userId },
    });
    const byDate = new Map(existing.map((o) => [iso(o.dueDate), o]));
    const editedAt = now;

    for (const [dueDate, amountPaise] of desired) {
      const current = byDate.get(dueDate);
      if (!current) {
        try {
          await this.prisma.recurringOccurrence.create({
            data: {
              id: randomUUID(),
              userId,
              recurringItemId: item.id,
              dueDate: new Date(`${dueDate}T00:00:00.000Z`),
              expectedAmountPaise: amountPaise,
              editedAt,
            },
          });
        } catch (error) {
          // a parallel regeneration created it first
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
            throw error;
        }
      } else if (current.deletedAt !== null) {
        // Removed earlier because the item was paused or shortened; it is due again.
        await this.prisma.recurringOccurrence.update({
          where: { id: current.id },
          data: {
            deletedAt: null,
            status: 'UPCOMING',
            expectedAmountPaise: amountPaise,
            version: { increment: 1 },
            editedAt,
            lastDeviceId: null,
          },
        });
      } else if (current.status === 'UPCOMING' && current.expectedAmountPaise !== amountPaise) {
        await this.prisma.recurringOccurrence.update({
          where: { id: current.id },
          data: {
            expectedAmountPaise: amountPaise,
            version: { increment: 1 },
            editedAt,
            lastDeviceId: null,
          },
        });
      }
    }

    // Upcoming occurrences that no longer belong (end date moved, item removed or paused).
    const windowStart = `${first.slice(0, 8)}01`;
    for (const current of existing) {
      const dueDate = iso(current.dueDate);
      const inScope = !stillActive || dueDate >= windowStart;
      if (
        current.deletedAt === null &&
        current.status === 'UPCOMING' &&
        inScope &&
        !desired.has(dueDate)
      ) {
        await this.prisma.recurringOccurrence.update({
          where: { id: current.id },
          data: { deletedAt: now, version: { increment: 1 }, editedAt, lastDeviceId: null },
        });
      }
    }
  }
}
