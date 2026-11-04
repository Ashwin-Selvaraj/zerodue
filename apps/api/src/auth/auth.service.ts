import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import type { User } from '@prisma/client';
import type { AuthResponse, LoginInput, RegisterInput, UserDto } from '@zerodue/shared';
import { createHmac, randomBytes } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { seedUserDefaults } from '../users/defaults';

/** Re-presenting a rotated refresh token inside this window is treated as a parallel tab, not theft. */
const REFRESH_REUSE_GRACE_MS = 30_000;

export interface Session {
  response: AuthResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export function toUserDto(user: User): UserDto {
  return { id: user.id, email: user.email, name: user.name, timezone: user.timezone };
}

@Injectable()
export class AuthService {
  /** Verified against when the email is unknown, so response time doesn't reveal which emails exist. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async register(input: RegisterInput): Promise<Session> {
    if (!this.config.env.ALLOW_SIGNUP) {
      throw new ForbiddenException('Sign-up is disabled');
    }
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await hash(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          name: input.name ?? null,
          settings: { create: {} },
        },
      });
      await seedUserDefaults(tx, created.id);
      return created;
    });
    return this.startSession(user);
  }

  async login(input: LoginInput): Promise<Session> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordHash = user?.passwordHash ?? (await this.getDummyHash());
    const ok = await verify(passwordHash, input.password).catch(() => false);
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    return this.startSession(user);
  }

  /** Rotates the refresh token. A token presented after rotation revokes the whole family (theft signal). */
  async refresh(rawToken: string | undefined): Promise<Session> {
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashRefreshToken(rawToken) },
      include: { user: true },
    });
    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.revokedAt) {
      if (Date.now() - stored.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Refresh token already used');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.startSession(stored.user);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashRefreshToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async startSession(user: User): Promise<Session> {
    const accessToken = await this.jwt.signAsync({ sub: user.id });
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(
      Date.now() + this.config.env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });
    return { response: { accessToken, user: toUserDto(user) }, refreshToken, refreshExpiresAt };
  }

  private hashRefreshToken(token: string): string {
    return createHmac('sha256', this.config.env.JWT_REFRESH_SECRET).update(token).digest('hex');
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hash('not-a-real-password');
    return this.dummyHash;
  }
}
