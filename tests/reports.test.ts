/**
 * Trading aggregation (spec §47, §49, §50, §72, §80).
 *
 * The headline test is the specification's own worked example (§80):
 *
 *     buy at 800, sell at 1,000, stock 10, sell 2, add a 100 expense
 *     → revenue 2,000 · COGS 1,600 · gross profit 400 · net profit 300 · stock 8
 *
 * The rest guard the things that make that number trustworthy: cancelled sales
 * excluded, refunds netted, cost taken from the sale and not from today's price.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import { createProduct, saveCategory, updateProduct } from '../electron/services/product.service';
import { createSale, cancelSale, refundSale } from '../electron/services/sale.service';
import { createExpense } from '../electron/services/expense.service';
import { listExpenseCategories } from '../electron/services/expense.service';
import {
  salesSummary,
  salesByDay,
  topProducts,
  salesByCategory,
  salesByPaymentMethod,
  profitAndLoss,
  dashboard,
} from '../electron/services/report.service';
import { setSettings } from '../electron/services/settings.service';
import { businessDay, addDays } from '../shared/datetime';
import type { FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let actor: SessionUser;
const TODAY = businessDay();
const RANGE = { from: TODAY, to: TODAY };

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
  setSessionUser(null);
  ctx.cleanup();
});

function makeProduct(
  options: { cost?: number; price?: number; stock?: number; name?: string; categoryId?: string } = {},
) {
  return createProduct(
    {
      sku: `SKU-${Math.random().toString(36).slice(2, 9)}`,
      barcode: undefined,
      name: options.name ?? 'USB-C Cable',
      description: undefined,
      categoryId: options.categoryId,
      brandId: undefined,
      purchasePrice: options.cost ?? 80_000,
      sellingPrice: options.price ?? 100_000,
      taxRate: 0,
      taxRateOverride: false,
      minimumStock: 0,
      unit: 'pcs',
      isSerialized: false,
      warrantyMonths: 0,
      initialStock: options.stock ?? 10,
      serials: undefined,
    },
    actor,
    ctx.db,
  );
}

function sell(
  productId: string,
  quantity: number,
  options: { discount?: number; paid?: number; method?: 'CASH' | 'BANK_TRANSFER' } = {},
) {
  return createSale(
    {
      customerId: undefined,
      items: [{ productId, quantity, productSerialId: undefined }],
      discountAmount: options.discount ?? 0,
      payments:
        options.paid === undefined
          ? []
          : [
              {
                amount: options.paid,
                paymentMethod: options.method ?? 'CASH',
                referenceNumber: undefined,
                notes: undefined,
              },
            ],
      notes: undefined,
    },
    actor,
    ctx.db,
  );
}

function addExpense(amount: number, description = 'Shop rent') {
  const categoryId = listExpenseCategories(false, ctx.db)[0].id;
  return createExpense(
    {
      categoryId,
      expenseDay: TODAY,
      description,
      amount,
      paymentMethod: 'CASH',
      referenceNumber: undefined,
      notes: undefined,
    },
    actor,
    ctx.db,
  );
}

// -----------------------------------------------------------------------------

describe('spec §80 — the worked example, end to end', () => {
  it('produces exactly the figures the specification states', () => {
    // Purchase 800, selling 1,000, stock 10.
    const product = makeProduct({ cost: 80_000, price: 100_000, stock: 10 });

    // Sell quantity 2.
    sell(product.id, 2, { paid: 200_000 });

    const sales = salesSummary(RANGE, ctx.db);
    expect(sales.netSales).toBe(200_000); // Revenue 2,000
    expect(sales.cogs).toBe(160_000); // COGS 1,600
    expect(sales.grossProfit).toBe(40_000); // Gross profit 400
    expect(sales.itemsSold).toBe(2);
    expect(sales.transactions).toBe(1);

    // Add expense 100.
    addExpense(10_000);

    const pl = profitAndLoss(RANGE, ctx.db);
    expect(pl.goods.netSales).toBe(200_000);
    expect(pl.goods.cogs).toBe(160_000);
    expect(pl.goods.grossProfit).toBe(40_000);
    expect(pl.expenses).toBe(10_000);
    expect(pl.netProfit).toBe(30_000); // Net profit 300

    // Stock 8 — checked in the sales suite too, restated here because the
    // specification lists it as part of this same expectation.
    const stock = ctx.db.prepare(`SELECT stockQuantity FROM "Product" WHERE id = ?`).get(product.id) as {
      stockQuantity: number;
    };
    expect(stock.stockQuantity).toBe(8);
  });
});

describe('what counts as revenue', () => {
  it('excludes cancelled sales entirely', () => {
    const product = makeProduct({ stock: 10 });
    const keep = sell(product.id, 1, { paid: 100_000 });
    const scrap = sell(product.id, 3, { paid: 300_000 });

    expect(salesSummary(RANGE, ctx.db).netSales).toBe(400_000);

    cancelSale(scrap.sale.id, 'Rung up by mistake', actor, ctx.db);

    const after = salesSummary(RANGE, ctx.db);
    expect(after.netSales).toBe(100_000);
    expect(after.cogs).toBe(80_000);
    expect(after.transactions).toBe(1);
    expect(keep.sale.id).toBeTruthy();
  });

  it('nets a refunded quantity out of revenue and cost', () => {
    const product = makeProduct({ cost: 80_000, price: 100_000, stock: 10 });
    const sale = sell(product.id, 4, { paid: 400_000 });

    expect(salesSummary(RANGE, ctx.db).netSales).toBe(400_000);

    refundSale(
      {
        saleId: sale.sale.id,
        items: [{ saleItemId: sale.items[0].id, quantity: 1, isDefective: false }],
        reason: 'One faulty',
        refundMethod: 'CASH',
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    const after = salesSummary(RANGE, ctx.db);
    // Three of the four stayed sold.
    expect(after.netSales).toBe(300_000);
    expect(after.cogs).toBe(240_000);
    expect(after.grossProfit).toBe(60_000);
    expect(after.itemsSold).toBe(3);
    // The sale still counts as a transaction; it happened.
    expect(after.transactions).toBe(1);
    expect(after.refunds).toBe(100_000);
  });

  it('keeps tax out of revenue but reports what was collected', () => {
    setSettings({ taxEnabled: 'true', taxRate: '700', taxMode: 'EXCLUSIVE' }, actor.id, ctx.db);
    const product = makeProduct({ cost: 80_000, price: 100_000, stock: 10 });
    sell(product.id, 1, { paid: 107_000 });

    const sales = salesSummary(RANGE, ctx.db);
    expect(sales.netSales).toBe(100_000);
    expect(sales.tax).toBe(7_000);
    expect(sales.grossProfit).toBe(20_000);

    const pl = profitAndLoss(RANGE, ctx.db);
    expect(pl.taxCollected).toBe(7_000);
    // Tax is not part of profit.
    expect(pl.netProfit).toBe(20_000);
  });

  it('takes a discount off revenue but not off cost', () => {
    const product = makeProduct({ cost: 80_000, price: 100_000, stock: 10 });
    sell(product.id, 2, { discount: 20_000, paid: 180_000 });

    const sales = salesSummary(RANGE, ctx.db);
    expect(sales.grossSales).toBe(200_000);
    expect(sales.discounts).toBe(20_000);
    expect(sales.netSales).toBe(180_000);
    expect(sales.cogs).toBe(160_000);
    expect(sales.grossProfit).toBe(20_000);
  });

  it('uses the cost recorded on the sale, not today’s purchase price (spec §49)', () => {
    const product = makeProduct({ cost: 80_000, price: 100_000, stock: 10 });
    sell(product.id, 2, { paid: 200_000 });

    // The supplier raises the price afterwards.
    updateProduct(
      {
        id: product.id,
        sku: product.sku,
        barcode: undefined,
        name: product.name,
        description: undefined,
        categoryId: undefined,
        brandId: undefined,
        purchasePrice: 95_000,
        sellingPrice: 120_000,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        isActive: true,
      },
      actor,
      ctx.db,
    );

    const sales = salesSummary(RANGE, ctx.db);
    expect(sales.cogs).toBe(160_000);
    expect(sales.grossProfit).toBe(40_000);
  });

  it('reports zeros for a period with no trading', () => {
    const sales = salesSummary({ from: addDays(TODAY, -30), to: addDays(TODAY, -20) }, ctx.db);
    expect(sales).toMatchObject({
      transactions: 0,
      itemsSold: 0,
      grossSales: 0,
      netSales: 0,
      cogs: 0,
      grossProfit: 0,
    });
  });
});

describe('breakdowns for the charts (spec §47)', () => {
  it('zero-fills every day in the range', () => {
    const product = makeProduct({ stock: 10 });
    sell(product.id, 1, { paid: 100_000 });

    const range = { from: addDays(TODAY, -4), to: TODAY };
    const days = salesByDay(range, ctx.db);

    expect(days).toHaveLength(5);
    expect(days[days.length - 1]).toMatchObject({ day: TODAY, netSales: 100_000, transactions: 1 });
    // The quiet days are present as zeros rather than missing.
    expect(days.slice(0, 4).every((d) => d.netSales === 0 && d.transactions === 0)).toBe(true);
  });

  it('ranks top products by revenue and reports their profit', () => {
    const cheap = makeProduct({ name: 'Cable', cost: 20_000, price: 50_000, stock: 20 });
    const dear = makeProduct({ name: 'Power Bank', cost: 200_000, price: 400_000, stock: 20 });

    sell(cheap.id, 2, { paid: 100_000 });
    sell(dear.id, 1, { paid: 400_000 });

    const top = topProducts(RANGE, 10, ctx.db);
    expect(top).toHaveLength(2);
    expect(top[0]).toMatchObject({ productName: 'Power Bank', netSales: 400_000, grossProfit: 200_000 });
    expect(top[1]).toMatchObject({ productName: 'Cable', netSales: 100_000, grossProfit: 60_000 });
  });

  it('groups by category and names the uncategorised', () => {
    const accessories = saveCategory({ name: 'Test Accessories', isActive: true }, actor, ctx.db);
    const inCategory = makeProduct({ name: 'Case', price: 60_000, stock: 10, categoryId: accessories.id });
    const noCategory = makeProduct({ name: 'Odd item', price: 40_000, stock: 10 });

    sell(inCategory.id, 1, { paid: 60_000 });
    sell(noCategory.id, 1, { paid: 40_000 });

    const byCategory = salesByCategory(RANGE, ctx.db);
    expect(byCategory[0]).toMatchObject({ categoryName: 'Test Accessories', netSales: 60_000 });
    expect(byCategory[1]).toMatchObject({ categoryName: 'Uncategorised', netSales: 40_000 });
  });

  it('groups payments by method', () => {
    const product = makeProduct({ price: 100_000, stock: 10 });
    sell(product.id, 1, { paid: 100_000, method: 'CASH' });
    sell(product.id, 1, { paid: 100_000, method: 'BANK_TRANSFER' });
    sell(product.id, 1, { paid: 100_000, method: 'CASH' });

    const methods = salesByPaymentMethod(RANGE, ctx.db);
    const cash = methods.find((m) => m.paymentMethod === 'CASH');
    const transfer = methods.find((m) => m.paymentMethod === 'BANK_TRANSFER');

    expect(cash).toMatchObject({ count: 2, total: 200_000 });
    expect(transfer).toMatchObject({ count: 1, total: 100_000 });
  });
});

describe('dashboard (spec §31, §72)', () => {
  it('answers for whatever range it is asked for, not just today', () => {
    const product = makeProduct({ cost: 80_000, price: 100_000, stock: 10 });
    sell(product.id, 2, { paid: 200_000 });
    addExpense(10_000);

    const today = dashboard(RANGE, ctx.db);
    expect(today.cards.revenue).toBe(200_000);
    expect(today.cards.expenses).toBe(10_000);
    expect(today.cards.netProfit).toBe(30_000);
    expect(today.cards.transactions).toBe(1);

    // A window that ended before the shop opened shows nothing.
    const lastWeek = dashboard({ from: addDays(TODAY, -10), to: addDays(TODAY, -5) }, ctx.db);
    expect(lastWeek.cards.revenue).toBe(0);
    expect(lastWeek.cards.expenses).toBe(0);
    expect(lastWeek.cards.netProfit).toBe(0);
    expect(lastWeek.cards.transactions).toBe(0);
  });

  it('carries the shop currency so the UI never guesses', () => {
    setSettings({ currency: 'MMK' }, actor.id, ctx.db);
    expect(dashboard(RANGE, ctx.db).currency).toBe('MMK');
  });

  it('pairs revenue against expenses day by day', () => {
    const product = makeProduct({ stock: 10 });
    sell(product.id, 1, { paid: 100_000 });
    addExpense(30_000);

    // A fortnight is already longer than the minimum trend window, so the chart
    // covers exactly what was asked for.
    const range = { from: addDays(TODAY, -13), to: TODAY };
    const board = dashboard(range, ctx.db);

    expect(board.trendRange).toEqual(range);
    expect(board.charts.revenueVsExpenses).toHaveLength(14);
    const todayPoint = board.charts.revenueVsExpenses.find((p) => p.day === TODAY);
    expect(todayPoint).toMatchObject({ revenue: 100_000, expenses: 30_000 });
  });

  it('widens a short period for the trend charts but not for the cards', () => {
    const product = makeProduct({ cost: 80_000, price: 100_000, stock: 10 });
    sell(product.id, 2, { paid: 200_000 });

    // A single day cannot draw a trend, so the by-day series covers a week
    // ending on that day. The cards still answer the day that was asked for.
    const board = dashboard(RANGE, ctx.db);

    expect(board.range).toEqual(RANGE);
    expect(board.trendRange).toEqual({ from: addDays(TODAY, -6), to: TODAY });
    expect(board.charts.salesByDay).toHaveLength(7);
    expect(board.charts.revenueVsExpenses).toHaveLength(7);

    // The widened window does not inflate the cards.
    expect(board.cards.revenue).toBe(200_000);
    // And the day itself still carries the figures inside the wider series.
    expect(board.charts.salesByDay.at(-1)).toMatchObject({ day: TODAY, netSales: 200_000 });
    expect(board.charts.salesByDay[0].netSales).toBe(0);
  });

  it('leaves a period of a week or more exactly as asked', () => {
    const board = dashboard({ from: addDays(TODAY, -6), to: TODAY }, ctx.db);
    expect(board.trendRange).toEqual({ from: addDays(TODAY, -6), to: TODAY });
    expect(board.charts.salesByDay).toHaveLength(7);
  });

  it('counts low stock against each product’s own reorder point', () => {
    // minimumStock 5 with 3 on the shelf is low; the other is comfortable.
    const low = createProduct(
      {
        sku: 'LOW-1',
        barcode: undefined,
        name: 'Nearly out',
        description: undefined,
        categoryId: undefined,
        brandId: undefined,
        purchasePrice: 1000,
        sellingPrice: 2000,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 5,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        initialStock: 3,
        serials: undefined,
      },
      actor,
      ctx.db,
    );
    makeProduct({ stock: 500 });

    const board = dashboard(RANGE, ctx.db);
    expect(board.cards.lowStockCount).toBeGreaterThanOrEqual(1);
    expect(board.lowStock.some((row) => row.id === low.id)).toBe(true);
  });

  it('lists recent activity newest first', () => {
    const product = makeProduct({ stock: 10 });
    const first = sell(product.id, 1, { paid: 100_000 });
    const second = sell(product.id, 1, { paid: 100_000 });
    addExpense(5_000, 'Electricity');

    const board = dashboard(RANGE, ctx.db);
    expect(board.recent.sales[0].invoiceNumber).toBe(second.sale.invoiceNumber);
    expect(board.recent.sales[1].invoiceNumber).toBe(first.sale.invoiceNumber);
    expect(board.recent.expenses[0].description).toBe('Electricity');
  });
});
