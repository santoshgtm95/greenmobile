-- Banking: bank / mobile-payment accounts, the transfer-and-receive ledger and
-- the counted cash-in-hand figure.
--
-- A DELTA migration, applied on top of 0001_initial. Hand-written from the DDL
-- `prisma migrate diff` emits for these three models, because 0001 must stay
-- exactly as it was already applied to shops in the field — regenerating it to
-- include these tables would create them twice on a fresh install and not at all
-- on an existing one. See scripts/generate-migration-sql.mjs.

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "BankAccount_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "transactionDate" TEXT NOT NULL,
    "transactionDay" TEXT NOT NULL,
    "fromAccountId" TEXT,
    "fromName" TEXT,
    "toAccountId" TEXT,
    "toName" TEXT,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "BankTransaction_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "BankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BankTransaction_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "BankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BankTransaction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amount" INTEGER NOT NULL,
    "countedAt" TEXT NOT NULL,
    "countedDay" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "CashCount_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_name_key" ON "BankAccount"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_key_key" ON "BankAccount"("key");

-- CreateIndex
CREATE INDEX "BankAccount_isActive_idx" ON "BankAccount"("isActive");

-- CreateIndex
CREATE INDEX "BankAccount_key_idx" ON "BankAccount"("key");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_transactionNumber_key" ON "BankTransaction"("transactionNumber");

-- CreateIndex
CREATE INDEX "BankTransaction_transactionDay_idx" ON "BankTransaction"("transactionDay");

-- CreateIndex
CREATE INDEX "BankTransaction_transactionDate_idx" ON "BankTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "BankTransaction_type_idx" ON "BankTransaction"("type");

-- CreateIndex
CREATE INDEX "BankTransaction_fromAccountId_idx" ON "BankTransaction"("fromAccountId");

-- CreateIndex
CREATE INDEX "BankTransaction_toAccountId_idx" ON "BankTransaction"("toAccountId");

-- CreateIndex
CREATE INDEX "BankTransaction_isDeleted_idx" ON "BankTransaction"("isDeleted");

-- CreateIndex
CREATE INDEX "CashCount_countedAt_idx" ON "CashCount"("countedAt");

-- CreateIndex
CREATE INDEX "CashCount_countedDay_idx" ON "CashCount"("countedDay");
