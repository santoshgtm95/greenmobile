-- Shop advances to external persons/entities/suppliers and repayments.
--
-- ShopAdvance: money leaving the shop (Cash or ShopBankAccount) to recipient (Cash or Account).
-- ShopAdvanceSettlement: repayment received back into the shop (Cash or ShopBankAccount).

-- CreateTable
CREATE TABLE "ShopAdvance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "advanceNumber" TEXT NOT NULL,
    "advanceDate" TEXT NOT NULL,
    "advanceDay" TEXT NOT NULL,
    "fromType" TEXT NOT NULL,
    "fromShopAccountId" TEXT,
    "fromAccountId" TEXT,
    "fromBankName" TEXT,
    "fromBankKey" TEXT,
    "fromAccountNumber" TEXT,
    "fromAccountName" TEXT,
    "toType" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT,
    "toBankName" TEXT,
    "toAccountNumber" TEXT,
    "toAccountName" TEXT,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "ShopAdvance_fromShopAccountId_fkey" FOREIGN KEY ("fromShopAccountId") REFERENCES "ShopBankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShopAdvance_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShopAdvanceSettlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementNumber" TEXT NOT NULL,
    "shopAdvanceId" TEXT NOT NULL,
    "settlementDate" TEXT NOT NULL,
    "settlementDay" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "toShopAccountId" TEXT,
    "toAccountId" TEXT,
    "toBankName" TEXT,
    "toBankKey" TEXT,
    "toAccountNumber" TEXT,
    "toAccountName" TEXT,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "ShopAdvanceSettlement_shopAdvanceId_fkey" FOREIGN KEY ("shopAdvanceId") REFERENCES "ShopAdvance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShopAdvanceSettlement_toShopAccountId_fkey" FOREIGN KEY ("toShopAccountId") REFERENCES "ShopBankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShopAdvanceSettlement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopAdvance_advanceNumber_key" ON "ShopAdvance"("advanceNumber");

-- CreateIndex
CREATE INDEX "ShopAdvance_advanceDay_idx" ON "ShopAdvance"("advanceDay");

-- CreateIndex
CREATE INDEX "ShopAdvance_fromShopAccountId_idx" ON "ShopAdvance"("fromShopAccountId");

-- CreateIndex
CREATE INDEX "ShopAdvance_isDeleted_idx" ON "ShopAdvance"("isDeleted");

-- CreateIndex
CREATE INDEX "ShopAdvance_recipientName_idx" ON "ShopAdvance"("recipientName");

-- CreateIndex
CREATE UNIQUE INDEX "ShopAdvanceSettlement_settlementNumber_key" ON "ShopAdvanceSettlement"("settlementNumber");

-- CreateIndex
CREATE INDEX "ShopAdvanceSettlement_shopAdvanceId_idx" ON "ShopAdvanceSettlement"("shopAdvanceId");

-- CreateIndex
CREATE INDEX "ShopAdvanceSettlement_settlementDay_idx" ON "ShopAdvanceSettlement"("settlementDay");

-- CreateIndex
CREATE INDEX "ShopAdvanceSettlement_toShopAccountId_idx" ON "ShopAdvanceSettlement"("toShopAccountId");

-- CreateIndex
CREATE INDEX "ShopAdvanceSettlement_isDeleted_idx" ON "ShopAdvanceSettlement"("isDeleted");
