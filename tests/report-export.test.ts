/**
 * Report assembly and export (spec §46–§50, §56, §90).
 *
 * The export tests care most about one thing: a spreadsheet must contain real
 * NUMBERS, not text that merely looks like money. A column of strings cannot be
 * summed, which defeats the point of exporting it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import { createProduct } from '../electron/services/product.service';
import { createCustomer } from '../electron/services/customer.service';
import { createSale } from '../electron/services/sale.service';
import { createExpense, listExpenseCategories } from '../electron/services/expense.service';
import {
  buildReport,
  inventoryValuation,
  customerReport,
} from '../electron/services/report-builder.service';
import {
  reportToCsv,
  reportToXlsx,
  reportToHtml,
  reportFileStem,
} from '../electron/services/export.service';
import { REPORT_KINDS } from '../shared/report';
import { businessDay } from '../shared/datetime';
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

function makeProduct(options: { cost?: number; price?: number; stock?: number; name?: string } = {}) {
  return createProduct(
    {
      sku: `SKU-${Math.random().toString(36).slice(2, 9)}`,
      barcode: undefined,
      name: options.name ?? 'USB-C Cable',
      description: undefined,
      categoryId: undefined,
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

/** A shop with a sale, a customer and an expense, so reports have content. */
function seedTrading() {
  const product = makeProduct({ cost: 80_000, price: 100_000, stock: 10 });
  const customer = createCustomer(
    { name: 'Nok', phone: '0812345678', email: undefined, address: undefined, notes: undefined },
    actor,
    ctx.db,
  );

  createSale(
    {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 2, productSerialId: undefined }],
      discountAmount: 0,
      payments: [{ amount: 200_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined }],
      notes: undefined,
    },
    actor,
    ctx.db,
  );

  createExpense(
    {
      categoryId: listExpenseCategories(false, ctx.db)[0].id,
      expenseDay: TODAY,
      description: 'Shop rent',
      amount: 10_000,
      paymentMethod: 'CASH',
      referenceNumber: undefined,
      notes: undefined,
    },
    actor,
    ctx.db,
  );

  return { product, customer };
}

// -----------------------------------------------------------------------------

describe('report assembly', () => {
  it('builds every report kind without throwing, even on an empty shop', () => {
    for (const kind of REPORT_KINDS) {
      const report = buildReport(kind, RANGE, ctx.db);
      expect(report.kind).toBe(kind);
      expect(report.title).toContain('Report');
      expect(report.currency).toBe('THB');
      expect(Array.isArray(report.figures)).toBe(true);
      expect(report.tables.length).toBeGreaterThan(0);
    }
  });

  it('describes every column of every table, with no orphan row keys', () => {
    seedTrading();
    for (const kind of REPORT_KINDS) {
      const report = buildReport(kind, RANGE, ctx.db);
      for (const table of report.tables) {
        expect(table.columns.length).toBeGreaterThan(0);
        const declared = new Set(table.columns.map((c) => c.key));
        for (const row of table.rows) {
          // Every column a renderer will look for must be present on the row.
          for (const key of declared) {
            expect(Object.prototype.hasOwnProperty.call(row, key)).toBe(true);
          }
        }
        // Totals may only reference declared columns.
        for (const key of Object.keys(table.totals ?? {})) {
          expect(declared.has(key)).toBe(true);
        }
      }
    }
  });

  it('reports the spec §47 sales figures', () => {
    seedTrading();
    const report = buildReport('SALES', RANGE, ctx.db);
    const figure = (label: string) => report.figures.find((f) => f.label === label)?.value;

    expect(figure('Total transactions')).toBe(1);
    expect(figure('Total items sold')).toBe(2);
    expect(figure('Gross sales')).toBe(200_000);
    expect(figure('Net sales')).toBe(200_000);
    expect(figure('Cost of goods sold')).toBe(160_000);
    expect(figure('Gross profit')).toBe(40_000);
  });

  it('lays out the profit and loss statement and lands on net profit', () => {
    seedTrading();
    const report = buildReport('PROFIT_LOSS', RANGE, ctx.db);

    const netProfit = report.figures.find((f) => f.label === 'Net profit');
    expect(netProfit?.value).toBe(30_000);
    expect(netProfit?.emphasis).toBe(true);

    const statement = report.tables[0];
    const line = (name: string) => statement.rows.find((r) => r.line === name)?.amount;

    expect(line('Goods — net sales')).toBe(200_000);
    // Costs and expenses are shown as negatives so the column adds up visually.
    expect(line('Goods — cost of goods sold')).toBe(-160_000);
    expect(line('Goods — gross profit')).toBe(40_000);
    expect(line('Operating expenses')).toBe(-10_000);
    expect(line('NET PROFIT')).toBe(30_000);
  });

  it('values stock at the current purchase price (spec §50)', () => {
    makeProduct({ cost: 80_000, price: 100_000, stock: 10, name: 'Cable' });

    const rows = inventoryValuation(ctx.db);
    const cable = rows.find((r) => r.name === 'Cable')!;

    expect(cable.stockQuantity).toBe(10);
    expect(cable.stockValue).toBe(800_000);
    expect(cable.potentialRevenue).toBe(1_000_000);
    expect(cable.potentialProfit).toBe(200_000);

    const report = buildReport('INVENTORY', RANGE, ctx.db);
    const figure = (label: string) => report.figures.find((f) => f.label === label)?.value;
    expect(figure('Stock value at cost')).toBe(800_000);
    expect(figure('Potential profit')).toBe(200_000);
  });

  it('ranks customers by what they actually spent', () => {
    seedTrading();
    const rows = customerReport(RANGE, ctx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Nok', orders: 1, totalSpent: 200_000 });

    const report = buildReport('CUSTOMERS', RANGE, ctx.db);
    expect(report.figures.find((f) => f.label === 'Best customer')?.value).toBe('Nok');
  });

  it('computes a product margin', () => {
    seedTrading();
    const report = buildReport('PRODUCTS', RANGE, ctx.db);
    const row = report.tables[0].rows[0];
    // 40,000 profit on 200,000 revenue = 20%
    expect(row.margin).toBe(20);
  });
});

describe('export (spec §56, §90)', () => {
  it('writes an Excel workbook whose money cells are numbers, not text', async () => {
    seedTrading();
    const report = buildReport('SALES', RANGE, ctx.db);
    const target = path.join(ctx.dir, 'sales.xlsx');

    await reportToXlsx(report, target);
    expect(fs.existsSync(target)).toBe(true);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(target);

    // A sheet per table, plus the summary.
    expect(workbook.worksheets.length).toBe(report.tables.length + 1);

    const byDay = workbook.getWorksheet('Sales by day')!;
    expect(byDay).toBeTruthy();

    const header = byDay.getRow(1);
    expect(header.getCell(1).value).toBe('Day');
    expect(header.font?.bold).toBe(true);

    // The first data row's money column must be a real number in MAJOR units,
    // carrying a currency format — 200,000 minor units is 2000.00.
    const netSalesColumn = report.tables[0].columns.findIndex((c) => c.key === 'netSales') + 1;
    let found = false;
    byDay.eachRow((row, index) => {
      if (index === 1) return;
      const cell = row.getCell(netSalesColumn);
      if (typeof cell.value === 'number' && cell.value === 2000) {
        found = true;
        expect(cell.numFmt).toBe('#,##0.00');
      }
    });
    expect(found).toBe(true);
  });

  it('writes a totals row in Excel that is bold and numeric', async () => {
    seedTrading();
    const report = buildReport('SALES', RANGE, ctx.db);
    const target = path.join(ctx.dir, 'totals.xlsx');
    await reportToXlsx(report, target);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(target);
    const sheet = workbook.getWorksheet('Sales by day')!;
    const lastRow = sheet.getRow(sheet.rowCount);

    expect(lastRow.font?.bold).toBe(true);
    const netSalesColumn = report.tables[0].columns.findIndex((c) => c.key === 'netSales') + 1;
    expect(typeof lastRow.getCell(netSalesColumn).value).toBe('number');
  });

  it('writes a CSV with a BOM, quoted values and numeric money', () => {
    seedTrading();
    const report = buildReport('SALES', RANGE, ctx.db);
    const target = path.join(ctx.dir, 'sales.csv');

    reportToCsv(report, target);
    const text = fs.readFileSync(target, 'utf8');

    // A BOM so Excel reads UTF-8 correctly.
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Sales Report');
    expect(text).toContain('Sales by day');
    // Money in major units as a bare number, so a spreadsheet can sum it.
    expect(text).toContain('2000');
    expect(text).not.toContain('2,000.00');
    expect(text.includes('\r\n')).toBe(true);
  });

  it('quotes a value containing a comma so the row cannot break', () => {
    const product = makeProduct({ name: 'Cable, braided 2m' });
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
    );

    const report = buildReport('PRODUCTS', RANGE, ctx.db);
    const target = path.join(ctx.dir, 'products.csv');
    reportToCsv(report, target);

    const text = fs.readFileSync(target, 'utf8');
    expect(text).toContain('"Cable, braided 2m"');
  });

  it('renders a printable document that escapes shop data', () => {
    const product = makeProduct({ name: 'Cable <script>alert(1)</script>' });
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
    );

    const report = buildReport('PRODUCTS', RANGE, ctx.db);
    const html = reportToHtml(report, 'Green Mobile & Co');

    expect(html).toContain('Green Mobile &amp; Co');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    // Long tables must repeat their header across pages.
    expect(html).toContain('thead { display: table-header-group; }');
    expect(html).toContain('size: A4');
  });

  it('names exported files by report and period', () => {
    const report = buildReport('PROFIT_LOSS', { from: '2026-08-01', to: '2026-08-31' }, ctx.db);
    expect(reportFileStem(report)).toBe('profit-loss-report_2026-08-01_to_2026-08-31');
  });

  it('keeps Excel sheet names within the 31-character limit', async () => {
    seedTrading();
    const report = buildReport('INVENTORY', RANGE, ctx.db);
    const target = path.join(ctx.dir, 'inventory.xlsx');
    await reportToXlsx(report, target);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(target);
    for (const sheet of workbook.worksheets) {
      expect(sheet.name.length).toBeLessThanOrEqual(31);
      expect(sheet.name).not.toMatch(/[:\\/?*[\]]/);
    }
  });

  it('exports an empty period without producing a broken file', async () => {
    const report = buildReport('SALES', { from: '2020-01-01', to: '2020-01-02' }, ctx.db);
    const xlsx = path.join(ctx.dir, 'empty.xlsx');
    const csv = path.join(ctx.dir, 'empty.csv');

    await reportToXlsx(report, xlsx);
    reportToCsv(report, csv);

    expect(fs.statSync(xlsx).size).toBeGreaterThan(1000);
    expect(fs.readFileSync(csv, 'utf8')).toContain('Sales Report');
  });
});
