-- Where a repayment by transfer came from: the payer's bank/wallet, account
-- number and name. Null on cash repayments and on everything recorded before.
ALTER TABLE "ShopAdvanceSettlement" ADD COLUMN "fromBankName" TEXT;
ALTER TABLE "ShopAdvanceSettlement" ADD COLUMN "fromBankKey" TEXT;
ALTER TABLE "ShopAdvanceSettlement" ADD COLUMN "fromAccountNumber" TEXT;
ALTER TABLE "ShopAdvanceSettlement" ADD COLUMN "fromAccountName" TEXT;
