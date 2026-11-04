/**
 * Settings › Data Control: permanently wipe one module's records.
 *
 * Each module deletes only what it owns. Where another module still points at
 * it, the delete is refused rather than reaching across: products are refused
 * while sales or repair jobs use them. Setup lists stay (bank/wallet providers
 * and registered accounts, product categories and brands, expense categories),
 * so the module is ready to use again straight away.
 *
 * The IPC handler takes a safety backup immediately before calling this.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase, transaction } from '../database/connection';
import { errors } from '../../shared/errors';
import { recordAudit } from './audit.service';
import { DATA_MODULE_LABELS, type DataModule } from '../../shared/domain';
import type { SessionUser } from '../session';

/** In dependency order: children before the rows they point at. */
const PURGE: Record<DataModule, readonly string[]> = {
  BANKING: [
    `DELETE FROM "ShopAdvanceSettlement"`,
    // Later payments point at their advance (RESTRICT is checked per row), so they go first.
    `DELETE FROM "ShopAdvance" WHERE parentId IS NOT NULL`,
    `DELETE FROM "ShopAdvance"`,
    `DELETE FROM "InternalTransfer"`,
    `DELETE FROM "ShopAccountEntry"`,
    // Advance withdrawals point at their deposit, so they go first.
    `DELETE FROM "BankTransaction" WHERE advanceDepositId IS NOT NULL`,
    `DELETE FROM "BankTransaction"`,
    `DELETE FROM "CashCount"`,
    // Balances start again from nothing.
    `UPDATE "ShopBankAccount" SET balance = 0`,
    // Their money movements are gone, so deleting or cancelling these later
    // must not "give back" money to a ledger that no longer records it.
    `UPDATE "Expense" SET moneyLinked = 0`,
    `UPDATE "Payment" SET moneyLinked = 0`,
    `UPDATE "ServicePayment" SET moneyLinked = 0`,
  ],
  PRODUCTS: [
    `DELETE FROM "InventoryTransaction"`,
    `DELETE FROM "ProductSerial"`,
    `DELETE FROM "Product"`,
  ],
  // Items and payments go with their job (ON DELETE CASCADE).
  SERVICES: [`DELETE FROM "ServiceOrder"`],
  SALES: [
    // Refund lines go with their refund; sale lines and payments with their sale.
    `DELETE FROM "SaleReturn"`,
    `DELETE FROM "Sale"`,
  ],
  EXPENSES: [`DELETE FROM "Expense"`],
};

export function purgeModule(
  module: DataModule,
  actor: SessionUser,
  db: Db = getDatabase(),
): { deleted: number } {
  return transaction(() => {
    if (module === 'PRODUCTS') {
      const { used } = db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM "SaleItem")
                + (SELECT COUNT(*) FROM "SaleReturnItem")
                + (SELECT COUNT(*) FROM "ServiceItem" WHERE productId IS NOT NULL) AS used`,
        )
        .get() as { used: number };
      if (used > 0) {
        throw errors.invalidState(
          'Products are still used by sales or repair jobs. Delete Sales and Services data first.',
        );
      }
    }

    let deleted = 0;
    for (const sql of PURGE[module]) {
      const result = db.prepare(sql).run();
      if (sql.startsWith('DELETE')) deleted += result.changes;
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'DataControl',
        entityId: module,
        summary: `Permanently deleted all ${DATA_MODULE_LABELS[module]} data (${deleted} records)`,
      },
      db,
    );
    return { deleted };
  }, db);
}
