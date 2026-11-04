import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import {
  syncEntities,
  type SyncEntity,
  type SyncOp,
  type SyncOpResult,
  type SyncPullQuery,
  type SyncPullResponse,
  type SyncPushInput,
  type SyncPushResponse,
} from '@zerodue/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { EntityDef } from '../records/entities';
import { RecordsService, type Row, type WriteContext } from '../records/records.service';

type Data = Record<string, unknown>;
type Cursors = Partial<Record<SyncEntity, { t: string; id: string }>>;

function messageOf(error: HttpException): string {
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  return Array.isArray(message) ? message.join('; ') : String(message ?? error.message);
}

/**
 * Two-way sync for the offline-first clients.
 *
 * Conflict rule (newest edit wins): an edit based on the latest server version always applies.
 * If the server record moved on since the device last saw it, the edit made later wins, comparing the
 * time of each edit on its device (`editedAt`). The losing version is never discarded silently: it is
 * written to the audit log as CONFLICT_OVERWRITTEN.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── push ─────────────────────────

  async push(userId: string, input: SyncPushInput): Promise<SyncPushResponse> {
    const results: SyncOpResult[] = [];
    for (const op of input.ops) results.push(await this.apply(userId, input.deviceId, op));
    return { results };
  }

  private async apply(userId: string, deviceId: string, op: SyncOp): Promise<SyncOpResult> {
    const def = this.records.def(op.entity);
    const base = { entity: op.entity, id: op.id };
    try {
      const existing = await this.records.findAny(def, op.id);
      if (existing && existing.userId !== userId) {
        return { ...base, status: 'rejected', error: 'This id is already in use' };
      }
      const ctx: WriteContext = { deviceId, editedAt: new Date(op.editedAt) };
      return op.op === 'delete'
        ? await this.applyDelete(userId, def, op, existing, ctx)
        : await this.applyUpsert(userId, def, op, existing, ctx);
    } catch (error) {
      if (error instanceof HttpException)
        return { ...base, status: 'rejected', error: messageOf(error) };
      throw error;
    }
  }

  private async applyUpsert(
    userId: string,
    def: EntityDef,
    op: SyncOp,
    existing: Row | null,
    ctx: WriteContext,
  ): Promise<SyncOpResult> {
    const base = { entity: op.entity, id: op.id };
    if (!op.data) return { ...base, status: 'rejected', error: 'data is required for an upsert' };

    const parsed = this.records.parse(def, { ...op.data, id: op.id });
    await this.records.checkRefs(userId, def, parsed);

    if (!existing) {
      const prepared = await this.records.prepare(userId, def, parsed, null);
      const row = await this.records.insert(userId, def, op.id, prepared, ctx);
      return this.applied(def, base, parsed, prepared, row);
    }

    // A retry of an edit that already landed (the response was lost) is a success, not a conflict.
    const alreadyApplied =
      existing.lastDeviceId === ctx.deviceId &&
      existing.editedAt.getTime() === Date.parse(op.editedAt);
    if (alreadyApplied) return { ...base, status: 'applied', version: existing.version };

    if (!this.incomingWins(existing, op, ctx.deviceId as string)) {
      await this.auditConflict(userId, def, op.id, parsed, this.records.toDto(def, existing), ctx);
      return { ...base, status: 'conflict', serverRow: this.records.toDto(def, existing) };
    }
    if (existing.version > op.baseVersion) {
      await this.auditConflict(userId, def, op.id, this.records.toDto(def, existing), parsed, ctx);
    }
    const prepared = await this.records.prepare(userId, def, parsed, existing);
    const row = await this.records.replace(
      userId,
      def,
      existing,
      prepared,
      this.keepLaterEdit(existing, ctx),
    );
    return this.applied(def, base, parsed, prepared, row);
  }

  /**
   * Success. If the server filled something in (e.g. a merchant rule chose the category), the final record
   * is sent back, because the device's own writes are not echoed on pull and it would never learn of it.
   */
  private applied(
    def: EntityDef,
    base: { entity: SyncEntity; id: string },
    sent: Data,
    stored: Data,
    row: Row,
  ): SyncOpResult {
    const changed = JSON.stringify(sent) !== JSON.stringify(stored);
    return changed
      ? {
          ...base,
          status: 'applied',
          version: row.version,
          serverRow: this.records.toDto(def, row),
        }
      : { ...base, status: 'applied', version: row.version };
  }

  private async applyDelete(
    userId: string,
    def: EntityDef,
    op: SyncOp,
    existing: Row | null,
    ctx: WriteContext,
  ): Promise<SyncOpResult> {
    const base = { entity: op.entity, id: op.id };
    if (def.name === 'recurringOccurrence') {
      return { ...base, status: 'rejected', error: 'Occurrences are skipped, not deleted' };
    }
    if (!existing || existing.deletedAt) return { ...base, status: 'applied' }; // already gone

    if (!this.incomingWins(existing, op, ctx.deviceId as string)) {
      await this.auditConflict(
        userId,
        def,
        op.id,
        { deleted: true },
        this.records.toDto(def, existing),
        ctx,
      );
      return { ...base, status: 'conflict', serverRow: this.records.toDto(def, existing) };
    }
    if (existing.version > op.baseVersion) {
      await this.auditConflict(
        userId,
        def,
        op.id,
        this.records.toDto(def, existing),
        { deleted: true },
        ctx,
      );
    }
    const row = await this.records.tombstone(
      userId,
      def,
      existing,
      this.keepLaterEdit(existing, ctx),
    );
    return { ...base, status: 'applied', version: row.version };
  }

  /** True if the device's edit should replace what the server holds. */
  private incomingWins(existing: Row, op: SyncOp, deviceId: string): boolean {
    if (op.baseVersion >= existing.version) return true; // built on the latest version: not a conflict
    const incoming = Date.parse(op.editedAt);
    const current = existing.editedAt.getTime();
    if (incoming !== current) return incoming > current;
    const incomingVersion = op.baseVersion + 1;
    if (incomingVersion !== existing.version) return incomingVersion > existing.version;
    return deviceId > (existing.lastDeviceId ?? ''); // deterministic last resort
  }

  /** The stored edit time never moves backwards, so a later stale edit can't beat a newer one. */
  private keepLaterEdit(existing: Row, ctx: WriteContext): WriteContext {
    const editedAt = ctx.editedAt as Date;
    return { ...ctx, editedAt: editedAt > existing.editedAt ? editedAt : existing.editedAt };
  }

  private auditConflict(
    userId: string,
    def: EntityDef,
    entityId: string,
    loser: Data,
    winner: Data,
    ctx: WriteContext,
  ): Promise<void> {
    return this.audit.record({
      userId,
      entity: def.name,
      entityId,
      action: 'CONFLICT_OVERWRITTEN',
      before: loser,
      after: winner,
      deviceId: ctx.deviceId,
    });
  }

  // ───────────────────────── pull ─────────────────────────

  private decodeCursor(cursor: string | undefined): Cursors {
    if (!cursor) return {};
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Cursors;
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      /* falls through */
    }
    throw new BadRequestException('Invalid cursor');
  }

  /**
   * Everything that changed since the cursor, per record type, in (updatedAt, id) order, including
   * deletions as records with `deletedAt` set. A device's own writes are not sent back to it.
   */
  async pull(userId: string, query: SyncPullQuery): Promise<SyncPullResponse> {
    const cursors = this.decodeCursor(query.cursor);
    const next: Cursors = { ...cursors };
    const changes: Record<string, Data[]> = {};
    let hasMore = false;

    for (const name of syncEntities) {
      const def = this.records.def(name);
      const since = cursors[name];
      const and: Data[] = [];
      if (since) {
        const at = new Date(since.t);
        and.push({ OR: [{ updatedAt: { gt: at } }, { updatedAt: at, id: { gt: since.id } }] });
      } else {
        and.push({ deletedAt: null }); // a first sync has no use for tombstones
      }
      if (query.deviceId) {
        and.push({ OR: [{ lastDeviceId: null }, { lastDeviceId: { not: query.deviceId } }] });
      }

      let rows = await this.records.delegate(def).findMany({
        where: { userId, AND: and },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      });
      if (rows.length > query.limit) {
        hasMore = true;
        rows = rows.slice(0, query.limit);
      }
      changes[name] = rows.map((row) => this.records.toDto(def, row));
      const last = rows.at(-1);
      if (last) next[name] = { t: last.updatedAt.toISOString(), id: last.id };
    }

    return { changes, cursor: Buffer.from(JSON.stringify(next)).toString('base64url'), hasMore };
  }
}
