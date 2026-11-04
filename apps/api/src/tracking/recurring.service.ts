import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addMonths,
  isoDateIST,
  lastDateOfMonth,
  monthKey,
  type MarkPaidInput,
  type OccurrenceQuery,
  type RecurringItemWithPeriodsInput,
} from '@zerodue/shared';
import { randomUUID } from 'node:crypto';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { RecordsService, type Row, type WriteContext } from '../records/records.service';
import { RecurringGenerator } from '../records/recurring-generator';

type Data = Record<string, unknown>;
type PeriodInput = RecurringItemWithPeriodsInput['periods'][number];

const dateOf = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

@Injectable()
export class RecurringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly generator: RecurringGenerator,
    private readonly clock: Clock,
  ) {}

  // ───────────────────────── items and their amount periods ─────────────────────────

  private itemDto(item: Row & { periods: Row[] }): Data {
    const periodDef = this.records.def('recurringAmountPeriod');
    return {
      ...this.records.toDto(this.records.def('recurringItem'), item),
      periods: item.periods.map((p) => this.records.toDto(periodDef, p)),
    };
  }

  private include = {
    periods: { where: { deletedAt: null }, orderBy: { effectiveFrom: 'asc' as const } },
  };

  async list(userId: string): Promise<Data[]> {
    const items = await this.prisma.recurringItem.findMany({
      where: { userId, deletedAt: null },
      include: this.include,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return items.map((item) => this.itemDto(item as unknown as Row & { periods: Row[] }));
  }

  async get(userId: string, id: string): Promise<Data> {
    const item = await this.prisma.recurringItem.findFirst({
      where: { id, userId, deletedAt: null },
      include: this.include,
    });
    if (!item) throw new NotFoundException('recurringItem not found');
    return this.itemDto(item as unknown as Row & { periods: Row[] });
  }

  async create(
    userId: string,
    body: RecurringItemWithPeriodsInput,
    ctx: WriteContext,
  ): Promise<Data> {
    const { periods, ...itemData } = body;
    const id = itemData.id ?? randomUUID();
    await this.records.create(userId, 'recurringItem', { ...itemData, id }, ctx);
    try {
      for (const period of periods) {
        await this.records.create(
          userId,
          'recurringAmountPeriod',
          { ...period, recurringItemId: id },
          ctx,
        );
      }
    } catch (error) {
      await this.records.remove(userId, 'recurringItem', id, ctx); // don't leave an item without its amounts
      throw error;
    }
    return this.get(userId, id);
  }

  async update(userId: string, id: string, patch: object, ctx: WriteContext): Promise<Data> {
    await this.records.update(userId, 'recurringItem', id, patch, ctx);
    return this.get(userId, id);
  }

  /** Replaces the amount schedule: periods are matched by `effectiveFrom`; missing ones are removed. */
  async setPeriods(
    userId: string,
    id: string,
    periods: PeriodInput[],
    ctx: WriteContext,
  ): Promise<Data> {
    await this.records.getLive(userId, 'recurringItem', id);
    const dates = periods.map((p) => p.effectiveFrom);
    if (new Set(dates).size !== dates.length)
      throw new BadRequestException('Two periods start on the same date');

    const current = await this.prisma.recurringAmountPeriod.findMany({
      where: { userId, recurringItemId: id, deletedAt: null },
    });
    const byDate = new Map(current.map((p) => [p.effectiveFrom.toISOString().slice(0, 10), p]));

    for (const period of periods) {
      const match = byDate.get(period.effectiveFrom);
      if (match) await this.records.update(userId, 'recurringAmountPeriod', match.id, period, ctx);
      else
        await this.records.create(
          userId,
          'recurringAmountPeriod',
          { ...period, recurringItemId: id },
          ctx,
        );
    }
    for (const [date, row] of byDate) {
      if (!dates.includes(date))
        await this.records.remove(userId, 'recurringAmountPeriod', row.id, ctx);
    }
    return this.get(userId, id);
  }

  async remove(userId: string, id: string, ctx: WriteContext): Promise<void> {
    const periods = await this.prisma.recurringAmountPeriod.findMany({
      where: { userId, recurringItemId: id, deletedAt: null },
      select: { id: true },
    });
    await this.records.remove(userId, 'recurringItem', id, ctx);
    for (const period of periods)
      await this.records.remove(userId, 'recurringAmountPeriod', period.id, ctx);
  }

  // ───────────────────────── occurrences ─────────────────────────

  private async view(userId: string, id: string): Promise<Data> {
    const row = await this.prisma.recurringOccurrence.findFirst({
      where: { id, userId, deletedAt: null },
      include: { item: { select: { name: true, kind: true } } },
    });
    if (!row) throw new NotFoundException('recurringOccurrence not found');
    return this.occurrenceView(row as unknown as Row & { item: { name: string; kind: string } });
  }

  private occurrenceView(row: Row & { item: { name: string; kind: string } }): Data {
    const today = isoDateIST(this.clock.now());
    const dto = this.records.toDto(this.records.def('recurringOccurrence'), row);
    return {
      ...dto,
      name: row.item.name,
      kind: row.item.kind,
      overdue: row.status === 'UPCOMING' && (dto.dueDate as string) < today,
    };
  }

  async occurrences(userId: string, query: OccurrenceQuery): Promise<Data[]> {
    await this.generator.regenerateAll(userId);
    const thisMonth = monthKey(this.clock.now());
    const from = query.from ?? addMonths(thisMonth, -1);
    const to = query.to ?? lastDateOfMonth(addMonths(thisMonth, 2));
    const rows = await this.prisma.recurringOccurrence.findMany({
      where: {
        userId,
        deletedAt: null,
        dueDate: { gte: dateOf(from), lte: dateOf(to) },
        ...(query.status && { status: query.status }),
        item: { deletedAt: null },
      },
      include: { item: { select: { name: true, kind: true } } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) =>
      this.occurrenceView(row as unknown as Row & { item: { name: string; kind: string } }),
    );
  }

  async markPaid(
    userId: string,
    id: string,
    body: MarkPaidInput,
    ctx: WriteContext,
  ): Promise<Data> {
    const occurrence = await this.prisma.recurringOccurrence.findFirst({
      where: { id, userId, deletedAt: null },
      include: { item: true },
    });
    if (!occurrence) throw new NotFoundException('recurringOccurrence not found');
    if (occurrence.status === 'PAID') return this.view(userId, id); // already done: safe to repeat

    const paidAt = body.paidAt ?? this.clock.now().toISOString();
    const amountPaise = body.amountPaise ?? occurrence.expectedAmountPaise;
    if (amountPaise < 1) throw new BadRequestException('amountPaise: enter the amount paid');

    if (body.createTransaction) {
      const accountId = body.accountId ?? occurrence.item.accountId;
      if (!accountId)
        throw new BadRequestException('accountId: choose the account this was paid from');
      await this.records.create(
        userId,
        'transaction',
        {
          type: occurrence.item.kind,
          amountPaise,
          accountId,
          categoryId: occurrence.item.categoryId ?? undefined,
          occurredAt: paidAt,
          merchant: occurrence.item.name,
          source: 'RECURRING',
        },
        { ...ctx, extra: { occurrenceId: id } },
      );
    }
    await this.records.update(
      userId,
      'recurringOccurrence',
      id,
      { status: 'PAID', paidAt, paidAmountPaise: amountPaise },
      ctx,
    );
    return this.view(userId, id);
  }

  /** Undoes "paid": the occurrence is due again, and a transaction created by mark-paid is removed. */
  async unmark(userId: string, id: string, ctx: WriteContext): Promise<Data> {
    await this.records.getLive(userId, 'recurringOccurrence', id);
    const linked = await this.prisma.transaction.findMany({
      where: { userId, occurrenceId: id, source: 'RECURRING', deletedAt: null },
      select: { id: true },
    });
    for (const txn of linked) await this.records.remove(userId, 'transaction', txn.id, ctx);
    await this.records.update(
      userId,
      'recurringOccurrence',
      id,
      { status: 'UPCOMING', paidAt: null, paidAmountPaise: null },
      ctx,
    );
    return this.view(userId, id);
  }

  async skip(userId: string, id: string, ctx: WriteContext): Promise<Data> {
    await this.records.update(userId, 'recurringOccurrence', id, { status: 'SKIPPED' }, ctx);
    return this.view(userId, id);
  }
}
