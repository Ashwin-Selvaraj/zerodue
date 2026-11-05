import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  formatINR,
  isoDateIST,
  type IngestResult,
  type IngestSmsInput,
  type ParsedPaymentDto,
} from '@zerodue/shared';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { RecordsService, type WriteContext } from '../records/records.service';

const DEFAULT_WINDOW_MINS = 10;
export const DEFAULT_ALLOW_LIST = ['*-ICICIB', '*-ICICIT', '*-ICICIS'];

type TxnRow = Prisma.TransactionGetPayload<{ include: { sources: true } }>;

/** Do two account tails (3 or 4 digits) refer to the same account? Unknown on either side means maybe. */
function tailsAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  return a.endsWith(b) || b.endsWith(a);
}

/**
 * Turns payment messages from the phone into transactions. The same payment often arrives twice (the
 * bank's message and the UPI app's), so a message is first matched against what is already known and
 * only becomes a new transaction when it matches nothing.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly clock: Clock,
  ) {}

  // ───────────────────────── settings ─────────────────────────

  async settings(userId: string) {
    const row = await this.prisma.userSettings.findUnique({ where: { userId } });
    return {
      allowList: row?.smsSenderAllowList ?? DEFAULT_ALLOW_LIST,
      windowMins: row?.dedupeWindowMins ?? DEFAULT_WINDOW_MINS,
      storeRawSms: row?.storeRawSms ?? false,
    };
  }

  /** The buttons on the notification: the user's quick-pick expense categories. */
  async quickPicks(userId: string): Promise<{ id: string; name: string }[]> {
    const rows = await this.prisma.category.findMany({
      where: { userId, deletedAt: null, quickPick: true, kind: { in: ['EXPENSE', 'BOTH'] } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
    return rows;
  }

  async config(userId: string) {
    const [settings, quickPicks] = await Promise.all([
      this.settings(userId),
      this.quickPicks(userId),
    ]);
    return { allowList: settings.allowList, quickPicks };
  }

  // ───────────────────────── ingest ─────────────────────────

  async ingestBatch(userId: string, events: IngestSmsInput[], deviceId: string | null) {
    const results = [];
    for (const event of events) {
      try {
        results.push({
          clientEventId: event.clientEventId,
          result: await this.ingest(userId, event, deviceId),
        });
      } catch (error) {
        results.push({
          clientEventId: event.clientEventId,
          error: error instanceof Error ? error.message : 'Could not record this message',
        });
      }
    }
    return { results };
  }

  async ingest(
    userId: string,
    event: IngestSmsInput,
    deviceId: string | null,
  ): Promise<IngestResult> {
    const known = await this.prisma.transactionSource.findUnique({
      where: { userId_messageHash: { userId, messageHash: event.messageHash } },
    });
    if (known) return this.result(userId, known.transactionId, true);

    const settings = await this.settings(userId);
    const { parsed } = event;
    const occurredAt = this.occurredAt(event);
    const matched = await this.findMatch(userId, parsed, occurredAt, settings.windowMins);
    const ctx: WriteContext = { deviceId };

    let transactionId: string;
    let deduped = false;
    if (matched) {
      transactionId = matched.id;
      deduped = true;
      await this.fillGaps(userId, matched, parsed, ctx);
    } else {
      transactionId = await this.createTransaction(userId, parsed, occurredAt, ctx);
    }

    try {
      await this.prisma.transactionSource.create({
        data: {
          transactionId,
          userId,
          kind: parsed.channel,
          deviceId,
          senderId: event.senderId,
          messageHash: event.messageHash,
          rawBody: settings.storeRawSms ? (event.rawBody ?? null) : null,
          parsed: parsed as unknown as Prisma.InputJsonValue,
          upiRef: parsed.upiRef ?? null,
          receivedAt: new Date(event.receivedAt),
        },
      });
    } catch (error) {
      // the same message arrived twice at once: the other request recorded it
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const other = await this.prisma.transactionSource.findUnique({
          where: { userId_messageHash: { userId, messageHash: event.messageHash } },
        });
        if (other) return this.result(userId, other.transactionId, true);
      }
      throw error;
    }
    return this.result(userId, transactionId, deduped);
  }

  /** When it happened: the message's own date if it is a different day from when it arrived, else when it arrived. */
  private occurredAt(event: IngestSmsInput): Date {
    const arrived = new Date(event.receivedAt);
    const stated = event.parsed.occurredAt;
    if (stated && isoDateIST(stated) !== isoDateIST(arrived)) return new Date(stated);
    return arrived;
  }

  // ───────────────────────── matching ─────────────────────────

  /**
   * The existing transaction this message is about, if any. A shared UPI reference settles it. Without
   * one, same direction, amount and account within a few minutes counts, unless the two clearly differ
   * (different references) or both came from the same kind of message (two identical purchases).
   */
  private async findMatch(
    userId: string,
    parsed: ParsedPaymentDto,
    occurredAt: Date,
    windowMins: number,
  ): Promise<TxnRow | null> {
    const type = parsed.direction === 'DEBIT' ? 'EXPENSE' : 'INCOME';

    if (parsed.upiRef) {
      const byRef = await this.prisma.transaction.findFirst({
        where: {
          userId,
          deletedAt: null,
          status: { not: 'IGNORED' },
          OR: [{ upiRef: parsed.upiRef }, { sources: { some: { upiRef: parsed.upiRef } } }],
        },
        include: { sources: true },
        orderBy: { occurredAt: 'desc' },
      });
      if (byRef) return byRef;
    }

    const span = windowMins * 60_000;
    const candidates = await this.prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { not: 'IGNORED' },
        type,
        amountPaise: parsed.amountPaise,
        occurredAt: {
          gte: new Date(occurredAt.getTime() - span),
          lte: new Date(occurredAt.getTime() + span),
        },
      },
      include: { sources: true },
    });
    const fits = candidates.filter((c) => {
      const theirRefs = [c.upiRef, ...c.sources.map((s) => s.upiRef)].filter(Boolean);
      if (parsed.upiRef && theirRefs.length > 0 && !theirRefs.includes(parsed.upiRef)) return false;
      const theirTails = [
        c.last4,
        ...c.sources.map((s) => (s.parsed as { accountTail?: string } | null)?.accountTail),
      ].filter((t): t is string => Boolean(t));
      if (
        parsed.accountTail &&
        theirTails.length > 0 &&
        !theirTails.some((t) => tailsAgree(parsed.accountTail, t))
      ) {
        return false;
      }
      return !c.sources.some((s) => s.kind === parsed.channel);
    });
    fits.sort(
      (a, b) =>
        Math.abs(a.occurredAt.getTime() - occurredAt.getTime()) -
        Math.abs(b.occurredAt.getTime() - occurredAt.getTime()),
    );
    return fits[0] ?? null;
  }

  /** A second message about the same payment may know things the first did not: keep them. */
  private async fillGaps(
    userId: string,
    existing: TxnRow,
    parsed: ParsedPaymentDto,
    ctx: WriteContext,
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (!existing.merchant && parsed.merchant) patch.merchant = parsed.merchant;
    if (!existing.vpa && parsed.vpa) patch.vpa = parsed.vpa;
    if (!existing.upiRef && parsed.upiRef) patch.upiRef = parsed.upiRef;
    if (!existing.last4 && parsed.accountTail?.length === 4) patch.last4 = parsed.accountTail;
    if (Object.keys(patch).length === 0) return;
    await this.records.update(userId, 'transaction', existing.id, patch, ctx);
  }

  // ───────────────────────── creating ─────────────────────────

  /** The account the message is about: the one whose number matches, else the main bank account. */
  private async pickAccount(userId: string, tail: string | undefined): Promise<string> {
    const accounts = await this.prisma.account.findMany({
      where: { userId, deletedAt: null, archived: false },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (accounts.length === 0) throw new BadRequestException('Add an account first');
    const byTail = tail ? accounts.find((a) => a.last4 && tailsAgree(tail, a.last4)) : undefined;
    return (byTail ?? accounts.find((a) => a.type === 'BANK') ?? accounts[0]!).id;
  }

  private async createTransaction(
    userId: string,
    parsed: ParsedPaymentDto,
    occurredAt: Date,
    ctx: WriteContext,
  ): Promise<string> {
    const created = await this.records.create(
      userId,
      'transaction',
      {
        type: parsed.direction === 'DEBIT' ? 'EXPENSE' : 'INCOME',
        status: 'PENDING_CATEGORY', // becomes POSTED at once if a merchant rule picks a category
        amountPaise: parsed.amountPaise,
        accountId: await this.pickAccount(userId, parsed.accountTail),
        occurredAt: occurredAt.toISOString(),
        merchant: parsed.merchant,
        vpa: parsed.vpa,
        upiRef: parsed.upiRef,
        last4: parsed.accountTail?.length === 4 ? parsed.accountTail : undefined,
        source: parsed.channel,
        tags: [],
      },
      ctx,
    );
    return created.id as string;
  }

  // ───────────────────────── answer ─────────────────────────

  private async result(
    userId: string,
    transactionId: string,
    deduped: boolean,
  ): Promise<IngestResult> {
    const txn = await this.prisma.transaction.findFirstOrThrow({
      where: { id: transactionId, userId },
    });
    const who = txn.merchant ?? txn.vpa;
    const amount = formatINR(txn.amountPaise);
    const title =
      txn.type === 'INCOME'
        ? `${amount} received${who ? ` from ${who}` : ''}`
        : `${amount} paid${who ? ` to ${who}` : ''}`;
    return {
      transactionId,
      deduped,
      status: txn.status,
      categoryId: txn.categoryId,
      quickPicks: await this.quickPicks(userId),
      title,
    };
  }
}
