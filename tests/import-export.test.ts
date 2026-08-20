/**
 * Product import and list export (spec §56, §57, §80).
 *
 * The import tests are mostly about the *preview*, because that is the feature:
 * a shop must be able to see what a supplier's spreadsheet will do to its
 * catalogue before any of it is written. Every validation the spec names —
 * duplicate SKU, duplicate barcode, invalid price, invalid stock, missing name —
 * has a test that proves the row is refused and the rest still import.
 *
 * Spreadsheets are written to disk with ExcelJS and read back through the real
 * parser, so the round trip is genuine rather than a hand-built object.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import { createProduct, listProducts, listCategories, listBrands } from '../electron/services/product.service';
import { createCustomer } from '../electron/services/customer.service';
import { createSale } from '../electron/services/sale.service';
import { createExpense, listExpenseCategories } from '../electron/services/expense.service';
import {
  analyseProductImport,
  commitProductImport,
  parseProductFile,
  previewProductImport,
  rememberParse,
  writeImportTemplate,
} from '../electron/services/import.service';
import {
  buildListExport,
  listFileStem,
  type ListExportQuery,
} from '../electron/services/list-export.service';
import { inventoryHistory } from '../electron/services/inventory.service';
import { businessDay } from '../shared/datetime';
import { IMPORT_FIELD_LABELS, type ImportPreview, type ImportRow } from '../shared/import';
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

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const HEADERS = [
  IMPORT_FIELD_LABELS.sku,
  IMPORT_FIELD_LABELS.barcode,
  IMPORT_FIELD_LABELS.name,
  IMPORT_FIELD_LABELS.category,
  IMPORT_FIELD_LABELS.brand,
  IMPORT_FIELD_LABELS.purchasePrice,
  IMPORT_FIELD_LABELS.sellingPrice,
  IMPORT_FIELD_LABELS.stock,
  IMPORT_FIELD_LABELS.minimumStock,
];

/** Writes a real .xlsx to the temp directory and returns its path. */
async function writeSheet(
  rows: Array<Array<string | number | null>>,
  headers: Array<string | number> = HEADERS,
  fileName = 'products.xlsx',
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);

  const target = path.join(ctx.dir, fileName);
  await workbook.xlsx.writeFile(target);
  return target;
}

async function preview(rows: Array<Array<string | number | null>>, headers = HEADERS) {
  return previewProductImport(await writeSheet(rows, headers), ctx.db);
}

function rowFor(preview: ImportPreview, sku: string): ImportRow {
  return preview.rows.find((row) => row.sku === sku)!;
}

function existingProduct(sku: string) {
  return createProduct(
    {
      sku,
      name: `Existing ${sku}`,
      purchasePrice: 50000,
      sellingPrice: 90000,
      taxRate: 0,
      taxRateOverride: false,
      minimumStock: 1,
      unit: 'pcs',
      isSerialized: false,
      warrantyMonths: 0,
      initialStock: 4,
    },
    actor,
    ctx.db,
  );
}

// -----------------------------------------------------------------------------
// Reading the file
// -----------------------------------------------------------------------------

describe('reading a spreadsheet', () => {
  it('matches the spec’s column names', async () => {
    const parsed = await parseProductFile(
      await writeSheet([['CBL-1', '', 'Cable', '', '', 80, 150, 10, 2]]),
    );
    expect(parsed.matchedColumns.sku).toBe('SKU');
    expect(parsed.matchedColumns.sellingPrice).toBe('Selling Price');
    expect(parsed.missingColumns).toHaveLength(0);
    expect(parsed.rows).toHaveLength(1);
  });

  it('accepts the headings other systems export', async () => {
    // Nobody re-types their stock list to match our spelling.
    const parsed = await parseProductFile(
      await writeSheet(
        [['CBL-1', 'Cable', 80, 150, 10]],
        ['Product Code', 'Title', 'Cost', 'Price', 'Qty'],
      ),
    );
    expect(parsed.matchedColumns.sku).toBe('Product Code');
    expect(parsed.matchedColumns.name).toBe('Title');
    expect(parsed.matchedColumns.purchasePrice).toBe('Cost');
    expect(parsed.matchedColumns.sellingPrice).toBe('Price');
    expect(parsed.matchedColumns.stock).toBe('Qty');
    // Not present in this file, and reported as such.
    expect(parsed.missingColumns).toContain('barcode');
  });

  it('refuses a file with no SKU or name column', async () => {
    await expect(
      parseProductFile(await writeSheet([[1, 2]], ['Colour', 'Weight'])),
    ).rejects.toThrowError(/must name the columns/i);
  });

  it('refuses a file with headings but no rows', async () => {
    await expect(parseProductFile(await writeSheet([]))).rejects.toThrowError(/no product rows/i);
  });

  it('ignores blank rows rather than importing empty products', async () => {
    const parsed = await parseProductFile(
      await writeSheet([
        ['CBL-1', '', 'Cable', '', '', 80, 150, 10, 2],
        ['', '', '', '', '', null, null, null, null],
        ['CBL-2', '', 'Charger', '', '', 90, 200, 5, 1],
      ]),
    );
    expect(parsed.rows).toHaveLength(2);
  });

  it('reads a CSV as well as a workbook', async () => {
    const csv = path.join(ctx.dir, 'products.csv');
    fs.writeFileSync(
      csv,
      `${HEADERS.join(',')}\nCSV-1,,CSV Cable,,,80,150,7,1\n`,
      'utf8',
    );
    const parsed = await parseProductFile(csv);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].values.name).toBe('CSV Cable');
  });

  it('records the spreadsheet row number so a problem can be found', async () => {
    const parsed = await parseProductFile(
      await writeSheet([
        ['A', '', 'One', '', '', 1, 2, 0, 0],
        ['B', '', 'Two', '', '', 1, 2, 0, 0],
      ]),
    );
    // Row 1 is the headings, so the first product is row 2.
    expect(parsed.rows.map((r) => r.line)).toEqual([2, 3]);
  });
});

// -----------------------------------------------------------------------------
// Validation (spec §57)
// -----------------------------------------------------------------------------

describe('validating the preview', () => {
  it('marks brand-new SKUs as creations', async () => {
    const result = await preview([['CBL-1', '', 'Cable', 'Cables', 'Generic', 80, 150, 10, 2]]);
    expect(result.summary).toMatchObject({ total: 1, create: 1, update: 0, skip: 0 });
    expect(rowFor(result, 'CBL-1').action).toBe('CREATE');
    // Prices arrive as minor units, never as floats.
    expect(rowFor(result, 'CBL-1').purchasePrice).toBe(8000);
    expect(rowFor(result, 'CBL-1').sellingPrice).toBe(15000);
  });

  it('marks a SKU the shop already has as an update', async () => {
    existingProduct('CBL-1');
    const result = await preview([['CBL-1', '', 'Cable', '', '', 80, 150, 10, 2]]);
    expect(result.summary).toMatchObject({ create: 0, update: 1, skip: 0 });
  });

  it('matches an existing SKU regardless of case', async () => {
    existingProduct('CBL-1');
    const result = await preview([['cbl-1', '', 'Cable', '', '', 80, 150, 10, 2]]);
    expect(result.summary.update).toBe(1);
  });

  it('refuses a row with no product name', async () => {
    const result = await preview([['CBL-1', '', '', '', '', 80, 150, 10, 2]]);
    expect(rowFor(result, 'CBL-1').action).toBe('SKIP');
    expect(rowFor(result, 'CBL-1').errors.join(' ')).toMatch(/name is missing/i);
  });

  it('refuses a row with no SKU', async () => {
    const result = await preview([['', '', 'Nameless', '', '', 80, 150, 10, 2]]);
    expect(result.rows[0].action).toBe('SKIP');
    expect(result.rows[0].errors.join(' ')).toMatch(/SKU is missing/i);
  });

  it('refuses the second row that repeats a SKU, and names the first', async () => {
    const result = await preview([
      ['CBL-1', '', 'Cable', '', '', 80, 150, 10, 2],
      ['CBL-1', '', 'Cable again', '', '', 80, 150, 10, 2],
    ]);
    expect(result.rows[0].action).toBe('CREATE');
    expect(result.rows[1].action).toBe('SKIP');
    expect(result.rows[1].errors.join(' ')).toMatch(/already used on row 2/);
  });

  it('refuses a barcode repeated inside the file', async () => {
    const result = await preview([
      ['CBL-1', '5901234123457', 'Cable', '', '', 80, 150, 10, 2],
      ['CBL-2', '5901234123457', 'Charger', '', '', 90, 200, 5, 1],
    ]);
    expect(result.rows[1].action).toBe('SKIP');
    expect(result.rows[1].errors.join(' ')).toMatch(/Barcode .* already used on row 2/);
  });

  it('refuses a barcode that belongs to a different product already', async () => {
    createProduct(
      {
        sku: 'OTHER',
        barcode: '5901234123457',
        name: 'Something else',
        purchasePrice: 1000,
        sellingPrice: 2000,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        initialStock: 0,
      },
      actor,
      ctx.db,
    );

    const result = await preview([['CBL-1', '5901234123457', 'Cable', '', '', 80, 150, 10, 2]]);
    expect(rowFor(result, 'CBL-1').action).toBe('SKIP');
    expect(rowFor(result, 'CBL-1').errors.join(' ')).toMatch(/already belongs to product OTHER/i);
  });

  it('allows a product to keep its own barcode on an update', async () => {
    createProduct(
      {
        sku: 'CBL-1',
        barcode: '5901234123457',
        name: 'Cable',
        purchasePrice: 1000,
        sellingPrice: 2000,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        initialStock: 0,
      },
      actor,
      ctx.db,
    );

    const result = await preview([['CBL-1', '5901234123457', 'Cable', '', '', 80, 150, 10, 2]]);
    expect(rowFor(result, 'CBL-1').action).toBe('UPDATE');
    expect(rowFor(result, 'CBL-1').errors).toHaveLength(0);
  });

  it('refuses a price that is not a number', async () => {
    const result = await preview([['CBL-1', '', 'Cable', '', '', 'about eighty', 150, 10, 2]]);
    expect(rowFor(result, 'CBL-1').action).toBe('SKIP');
    expect(rowFor(result, 'CBL-1').errors.join(' ')).toMatch(/not a valid purchase price/i);
  });

  it('refuses a negative price', async () => {
    const result = await preview([['CBL-1', '', 'Cable', '', '', '-80', 150, 10, 2]]);
    expect(rowFor(result, 'CBL-1').errors.join(' ')).toMatch(/cannot be negative/i);
  });

  it('refuses a new product with no selling price', async () => {
    const result = await preview([['CBL-1', '', 'Cable', '', '', 80, '', 10, 2]]);
    expect(rowFor(result, 'CBL-1').action).toBe('SKIP');
    expect(rowFor(result, 'CBL-1').errors.join(' ')).toMatch(/needs a selling price/i);
  });

  it('refuses stock that is not a whole number', async () => {
    const result = await preview([['CBL-1', '', 'Cable', '', '', 80, 150, '10.5', 2]]);
    expect(rowFor(result, 'CBL-1').action).toBe('SKIP');
    expect(rowFor(result, 'CBL-1').errors.join(' ')).toMatch(/not a valid stock quantity/i);
  });

  it('refuses negative stock', async () => {
    const result = await preview([['CBL-1', '', 'Cable', '', '', 80, 150, '-3', 2]]);
    expect(rowFor(result, 'CBL-1').action).toBe('SKIP');
  });

  it('accepts a thousands separator in stock and prices', async () => {
    const result = await preview([['CBL-1', '', 'Cable', '', '', '1,250.50', '1,999', '1,000', 0]]);
    const row = rowFor(result, 'CBL-1');
    expect(row.errors).toHaveLength(0);
    expect(row.purchasePrice).toBe(125050);
    expect(row.stock).toBe(1000);
  });

  it('warns rather than refuses when the selling price is below cost', async () => {
    const result = await preview([['CBL-1', '', 'Cable', '', '', 200, 150, 10, 2]]);
    const row = rowFor(result, 'CBL-1');
    expect(row.action).toBe('CREATE');
    expect(row.warnings.join(' ')).toMatch(/below the purchase price/i);
  });

  it('warns that an existing product’s stock will be corrected', async () => {
    existingProduct('CBL-1'); // opening stock 4
    const result = await preview([['CBL-1', '', 'Cable', '', '', 80, 150, 9, 2]]);
    expect(rowFor(result, 'CBL-1').warnings.join(' ')).toMatch(/corrected from 4 to 9/i);
  });

  it('warns that an IMEI-tracked product ignores the stock column', async () => {
    createProduct(
      {
        sku: 'PHONE-1',
        name: 'Phone',
        purchasePrice: 100000,
        sellingPrice: 200000,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: true,
        warrantyMonths: 12,
        initialStock: 0,
      },
      actor,
      ctx.db,
    );

    const result = await preview([['PHONE-1', '', 'Phone', '', '', 1000, 2000, 5, 0]]);
    expect(rowFor(result, 'PHONE-1').action).toBe('UPDATE');
    expect(rowFor(result, 'PHONE-1').warnings.join(' ')).toMatch(/tracked by IMEI/i);
  });

  it('lists the categories and brands the import would create', async () => {
    const result = await preview([
      ['CBL-1', '', 'Cable', 'Brand New Category', 'Brand New Brand', 80, 150, 10, 2],
      // "Cables" is one of the seeded defaults, so it must not be listed.
      ['CBL-2', '', 'Charger', 'Cables', '', 90, 200, 5, 1],
    ]);
    expect(result.summary.newCategories).toEqual(['Brand New Category']);
    expect(result.summary.newBrands).toEqual(['Brand New Brand']);
  });

  it('does not count categories from rows that will be skipped', async () => {
    const result = await preview([['CBL-1', '', '', 'Ghost Category', '', 80, 150, 10, 2]]);
    expect(result.summary.skip).toBe(1);
    expect(result.summary.newCategories).toHaveLength(0);
  });

  it('lets good rows through while refusing bad ones', async () => {
    const result = await preview([
      ['GOOD-1', '', 'Fine', '', '', 80, 150, 10, 2],
      ['', '', 'No SKU', '', '', 80, 150, 10, 2],
      ['GOOD-2', '', 'Also fine', '', '', 80, 150, 10, 2],
    ]);
    expect(result.summary).toMatchObject({ total: 3, create: 2, skip: 1 });
  });
});

// -----------------------------------------------------------------------------
// Committing
// -----------------------------------------------------------------------------

describe('committing the import', () => {
  it('creates the products, with stock in the ledger', async () => {
    const result = await preview([
      ['CBL-1', '5901234123457', 'USB-C Cable', 'Cables', 'Generic', 80, 150, 25, 5],
    ]);
    const outcome = commitProductImport(result.importId, actor, ctx.db);

    expect(outcome).toMatchObject({ created: 1, updated: 0, stockAdded: 25 });

    const products = listProducts({ page: 0, pageSize: 50, lowStockOnly: false, includeInactive: false }, ctx.db);
    const created = products.rows.find((p) => p.sku === 'CBL-1')!;
    expect(created.name).toBe('USB-C Cable');
    expect(created.barcode).toBe('5901234123457');
    expect(created.purchasePrice).toBe(8000);
    expect(created.sellingPrice).toBe(15000);
    expect(created.stockQuantity).toBe(25);
    expect(created.minimumStock).toBe(5);

    // Spec §66: stock never appears from nowhere.
    const history = inventoryHistory({ productId: created.id, limit: 50, offset: 0 }, ctx.db);
    expect(history.total).toBe(1);
    expect(history.rows[0].transactionType).toBe('PURCHASE');
    expect(history.rows[0].reason).toMatch(/import/i);
  });

  it('creates the categories and brands it needs', async () => {
    const before = listCategories(true, ctx.db).length;
    const result = await preview([
      ['CBL-1', '', 'Cable', 'Fresh Category', 'Fresh Brand', 80, 150, 10, 2],
      ['CBL-2', '', 'Charger', 'Fresh Category', 'Fresh Brand', 90, 200, 5, 1],
    ]);
    const outcome = commitProductImport(result.importId, actor, ctx.db);

    // Two rows share a category, so it is created once.
    expect(outcome.categoriesCreated).toBe(1);
    expect(outcome.brandsCreated).toBe(1);
    expect(listCategories(true, ctx.db)).toHaveLength(before + 1);
    expect(listBrands(true, ctx.db).some((b) => b.name === 'Fresh Brand')).toBe(true);
  });

  it('reuses a category that already exists, whatever its case', async () => {
    const before = listCategories(true, ctx.db).length;
    const result = await preview([['CBL-1', '', 'Cable', 'cables', '', 80, 150, 10, 2]]);
    const outcome = commitProductImport(result.importId, actor, ctx.db);

    expect(outcome.categoriesCreated).toBe(0);
    expect(listCategories(true, ctx.db)).toHaveLength(before);
  });

  it('updates an existing product without duplicating it', async () => {
    const product = existingProduct('CBL-1');
    const result = await preview([['CBL-1', '', 'Renamed Cable', '', '', 85, 175, 4, 3]]);
    const outcome = commitProductImport(result.importId, actor, ctx.db);

    expect(outcome).toMatchObject({ created: 0, updated: 1 });

    const products = listProducts({ page: 0, pageSize: 50, lowStockOnly: false, includeInactive: false }, ctx.db);
    const rows = products.rows.filter((p) => p.sku === 'CBL-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(product.id);
    expect(rows[0].name).toBe('Renamed Cable');
    expect(rows[0].sellingPrice).toBe(17500);
  });

  it('treats the stock column on an update as a stock count', async () => {
    const product = existingProduct('CBL-1'); // starts at 4
    const result = await preview([['CBL-1', '', 'Cable', '', '', 80, 150, 9, 2]]);
    commitProductImport(result.importId, actor, ctx.db);

    const products = listProducts({ page: 0, pageSize: 50, lowStockOnly: false, includeInactive: false }, ctx.db);
    expect(products.rows.find((p) => p.sku === 'CBL-1')!.stockQuantity).toBe(9);

    // Corrected to 9, not added to make 13 — and recorded as an adjustment.
    const history = inventoryHistory({ productId: product.id, limit: 50, offset: 0 }, ctx.db);
    const adjustment = history.rows.find((r) => r.transactionType === 'ADJUSTMENT')!;
    expect(adjustment.quantity).toBe(5);
    expect(adjustment.newStock).toBe(9);
  });

  it('records a downward stock correction even where negative stock is blocked', async () => {
    existingProduct('CBL-1'); // 4 in stock
    const result = await preview([['CBL-1', '', 'Cable', '', '', 80, 150, 1, 2]]);
    commitProductImport(result.importId, actor, ctx.db);

    const products = listProducts({ page: 0, pageSize: 50, lowStockOnly: false, includeInactive: false }, ctx.db);
    expect(products.rows.find((p) => p.sku === 'CBL-1')!.stockQuantity).toBe(1);
  });

  it('leaves a column out of the file alone rather than zeroing it', async () => {
    existingProduct('CBL-1'); // selling 90000, minimum 1
    // A file with no price columns at all.
    const result = await previewProductImport(
      await writeSheet([['CBL-1', 'Renamed']], ['SKU', 'Product Name']),
      ctx.db,
    );
    commitProductImport(result.importId, actor, ctx.db);

    const products = listProducts({ page: 0, pageSize: 50, lowStockOnly: false, includeInactive: false }, ctx.db);
    const row = products.rows.find((p) => p.sku === 'CBL-1')!;
    expect(row.name).toBe('Renamed');
    expect(row.sellingPrice).toBe(90000);
    expect(row.minimumStock).toBe(1);
  });

  it('writes nothing at all when every row is bad', async () => {
    const before = listProducts({ page: 0, pageSize: 50, lowStockOnly: false, includeInactive: false }, ctx.db).total;
    const result = await preview([['', '', '', '', '', 'x', 'y', 'z', 'w']]);

    expect(() => commitProductImport(result.importId, actor, ctx.db)).toThrowError(
      /nothing to import/i,
    );
    expect(
      listProducts({ page: 0, pageSize: 50, lowStockOnly: false, includeInactive: false }, ctx.db).total,
    ).toBe(before);
  });

  it('imports the good rows and reports the skipped ones', async () => {
    const result = await preview([
      ['GOOD-1', '', 'Fine', '', '', 80, 150, 3, 0],
      ['', '', 'No SKU', '', '', 80, 150, 3, 0],
    ]);
    const outcome = commitProductImport(result.importId, actor, ctx.db);
    expect(outcome).toMatchObject({ created: 1, skipped: 1 });
  });

  it('records the import in the audit trail', async () => {
    const result = await preview([['CBL-1', '', 'Cable', '', '', 80, 150, 10, 2]]);
    commitProductImport(result.importId, actor, ctx.db);

    const entry = ctx.db
      .prepare(`SELECT action, summary FROM "AuditLog" WHERE action = 'IMPORT'`)
      .get() as { action: string; summary: string };
    expect(entry.action).toBe('IMPORT');
    expect(entry.summary).toMatch(/1 created/);
  });

  it('re-checks against the database, so a stale preview cannot duplicate a SKU', async () => {
    // Previewed while CBL-1 did not exist...
    const result = await preview([['CBL-1', '', 'Cable', '', '', 80, 150, 10, 2]]);
    expect(result.summary.create).toBe(1);

    // ...but someone adds it on another screen before Import is pressed.
    existingProduct('CBL-1');

    const outcome = commitProductImport(result.importId, actor, ctx.db);
    // Re-analysis turns the creation into an update rather than a duplicate.
    expect(outcome).toMatchObject({ created: 0, updated: 1 });
    expect(
      listProducts({ page: 0, pageSize: 50, lowStockOnly: false, includeInactive: false }, ctx.db).rows.filter(
        (p) => p.sku === 'CBL-1',
      ),
    ).toHaveLength(1);
  });

  it('forgets the parse once committed, so Import cannot run twice', async () => {
    const result = await preview([['CBL-1', '', 'Cable', '', '', 80, 150, 10, 2]]);
    commitProductImport(result.importId, actor, ctx.db);

    expect(() => commitProductImport(result.importId, actor, ctx.db)).toThrowError(
      /no longer open/i,
    );
  });

  it('rejects an import id it never issued', () => {
    expect(() => commitProductImport('made-up-id', actor, ctx.db)).toThrowError(/no longer open/i);
  });

  it('keeps only the most recent few previews in memory', async () => {
    const first = await preview([['A-1', '', 'One', '', '', 1, 2, 0, 0]]);
    for (let i = 0; i < 4; i += 1) {
      await preview([[`B-${i}`, '', 'Filler', '', '', 1, 2, 0, 0]]);
    }
    // The cache is bounded, so the oldest is gone rather than pinned forever.
    expect(() => commitProductImport(first.importId, actor, ctx.db)).toThrowError(/no longer open/i);
  });
});

describe('the template', () => {
  it('writes a workbook whose own headings the parser accepts', async () => {
    const target = path.join(ctx.dir, 'template.xlsx');
    await writeImportTemplate(target);

    expect(fs.statSync(target).size).toBeGreaterThan(3000);
    // The template is only useful if filling it in and importing it works.
    const parsed = await parseProductFile(target);
    expect(parsed.missingColumns).toHaveLength(0);

    const analysis = analyseProductImport(parsed, ctx.db);
    expect(analysis.summary.skip).toBe(0);
    expect(analysis.summary.create).toBe(2);

    // And the example rows really do import.
    const outcome = commitProductImport(rememberParse(parsed), actor, ctx.db);
    expect(outcome.created).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// List export (spec §56)
// -----------------------------------------------------------------------------

describe('exporting a list', () => {
  function seedShop() {
    const cable = createProduct(
      {
        sku: 'CBL-1',
        name: 'USB-C Cable',
        purchasePrice: 80000,
        sellingPrice: 100000,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 2,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        initialStock: 10,
      },
      actor,
      ctx.db,
    );
    const customer = createCustomer({ name: 'Nok', phone: '0812345678' }, actor, ctx.db);
    const sale = createSale(
      {
        customerId: customer.id,
        items: [{ productId: cable.id, quantity: 2 }],
        discountAmount: 0,
        payments: [{ amount: 200000, paymentMethod: 'CASH' }],
      },
      actor,
      ctx.db,
    );
    const category = listExpenseCategories(false, ctx.db)[0];
    createExpense(
      {
        categoryId: category.id,
        expenseDay: TODAY,
        description: 'Shop rent',
        amount: 1500000,
        paymentMethod: 'CASH',
      },
      actor,
      ctx.db,
    );
    return { cable, customer, sale };
  }

  it('describes the products list with its filters named', () => {
    seedShop();
    const report = buildListExport(
      {
        dataset: 'PRODUCT_LIST',
        query: { lowStockOnly: false, includeInactive: false, page: 0, pageSize: 25 },
      },
      ctx.db,
    );

    expect(report.kind).toBe('PRODUCT_LIST');
    expect(report.title).toBe('Products List');
    expect(report.periodLabel).toMatch(/Active only/);
    expect(report.tables[0].rows).toHaveLength(1);
    expect(report.tables[0].rows[0]).toMatchObject({ sku: 'CBL-1', stockQuantity: 8 });
  });

  it('exports everything the filter matches, not just the page on screen', () => {
    for (let i = 0; i < 30; i += 1) {
      createProduct(
        {
          sku: `SKU-${i}`,
          name: `Product ${i}`,
          purchasePrice: 1000,
          sellingPrice: 2000,
          taxRate: 0,
          taxRateOverride: false,
          minimumStock: 0,
          unit: 'pcs',
          isSerialized: false,
          warrantyMonths: 0,
          initialStock: 1,
        },
        actor,
        ctx.db,
      );
    }

    // The screen was showing 10 per page; the file must still hold all 30.
    const report = buildListExport(
      {
        dataset: 'PRODUCT_LIST',
        query: { lowStockOnly: false, includeInactive: false, page: 2, pageSize: 10 },
      },
      ctx.db,
    );
    expect(report.tables[0].rows).toHaveLength(30);
  });

  it('honours the search filter it was given', () => {
    seedShop();
    const report = buildListExport(
      {
        dataset: 'PRODUCT_LIST',
        query: {
          search: 'nothing-matches-this',
          lowStockOnly: false,
          includeInactive: false,
          page: 0,
          pageSize: 25,
        },
      },
      ctx.db,
    );
    expect(report.tables[0].rows).toHaveLength(0);
    expect(report.periodLabel).toMatch(/Search "nothing-matches-this"/);
  });

  it('describes the customers list with lifetime spend', () => {
    seedShop();
    const report = buildListExport(
      {
        dataset: 'CUSTOMER_LIST',
        query: { includeInactive: false, page: 0, pageSize: 25 },
      },
      ctx.db,
    );
    expect(report.tables[0].rows[0]).toMatchObject({ name: 'Nok', totalOrders: 1 });
    expect(report.tables[0].totals?.totalSpent).toBe(200000);
  });

  it('describes the sales list and totals what was actually taken', () => {
    seedShop();
    const report = buildListExport(
      {
        dataset: 'SALE_LIST',
        query: { from: TODAY, to: TODAY, page: 0, pageSize: 25 },
      },
      ctx.db,
    );
    expect(report.tables[0].rows).toHaveLength(1);
    expect(report.tables[0].totals?.grandTotal).toBe(200000);
    const net = report.figures.find((f) => f.label === 'Net taken');
    expect(net?.value).toBe(200000);
  });

  it('describes the expenses list with its total', () => {
    seedShop();
    const report = buildListExport(
      {
        dataset: 'EXPENSE_LIST',
        query: { includeDeleted: false, page: 0, pageSize: 25 },
      },
      ctx.db,
    );
    expect(report.tables[0].rows[0]).toMatchObject({ description: 'Shop rent', amount: 1500000 });
    expect(report.tables[0].totals?.amount).toBe(1500000);
  });

  it('gives the inventory sheet a blank column to write counts into', () => {
    seedShop();
    const report = buildListExport({ dataset: 'INVENTORY_LIST', query: {} }, ctx.db);
    const table = report.tables[0];
    expect(table.columns.some((column) => column.key === 'counted')).toBe(true);
    expect(table.rows[0].counted).toBe('');
    // 8 remaining at 800.00 cost.
    expect(table.totals?.stockValue).toBe(640000);
  });

  it('gives every row every column the renderer will read', () => {
    seedShop();
    const datasets: ListExportQuery[] = [
      { dataset: 'PRODUCT_LIST', query: { lowStockOnly: false, includeInactive: false, page: 0, pageSize: 25 } },
      { dataset: 'CUSTOMER_LIST', query: { includeInactive: false, page: 0, pageSize: 25 } },
      { dataset: 'SALE_LIST', query: { page: 0, pageSize: 25 } },
      { dataset: 'EXPENSE_LIST', query: { includeDeleted: false, page: 0, pageSize: 25 } },
      { dataset: 'INVENTORY_LIST', query: {} },
    ];

    for (const input of datasets) {
      const report = buildListExport(input, ctx.db);
      for (const table of report.tables) {
        for (const row of table.rows) {
          for (const column of table.columns) {
            expect(
              Object.prototype.hasOwnProperty.call(row, column.key),
              `${input.dataset}.${table.title} row is missing "${column.key}"`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('produces a Windows-safe filename stem', () => {
    const stem = listFileStem('PRODUCT_LIST');
    expect(stem.startsWith('product-list_')).toBe(true);
    expect(stem).not.toMatch(/[\\/:*?"<>|]/);
  });
});
