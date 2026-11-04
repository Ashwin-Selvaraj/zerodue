import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserSettings } from '@prisma/client';
import type { MeResponse, UpdateUserSettingsInput, UserSettingsDto } from '@zerodue/shared';
import { toUserDto } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

function toSettingsDto(s: UserSettings): UserSettingsDto {
  return {
    interestRounding: s.interestRounding,
    storeRawSms: s.storeRawSms,
    smsSenderAllowList: s.smsSenderAllowList,
    dedupeWindowMins: s.dedupeWindowMins,
    cashBufferPaise: s.cashBufferPaise,
    forecastMonths: s.forecastMonths,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { settings: true },
    });
    if (!user) throw new NotFoundException('User not found');
    // Settings are created at registration; upsert covers rows created any other way.
    const settings = user.settings ?? (await this.prisma.userSettings.create({ data: { userId } }));
    return { user: toUserDto(user), settings: toSettingsDto(settings) };
  }

  async updateSettings(userId: string, input: UpdateUserSettingsInput): Promise<UserSettingsDto> {
    const settings = await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
    return toSettingsDto(settings);
  }
}
