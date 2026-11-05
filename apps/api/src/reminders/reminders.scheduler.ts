import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringGenerator } from '../records/recurring-generator';
import { RemindersService } from './reminders.service';

/** Background jobs. Each guards against overlapping with itself, and can be switched off with SCHEDULER=false. */
@Injectable()
export class RemindersScheduler {
  private readonly logger = new Logger(RemindersScheduler.name);
  private running = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly reminders: RemindersService,
    private readonly generator: RecurringGenerator,
  ) {}

  private async once(name: string, job: () => Promise<void>): Promise<void> {
    if (!this.config.env.SCHEDULER || this.running.has(name)) return;
    this.running.add(name);
    try {
      await job();
    } catch (error) {
      this.logger.error(`${name} failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running.delete(name);
    }
  }

  /** Every minute: create reminders for upcoming bills, then send the ones that are due. */
  @Cron('* * * * *')
  tick(): Promise<void> {
    return this.once('reminders', async () => {
      await this.reminders.plan();
      await this.reminders.dispatch();
    });
  }

  /** Daily at 00:05 India time: keep every bill's due dates generated a year ahead. */
  @Cron('5 0 * * *', { timeZone: 'Asia/Kolkata' })
  generateDueDates(): Promise<void> {
    return this.once('generate', async () => {
      const users = await this.prisma.user.findMany({ select: { id: true } });
      for (const user of users) await this.generator.regenerateAll(user.id);
    });
  }
}
