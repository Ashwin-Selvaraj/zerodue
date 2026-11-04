-- DropIndex
DROP INDEX "Account_userId_name_key";

-- DropIndex
DROP INDEX "Category_userId_parentId_name_key";

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "CategoryRule" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RecurringAmountPeriod" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RecurringItem" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RecurringOccurrence" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "editedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Account_userId_name_idx" ON "Account"("userId", "name");

-- CreateIndex
CREATE INDEX "Category_userId_parentId_name_idx" ON "Category"("userId", "parentId", "name");
