-- The fee charged on a movement.
--
-- A phone shop acting as a mobile-money agent is on both sides of this: it earns
-- a commission for handling a customer's transfer, and it is charged by the
-- wallet for moving its own money. The form asks for the rate and which way it
-- went; the main process works out the amount.
--
-- Three columns rather than one, because a fee that is only a percentage cannot
-- be read back later:
--
--   feeBasisPoints  the rate as typed, 50 == 0.5%
--   feeAmount       what it actually came to, in minor units
--   feeDirection    RECEIVE (the shop earned it) | PAY (the shop was charged)
--
-- feeAmount is stored rather than derived on read. It is arithmetic the main
-- process has already done once, and recomputing it on every query would let a
-- later change to the rounding rule quietly restate what a movement in March
-- actually cost.
--
-- All three have defaults, so every movement recorded before this migration
-- reads as "no fee" without a backfill — which is the truth about them: nobody
-- was ever asked.

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN "feeBasisPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN "feeAmount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN "feeDirection" TEXT NOT NULL DEFAULT 'RECEIVE';
