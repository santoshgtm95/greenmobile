-- The account or wallet number, shown beside each bank.
--
-- A delta on top of 0002_banking. NOT NULL needs a default so the column can be
-- added to accounts a shop already registered; the form requires a real value, so
-- only rows that predate this migration can hold the empty string.

-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN "accountNumber" TEXT NOT NULL DEFAULT '';
