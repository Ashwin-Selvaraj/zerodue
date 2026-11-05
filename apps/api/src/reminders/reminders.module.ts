import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TrackingModule } from '../tracking/tracking.module';
import { PushSender } from './push.sender';
import { PushController, RemindersController } from './reminders.controller';
import { RemindersScheduler } from './reminders.scheduler';
import { RemindersService } from './reminders.service';

/** Reminders for upcoming bills: planned and sent by a scheduler, shown in the app and as Web Push. */
@Module({
  imports: [ScheduleModule.forRoot(), TrackingModule],
  controllers: [RemindersController, PushController],
  providers: [RemindersService, RemindersScheduler, PushSender],
  exports: [RemindersService],
})
export class RemindersModule {}
