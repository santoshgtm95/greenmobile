/**
 * Purchase invoices: products ordered from suppliers.
 *
 * Each line keeps three counters. receivedQty is in stock, refundedQty went back
 * for money and is no longer owed, and everything else (quantity − received −
 * refunded) is still awaited — including units sent back to be replaced.
 *
 * What the shop owes = Σ (quantity − refundedQty) × unitCost − Σ payments, where
 * a refund the supplier gave back is a negative payment.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase, transaction } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant, businessDay, localDateTimeToInstant, localDateTimeToDay } from '../../shared/datetime';
import { errors } from '../../shared/errors';
import { recordAudit } from './audit.service';
import { applyStockMovement } from './inventory.service';
import { addSerialsInternal, createProduct, saveBrand } from './product.service';
import { getShopSettings } from './settings.service';
import { moveMoney } from './money.service';
import type { SessionUser } from '../session';
import type {
  SaveSupplierInput,
  CreatePurchaseInvoiceInput,
  UpdatePurchaseInvoiceInput,
  PurchaseInvoiceListQuery,
  ReceivePurchaseItemsInput,
  ReturnPurchaseItemInput,
  PaySupplierInput,
  NewPurchaseProduct,
} from '../../shared/validation';

// -----------------------------------------------------------------------------
// Suppliers
// -----------------------------------------------------------------------------

export interface SupplierRow {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: number;
  invoiceCount: number;
  total: number;
  paid: number;
  remaining: number;
}

export function listSuppliers(includeInactive = false, db: Db = getDatabase()): SupplierRow[] {
  return db
    .prepare(
      `SELECT s.id, s.name, s.address, s.phone, s.isActive,
              COUNT(v.id) AS invoiceCount,
              COALESCE(SUM(v.total), 0) AS total,
              COALESCE(SUM(v.paid), 0) AS paid,
              COALESCE(SUM(v.remaining), 0) AS remaining
         FROM "Supplier" s
         LEFT JOIN (${INVOICE_FIGURES}) v ON v.supplierId = s.id AND v.isDeleted = 0
        ${includeInactive ? '' : 'WHERE s.isActive = 1'}
        GROUP BY s.id
        ORDER BY s.name COLLATE NOCASE`,
    )
    .all() as SupplierRow[];
}

export function saveSupplier(input: SaveSupplierInput, actor: SessionUser, db: Db = getDatabase()): SupplierRow {
  return transaction(() => {
    const clash = db
      .prepare(`SELECT id FROM "Supplier" WHERE name = ? COLLATE NOCASE AND id IS NOT ?`)
      .get(input.name, input.id ?? null);
    if (clash) throw errors.validation('A supplier with that name already exists.', { name: 'Already in use' });

    const now = nowInstant();
    const id = input.id ?? newId();
    if (input.id) {
      const changed = db
        .prepare(`UPDATE "Supplier" SET name = ?, address = ?, phone = ?, isActive = ?, updatedAt = ? WHERE id = ?`)
        .run(input.name, input.address ?? null, input.phone ?? null, input.isActive ? 1 : 0, now, id);
      if (changed.changes === 0) throw errors.notFound('supplier');
    } else {
      db.prepare(
        `INSERT INTO "Supplier" (id, name, address, phone, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.name, input.address ?? null, input.phone ?? null, input.isActive ? 1 : 0, now, now);
    }

    recordAudit(
      {
        userId: actor.id,
        action: input.id ? 'UPDATE' : 'CREATE',
        entityName: 'Supplier',
        entityId: id,
        summary: `Saved supplier "${input.name}"`,
        newValues: input,
      },
      db,
    );
    return listSuppliers(true, db).find((s) => s.id === id)!;
  }, db);
}

// -----------------------------------------------------------------------------
// Invoices
// -----------------------------------------------------------------------------

/** One row per invoice with its money and delivery figures. */
const INVOICE_FIGURES = `
  SELECT i.id, i.invoiceNo, i.supplierId, s.name AS supplierName, i.invoiceDate, i.invoiceDay,
         i.paymentMethod, i.remark, i.isDeleted, i.createdBy, u.fullName AS createdByName, i.createdAt,
         COALESCE(it.itemCount, 0) AS itemCount,
         COALESCE(it.quantity, 0) AS quantity,
         COALESCE(it.received, 0) AS receivedQty,
         COALESCE(it.refunded, 0) AS refundedQty,
         COALESCE(it.quantity, 0) - COALESCE(it.received, 0) - COALESCE(it.refunded, 0) AS pendingQty,
         COALESCE(it.total, 0) AS total,
         COALESCE(p.paid, 0) AS paid,
         COALESCE(it.total, 0) - COALESCE(p.paid, 0) AS remaining
    FROM "PurchaseInvoice" i
    JOIN "Supplier" s ON s.id = i.supplierId
    LEFT JOIN "User" u ON u.id = i.createdBy
    LEFT JOIN (SELECT invoiceId, COUNT(*) AS itemCount, SUM(quantity) AS quantity,
                      SUM(receivedQty) AS received, SUM(refundedQty) AS refunded,
                      SUM((quantity - refundedQty) * unitCost) AS total
                 FROM "PurchaseInvoiceItem" GROUP BY invoiceId) it ON it.invoiceId = i.id
    LEFT JOIN (SELECT invoiceId, SUM(amount) AS paid FROM "SupplierPayment" GROUP BY invoiceId) p
           ON p.invoiceId = i.id
`;

export interface PurchaseInvoiceRow {
  id: string;
  invoiceNo: string;
  supplierId: string;
  supplierName: string;
  invoiceDate: string;
  invoiceDay: string;
  paymentMethod: string;
  remark: string | null;
  isDeleted: number;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  itemCount: number;
  quantity: number;
  receivedQty: number;
  refundedQty: number;
  pendingQty: number;
  total: number;
  paid: number;
  remaining: number;
}

/** A product to create on delivery, as stored on its line. */
type DraftProduct = NewPurchaseProduct & { brandId?: string };

export interface PurchaseInvoiceItemRow {
  id: string;
  /** Null until a new product is delivered. */
  productId: string | null;
  newProduct: DraftProduct | null;
  productName: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  brandName: string | null;
  description: string | null;
  isSerialized: number;
  quantity: number;
  unitCost: number;
  /** Set on this line, else the product's own. */
  sellingPrice: number;
  receivedQty: number;
  refundedQty: number;
  replacedQty: number;
  pendingQty: number;
}

export interface SupplierPaymentRow {
  id: string;
  amount: number;
  shopAccountId: string | null;
  accountLabel: string | null;
  paidAt: string;
  notes: string | null;
  createdByName: string | null;
}

export interface PurchaseInvoiceDetail extends PurchaseInvoiceRow {
  items: PurchaseInvoiceItemRow[];
  payments: SupplierPaymentRow[];
}

export function listPurchaseInvoices(
  query: PurchaseInvoiceListQuery,
  db: Db = getDatabase(),
): { rows: PurchaseInvoiceRow[]; total: number; totals: { total: number; paid: number; remaining: number } } {
  const where = ['v.isDeleted = 0'];
  const params: unknown[] = [];
  if (query.supplierId) {
    where.push('v.supplierId = ?');
    params.push(query.supplierId);
  }
  if (query.status === 'WAITING') where.push('v.pendingQty > 0');
  if (query.status === 'UNPAID') where.push('v.remaining > 0');
  if (query.search) {
    where.push('(v.invoiceNo LIKE ? COLLATE NOCASE OR v.supplierName LIKE ? COLLATE NOCASE OR v.remark LIKE ? COLLATE NOCASE)');
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(v.total), 0) AS total, COALESCE(SUM(v.paid), 0) AS paid,
              COALESCE(SUM(v.remaining), 0) AS remaining FROM (${INVOICE_FIGURES}) v ${whereSql}`,
    )
    .get(...params) as { n: number; total: number; paid: number; remaining: number };

  const rows = db
    .prepare(`SELECT v.* FROM (${INVOICE_FIGURES}) v ${whereSql} ORDER BY v.invoiceDate DESC, v.createdAt DESC LIMIT ? OFFSET ?`)
    .all(...params, query.pageSize, query.page * query.pageSize) as PurchaseInvoiceRow[];

  return { rows, total: totals.n, totals: { total: totals.total, paid: totals.paid, remaining: totals.remaining } };
}

export function getPurchaseInvoice(id: string, db: Db = getDatabase()): PurchaseInvoiceDetail {
  const invoice = db.prepare(`SELECT v.* FROM (${INVOICE_FIGURES}) v WHERE v.id = ?`).get(id) as
    | PurchaseInvoiceRow
    | undefined;
  if (!invoice) throw errors.notFound('purchase invoice');

  const items = db
    .prepare(
      `SELECT it.id, it.productId, it.newProduct,
              COALESCE(p.name, json_extract(it.newProduct, '$.name')) AS productName,
              COALESCE(p.sku, json_extract(it.newProduct, '$.sku')) AS sku,
              COALESCE(p.barcode, json_extract(it.newProduct, '$.barcode')) AS barcode,
              COALESCE(p.categoryId, json_extract(it.newProduct, '$.categoryId')) AS categoryId,
              COALESCE(br.name, json_extract(it.newProduct, '$.brandName')) AS brandName,
              COALESCE(p.description, json_extract(it.newProduct, '$.description')) AS description,
              COALESCE(it.sellingPrice, json_extract(it.newProduct, '$.sellingPrice'), p.sellingPrice, 0) AS sellingPrice,
              COALESCE(p.isSerialized, 0) AS isSerialized, it.quantity, it.unitCost,
              it.receivedQty, it.refundedQty, it.replacedQty,
              it.quantity - it.receivedQty - it.refundedQty AS pendingQty
         FROM "PurchaseInvoiceItem" it
         LEFT JOIN "Product" p ON p.id = it.productId
         LEFT JOIN "Brand" br ON br.id = p.brandId
        WHERE it.invoiceId = ?
        ORDER BY it.sortOrder`,
    )
    .all(id)
    .map((row) => {
      const r = row as Omit<PurchaseInvoiceItemRow, 'newProduct'> & { newProduct: string | null };
      // Once delivered the line points at the real product; the draft is history.
      return { ...r, newProduct: r.productId || !r.newProduct ? null : (JSON.parse(r.newProduct) as DraftProduct) };
    });

  const payments = db
    .prepare(
      `SELECT sp.id, sp.amount, sp.shopAccountId,
              CASE WHEN sa.id IS NULL THEN NULL ELSE b.name || ' · ' || sa.accountNumber END AS accountLabel,
              sp.paidAt, sp.notes, u.fullName AS createdByName
         FROM "SupplierPayment" sp
         LEFT JOIN "ShopBankAccount" sa ON sa.id = sp.shopAccountId
         LEFT JOIN "BankAccount" b ON b.id = sa.bankAccountId
         LEFT JOIN "User" u ON u.id = sp.createdBy
        WHERE sp.invoiceId = ?
        ORDER BY sp.paidAt DESC, sp.createdAt DESC`,
    )
    .all(id) as SupplierPaymentRow[];

  return { ...invoice, items, payments };
}

function activeInvoice(id: string, db: Db): PurchaseInvoiceDetail {
  const invoice = getPurchaseInvoice(id, db);
  if (invoice.isDeleted) throw errors.invalidState('This purchase invoice has been deleted.');
  return invoice;
}

/** Nothing has arrived, gone back or been replaced: lines can still be rewritten. */
function untouched(invoice: PurchaseInvoiceDetail): boolean {
  return invoice.items.every((i) => i.receivedQty === 0 && i.refundedQty === 0 && i.replacedQty === 0);
}

function assertSupplier(supplierId: string, db: Db): void {
  if (!db.prepare(`SELECT id FROM "Supplier" WHERE id = ?`).get(supplierId)) throw errors.notFound('supplier');
}

/** Same fields in the same order, so a stored draft compares equal to an unchanged one. */
function draftKey(p: NewPurchaseProduct): string {
  return JSON.stringify([
    p.name,
    p.sku,
    p.barcode ?? null,
    p.categoryId ?? null,
    (p.brandName ?? '').toLowerCase(),
    p.sellingPrice,
    p.description ?? null,
  ]);
}

/** New products: SKU and barcode must be free in Stocks and on other undelivered lines; a typed brand is registered. */
function prepareDraft(p: NewPurchaseProduct, invoiceId: string, actor: SessionUser, db: Db): DraftProduct {
  const inStock = (sql: string, value: string) => db.prepare(sql).get(value);
  const onOrder = db.prepare(
    `SELECT json_extract(it.newProduct, '$.sku') AS sku, json_extract(it.newProduct, '$.barcode') AS barcode
       FROM "PurchaseInvoiceItem" it JOIN "PurchaseInvoice" i ON i.id = it.invoiceId
      WHERE it.productId IS NULL AND i.isDeleted = 0 AND it.invoiceId <> ?`,
  ).all(invoiceId) as Array<{ sku: string; barcode: string | null }>;

  if (inStock(`SELECT 1 FROM "Product" WHERE sku = ?`, p.sku) || onOrder.some((o) => o.sku === p.sku)) {
    throw errors.duplicate(`SKU "${p.sku}"`);
  }
  if (p.barcode && (inStock(`SELECT 1 FROM "Product" WHERE barcode = ?`, p.barcode) || onOrder.some((o) => o.barcode === p.barcode))) {
    throw errors.duplicate(`Barcode "${p.barcode}"`);
  }
  if (p.categoryId && !inStock(`SELECT 1 FROM "Category" WHERE id = ?`, p.categoryId)) throw errors.notFound('category');

  let brandId: string | undefined;
  if (p.brandName) {
    const brand = db.prepare(`SELECT id FROM "Brand" WHERE name = ? COLLATE NOCASE`).get(p.brandName) as
      | { id: string }
      | undefined;
    brandId = brand?.id ?? saveBrand({ name: p.brandName, isActive: true }, actor, db).id;
  }
  return { ...p, brandId };
}

function insertItems(invoiceId: string, items: CreatePurchaseInvoiceInput['items'], actor: SessionUser, db: Db): void {
  const insert = db.prepare(
    `INSERT INTO "PurchaseInvoiceItem" (id, invoiceId, productId, newProduct, quantity, unitCost, sellingPrice, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const product = db.prepare(`SELECT id FROM "Product" WHERE id = ?`);
  const skus = new Set<string>();
  items.forEach((item, index) => {
    let draft: DraftProduct | null = null;
    if (item.newProduct) {
      if (skus.has(item.newProduct.sku)) throw errors.validation(`SKU "${item.newProduct.sku}" appears twice on this invoice.`);
      skus.add(item.newProduct.sku);
      draft = prepareDraft(item.newProduct, invoiceId, actor, db);
    } else if (!product.get(item.productId)) {
      throw errors.productGone();
    }
    insert.run(
      newId(),
      invoiceId,
      item.productId ?? null,
      draft && JSON.stringify(draft),
      item.quantity,
      item.unitCost,
      item.sellingPrice ?? draft?.sellingPrice ?? null,
      index,
    );
  });
}

/** PI-YYYYMM-0001, continuing from the highest number used this month. */
function nextInvoiceNo(db: Db): string {
  const now = new Date();
  const prefix = `PI-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const row = db
    .prepare(`SELECT MAX(CAST(substr(invoiceNo, ?) AS INTEGER)) AS n FROM "PurchaseInvoice" WHERE invoiceNo LIKE ? || '%'`)
    .get(prefix.length + 1, prefix) as { n: number | null };
  return `${prefix}${String((row.n ?? 0) + 1).padStart(4, '0')}`;
}

export function createPurchaseInvoice(
  input: CreatePurchaseInvoiceInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): PurchaseInvoiceDetail {
  return transaction(() => {
    assertSupplier(input.supplierId, db);
    const id = newId();
    const now = nowInstant();
    const invoiceNo = input.invoiceNo ?? nextInvoiceNo(db);
    db.prepare(
      `INSERT INTO "PurchaseInvoice" (id, invoiceNo, supplierId, invoiceDate, invoiceDay, paymentMethod,
         remark, isDeleted, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(
      id,
      invoiceNo,
      input.supplierId,
      localDateTimeToInstant(input.invoiceAt),
      localDateTimeToDay(input.invoiceAt),
      input.paymentMethod,
      input.remark ?? null,
      actor.id,
      now,
      now,
    );
    insertItems(id, input.items, actor, db);

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'PurchaseInvoice',
        entityId: id,
        summary: `Purchase invoice ${invoiceNo} — ${input.items.length} product(s)`,
        newValues: input,
      },
      db,
    );
    return getPurchaseInvoice(id, db);
  }, db);
}

/** Header can always change; the lines only until something has arrived. */
export function updatePurchaseInvoice(
  input: UpdatePurchaseInvoiceInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): PurchaseInvoiceDetail {
  return transaction(() => {
    const before = activeInvoice(input.id, db);
    assertSupplier(input.supplierId, db);

    db.prepare(
      `UPDATE "PurchaseInvoice"
          SET invoiceNo = ?, supplierId = ?, invoiceDate = ?, invoiceDay = ?, paymentMethod = ?, remark = ?,
              updatedAt = ?
        WHERE id = ?`,
    ).run(
      input.invoiceNo ?? before.invoiceNo,
      input.supplierId,
      localDateTimeToInstant(input.invoiceAt),
      localDateTimeToDay(input.invoiceAt),
      input.paymentMethod,
      input.remark ?? null,
      nowInstant(),
      input.id,
    );

    const sameLines =
      before.items.length === input.items.length &&
      before.items.every(
        (b, i) =>
          (b.newProduct
            ? Boolean(input.items[i].newProduct) && draftKey(b.newProduct) === draftKey(input.items[i].newProduct!)
            : b.productId === input.items[i].productId) &&
          b.quantity === input.items[i].quantity &&
          b.unitCost === input.items[i].unitCost &&
          b.sellingPrice === (input.items[i].sellingPrice ?? input.items[i].newProduct?.sellingPrice ?? b.sellingPrice),
      );
    if (!sameLines) {
      if (!untouched(before)) {
        throw errors.invalidState('Products have already arrived on this invoice, so its product lines can no longer be changed.');
      }
      db.prepare(`DELETE FROM "PurchaseInvoiceItem" WHERE invoiceId = ?`).run(input.id);
      insertItems(input.id, input.items, actor, db);
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'PurchaseInvoice',
        entityId: input.id,
        summary: `Updated purchase invoice ${input.invoiceNo ?? before.invoiceNo}`,
        oldValues: before,
        newValues: input,
      },
      db,
    );
    return getPurchaseInvoice(input.id, db);
  }, db);
}

/** Soft delete, only while nothing has arrived and nothing is paid. */
export function deletePurchaseInvoice(id: string, reason: string, actor: SessionUser, db: Db = getDatabase()): void {
  transaction(() => {
    const before = getPurchaseInvoice(id, db);
    if (before.isDeleted) return;
    if (!untouched(before) || before.payments.length > 0) {
      throw errors.invalidState('Products have arrived or money was paid on this invoice, so it cannot be deleted.');
    }
    db.prepare(`UPDATE "PurchaseInvoice" SET isDeleted = 1, updatedAt = ? WHERE id = ?`).run(nowInstant(), id);
    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'PurchaseInvoice',
        entityId: id,
        summary: `Deleted purchase invoice ${before.invoiceNo} — ${reason}`,
        oldValues: before,
      },
      db,
    );
  }, db);
}

// -----------------------------------------------------------------------------
// Arrivals, returns and payments
// -----------------------------------------------------------------------------

/** Puts arrived products into stock. Serialized products need one IMEI per unit. */
export function receivePurchaseItems(
  input: ReceivePurchaseItemsInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): PurchaseInvoiceDetail {
  const settings = getShopSettings(db);
  return transaction(() => {
    const invoice = activeInvoice(input.invoiceId, db);
    for (const entry of input.items) {
      const item = invoice.items.find((i) => i.id === entry.itemId);
      if (!item) throw errors.notFound('product line');
      if (entry.quantity > item.pendingQty) {
        throw errors.validation(`Only ${item.pendingQty} of "${item.productName}" are still awaited.`);
      }
      if (!item.productId && item.newProduct) {
        // First arrival of a new product: it joins Stocks now, priced at the invoice cost.
        const p = item.newProduct;
        item.productId = createProduct(
          {
            sku: p.sku,
            barcode: p.barcode,
            name: p.name,
            description: p.description,
            categoryId: p.categoryId,
            brandId: p.brandId,
            purchasePrice: item.unitCost,
            sellingPrice: p.sellingPrice,
            taxRate: 0,
            taxRateOverride: false,
            minimumStock: 0,
            unit: 'pcs',
            isSerialized: false,
            warrantyMonths: 0,
            initialStock: 0,
          },
          actor,
          db,
        ).id;
        db.prepare(`UPDATE "PurchaseInvoiceItem" SET productId = ? WHERE id = ?`).run(item.productId, item.id);
      } else {
        // Prices change between orders: the product takes this invoice's.
        const before = db
          .prepare(`SELECT name, purchasePrice, sellingPrice FROM "Product" WHERE id = ?`)
          .get(item.productId) as { name: string; purchasePrice: number; sellingPrice: number };
        if (before.purchasePrice !== item.unitCost || before.sellingPrice !== item.sellingPrice) {
          db.prepare(
            `UPDATE "Product" SET purchasePrice = ?, sellingPrice = ?, updatedAt = ?, updatedBy = ? WHERE id = ?`,
          ).run(item.unitCost, item.sellingPrice, nowInstant(), actor.id, item.productId);
          recordAudit(
            {
              userId: actor.id,
              action: 'UPDATE',
              entityName: 'Product',
              entityId: item.productId!,
              summary: `Prices for "${before.name}" from purchase invoice ${invoice.invoiceNo}`,
              oldValues: { purchasePrice: before.purchasePrice, sellingPrice: before.sellingPrice },
              newValues: { purchasePrice: item.unitCost, sellingPrice: item.sellingPrice },
            },
            db,
          );
        }
      }

      if (item.isSerialized) {
        const serials = entry.serials ?? [];
        if (serials.length !== entry.quantity) {
          throw errors.validation(`Enter ${entry.quantity} IMEI / serial number(s) for "${item.productName}".`);
        }
        addSerialsInternal(
          item.productId!,
          serials.map((imei1) => ({ imei1 })),
          item.unitCost,
          actor,
          db,
          settings.allowNegativeStock,
          item.id,
        );
      } else {
        applyStockMovement(
          {
            productId: item.productId!,
            quantity: entry.quantity,
            transactionType: 'PURCHASE',
            reason: `Purchase invoice ${invoice.invoiceNo} — ${invoice.supplierName}`,
            createdBy: actor.id,
            unitCost: item.unitCost,
            referenceType: 'PURCHASE',
            referenceId: item.id,
          },
          { allowNegativeStock: settings.allowNegativeStock },
          db,
        );
      }
      db.prepare(`UPDATE "PurchaseInvoiceItem" SET receivedQty = receivedQty + ? WHERE id = ?`).run(
        entry.quantity,
        item.id,
      );
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'ADJUST_STOCK',
        entityName: 'PurchaseInvoice',
        entityId: invoice.id,
        summary: `Received products on purchase invoice ${invoice.invoiceNo}`,
        newValues: input,
      },
      db,
    );
    return getPurchaseInvoice(invoice.id, db);
  }, db);
}

/**
 * Sends damaged units back. They leave stock either way; REFUND means they are
 * no longer owed (and any money given back lands in cash or an account), REPLACE
 * means they are awaited again.
 */
export function returnPurchaseItem(
  input: ReturnPurchaseItemInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): PurchaseInvoiceDetail {
  const settings = getShopSettings(db);
  return transaction(() => {
    const { invoice, item } = lineOf(input.itemId, db);

    if (!input.arrived && input.quantity > item.pendingQty) {
      throw errors.validation(`Only ${item.pendingQty} of "${item.productName}" are still awaited.`);
    }
    if (input.arrived && input.quantity > item.receivedQty) {
      throw errors.validation(`Only ${item.receivedQty} of "${item.productName}" have arrived to send back.`);
    }
    const why = `Returned to ${invoice.supplierName} for ${input.outcome === 'REFUND' ? 'refund' : 'replacement'} — ${input.reason} (${invoice.invoiceNo})`;
    // Units sent back on arrival never entered stock.
    const fromStock = input.arrived ? input.quantity : 0;

    if (!input.arrived) {
      // Nothing to take out of stock.
    } else if (item.isSerialized) {
      const serials = input.serials ?? [];
      if (serials.length !== input.quantity) {
        throw errors.validation(`Enter the ${input.quantity} IMEI / serial number(s) being sent back.`);
      }
      const find = db.prepare(
        `SELECT ps.id, ps.status FROM "ProductSerial" ps
          WHERE ps.productId = ? AND (ps.imei1 = ? OR ps.imei2 = ? OR ps.serialNumber = ?)
            AND EXISTS (SELECT 1 FROM "InventoryTransaction" t
                         WHERE t.productSerialId = ps.id AND t.referenceType = 'PURCHASE' AND t.referenceId = ?)`,
      );
      for (const code of serials) {
        const serial = find.get(item.productId, code, code, code, item.id) as { id: string; status: string } | undefined;
        if (!serial) throw errors.validation(`${code} did not arrive on this invoice line.`);
        if (serial.status !== 'AVAILABLE') throw errors.invalidState(`${code} is not in stock (it may be sold).`);
        db.prepare(`UPDATE "ProductSerial" SET status = 'RETURNED', updatedAt = ? WHERE id = ?`).run(nowInstant(), serial.id);
        applyStockMovement(
          {
            productId: item.productId!,
            quantity: -1,
            transactionType: 'DAMAGE',
            reason: why,
            createdBy: actor.id,
            unitCost: item.unitCost,
            productSerialId: serial.id,
            referenceType: 'PURCHASE',
            referenceId: item.id,
          },
          { allowNegativeStock: settings.allowNegativeStock },
          db,
        );
      }
    } else {
      applyStockMovement(
        {
          productId: item.productId!,
          quantity: -input.quantity,
          transactionType: 'DAMAGE',
          reason: why,
          createdBy: actor.id,
          unitCost: item.unitCost,
          referenceType: 'PURCHASE',
          referenceId: item.id,
        },
        { allowNegativeStock: settings.allowNegativeStock },
        db,
      );
    }

    if (input.outcome === 'REPLACE') {
      db.prepare(
        `UPDATE "PurchaseInvoiceItem" SET receivedQty = receivedQty - ?, replacedQty = replacedQty + ? WHERE id = ?`,
      ).run(fromStock, input.quantity, item.id);
    } else {
      db.prepare(
        `UPDATE "PurchaseInvoiceItem" SET receivedQty = receivedQty - ?, refundedQty = refundedQty + ? WHERE id = ?`,
      ).run(fromStock, input.quantity, item.id);

      if (input.refundAmount > 0) {
        // Cannot get back more than was paid on this invoice.
        if (input.refundAmount > invoice.paid) {
          throw errors.validation('The refund is more than was paid on this invoice.', { refundAmount: 'Too much' });
        }
        insertPayment(invoice.id, -input.refundAmount, input.shopAccountId ?? null, nowInstant(), businessDay(), input.reason, actor, db);
        moveMoney(
          {
            shopAccountId: input.shopAccountId ?? null,
            amount: input.refundAmount,
            source: 'Supplier refund',
            reference: invoice.invoiceNo,
            notes: `${invoice.supplierName} · ${item.productName}`,
          },
          actor,
          db,
        );
      }
    }

    recordAudit(
      {
        userId: actor.id,
        action: input.outcome === 'REFUND' ? 'REFUND' : 'ADJUST_STOCK',
        entityName: 'PurchaseInvoice',
        entityId: invoice.id,
        summary: `${input.quantity} × "${item.productName}" ${why}`,
        newValues: input,
      },
      db,
    );
    return getPurchaseInvoice(invoice.id, db);
  }, db);
}

/** Money paid to the supplier, from cash in hand or a shop account. */
export function paySupplier(input: PaySupplierInput, actor: SessionUser, db: Db = getDatabase()): PurchaseInvoiceDetail {
  return transaction(() => {
    const invoice = activeInvoice(input.invoiceId, db);
    if (input.amount > invoice.remaining) {
      throw errors.validation('That is more than is still owed on this invoice.', { amount: 'More than remaining' });
    }
    insertPayment(
      invoice.id,
      input.amount,
      input.shopAccountId ?? null,
      localDateTimeToInstant(input.paidAt),
      localDateTimeToDay(input.paidAt),
      input.notes ?? null,
      actor,
      db,
    );
    moveMoney(
      {
        shopAccountId: input.shopAccountId ?? null,
        amount: -input.amount,
        source: 'Supplier payment',
        reference: invoice.invoiceNo,
        notes: invoice.supplierName,
      },
      actor,
      db,
    );
    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'SupplierPayment',
        entityId: invoice.id,
        summary: `Paid ${input.amount} to ${invoice.supplierName} on ${invoice.invoiceNo}`,
        newValues: input,
      },
      db,
    );
    return getPurchaseInvoice(invoice.id, db);
  }, db);
}

/** A product line and its (not deleted) invoice. */
function lineOf(itemId: string, db: Db): { invoice: PurchaseInvoiceDetail; item: PurchaseInvoiceItemRow } {
  const row = db.prepare(`SELECT invoiceId FROM "PurchaseInvoiceItem" WHERE id = ?`).get(itemId) as
    | { invoiceId: string }
    | undefined;
  if (!row) throw errors.notFound('product line');
  const invoice = activeInvoice(row.invoiceId, db);
  return { invoice, item: invoice.items.find((i) => i.id === itemId)! };
}

/** Removes a product line nothing has happened to yet. */
export function deletePurchaseItem(itemId: string, reason: string, actor: SessionUser, db: Db = getDatabase()): PurchaseInvoiceDetail {
  return transaction(() => {
    const { invoice, item } = lineOf(itemId, db);
    if (item.receivedQty || item.refundedQty || item.replacedQty) {
      throw errors.invalidState(`"${item.productName}" has already arrived or gone back, so it cannot be removed.`);
    }
    if (invoice.items.length === 1) {
      throw errors.invalidState('This is the only product on the invoice. Delete the invoice instead.');
    }
    db.prepare(`DELETE FROM "PurchaseInvoiceItem" WHERE id = ?`).run(itemId);
    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'PurchaseInvoiceItem',
        entityId: itemId,
        summary: `Removed "${item.productName}" from purchase invoice ${invoice.invoiceNo} — ${reason}`,
        oldValues: item,
      },
      db,
    );
    return getPurchaseInvoice(invoice.id, db);
  }, db);
}

/** Deletes a payment or refund; its money goes back where it came from. */
export function deleteSupplierPayment(paymentId: string, reason: string, actor: SessionUser, db: Db = getDatabase()): PurchaseInvoiceDetail {
  return transaction(() => {
    const payment = db.prepare(`SELECT * FROM "SupplierPayment" WHERE id = ?`).get(paymentId) as
      | { id: string; invoiceId: string; amount: number; shopAccountId: string | null; paidAt: string; notes: string | null }
      | undefined;
    if (!payment) throw errors.notFound('payment');
    const invoice = activeInvoice(payment.invoiceId, db);
    db.prepare(`DELETE FROM "SupplierPayment" WHERE id = ?`).run(paymentId);
    // A payment (positive) comes back in; a refund received (negative) goes back out.
    moveMoney(
      {
        shopAccountId: payment.shopAccountId,
        amount: payment.amount,
        source: 'Reversal',
        reference: invoice.invoiceNo,
        notes: `${payment.amount > 0 ? 'Supplier payment' : 'Supplier refund'} deleted — ${reason}`,
        reversal: true,
      },
      actor,
      db,
    );
    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'SupplierPayment',
        entityId: paymentId,
        summary: `Deleted ${payment.amount > 0 ? 'payment' : 'refund'} of ${Math.abs(payment.amount)} on ${invoice.invoiceNo} — ${reason}`,
        oldValues: payment,
      },
      db,
    );
    return getPurchaseInvoice(invoice.id, db);
  }, db);
}

function insertPayment(
  invoiceId: string,
  amount: number,
  shopAccountId: string | null,
  paidAt: string,
  paidDay: string,
  notes: string | null,
  actor: SessionUser,
  db: Db,
): void {
  db.prepare(
    `INSERT INTO "SupplierPayment" (id, invoiceId, amount, shopAccountId, paidAt, paidDay, notes, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId(), invoiceId, amount, shopAccountId, paidAt, paidDay, notes, actor.id, nowInstant());
}
