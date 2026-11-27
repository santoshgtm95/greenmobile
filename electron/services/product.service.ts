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
import { generateEan13Candidate } from '../../shared/barcode';
import { moveMoney } from './money.service';
import { addMoney, multiplyMoney } from '../../shared/money';
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
  /** Suppliers on its purchase invoices, most recent first. */
  supplierName: string | null;
  /** Its colours; an IMEI-tracked product counts the units in stock of each. */
  colors: Array<{ name: string; quantity: number }>;
  createdAt: string;
  updatedAt: string;
}

const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.barcode, p.name, p.description,
         p.categoryId,
         COALESCE(c2.name || ' › ', '') || COALESCE(c1.name || ' › ', '') || c.name AS categoryName,
         p.brandId, b.name AS brandName,
         p.purchasePrice, p.sellingPrice, p.taxRate, p.taxRateOverride,
         p.stockQuantity, p.minimumStock, p.unit, p.isSerialized, p.warrantyMonths,
         p.isActive, p.createdAt, p.updatedAt,
         (SELECT COUNT(*) FROM "ProductSerial" s
           WHERE s.productId = p.id AND s.status = 'AVAILABLE') AS availableSerials,
         -- Every supplier it was bought from, most recent first.
         (SELECT GROUP_CONCAT(name, ', ') FROM (
            SELECT sp.name FROM "PurchaseInvoiceItem" pi
              JOIN "PurchaseInvoice" pinv ON pinv.id = pi.invoiceId AND pinv.isDeleted = 0
              JOIN "Supplier" sp ON sp.id = pinv.supplierId
             WHERE pi.productId = p.id
             GROUP BY sp.id ORDER BY MAX(pinv.invoiceDate) DESC)) AS supplierName,
         (SELECT json_group_array(json_object('name', pc.name, 'quantity',
                   CASE WHEN p.isSerialized = 1
                        THEN (SELECT COUNT(*) FROM "ProductSerial" ps
                               WHERE ps.productId = p.id AND ps.color = pc.name
                                 AND ps.status IN ('AVAILABLE', 'RESERVED'))
                        ELSE pc.quantity END))
            FROM (SELECT name, quantity FROM "ProductColor" WHERE productId = p.id ORDER BY sortOrder) pc) AS colors
    FROM "Product" p
    LEFT JOIN "Category" c ON c.id = p.categoryId
    LEFT JOIN "Category" c1 ON c1.id = c.parentId
    LEFT JOIN "Category" c2 ON c2.id = c1.parentId
    LEFT JOIN "Brand" b ON b.id = p.brandId
`;

/**
 * P-00001, P-00002, …: the next number after the highest generated code, as the
 * import hands out. New products still on order hold their code too, and `taken`
 * adds codes already used on the invoice being saved.
 */
export function nextProductSku(db: Db, taken: ReadonlySet<string> = new Set()): string {
  const { n } = db
    .prepare(
      `SELECT MAX(CAST(substr(sku, 3) AS INTEGER)) AS n FROM (
         SELECT sku FROM "Product"
         UNION ALL
         SELECT json_extract(newProduct, '$.sku') FROM "PurchaseInvoiceItem" WHERE productId IS NULL AND newProduct IS NOT NULL
       ) WHERE sku GLOB 'P-[0-9]*'`,
    )
    .get() as { n: number | null };
  let next = (n ?? 0) + 1;
  while (taken.has(`P-${String(next).padStart(5, '0')}`)) next += 1;
  return `P-${String(next).padStart(5, '0')}`;
}

/** Replaces a product's colours. One still on a handset in stock cannot be dropped. */
function saveColors(productId: string, colors: CreateProductInput['colors'], db: Db): void {
  if (!colors) return;
  const kept = new Set(colors.map((c) => c.name.toLowerCase()));
  const inUse = db
    .prepare(
      `SELECT DISTINCT color FROM "ProductSerial"
        WHERE productId = ? AND color IS NOT NULL AND status IN ('AVAILABLE', 'RESERVED')`,
    )
    .all(productId) as Array<{ color: string }>;
  const dropped = inUse.find((s) => !kept.has(s.color.toLowerCase()));
  if (dropped) {
    throw errors.validation(`Phones in stock are "${dropped.color}", so that colour cannot be removed.`, {
      colors: 'Colour in use',
    });
  }

  db.prepare(`DELETE FROM "ProductColor" WHERE productId = ?`).run(productId);
  const insert = db.prepare(
    `INSERT INTO "ProductColor" (id, productId, name, quantity, sortOrder) VALUES (?, ?, ?, ?, ?)`,
  );
  colors.forEach((c, index) => insert.run(newId(), productId, c.name, c.quantity, index));
}

/** A PRODUCT_SELECT row: its colours come back as JSON text. */
function toProduct(row: unknown): ProductRow {
  const r = row as Omit<ProductRow, 'colors'> & { colors: string | null };
  return { ...r, colors: r.colors ? (JSON.parse(r.colors) as ProductRow['colors']) : [] };
}

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
    // A category takes in its sub categories (two levels at most).
    where.push(`p.categoryId IN (
      SELECT id FROM "Category" WHERE id = ? OR parentId = ?
         OR parentId IN (SELECT id FROM "Category" WHERE parentId = ?))`);
    params.push(query.categoryId, query.categoryId, query.categoryId);
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
  if (query.inStockOnly) where.push('p.stockQuantity > 0');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Every filter above references only "Product" (or an EXISTS subquery), so the
  // count needs neither the category nor the brand join.
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM "Product" p ${whereSql}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`${PRODUCT_SELECT} ${whereSql} ORDER BY p.name ASC LIMIT ? OFFSET ?`)
    .all(...params, query.pageSize, query.page * query.pageSize)
    .map(toProduct);

  return { rows, total };
}

export function getProduct(id: string, db: Db = getDatabase()): ProductRow {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
  if (!row) throw errors.productGone();
  return toProduct(row);
}

/** Exact lookup for the barcode scanner (spec §33). */
export function findProductByCode(code: string, db: Db = getDatabase()): ProductRow | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const row = db
    .prepare(`${PRODUCT_SELECT} WHERE (p.barcode = ? OR p.sku = ? COLLATE NOCASE) AND p.isActive = 1 LIMIT 1`)
    .get(trimmed, trimmed);
  return row ? toProduct(row) : null;
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

/** Generates a collision-free EAN-13 barcode against the database. */
export function generateUniqueBarcode(db: Db = getDatabase()): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = generateEan13Candidate();
    const existing = db
      .prepare('SELECT 1 FROM "Product" WHERE barcode = ? LIMIT 1')
      .get(candidate);
    if (!existing) {
      return candidate;
    }
  }
  throw errors.validation('Unable to generate unique barcode.', { barcode: 'Generation conflict' });
}

export function createProduct(
  input: CreateProductInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ProductRow {
  const settings = getShopSettings(db);

  return transaction(() => {
    input = { ...input, sku: input.sku || nextProductSku(db) };
    assertSkuFree(input.sku, null, db);

    const barcode = input.barcode?.trim() || generateUniqueBarcode(db);
    assertBarcodeFree(barcode, null, db);

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
      barcode,
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

    saveColors(id, input.colors, db);
    if (input.isSerialized && input.serials?.length) {
      addSerialsInternal(id, input.serials, input.purchasePrice, actor, db, settings.allowNegativeStock);
    }

    // Paying for the opening stock: out of cash in hand, or the chosen shop account.
    const purchaseCost = input.isSerialized
      ? addMoney(0, ...(input.serials ?? []).map((serial) => serial.purchasePrice ?? input.purchasePrice))
      : multiplyMoney(input.purchasePrice, input.initialStock);
    moveMoney(
      {
        shopAccountId: input.purchaseShopAccountId ?? null,
        amount: -purchaseCost,
        source: 'Product purchase',
        reference: input.sku,
        notes: input.name,
      },
      actor,
      db,
    );

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
    saveColors(input.id, input.colors, db);

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
           (SELECT COUNT(*) FROM "InventoryTransaction" WHERE productId = ?) AS movements,
           (SELECT COUNT(*) FROM "PurchaseInvoiceItem" WHERE productId = ?) AS purchases`,
      )
      .get(id, id, id, id) as { sales: number; services: number; movements: number; purchases: number };

    const hasHistory = usage.sales > 0 || usage.services > 0 || usage.movements > 0 || usage.purchases > 0;

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
        'Serialized products follow their IMEI records. Receive new phones on a purchase invoice instead of adjusting the quantity.',
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

export function addSerialsInternal(
  productId: string,
  serials: AddSerialsInput['serials'],
  defaultCost: number,
  actor: SessionUser,
  db: Db,
  allowNegativeStock: boolean,
  /** The purchase invoice line they arrived on. */
  referenceId: string | null = null,
  /** False: the units are already counted in stock and only get their IMEIs. */
  receive = true,
): number {
  assertSerialCodesFree(serials, db);

  // A colour must be one of the product's, written the way the product spells it.
  const colors = (db.prepare(`SELECT name FROM "ProductColor" WHERE productId = ?`).all(productId) as Array<{ name: string }>).map(
    (c) => c.name,
  );
  const colorOf = (typed: string | undefined): string | null => {
    if (!typed) return null;
    const match = colors.find((c) => c.toLowerCase() === typed.toLowerCase());
    if (!match) throw errors.validation(`"${typed}" is not one of this product's colours.`);
    return match;
  };

  const now = nowInstant();
  const insert = db.prepare(
    `INSERT INTO "ProductSerial" (id, productId, serialNumber, imei1, imei2, purchasePrice,
       sellingPrice, status, warrantyStartDate, warrantyEndDate, saleItemId, notes, color,
       createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', NULL, NULL, NULL, ?, ?, ?, ?)`,
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
      colorOf(serial.color),
      now,
      now,
    );
    if (!receive) continue;

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
        referenceId,
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

    // The units are already in stock (opening stock, a stock adjustment, or stock
    // held before IMEI tracking was switched on); this only names them, so one
    // IMEI per unit that has none yet, and stock does not move.
    assertSerialCodesFree(input.serials, db);
    const { tagged } = db
      .prepare(`SELECT COUNT(*) AS tagged FROM "ProductSerial" WHERE productId = ? AND status IN ('AVAILABLE', 'RESERVED')`)
      .get(input.productId) as { tagged: number };
    const untagged = Math.max(product.stockQuantity - tagged, 0);
    if (input.serials.length > untagged) {
      throw errors.validation(
        untagged === 0
          ? `Every unit of "${product.name}" in stock already has an IMEI. New phones come in through a purchase invoice.`
          : `Only ${untagged} unit(s) of "${product.name}" in stock have no IMEI yet.`,
      );
    }

    const added = addSerialsInternal(
      input.productId,
      input.serials,
      product.purchasePrice,
      actor,
      db,
      settings.allowNegativeStock,
      null,
      false,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'ProductSerial',
        entityId: input.productId,
        summary: `Added ${added} IMEI / serial number(s) to "${product.name}" units in stock`,
        newValues: input.serials,
      },
      db,
    );

    return getProduct(input.productId, db);
  }, db);
}

/** Sets or clears the colour of one IMEI / serial unit still in stock. */
export function setSerialColor(serialId: string, color: string | undefined, actor: SessionUser, db: Db = getDatabase()): void {
  transaction(() => {
    const serial = db.prepare(`SELECT productId, color, status FROM "ProductSerial" WHERE id = ?`).get(serialId) as
      | { productId: string; color: string | null; status: string }
      | undefined;
    if (!serial) throw errors.notFound('serial number');
    if (serial.status !== 'AVAILABLE' && serial.status !== 'RESERVED') {
      throw errors.invalidState('Only units in stock can change colour.');
    }
    const colors = (db.prepare(`SELECT name FROM "ProductColor" WHERE productId = ?`).all(serial.productId) as Array<{ name: string }>).map(
      (c) => c.name,
    );
    const match = color ? colors.find((c) => c.toLowerCase() === color.toLowerCase()) : null;
    if (color && !match) throw errors.validation(`"${color}" is not one of this product's colours.`);

    db.prepare(`UPDATE "ProductSerial" SET color = ?, updatedAt = ? WHERE id = ?`).run(match ?? null, nowInstant(), serialId);
    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'ProductSerial',
        entityId: serialId,
        summary: `Changed IMEI colour to ${match ?? 'none'}`,
        oldValues: { color: serial.color },
        newValues: { color: match ?? null },
      },
      db,
    );
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
  activeProductCount: number;
}

function listLookup(table: 'Category' | 'Brand', includeInactive: boolean, db: Db): LookupRow[] {
  const column = table === 'Category' ? 'categoryId' : 'brandId';
  return db
    .prepare(
      `SELECT t.id, t.name, t.description, t.isActive,
              (SELECT COUNT(*) FROM "Product" p WHERE p.${column} = t.id) AS productCount,
              (SELECT COUNT(*) FROM "Product" p WHERE p.${column} = t.id AND p.isActive = 1) AS activeProductCount
         FROM "${table}" t
        ${includeInactive ? '' : 'WHERE t.isActive = 1'}
        ORDER BY t.name ASC`,
    )
    .all() as LookupRow[];
}

export interface CategoryRow extends LookupRow {
  parentId: string | null;
  /** "Phones › Cases › Silicone"; the same text as a product's categoryName. */
  path: string;
  /** 0 for a category, 1 and 2 for its sub categories. */
  depth: number;
}

/** The deepest a sub category may sit: Category → Sub → Sub. */
export const MAX_CATEGORY_DEPTH = 2;

/**
 * Every category in tree order (each followed by its sub categories). Counts
 * include the sub categories; an inactive category hides its whole branch.
 */
export function listCategories(includeInactive = false, db: Db = getDatabase()): CategoryRow[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.description, t.isActive, t.parentId,
              (SELECT COUNT(*) FROM "Product" p WHERE p.categoryId = t.id) AS productCount,
              (SELECT COUNT(*) FROM "Product" p WHERE p.categoryId = t.id AND p.isActive = 1) AS activeProductCount
         FROM "Category" t
        ORDER BY t.name ASC`,
    )
    .all() as Array<LookupRow & { parentId: string | null }>;

  const children = new Map<string | null, typeof rows>();
  for (const row of rows) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);

  const out: CategoryRow[] = [];
  const walk = (parentId: string | null, prefix: string, depth: number): [number, number] => {
    let total = 0;
    let active = 0;
    for (const row of children.get(parentId) ?? []) {
      if (!includeInactive && !row.isActive) continue;
      const node: CategoryRow = { ...row, path: prefix + row.name, depth };
      out.push(node);
      const [subTotal, subActive] = walk(row.id, `${node.path} › `, depth + 1);
      node.productCount += subTotal;
      node.activeProductCount += subActive;
      total += node.productCount;
      active += node.activeProductCount;
    }
    return [total, active];
  };
  walk(null, '', 0);
  return out;
}

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
      `SELECT id, name, description, isActive, 0 AS productCount, 0 AS activeProductCount FROM "${table}" WHERE id = ?`,
    )
    .get(input.id) as LookupRow;
  return row;
}

/**
 * Adds or edits a category. `parentId` makes it a sub category; it is fixed
 * once created, since moving a branch could push it past the depth limit.
 */
export const saveCategory = (
  input: { id?: string; name: string; description?: string; isActive?: boolean; parentId?: string },
  actor: SessionUser,
  db: Db = getDatabase(),
): CategoryRow =>
  transaction(() => {
    const now = nowInstant();
    const current = input.id
      ? (db.prepare(`SELECT parentId FROM "Category" WHERE id = ?`).get(input.id) as
          | { parentId: string | null }
          | undefined)
      : undefined;
    if (input.id && !current) throw errors.notFound('category');
    const parentId = current ? current.parentId : (input.parentId ?? null);

    if (!current && parentId) {
      const parent = db
        .prepare(
          `SELECT (p.parentId IS NOT NULL) + (gp.parentId IS NOT NULL) AS depth
             FROM "Category" p LEFT JOIN "Category" gp ON gp.id = p.parentId
            WHERE p.id = ?`,
        )
        .get(parentId) as { depth: number } | undefined;
      if (!parent) throw errors.notFound('parent category');
      if (parent.depth >= MAX_CATEGORY_DEPTH) {
        throw errors.validation('A sub category can only have one more level of sub category below it.');
      }
    }

    const clash = db
      .prepare(`SELECT id FROM "Category" WHERE name = ? COLLATE NOCASE AND parentId IS ? AND id IS NOT ?`)
      .get(input.name, parentId, input.id ?? null);
    if (clash) {
      throw errors.validation('A category with that name already exists here.', { name: 'Already in use' });
    }

    const id = input.id ?? newId();
    const isActive = input.isActive === false ? 0 : 1;
    if (input.id) {
      db.prepare(`UPDATE "Category" SET name = ?, description = ?, isActive = ?, updatedAt = ? WHERE id = ?`).run(
        input.name,
        input.description ?? null,
        isActive,
        now,
        id,
      );
    } else {
      db.prepare(
        `INSERT INTO "Category" (id, name, description, isActive, parentId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.name, input.description ?? null, isActive, parentId, now, now);
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'Category',
        entityId: id,
        summary: `Saved category "${input.name}"`,
        newValues: { ...input, id, parentId },
      },
      db,
    );
    return listCategories(true, db).find((c) => c.id === id)!;
  }, db);

/**
 * Deletes a category with its sub categories. Their products are kept and
 * simply left without a category.
 */
export const deleteCategory = (
  id: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): { deleted: number; productsCleared: number } =>
  transaction(() => {
    const branch = listCategories(true, db);
    const root = branch.find((c) => c.id === id);
    if (!root) throw errors.notFound('category');
    // Deepest first: a parent cannot go while its children point at it.
    const doomed = branch
      .filter((c) => c.id === id || c.path.startsWith(`${root.path} › `))
      .sort((a, b) => b.depth - a.depth);
    const ids = doomed.map((c) => c.id);
    const marks = ids.map(() => '?').join(', ');

    const productsCleared = db
      .prepare(`UPDATE "Product" SET categoryId = NULL, updatedAt = ?, updatedBy = ? WHERE categoryId IN (${marks})`)
      .run(nowInstant(), actor.id, ...ids).changes;
    const remove = db.prepare(`DELETE FROM "Category" WHERE id = ?`);
    for (const categoryId of ids) remove.run(categoryId);

    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'Category',
        entityId: id,
        summary: `Deleted category "${root.path}" with ${ids.length - 1} sub categories; ${productsCleared} products left without a category`,
        oldValues: doomed,
      },
      db,
    );
    return { deleted: ids.length, productsCleared };
  }, db);

export const saveBrand = (
  input: { id?: string; name: string; description?: string; isActive?: boolean },
  actor: SessionUser,
  db: Db = getDatabase(),
) => transaction(() => upsertLookup('Brand', input, actor, db), db);
