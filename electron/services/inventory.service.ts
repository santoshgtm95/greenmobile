/**
 * Stock movements (spec §20, §67).
 *
 * Every change to Product.stockQuantity in this application goes through
 * applyStockMovement — there is no other writer. That is what guarantees the
 * InventoryTransaction ledger is a complete history: stock can never move
 * without a recorded type, reason and before/after level.
 *
 * All functions here must be called inside a transaction opened by the caller,
 * so a sale that fails halfway leaves neither stock nor ledger changed.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant, businessDay } from '../../shared/datetime';
import { errors } from '../../shared/errors';
import type { InventoryTransactionType, ReferenceType, SerialStatus } from '../../shared/domain';

export interface StockMovement {
  productId: string;
  /** Signed: positive adds stock, negative removes it. Never zero. */
  quantity: number;
  transactionType: InventoryTransactionType;
  reason: string;
  createdBy: string;
  /** Minor units. Cost per unit for this movement, used for stock valuation. */
  unitCost?: number;
  productSerialId?: string | null;
  referenceType?: ReferenceType | null;
  referenceId?: string | null;
  /** Overrides the shop setting. Refunds restock even if stock policy is strict. */
  allowNegative?: boolean;
}

interface ProductStockRow {
  id: string;
  name: string;
  stockQuantity: number;
  isSerialized: number;
  isActive: number;
}

/**
 * Applies one stock movement and writes its ledger entry.
 * Returns the new stock level.
 */
export function applyStockMovement(
  movement: StockMovement,
  options: { allowNegativeStock: boolean },
  db: Db = getDatabase(),
): number {
  if (!Number.isInteger(movement.quantity) || movement.quantity === 0) {
    throw errors.validation('Stock movement quantity must be a whole number other than zero.');
  }

  // SELECT the row we are about to update inside the caller's transaction, so
  // the read and the write cannot be separated by another writer.
  const product = db
    .prepare(`SELECT id, name, stockQuantity, isSerialized, isActive FROM "Product" WHERE id = ?`)
    .get(movement.productId) as ProductStockRow | undefined;

  if (!product) throw errors.productGone();

  const previousStock = product.stockQuantity;
  const newStock = previousStock + movement.quantity;

  const negativeAllowed = movement.allowNegative ?? options.allowNegativeStock;
  if (newStock < 0 && !negativeAllowed) {
    throw errors.insufficientStock(product.name);
  }

  db.prepare(`UPDATE "Product" SET stockQuantity = ?, updatedAt = ? WHERE id = ?`).run(
    newStock,
    nowInstant(),
    product.id,
  );

  db.prepare(
    `INSERT INTO "InventoryTransaction" (id, productId, productSerialId, transactionType, quantity,
       previousStock, newStock, unitCost, referenceType, referenceId, reason, createdBy,
       createdAt, createdDay)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    movement.productId,
    movement.productSerialId ?? null,
    movement.transactionType,
    movement.quantity,
    previousStock,
    newStock,
    movement.unitCost ?? 0,
    movement.referenceType ?? null,
    movement.referenceId ?? null,
    movement.reason,
    movement.createdBy,
    nowInstant(),
    businessDay(),
  );

  return newStock;
}

/**
 * Claims a specific serial for a sale.
 *
 * The UPDATE is guarded by `status = 'AVAILABLE'`, so two tills racing for the
 * same phone cannot both win: the second one changes zero rows and is rejected.
 * This is what makes "never allow an IMEI to be sold twice" hold under
 * concurrency rather than only in the happy path.
 */
export function claimSerialForSale(
  serialId: string,
  saleItemId: string,
  warranty: { startDate: string; endDate: string | null } | null,
  db: Db = getDatabase(),
): void {
  const serial = db
    .prepare(`SELECT id, imei1, serialNumber, status FROM "ProductSerial" WHERE id = ?`)
    .get(serialId) as
    | { id: string; imei1: string | null; serialNumber: string | null; status: SerialStatus }
    | undefined;

  if (!serial) throw errors.notFound('serial number');

  const label = serial.imei1 ?? serial.serialNumber ?? undefined;
  if (serial.status !== 'AVAILABLE') {
    throw errors.serialUnavailable(label);
  }

  const result = db
    .prepare(
      `UPDATE "ProductSerial"
          SET status = 'SOLD', saleItemId = ?, warrantyStartDate = ?, warrantyEndDate = ?, updatedAt = ?
        WHERE id = ? AND status = 'AVAILABLE'`,
    )
    .run(saleItemId, warranty?.startDate ?? null, warranty?.endDate ?? null, nowInstant(), serialId);

  if (result.changes !== 1) {
    throw errors.serialUnavailable(label);
  }
}

/** Returns a serial to sellable (or defective) stock after a refund. */
export function releaseSerial(
  serialId: string,
  status: Extract<SerialStatus, 'RETURNED' | 'AVAILABLE' | 'DEFECTIVE'>,
  db: Db = getDatabase(),
): void {
  db.prepare(
    `UPDATE "ProductSerial"
        SET status = ?, saleItemId = NULL, updatedAt = ?
      WHERE id = ?`,
  ).run(status, nowInstant(), serialId);
}

export interface SerialRow {
  id: string;
  productId: string;
  serialNumber: string | null;
  imei1: string | null;
  imei2: string | null;
  purchasePrice: number;
  sellingPrice: number | null;
  status: SerialStatus;
  warrantyStartDate: string | null;
  warrantyEndDate: string | null;
  notes: string | null;
}

/** Serials for a product, newest first, optionally filtered by status. */
export function listSerials(
  productId: string,
  status?: SerialStatus,
  db: Db = getDatabase(),
): SerialRow[] {
  const sql = `SELECT id, productId, serialNumber, imei1, imei2, purchasePrice, sellingPrice,
                      status, warrantyStartDate, warrantyEndDate, notes
                 FROM "ProductSerial"
                WHERE productId = ? ${status ? 'AND status = ?' : ''}
                ORDER BY createdAt DESC`;
  const params = status ? [productId, status] : [productId];
  return db.prepare(sql).all(...params) as SerialRow[];
}

/** Finds a serial by IMEI or serial number. Used by the POS scanner. */
export function findSerialByCode(code: string, db: Db = getDatabase()): SerialRow | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const row = db
    .prepare(
      `SELECT id, productId, serialNumber, imei1, imei2, purchasePrice, sellingPrice,
              status, warrantyStartDate, warrantyEndDate, notes
         FROM "ProductSerial"
        WHERE imei1 = ? OR imei2 = ? OR serialNumber = ?
        LIMIT 1`,
    )
    .get(trimmed, trimmed, trimmed) as SerialRow | undefined;
  return row ?? null;
}

export interface InventoryHistoryRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  transactionType: InventoryTransactionType;
  quantity: number;
  previousStock: number;
  newStock: number;
  unitCost: number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string;
  createdAt: string;
  createdBy: string;
  createdByName: string | null;
}

export function inventoryHistory(
  query: { productId?: string; from?: string; to?: string; type?: string; limit?: number; offset?: number },
  db: Db = getDatabase(),
): { rows: InventoryHistoryRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.productId) {
    where.push('t.productId = ?');
    params.push(query.productId);
  }
  if (query.from) {
    where.push('t.createdDay >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('t.createdDay <= ?');
    params.push(query.to);
  }
  if (query.type) {
    where.push('t.transactionType = ?');
    params.push(query.type);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const offset = Math.max(query.offset ?? 0, 0);

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM "InventoryTransaction" t ${whereSql}`).get(...params) as {
      n: number;
    }
  ).n;

  const rows = db
    .prepare(
      `SELECT t.id, t.productId, p.name AS productName, p.sku, t.transactionType, t.quantity,
              t.previousStock, t.newStock, t.unitCost, t.referenceType, t.referenceId, t.reason,
              t.createdAt, t.createdBy, u.fullName AS createdByName
         FROM "InventoryTransaction" t
         JOIN "Product" p ON p.id = t.productId
         LEFT JOIN "User" u ON u.id = t.createdBy
         ${whereSql}
        ORDER BY t.createdAt DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as InventoryHistoryRow[];

  return { rows, total };
}

export interface StockSummary {
  /** Active products. */
  products: number;
  productsInStock: number;
  unitsHeld: number;
  /** Minor units. What the shelf cost. */
  stockValueAtCost: number;
  /** Minor units. What the shelf would fetch at today's prices. */
  potentialRevenue: number;
  lowStockCount: number;
  outOfStockCount: number;
  /** Individually tracked handsets still available to sell. */
  availableSerials: number;
}

/**
 * The headline figures for the Inventory screen.
 *
 * Deliberately its own function rather than reusing the inventory *report*: the
 * report needs `reports.view`, which a cashier does not have, and a cashier who
 * may look at stock should not be refused the totals at the top of the screen
 * they are already allowed to open.
 */
export function stockSummary(defaultThreshold: number, db: Db = getDatabase()): StockSummary {
  const threshold = Math.max(0, defaultThreshold);

  // One pass. The reorder point is the product's own minimum when it has set
  // one, and the shop default when it has not — the same rule lowStock() uses.
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS products,
         COALESCE(SUM(CASE WHEN p.stockQuantity > 0 THEN 1 ELSE 0 END), 0) AS productsInStock,
         COALESCE(SUM(MAX(p.stockQuantity, 0)), 0) AS unitsHeld,
         COALESCE(SUM(MAX(p.stockQuantity, 0) * p.purchasePrice), 0) AS stockValueAtCost,
         COALESCE(SUM(MAX(p.stockQuantity, 0) * p.sellingPrice), 0) AS potentialRevenue,
         COALESCE(SUM(
           CASE WHEN p.stockQuantity > 0
                 AND p.stockQuantity <= (CASE WHEN p.minimumStock > 0 THEN p.minimumStock ELSE ? END)
                THEN 1 ELSE 0 END), 0) AS lowStockCount,
         COALESCE(SUM(CASE WHEN p.stockQuantity <= 0 THEN 1 ELSE 0 END), 0) AS outOfStockCount
       FROM "Product" p
      WHERE p.isActive = 1`,
    )
    .get(threshold) as Omit<StockSummary, 'availableSerials'>;

  const serials = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM "ProductSerial" s
           JOIN "Product" p ON p.id = s.productId
          WHERE s.status = 'AVAILABLE' AND p.isActive = 1`,
      )
      .get() as { n: number }
  ).n;

  return { ...row, availableSerials: serials };
}

export interface LowStockRow {
  id: string;
  sku: string;
  name: string;
  stockQuantity: number;
  minimumStock: number;
  categoryName: string | null;
}

/**
 * Products at or below their reorder point.
 * A product's own minimumStock wins; the shop default applies when it is zero.
 */
export function lowStock(defaultThreshold: number, db: Db = getDatabase()): LowStockRow[] {
  return db
    .prepare(
      `SELECT p.id, p.sku, p.name, p.stockQuantity, p.minimumStock, c.name AS categoryName
         FROM "Product" p
         LEFT JOIN "Category" c ON c.id = p.categoryId
        WHERE p.isActive = 1
          AND p.stockQuantity <= (CASE WHEN p.minimumStock > 0 THEN p.minimumStock ELSE ? END)
        ORDER BY (p.stockQuantity - CASE WHEN p.minimumStock > 0 THEN p.minimumStock ELSE ? END) ASC,
                 p.name ASC`,
    )
    .all(defaultThreshold, defaultThreshold) as LowStockRow[];
}
