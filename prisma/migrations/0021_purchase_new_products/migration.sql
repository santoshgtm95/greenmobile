-- A purchase line may order a product that is not in Stocks yet: its details
-- wait in "newProduct" (JSON) and the product is created when it is delivered.
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt.

CREATE TABLE "new_PurchaseInvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT,
    "newProduct" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "refundedQty" INTEGER NOT NULL DEFAULT 0,
    "replacedQty" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PurchaseInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseInvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_PurchaseInvoiceItem" ("id", "invoiceId", "productId", "quantity", "unitCost", "receivedQty", "refundedQty", "replacedQty", "sortOrder")
SELECT "id", "invoiceId", "productId", "quantity", "unitCost", "receivedQty", "refundedQty", "replacedQty", "sortOrder"
  FROM "PurchaseInvoiceItem";

DROP TABLE "PurchaseInvoiceItem";
ALTER TABLE "new_PurchaseInvoiceItem" RENAME TO "PurchaseInvoiceItem";

CREATE INDEX "PurchaseInvoiceItem_invoiceId_idx" ON "PurchaseInvoiceItem"("invoiceId");
CREATE INDEX "PurchaseInvoiceItem_productId_idx" ON "PurchaseInvoiceItem"("productId");
