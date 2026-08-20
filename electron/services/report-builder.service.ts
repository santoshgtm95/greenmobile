/**
 * Assembles the eight reports (spec §46–§50) as data.
 *
 * Everything reuses the aggregation in report.service.ts, so the dashboard and
 * the reports screen can never disagree about what revenue was — they read the
 * same functions.
 *
 * The remaining pieces that only reports need — stock valuation, the full
 * product list, customer ranking — live here.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase } from '../database/connection';
import { subtractMoney } from '../../shared/money';
import { formatBusinessDay, type DayRange } from '../../shared/datetime';
import {
  PAYMENT_METHOD_LABELS,
  SERVICE_STATUS_LABELS,
  type PaymentMethod,
  type ServiceStatus,
} from '../../shared/domain';
import type { Report, ReportKind, ReportTable } from '../../shared/report';
import { REPORT_LABELS } from '../../shared/report';
import {
  salesSummary,
  salesByDay,
  salesByCategory,
  salesByPaymentMethod,
  topProducts,
  profitAndLoss,
} from './report.service';
import { expenseSummary } from './expense.service';
import { serviceSummary } from './service.service';
import { getShopSettings } from './settings.service';

// -----------------------------------------------------------------------------
// Report-only aggregations
// -----------------------------------------------------------------------------

export interface InventoryValuationRow {
  id: string;
  sku: string;
  name: string;
  categoryName: string | null;
  stockQuantity: number;
  purchasePrice: number;
  /** stock × purchase price — what the shelf cost. */
  stockValue: number;
  sellingPrice: number;
  /** stock × selling price — what the shelf would fetch. */
  potentialRevenue: number;
  /** potentialRevenue − stockValue. */
  potentialProfit: number;
  minimumStock: number;
}

/**
 * Stock valuation (spec §50).
 *
 * Uses the product's current purchase price, which is correct here: this values
 * what is on the shelf *now*, unlike a profit report, which must use the cost
 * frozen at the time of each sale.
 */
export function inventoryValuation(db: Db = getDatabase()): InventoryValuationRow[] {
  return db
    .prepare(
      `SELECT p.id, p.sku, p.name, c.name AS categoryName, p.stockQuantity,
              p.purchasePrice, p.sellingPrice, p.minimumStock,
              p.stockQuantity * p.purchasePrice AS stockValue,
              p.stockQuantity * p.sellingPrice AS potentialRevenue,
              p.stockQuantity * p.sellingPrice - p.stockQuantity * p.purchasePrice
                AS potentialProfit
         FROM "Product" p
         LEFT JOIN "Category" c ON c.id = p.categoryId
        WHERE p.isActive = 1
        ORDER BY stockValue DESC, p.name ASC`,
    )
    .all() as InventoryValuationRow[];
}

export interface CustomerReportRow {
  id: string;
  customerCode: string;
  name: string;
  phone: string | null;
  orders: number;
  /** Net of refunds. */
  totalSpent: number;
  lastPurchaseAt: string | null;
}

/** Customers ranked by what they spent in the period (spec §46). */
export function customerReport(range: DayRange, db: Db = getDatabase()): CustomerReportRow[] {
  return db
    .prepare(
      `SELECT c.id, c.customerCode, c.name, c.phone,
              COUNT(s.id) AS orders,
              COALESCE(SUM(s.grandTotal - s.refundedAmount), 0) AS totalSpent,
              MAX(s.saleDate) AS lastPurchaseAt
         FROM "Customer" c
         JOIN "Sale" s ON s.customerId = c.id
        WHERE s.status <> 'CANCELLED' AND s.saleDay BETWEEN ? AND ?
        GROUP BY c.id, c.customerCode, c.name, c.phone
        ORDER BY totalSpent DESC`,
    )
    .all(range.from, range.to) as CustomerReportRow[];
}

export interface ServiceReportRow {
  serviceNumber: string;
  customerName: string;
  device: string;
  imei: string | null;
  status: string;
  receivedDay: string;
  finalCost: number;
  partsCost: number;
  grossProfit: number;
  amountPaid: number;
  balance: number;
}

/** Every job received in the period (spec §46 Services tab). */
export function serviceReport(range: DayRange, db: Db = getDatabase()): ServiceReportRow[] {
  return db
    .prepare(
      `SELECT s.serviceNumber, s.customerName,
              s.deviceBrand || ' ' || s.deviceModel AS device,
              s.imei, s.status, s.receivedDay, s.finalCost, s.partsCost,
              s.finalCost - s.partsCost AS grossProfit,
              COALESCE((SELECT SUM(p.amount) FROM "ServicePayment" p
                         WHERE p.serviceOrderId = s.id), 0) AS amountPaid,
              MAX(0, s.finalCost -
                  COALESCE((SELECT SUM(p.amount) FROM "ServicePayment" p
                             WHERE p.serviceOrderId = s.id), 0)) AS balance
         FROM "ServiceOrder" s
        WHERE s.receivedDay BETWEEN ? AND ?
        ORDER BY s.receivedDate DESC`,
    )
    .all(range.from, range.to) as ServiceReportRow[];
}

// -----------------------------------------------------------------------------
// Assembly
// -----------------------------------------------------------------------------

function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/** Builds the requested report for the period. */
export function buildReport(kind: ReportKind, range: DayRange, db: Db = getDatabase()): Report {
  const settings = getShopSettings(db);

  const base = {
    kind,
    title: `${REPORT_LABELS[kind]} Report`,
    periodLabel:
      range.from === range.to
        ? formatBusinessDay(range.from)
        : `${formatBusinessDay(range.from)} to ${formatBusinessDay(range.to)}`,
    range,
    currency: settings.currency,
  };

  switch (kind) {
    case 'SALES':
      return { ...base, ...salesReport(range, db) };
    case 'REVENUE':
      return { ...base, ...revenueReport(range, db) };
    case 'EXPENSES':
      return { ...base, ...expensesReport(range, db) };
    case 'PROFIT_LOSS':
      return { ...base, ...profitLossReport(range, db) };
    case 'INVENTORY':
      return { ...base, ...inventoryReport(settings.lowStockThreshold, db) };
    case 'PRODUCTS':
      return { ...base, ...productsReport(range, db) };
    case 'CUSTOMERS':
      return { ...base, ...customersReport(range, db) };
    case 'SERVICES':
      return { ...base, ...servicesReport(range, db) };
  }
}

/** Spec §47. */
function salesReport(range: DayRange, db: Db): Pick<Report, 'figures' | 'tables'> {
  const summary = salesSummary(range, db);
  const days = salesByDay(range, db);
  const byCategory = salesByCategory(range, db);
  const byMethod = salesByPaymentMethod(range, db);
  const products = topProducts(range, 25, db);

  return {
    figures: [
      { label: 'Total transactions', value: summary.transactions, type: 'number' },
      { label: 'Total items sold', value: summary.itemsSold, type: 'number' },
      { label: 'Gross sales', value: summary.grossSales, type: 'money' },
      { label: 'Discounts', value: summary.discounts, type: 'money' },
      { label: 'Tax', value: summary.tax, type: 'money', hint: 'Collected on behalf of the tax authority' },
      { label: 'Net sales', value: summary.netSales, type: 'money', hint: 'Gross sales less discounts, excluding tax' },
      { label: 'Cost of goods sold', value: summary.cogs, type: 'money', hint: 'From the cost recorded at the time of sale' },
      { label: 'Gross profit', value: summary.grossProfit, type: 'money', emphasis: true },
      { label: 'Refunds', value: summary.refunds, type: 'money' },
    ],
    tables: [
      {
        title: 'Sales by day',
        columns: [
          { key: 'day', label: 'Day', type: 'day', width: 14 },
          { key: 'transactions', label: 'Sales', type: 'number', width: 10 },
          { key: 'netSales', label: 'Net sales', type: 'money', width: 16 },
          { key: 'cogs', label: 'COGS', type: 'money', width: 16 },
          { key: 'grossProfit', label: 'Gross profit', type: 'money', width: 16 },
        ],
        rows: days.map((d) => ({ ...d })),
        totals: {
          transactions: sumBy(days, (d) => d.transactions),
          netSales: sumBy(days, (d) => d.netSales),
          cogs: sumBy(days, (d) => d.cogs),
          grossProfit: sumBy(days, (d) => d.grossProfit),
        },
      },
      {
        title: 'Sales by product',
        columns: [
          { key: 'productName', label: 'Product', type: 'text', width: 32 },
          { key: 'sku', label: 'SKU', type: 'text', width: 16 },
          { key: 'quantity', label: 'Qty', type: 'number', width: 8 },
          { key: 'netSales', label: 'Net sales', type: 'money', width: 16 },
          { key: 'grossProfit', label: 'Gross profit', type: 'money', width: 16 },
        ],
        rows: products.map((p) => ({
          productName: p.productName,
          sku: p.sku,
          quantity: p.quantity,
          netSales: p.netSales,
          grossProfit: p.grossProfit,
        })),
        totals: {
          quantity: sumBy(products, (p) => p.quantity),
          netSales: sumBy(products, (p) => p.netSales),
          grossProfit: sumBy(products, (p) => p.grossProfit),
        },
        emptyMessage: 'Nothing was sold in this period.',
      },
      {
        title: 'Sales by category',
        columns: [
          { key: 'categoryName', label: 'Category', type: 'text', width: 26 },
          { key: 'quantity', label: 'Qty', type: 'number', width: 8 },
          { key: 'netSales', label: 'Net sales', type: 'money', width: 16 },
        ],
        rows: byCategory.map((c) => ({ ...c })),
        totals: {
          quantity: sumBy(byCategory, (c) => c.quantity),
          netSales: sumBy(byCategory, (c) => c.netSales),
        },
      },
      {
        title: 'Sales by payment method',
        columns: [
          { key: 'method', label: 'Method', type: 'text', width: 20 },
          { key: 'count', label: 'Payments', type: 'number', width: 12 },
          { key: 'total', label: 'Taken', type: 'money', width: 16 },
        ],
        rows: byMethod.map((m) => ({
          method: PAYMENT_METHOD_LABELS[m.paymentMethod as PaymentMethod] ?? m.paymentMethod,
          count: m.count,
          total: m.total,
        })),
        totals: {
          count: sumBy(byMethod, (m) => m.count),
          total: sumBy(byMethod, (m) => m.total),
        },
      },
    ],
  };
}

/** Revenue seen day by day, with what it cost to earn. */
function revenueReport(range: DayRange, db: Db): Pick<Report, 'figures' | 'tables'> {
  const summary = salesSummary(range, db);
  const services = serviceSummary(range, db);
  const days = salesByDay(range, db);
  const expenses = expenseSummary(range, db);
  const expensesByDay = new Map(expenses.byDay.map((row) => [row.day, row.total]));

  const rows = days.map((d) => ({
    day: d.day,
    netSales: d.netSales,
    cogs: d.cogs,
    grossProfit: d.grossProfit,
    expenses: expensesByDay.get(d.day) ?? 0,
    net: subtractMoney(d.grossProfit, expensesByDay.get(d.day) ?? 0),
  }));

  return {
    figures: [
      { label: 'Goods revenue', value: summary.netSales, type: 'money' },
      { label: 'Repair income', value: services.revenue, type: 'money' },
      { label: 'Total revenue', value: summary.netSales + services.revenue, type: 'money', emphasis: true },
      { label: 'Tax collected', value: summary.tax, type: 'money' },
      { label: 'Refunds', value: summary.refunds, type: 'money' },
      { label: 'Transactions', value: summary.transactions, type: 'number' },
    ],
    tables: [
      {
        title: 'Revenue by day',
        subtitle: 'Goods only; repair income is reported in the Services report',
        columns: [
          { key: 'day', label: 'Day', type: 'day', width: 14 },
          { key: 'netSales', label: 'Revenue', type: 'money', width: 16 },
          { key: 'cogs', label: 'COGS', type: 'money', width: 16 },
          { key: 'grossProfit', label: 'Gross profit', type: 'money', width: 16 },
          { key: 'expenses', label: 'Expenses', type: 'money', width: 16 },
          { key: 'net', label: 'Net', type: 'money', width: 16 },
        ],
        rows,
        totals: {
          netSales: sumBy(rows, (r) => r.netSales),
          cogs: sumBy(rows, (r) => r.cogs),
          grossProfit: sumBy(rows, (r) => r.grossProfit),
          expenses: sumBy(rows, (r) => r.expenses),
          net: sumBy(rows, (r) => r.net),
        },
      },
    ],
  };
}

/** Spec §48. */
function expensesReport(range: DayRange, db: Db): Pick<Report, 'figures' | 'tables'> {
  const summary = expenseSummary(range, db);

  return {
    figures: [
      { label: 'Total expenses', value: summary.total, type: 'money', emphasis: true },
      { label: 'Entries', value: summary.count, type: 'number' },
      {
        label: 'Largest category',
        value: summary.byCategory[0]?.categoryName ?? '—',
        type: 'text',
      },
    ],
    tables: [
      {
        title: 'Expenses by category',
        columns: [
          { key: 'categoryName', label: 'Category', type: 'text', width: 26 },
          { key: 'count', label: 'Entries', type: 'number', width: 10 },
          { key: 'total', label: 'Amount', type: 'money', width: 16 },
        ],
        rows: summary.byCategory.map((c) => ({
          categoryName: c.categoryName,
          count: c.count,
          total: c.total,
        })),
        totals: { count: summary.count, total: summary.total },
        emptyMessage: 'No expenses recorded in this period.',
      },
      {
        title: 'Expenses by day',
        columns: [
          { key: 'day', label: 'Day', type: 'day', width: 14 },
          { key: 'total', label: 'Amount', type: 'money', width: 16 },
        ],
        rows: summary.byDay.map((d) => ({ ...d })),
        totals: { total: summary.total },
      },
      {
        title: 'Expenses by payment method',
        columns: [
          { key: 'method', label: 'Method', type: 'text', width: 20 },
          { key: 'count', label: 'Entries', type: 'number', width: 10 },
          { key: 'total', label: 'Amount', type: 'money', width: 16 },
        ],
        rows: summary.byPaymentMethod.map((m) => ({
          method: PAYMENT_METHOD_LABELS[m.paymentMethod as PaymentMethod] ?? m.paymentMethod,
          count: m.count,
          total: m.total,
        })),
        totals: { count: summary.count, total: summary.total },
      },
    ],
  };
}

/** Spec §49. */
function profitLossReport(range: DayRange, db: Db): Pick<Report, 'figures' | 'tables'> {
  const pl = profitAndLoss(range, db);
  const expenses = expenseSummary(range, db);

  /** The statement itself, laid out the way an accountant reads it. */
  const statement: ReportTable = {
    title: 'Profit and loss',
    subtitle: 'Cost of goods uses the unit cost recorded at the time of each sale',
    columns: [
      { key: 'line', label: '', type: 'text', width: 38 },
      { key: 'amount', label: 'Amount', type: 'money', width: 18 },
    ],
    rows: [
      { line: 'Goods — net sales', amount: pl.goods.netSales },
      { line: 'Goods — cost of goods sold', amount: -pl.goods.cogs },
      { line: 'Goods — gross profit', amount: pl.goods.grossProfit },
      { line: '', amount: null },
      { line: 'Repairs — income', amount: pl.services.revenue },
      { line: 'Repairs — parts used', amount: -pl.services.partsCost },
      { line: 'Repairs — gross profit', amount: pl.services.grossProfit },
      { line: '', amount: null },
      { line: 'TOTAL GROSS PROFIT', amount: pl.totalGrossProfit },
      { line: 'Operating expenses', amount: -pl.expenses },
      { line: 'NET PROFIT', amount: pl.netProfit },
    ],
  };

  return {
    figures: [
      { label: 'Total gross profit', value: pl.totalGrossProfit, type: 'money' },
      { label: 'Operating expenses', value: pl.expenses, type: 'money' },
      {
        label: 'Net profit',
        value: pl.netProfit,
        type: 'money',
        emphasis: true,
        hint: pl.netProfit >= 0 ? 'Profit for the period' : 'Loss for the period',
      },
      {
        label: 'Tax collected',
        value: pl.taxCollected,
        type: 'money',
        hint: 'Not income — held on behalf of the tax authority',
      },
    ],
    tables: [
      statement,
      {
        title: 'Operating expenses by category',
        columns: [
          { key: 'categoryName', label: 'Category', type: 'text', width: 26 },
          { key: 'total', label: 'Amount', type: 'money', width: 16 },
        ],
        rows: expenses.byCategory.map((c) => ({ categoryName: c.categoryName, total: c.total })),
        totals: { total: expenses.total },
        emptyMessage: 'No expenses recorded in this period.',
      },
    ],
  };
}

/** Spec §50. Stock valuation is a snapshot, so it ignores the date range. */
function inventoryReport(lowStockThreshold: number, db: Db): Pick<Report, 'figures' | 'tables'> {
  const rows = inventoryValuation(db);

  const lowStock = rows.filter(
    (row) =>
      row.stockQuantity > 0 &&
      row.stockQuantity <= (row.minimumStock > 0 ? row.minimumStock : lowStockThreshold),
  );
  const outOfStock = rows.filter((row) => row.stockQuantity <= 0);

  const columns = [
    { key: 'name', label: 'Product', type: 'text' as const, width: 32 },
    { key: 'sku', label: 'SKU', type: 'text' as const, width: 16 },
    { key: 'categoryName', label: 'Category', type: 'text' as const, width: 18 },
    { key: 'stockQuantity', label: 'Stock', type: 'number' as const, width: 9 },
    { key: 'purchasePrice', label: 'Purchase', type: 'money' as const, width: 14 },
    { key: 'stockValue', label: 'Stock value', type: 'money' as const, width: 16 },
    { key: 'sellingPrice', label: 'Selling', type: 'money' as const, width: 14 },
    { key: 'potentialRevenue', label: 'Potential revenue', type: 'money' as const, width: 18 },
    { key: 'potentialProfit', label: 'Potential profit', type: 'money' as const, width: 18 },
  ];

  const toRow = (row: InventoryValuationRow) => ({
    name: row.name,
    sku: row.sku,
    categoryName: row.categoryName,
    stockQuantity: row.stockQuantity,
    purchasePrice: row.purchasePrice,
    stockValue: row.stockValue,
    sellingPrice: row.sellingPrice,
    potentialRevenue: row.potentialRevenue,
    potentialProfit: row.potentialProfit,
  });

  return {
    figures: [
      { label: 'Products in stock', value: rows.filter((r) => r.stockQuantity > 0).length, type: 'number' },
      { label: 'Units held', value: sumBy(rows, (r) => Math.max(0, r.stockQuantity)), type: 'number' },
      { label: 'Stock value at cost', value: sumBy(rows, (r) => r.stockValue), type: 'money', emphasis: true },
      { label: 'Potential revenue', value: sumBy(rows, (r) => r.potentialRevenue), type: 'money' },
      { label: 'Potential profit', value: sumBy(rows, (r) => r.potentialProfit), type: 'money' },
      { label: 'Low stock', value: lowStock.length, type: 'number' },
      { label: 'Out of stock', value: outOfStock.length, type: 'number' },
    ],
    tables: [
      {
        title: 'Stock valuation',
        subtitle: 'A snapshot of what is on the shelf now, valued at the current purchase price',
        columns,
        rows: rows.map(toRow),
        totals: {
          stockQuantity: sumBy(rows, (r) => Math.max(0, r.stockQuantity)),
          stockValue: sumBy(rows, (r) => r.stockValue),
          potentialRevenue: sumBy(rows, (r) => r.potentialRevenue),
          potentialProfit: sumBy(rows, (r) => r.potentialProfit),
        },
        emptyMessage: 'No active products.',
      },
      {
        title: 'Low stock',
        columns: [
          { key: 'name', label: 'Product', type: 'text', width: 32 },
          { key: 'sku', label: 'SKU', type: 'text', width: 16 },
          { key: 'stockQuantity', label: 'Stock', type: 'number', width: 9 },
          { key: 'minimumStock', label: 'Minimum', type: 'number', width: 11 },
        ],
        rows: lowStock.map((row) => ({
          name: row.name,
          sku: row.sku,
          stockQuantity: row.stockQuantity,
          minimumStock: row.minimumStock,
        })),
        emptyMessage: 'Every product is above its minimum.',
      },
      {
        title: 'Out of stock',
        columns: [
          { key: 'name', label: 'Product', type: 'text', width: 32 },
          { key: 'sku', label: 'SKU', type: 'text', width: 16 },
          { key: 'sellingPrice', label: 'Selling', type: 'money', width: 14 },
        ],
        rows: outOfStock.map((row) => ({
          name: row.name,
          sku: row.sku,
          sellingPrice: row.sellingPrice,
        })),
        emptyMessage: 'Nothing is out of stock.',
      },
    ],
  };
}

/** Everything sold in the period, ranked. */
function productsReport(range: DayRange, db: Db): Pick<Report, 'figures' | 'tables'> {
  const products = topProducts(range, 500, db);

  return {
    figures: [
      { label: 'Products sold', value: products.length, type: 'number' },
      { label: 'Units sold', value: sumBy(products, (p) => p.quantity), type: 'number' },
      { label: 'Revenue', value: sumBy(products, (p) => p.netSales), type: 'money' },
      {
        label: 'Gross profit',
        value: sumBy(products, (p) => p.grossProfit),
        type: 'money',
        emphasis: true,
      },
      { label: 'Best seller', value: products[0]?.productName ?? '—', type: 'text' },
    ],
    tables: [
      {
        title: 'Product performance',
        subtitle: 'Ordered by revenue. Profit uses the cost recorded at the time of each sale.',
        columns: [
          { key: 'productName', label: 'Product', type: 'text', width: 34 },
          { key: 'sku', label: 'SKU', type: 'text', width: 16 },
          { key: 'quantity', label: 'Qty sold', type: 'number', width: 10 },
          { key: 'netSales', label: 'Revenue', type: 'money', width: 16 },
          { key: 'grossProfit', label: 'Gross profit', type: 'money', width: 16 },
          { key: 'margin', label: 'Margin', type: 'percent', width: 10 },
        ],
        rows: products.map((p) => ({
          productName: p.productName,
          sku: p.sku,
          quantity: p.quantity,
          netSales: p.netSales,
          grossProfit: p.grossProfit,
          margin: p.netSales > 0 ? Math.round((p.grossProfit / p.netSales) * 1000) / 10 : 0,
        })),
        totals: {
          quantity: sumBy(products, (p) => p.quantity),
          netSales: sumBy(products, (p) => p.netSales),
          grossProfit: sumBy(products, (p) => p.grossProfit),
        },
        emptyMessage: 'Nothing was sold in this period.',
      },
    ],
  };
}

/** Customers ranked by spend (spec §46). */
function customersReport(range: DayRange, db: Db): Pick<Report, 'figures' | 'tables'> {
  const customers = customerReport(range, db);
  const totalSpent = sumBy(customers, (c) => c.totalSpent);

  return {
    figures: [
      { label: 'Customers who bought', value: customers.length, type: 'number' },
      { label: 'Total spent', value: totalSpent, type: 'money', emphasis: true },
      {
        label: 'Average per customer',
        value: customers.length > 0 ? Math.round(totalSpent / customers.length) : 0,
        type: 'money',
      },
      { label: 'Best customer', value: customers[0]?.name ?? '—', type: 'text' },
    ],
    tables: [
      {
        title: 'Customer spend',
        subtitle: 'Net of refunds. Walk-in sales are not attributed to a customer.',
        columns: [
          { key: 'customerCode', label: 'Code', type: 'text', width: 16 },
          { key: 'name', label: 'Customer', type: 'text', width: 28 },
          { key: 'phone', label: 'Phone', type: 'text', width: 16 },
          { key: 'orders', label: 'Orders', type: 'number', width: 9 },
          { key: 'totalSpent', label: 'Total spent', type: 'money', width: 16 },
          { key: 'lastPurchaseAt', label: 'Last purchase', type: 'instant', width: 18 },
        ],
        rows: customers.map((c) => ({ ...c, id: null })),
        totals: {
          orders: sumBy(customers, (c) => c.orders),
          totalSpent,
        },
        emptyMessage: 'No customer-attributed sales in this period.',
      },
    ],
  };
}

/** Repair work in the period (spec §46). */
function servicesReport(range: DayRange, db: Db): Pick<Report, 'figures' | 'tables'> {
  const summary = serviceSummary(range, db);
  const jobs = serviceReport(range, db);

  return {
    figures: [
      { label: 'Jobs received', value: summary.received, type: 'number' },
      { label: 'Jobs delivered', value: summary.delivered, type: 'number' },
      { label: 'Repair income', value: summary.revenue, type: 'money', hint: 'Jobs delivered in the period' },
      { label: 'Parts used', value: summary.partsCost, type: 'money' },
      { label: 'Gross profit', value: summary.grossProfit, type: 'money', emphasis: true },
      { label: 'Still owed', value: summary.outstanding, type: 'money', hint: 'Across all open jobs' },
    ],
    tables: [
      {
        title: 'Service jobs',
        columns: [
          { key: 'serviceNumber', label: 'Job', type: 'text', width: 18 },
          { key: 'receivedDay', label: 'Received', type: 'day', width: 14 },
          { key: 'customerName', label: 'Customer', type: 'text', width: 24 },
          { key: 'device', label: 'Device', type: 'text', width: 26 },
          { key: 'imei', label: 'IMEI', type: 'text', width: 18 },
          { key: 'statusLabel', label: 'Status', type: 'text', width: 16 },
          { key: 'finalCost', label: 'Charge', type: 'money', width: 14 },
          { key: 'partsCost', label: 'Parts', type: 'money', width: 14 },
          { key: 'grossProfit', label: 'Profit', type: 'money', width: 14 },
          { key: 'balance', label: 'Owing', type: 'money', width: 14 },
        ],
        rows: jobs.map((job) => ({
          serviceNumber: job.serviceNumber,
          receivedDay: job.receivedDay,
          customerName: job.customerName,
          device: job.device,
          imei: job.imei,
          statusLabel: SERVICE_STATUS_LABELS[job.status as ServiceStatus] ?? job.status,
          finalCost: job.finalCost,
          partsCost: job.partsCost,
          grossProfit: job.grossProfit,
          balance: job.balance,
        })),
        totals: {
          finalCost: sumBy(jobs, (j) => j.finalCost),
          partsCost: sumBy(jobs, (j) => j.partsCost),
          grossProfit: sumBy(jobs, (j) => j.grossProfit),
          balance: sumBy(jobs, (j) => j.balance),
        },
        emptyMessage: 'No repair jobs received in this period.',
      },
      {
        title: 'Jobs by status',
        subtitle: 'All jobs, not only this period — a job in the workshop still needs finishing',
        columns: [
          { key: 'statusLabel', label: 'Status', type: 'text', width: 20 },
          { key: 'count', label: 'Jobs', type: 'number', width: 9 },
        ],
        rows: summary.byStatus.map((s) => ({
          statusLabel: SERVICE_STATUS_LABELS[s.status as ServiceStatus] ?? s.status,
          count: s.count,
        })),
        totals: { count: sumBy(summary.byStatus, (s) => s.count) },
      },
    ],
  };
}
