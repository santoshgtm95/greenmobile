-- The colour sold on a line: chosen at the till for a product without IMEI
-- tracking (its ProductColor quantity goes down), the handset's own otherwise.
ALTER TABLE "SaleItem" ADD COLUMN "color" TEXT;
