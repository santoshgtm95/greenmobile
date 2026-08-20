/**
 * The three acceptance tests the specification names explicitly:
 *
 *   §80  profit maths      — revenue, COGS, gross profit, stock, net profit
 *   §81  IMEI              — a handset cannot be sold twice
 *   §82  refund            — stock restored, IMEI returned, records written
 *
 * plus the surrounding rules: stock blocking, price trust, tax modes,
 * discount allocation and transactional atomicity.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import { createProduct, adjustStock, addSerials, getProduct } from '../electron/services/product.service';
import { createCustomer } from '../electron/services/customer.service';
import { createSale, cancelSale, refundSale, priceSale, getSale } from '../electron/services/sale.service';
import { setSettings } from '../electron/services/settings.service';
import { listSerials, findSerialByCode } from '../electron/services/inventory.service';
import { AppError } from '../shared/errors';
import type { FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let actor: SessionUser;

const SETUP: FirstRunSetupInput = {
  shopName: 'Green Mobile',
  shopAddress: '',
  shopPhone: undefined,
  shopEmail: undefined,
  fullName: 'Owner',
  username: 'owner',
  password: 'owner-pass',
  confirmPassword: 'owner-pass',
  currency: 'THB',
  taxEnabled: false,
  taxRate: 0,
  taxMode: 'EXCLUSIVE',
  receiptWidth: '80mm',
  backupLocation: undefined,
};

beforeEach(() => {
  ctx = createTestDatabase();
  setSessionUser(null);
  completeFirstRunSetup(SETUP, ctx.db);
  actor = getSessionUser()!;
});

afterEach(() => {
  setSessionUser(null);
  ctx.cleanup();
});

/** A simple non-serialized product: cost 800.00, price 1,000.00, stock 10. */
function makeSimpleProduct(overrides: Partial<{ stock: number; cost: number; price: number }> = {}) {
  const product = createProduct(
    {
      sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
      barcode: undefined,
      name: 'USB-C Cable',
      description: undefined,
      categoryId: undefined,
      brandId: undefined,
      purchasePrice: overrides.cost ?? 80_000,
      sellingPrice: overrides.price ?? 100_000,
      taxRate: 0,
      taxRateOverride: false,
      minimumStock: 0,
      unit: 'pcs',
      isSerialized: false,
      warrantyMonths: 0,
      initialStock: overrides.stock ?? 10,
      serials: undefined,
    },
    actor,
    ctx.db,
  );
  return product;
}

/** A serialized phone with one IMEI. */
function makePhone(imei = '123456789') {
  const product = createProduct(
    {
      sku: `PHONE-${Math.random().toString(36).slice(2, 8)}`,
      barcode: undefined,
      name: 'iPhone 15',
      description: undefined,
      categoryId: undefined,
      brandId: undefined,
      purchasePrice: 2_500_000,
      sellingPrice: 3_000_000,
      taxRate: 0,
      taxRateOverride: false,
      minimumStock: 0,
      unit: 'pcs',
      isSerialized: true,
      warrantyMonths: 12,
      initialStock: 0,
      serials: [{ imei1: imei, purchasePrice: 2_500_000 }],
    },
    actor,
    ctx.db,
  );
  const serial = listSerials(product.id, 'AVAILABLE', ctx.db)[0];
  return { product, serial };
}

// -----------------------------------------------------------------------------

describe('spec §80 — profit maths', () => {
  it('computes revenue, COGS, gross profit and stock exactly as specified', () => {
    // Purchase 800, selling 1,000, stock 10; sell 2.
    const product = makeSimpleProduct({ cost: 80_000, price: 100_000, stock: 10 });

    const { sale, items } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 2, productSerialId: undefined }],
        discountAmount: 0,
        payments: [{ amount: 200_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined }],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    // Revenue 2,000
    expect(sale.grandTotal).toBe(200_000);
    // COGS 1,600
    expect(sale.costTotal).toBe(160_000);
    // Gross profit 400
    expect(sale.grandTotal - sale.costTotal).toBe(40_000);
    // Stock 8
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(8);

    expect(items).toHaveLength(1);
    expect(items[0].unitCost).toBe(80_000);
    expect(items[0].unitPrice).toBe(100_000);
    expect(sale.paymentStatus).toBe('PAID');
    expect(sale.changeAmount).toBe(0);
  });

  it('freezes the historical unit cost so a later price change cannot rewrite profit', () => {
    const product = makeSimpleProduct({ cost: 80_000, price: 100_000, stock: 10 });

    const { sale } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 2, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    // The supplier puts the price up afterwards.
    ctx.db.prepare(`UPDATE "Product" SET purchasePrice = 95000 WHERE id = ?`).run(product.id);

    const reread = getSale(sale.id, ctx.db);
    expect(reread.items[0].unitCost).toBe(80_000);
    expect(reread.sale.costTotal).toBe(160_000);
  });

  it('gives change for cash overpayment without inflating revenue', () => {
    const product = makeSimpleProduct({ cost: 80_000, price: 100_000, stock: 10 });

    const { sale } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [{ amount: 150_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined }],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    expect(sale.grandTotal).toBe(100_000);
    expect(sale.changeAmount).toBe(50_000);
    expect(sale.amountPaid).toBe(100_000);
    expect(sale.paymentStatus).toBe('PAID');
  });

  it('records a partial payment as PARTIAL', () => {
    const product = makeSimpleProduct();
    const { sale } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [{ amount: 40_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined }],
        notes: undefined,
      },
      actor,
      ctx.db,
    );
    expect(sale.paymentStatus).toBe('PARTIAL');
    expect(sale.amountPaid).toBe(40_000);
  });

  it('refuses a non-cash overpayment', () => {
    const product = makeSimpleProduct();
    expect(() =>
      createSale(
        {
          customerId: undefined,
          items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
          discountAmount: 0,
          payments: [
            { amount: 150_000, paymentMethod: 'BANK_TRANSFER', referenceNumber: 'X1', notes: undefined },
          ],
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    ).toThrow(AppError);
  });

  it('accepts split payments across methods (spec §17)', () => {
    const product = makeSimpleProduct({ price: 1_500_000, stock: 5 });
    const { sale, payments } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [
          { amount: 500_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
          { amount: 1_000_000, paymentMethod: 'BANK_TRANSFER', referenceNumber: 'TRX-9', notes: undefined },
        ],
        notes: undefined,
      },
      actor,
      ctx.db,
    );
    expect(payments).toHaveLength(2);
    expect(sale.amountPaid).toBe(1_500_000);
    expect(sale.paymentStatus).toBe('PAID');
  });
});

describe('spec §81 — IMEI cannot be sold twice', () => {
  it('marks the IMEI SOLD and blocks a second sale', () => {
    const { product, serial } = makePhone('123456789');
    expect(serial.status).toBe('AVAILABLE');
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(1);

    createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: serial.id }],
        discountAmount: 0,
        payments: [{ amount: 3_000_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined }],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    expect(findSerialByCode('123456789', ctx.db)?.status).toBe('SOLD');
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(0);

    // Selling it again must be blocked, with a message naming the IMEI.
    let error: AppError | null = null;
    try {
      createSale(
        {
          customerId: undefined,
          items: [{ productId: product.id, quantity: 1, productSerialId: serial.id }],
          discountAmount: 0,
          payments: [],
          notes: undefined,
        },
        actor,
        ctx.db,
      );
    } catch (err) {
      error = err as AppError;
    }

    expect(error).toBeInstanceOf(AppError);
    expect(error!.code).toBe('SERIAL_UNAVAILABLE');
    expect(error!.message).toMatch(/123456789 is already sold/i);
  });

  it('sets the warranty window from the product warranty months', () => {
    const { product, serial } = makePhone('900000001');
    createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: serial.id }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    const sold = findSerialByCode('900000001', ctx.db)!;
    expect(sold.warrantyStartDate).toBeTruthy();
    expect(sold.warrantyEndDate).toBeTruthy();
    const months =
      (new Date(sold.warrantyEndDate!).getFullYear() - new Date(sold.warrantyStartDate!).getFullYear()) * 12 +
      (new Date(sold.warrantyEndDate!).getMonth() - new Date(sold.warrantyStartDate!).getMonth());
    expect(months).toBe(12);
  });

  it('requires an IMEI to be chosen for a serialized product', () => {
    const { product } = makePhone('900000002');
    expect(() =>
      createSale(
        {
          customerId: undefined,
          items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
          discountAmount: 0,
          payments: [],
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    ).toThrow(/IMEI or serial/i);
  });

  it('rejects a duplicate IMEI at entry', () => {
    const { product } = makePhone('555000111');
    expect(() =>
      addSerials({ productId: product.id, serials: [{ imei1: '555000111' }] }, actor, ctx.db),
    ).toThrow(AppError);
  });

  it('will not sell a defective unit', () => {
    const { product, serial } = makePhone('900000003');
    ctx.db.prepare(`UPDATE "ProductSerial" SET status='DEFECTIVE' WHERE id = ?`).run(serial.id);

    expect(() =>
      createSale(
        {
          customerId: undefined,
          items: [{ productId: product.id, quantity: 1, productSerialId: serial.id }],
          discountAmount: 0,
          payments: [],
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    ).toThrow(/already sold|IMEI/i);
  });
});

describe('spec §82 — refunds', () => {
  it('restores stock, returns the IMEI, and writes the refund records', () => {
    const { product, serial } = makePhone('777000111');

    const { sale, items } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: serial.id }],
        discountAmount: 0,
        payments: [{ amount: 3_000_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined }],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(0);

    const result = refundSale(
      {
        saleId: sale.id,
        items: [{ saleItemId: items[0].id, quantity: 1, isDefective: false }],
        reason: 'Customer changed their mind',
        refundMethod: 'CASH',
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    // Stock +1
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(1);
    // IMEI = RETURNED
    expect(findSerialByCode('777000111', ctx.db)?.status).toBe('RETURNED');
    // Sale = REFUNDED
    expect(result.sale.sale.status).toBe('REFUNDED');
    expect(result.sale.sale.refundedAmount).toBe(3_000_000);
    // Refund record created
    const returns = ctx.db.prepare(`SELECT * FROM "SaleReturn"`).all() as unknown[];
    expect(returns).toHaveLength(1);
    // Inventory transaction created
    const movement = ctx.db
      .prepare(`SELECT COUNT(*) n FROM "InventoryTransaction" WHERE transactionType='SALE_RETURN'`)
      .get() as { n: number };
    expect(movement.n).toBe(1);
  });

  it('marks a partially refunded sale PARTIALLY_REFUNDED and refunds only that share', () => {
    const product = makeSimpleProduct({ cost: 80_000, price: 100_000, stock: 10 });
    const { sale, items } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 4, productSerialId: undefined }],
        discountAmount: 0,
        payments: [{ amount: 400_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined }],
        notes: undefined,
      },
      actor,
      ctx.db,
    );
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(6);

    const result = refundSale(
      {
        saleId: sale.id,
        items: [{ saleItemId: items[0].id, quantity: 1, isDefective: false }],
        reason: 'One faulty cable',
        refundMethod: 'CASH',
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    expect(result.refundAmount).toBe(100_000);
    expect(result.sale.sale.status).toBe('PARTIALLY_REFUNDED');
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(7);
  });

  it('does not return faulty goods to sellable stock', () => {
    const product = makeSimpleProduct({ stock: 5 });
    const { sale, items } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(4);

    refundSale(
      {
        saleId: sale.id,
        items: [{ saleItemId: items[0].id, quantity: 1, isDefective: true }],
        reason: 'Dead on arrival',
        refundMethod: 'CASH',
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    // Came back, then written off: net stock unchanged, both facts in the ledger.
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(4);
    const damage = ctx.db
      .prepare(`SELECT COUNT(*) n FROM "InventoryTransaction" WHERE transactionType='DAMAGE'`)
      .get() as { n: number };
    expect(damage.n).toBe(1);
  });

  it('refuses to refund more than was sold', () => {
    const product = makeSimpleProduct({ stock: 5 });
    const { sale, items } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    expect(() =>
      refundSale(
        {
          saleId: sale.id,
          items: [{ saleItemId: items[0].id, quantity: 5, isDefective: false }],
          reason: 'Trying it on',
          refundMethod: 'CASH',
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    ).toThrow(/Only 1 .* can still be returned/i);
  });

  it('cancelling a sale returns all stock and frees the IMEI', () => {
    const { product, serial } = makePhone('888000111');
    const { sale } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: serial.id }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    const cancelled = cancelSale(sale.id, 'Entered by mistake', actor, ctx.db);
    expect(cancelled.sale.status).toBe('CANCELLED');
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(1);
    expect(findSerialByCode('888000111', ctx.db)?.status).toBe('AVAILABLE');
  });

  it('will not cancel an already-refunded sale', () => {
    const product = makeSimpleProduct({ stock: 3 });
    const { sale, items } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );
    refundSale(
      {
        saleId: sale.id,
        items: [{ saleItemId: items[0].id, quantity: 1, isDefective: false }],
        reason: 'Returned',
        refundMethod: 'CASH',
        notes: undefined,
      },
      actor,
      ctx.db,
    );
    expect(() => cancelSale(sale.id, 'too late', actor, ctx.db)).toThrow(AppError);
  });
});

describe('stock rules (spec §67)', () => {
  it('blocks a sale that would take stock negative', () => {
    const product = makeSimpleProduct({ stock: 1 });
    let error: AppError | null = null;
    try {
      createSale(
        {
          customerId: undefined,
          items: [{ productId: product.id, quantity: 5, productSerialId: undefined }],
          discountAmount: 0,
          payments: [],
          notes: undefined,
        },
        actor,
        ctx.db,
      );
    } catch (err) {
      error = err as AppError;
    }
    expect(error?.code).toBe('INSUFFICIENT_STOCK');
    expect(error?.message).toMatch(/Insufficient stock/i);
    // Nothing partially committed.
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(1);
    expect((ctx.db.prepare(`SELECT COUNT(*) n FROM "Sale"`).get() as { n: number }).n).toBe(0);
  });

  it('allows negative stock when the shop has opted in', () => {
    setSettings({ allowNegativeStock: 'true' }, actor.id, ctx.db);
    const product = makeSimpleProduct({ stock: 1 });

    const { sale } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 3, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    expect(sale.status).toBe('COMPLETED');
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(-2);
  });

  it('records every stock change in the ledger with a reason', () => {
    const product = makeSimpleProduct({ stock: 10 });
    adjustStock(
      {
        productId: product.id,
        mode: 'SET',
        quantity: 8,
        transactionType: 'ADJUSTMENT',
        reason: 'Stock count — two missing',
        unitCost: undefined,
      },
      actor,
      ctx.db,
    );

    const rows = ctx.db
      .prepare(
        `SELECT transactionType, quantity, previousStock, newStock, reason
           FROM "InventoryTransaction" WHERE productId = ? ORDER BY createdAt ASC`,
      )
      .all(product.id) as Array<{
      transactionType: string;
      quantity: number;
      previousStock: number;
      newStock: number;
      reason: string;
    }>;

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ transactionType: 'PURCHASE', quantity: 10, newStock: 10 });
    expect(rows[1]).toMatchObject({
      transactionType: 'ADJUSTMENT',
      quantity: -2,
      previousStock: 10,
      newStock: 8,
      reason: 'Stock count — two missing',
    });
    expect(getProduct(product.id, ctx.db).stockQuantity).toBe(8);
  });
});

describe('price trust (spec §68)', () => {
  it('prices from the database, ignoring anything the caller might claim', () => {
    const product = makeSimpleProduct({ cost: 80_000, price: 100_000, stock: 10 });

    // The payload has no price field at all — the schema does not accept one.
    const quote = priceSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 3, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      ctx.db,
    );

    expect(quote.grandTotal).toBe(300_000);
    expect(quote.costTotal).toBe(240_000);
  });

  it('refuses to sell a deactivated product', () => {
    const product = makeSimpleProduct();
    ctx.db.prepare(`UPDATE "Product" SET isActive = 0 WHERE id = ?`).run(product.id);
    expect(() =>
      priceSale(
        {
          customerId: undefined,
          items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
          discountAmount: 0,
          payments: [],
          notes: undefined,
        },
        ctx.db,
      ),
    ).toThrow(/no longer available/i);
  });
});

describe('tax and discounts (spec §60)', () => {
  it('adds exclusive tax on top of the price', () => {
    setSettings({ taxEnabled: 'true', taxRate: '700', taxMode: 'EXCLUSIVE' }, actor.id, ctx.db);
    const product = makeSimpleProduct({ price: 100_000, stock: 10 });

    const quote = priceSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      ctx.db,
    );

    expect(quote.subtotal).toBe(100_000);
    expect(quote.taxAmount).toBe(7_000);
    expect(quote.grandTotal).toBe(107_000);
  });

  it('extracts inclusive tax without changing what the customer pays', () => {
    setSettings({ taxEnabled: 'true', taxRate: '700', taxMode: 'INCLUSIVE' }, actor.id, ctx.db);
    const product = makeSimpleProduct({ price: 107_000, stock: 10 });

    const quote = priceSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      ctx.db,
    );

    expect(quote.grandTotal).toBe(107_000);
    expect(quote.taxAmount).toBe(7_000);
  });

  it('charges no tax when tax is switched off', () => {
    const product = makeSimpleProduct({ price: 100_000, stock: 10 });
    const quote = priceSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      ctx.db,
    );
    expect(quote.taxAmount).toBe(0);
    expect(quote.grandTotal).toBe(100_000);
  });

  it('spreads a basket discount across lines so the parts sum to the whole', () => {
    const a = makeSimpleProduct({ price: 30_000, stock: 10 });
    const b = makeSimpleProduct({ price: 70_000, stock: 10 });

    const quote = priceSale(
      {
        customerId: undefined,
        items: [
          { productId: a.id, quantity: 1, productSerialId: undefined },
          { productId: b.id, quantity: 1, productSerialId: undefined },
        ],
        discountAmount: 10_000,
        payments: [],
        notes: undefined,
      },
      ctx.db,
    );

    expect(quote.subtotal).toBe(100_000);
    expect(quote.grandTotal).toBe(90_000);
    const allocated = quote.lines.map((l) => l.discountAmount);
    expect(allocated.reduce((x, y) => x + y, 0)).toBe(10_000);
    expect(allocated).toEqual([3_000, 7_000]);
  });

  it('never discounts below zero', () => {
    const product = makeSimpleProduct({ price: 50_000, stock: 10 });
    const quote = priceSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 999_999,
        payments: [],
        notes: undefined,
      },
      ctx.db,
    );
    expect(quote.grandTotal).toBe(0);
    expect(quote.discountAmount).toBe(50_000);
  });
});

describe('atomicity (spec §66)', () => {
  it('writes nothing at all when one line of a multi-line sale fails', () => {
    const good = makeSimpleProduct({ stock: 10 });
    const short = makeSimpleProduct({ stock: 1 });

    expect(() =>
      createSale(
        {
          customerId: undefined,
          items: [
            { productId: good.id, quantity: 1, productSerialId: undefined },
            { productId: short.id, quantity: 5, productSerialId: undefined },
          ],
          discountAmount: 0,
          payments: [{ amount: 100_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined }],
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    ).toThrow(AppError);

    expect((ctx.db.prepare(`SELECT COUNT(*) n FROM "Sale"`).get() as { n: number }).n).toBe(0);
    expect((ctx.db.prepare(`SELECT COUNT(*) n FROM "SaleItem"`).get() as { n: number }).n).toBe(0);
    expect((ctx.db.prepare(`SELECT COUNT(*) n FROM "Payment"`).get() as { n: number }).n).toBe(0);
    // The first line's stock was not quietly taken.
    expect(getProduct(good.id, ctx.db).stockQuantity).toBe(10);
  });

  it('does not consume an invoice number when the sale is rolled back', () => {
    const good = makeSimpleProduct({ stock: 10 });
    const short = makeSimpleProduct({ stock: 0 });

    const before = ctx.db.prepare(`SELECT value FROM "Setting" WHERE key='invoiceNumber'`).get() as {
      value: string;
    };

    expect(() =>
      createSale(
        {
          customerId: undefined,
          items: [
            { productId: good.id, quantity: 1, productSerialId: undefined },
            { productId: short.id, quantity: 1, productSerialId: undefined },
          ],
          discountAmount: 0,
          payments: [],
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    ).toThrow(AppError);

    const after = ctx.db.prepare(`SELECT value FROM "Setting" WHERE key='invoiceNumber'`).get() as {
      value: string;
    };
    expect(after.value).toBe(before.value);
  });

  it('issues sequential invoice numbers', () => {
    const product = makeSimpleProduct({ stock: 10 });
    const first = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );
    const second = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    expect(first.sale.invoiceNumber).toMatch(/^INV-\d{6}-0001$/);
    expect(second.sale.invoiceNumber).toMatch(/^INV-\d{6}-0002$/);
  });
});

describe('customer on a sale (spec §35)', () => {
  it('defaults to a walk-in customer when none is chosen', () => {
    const product = makeSimpleProduct();
    const { sale } = createSale(
      {
        customerId: undefined,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );
    expect(sale.customerId).toBeNull();
    expect(sale.customerName).toBe('Walk-in Customer');
  });

  it('snapshots the customer name and phone onto the sale', () => {
    const customer = createCustomer(
      { name: 'Nok', phone: '0812345678', email: undefined, address: undefined, notes: undefined },
      actor,
      ctx.db,
    );
    const product = makeSimpleProduct();

    const { sale } = createSale(
      {
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [],
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    expect(sale.customerName).toBe('Nok');
    expect(sale.customerPhone).toBe('0812345678');

    // Renaming the customer must not rewrite the historical invoice.
    ctx.db.prepare(`UPDATE "Customer" SET name='Nok Somchai' WHERE id = ?`).run(customer.id);
    expect(getSale(sale.id, ctx.db).sale.customerName).toBe('Nok');
  });
});
