import { BadRequestException, Injectable } from '@nestjs/common';
import type { DeviceDto } from '@zerodue/shared';
import { Clock } from '../common/clock';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { newDeviceToken, newPairingCode, sha256 } from './device-token';

/** Don't write "last seen" more often than this. */
const SEEN_EVERY_MS = 60_000;

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  /** A one-time code to type or scan on the phone. Only its hash is stored. */
  async createPairingCode(userId: string): Promise<{ code: string; expiresAt: string }> {
    const code = newPairingCode();
    const expiresAt = new Date(
      this.clock.now().getTime() + this.config.env.DEVICE_PAIRING_CODE_TTL_SECONDS * 1000,
    );
    await this.prisma.pairingCode.create({ data: { userId, codeHash: sha256(code), expiresAt } });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  /** Trades a code for a device token (shown once). A code works one time only. */
  async pair(code: string, deviceName: string): Promise<{ deviceId: string; deviceToken: string }> {
    const now = this.clock.now();
    const codeHash = sha256(code);
    // claim it first: two phones racing for the same code, only one wins
    const claimed = await this.prisma.pairingCode.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw new BadRequestException('That code is wrong or has expired');
    const row = await this.prisma.pairingCode.findUniqueOrThrow({ where: { codeHash } });

    const deviceToken = newDeviceToken();
    const device = await this.prisma.device.create({
      data: {
        userId: row.userId,
        kind: 'ANDROID_COMPANION',
        name: deviceName,
        tokenHash: sha256(deviceToken),
        lastSeenAt: now,
      },
    });
    return { deviceId: device.id, deviceToken };
  }

  /** Who a device token belongs to, or null when it is unknown or has been revoked. */
  async authenticate(token: string): Promise<{ id: string; userId: string } | null> {
    const device = await this.prisma.device.findUnique({ where: { tokenHash: sha256(token) } });
    if (!device || device.revokedAt) return null;
    const now = this.clock.now();
    if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > SEEN_EVERY_MS) {
      await this.prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: now } });
    }
    return { id: device.id, userId: device.userId };
  }

  async list(userId: string): Promise<DeviceDto[]> {
    const rows = await this.prisma.device.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      revokedAt: d.revokedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  /** Stops the phone's token working at once. Its past captures stay. */
  async revoke(userId: string, id: string): Promise<void> {
    await this.prisma.device.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }
}
