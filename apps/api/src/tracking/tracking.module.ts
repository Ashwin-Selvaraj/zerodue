import { Module } from '@nestjs/common';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';
import {
  AccountsController,
  AuditController,
  CategoriesController,
  RulesController,
} from './simple.controllers';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

/** Core tracking: accounts, categories and rules, transactions, recurring bills, and device sync. */
@Module({
  controllers: [
    AccountsController,
    CategoriesController,
    RulesController,
    TransactionsController,
    RecurringController,
    SyncController,
    AuditController,
  ],
  providers: [TransactionsService, RecurringService, SyncService],
})
export class TrackingModule {}
