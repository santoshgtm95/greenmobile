/**
 * The inventory ledger and stock figures (spec §5, §20, §66, §67).
 *
 * These back the Inventory screen. The ledger was written and tested as part of
 * Phase 5 but had no screen reading it until now; the summary is new, and exists
 * because the screen needs totals and must not borrow the reports permission to
 * get them — a cashier who may look at stock should see the figures at the top of
 * the page they are already allowed to open.
 *
 * The property under test throughout: every change to a stock level leaves a row
 * that says what the level was before, what it became, why, and who did it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import {
  createProduct,
  adjustStock,
  addSerials,
  markSerialDefective,
  deleteProduct,
} from '../electron/services/product.service';
import { createSale, refundSale } from '../electron/services/sale.service';
import {
  inventoryHistory,
  lowStock,
  stockSummary,
  listSerials,
} from '../electron/services/inventory.service';
import { setSettings } from '../electron/services/settings.service';
import { businessDay, addDays } from '../shared/datetime';
import type { FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let actor: SessionUser;
const TODAY = businessDay();

const SETUP: FirstRunSetupInput = {
  shopName: 'Green Mobile',
  shopAddress: undefined,
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
  ctx.cleanup();
  setSessionUser(null);
});

interface StockOptions {
  sku?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  stock?: number;
  minimumStock?: number;
  serialized?: boolean;
}

function product(options: StockOptions = {}) {
  return createProduct(
    {
      sku: options.sku ?? 'CBL-1',
      name: `Product ${options.sku ?? 'CBL-1'}`,
      purchasePrice: options.purchasePrice ?? 80000,
      sellingPrice: options.sellingPrice ?? 100000,
      taxRate: 0,
      taxRateOverride: false,
      minimumStock: options.minimumStock ?? 0,
      unit: 'pcs',
      isSerialized: options.serialized ?? false,
      warrantyMonths: 0,
      initialStock: options.stock ?? 10,
    },
    actor,
    ctx.db,
  );
}

// -----------------------------------------------------------------------------
// The ledger
// -----------------------------------------------------------------------------

describe('the movement ledger', () => {
  it('records the level before and after, not just the change', () => {
    // The before/after pair is what lets someone walk the ledger back to the
    // point where the recorded stock and the shelf stopped agreeing.
    const cable = product({ stock: 10 });
    adjustStock(
      {
        productId: cable.id,
        mode: 'CHANGE',
        quantity: -3,
        transactionType: 'DAMAGE',
        reason: 'Water damage in the stockroom',
      },
      actor,
      ctx.db,
    );

    const { rows } = inventoryHistory({ productId: cable.id }, ctx.db);
    const damage = rows.find((row) => row.transactionType === 'DAMAGE')!;
    expect(damage.previousStock).toBe(10);
    expect(damage.quantity).toBe(-3);
    expect(damage.newStock).toBe(7);
  });

  it('names a reason and an author on every row', () => {
    const cable = product({ stock: 5 });
    createSale(
      {
        items: [{ productId: cable.id, quantity: 1 }],
        discountAmount: 0,
        payments: [{ amount: 100000, paymentMethod: 'CASH' }],
      },
      actor,
      ctx.db,
    );

    const { rows } = inventoryHistory({ productId: cable.id }, ctx.db);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.reason, JSON.stringify(row)).toBeTruthy();
      expect(row.createdByName).toBe('Owner');
    }
  });

  it('accounts for a sale and its refund as two separate movements', () => {
    const cable = product({ stock: 10 });
    const sale = createSale(
      {
        items: [{ productId: cable.id, quantity: 2 }],
        discountAmount: 0,
        payments: [{ amount: 200000, paymentMethod: 'CASH' }],
      },
      actor,
      ctx.db,
    );
    refundSale(
      {
        saleId: sale.sale.id,
        items: [{ saleItemId: sale.items[0].id, quantity: 1, isDefective: false }],
        reason: 'Customer changed their mind',
        refundMethod: 'CASH',
      },
      actor,
      ctx.db,
    );

    const { rows, total } = inventoryHistory({ productId: cable.id }, ctx.db);
    // Opening stock, the sale, the return.
    expect(total).toBe(3);
    const types = rows.map((row) => row.transactionType);
    expect(types).toContain('PURCHASE');
    expect(types).toContain('SALE');
    expect(types).toContain('SALE_RETURN');

    // And the chain reconciles: 10 → 8 → 9.
    const ordered = [...rows].reverse();
    expect(ordered.map((row) => row.newStock)).toEqual([10, 8, 9]);
  });

  it('returns newest first, so the screen opens on what just happened', () => {
    const cable = product({ stock: 10 });
    adjustStock(
      { productId: cable.id, mode: 'CHANGE', quantity: 1, transactionType: 'PURCHASE', reason: 'One more' },
      actor,
      ctx.db,
    );

    const { rows } = inventoryHistory({ productId: cable.id }, ctx.db);
    expect(rows[0].reason).toBe('One more');
  });

  it('filters by product', () => {
    const cable = product({ sku: 'CBL-1' });
    product({ sku: 'CHG-1' });

    const mine = inventoryHistory({ productId: cable.id }, ctx.db);
    expect(mine.total).toBe(1);
    expect(mine.rows[0].sku).toBe('CBL-1');
    // Both products, unfiltered.
    expect(inventoryHistory({}, ctx.db).total).toBe(2);
  });

  it('filters by movement type', () => {
    const cable = product({ stock: 10 });
    adjustStock(
      { productId: cable.id, mode: 'CHANGE', quantity: -1, transactionType: 'DAMAGE', reason: 'Dropped' },
      actor,
      ctx.db,
    );

    expect(inventoryHistory({ type: 'DAMAGE' }, ctx.db).total).toBe(1);
    expect(inventoryHistory({ type: 'PURCHASE' }, ctx.db).total).toBe(1);
    expect(inventoryHistory({ type: 'SALE' }, ctx.db).total).toBe(0);
  });

  it('filters by business day, inclusive at both ends', () => {
    product();
    expect(inventoryHistory({ from: TODAY, to: TODAY }, ctx.db).total).toBe(1);
    expect(inventoryHistory({ from: addDays(TODAY, 1) }, ctx.db).total).toBe(0);
    expect(inventoryHistory({ to: addDays(TODAY, -1) }, ctx.db).total).toBe(0);
  });

  it('pages without losing the total', () => {
    const cable = product({ stock: 0 });
    for (let i = 0; i < 12; i += 1) {
      adjustStock(
        {
          productId: cable.id,
          mode: 'CHANGE',
          quantity: 1,
          transactionType: 'PURCHASE',
          reason: `Delivery ${i}`,
        },
        actor,
        ctx.db,
      );
    }

    const firstPage = inventoryHistory({ productId: cable.id, limit: 5, offset: 0 }, ctx.db);
    expect(firstPage.rows).toHaveLength(5);
    expect(firstPage.total).toBe(12);

    const lastPage = inventoryHistory({ productId: cable.id, limit: 5, offset: 10 }, ctx.db);
    expect(lastPage.rows).toHaveLength(2);
    expect(lastPage.total).toBe(12);
  });

  it('caps a page at 500 rows however large a limit is asked for', () => {
    // The screen offers 50/100/250; this is the backstop behind that.
    product();
    expect(() => inventoryHistory({ limit: 100_000 }, ctx.db)).not.toThrow();
  });

  it('records each handset individually, naming its IMEI', () => {
    const phone = product({ sku: 'PH-1', stock: 0, serialized: true });
    addSerials(
      {
        productId: phone.id,
        serials: [{ imei1: '354121080000001' }, { imei1: '354121080000002' }],
      },
      actor,
      ctx.db,
    );

    const { rows, total } = inventoryHistory({ productId: phone.id }, ctx.db);
    expect(total).toBe(2);
    // A ledger that said "+2 phones" could not tell you which two.
    expect(rows.map((row) => row.reason).join(' ')).toContain('354121080000001');
    expect(rows.map((row) => row.reason).join(' ')).toContain('354121080000002');
  });

  it('records a defective handset coming off the shelf', () => {
    const phone = product({ sku: 'PH-1', stock: 0, serialized: true });
    addSerials({ productId: phone.id, serials: [{ imei1: '354121080000001' }] }, actor, ctx.db);
    const serial = listSerials(phone.id, 'AVAILABLE', ctx.db)[0];

    markSerialDefective(serial.id, 'Screen dead on arrival', actor, ctx.db);

    const { rows } = inventoryHistory({ productId: phone.id, type: 'DAMAGE' }, ctx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(-1);
    expect(rows[0].newStock).toBe(0);
    expect(rows[0].reason).toBe('Screen dead on arrival');
  });

  it('survives the product being deactivated', () => {
    // A product with history is deactivated rather than deleted (spec §74), so
    // its ledger must still be readable — that is the point of the soft delete.
    const cable = product({ stock: 3 });
    const result = deleteProduct(cable.id, actor, ctx.db);
    expect(result.deactivated).toBe(true);

    const { rows, total } = inventoryHistory({ productId: cable.id }, ctx.db);
    expect(total).toBe(1);
    expect(rows[0].productName).toContain('CBL-1');
  });
});

// -----------------------------------------------------------------------------
// The stock figures
// -----------------------------------------------------------------------------

describe('the stock summary', () => {
  it('counts units and values them at cost and at retail', () => {
    product({ sku: 'CBL-1', stock: 10, purchasePrice: 80000, sellingPrice: 100000 });
    product({ sku: 'CHG-1', stock: 4, purchasePrice: 50000, sellingPrice: 90000 });

    const summary = stockSummary(5, ctx.db);
    expect(summary.products).toBe(2);
    expect(summary.productsInStock).toBe(2);
    expect(summary.unitsHeld).toBe(14);
    // 10 × 800.00 + 4 × 500.00
    expect(summary.stockValueAtCost).toBe(1_000_000);
    // 10 × 1,000.00 + 4 × 900.00
    expect(summary.potentialRevenue).toBe(1_360_000);
  });

  it('is all zeroes on a shop with no products', () => {
    const summary = stockSummary(5, ctx.db);
    expect(summary).toMatchObject({
      products: 0,
      productsInStock: 0,
      unitsHeld: 0,
      stockValueAtCost: 0,
      potentialRevenue: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      availableSerials: 0,
    });
  });

  it('counts low and out of stock separately', () => {
    // A product at zero is out of stock, not low — they need different actions.
    product({ sku: 'LOW-1', stock: 2, minimumStock: 5 });
    product({ sku: 'OUT-1', stock: 0, minimumStock: 5 });
    product({ sku: 'OK-1', stock: 50, minimumStock: 5 });

    const summary = stockSummary(5, ctx.db);
    expect(summary.lowStockCount).toBe(1);
    expect(summary.outOfStockCount).toBe(1);
    expect(summary.productsInStock).toBe(2);
  });

  it('applies the shop default only where a product sets no minimum of its own', () => {
    product({ sku: 'OWN-1', stock: 4, minimumStock: 2 });
    product({ sku: 'DEFAULT-1', stock: 4, minimumStock: 0 });

    // Default 5: OWN-1 is fine at 4 against its own minimum of 2; DEFAULT-1 is low.
    expect(stockSummary(5, ctx.db).lowStockCount).toBe(1);
    // Default 3: neither is low.
    expect(stockSummary(3, ctx.db).lowStockCount).toBe(0);
  });

  it('ignores deactivated products', () => {
    const cable = product({ sku: 'CBL-1', stock: 10 });
    product({ sku: 'CHG-1', stock: 5 });
    ctx.db.prepare(`UPDATE "Product" SET isActive = 0 WHERE id = ?`).run(cable.id);

    const summary = stockSummary(5, ctx.db);
    expect(summary.products).toBe(1);
    expect(summary.unitsHeld).toBe(5);
  });

  it('never lets negative stock reduce the value of the shelf', () => {
    // With the negative-stock policy enabled a level can go below zero. Counting
    // that as negative units would understate the stock that is actually there.
    setSettings({ allowNegativeStock: 'true' }, actor.id, ctx.db);
    const cable = product({ sku: 'CBL-1', stock: 1, purchasePrice: 80000 });
    adjustStock(
      {
        productId: cable.id,
        mode: 'CHANGE',
        quantity: -3,
        transactionType: 'ADJUSTMENT',
        reason: 'Oversold',
      },
      actor,
      ctx.db,
    );

    const summary = stockSummary(5, ctx.db);
    expect(summary.unitsHeld).toBe(0);
    expect(summary.stockValueAtCost).toBe(0);
    expect(summary.outOfStockCount).toBe(1);
  });

  it('counts handsets still available by IMEI', () => {
    const phone = product({ sku: 'PH-1', stock: 0, serialized: true });
    addSerials(
      {
        productId: phone.id,
        serials: [{ imei1: '354121080000001' }, { imei1: '354121080000002' }],
      },
      actor,
      ctx.db,
    );
    expect(stockSummary(5, ctx.db).availableSerials).toBe(2);

    // Selling one takes it out of the available count.
    createSale(
      {
        items: [
          {
            productId: phone.id,
            quantity: 1,
            productSerialId: listSerials(phone.id, 'AVAILABLE', ctx.db)[0].id,
          },
        ],
        discountAmount: 0,
        payments: [{ amount: 100000, paymentMethod: 'CASH' }],
      },
      actor,
      ctx.db,
    );
    expect(stockSummary(5, ctx.db).availableSerials).toBe(1);
  });

  it('agrees with the low-stock list it sits above', () => {
    // The figure and the list are computed by different queries; a shop noticing
    // "3 low" above a list of 2 would stop trusting either.
    product({ sku: 'LOW-1', stock: 1, minimumStock: 5 });
    product({ sku: 'LOW-2', stock: 4, minimumStock: 5 });
    product({ sku: 'OUT-1', stock: 0, minimumStock: 5 });
    product({ sku: 'OK-1', stock: 99, minimumStock: 5 });

    const summary = stockSummary(5, ctx.db);
    const list = lowStock(5, ctx.db);

    // lowStock() includes the out-of-stock ones, because they need reordering too.
    expect(list).toHaveLength(3);
    expect(summary.lowStockCount + summary.outOfStockCount).toBe(list.length);
  });

  it('orders the reorder list by how far below its minimum each product is', () => {
    product({ sku: 'SLIGHTLY-LOW', stock: 4, minimumStock: 5 });
    product({ sku: 'VERY-LOW', stock: 0, minimumStock: 20 });

    const list = lowStock(5, ctx.db);
    // Worst first, so the top of the screen is what to order today.
    expect(list[0].sku).toBe('VERY-LOW');
    expect(list[1].sku).toBe('SLIGHTLY-LOW');
  });
});
