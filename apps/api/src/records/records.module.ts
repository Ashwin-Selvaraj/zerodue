import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { RecordsService } from './records.service';
import { RecurringGenerator } from './recurring-generator';

@Global()
@Module({
  providers: [RecordsService, RecurringGenerator, AuditService],
  exports: [RecordsService, RecurringGenerator, AuditService],
})
export class RecordsModule {}
