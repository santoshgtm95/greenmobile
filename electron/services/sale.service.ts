/**
 * Sales, payments, cancellations and refunds (spec §15–§17, §24, §45, §66, §68).
 *
 * TRUST MODEL
 *
 * The renderer sends product ids, quantities and (optionally) a discount. It
 * does NOT send prices or totals. Every unit price, tax amount and grand total
 * is re-read from the database and recomputed here, so a bug or tampering in
 * the UI cannot change what is charged or what the books say (spec §68).
 *
 * ATOMICITY
 *
 * A sale writes the Sale, its items, its payments, the stock movements, the
 * IMEI status changes and the audit entry inside ONE transaction. If any step
 * fails the whole thing rolls back: there is no such thing as a half-completed
 * sale (spec §66).
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase, transaction } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant, businessDay } from '../../shared/datetime';
import { errors } from '../../shared/errors';
import {
  addMoney,
  multiplyMoney,
  rateOf,
  subtractMoney,
  taxFromInclusive,
  allocateProportionally,
} from '../../shared/money';
import { recordAudit } from './audit.service';
import { nextNumber } from './sequence.service';
import { getShopSettings, effectiveTaxRate } from './settings.service';
import { applyStockMovement, claimSerialForSale, releaseSerial } from './inventory.service';
import { warrantyWindow } from './product.service';
import { WALK_IN_CUSTOMER_NAME } from './customer.service';
import type { SessionUser } from '../session';
import type { PaymentMethod, PaymentStatus, SaleStatus } from '../../shared/domain';
import type { CreateSaleInput, RefundSaleInput, SaleListQuery } from '../../shared/validation';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SaleRow {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  saleDate: string;
  saleDay: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid: number;
  changeAmount: number;
  costTotal: number;
  refundedAmount: number;
  paymentStatus: PaymentStatus;
  status: SaleStatus;
  notes: string | null;
  createdBy: string;
  cashierName: string | null;
  createdAt: string;
}

export interface SaleItemRow {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  returnedQuantity: number;
  serials: string | null;
}

export interface PaymentRow {
  id: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  paymentDate: string;
  notes: string | null;
}

export interface SaleDetail {
  sale: SaleRow;
  items: SaleItemRow[];
  payments: PaymentRow[];
}

/** One priced line, computed entirely from trusted data. */
interface PricedLine {
  productId: string;
  productSerialId: string | null;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  /** Line discount after the basket discount has been allocated. */
  discountAmount: number;
  taxAmount: number;
  /** net + tax */
  totalAmount: number;
  /** unitPrice * quantity, before any discount. */
  grossAmount: number;
  isSerialized: boolean;
  warrantyMonths: number;
  /** Resolved once from the product row, in basis points. */
  taxRate: number;
}

// -----------------------------------------------------------------------------
// Pricing
// -----------------------------------------------------------------------------

interface ProductPricingRow {
  id: string;
  name: string;
  sku: string;
  sellingPrice: number;
  purchasePrice: number;
  taxRate: number;
  taxRateOverride: number;
  isSerialized: number;
  isActive: number;
  warrantyMonths: number;
  stockQuantity: number;
}

/**
 * Recomputes every line and total from the database.
 *
 * Exported so the POS screen can ask for an authoritative quote as the cart
 * changes: the figures on screen are then the same ones that will be committed,
 * rather than a second implementation that might disagree.
 */
export function priceSale(
  input: CreateSaleInput,
  db: Db = getDatabase(),
): {
  lines: PricedLine[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  costTotal: number;
} {
  const settings = getShopSettings(db);

  if (input.items.length === 0) {
    throw errors.validation('Add at least one item to the sale.');
  }

  const productStatement = db.prepare(
    `SELECT id, name, sku, sellingPrice, purchasePrice, taxRate, taxRateOverride,
            isSerialized, isActive, warrantyMonths, stockQuantity
       FROM "Product" WHERE id = ?`,
  );
  const serialStatement = db.prepare(
    `SELECT id, productId, status, purchasePrice, sellingPrice, imei1, serialNumber
       FROM "ProductSerial" WHERE id = ?`,
  );

  const lines: PricedLine[] = [];

  for (const item of input.items) {
    const product = productStatement.get(item.productId) as ProductPricingRow | undefined;
    if (!product) throw errors.productGone();
    if (!product.isActive) {
      throw errors.invalidState(`"${product.name}" is no longer available for sale.`);
    }

    let unitPrice = product.sellingPrice;
    let unitCost = product.purchasePrice;
    let quantity = item.quantity;

    if (product.isSerialized) {
      if (!item.productSerialId) {
        throw errors.validation(`Choose an IMEI or serial number for "${product.name}".`);
      }
      const serial = serialStatement.get(item.productSerialId) as
        | {
            id: string;
            productId: string;
            status: string;
            purchasePrice: number;
            sellingPrice: number | null;
            imei1: string | null;
            serialNumber: string | null;
          }
        | undefined;

      if (!serial || serial.productId !== product.id) {
        throw errors.notFound('serial number');
      }
      if (serial.status !== 'AVAILABLE') {
        throw errors.serialUnavailable(serial.imei1 ?? serial.serialNumber ?? undefined);
      }

      // A specific handset is one unit, priced and costed as itself.
      quantity = 1;
      unitCost = serial.purchasePrice;
      if (serial.sellingPrice !== null) unitPrice = serial.sellingPrice;
    }

    const grossAmount = multiplyMoney(unitPrice, quantity);

    lines.push({
      productId: product.id,
      productSerialId: item.productSerialId ?? null,
      productName: product.name,
      sku: product.sku,
      quantity,
      unitCost,
      unitPrice,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: grossAmount,
      grossAmount,
      isSerialized: product.isSerialized === 1,
      warrantyMonths: product.warrantyMonths,
      taxRate: effectiveTaxRate(
        { taxRate: product.taxRate, taxRateOverride: product.taxRateOverride === 1 },
        settings,
      ),
    });
  }

  const gross = addMoney(...lines.map((l) => l.grossAmount));

  // A basket discount is shared across the lines in proportion to their value,
  // so per-line profit reporting stays honest and the parts sum to the whole.
  const requestedDiscount = Math.min(input.discountAmount ?? 0, gross);
  const allocatedDiscounts = allocateProportionally(
    requestedDiscount,
    lines.map((l) => l.grossAmount),
  );

  let taxTotal = 0;
  let netTotal = 0;

  lines.forEach((line, index) => {
    line.discountAmount = allocatedDiscounts[index];
    const netOfDiscount = subtractMoney(line.grossAmount, line.discountAmount);
    const productRate = line.taxRate;

    if (!settings.taxEnabled || productRate === 0) {
      line.taxAmount = 0;
      line.totalAmount = netOfDiscount;
      netTotal = addMoney(netTotal, netOfDiscount);
      return;
    }

    if (settings.taxMode === 'INCLUSIVE') {
      // The shelf price already contains tax: split it out rather than adding.
      const { net, tax } = taxFromInclusive(netOfDiscount, productRate);
      line.taxAmount = tax;
      line.totalAmount = netOfDiscount;
      netTotal = addMoney(netTotal, net);
      taxTotal = addMoney(taxTotal, tax);
    } else {
      const tax = rateOf(netOfDiscount, productRate);
      line.taxAmount = tax;
      line.totalAmount = addMoney(netOfDiscount, tax);
      netTotal = addMoney(netTotal, netOfDiscount);
      taxTotal = addMoney(taxTotal, tax);
    }
  });

  const grandTotal = addMoney(...lines.map((l) => l.totalAmount));
  const costTotal = addMoney(...lines.map((l) => multiplyMoney(l.unitCost, l.quantity)));

  return {
    lines,
    subtotal: gross,
    discountAmount: requestedDiscount,
    taxAmount: taxTotal,
    grandTotal,
    costTotal,
  };
}

// -----------------------------------------------------------------------------
// Creating a sale
// -----------------------------------------------------------------------------

export function createSale(
  input: CreateSaleInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): SaleDetail {
  const settings = getShopSettings(db);

  return transaction(() => {
    const priced = priceSale(input, db);

    const paidTotal = addMoney(...input.payments.map((p) => p.amount));
    if (paidTotal < 0) throw errors.validation('Payment amounts cannot be negative.');

    // Change is only ever given against cash; card and transfer are taken exactly.
    const cashPaid = addMoney(
      ...input.payments.filter((p) => p.paymentMethod === 'CASH').map((p) => p.amount),
      0,
    );
    const overpaid = Math.max(0, paidTotal - priced.grandTotal);
    if (overpaid > cashPaid) {
      throw errors.validation(
        'Only a cash payment can exceed the total. Check the amounts entered.',
      );
    }
    const changeAmount = overpaid;
    const appliedPaid = subtractMoney(paidTotal, changeAmount);

    let paymentStatus: PaymentStatus = 'UNPAID';
    if (appliedPaid >= priced.grandTotal && priced.grandTotal > 0) paymentStatus = 'PAID';
    else if (appliedPaid > 0) paymentStatus = 'PARTIAL';
    else if (priced.grandTotal === 0) paymentStatus = 'PAID';

    const saleId = newId();
    const invoiceNumber = nextNumber('invoice', db);
    const now = nowInstant();
    const day = businessDay();

    const customer = input.customerId
      ? (db.prepare(`SELECT id, name, phone FROM "Customer" WHERE id = ?`).get(input.customerId) as
          | { id: string; name: string; phone: string | null }
          | undefined)
      : undefined;

    if (input.customerId && !customer) throw errors.notFound('customer');

    db.prepare(
      `INSERT INTO "Sale" (id, invoiceNumber, customerId, customerName, customerPhone,
         saleDate, saleDay, subtotal, discountAmount, taxAmount, grandTotal, amountPaid,
         changeAmount, costTotal, paymentStatus, status, refundedAmount, notes,
         createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 0, ?, ?, ?, ?)`,
    ).run(
      saleId,
      invoiceNumber,
      customer?.id ?? null,
      customer?.name ?? WALK_IN_CUSTOMER_NAME,
      customer?.phone ?? null,
      now,
      day,
      priced.subtotal,
      priced.discountAmount,
      priced.taxAmount,
      priced.grandTotal,
      appliedPaid,
      changeAmount,
      priced.costTotal,
      paymentStatus,
      input.notes ?? null,
      actor.id,
      now,
      now,
    );

    const insertItem = db.prepare(
      `INSERT INTO "SaleItem" (id, saleId, productId, productSerialId, productName, sku,
         unitCost, unitPrice, quantity, discountAmount, taxAmount, totalAmount,
         returnedQuantity, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    );

    for (const line of priced.lines) {
      const itemId = newId();
      insertItem.run(
        itemId,
        saleId,
        line.productId,
        line.productSerialId,
        line.productName,
        line.sku,
        line.unitCost,
        line.unitPrice,
        line.quantity,
        line.discountAmount,
        line.taxAmount,
        line.totalAmount,
        now,
      );

      // Claiming the serial is guarded by status = 'AVAILABLE', so two tills
      // cannot sell the same handset even if they price it at the same moment.
      if (line.productSerialId) {
        claimSerialForSale(
          line.productSerialId,
          itemId,
          warrantyWindow(line.warrantyMonths, now),
          db,
        );
      }

      applyStockMovement(
        {
          productId: line.productId,
          quantity: -line.quantity,
          transactionType: 'SALE',
          reason: `Sold on invoice ${invoiceNumber}`,
          createdBy: actor.id,
          unitCost: line.unitCost,
          productSerialId: line.productSerialId,
          referenceType: 'SALE',
          referenceId: saleId,
        },
        { allowNegativeStock: settings.allowNegativeStock },
        db,
      );
    }

    const insertPayment = db.prepare(
      `INSERT INTO "Payment" (id, saleId, amount, paymentMethod, referenceNumber, paymentDate,
         paymentDay, notes, createdBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const payment of input.payments) {
      if (payment.amount <= 0) continue;
      insertPayment.run(
        newId(),
        saleId,
        payment.amount,
        payment.paymentMethod,
        payment.referenceNumber ?? null,
        now,
        day,
        payment.notes ?? null,
        actor.id,
        now,
      );
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'Sale',
        entityId: saleId,
        summary: `Sale ${invoiceNumber} — ${priced.lines.length} line(s), total ${priced.grandTotal}`,
        newValues: {
          invoiceNumber,
          grandTotal: priced.grandTotal,
          costTotal: priced.costTotal,
          items: priced.lines.map((l) => ({
            sku: l.sku,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        },
      },
      db,
    );

    return getSale(saleId, db);
  }, db);
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

const SALE_SELECT = `
  SELECT s.id, s.invoiceNumber, s.customerId, s.customerName, s.customerPhone, s.saleDate,
         s.saleDay, s.subtotal, s.discountAmount, s.taxAmount, s.grandTotal, s.amountPaid,
         s.changeAmount, s.costTotal, s.refundedAmount, s.paymentStatus, s.status, s.notes,
         s.createdBy, u.fullName AS cashierName, s.createdAt
    FROM "Sale" s
    LEFT JOIN "User" u ON u.id = s.createdBy
`;

export function getSale(id: string, db: Db = getDatabase()): SaleDetail {
  const sale = db.prepare(`${SALE_SELECT} WHERE s.id = ?`).get(id) as SaleRow | undefined;
  if (!sale) throw errors.notFound('sale');

  const items = db
    .prepare(
      `SELECT i.id, i.saleId, i.productId, i.productName, i.sku, i.quantity, i.unitCost,
              i.unitPrice, i.discountAmount, i.taxAmount, i.totalAmount, i.returnedQuantity,
              (SELECT GROUP_CONCAT(COALESCE(ps.imei1, ps.serialNumber), ', ')
                 FROM "ProductSerial" ps WHERE ps.saleItemId = i.id) AS serials
         FROM "SaleItem" i
        WHERE i.saleId = ?
        ORDER BY i.createdAt ASC`,
    )
    .all(id) as SaleItemRow[];

  const payments = db
    .prepare(
      `SELECT id, amount, paymentMethod, referenceNumber, paymentDate, notes
         FROM "Payment" WHERE saleId = ? ORDER BY paymentDate ASC`,
    )
    .all(id) as PaymentRow[];

  return { sale, items, payments };
}

export function listSales(
  query: SaleListQuery,
  db: Db = getDatabase(),
): { rows: SaleRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.from) {
    where.push('s.saleDay >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('s.saleDay <= ?');
    params.push(query.to);
  }
  if (query.status) {
    where.push('s.status = ?');
    params.push(query.status);
  }
  if (query.cashierId) {
    where.push('s.createdBy = ?');
    params.push(query.cashierId);
  }
  if (query.customerId) {
    where.push('s.customerId = ?');
    params.push(query.customerId);
  }
  if (query.paymentMethod) {
    where.push('EXISTS (SELECT 1 FROM "Payment" p WHERE p.saleId = s.id AND p.paymentMethod = ?)');
    params.push(query.paymentMethod);
  }
  if (query.search) {
    where.push(
      `(s.invoiceNumber LIKE ? COLLATE NOCASE
        OR s.customerName LIKE ? COLLATE NOCASE
        OR s.customerPhone LIKE ?)`,
    );
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM "Sale" s ${whereSql}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`${SALE_SELECT} ${whereSql} ORDER BY s.saleDate DESC LIMIT ? OFFSET ?`)
    .all(...params, query.pageSize, query.page * query.pageSize) as SaleRow[];

  return { rows, total };
}

// -----------------------------------------------------------------------------
// Cancelling and refunding
// -----------------------------------------------------------------------------

/**
 * Cancels a sale outright: all stock returns, every serial goes back to
 * AVAILABLE, and the sale stops counting as revenue.
 */
export function cancelSale(
  saleId: string,
  reason: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): SaleDetail {
  const settings = getShopSettings(db);

  return transaction(() => {
    const { sale, items } = getSale(saleId, db);

    if (sale.status === 'CANCELLED') throw errors.invalidState('This sale is already cancelled.');
    if (sale.status !== 'COMPLETED') {
      throw errors.invalidState('This sale has already been refunded and cannot be cancelled.');
    }

    for (const item of items) {
      const remaining = item.quantity - item.returnedQuantity;
      if (remaining > 0) {
        applyStockMovement(
          {
            productId: item.productId,
            quantity: remaining,
            transactionType: 'SALE_RETURN',
            reason: `Cancelled invoice ${sale.invoiceNumber} — ${reason}`,
            createdBy: actor.id,
            unitCost: item.unitCost,
            referenceType: 'SALE',
            referenceId: saleId,
            allowNegative: true,
          },
          { allowNegativeStock: settings.allowNegativeStock },
          db,
        );
      }

      const serials = db
        .prepare(`SELECT id FROM "ProductSerial" WHERE saleItemId = ?`)
        .all(item.id) as { id: string }[];
      for (const serial of serials) releaseSerial(serial.id, 'AVAILABLE', db);
    }

    db.prepare(
      `UPDATE "Sale" SET status = 'CANCELLED', notes = COALESCE(notes || ' | ', '') || ?, updatedAt = ?
        WHERE id = ?`,
    ).run(`Cancelled: ${reason}`, nowInstant(), saleId);

    recordAudit(
      {
        userId: actor.id,
        action: 'CANCEL',
        entityName: 'Sale',
        entityId: saleId,
        summary: `Cancelled sale ${sale.invoiceNumber} — ${reason}`,
        oldValues: { status: sale.status },
        newValues: { status: 'CANCELLED', reason },
      },
      db,
    );

    return getSale(saleId, db);
  }, db);
}

/**
 * Refunds selected lines (spec §45).
 *
 * Restores stock, returns each serial to RETURNED (or DEFECTIVE when the unit
 * came back broken), writes the SaleReturn and its items, and moves the sale to
 * REFUNDED or PARTIALLY_REFUNDED — all in one transaction.
 */
export function refundSale(
  input: RefundSaleInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): { sale: SaleDetail; returnNumber: string; refundAmount: number } {
  const settings = getShopSettings(db);

  return transaction(() => {
    const { sale, items } = getSale(input.saleId, db);

    if (sale.status === 'CANCELLED') {
      throw errors.invalidState('This sale was cancelled and cannot be refunded.');
    }
    if (sale.status === 'REFUNDED') {
      throw errors.invalidState('This sale has already been fully refunded.');
    }
    if (input.items.length === 0) {
      throw errors.validation('Select at least one item to refund.');
    }

    const itemsById = new Map(items.map((i) => [i.id, i]));
    const returnId = newId();
    const returnNumber = nextNumber('return', db);
    const now = nowInstant();
    const day = businessDay();

    let refundTotal = 0;

    // The header goes in first so its items have a parent to reference; the
    // total is filled in once every line has been priced.
    db.prepare(
      `INSERT INTO "SaleReturn" (id, returnNumber, saleId, customerId, returnDate, returnDay,
         reason, refundAmount, refundMethod, status, notes, createdBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'COMPLETED', ?, ?, ?)`,
    ).run(
      returnId,
      returnNumber,
      sale.id,
      sale.customerId,
      now,
      day,
      input.reason,
      input.refundMethod,
      input.notes ?? null,
      actor.id,
      now,
    );

    const insertReturnItem = db.prepare(
      `INSERT INTO "SaleReturnItem" (id, returnId, saleItemId, productId, productSerialId,
         quantity, refundAmount, unitCost, isDefective)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const requested of input.items) {
      const item = itemsById.get(requested.saleItemId);
      if (!item) throw errors.notFound('sale item');

      const refundable = item.quantity - item.returnedQuantity;
      if (requested.quantity > refundable) {
        throw errors.validation(
          `Only ${refundable} of "${item.productName}" can still be returned.`,
        );
      }

      // Refund what was actually charged for those units, discount and tax
      // included, rather than today's price.
      const perUnit = Math.round(item.totalAmount / item.quantity);
      const lineRefund = requested.quantity === item.quantity - item.returnedQuantity
        ? subtractMoney(item.totalAmount, multiplyMoney(perUnit, item.returnedQuantity))
        : multiplyMoney(perUnit, requested.quantity);

      refundTotal = addMoney(refundTotal, lineRefund);

      const serials = db
        .prepare(`SELECT id FROM "ProductSerial" WHERE saleItemId = ? LIMIT ?`)
        .all(item.id, requested.quantity) as { id: string }[];

      insertReturnItem.run(
        newId(),
        returnId,
        item.id,
        item.productId,
        serials[0]?.id ?? null,
        requested.quantity,
        lineRefund,
        item.unitCost,
        requested.isDefective ? 1 : 0,
      );

      for (const serial of serials) {
        releaseSerial(serial.id, requested.isDefective ? 'DEFECTIVE' : 'RETURNED', db);
      }

      // The goods come back in either way, so the return is always recorded.
      applyStockMovement(
        {
          productId: item.productId,
          quantity: requested.quantity,
          transactionType: 'SALE_RETURN',
          reason: `Refund ${returnNumber} against invoice ${sale.invoiceNumber}`,
          createdBy: actor.id,
          unitCost: item.unitCost,
          productSerialId: serials[0]?.id ?? null,
          referenceType: 'SALE_RETURN',
          referenceId: returnId,
          allowNegative: true,
        },
        { allowNegativeStock: settings.allowNegativeStock },
        db,
      );

      // Faulty goods are then written straight back off, so the ledger shows
      // both facts — it came back, and it is not sellable — rather than hiding
      // the write-off inside the return.
      if (requested.isDefective) {
        applyStockMovement(
          {
            productId: item.productId,
            quantity: -requested.quantity,
            transactionType: 'DAMAGE',
            reason: `Returned faulty on ${returnNumber}`,
            createdBy: actor.id,
            unitCost: item.unitCost,
            productSerialId: serials[0]?.id ?? null,
            referenceType: 'SALE_RETURN',
            referenceId: returnId,
            allowNegative: true,
          },
          { allowNegativeStock: settings.allowNegativeStock },
          db,
        );
      }

      db.prepare(`UPDATE "SaleItem" SET returnedQuantity = returnedQuantity + ? WHERE id = ?`).run(
        requested.quantity,
        item.id,
      );
    }

    db.prepare(`UPDATE "SaleReturn" SET refundAmount = ? WHERE id = ?`).run(refundTotal, returnId);

    const refundedTotal = addMoney(sale.refundedAmount, refundTotal);
    const fullyReturned = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM "SaleItem" WHERE saleId = ? AND returnedQuantity < quantity`,
        )
        .get(sale.id) as { n: number }
    ).n === 0;

    db.prepare(`UPDATE "Sale" SET refundedAmount = ?, status = ?, updatedAt = ? WHERE id = ?`).run(
      refundedTotal,
      fullyReturned ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      nowInstant(),
      sale.id,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'REFUND',
        entityName: 'Sale',
        entityId: sale.id,
        summary: `Refund ${returnNumber} on invoice ${sale.invoiceNumber} — ${refundTotal} (${input.reason})`,
        oldValues: { status: sale.status, refundedAmount: sale.refundedAmount },
        newValues: {
          status: fullyReturned ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          refundedAmount: refundedTotal,
          returnNumber,
        },
      },
      db,
    );

    return { sale: getSale(sale.id, db), returnNumber, refundAmount: refundTotal };
  }, db);
}
