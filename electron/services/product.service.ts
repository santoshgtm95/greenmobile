/**
 * Products, categories, brands and serial numbers (spec §10–§13, §39, §40).
 *
 * Deletion is soft: a product that appears on any sale, return or service job is
 * deactivated rather than removed, so historical documents and reports never
 * lose their subject (spec §74).
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase, transaction } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant, addMonthsInstant } from '../../shared/datetime';
import { errors } from '../../shared/errors';
import { recordAudit } from './audit.service';
import { applyStockMovement } from './inventory.service';
import { getShopSettings } from './settings.service';
import type { SessionUser } from '../session';
import type {
  CreateProductInput,
  UpdateProductInput,
  AdjustStockInput,
  AddSerialsInput,
  ProductListQuery,
} from '../../shared/validation';

export interface ProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  purchasePrice: number;
  sellingPrice: number;
  taxRate: number;
  taxRateOverride: number;
  stockQuantity: number;
  minimumStock: number;
  unit: string;
  isSerialized: number;
  warrantyMonths: number;
  isActive: number;
  availableSerials: number;
  createdAt: string;
  updatedAt: string;
}

const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.barcode, p.name, p.description,
         p.categoryId, c.name AS categoryName,
         p.brandId, b.name AS brandName,
         p.purchasePrice, p.sellingPrice, p.taxRate, p.taxRateOverride,
         p.stockQuantity, p.minimumStock, p.unit, p.isSerialized, p.warrantyMonths,
         p.isActive, p.createdAt, p.updatedAt,
         (SELECT COUNT(*) FROM "ProductSerial" s
           WHERE s.productId = p.id AND s.status = 'AVAILABLE') AS availableSerials
    FROM "Product" p
    LEFT JOIN "Category" c ON c.id = p.categoryId
    LEFT JOIN "Brand" b ON b.id = p.brandId
`;

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export function listProducts(
  query: ProductListQuery,
  db: Db = getDatabase(),
): { rows: ProductRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!query.includeInactive) where.push('p.isActive = 1');

  if (query.search) {
    // Case-insensitive across the fields a shop actually searches by (spec §92),
    // including the IMEI of an individual handset.
    where.push(`(
      p.name LIKE ? COLLATE NOCASE
      OR p.sku LIKE ? COLLATE NOCASE
      OR p.barcode = ?
      OR EXISTS (SELECT 1 FROM "ProductSerial" s
                  WHERE s.productId = p.id
                    AND (s.imei1 = ? OR s.imei2 = ? OR s.serialNumber = ?))
    )`);
    const like = `%${query.search}%`;
    params.push(like, like, query.search, query.search, query.search, query.search);
  }

  if (query.categoryId) {
    where.push('p.categoryId = ?');
    params.push(query.categoryId);
  }
  if (query.brandId) {
    where.push('p.brandId = ?');
    params.push(query.brandId);
  }
  if (query.lowStockOnly) {
    const threshold = getShopSettings(db).lowStockThreshold;
    where.push(
      'p.stockQuantity <= (CASE WHEN p.minimumStock > 0 THEN p.minimumStock ELSE ? END)',
    );
    params.push(threshold);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Every filter above references only "Product" (or an EXISTS subquery), so the
  // count needs neither the category nor the brand join.
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM "Product" p ${whereSql}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`${PRODUCT_SELECT} ${whereSql} ORDER BY p.name ASC LIMIT ? OFFSET ?`)
    .all(...params, query.pageSize, query.page * query.pageSize) as ProductRow[];

  return { rows, total };
}

export function getProduct(id: string, db: Db = getDatabase()): ProductRow {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id) as ProductRow | undefined;
  if (!row) throw errors.productGone();
  return row;
}

/** Exact lookup for the barcode scanner (spec §33). */
export function findProductByCode(code: string, db: Db = getDatabase()): ProductRow | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const row = db
    .prepare(`${PRODUCT_SELECT} WHERE (p.barcode = ? OR p.sku = ? COLLATE NOCASE) AND p.isActive = 1 LIMIT 1`)
    .get(trimmed, trimmed) as ProductRow | undefined;
  return row ?? null;
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

function assertSkuFree(sku: string, exceptId: string | null, db: Db): void {
  const row = db
    .prepare(`SELECT id FROM "Product" WHERE sku = ? COLLATE NOCASE AND id IS NOT ?`)
    .get(sku, exceptId) as { id: string } | undefined;
  if (row) throw errors.validation('That SKU is already used by another product.', { sku: 'Already in use' });
}

function assertBarcodeFree(barcode: string | undefined, exceptId: string | null, db: Db): void {
  if (!barcode) return;
  const row = db
    .prepare(`SELECT id FROM "Product" WHERE barcode = ? AND id IS NOT ?`)
    .get(barcode, exceptId) as { id: string } | undefined;
  if (row) {
    throw errors.validation('That barcode is already used by another product.', {
      barcode: 'Already in use',
    });
  }
}

export function createProduct(
  input: CreateProductInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ProductRow {
  const settings = getShopSettings(db);

  return transaction(() => {
    assertSkuFree(input.sku, null, db);
    assertBarcodeFree(input.barcode, null, db);

    const id = newId();
    const now = nowInstant();

    db.prepare(
      `INSERT INTO "Product" (id, sku, barcode, name, description, categoryId, brandId,
         purchasePrice, sellingPrice, taxRate, taxRateOverride, stockQuantity, minimumStock,
         unit, isSerialized, warrantyMonths, isActive, createdAt, updatedAt, createdBy, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    ).run(
      id,
      input.sku,
      input.barcode ?? null,
      input.name,
      input.description ?? null,
      input.categoryId ?? null,
      input.brandId ?? null,
      input.purchasePrice,
      input.sellingPrice,
      input.taxRate,
      input.taxRateOverride ? 1 : 0,
      input.minimumStock,
      input.unit,
      input.isSerialized ? 1 : 0,
      input.warrantyMonths,
      now,
      now,
      actor.id,
      actor.id,
    );

    // Opening stock is a movement like any other, so it lands in the ledger
    // rather than appearing from nowhere.
    if (input.initialStock > 0 && !input.isSerialized) {
      applyStockMovement(
        {
          productId: id,
          quantity: input.initialStock,
          transactionType: 'PURCHASE',
          reason: 'Opening stock',
          createdBy: actor.id,
          unitCost: input.purchasePrice,
          referenceType: 'PURCHASE',
        },
        { allowNegativeStock: settings.allowNegativeStock },
        db,
      );
    }

    if (input.isSerialized && input.serials?.length) {
      addSerialsInternal(id, input.serials, input.purchasePrice, actor, db, settings.allowNegativeStock);
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'Product',
        entityId: id,
        summary: `Created product "${input.name}" (${input.sku})`,
        newValues: input,
      },
      db,
    );

    return getProduct(id, db);
  }, db);
}

export function updateProduct(
  input: UpdateProductInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ProductRow {
  return transaction(() => {
    const before = getProduct(input.id, db);
    assertSkuFree(input.sku, input.id, db);
    assertBarcodeFree(input.barcode, input.id, db);

    // stockQuantity is deliberately absent: stock only ever moves through
    // applyStockMovement, so an edit form cannot silently rewrite it.
    db.prepare(
      `UPDATE "Product"
          SET sku = ?, barcode = ?, name = ?, description = ?, categoryId = ?, brandId = ?,
              purchasePrice = ?, sellingPrice = ?, taxRate = ?, taxRateOverride = ?,
              minimumStock = ?, unit = ?, isSerialized = ?, warrantyMonths = ?, isActive = ?,
              updatedAt = ?, updatedBy = ?
        WHERE id = ?`,
    ).run(
      input.sku,
      input.barcode ?? null,
      input.name,
      input.description ?? null,
      input.categoryId ?? null,
      input.brandId ?? null,
      input.purchasePrice,
      input.sellingPrice,
      input.taxRate,
      input.taxRateOverride ? 1 : 0,
      input.minimumStock,
      input.unit,
      input.isSerialized ? 1 : 0,
      input.warrantyMonths,
      input.isActive ? 1 : 0,
      nowInstant(),
      actor.id,
      input.id,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'Product',
        entityId: input.id,
        summary: `Updated product "${input.name}" (${input.sku})`,
        oldValues: before,
        newValues: input,
      },
      db,
    );

    return getProduct(input.id, db);
  }, db);
}

/**
 * Deactivates a product, or deletes it outright when it has never been used.
 * Returns what actually happened so the UI can tell the user.
 */
export function deleteProduct(
  id: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): { deactivated: boolean } {
  return transaction(() => {
    const product = getProduct(id, db);

    const usage = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM "SaleItem" WHERE productId = ?) AS sales,
           (SELECT COUNT(*) FROM "ServiceItem" WHERE productId = ?) AS services,
           (SELECT COUNT(*) FROM "InventoryTransaction" WHERE productId = ?) AS movements`,
      )
      .get(id, id, id) as { sales: number; services: number; movements: number };

    const hasHistory = usage.sales > 0 || usage.services > 0 || usage.movements > 0;

    if (hasHistory) {
      db.prepare(`UPDATE "Product" SET isActive = 0, updatedAt = ?, updatedBy = ? WHERE id = ?`).run(
        nowInstant(),
        actor.id,
        id,
      );
      recordAudit(
        {
          userId: actor.id,
          action: 'UPDATE',
          entityName: 'Product',
          entityId: id,
          summary: `Deactivated product "${product.name}" (it has trading history)`,
          oldValues: product,
        },
        db,
      );
      return { deactivated: true };
    }

    db.prepare(`DELETE FROM "ProductSerial" WHERE productId = ?`).run(id);
    db.prepare(`DELETE FROM "Product" WHERE id = ?`).run(id);
    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'Product',
        entityId: id,
        summary: `Deleted unused product "${product.name}"`,
        oldValues: product,
      },
      db,
    );
    return { deactivated: false };
  }, db);
}

/** Manual stock correction (spec §20). Always records a reason. */
export function adjustStock(
  input: AdjustStockInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ProductRow {
  const settings = getShopSettings(db);

  return transaction(() => {
    const product = getProduct(input.productId, db);

    if (product.isSerialized) {
      throw errors.invalidState(
        'Serialized products follow their IMEI records. Add or remove serial numbers instead of adjusting the quantity.',
      );
    }

    // The form asks for the level the shelf actually holds; the delta is derived
    // so a stock count cannot be mis-entered as a movement.
    const delta =
      input.mode === 'SET' ? input.quantity - product.stockQuantity : input.quantity;

    if (delta === 0) return product;

    applyStockMovement(
      {
        productId: input.productId,
        quantity: delta,
        transactionType: input.transactionType,
        reason: input.reason,
        createdBy: actor.id,
        unitCost: input.unitCost ?? product.purchasePrice,
        referenceType: 'ADJUSTMENT',
        // A stock-take that finds fewer items than recorded must be recordable
        // even when the shop otherwise blocks negative stock.
        allowNegative: input.mode === 'SET' ? true : settings.allowNegativeStock,
      },
      { allowNegativeStock: settings.allowNegativeStock },
      db,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'ADJUST_STOCK',
        entityName: 'Product',
        entityId: input.productId,
        summary: `Stock for "${product.name}" ${delta > 0 ? '+' : ''}${delta} — ${input.reason}`,
        oldValues: { stockQuantity: product.stockQuantity },
        newValues: { stockQuantity: product.stockQuantity + delta, reason: input.reason },
      },
      db,
    );

    return getProduct(input.productId, db);
  }, db);
}

// -----------------------------------------------------------------------------
// Serial numbers / IMEI
// -----------------------------------------------------------------------------

function assertSerialCodesFree(
  codes: Array<{ serialNumber?: string; imei1?: string; imei2?: string }>,
  db: Db,
): void {
  const seen = new Set<string>();
  // Three positional placeholders rather than a repeated ?1: better-sqlite3
  // counts bound values against placeholders, not against distinct indexes.
  const check = db.prepare(
    `SELECT id FROM "ProductSerial"
      WHERE serialNumber = ? OR imei1 = ? OR imei2 = ? LIMIT 1`,
  );

  for (const entry of codes) {
    for (const value of [entry.serialNumber, entry.imei1, entry.imei2]) {
      if (!value) continue;
      if (seen.has(value)) {
        throw errors.validation(`"${value}" appears twice in this list.`);
      }
      seen.add(value);
      if (check.get(value, value, value)) {
        throw errors.duplicate(`IMEI / serial "${value}"`);
      }
    }
  }
}

function addSerialsInternal(
  productId: string,
  serials: AddSerialsInput['serials'],
  defaultCost: number,
  actor: SessionUser,
  db: Db,
  allowNegativeStock: boolean,
): number {
  assertSerialCodesFree(serials, db);

  const now = nowInstant();
  const insert = db.prepare(
    `INSERT INTO "ProductSerial" (id, productId, serialNumber, imei1, imei2, purchasePrice,
       sellingPrice, status, warrantyStartDate, warrantyEndDate, saleItemId, notes,
       createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', NULL, NULL, NULL, ?, ?, ?)`,
  );

  for (const serial of serials) {
    const serialId = newId();
    insert.run(
      serialId,
      productId,
      serial.serialNumber ?? null,
      serial.imei1 ?? null,
      serial.imei2 ?? null,
      serial.purchasePrice ?? defaultCost,
      serial.sellingPrice ?? null,
      serial.notes ?? null,
      now,
      now,
    );

    // Each handset is one unit of stock, recorded individually so the ledger can
    // name the exact IMEI that came in.
    applyStockMovement(
      {
        productId,
        quantity: 1,
        transactionType: 'PURCHASE',
        reason: `Received ${serial.imei1 ?? serial.serialNumber ?? 'unit'}`,
        createdBy: actor.id,
        unitCost: serial.purchasePrice ?? defaultCost,
        productSerialId: serialId,
        referenceType: 'PURCHASE',
      },
      { allowNegativeStock },
      db,
    );
  }

  return serials.length;
}

export function addSerials(
  input: AddSerialsInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ProductRow {
  const settings = getShopSettings(db);

  return transaction(() => {
    const product = getProduct(input.productId, db);
    if (!product.isSerialized) {
      throw errors.invalidState('This product is not marked as serialized.');
    }

    const added = addSerialsInternal(
      input.productId,
      input.serials,
      product.purchasePrice,
      actor,
      db,
      settings.allowNegativeStock,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'ProductSerial',
        entityId: input.productId,
        summary: `Added ${added} serial number(s) to "${product.name}"`,
        newValues: input.serials,
      },
      db,
    );

    return getProduct(input.productId, db);
  }, db);
}

/** Marks a serial defective and removes it from sellable stock. */
export function markSerialDefective(
  serialId: string,
  reason: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): void {
  const settings = getShopSettings(db);

  transaction(() => {
    const serial = db
      .prepare(`SELECT id, productId, imei1, serialNumber, status FROM "ProductSerial" WHERE id = ?`)
      .get(serialId) as
      | { id: string; productId: string; imei1: string | null; serialNumber: string | null; status: string }
      | undefined;
    if (!serial) throw errors.notFound('serial number');
    if (serial.status === 'SOLD') {
      throw errors.invalidState('This unit has been sold. Refund the sale first.');
    }
    if (serial.status === 'DEFECTIVE') return;

    db.prepare(`UPDATE "ProductSerial" SET status = 'DEFECTIVE', updatedAt = ? WHERE id = ?`).run(
      nowInstant(),
      serialId,
    );

    applyStockMovement(
      {
        productId: serial.productId,
        quantity: -1,
        transactionType: 'DAMAGE',
        reason,
        createdBy: actor.id,
        productSerialId: serialId,
        referenceType: 'ADJUSTMENT',
        allowNegative: true,
      },
      { allowNegativeStock: settings.allowNegativeStock },
      db,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'ADJUST_STOCK',
        entityName: 'ProductSerial',
        entityId: serialId,
        summary: `Marked ${serial.imei1 ?? serial.serialNumber ?? 'unit'} defective — ${reason}`,
      },
      db,
    );
  }, db);
}

/** Warranty window for a unit sold now, from the product's warranty months. */
export function warrantyWindow(
  warrantyMonths: number,
  soldAt: string,
): { startDate: string; endDate: string | null } {
  if (warrantyMonths <= 0) return { startDate: soldAt, endDate: null };
  return { startDate: soldAt, endDate: addMonthsInstant(soldAt, warrantyMonths) };
}

// -----------------------------------------------------------------------------
// Categories and brands
// -----------------------------------------------------------------------------

export interface LookupRow {
  id: string;
  name: string;
  description: string | null;
  isActive: number;
  productCount: number;
}

function listLookup(table: 'Category' | 'Brand', includeInactive: boolean, db: Db): LookupRow[] {
  const column = table === 'Category' ? 'categoryId' : 'brandId';
  return db
    .prepare(
      `SELECT t.id, t.name, t.description, t.isActive,
              (SELECT COUNT(*) FROM "Product" p WHERE p.${column} = t.id) AS productCount
         FROM "${table}" t
        ${includeInactive ? '' : 'WHERE t.isActive = 1'}
        ORDER BY t.name ASC`,
    )
    .all() as LookupRow[];
}

export const listCategories = (includeInactive = false, db: Db = getDatabase()) =>
  listLookup('Category', includeInactive, db);

export const listBrands = (includeInactive = false, db: Db = getDatabase()) =>
  listLookup('Brand', includeInactive, db);

function upsertLookup(
  table: 'Category' | 'Brand',
  input: { id?: string; name: string; description?: string; isActive?: boolean },
  actor: SessionUser,
  db: Db,
): LookupRow {
  const now = nowInstant();

  const clash = db
    .prepare(`SELECT id FROM "${table}" WHERE name = ? COLLATE NOCASE AND id IS NOT ?`)
    .get(input.name, input.id ?? null) as { id: string } | undefined;
  if (clash) {
    throw errors.validation(`A ${table.toLowerCase()} with that name already exists.`, {
      name: 'Already in use',
    });
  }

  if (input.id) {
    db.prepare(
      `UPDATE "${table}" SET name = ?, description = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
    ).run(input.name, input.description ?? null, input.isActive === false ? 0 : 1, now, input.id);
  } else {
    input = { ...input, id: newId() };
    db.prepare(
      `INSERT INTO "${table}" (id, name, description, isActive, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.name, input.description ?? null, input.isActive === false ? 0 : 1, now, now);
  }

  recordAudit(
    {
      userId: actor.id,
      action: 'UPDATE',
      entityName: table,
      entityId: input.id!,
      summary: `Saved ${table.toLowerCase()} "${input.name}"`,
      newValues: input,
    },
    db,
  );

  const row = db
    .prepare(
      `SELECT id, name, description, isActive, 0 AS productCount FROM "${table}" WHERE id = ?`,
    )
    .get(input.id) as LookupRow;
  return row;
}

export const saveCategory = (
  input: { id?: string; name: string; description?: string; isActive?: boolean },
  actor: SessionUser,
  db: Db = getDatabase(),
) => transaction(() => upsertLookup('Category', input, actor, db), db);

export const saveBrand = (
  input: { id?: string; name: string; description?: string; isActive?: boolean },
  actor: SessionUser,
  db: Db = getDatabase(),
) => transaction(() => upsertLookup('Brand', input, actor, db), db);
