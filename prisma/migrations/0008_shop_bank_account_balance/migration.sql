-- Add balance column to ShopBankAccount
--
-- Tracks the recorded balance of each registered shop account.
ALTER TABLE "ShopBankAccount" ADD COLUMN "balance" INTEGER NOT NULL DEFAULT 0;
