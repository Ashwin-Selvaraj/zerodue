import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { addMonths, type BulkCategoriseInput, type TransactionQuery } from '@zerodue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RecordsService, type Row, type WriteContext } from '../records/records.service';

interface PageCursor {
  t: string;
  id: string;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
  ) {}

  private decodeCursor(cursor: string): PageCursor {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as PageCursor;
      if (
        typeof parsed.t === 'string' &&
        typeof parsed.id === 'string' &&
        !Number.isNaN(Date.parse(parsed.t))
      )
        return parsed;
    } catch {
      /* falls through */
    }
    throw new BadRequestException('Invalid cursor');
  }

  async list(userId: string, query: TransactionQuery) {
    const def = this.records.def('transaction');
    const and: Prisma.TransactionWhereInput[] = [];

    if (query.month) {
      // Months are IST calendar months.
      and.push({
        occurredAt: {
          gte: new Date(`${query.month}T00:00:00+05:30`),
          lt: new Date(`${addMonths(query.month, 1)}T00:00:00+05:30`),
        },
      });
    }
    if (query.q) {
      and.push({
        OR: [
          { merchant: { contains: query.q, mode: 'insensitive' } },
          { note: { contains: query.q, mode: 'insensitive' } },
          { vpa: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.cursor) {
      const cursor = this.decodeCursor(query.cursor);
      const at = new Date(cursor.t);
      and.push({ OR: [{ occurredAt: { lt: at } }, { occurredAt: at, id: { lt: cursor.id } }] });
    }

    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(query.categoryId && { categoryId: query.categoryId }),
        ...(query.accountId && {
          OR: [{ accountId: query.accountId }, { toAccountId: query.accountId }],
        }),
        ...(query.status && { status: query.status }),
        ...(query.source && { source: query.source }),
        ...(query.tag && { tags: { has: query.tag } }),
        AND: and,
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.records.toDto(def, row as unknown as Row)),
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ t: last.occurredAt.toISOString(), id: last.id })).toString(
              'base64url',
            )
          : null,
    };
  }

  /** Sets one category on many transactions (each edit is audited like any other). */
  async bulkCategorise(userId: string, input: BulkCategoriseInput, ctx: WriteContext) {
    const found = await this.prisma.transaction.findMany({
      where: { userId, deletedAt: null, id: { in: input.ids } },
      select: { id: true },
    });
    const missing = input.ids.filter((id) => !found.some((row) => row.id === id));
    if (missing.length > 0)
      throw new NotFoundException(`Transactions not found: ${missing.join(', ')}`);

    const updated = [];
    for (const id of input.ids) {
      updated.push(
        await this.records.update(userId, 'transaction', id, { categoryId: input.categoryId }, ctx),
      );
    }
    return updated;
  }
}
