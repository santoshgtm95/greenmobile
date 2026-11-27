-- The colours a product comes in. For a product without IMEI tracking the
-- quantity is a typed breakdown of its stock; for an IMEI-tracked one it is
-- unused and the count comes from ProductSerial.color.
CREATE TABLE "ProductColor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProductColor_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductColor_productId_name_key" ON "ProductColor"("productId", "name");

-- The colour of one handset.
ALTER TABLE "ProductSerial" ADD COLUMN "color" TEXT;
