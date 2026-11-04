-- DropIndex
DROP INDEX "RecurringAmountPeriod_recurringItemId_effectiveFrom_key";

-- CreateIndex
CREATE INDEX "RecurringAmountPeriod_recurringItemId_effectiveFrom_idx" ON "RecurringAmountPeriod"("recurringItemId", "effectiveFrom");
