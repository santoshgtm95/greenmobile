-- Product categories nest: Category -> Sub Category -> Sub Category (two levels
-- below the top at most, enforced in product.service). A name only has to be
-- unique among its siblings, so "Cases" can sit under both Apple and Samsung.
ALTER TABLE "Category" ADD COLUMN "parentId" TEXT REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "Category_name_key";
CREATE UNIQUE INDEX "Category_parentId_name_key" ON "Category"("parentId", "name");
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");
