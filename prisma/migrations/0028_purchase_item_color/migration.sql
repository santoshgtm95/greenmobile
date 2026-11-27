-- The colour ordered on a purchase line. Without IMEI tracking, delivered units
-- are added to that ProductColor's quantity; IMEI phones take it as their default.
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN "color" TEXT;
