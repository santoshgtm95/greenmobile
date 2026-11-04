-- More money paid out on an existing shop advance. Each extra payment is its
-- own ShopAdvance row (so balances and account history need no change) that
-- points at the advance it belongs to; repayments stay on that advance.
ALTER TABLE "ShopAdvance" ADD COLUMN "parentId" TEXT REFERENCES "ShopAdvance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ShopAdvance_parentId_idx" ON "ShopAdvance"("parentId");
