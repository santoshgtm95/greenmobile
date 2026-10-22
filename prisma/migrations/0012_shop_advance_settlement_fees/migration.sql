-- AlterTable
ALTER TABLE "ShopAdvanceSettlement" ADD COLUMN "feeBasisPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ShopAdvanceSettlement" ADD COLUMN "feeAmount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ShopAdvanceSettlement" ADD COLUMN "feeDirection" TEXT NOT NULL DEFAULT 'RECEIVE';

-- AlterTable
ALTER TABLE "ShopAdvanceSettlement" ADD COLUMN "actualAmount" INTEGER NOT NULL DEFAULT 0;

-- Backfill actualAmount to amount for existing settlements
UPDATE "ShopAdvanceSettlement" SET "actualAmount" = "amount" WHERE "actualAmount" = 0;
