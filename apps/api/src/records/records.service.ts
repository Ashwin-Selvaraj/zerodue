import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { matchCategoryRule, type SyncEntity } from '@zerodue/shared';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { ENTITIES, type EntityDef } from './entities';
import { RecurringGenerator } from './recurring-generator';

export type Row = {
  id: string;
  userId: string;
  version: number;
  editedAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  lastDeviceId: string | null;
  [column: string]: unknown;
};

interface Delegate {
  findFirst(args: unknown): Promise<Row | null>;
  findUnique(args: unknown): Promise<Row | null>;
  findMany(args: unknown): Promise<Row[]>;
  create(args: unknown): Promise<Row>;
  update(args: unknown): Promise<Row>;
}

/** Who made a write and when. `editedAt` defaults to now; sync supplies the device's own edit time. */
export interface WriteContext {
  deviceId?: string | null;
  editedAt?: Date;
  /** Server-managed columns that clients cannot set (e.g. a transaction's occurrenceId). */
  extra?: Record<string, unknown>;
}

type Data = Record<string, unknown>;

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly generator: RecurringGenerator,
  ) {}

  def(name: SyncEntity): EntityDef {
    return ENTITIES[name];
  }

  delegate(def: EntityDef): Delegate {
    return (this.prisma as unknown as Record<string, Delegate>)[def.delegate]!;
  }

  // ───────────────────────── conversion ─────────────────────────

  /** Database row → the shape the API and sync return: only schema columns, dates as strings. */
  toDto(def: EntityDef, row: Row): Data {
    const out: Data = {};
    for (const key of Object.keys(def.output.shape)) {
      if (!(key in row)) continue;
      const value = row[key];
      out[key] =
        value instanceof Date
          ? def.dateOnly.includes(key)
            ? value.toISOString().slice(0, 10)
            : value.toISOString()
          : value;
    }
    return out;
  }

  private toDb(def: EntityDef, parsed: Data): Data {
    const out: Data = { ...parsed };
    for (const key of def.dateOnly) {
      if (typeof out[key] === 'string') out[key] = new Date(`${out[key] as string}T00:00:00.000Z`);
    }
    for (const key of def.instants) {
      if (typeof out[key] === 'string') out[key] = new Date(out[key] as string);
    }
    if (def.name === 'recurringAmountPeriod' && out.breakdown === null)
      out.breakdown = Prisma.DbNull;
    return out;
  }

  // ───────────────────────── validation ─────────────────────────

  parse(def: EntityDef, data: unknown): Data {
    const result = def.input.safeParse(data);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      );
    }
    return result.data as Data;
  }

  async checkRefs(userId: string, def: EntityDef, parsed: Data): Promise<void> {
    for (const [field, target] of Object.entries(def.refs)) {
      const value = parsed[field];
      if (typeof value !== 'string') continue;
      const found = await this.delegate(ENTITIES[target]).findFirst({
        where: { id: value, userId },
        select: { id: true },
      });
      if (!found) throw new BadRequestException(`${field}: referenced ${target} not found`);
    }
  }

  /** Cross-record rules and defaults that depend on stored data. */
  async prepare(
    userId: string,
    def: EntityDef,
    parsed: Data,
    existing: Row | null,
    patch?: Data,
  ): Promise<Data> {
    if (def.name === 'category') await this.checkCategoryTree(userId, parsed);
    if (def.name === 'transaction') return this.prepareTransaction(userId, parsed, existing, patch);
    return parsed;
  }

  private async checkCategoryTree(userId: string, parsed: Data): Promise<void> {
    const parentId = parsed.parentId as string | null | undefined;
    if (!parentId) return;
    if (parentId === parsed.id)
      throw new BadRequestException('parentId: a category cannot be its own parent');
    const parent = await this.prisma.category.findFirst({ where: { id: parentId, userId } });
    if (parent?.parentId) throw new BadRequestException('parentId: categories nest one level deep');
    const hasChildren = await this.prisma.category.count({
      where: { userId, parentId: parsed.id as string, deletedAt: null },
    });
    if (hasChildren > 0)
      throw new BadRequestException(
        'parentId: a category with sub-categories cannot become a sub-category',
      );
  }

  private async prepareTransaction(
    userId: string,
    input: Data,
    existing: Row | null,
    patch?: Data,
  ): Promise<Data> {
    const txn = { ...input };
    const type = txn.type as 'EXPENSE' | 'INCOME' | 'TRANSFER';
    const fits = async (categoryId: string): Promise<boolean> => {
      const category = await this.prisma.category.findFirst({
        where: { id: categoryId, userId },
        select: { kind: true },
      });
      return (
        !!category && (type === 'TRANSFER' || category.kind === 'BOTH' || category.kind === type)
      );
    };

    if (typeof txn.categoryId === 'string' && !(await fits(txn.categoryId))) {
      throw new BadRequestException(`categoryId: not a ${type.toLowerCase()} category`);
    }

    // A new transaction with no category gets one from the user's merchant rules.
    if (
      !existing &&
      !txn.categoryId &&
      type !== 'TRANSFER' &&
      (txn.merchant || txn.vpa || txn.note)
    ) {
      const rules = await this.prisma.categoryRule.findMany({
        where: { userId, deletedAt: null, enabled: true },
      });
      const matched = matchCategoryRule(rules, {
        merchant: txn.merchant as string | undefined,
        vpa: txn.vpa as string | undefined,
        note: txn.note as string | undefined,
      });
      if (matched && (await fits(matched))) {
        txn.categoryId = matched;
        txn.categorisedVia = 'RULE';
      }
    }

    const before = (existing?.categoryId as string | null | undefined) ?? null;
    const changed = ((txn.categoryId as string | null | undefined) ?? null) !== before;
    const viaUntouched = patch ? patch.categorisedVia === undefined : txn.categorisedVia == null;
    if (changed && txn.categoryId && viaUntouched) txn.categorisedVia = 'MANUAL';
    if (changed && !txn.categoryId) txn.categorisedVia = null;
    if (txn.categoryId && txn.status === 'PENDING_CATEGORY') txn.status = 'POSTED';
    return txn;
  }

  // ───────────────────────── low-level writes (REST and sync share these) ─────────────────────────

  /** A record by id regardless of owner or deletion; callers check `userId`. */
  findAny(def: EntityDef, id: string): Promise<Row | null> {
    return this.delegate(def).findUnique({ where: { id } });
  }

  async insert(
    userId: string,
    def: EntityDef,
    id: string,
    parsed: Data,
    ctx: WriteContext = {},
  ): Promise<Row> {
    if (await this.findAny(def, id))
      throw new ConflictException(`${def.name} ${id} already exists`);
    let row: Row;
    try {
      row = await this.delegate(def).create({
        data: {
          ...this.toDb(def, parsed),
          ...ctx.extra,
          id,
          userId,
          version: 1,
          editedAt: ctx.editedAt ?? this.clock.now(),
          lastDeviceId: ctx.deviceId ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`${def.name} already exists`);
      }
      throw error;
    }
    await this.audit.record({
      userId,
      entity: def.name,
      entityId: id,
      action: 'CREATE',
      after: this.toDto(def, row),
      deviceId: ctx.deviceId,
    });
    await this.afterWrite(userId, def, row);
    return row;
  }

  async replace(
    userId: string,
    def: EntityDef,
    existing: Row,
    parsed: Data,
    ctx: WriteContext = {},
  ): Promise<Row> {
    const fields = this.toDb(def, parsed);
    delete fields.id; // the id never changes
    const row = await this.delegate(def).update({
      where: { id: existing.id },
      data: {
        ...fields,
        ...ctx.extra,
        deletedAt: null,
        version: { increment: 1 },
        editedAt: ctx.editedAt ?? this.clock.now(),
        lastDeviceId: ctx.deviceId ?? null,
      },
    });
    await this.audit.record({
      userId,
      entity: def.name,
      entityId: existing.id,
      action: 'UPDATE',
      before: this.toDto(def, existing),
      after: this.toDto(def, row),
      deviceId: ctx.deviceId,
    });
    await this.afterWrite(userId, def, row);
    return row;
  }

  async tombstone(
    userId: string,
    def: EntityDef,
    existing: Row,
    ctx: WriteContext = {},
  ): Promise<Row> {
    const row = await this.delegate(def).update({
      where: { id: existing.id },
      data: {
        deletedAt: this.clock.now(),
        version: { increment: 1 },
        editedAt: ctx.editedAt ?? this.clock.now(),
        lastDeviceId: ctx.deviceId ?? null,
      },
    });
    await this.audit.record({
      userId,
      entity: def.name,
      entityId: existing.id,
      action: 'DELETE',
      before: this.toDto(def, existing),
      deviceId: ctx.deviceId,
    });
    await this.afterWrite(userId, def, row);
    return row;
  }

  /** Recurring items own generated occurrences, which follow whenever the item or its amounts change. */
  private async afterWrite(userId: string, def: EntityDef, row: Row): Promise<void> {
    if (def.name === 'recurringItem') await this.generator.regenerate(userId, row.id);
    if (def.name === 'recurringAmountPeriod')
      await this.generator.regenerate(userId, row.recurringItemId as string);
  }

  // ───────────────────────── REST-style operations ─────────────────────────

  async create(
    userId: string,
    name: SyncEntity,
    input: object,
    ctx: WriteContext = {},
  ): Promise<Data> {
    const def = this.def(name);
    const data = input as Data;
    const id = typeof data.id === 'string' ? data.id : randomUUID();
    const parsed = this.parse(def, { ...data, id });
    await this.checkRefs(userId, def, parsed);
    const prepared = await this.prepare(userId, def, parsed, null);
    return this.toDto(def, await this.insert(userId, def, id, prepared, ctx));
  }

  async getLive(userId: string, name: SyncEntity, id: string): Promise<Row> {
    const row = await this.delegate(this.def(name)).findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!row) throw new NotFoundException(`${name} not found`);
    return row;
  }

  async get(userId: string, name: SyncEntity, id: string): Promise<Data> {
    return this.toDto(this.def(name), await this.getLive(userId, name, id));
  }

  async update(
    userId: string,
    name: SyncEntity,
    id: string,
    input: object,
    ctx: WriteContext = {},
  ): Promise<Data> {
    const def = this.def(name);
    const patch = input as Data;
    const existing = await this.getLive(userId, name, id);
    const parsed = this.parse(def, { ...this.toDto(def, existing), ...patch, id });
    await this.checkRefs(userId, def, parsed);
    const prepared = await this.prepare(userId, def, parsed, existing, patch);
    return this.toDto(def, await this.replace(userId, def, existing, prepared, ctx));
  }

  async remove(
    userId: string,
    name: SyncEntity,
    id: string,
    ctx: WriteContext = {},
  ): Promise<void> {
    await this.tombstone(userId, this.def(name), await this.getLive(userId, name, id), ctx);
  }

  async list(userId: string, name: SyncEntity): Promise<Data[]> {
    const def = this.def(name);
    const rows = await this.delegate(def).findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toDto(def, row));
  }
}
