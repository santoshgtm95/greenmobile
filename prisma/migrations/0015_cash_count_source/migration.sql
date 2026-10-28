-- Where each cash-in-hand entry came from: a counted figure, or the automatic
-- adjustment a banking action made (Cash In, Cash Out, advances, reversals).
ALTER TABLE "CashCount" ADD COLUMN "source" TEXT;

-- Entries recorded before this column existed: read the source from the note
-- the adjustment wrote. Anything else was counted by hand.
UPDATE "CashCount" SET "source" = CASE
  WHEN notes LIKE 'Account Transfer (Cash In) ·%' THEN 'Cash In'
  WHEN notes LIKE 'Receive (Cash Out) ·%' THEN 'Cash Out'
  WHEN notes LIKE 'Advance deposit (Cash) ·%' THEN 'Customer advance'
  WHEN notes LIKE 'Advance withdrawal (Cash) ·%' THEN 'Advance withdrawal'
  WHEN notes LIKE 'Shop Advance Repayment ·%' THEN 'Shop advance repayment'
  WHEN notes LIKE 'Shop Advance ·%' THEN 'Shop advance'
  WHEN notes LIKE 'Deleted %' THEN 'Reversal'
  ELSE 'Cash count'
END;
