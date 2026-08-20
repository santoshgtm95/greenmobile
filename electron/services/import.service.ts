/**
 * Product import from Excel or CSV (spec §57).
 *
 * The shape of this feature is set by one rule: **nothing is written until the
 * user has seen exactly what will happen.** So it is two passes.
 *
 *   1. parse + analyse  → a preview naming, per row, what will be created,
 *                         what will be updated and what will be refused and why
 *   2. commit           → one transaction over the rows that passed
 *
 * The renderer never sends the rows back. It sends the id of a parse the main
 * process is holding, which is re-analysed against the database as it stands at
 * that moment — so a preview that has gone stale (someone added the same SKU on
 * another screen) cannot smuggle in a duplicate.
 */
import ExcelJS from 'exceljs';
import type { Database as Db } from 'better-sqlite3';
import path from 'node:path';
import { getDatabase, transaction } from '../database/connection';
import { newId } from '../utils/id';
import { logger } from '../utils/logger';
import { nowInstant } from '../../shared/datetime';
import { parseMoney, toMajor } from '../../shared/money';
import { errors } from '../../shared/errors';
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_ALIASES,
  IMPORT_FIELD_LABELS,
  MAX_IMPORT_ROWS,
  type ImportField,
  type ImportPreview,
  type ImportResult,
  type ImportRow,
} from '../../shared/import';
import { applyStockMovement } from './inventory.service';
import { getShopSettings } from './settings.service';
import { recordAudit } from './audit.service';
import type { SessionUser } from '../session';

/** One spreadsheet row, already mapped onto our field names, still as text. */
type RawRow = { line: number; values: Partial<Record<ImportField, string>> };

interface ParsedFile {
  fileName: string;
  filePath: string;
  matchedColumns: Partial<Record<ImportField, string>>;
  missingColumns: ImportField[];
  rows: RawRow[];
}

// -----------------------------------------------------------------------------
// Reading the file
// -----------------------------------------------------------------------------

/** Header matching is deliberately lenient: "Selling Price" == "sellingprice". */
function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * ExcelJS hands back numbers, strings, dates, hyperlink objects, rich text and
 * formula results. Everything the importer cares about is text or a number.
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const candidate = value as {
      text?: string;
      result?: unknown;
      richText?: Array<{ text: string }>;
      hyperlink?: string;
    };
    if (Array.isArray(candidate.richText)) {
      return candidate.richText.map((part) => part.text).join('').trim();
    }
    if (typeof candidate.text === 'string') return candidate.text.trim();
    if (candidate.result !== undefined && candidate.result !== null) {
      return String(candidate.result).trim();
    }
  }
  return '';
}

async function loadWorksheet(filePath: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  const extension = path.extname(filePath).toLowerCase();

  try {
    if (extension === '.csv') {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }
  } catch (err) {
    logger.warn('Import file could not be read', {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw errors.importFailed(
      'That file could not be opened. Save it as .xlsx or .csv and try again.',
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw errors.importFailed('That file has no worksheets.');
  return sheet;
}

/** Reads the first worksheet and maps its columns onto our field names. */
export async function parseProductFile(filePath: string): Promise<ParsedFile> {
  const sheet = await loadWorksheet(filePath);

  const headerRow = sheet.getRow(1);
  const columnFor = new Map<number, ImportField>();
  const matchedColumns: Partial<Record<ImportField, string>> = {};

  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const label = cellText(cell.value);
    if (!label) return;
    const key = normaliseHeader(label);
    for (const field of IMPORT_FIELDS) {
      if (matchedColumns[field]) continue;
      if (IMPORT_FIELD_ALIASES[field].includes(key)) {
        columnFor.set(columnNumber, field);
        matchedColumns[field] = label;
        return;
      }
    }
  });

  const missingColumns = IMPORT_FIELDS.filter((field) => !matchedColumns[field]);

  // Name and SKU are the two the importer cannot invent.
  if (!matchedColumns.name || !matchedColumns.sku) {
    throw errors.importFailed(
      'The first row of the file must name the columns. ' +
        `At least "${IMPORT_FIELD_LABELS.sku}" and "${IMPORT_FIELD_LABELS.name}" are needed.`,
    );
  }

  const rows: RawRow[] = [];
  let truncated = false;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    if (rows.length >= MAX_IMPORT_ROWS) {
      truncated = true;
      return;
    }

    const values: Partial<Record<ImportField, string>> = {};
    let hasContent = false;
    for (const [columnNumber, field] of columnFor) {
      const text = cellText(row.getCell(columnNumber).value);
      if (text) {
        values[field] = text;
        hasContent = true;
      }
    }
    // A trailing formatted-but-empty row is not a product.
    if (hasContent) rows.push({ line: rowNumber, values });
  });

  if (truncated) {
    logger.warn('Import file truncated at the row limit', {
      filePath,
      limit: MAX_IMPORT_ROWS,
    });
  }
  if (rows.length === 0) {
    throw errors.importFailed('That file has column headings but no product rows.');
  }

  return {
    fileName: path.basename(filePath),
    filePath,
    matchedColumns,
    missingColumns,
    rows,
  };
}

// -----------------------------------------------------------------------------
// Analysis
// -----------------------------------------------------------------------------

interface ExistingProduct {
  id: string;
  sku: string;
  name: string;
  isSerialized: number;
  stockQuantity: number;
  purchasePrice: number;
}

/** Parses a whole number from a cell, tolerating "10", "10.0" and "1,000". */
function parseCount(text: string | undefined): number | null {
  if (text === undefined || text === '') return null;
  const cleaned = text.replace(/[\s,_]/g, '');
  if (!/^\d+(\.0+)?$/.test(cleaned)) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Decides what will happen to each row (spec §57).
 *
 * Runs against the live database, so it is cheap enough to repeat at commit
 * time — which is the point: the preview is advisory, this is the check.
 */
export function analyseProductImport(parsed: ParsedFile, db: Db = getDatabase()): ImportPreview {
  const bySku = new Map<string, ExistingProduct>();
  const barcodeOwner = new Map<string, string>();

  for (const row of db
    .prepare(
      `SELECT id, sku, barcode, name, isSerialized, stockQuantity, purchasePrice FROM "Product"`,
    )
    .all() as Array<ExistingProduct & { barcode: string | null }>) {
    bySku.set(row.sku.toLowerCase(), row);
    if (row.barcode) barcodeOwner.set(row.barcode, row.sku.toLowerCase());
  }

  const existingCategories = new Set(
    (db.prepare(`SELECT name FROM "Category"`).all() as Array<{ name: string }>).map((c) =>
      c.name.toLowerCase(),
    ),
  );
  const existingBrands = new Set(
    (db.prepare(`SELECT name FROM "Brand"`).all() as Array<{ name: string }>).map((b) =>
      b.name.toLowerCase(),
    ),
  );

  const seenSkus = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();
  const newCategories = new Set<string>();
  const newBrands = new Set<string>();

  const rows: ImportRow[] = parsed.rows.map((raw) => {
    const errorList: string[] = [];
    const warnings: string[] = [];
    const v = raw.values;

    const sku = (v.sku ?? '').trim();
    const name = (v.name ?? '').trim();
    const barcode = (v.barcode ?? '').trim() || null;
    const category = (v.category ?? '').trim() || null;
    const brand = (v.brand ?? '').trim() || null;

    if (!name) errorList.push('Product name is missing.');
    if (name.length > 200) errorList.push('Product name is longer than 200 characters.');
    if (!sku) errorList.push('SKU is missing.');
    if (sku.length > 60) errorList.push('SKU is longer than 60 characters.');

    // Duplicates *within the file* — the second occurrence is the problem.
    const skuKey = sku.toLowerCase();
    if (sku) {
      const firstLine = seenSkus.get(skuKey);
      if (firstLine !== undefined) {
        errorList.push(`SKU "${sku}" is already used on row ${firstLine} of this file.`);
      } else {
        seenSkus.set(skuKey, raw.line);
      }
    }

    const existing = sku ? bySku.get(skuKey) : undefined;

    if (barcode) {
      if (barcode.length > 60) errorList.push('Barcode is longer than 60 characters.');
      const firstLine = seenBarcodes.get(barcode);
      if (firstLine !== undefined) {
        errorList.push(`Barcode "${barcode}" is already used on row ${firstLine} of this file.`);
      } else {
        seenBarcodes.set(barcode, raw.line);
      }
      const owner = barcodeOwner.get(barcode);
      if (owner && owner !== skuKey) {
        errorList.push(`Barcode "${barcode}" already belongs to product ${owner.toUpperCase()}.`);
      }
    }

    const purchasePrice = v.purchasePrice === undefined ? null : parseMoney(v.purchasePrice);
    const sellingPrice = v.sellingPrice === undefined ? null : parseMoney(v.sellingPrice);

    if (v.purchasePrice !== undefined && purchasePrice === null) {
      errorList.push(`"${v.purchasePrice}" is not a valid purchase price.`);
    } else if (purchasePrice !== null && purchasePrice < 0) {
      errorList.push('Purchase price cannot be negative.');
    }

    if (v.sellingPrice !== undefined && sellingPrice === null) {
      errorList.push(`"${v.sellingPrice}" is not a valid selling price.`);
    } else if (sellingPrice !== null && sellingPrice < 0) {
      errorList.push('Selling price cannot be negative.');
    }

    if (!existing && sellingPrice === null) {
      errorList.push('A new product needs a selling price.');
    }

    if (
      purchasePrice !== null &&
      sellingPrice !== null &&
      sellingPrice > 0 &&
      sellingPrice < purchasePrice
    ) {
      warnings.push(
        `Selling price (${toMajor(sellingPrice)}) is below the purchase price (${toMajor(purchasePrice)}).`,
      );
    }

    const stock = v.stock === undefined ? null : parseCount(v.stock);
    if (v.stock !== undefined && stock === null) {
      errorList.push(`"${v.stock}" is not a valid stock quantity.`);
    }

    const minimumStock = v.minimumStock === undefined ? null : parseCount(v.minimumStock);
    if (v.minimumStock !== undefined && minimumStock === null) {
      errorList.push(`"${v.minimumStock}" is not a valid minimum stock.`);
    }

    if (existing && stock !== null) {
      if (existing.isSerialized) {
        warnings.push(
          'This product is tracked by IMEI, so its stock comes from its serial numbers. ' +
            'The Stock column is ignored.',
        );
      } else if (stock !== existing.stockQuantity) {
        warnings.push(
          `Stock will be corrected from ${existing.stockQuantity} to ${stock}, recorded in the stock ledger.`,
        );
      }
    }

    const action = errorList.length > 0 ? 'SKIP' : existing ? 'UPDATE' : 'CREATE';

    if (action !== 'SKIP') {
      if (category && !existingCategories.has(category.toLowerCase())) newCategories.add(category);
      if (brand && !existingBrands.has(brand.toLowerCase())) newBrands.add(brand);
    }

    return {
      line: raw.line,
      action,
      sku,
      barcode,
      name,
      category,
      brand,
      purchasePrice,
      sellingPrice,
      stock,
      minimumStock,
      errors: errorList,
      warnings,
    };
  });

  return {
    importId: '',
    fileName: parsed.fileName,
    matchedColumns: parsed.matchedColumns,
    missingColumns: parsed.missingColumns,
    rows,
    summary: {
      total: rows.length,
      create: rows.filter((r) => r.action === 'CREATE').length,
      update: rows.filter((r) => r.action === 'UPDATE').length,
      skip: rows.filter((r) => r.action === 'SKIP').length,
      newCategories: [...newCategories].sort(),
      newBrands: [...newBrands].sort(),
    },
  };
}

// -----------------------------------------------------------------------------
// The pending-parse cache
// -----------------------------------------------------------------------------

/**
 * Parses waiting for the user to press Import.
 *
 * Small and bounded: this is a desktop application with one person at the
 * keyboard, and an abandoned preview should not pin a spreadsheet in memory.
 */
const pending = new Map<string, ParsedFile>();
const MAX_PENDING = 3;

export function rememberParse(parsed: ParsedFile): string {
  const importId = newId();
  pending.set(importId, parsed);
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  return importId;
}

export function recallParse(importId: string): ParsedFile {
  const parsed = pending.get(importId);
  if (!parsed) {
    throw errors.validation('That import is no longer open. Choose the file again.');
  }
  return parsed;
}

export function forgetParse(importId: string): void {
  pending.delete(importId);
}

/** Parses a file and holds it for a later commit. */
export async function previewProductImport(
  filePath: string,
  db: Db = getDatabase(),
): Promise<ImportPreview> {
  const parsed = await parseProductFile(filePath);
  const preview = analyseProductImport(parsed, db);
  preview.importId = rememberParse(parsed);
  logger.info('Product import previewed', {
    file: parsed.fileName,
    rows: preview.summary.total,
    create: preview.summary.create,
    update: preview.summary.update,
    skip: preview.summary.skip,
  });
  return preview;
}

// -----------------------------------------------------------------------------
// Committing
// -----------------------------------------------------------------------------

function lookupOrCreate(
  table: 'Category' | 'Brand',
  name: string,
  cache: Map<string, string>,
  created: { count: number },
  db: Db,
): string {
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = db
    .prepare(`SELECT id FROM "${table}" WHERE name = ? COLLATE NOCASE`)
    .get(name) as { id: string } | undefined;
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }

  const id = newId();
  const now = nowInstant();
  db.prepare(
    `INSERT INTO "${table}" (id, name, description, isActive, createdAt, updatedAt)
     VALUES (?, ?, NULL, 1, ?, ?)`,
  ).run(id, name, now, now);
  cache.set(key, id);
  created.count += 1;
  return id;
}

/**
 * Writes the import (spec §57).
 *
 * One transaction for the whole file: an import that fails half way through
 * would leave the shop with a catalogue nobody can reason about, so it either
 * all lands or none of it does.
 */
export function commitProductImport(
  importId: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): ImportResult {
  const parsed = recallParse(importId);
  const preview = analyseProductImport(parsed, db);
  const settings = getShopSettings(db);

  const usable = preview.rows.filter((row) => row.action !== 'SKIP');
  if (usable.length === 0) {
    throw errors.validation('There is nothing to import — every row has a problem.');
  }

  const result = transaction(() => {
    const categoryCache = new Map<string, string>();
    const brandCache = new Map<string, string>();
    const categoriesCreated = { count: 0 };
    const brandsCreated = { count: 0 };

    let created = 0;
    let updated = 0;
    let stockAdded = 0;

    const insert = db.prepare(
      `INSERT INTO "Product" (id, sku, barcode, name, description, categoryId, brandId,
         purchasePrice, sellingPrice, taxRate, taxRateOverride, stockQuantity, minimumStock,
         unit, isSerialized, warrantyMonths, isActive, createdAt, updatedAt, createdBy, updatedBy)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, 0, 0, ?, 'pcs', 0, 0, 1, ?, ?, ?, ?)`,
    );

    for (const row of usable) {
      const categoryId = row.category
        ? lookupOrCreate('Category', row.category, categoryCache, categoriesCreated, db)
        : null;
      const brandId = row.brand
        ? lookupOrCreate('Brand', row.brand, brandCache, brandsCreated, db)
        : null;
      const now = nowInstant();

      if (row.action === 'CREATE') {
        const id = newId();
        insert.run(
          id,
          row.sku,
          row.barcode,
          row.name,
          categoryId,
          brandId,
          row.purchasePrice ?? 0,
          row.sellingPrice ?? 0,
          row.minimumStock ?? 0,
          now,
          now,
          actor.id,
          actor.id,
        );
        created += 1;

        // Opening stock is a ledger movement like any other, so it can never
        // appear from nowhere (spec §66).
        if (row.stock && row.stock > 0) {
          applyStockMovement(
            {
              productId: id,
              quantity: row.stock,
              transactionType: 'PURCHASE',
              reason: `Opening stock from import "${parsed.fileName}"`,
              createdBy: actor.id,
              unitCost: row.purchasePrice ?? 0,
              referenceType: 'IMPORT',
              referenceId: importId,
            },
            { allowNegativeStock: settings.allowNegativeStock },
            db,
          );
          stockAdded += row.stock;
        }
        continue;
      }

      // UPDATE. stockQuantity is deliberately not in this statement — stock only
      // ever moves through applyStockMovement.
      const existing = db
        .prepare(
          `SELECT id, isSerialized, stockQuantity, purchasePrice FROM "Product"
            WHERE sku = ? COLLATE NOCASE`,
        )
        .get(row.sku) as
        | { id: string; isSerialized: number; stockQuantity: number; purchasePrice: number }
        | undefined;
      if (!existing) continue;

      db.prepare(
        `UPDATE "Product"
            SET name = ?,
                barcode = COALESCE(?, barcode),
                categoryId = COALESCE(?, categoryId),
                brandId = COALESCE(?, brandId),
                purchasePrice = COALESCE(?, purchasePrice),
                sellingPrice = COALESCE(?, sellingPrice),
                minimumStock = COALESCE(?, minimumStock),
                updatedAt = ?, updatedBy = ?
          WHERE id = ?`,
      ).run(
        row.name,
        row.barcode,
        categoryId,
        brandId,
        row.purchasePrice,
        row.sellingPrice,
        row.minimumStock,
        now,
        actor.id,
        existing.id,
      );
      updated += 1;

      // A spreadsheet stating a stock level is a stock count, so it is applied
      // as a correction to that level rather than added to what is there.
      if (row.stock !== null && !existing.isSerialized) {
        const delta = row.stock - existing.stockQuantity;
        if (delta !== 0) {
          applyStockMovement(
            {
              productId: existing.id,
              quantity: delta,
              transactionType: 'ADJUSTMENT',
              reason: `Stock corrected by import "${parsed.fileName}"`,
              createdBy: actor.id,
              unitCost: row.purchasePrice ?? existing.purchasePrice,
              referenceType: 'IMPORT',
              referenceId: importId,
              // A count that finds fewer than recorded must be recordable even
              // where the shop otherwise blocks negative stock.
              allowNegative: true,
            },
            { allowNegativeStock: settings.allowNegativeStock },
            db,
          );
          if (delta > 0) stockAdded += delta;
        }
      }
    }

    const summary: ImportResult = {
      created,
      updated,
      skipped: preview.summary.skip,
      categoriesCreated: categoriesCreated.count,
      brandsCreated: brandsCreated.count,
      stockAdded,
    };

    recordAudit(
      {
        userId: actor.id,
        action: 'IMPORT',
        entityName: 'Product',
        entityId: importId,
        summary:
          `Imported "${parsed.fileName}" — ${created} created, ${updated} updated, ` +
          `${summary.skipped} skipped`,
        newValues: summary,
      },
      db,
    );

    return summary;
  }, db);

  forgetParse(importId);
  logger.info('Product import committed', { file: parsed.fileName, ...result });
  return result;
}

// -----------------------------------------------------------------------------
// Template
// -----------------------------------------------------------------------------

/** Writes an empty spreadsheet with the right headings and two examples. */
export async function writeImportTemplate(targetPath: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Green Mobile';
  const sheet = workbook.addWorksheet('Products');

  sheet.columns = IMPORT_FIELDS.map((field) => ({
    header: IMPORT_FIELD_LABELS[field],
    key: field,
    width: field === 'name' ? 34 : 16,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  sheet.addRow({
    sku: 'CBL-USBC-1M',
    barcode: '5901234123457',
    name: 'USB-C Cable 1 m',
    category: 'Cables',
    brand: 'Generic',
    purchasePrice: 80,
    sellingPrice: 150,
    stock: 25,
    minimumStock: 5,
  });
  sheet.addRow({
    sku: 'CASE-A54-CLR',
    barcode: '',
    name: 'Galaxy A54 Clear Case',
    category: 'Cases & Covers',
    brand: 'Samsung',
    purchasePrice: 60,
    sellingPrice: 190,
    stock: 12,
    minimumStock: 3,
  });

  const notes = workbook.addWorksheet('How to use');
  notes.columns = [{ width: 22 }, { width: 90 }];
  notes.getColumn(1).font = { bold: true };
  const lines: Array<[string, string]> = [
    ['Sheet', 'Fill in the "Products" sheet. Only the first sheet is read.'],
    ['SKU', 'Required. Your own code for the product. An existing SKU updates that product.'],
    ['Product Name', 'Required.'],
    ['Barcode', 'Optional. Must not already belong to a different product.'],
    ['Category / Brand', 'Optional. Created automatically if they do not exist yet.'],
    ['Prices', 'Plain amounts, e.g. 150 or 150.50. A new product needs a selling price.'],
    ['Stock', 'Whole number. On an existing product this corrects the level and is recorded in the stock ledger.'],
    ['Minimum Stock', 'Whole number. Used for the low-stock warning.'],
    ['Headings', 'Row 1 must contain the headings. Common alternatives such as "Cost" or "Qty" are also recognised.'],
    ['IMEI products', 'Phones tracked by IMEI cannot get their stock from this file — add their IMEIs on the product.'],
  ];
  for (const [label, text] of lines) notes.addRow([label, text]);

  await workbook.xlsx.writeFile(targetPath);
  logger.info('Import template written', { targetPath });
  return targetPath;
}
