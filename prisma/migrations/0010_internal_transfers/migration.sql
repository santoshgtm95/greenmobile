-- Internal bank transfers between the shop's own registered accounts.
--
-- Transfers amount directly from one ShopBankAccount to another ShopBankAccount
-- without touching cash in hand or charging fees.

-- CreateTable
CREATE TABLE "InternalTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferNumber" TEXT NOT NULL,
    "transferDate" TEXT NOT NULL,
    "transferDay" TEXT NOT NULL,
    "fromShopAccountId" TEXT NOT NULL,
    "toShopAccountId" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "fromAccountNumber" TEXT NOT NULL,
    "fromAccountName" TEXT NOT NULL,
    "toAccountNumber" TEXT NOT NULL,
    "toAccountName" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "outTransactionId" TEXT,
    "inTransactionId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "InternalTransfer_fromShopAccountId_fkey" FOREIGN KEY ("fromShopAccountId") REFERENCES "ShopBankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InternalTransfer_toShopAccountId_fkey" FOREIGN KEY ("toShopAccountId") REFERENCES "ShopBankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InternalTransfer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InternalTransfer_transferNumber_key" ON "InternalTransfer"("transferNumber");

-- CreateIndex
CREATE INDEX "InternalTransfer_transferDay_idx" ON "InternalTransfer"("transferDay");

-- CreateIndex
CREATE INDEX "InternalTransfer_fromShopAccountId_idx" ON "InternalTransfer"("fromShopAccountId");

-- CreateIndex
CREATE INDEX "InternalTransfer_toShopAccountId_idx" ON "InternalTransfer"("toShopAccountId");

-- CreateIndex
CREATE INDEX "InternalTransfer_isDeleted_idx" ON "InternalTransfer"("isDeleted");
