-- ShopBankAccount.balance becomes the OPENING balance only.
--
-- Until now it was written in two ways at once: internal transfers and shop
-- advances added to it, and the screen ignored it as soon as the account had
-- one ordinary transaction (so an opening balance vanished on the first Cash
-- In / Cash Out). From now on the balance shown is always
--
--   opening + receipts - transfers - other fees + internal transfers
--           + advance repayments - advances paid out
--
-- and nothing writes the stored figure after the account is created.
--
-- This sets each opening so that the balance shown today does not change:
-- opening = what was shown before - what the movements now add up to.

UPDATE "ShopBankAccount" SET balance =
  (CASE
     WHEN EXISTS (SELECT 1 FROM "BankTransaction" t
                   WHERE ((t.toAccountId = "ShopBankAccount".bankAccountId AND t.toAccountNumber = "ShopBankAccount".accountNumber)
                       OR (t.fromAccountId = "ShopBankAccount".bankAccountId AND t.fromAccountNumber = "ShopBankAccount".accountNumber))
                     AND t.isDeleted = 0)
     THEN
         COALESCE((SELECT SUM(t.amount) FROM "BankTransaction" t
                    WHERE t.type = 'RECEIVE' AND t.toAccountId = "ShopBankAccount".bankAccountId
                      AND t.toAccountNumber = "ShopBankAccount".accountNumber AND t.isDeleted = 0), 0)
       - COALESCE((SELECT SUM(t.amount) FROM "BankTransaction" t
                    WHERE t.type = 'TRANSFER' AND t.fromAccountId = "ShopBankAccount".bankAccountId
                      AND t.fromAccountNumber = "ShopBankAccount".accountNumber AND t.isDeleted = 0), 0)
       + COALESCE((SELECT SUM(i.amount) FROM "InternalTransfer" i
                    WHERE i.toShopAccountId = "ShopBankAccount".id AND i.isDeleted = 0), 0)
       - COALESCE((SELECT SUM(i.amount) FROM "InternalTransfer" i
                    WHERE i.fromShopAccountId = "ShopBankAccount".id AND i.isDeleted = 0), 0)
       + COALESCE((SELECT SUM(sas.amount) FROM "ShopAdvanceSettlement" sas
                    WHERE sas.toShopAccountId = "ShopBankAccount".id AND sas.isDeleted = 0), 0)
       - COALESCE((SELECT SUM(sa.amount) FROM "ShopAdvance" sa
                    WHERE sa.fromShopAccountId = "ShopBankAccount".id AND sa.isDeleted = 0), 0)
     ELSE balance
   END)
  - (  COALESCE((SELECT SUM(t.amount - t.otherFees) FROM "BankTransaction" t
                  WHERE t.type = 'RECEIVE' AND t.toAccountId = "ShopBankAccount".bankAccountId
                    AND t.toAccountNumber = "ShopBankAccount".accountNumber AND t.isDeleted = 0), 0)
     - COALESCE((SELECT SUM(t.amount + t.otherFees) FROM "BankTransaction" t
                  WHERE t.type = 'TRANSFER' AND t.fromAccountId = "ShopBankAccount".bankAccountId
                    AND t.fromAccountNumber = "ShopBankAccount".accountNumber AND t.isDeleted = 0), 0)
     + COALESCE((SELECT SUM(i.amount) FROM "InternalTransfer" i
                  WHERE i.toShopAccountId = "ShopBankAccount".id AND i.isDeleted = 0), 0)
     - COALESCE((SELECT SUM(i.amount) FROM "InternalTransfer" i
                  WHERE i.fromShopAccountId = "ShopBankAccount".id AND i.isDeleted = 0), 0)
     + COALESCE((SELECT SUM(sas.actualAmount) FROM "ShopAdvanceSettlement" sas
                  WHERE sas.toShopAccountId = "ShopBankAccount".id AND sas.isDeleted = 0), 0)
     - COALESCE((SELECT SUM(sa.amount) FROM "ShopAdvance" sa
                  WHERE sa.fromShopAccountId = "ShopBankAccount".id AND sa.isDeleted = 0), 0));
