-- The selling price set on a purchase line. On delivery the product takes the
-- line's unit cost as its purchase price and this as its selling price.
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN "sellingPrice" INTEGER;
