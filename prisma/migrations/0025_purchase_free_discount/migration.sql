-- Free units on a purchase line (included in quantity, not charged) and an
-- invoice-level discount in minor units, taken off the line total.
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN "freeQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseInvoice" ADD COLUMN "discount" INTEGER NOT NULL DEFAULT 0;
