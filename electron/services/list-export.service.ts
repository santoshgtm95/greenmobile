/**
 * "Export what I am looking at" (spec §56).
 *
 * The Reports screen answers *how did the shop do*; these answer *give me this
 * list as a file*. The difference that matters is the filter: a report is scoped
 * by a date range, a list export is scoped by whatever the user typed into the
 * search box and picked from the dropdowns on that screen.
 *
 * Both produce the same described structure from shared/report.ts, so Excel, CSV,
 * PDF and print already work — there is nothing to write per format here.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase } from '../database/connection';
import { formatBusinessDay } from '../../shared/datetime';
import { amountAfterFee, formatRate } from '../../shared/money';
import {
  BANK_ADVANCE_ROLE_LABELS,
  BANK_FEE_DIRECTION_LABELS,
  BANK_TRANSACTION_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  type PaymentMethod,
  type SaleStatus,
} from '../../shared/domain';
import {
  LIST_DATASET_LABELS,
  type ListDataset,
  type Report,
  type ReportColumn,
} from '../../shared/report';
import type {
  BankTransactionListQuery,
  CustomerListQuery,
  ExpenseListQuery,
  ProductListQuery,
  SaleListQuery,
} from '../../shared/validation';
import { listProducts } from './product.service';
import { listCustomers } from './customer.service';
import { listSales } from './sale.service';
import { listExpenses } from './expense.service';
import { listBankTransactions } from './banking.service';
import { inventoryValuation } from './report-builder.service';
import { getShopSettings } from './settings.service';

/**
 * A list export is the whole filtered set, not the page on screen.
 *
 * Exporting page 1 of 40 because that is what was rendered would be a quietly
 * wrong file, and nobody would notice until they added the column up.
 */
const EXPORT_PAGE_SIZE = 100_000;

export type ListExportQuery =
  | { dataset: 'PRODUCT_LIST'; query: ProductListQuery }
  | { dataset: 'CUSTOMER_LIST'; query: CustomerListQuery }
  | { dataset: 'SALE_LIST'; query: SaleListQuery }
  | { dataset: 'EXPENSE_LIST'; query: ExpenseListQuery }
  | { dataset: 'BANK_TRANSACTION_LIST'; query: BankTransactionListQuery }
  | { dataset: 'INVENTORY_LIST'; query: Record<string, never> };

/** Human summary of the filters, printed under the title so a file self-documents. */
function describeFilters(parts: Array<string | null | undefined>): string {
  const used = parts.filter((part): part is string => Boolean(part));
  return used.length > 0 ? used.join(' · ') : 'All records';
}

function dayRangeLabel(from?: string, to?: string): string | null {
  if (from && to) return `${formatBusinessDay(from)} to ${formatBusinessDay(to)}`;
  if (from) return `From ${formatBusinessDay(from)}`;
  if (to) return `Up to ${formatBusinessDay(to)}`;
  return null;
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

// -----------------------------------------------------------------------------

export function buildListExport(input: ListExportQuery, db: Db = getDatabase()): Report {
  const settings = getShopSettings(db);
  const today = new Date().toISOString().slice(0, 10);

  const base = {
    kind: input.dataset,
    title: `${LIST_DATASET_LABELS[input.dataset]} List`,
    range: { from: today, to: today },
    currency: settings.currency,
  };

  switch (input.dataset) {
    case 'PRODUCT_LIST':
      return { ...base, ...productList(input.query, db) };
    case 'CUSTOMER_LIST':
      return { ...base, ...customerList(input.query, db) };
    case 'SALE_LIST':
      return { ...base, ...saleList(input.query, db) };
    case 'EXPENSE_LIST':
      return { ...base, ...expenseList(input.query, db) };
    case 'BANK_TRANSACTION_LIST':
      return { ...base, ...bankTransactionList(input.query, db) };
    case 'INVENTORY_LIST':
      return { ...base, ...inventoryList(db) };
  }
}

type Body = Pick<Report, 'figures' | 'tables' | 'periodLabel'>;

function productList(query: ProductListQuery, db: Db): Body {
  const { rows } = listProducts({ ...query, page: 0, pageSize: EXPORT_PAGE_SIZE }, db);

  const columns: ReportColumn[] = [
    { key: 'sku', label: 'SKU', type: 'text', width: 18 },
    { key: 'barcode', label: 'Barcode', type: 'text', width: 18 },
    { key: 'name', label: 'Product', type: 'text', width: 34 },
    { key: 'categoryName', label: 'Category', type: 'text', width: 18 },
    { key: 'brandName', label: 'Brand', type: 'text', width: 16 },
    { key: 'purchasePrice', label: 'Purchase', type: 'money', width: 14 },
    { key: 'sellingPrice', label: 'Selling', type: 'money', width: 14 },
    { key: 'stockQuantity', label: 'Stock', type: 'number', width: 9 },
    { key: 'minimumStock', label: 'Minimum', type: 'number', width: 10 },
    { key: 'unit', label: 'Unit', type: 'text', width: 8 },
    { key: 'status', label: 'Status', type: 'text', width: 11 },
  ];

  return {
    periodLabel: describeFilters([
      query.search ? `Search "${query.search}"` : null,
      query.lowStockOnly ? 'Low stock only' : null,
      query.includeInactive ? 'Including inactive' : 'Active only',
    ]),
    figures: [
      { label: 'Products', value: rows.length, type: 'number' },
      { label: 'Units in stock', value: sum(rows, (r) => Math.max(0, r.stockQuantity)), type: 'number' },
      {
        label: 'Stock value at cost',
        value: sum(rows, (r) => Math.max(0, r.stockQuantity) * r.purchasePrice),
        type: 'money',
        emphasis: true,
      },
    ],
    tables: [
      {
        title: 'Products',
        columns,
        rows: rows.map((row) => ({
          sku: row.sku,
          barcode: row.barcode,
          name: row.name,
          categoryName: row.categoryName,
          brandName: row.brandName,
          purchasePrice: row.purchasePrice,
          sellingPrice: row.sellingPrice,
          stockQuantity: row.stockQuantity,
          minimumStock: row.minimumStock,
          unit: row.unit,
          status: row.isActive ? 'Active' : 'Inactive',
        })),
        totals: { stockQuantity: sum(rows, (r) => Math.max(0, r.stockQuantity)) },
        emptyMessage: 'No products match these filters.',
      },
    ],
  };
}

function customerList(query: CustomerListQuery, db: Db): Body {
  const { rows } = listCustomers({ ...query, page: 0, pageSize: EXPORT_PAGE_SIZE }, db);

  return {
    periodLabel: describeFilters([
      query.search ? `Search "${query.search}"` : null,
      query.includeInactive ? 'Including inactive' : 'Active only',
    ]),
    figures: [
      { label: 'Customers', value: rows.length, type: 'number' },
      { label: 'Orders', value: sum(rows, (r) => r.totalOrders), type: 'number' },
      {
        label: 'Lifetime spend',
        value: sum(rows, (r) => r.totalSpent),
        type: 'money',
        emphasis: true,
      },
    ],
    tables: [
      {
        title: 'Customers',
        subtitle: 'Spend is net of refunds, across the whole of each customer’s history',
        columns: [
          { key: 'customerCode', label: 'Code', type: 'text', width: 16 },
          { key: 'name', label: 'Name', type: 'text', width: 28 },
          { key: 'phone', label: 'Phone', type: 'text', width: 16 },
          { key: 'email', label: 'Email', type: 'text', width: 26 },
          { key: 'address', label: 'Address', type: 'text', width: 34 },
          { key: 'totalOrders', label: 'Orders', type: 'number', width: 9 },
          { key: 'totalSpent', label: 'Total spent', type: 'money', width: 16 },
          { key: 'lastPurchaseAt', label: 'Last purchase', type: 'instant', width: 18 },
          { key: 'status', label: 'Status', type: 'text', width: 11 },
        ],
        rows: rows.map((row) => ({
          customerCode: row.customerCode,
          name: row.name,
          phone: row.phone,
          email: row.email,
          address: row.address,
          totalOrders: row.totalOrders,
          totalSpent: row.totalSpent,
          lastPurchaseAt: row.lastPurchaseAt,
          status: row.isActive ? 'Active' : 'Inactive',
        })),
        totals: {
          totalOrders: sum(rows, (r) => r.totalOrders),
          totalSpent: sum(rows, (r) => r.totalSpent),
        },
        emptyMessage: 'No customers match these filters.',
      },
    ],
  };
}

function saleList(query: SaleListQuery, db: Db): Body {
  const { rows } = listSales({ ...query, page: 0, pageSize: EXPORT_PAGE_SIZE }, db);
  // A cancelled sale is in the list but is not money the shop took.
  const counted = rows.filter((row) => row.status !== 'CANCELLED');

  return {
    periodLabel: describeFilters([
      dayRangeLabel(query.from, query.to),
      query.search ? `Search "${query.search}"` : null,
      query.status ? SALE_STATUS_LABELS[query.status as SaleStatus] : null,
      query.paymentMethod
        ? PAYMENT_METHOD_LABELS[query.paymentMethod as PaymentMethod]
        : null,
    ]),
    figures: [
      { label: 'Sales listed', value: rows.length, type: 'number' },
      {
        label: 'Invoiced',
        value: sum(counted, (r) => r.grandTotal),
        type: 'money',
        hint: 'Excludes cancelled sales',
      },
      { label: 'Refunded', value: sum(counted, (r) => r.refundedAmount), type: 'money' },
      {
        label: 'Net taken',
        value: sum(counted, (r) => r.grandTotal - r.refundedAmount),
        type: 'money',
        emphasis: true,
      },
    ],
    tables: [
      {
        title: 'Sales',
        columns: [
          { key: 'invoiceNumber', label: 'Invoice', type: 'text', width: 18 },
          { key: 'saleDate', label: 'Date', type: 'instant', width: 18 },
          { key: 'customerName', label: 'Customer', type: 'text', width: 24 },
          { key: 'customerPhone', label: 'Phone', type: 'text', width: 15 },
          { key: 'subtotal', label: 'Subtotal', type: 'money', width: 14 },
          { key: 'discountAmount', label: 'Discount', type: 'money', width: 13 },
          { key: 'taxAmount', label: 'Tax', type: 'money', width: 13 },
          { key: 'grandTotal', label: 'Total', type: 'money', width: 15 },
          { key: 'refundedAmount', label: 'Refunded', type: 'money', width: 14 },
          { key: 'statusLabel', label: 'Status', type: 'text', width: 17 },
          { key: 'cashierName', label: 'Cashier', type: 'text', width: 18 },
        ],
        rows: rows.map((row) => ({
          invoiceNumber: row.invoiceNumber,
          saleDate: row.saleDate,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          subtotal: row.subtotal,
          discountAmount: row.discountAmount,
          taxAmount: row.taxAmount,
          grandTotal: row.grandTotal,
          refundedAmount: row.refundedAmount,
          statusLabel: SALE_STATUS_LABELS[row.status] ?? row.status,
          cashierName: row.cashierName,
        })),
        totals: {
          subtotal: sum(counted, (r) => r.subtotal),
          discountAmount: sum(counted, (r) => r.discountAmount),
          taxAmount: sum(counted, (r) => r.taxAmount),
          grandTotal: sum(counted, (r) => r.grandTotal),
          refundedAmount: sum(counted, (r) => r.refundedAmount),
        },
        emptyMessage: 'No sales match these filters.',
      },
    ],
  };
}

function expenseList(query: ExpenseListQuery, db: Db): Body {
  const { rows, totalAmount } = listExpenses(
    { ...query, page: 0, pageSize: EXPORT_PAGE_SIZE },
    db,
  );

  return {
    periodLabel: describeFilters([
      dayRangeLabel(query.from, query.to),
      query.search ? `Search "${query.search}"` : null,
      query.paymentMethod
        ? PAYMENT_METHOD_LABELS[query.paymentMethod as PaymentMethod]
        : null,
      query.includeDeleted ? 'Including deleted' : null,
    ]),
    figures: [
      { label: 'Entries', value: rows.length, type: 'number' },
      { label: 'Total', value: totalAmount, type: 'money', emphasis: true },
    ],
    tables: [
      {
        title: 'Expenses',
        columns: [
          { key: 'expenseNumber', label: 'Number', type: 'text', width: 16 },
          { key: 'expenseDay', label: 'Date', type: 'day', width: 14 },
          { key: 'categoryName', label: 'Category', type: 'text', width: 20 },
          { key: 'description', label: 'Description', type: 'text', width: 38 },
          { key: 'amount', label: 'Amount', type: 'money', width: 15 },
          { key: 'method', label: 'Paid by', type: 'text', width: 16 },
          { key: 'referenceNumber', label: 'Reference', type: 'text', width: 18 },
          { key: 'createdByName', label: 'Recorded by', type: 'text', width: 18 },
          { key: 'state', label: 'State', type: 'text', width: 11 },
        ],
        rows: rows.map((row) => ({
          expenseNumber: row.expenseNumber,
          expenseDay: row.expenseDay,
          categoryName: row.categoryName,
          description: row.description,
          amount: row.amount,
          method: PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod,
          referenceNumber: row.referenceNumber,
          createdByName: row.createdByName,
          state: row.isDeleted ? 'Deleted' : 'Recorded',
        })),
        totals: { amount: totalAmount },
        emptyMessage: 'No expenses match these filters.',
      },
    ],
  };
}

function bankTransactionList(query: BankTransactionListQuery, db: Db): Body {
  const { rows, transferTotal, receiveTotal } = listBankTransactions(
    { ...query, page: 0, pageSize: EXPORT_PAGE_SIZE },
    db,
  );

  /**
   * One cell holding everything about a side: the bank when it was one of the
   * shop's own, then the account number and the name on it.
   *
   * Joined into a single column rather than split into six, because the file is
   * usually read next to a bank statement and a side is checked as one thing.
   */
  const side = (
    accountName: string | null,
    key: string | null,
    accountNumber: string | null,
    holder: string | null,
  ) =>
    [accountName ? `${accountName} (${key})` : null, accountNumber, holder]
      .filter(Boolean)
      .join(' · ');

  // Every fee on the sheet, whichever way it went. Summed across both
  // directions on purpose: this answers "how much did fees come to", not "what
  // did the shop clear on them", and netting the two would hide the gross.
  const feeTotal = sum(rows, (r) => r.feeAmount);

  return {
    periodLabel: describeFilters([
      dayRangeLabel(query.from, query.to),
      query.search ? `Search "${query.search}"` : null,
      query.type ? BANK_TRANSACTION_TYPE_LABELS[query.type] : null,
      query.includeDeleted ? 'Including deleted' : null,
    ]),
    figures: [
      { label: 'Transactions', value: rows.length, type: 'number' },
      { label: 'Transferred out', value: transferTotal, type: 'money' },
      { label: 'Received in', value: receiveTotal, type: 'money' },
      {
        label: 'Net movement',
        value: receiveTotal - transferTotal,
        type: 'money',
        emphasis: true,
      },
      { label: 'Fees', value: feeTotal, type: 'money' },
    ],
    tables: [
      {
        title: 'Bank transactions',
        subtitle: 'Money moved between the shop and its banks and mobile wallets',
        columns: [
          { key: 'transactionNumber', label: 'Number', type: 'text', width: 18 },
          { key: 'transactionDate', label: 'Date and time', type: 'instant', width: 18 },
          { key: 'typeLabel', label: 'Type', type: 'text', width: 30 },
          { key: 'from', label: 'From', type: 'text', width: 34 },
          { key: 'to', label: 'To', type: 'text', width: 34 },
          { key: 'amount', label: 'Amount', type: 'money', width: 16 },
          { key: 'feeRate', label: 'Fee %', type: 'text', width: 9 },
          { key: 'feeAmount', label: 'Fee', type: 'money', width: 14 },
          { key: 'feeDirectionLabel', label: 'Fee is', type: 'text', width: 11 },
          { key: 'actualAmount', label: 'Actual amount', type: 'money', width: 16 },
          { key: 'notes', label: 'Notes', type: 'text', width: 30 },
          { key: 'createdByName', label: 'Recorded by', type: 'text', width: 18 },
          { key: 'state', label: 'State', type: 'text', width: 11 },
        ],
        rows: rows.map((row) => ({
          transactionNumber: row.transactionNumber,
          transactionDate: row.transactionDate,
          // An advance step is still a receive or a transfer, and says which
          // part of an advance it was — otherwise a customer's deposit reads as
          // takings in the sheet.
          typeLabel: row.advanceRole
            ? `${BANK_TRANSACTION_TYPE_LABELS[row.type]} (${BANK_ADVANCE_ROLE_LABELS[row.advanceRole].toLowerCase()})`
            : (BANK_TRANSACTION_TYPE_LABELS[row.type] ?? row.type),
          from: side(
            row.fromAccountName,
            row.fromAccountKey,
            row.fromAccountNumber,
            row.fromName,
          ),
          to: side(row.toAccountName, row.toAccountKey, row.toAccountNumber, row.toName),
          amount: row.amount,
          // Blank rather than "0%" / 0.00 on a movement that carried no fee, so
          // a column of real fees is not buried in zeroes when the sheet is
          // read beside a statement.
          feeRate: row.feeBasisPoints > 0 ? formatRate(row.feeBasisPoints) : null,
          feeAmount: row.feeAmount > 0 ? row.feeAmount : null,
          feeDirectionLabel:
            row.feeAmount > 0 ? BANK_FEE_DIRECTION_LABELS[row.feeDirection] : null,
          // Always filled, even with no fee: this is the column reconciled
          // against a bank statement, and a blank cell there reads as missing
          // data rather than as "same as the amount".
          actualAmount: amountAfterFee(row.amount, row.feeAmount, row.feeDirection),
          notes: row.notes,
          createdByName: row.createdByName,
          state: row.isDeleted ? 'Deleted' : 'Recorded',
        })),
        totals: { amount: transferTotal + receiveTotal, feeAmount: feeTotal },
        emptyMessage: 'No bank transactions match these filters.',
      },
    ],
  };
}

/** Stock on hand with what it is worth — the sheet a stock-take is done against. */
function inventoryList(db: Db): Body {
  const rows = inventoryValuation(db);

  return {
    periodLabel: `Stock on hand at ${formatBusinessDay(new Date().toISOString().slice(0, 10))}`,
    figures: [
      { label: 'Products', value: rows.length, type: 'number' },
      { label: 'Units held', value: sum(rows, (r) => Math.max(0, r.stockQuantity)), type: 'number' },
      {
        label: 'Stock value at cost',
        value: sum(rows, (r) => r.stockValue),
        type: 'money',
        emphasis: true,
      },
      { label: 'Potential revenue', value: sum(rows, (r) => r.potentialRevenue), type: 'money' },
    ],
    tables: [
      {
        title: 'Stock on hand',
        columns: [
          { key: 'sku', label: 'SKU', type: 'text', width: 18 },
          { key: 'name', label: 'Product', type: 'text', width: 34 },
          { key: 'categoryName', label: 'Category', type: 'text', width: 18 },
          { key: 'stockQuantity', label: 'Stock', type: 'number', width: 9 },
          { key: 'minimumStock', label: 'Minimum', type: 'number', width: 10 },
          { key: 'purchasePrice', label: 'Purchase', type: 'money', width: 14 },
          { key: 'stockValue', label: 'Stock value', type: 'money', width: 16 },
          { key: 'sellingPrice', label: 'Selling', type: 'money', width: 14 },
          { key: 'potentialRevenue', label: 'Potential revenue', type: 'money', width: 18 },
          // Left blank on purpose: this file is printed and walked round the
          // shelves, and a counted column is what makes it useful on paper.
          { key: 'counted', label: 'Counted', type: 'text', width: 12 },
        ],
        rows: rows.map((row) => ({
          sku: row.sku,
          name: row.name,
          categoryName: row.categoryName,
          stockQuantity: row.stockQuantity,
          minimumStock: row.minimumStock,
          purchasePrice: row.purchasePrice,
          stockValue: row.stockValue,
          sellingPrice: row.sellingPrice,
          potentialRevenue: row.potentialRevenue,
          counted: '',
        })),
        totals: {
          stockQuantity: sum(rows, (r) => Math.max(0, r.stockQuantity)),
          stockValue: sum(rows, (r) => r.stockValue),
          potentialRevenue: sum(rows, (r) => r.potentialRevenue),
        },
        emptyMessage: 'No active products.',
      },
    ],
  };
}

/** Filename stem for a list export, safe on Windows. */
export function listFileStem(dataset: ListDataset): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${dataset.toLowerCase().replace(/_/g, '-')}_${day}`;
}
