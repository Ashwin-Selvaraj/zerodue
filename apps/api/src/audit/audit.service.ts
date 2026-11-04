import { Injectable } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId: string;
  entity: string;
  entityId: string;
  action: AuditAction;
  /** CREATE/UPDATE/DELETE: the record before the change. CONFLICT_OVERWRITTEN: the version that lost. */
  before?: Record<string, unknown> | null;
  /** CREATE/UPDATE: the record after. CONFLICT_OVERWRITTEN: the version that won. */
  after?: Record<string, unknown> | null;
  deviceId?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        before: (entry.before ?? Prisma.DbNull) as Prisma.InputJsonValue,
        after: (entry.after ?? Prisma.DbNull) as Prisma.InputJsonValue,
        deviceId: entry.deviceId ?? null,
      },
    });
  }

  history(userId: string, entity?: string, entityId?: string, limit = 100) {
    return this.prisma.auditLog.findMany({
      where: { userId, ...(entity && { entity }), ...(entityId && { entityId }) },
      orderBy: { at: 'desc' },
      take: limit,
    });
  }
}
