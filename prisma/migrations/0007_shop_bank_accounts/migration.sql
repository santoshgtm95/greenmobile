-- Shop bank accounts: the shop's own registered bank and mobile wallet accounts.
--
-- Used to pre-populate account numbers, account names, and bank providers
-- on transactions (Account Transfer Cash In / Account Receive Cash Out).

-- CreateTable
CREATE TABLE "ShopBankAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bankAccountId" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "ShopBankAccount_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShopBankAccount_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ShopBankAccount_bankAccountId_idx" ON "ShopBankAccount"("bankAccountId");

-- CreateIndex
CREATE INDEX "ShopBankAccount_isActive_idx" ON "ShopBankAccount"("isActive");
