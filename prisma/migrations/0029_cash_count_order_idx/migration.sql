-- Every cash sale adds a CashCount row, and the latest one is looked up by
-- (countedAt, createdAt) on each cash movement and per day in Banking. These
-- indexes match those orders so SQLite stops sorting the whole table each time.
-- They replace the single-column indexes they start with.
DROP INDEX IF EXISTS "CashCount_countedAt_idx";
DROP INDEX IF EXISTS "CashCount_countedDay_idx";
CREATE INDEX "CashCount_countedAt_createdAt_idx" ON "CashCount"("countedAt", "createdAt");
CREATE INDEX "CashCount_countedDay_countedAt_createdAt_idx" ON "CashCount"("countedDay", "countedAt", "createdAt");
