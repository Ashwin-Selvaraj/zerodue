/*
  Warnings:

  - Added the required column `userId` to the `RecurringAmountPeriod` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "RecurringAmountPeriod" ADD COLUMN     "userId" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "RecurringAmountPeriod_userId_updatedAt_id_idx" ON "RecurringAmountPeriod"("userId", "updatedAt", "id");

-- AddForeignKey
ALTER TABLE "RecurringAmountPeriod" ADD CONSTRAINT "RecurringAmountPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
