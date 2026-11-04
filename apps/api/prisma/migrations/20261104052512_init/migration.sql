-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('BANK', 'CREDIT_CARD', 'CASH', 'WALLET', 'LOAN');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('EXPENSE', 'INCOME', 'BOTH');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('EXPENSE', 'INCOME', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('POSTED', 'PENDING_CATEGORY', 'IGNORED');

-- CreateEnum
CREATE TYPE "TransactionSourceKind" AS ENUM ('MANUAL', 'SMS_BANK', 'SMS_UPI', 'STATEMENT_IMPORT', 'RECURRING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CategorisedVia" AS ENUM ('MANUAL', 'RULE', 'FLUTTER', 'PUSH', 'IMPORT');

-- CreateEnum
CREATE TYPE "RuleMatchType" AS ENUM ('MERCHANT_EQUALS', 'MERCHANT_CONTAINS', 'VPA_EQUALS', 'REMARKS_REGEX');

-- CreateEnum
CREATE TYPE "RecurringKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('UPCOMING', 'PAID', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LoanKind" AS ENUM ('EMI', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "InterestRounding" AS ENUM ('ROUND_HALF_UP_RUPEE', 'CARRY_PAISE');

-- CreateEnum
CREATE TYPE "LoanLedgerKind" AS ENUM ('INTEREST', 'PAYMENT', 'FEE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReceivableKind" AS ENUM ('OWED_TO_ME', 'EXPECTED_INCOME');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('EXPECTED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('PLEDGED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "AllocationTarget" AS ENUM ('LOAN', 'GOAL', 'RETURN_TO_SOURCE', 'UNALLOCATED');

-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('ANDROID_COMPANION', 'WEB');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WEB_PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "ReminderState" AS ENUM ('SCHEDULED', 'SENT', 'SNOOZED', 'DISMISSED', 'ACTED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'CONFLICT_OVERWRITTEN');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" UUID NOT NULL,
    "interestRounding" "InterestRounding" NOT NULL DEFAULT 'ROUND_HALF_UP_RUPEE',
    "storeRawSms" BOOLEAN NOT NULL DEFAULT false,
    "smsSenderAllowList" TEXT[] DEFAULT ARRAY['*-ICICIB', '*-ICICIT', '*-ICICIS']::TEXT[],
    "dedupeWindowMins" INTEGER NOT NULL DEFAULT 10,
    "cashBufferPaise" INTEGER NOT NULL DEFAULT 0,
    "forecastMonths" INTEGER NOT NULL DEFAULT 12,
    "signupOpen" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" UUID,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "DeviceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT,
    "lastSeenAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairingCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "last4" VARCHAR(4),
    "balancePaise" INTEGER NOT NULL DEFAULT 0,
    "balanceAsOf" DATE,
    "creditLimitPaise" INTEGER,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL DEFAULT 'EXPENSE',
    "parentId" UUID,
    "icon" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "quickPick" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryRule" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "matchType" "RuleMatchType" NOT NULL,
    "pattern" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'POSTED',
    "amountPaise" INTEGER NOT NULL,
    "accountId" UUID NOT NULL,
    "toAccountId" UUID,
    "categoryId" UUID,
    "categorisedVia" "CategorisedVia",
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "merchant" TEXT,
    "vpa" TEXT,
    "note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "upiRef" TEXT,
    "last4" VARCHAR(4),
    "source" "TransactionSourceKind" NOT NULL DEFAULT 'MANUAL',
    "receiptKey" TEXT,
    "loanId" UUID,
    "occurrenceId" UUID,
    "receivableId" UUID,
    "goalContributionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionSource" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "TransactionSourceKind" NOT NULL,
    "deviceId" UUID,
    "senderId" TEXT,
    "messageHash" TEXT,
    "rawBody" TEXT,
    "parsed" JSONB,
    "upiRef" TEXT,
    "importBatchId" UUID,
    "importRowIndex" INTEGER,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringItem" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "RecurringKind" NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "dueDay" INTEGER,
    "anchorMonth" DATE,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "categoryId" UUID,
    "accountId" UUID,
    "loanId" UUID,
    "reminderLeadDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "fixedOutgoing" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "RecurringItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringAmountPeriod" (
    "id" UUID NOT NULL,
    "recurringItemId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "label" TEXT,
    "breakdown" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "RecurringAmountPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringOccurrence" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recurringItemId" UUID NOT NULL,
    "dueDate" DATE NOT NULL,
    "label" TEXT,
    "expectedAmountPaise" INTEGER NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'UPCOMING',
    "paidAt" TIMESTAMPTZ(6),
    "paidAmountPaise" INTEGER,
    "snoozedUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "RecurringOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LoanKind" NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "accountId" UUID,
    "originalPaise" INTEGER,
    "outstandingPaise" INTEGER,
    "outstandingAsOf" DATE,
    "annualRateBps" INTEGER,
    "emiPaise" INTEGER,
    "emiDueDay" INTEGER,
    "paymentDay" INTEGER,
    "interestStartMonth" DATE,
    "roundingOverride" "InterestRounding",
    "targetPayoffMonth" DATE,
    "closedAt" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanLedgerEntry" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "kind" "LoanLedgerKind" NOT NULL,
    "month" DATE NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "balanceAfterPaise" INTEGER NOT NULL,
    "transactionId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "LoanLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPlannedPayment" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "month" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "LoanPlannedPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "loanId" UUID,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receivable" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "ReceivableKind" NOT NULL,
    "counterparty" TEXT NOT NULL,
    "description" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "expectedDate" DATE NOT NULL,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'EXPECTED',
    "receivedAt" TIMESTAMPTZ(6),
    "categoryId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmountPaise" INTEGER NOT NULL,
    "targetDate" DATE,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalContribution" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "contributor" TEXT NOT NULL,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "amountPaise" INTEGER NOT NULL,
    "status" "ContributionStatus" NOT NULL DEFAULT 'PLEDGED',
    "receivedOn" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "GoalContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationRule" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recurringItemId" UUID NOT NULL,
    "target" "AllocationTarget" NOT NULL,
    "loanId" UUID,
    "goalId" UUID,
    "startMonth" DATE NOT NULL,
    "endMonth" DATE,
    "endsWhenLoanCleared" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastDeviceId" UUID,

    CONSTRAINT "AllocationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "occurrenceId" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scheduledFor" TIMESTAMPTZ(6) NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'WEB_PUSH',
    "state" "ReminderState" NOT NULL DEFAULT 'SCHEDULED',
    "sentAt" TIMESTAMPTZ(6),
    "readAt" TIMESTAMPTZ(6),
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "summary" JSONB,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" TEXT,
    "ciphertext" BYTEA NOT NULL,
    "salt" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "kdf" JSONB NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "deviceId" UUID,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_userId_revokedAt_idx" ON "Device"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PairingCode_codeHash_key" ON "PairingCode"("codeHash");

-- CreateIndex
CREATE INDEX "PairingCode_userId_idx" ON "PairingCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_updatedAt_id_idx" ON "Account"("userId", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Account_userId_name_key" ON "Account"("userId", "name");

-- CreateIndex
CREATE INDEX "Category_userId_updatedAt_id_idx" ON "Category"("userId", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Category_userId_parentId_name_key" ON "Category"("userId", "parentId", "name");

-- CreateIndex
CREATE INDEX "CategoryRule_userId_enabled_priority_idx" ON "CategoryRule"("userId", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRule_userId_matchType_pattern_key" ON "CategoryRule"("userId", "matchType", "pattern");

-- CreateIndex
CREATE INDEX "Transaction_userId_occurredAt_idx" ON "Transaction"("userId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Transaction_userId_status_idx" ON "Transaction"("userId", "status");

-- CreateIndex
CREATE INDEX "Transaction_userId_categoryId_occurredAt_idx" ON "Transaction"("userId", "categoryId", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_userId_accountId_occurredAt_idx" ON "Transaction"("userId", "accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_userId_upiRef_idx" ON "Transaction"("userId", "upiRef");

-- CreateIndex
CREATE INDEX "Transaction_userId_amountPaise_type_occurredAt_idx" ON "Transaction"("userId", "amountPaise", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_userId_updatedAt_id_idx" ON "Transaction"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "TransactionSource_transactionId_idx" ON "TransactionSource"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionSource_userId_upiRef_idx" ON "TransactionSource"("userId", "upiRef");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionSource_userId_messageHash_key" ON "TransactionSource"("userId", "messageHash");

-- CreateIndex
CREATE INDEX "RecurringItem_userId_active_idx" ON "RecurringItem"("userId", "active");

-- CreateIndex
CREATE INDEX "RecurringItem_userId_updatedAt_id_idx" ON "RecurringItem"("userId", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringAmountPeriod_recurringItemId_effectiveFrom_key" ON "RecurringAmountPeriod"("recurringItemId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "RecurringOccurrence_userId_status_dueDate_idx" ON "RecurringOccurrence"("userId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "RecurringOccurrence_userId_updatedAt_id_idx" ON "RecurringOccurrence"("userId", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringOccurrence_recurringItemId_dueDate_key" ON "RecurringOccurrence"("recurringItemId", "dueDate");

-- CreateIndex
CREATE INDEX "Loan_userId_status_idx" ON "Loan"("userId", "status");

-- CreateIndex
CREATE INDEX "Loan_userId_updatedAt_id_idx" ON "Loan"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "LoanLedgerEntry_loanId_effectiveDate_idx" ON "LoanLedgerEntry"("loanId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "LoanLedgerEntry_loanId_month_kind_effectiveDate_key" ON "LoanLedgerEntry"("loanId", "month", "kind", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "LoanPlannedPayment_loanId_month_key" ON "LoanPlannedPayment"("loanId", "month");

-- CreateIndex
CREATE INDEX "Scenario_userId_idx" ON "Scenario"("userId");

-- CreateIndex
CREATE INDEX "Receivable_userId_status_expectedDate_idx" ON "Receivable"("userId", "status", "expectedDate");

-- CreateIndex
CREATE INDEX "Receivable_userId_updatedAt_id_idx" ON "Receivable"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId", "status");

-- CreateIndex
CREATE INDEX "Goal_userId_updatedAt_id_idx" ON "Goal"("userId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "GoalContribution_goalId_idx" ON "GoalContribution"("goalId");

-- CreateIndex
CREATE INDEX "AllocationRule_userId_recurringItemId_startMonth_idx" ON "AllocationRule"("userId", "recurringItemId", "startMonth");

-- CreateIndex
CREATE INDEX "Reminder_state_scheduledFor_idx" ON "Reminder"("state", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_userId_dedupeKey_key" ON "Reminder"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ImportBatch_userId_createdAt_idx" ON "ImportBatch"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_userId_fileHash_status_key" ON "ImportBatch"("userId", "fileHash", "status");

-- CreateIndex
CREATE INDEX "Backup_userId_createdAt_idx" ON "Backup"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_entity_entityId_at_idx" ON "AuditLog"("userId", "entity", "entityId", "at");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingCode" ADD CONSTRAINT "PairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "RecurringOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_goalContributionId_fkey" FOREIGN KEY ("goalContributionId") REFERENCES "GoalContribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSource" ADD CONSTRAINT "TransactionSource_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSource" ADD CONSTRAINT "TransactionSource_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSource" ADD CONSTRAINT "TransactionSource_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringItem" ADD CONSTRAINT "RecurringItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringItem" ADD CONSTRAINT "RecurringItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringItem" ADD CONSTRAINT "RecurringItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringItem" ADD CONSTRAINT "RecurringItem_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringAmountPeriod" ADD CONSTRAINT "RecurringAmountPeriod_recurringItemId_fkey" FOREIGN KEY ("recurringItemId") REFERENCES "RecurringItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_recurringItemId_fkey" FOREIGN KEY ("recurringItemId") REFERENCES "RecurringItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanLedgerEntry" ADD CONSTRAINT "LoanLedgerEntry_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanLedgerEntry" ADD CONSTRAINT "LoanLedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPlannedPayment" ADD CONSTRAINT "LoanPlannedPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationRule" ADD CONSTRAINT "AllocationRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationRule" ADD CONSTRAINT "AllocationRule_recurringItemId_fkey" FOREIGN KEY ("recurringItemId") REFERENCES "RecurringItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationRule" ADD CONSTRAINT "AllocationRule_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationRule" ADD CONSTRAINT "AllocationRule_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "RecurringOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
