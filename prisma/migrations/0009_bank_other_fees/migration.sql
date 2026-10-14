-- Other fees on a bank movement: a flat charge in minor units, typed by the
-- user, added on top of the actual amount. Zero on every existing row.
ALTER TABLE "BankTransaction" ADD COLUMN "otherFees" INTEGER NOT NULL DEFAULT 0;
