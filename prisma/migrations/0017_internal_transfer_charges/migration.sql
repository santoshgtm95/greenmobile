-- Bank charges on a transfer between two of the shop's own accounts. Minor
-- units, taken from the FROM account only; the TO account receives the amount.
ALTER TABLE "InternalTransfer" ADD COLUMN "bankCharges" INTEGER NOT NULL DEFAULT 0;
