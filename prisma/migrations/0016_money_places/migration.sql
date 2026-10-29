-- Expenses, product purchases, POS sales and service payments now move real
-- money: cash in hand (the CashCount ledger) or one of the shop's registered
-- accounts (this ledger).
--
-- Entries are never edited or deleted. Undoing something — a deleted expense,
-- a cancelled sale — writes an opposite entry, so each account's history reads
-- as what actually happened.
CREATE TABLE "ShopAccountEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopAccountId" TEXT NOT NULL,
    "entryDate" TEXT NOT NULL,
    "entryDay" TEXT NOT NULL,
    -- Minor units: positive into the account, negative out of it.
    "amount" INTEGER NOT NULL,
    -- Sale, Service payment, Expense, Product purchase, Refund, Reversal, …
    "source" TEXT NOT NULL,
    -- The invoice / expense / service / SKU number it belongs to.
    "reference" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "ShopAccountEntry_shopAccountId_fkey" FOREIGN KEY ("shopAccountId") REFERENCES "ShopBankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ShopAccountEntry_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ShopAccountEntry_shopAccountId_idx" ON "ShopAccountEntry"("shopAccountId");
CREATE INDEX "ShopAccountEntry_entryDay_idx" ON "ShopAccountEntry"("entryDay");

-- Which account a payment went into or came out of (null = cash in hand), and
-- whether it actually moved money. Everything recorded before this upgrade did
-- not, so cancelling or deleting it must not "give back" money never taken.
ALTER TABLE "Expense" ADD COLUMN "shopAccountId" TEXT REFERENCES "ShopBankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD COLUMN "moneyLinked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "shopAccountId" TEXT REFERENCES "ShopBankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD COLUMN "moneyLinked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ServicePayment" ADD COLUMN "shopAccountId" TEXT REFERENCES "ShopBankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServicePayment" ADD COLUMN "moneyLinked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SaleReturn" ADD COLUMN "shopAccountId" TEXT REFERENCES "ShopBankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
