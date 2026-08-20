-- The account number moves from the bank to the transaction.
--
-- One registered wallet ("Kpay") serves many account numbers — a different one on
-- almost every payment — so the number and the holder's name belong to the
-- movement, not to the bank. 0003 put a single number on BankAccount, which could
-- only ever record one of them.
--
-- A delta on top of 0003_bank_account_number. Both new columns are nullable, so
-- transactions recorded before this migration keep their rows unchanged; the form
-- requires a value from here on.

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN "fromAccountNumber" TEXT;

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN "toAccountNumber" TEXT;

-- AlterTable
-- Nothing referenced this column (no index, no constraint, no view), so dropping
-- it is a plain rewrite. Any number a shop typed here was one of several and is
-- not worth carrying forward under a meaning it never had.
ALTER TABLE "BankAccount" DROP COLUMN "accountNumber";
