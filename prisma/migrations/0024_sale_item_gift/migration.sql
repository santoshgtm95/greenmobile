-- A line given away free. Its unitPrice is 0; the flag lets receipts and
-- history say "Gift" rather than showing an unexplained zero price.
ALTER TABLE "SaleItem" ADD COLUMN "isGift" INTEGER NOT NULL DEFAULT 0;
