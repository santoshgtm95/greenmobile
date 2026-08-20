/**
 * Product import vocabulary (spec §57).
 *
 * A shop's existing stock list arrives as a spreadsheet somebody else made, so
 * the column names are matched leniently — but the *values* are not. Every row
 * is validated before anything is written, and the preview shows exactly what
 * will happen to each one.
 */

export const IMPORT_FIELDS = [
  'sku',
  'barcode',
  'name',
  'category',
  'brand',
  'purchasePrice',
  'sellingPrice',
  'stock',
  'minimumStock',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** The headings written into the template, in order. */
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  sku: 'SKU',
  barcode: 'Barcode',
  name: 'Product Name',
  category: 'Category',
  brand: 'Brand',
  purchasePrice: 'Purchase Price',
  sellingPrice: 'Selling Price',
  stock: 'Stock',
  minimumStock: 'Minimum Stock',
};

/**
 * Accepted headings per field, lower-cased with spaces and punctuation removed.
 * Anyone exporting from another POS tends to have one of these.
 */
export const IMPORT_FIELD_ALIASES: Record<ImportField, string[]> = {
  sku: ['sku', 'code', 'productcode', 'itemcode', 'articlenumber'],
  barcode: ['barcode', 'ean', 'upc', 'gtin', 'scancode'],
  name: ['productname', 'name', 'product', 'description', 'itemname', 'title'],
  category: ['category', 'categoryname', 'group', 'productgroup', 'type'],
  brand: ['brand', 'brandname', 'make', 'manufacturer'],
  purchasePrice: ['purchaseprice', 'costprice', 'cost', 'buyprice', 'buyingprice', 'purchase'],
  sellingPrice: ['sellingprice', 'saleprice', 'price', 'retailprice', 'sellprice', 'selling'],
  stock: ['stock', 'quantity', 'qty', 'stockquantity', 'onhand', 'openingstock'],
  minimumStock: ['minimumstock', 'minstock', 'min', 'reorderlevel', 'reorderpoint', 'minimum'],
};

/** What committing the import will do to a row. */
export type ImportAction = 'CREATE' | 'UPDATE' | 'SKIP';

export const IMPORT_ACTION_LABELS: Record<ImportAction, string> = {
  CREATE: 'New product',
  UPDATE: 'Update existing',
  SKIP: 'Not imported',
};

export interface ImportRow {
  /** 1-based row number in the spreadsheet, so the user can go and fix it. */
  line: number;
  action: ImportAction;
  sku: string;
  barcode: string | null;
  name: string;
  category: string | null;
  brand: string | null;
  /** Minor units, or null when the cell could not be read as an amount. */
  purchasePrice: number | null;
  sellingPrice: number | null;
  stock: number | null;
  minimumStock: number | null;
  /** Anything here means the row is skipped. */
  errors: string[];
  /** Worth seeing, but not a reason to refuse the row. */
  warnings: string[];
}

export interface ImportPreview {
  /** Identifies this parse so the commit reads the file, not the renderer. */
  importId: string;
  fileName: string;
  /** Which spreadsheet column was matched to each field. */
  matchedColumns: Partial<Record<ImportField, string>>;
  /** Fields with no matching column in the file. */
  missingColumns: ImportField[];
  rows: ImportRow[];
  summary: {
    total: number;
    create: number;
    update: number;
    skip: number;
    /** Categories and brands that will be created by the import. */
    newCategories: string[];
    newBrands: string[];
  };
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  categoriesCreated: number;
  brandsCreated: number;
  /** Total units of opening stock the import brought in. */
  stockAdded: number;
}

/** Cap on a single import, so one bad file cannot lock the UI for a minute. */
export const MAX_IMPORT_ROWS = 5000;
