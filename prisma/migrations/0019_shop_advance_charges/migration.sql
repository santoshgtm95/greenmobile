-- Bank charges on a shop advance sent from a shop account to a bank or wallet.
-- Minor units, taken from the FROM account on top of the amount; the recipient
-- owes only the amount.
ALTER TABLE "ShopAdvance" ADD COLUMN "bankCharges" INTEGER NOT NULL DEFAULT 0;
