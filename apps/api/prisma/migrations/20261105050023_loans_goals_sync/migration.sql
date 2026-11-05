/*
  Warnings:

  - Added the required column `userId` to the `GoalContribution` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `LoanLedgerEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `LoanPlannedPayment` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "LoanLedgerEntry_loanId_month_kind_effectiveDate_key";

-- DropIndex
DROP INDEX "LoanPlannedPayment_loanId_month_key";

-- AlterTable
ALTER TABLE "AllocationRule" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "GoalContribution" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "LoanLedgerEntry" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "LoanPlannedPayment" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN     "deletedAt" TIMESTAMPTZ(6),
ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastDeviceId" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "GoalContribution_userId_updatedAt_id_idx" ON "GoalContribution"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "LoanLedgerEntry_userId_updatedAt_id_idx" ON "LoanLedgerEntry"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "LoanPlannedPayment_loanId_month_idx" ON "LoanPlannedPayment"("loanId", "month");

-- CreateIndex
CREATE INDEX "LoanPlannedPayment_userId_updatedAt_id_idx" ON "LoanPlannedPayment"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "Scenario_userId_updatedAt_id_idx" ON "Scenario"("userId", "updatedAt", "id");

-- AddForeignKey
ALTER TABLE "LoanLedgerEntry" ADD CONSTRAINT "LoanLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPlannedPayment" ADD CONSTRAINT "LoanPlannedPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
