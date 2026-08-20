/**
 * The shape every report takes (spec §46–§50, §90).
 *
 * There are eight reports and four output formats. Rather than write thirty-two
 * combinations, each report describes itself as data — headline figures plus one
 * or more tables with typed columns — and a single renderer draws it on screen
 * while a single exporter turns the same structure into Excel, CSV, PDF or a
 * printed page.
 *
 * Adding a report therefore means describing it, not building a screen and four
 * exporters.
 */

export const REPORT_KINDS = [
  'SALES',
  'REVENUE',
  'EXPENSES',
  'PROFIT_LOSS',
  'INVENTORY',
  'PRODUCTS',
  'CUSTOMERS',
  'SERVICES',
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LABELS: Record<ReportKind, string> = {
  SALES: 'Sales',
  REVENUE: 'Revenue',
  EXPENSES: 'Expenses',
  PROFIT_LOSS: 'Profit & Loss',
  INVENTORY: 'Inventory',
  PRODUCTS: 'Products',
  CUSTOMERS: 'Customers',
  SERVICES: 'Services',
};

/**
 * Exportable list screens (spec §56).
 *
 * These are not reports — they are "what is on my screen right now, as a file",
 * so they carry the screen's own filters rather than a date range. They travel
 * as the same described structure, which is why one exporter serves both.
 */
export const LIST_DATASETS = [
  'PRODUCT_LIST',
  'CUSTOMER_LIST',
  'SALE_LIST',
  'EXPENSE_LIST',
  'BANK_TRANSACTION_LIST',
  'INVENTORY_LIST',
] as const;

export type ListDataset = (typeof LIST_DATASETS)[number];

export const LIST_DATASET_LABELS: Record<ListDataset, string> = {
  PRODUCT_LIST: 'Products',
  CUSTOMER_LIST: 'Customers',
  SALE_LIST: 'Sales',
  EXPENSE_LIST: 'Expenses',
  BANK_TRANSACTION_LIST: 'Bank Transaction',
  INVENTORY_LIST: 'Inventory',
};

/**
 * How a value should be read, not how it should look.
 *
 * `money` values are always minor units; every renderer and the Excel exporter
 * convert at the edge, so no report ever carries a pre-formatted amount that
 * Excel would treat as text.
 */
export type ColumnType = 'text' | 'number' | 'money' | 'day' | 'instant' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Column width hint, in characters, for the Excel exporter. */
  width?: number;
}

export type CellValue = string | number | null;

export interface ReportTable {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Array<Record<string, CellValue>>;
  /** Column-keyed totals, rendered as a bold final row. */
  totals?: Record<string, number>;
  /** Shown in place of the table when there are no rows. */
  emptyMessage?: string;
}

/** A headline figure, of the kind that leads a report (spec §47). */
export interface ReportFigure {
  label: string;
  value: number | string;
  type: ColumnType;
  /** Draws attention to a bottom line. */
  emphasis?: boolean;
  hint?: string;
}

export interface Report {
  /** A trading report, or a list screen exported as one. */
  kind: ReportKind | ListDataset;
  title: string;
  /** Human description of the period and any filters applied. */
  periodLabel: string;
  range: { from: string; to: string };
  currency: string;
  figures: ReportFigure[];
  tables: ReportTable[];
}

export const EXPORT_FORMATS = ['XLSX', 'CSV', 'PDF', 'PRINT'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  XLSX: 'Excel',
  CSV: 'CSV',
  PDF: 'PDF',
  PRINT: 'Print',
};
