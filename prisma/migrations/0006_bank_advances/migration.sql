-- Customer advances: money a customer leaves with the shop to collect later.
--
-- A customer transfers 3,000,000 into the shop's account today, collects
-- 1,000,000 a week later, and the remaining 2,000,000 some other day. Each of
-- those is a real movement with its own accounts, amount and fee, so each is an
-- ordinary BankTransaction — the deposit a RECEIVE, every withdrawal a TRANSFER —
-- and the money appears in the account balances where it actually is.
--
-- What makes them one advance is these two columns:
--
--   advanceRole       DEPOSIT | WITHDRAWAL, null on every other movement
--   advanceDepositId  on a WITHDRAWAL, the DEPOSIT row it draws down
--
-- Deliberately NOT stored: how much is left, and whether the advance is settled.
-- Both are the deposit less its live withdrawals, worked out on read. A stored
-- balance would have to be corrected every time a withdrawal was deleted, and the
-- one time that was missed is the time a customer is told the wrong figure.
--
-- Both columns are nullable with no default, so every movement recorded before
-- this migration reads as "not part of an advance" — which is what they are.

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN "advanceRole" TEXT;

-- AlterTable
-- SQLite allows a REFERENCES clause on an added column only when its default is
-- NULL, which this is. The constraint guarantees a withdrawal can only ever
-- point at a row that exists.
ALTER TABLE "BankTransaction" ADD COLUMN "advanceDepositId" TEXT
  REFERENCES "BankTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "BankTransaction_advanceRole_idx" ON "BankTransaction"("advanceRole");

-- CreateIndex
CREATE INDEX "BankTransaction_advanceDepositId_idx" ON "BankTransaction"("advanceDepositId");
