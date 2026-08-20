/**
 * Trading aggregation (spec §47, §49, §50).
 *
 * Every figure here is computed by SQL over the values FROZEN ON THE SALE, never
 * over today's product prices (spec §16, §49). A price change tomorrow cannot
 * rewrite what last month's profit was.
 *
 * NETTING FOR RETURNS
 *
 * A line's contribution is scaled by the quantity that actually stayed sold:
 *
 *     netQty = quantity - returnedQuantity
 *
 * Money that was itemised per line (discount, tax) is apportioned by that ratio.
 * For the ordinary cases — nothing returned, or a whole line returned — the
 * arithmetic is exact; a partial return of a discounted line rounds to the
 * nearest minor unit, which is the best a per-line report can do.
 *
 * CANCELLED SALES ARE EXCLUDED ENTIRELY. A cancelled sale never happened as far
 * as the books are concerned; a refunded one happened and was partly undone.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase } from '../database/connection';
import { subtractMoney, addMoney } from '../../shared/money';
import { addDays, eachDay, type DayRange } from '../../shared/datetime';
import { expenseSummary } from './expense.service';
import { serviceSummary } from './service.service';
import { lowStock } from './inventory.service';
import { getShopSettings } from './settings.service';

/**
 * Per-line net values, shared by every sales figure below.
 *
 * Kept as one string so there is a single definition of "what this line was
 * really worth" rather than the same CASE expression copied into six queries.
 */
const NET_LINES = `
  SELECT
    i.saleId,
    i.productId,
    i.productName,
    i.sku,
    s.saleDay,
    (i.quantity - i.returnedQuantity) AS netQty,
    i.unitPrice * (i.quantity - i.returnedQuantity) AS netGross,
    CASE WHEN i.quantity > 0
         THEN CAST(ROUND(i.discountAmount * 1.0 * (i.quantity - i.returnedQuantity) / i.quantity) AS INTEGER)
         ELSE 0 END AS netDiscount,
    CASE WHEN i.quantity > 0
         THEN CAST(ROUND(i.taxAmount * 1.0 * (i.quantity - i.returnedQuantity) / i.quantity) AS INTEGER)
         ELSE 0 END AS netTax,
    i.unitCost * (i.quantity - i.returnedQuantity) AS netCost
  FROM "SaleItem" i
  JOIN "Sale" s ON s.id = i.saleId
  WHERE s.status <> 'CANCELLED'
    AND s.saleDay BETWEEN ? AND ?
`;

export interface SalesSummary {
  /** Number of sales (excluding cancelled). */
  transactions: number;
  /** Units that stayed sold. */
  itemsSold: number;
  /** Money before discount, excluding tax. */
  grossSales: number;
  discounts: number;
  tax: number;
  /** grossSales - discounts. Tax is the government's, not revenue. */
  netSales: number;
  /** Cost of goods, from the unit cost recorded at the time of sale. */
  cogs: number;
  /** netSales - cogs */
  grossProfit: number;
  /** Money handed back through returns, tax included. */
  refunds: number;
}

export function salesSummary(range: DayRange, db: Db = getDatabase()): SalesSummary {
  const lines = db
    .prepare(
      `SELECT COALESCE(SUM(netQty), 0) AS itemsSold,
              COALESCE(SUM(netGross), 0) AS grossSales,
              COALESCE(SUM(netDiscount), 0) AS discounts,
              COALESCE(SUM(netTax), 0) AS tax,
              COALESCE(SUM(netCost), 0) AS cogs
         FROM (${NET_LINES})`,
    )
    .get(range.from, range.to) as {
    itemsSold: number;
    grossSales: number;
    discounts: number;
    tax: number;
    cogs: number;
  };

  const sales = db
    .prepare(
      `SELECT COUNT(*) AS transactions, COALESCE(SUM(refundedAmount), 0) AS refunds
         FROM "Sale"
        WHERE status <> 'CANCELLED' AND saleDay BETWEEN ? AND ?`,
    )
    .get(range.from, range.to) as { transactions: number; refunds: number };

  const netSales = subtractMoney(lines.grossSales, lines.discounts);

  return {
    transactions: sales.transactions,
    itemsSold: lines.itemsSold,
    grossSales: lines.grossSales,
    discounts: lines.discounts,
    tax: lines.tax,
    netSales,
    cogs: lines.cogs,
    grossProfit: subtractMoney(netSales, lines.cogs),
    refunds: sales.refunds,
  };
}

export interface DayPoint {
  day: string;
  transactions: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
}

/** Sales per business day, zero-filled so a chart has no gaps. */
export function salesByDay(range: DayRange, db: Db = getDatabase()): DayPoint[] {
  const rows = db
    .prepare(
      `SELECT saleDay AS day,
              COUNT(DISTINCT saleId) AS transactions,
              COALESCE(SUM(netGross - netDiscount), 0) AS netSales,
              COALESCE(SUM(netCost), 0) AS cogs
         FROM (${NET_LINES})
        GROUP BY saleDay`,
    )
    .all(range.from, range.to) as Array<{
    day: string;
    transactions: number;
    netSales: number;
    cogs: number;
  }>;

  const byDay = new Map(rows.map((row) => [row.day, row]));

  return eachDay(range).map((day) => {
    const row = byDay.get(day);
    const netSales = row?.netSales ?? 0;
    const cogs = row?.cogs ?? 0;
    return {
      day,
      transactions: row?.transactions ?? 0,
      netSales,
      cogs,
      grossProfit: subtractMoney(netSales, cogs),
    };
  });
}

export interface ProductPoint {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  netSales: number;
  grossProfit: number;
}

/** Best sellers by revenue (spec §47). */
export function topProducts(range: DayRange, limit = 10, db: Db = getDatabase()): ProductPoint[] {
  return db
    .prepare(
      `SELECT productId, productName, sku,
              SUM(netQty) AS quantity,
              SUM(netGross - netDiscount) AS netSales,
              SUM(netGross - netDiscount - netCost) AS grossProfit
         FROM (${NET_LINES})
        GROUP BY productId, productName, sku
       HAVING quantity > 0
        ORDER BY netSales DESC
        LIMIT ?`,
    )
    .all(range.from, range.to, limit) as ProductPoint[];
}

export interface CategoryPoint {
  categoryName: string;
  quantity: number;
  netSales: number;
}

/**
 * Sales by category.
 *
 * Joins through the product, so a product moved to another category will report
 * under its current one — categories describe the catalogue, not the receipt.
 */
export function salesByCategory(range: DayRange, db: Db = getDatabase()): CategoryPoint[] {
  return db
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorised') AS categoryName,
              SUM(l.netQty) AS quantity,
              SUM(l.netGross - l.netDiscount) AS netSales
         FROM (${NET_LINES}) l
         LEFT JOIN "Product" p ON p.id = l.productId
         LEFT JOIN "Category" c ON c.id = p.categoryId
        GROUP BY categoryName
       HAVING quantity > 0
        ORDER BY netSales DESC`,
    )
    .all(range.from, range.to) as CategoryPoint[];
}

export interface PaymentPoint {
  paymentMethod: string;
  count: number;
  total: number;
}

/** How customers actually paid (spec §47). */
export function salesByPaymentMethod(range: DayRange, db: Db = getDatabase()): PaymentPoint[] {
  return db
    .prepare(
      `SELECT p.paymentMethod, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS total
         FROM "Payment" p
         JOIN "Sale" s ON s.id = p.saleId
        WHERE s.status <> 'CANCELLED' AND p.paymentDay BETWEEN ? AND ?
        GROUP BY p.paymentMethod
        ORDER BY total DESC`,
    )
    .all(range.from, range.to) as PaymentPoint[];
}

export interface ProfitAndLoss {
  range: DayRange;
  goods: {
    netSales: number;
    cogs: number;
    grossProfit: number;
  };
  services: {
    revenue: number;
    partsCost: number;
    grossProfit: number;
  };
  /** goods.grossProfit + services.grossProfit */
  totalGrossProfit: number;
  expenses: number;
  /** totalGrossProfit - expenses */
  netProfit: number;
  /** Collected on behalf of the tax authority; not income. */
  taxCollected: number;
}

/**
 * Profit and loss (spec §49).
 *
 * The specification's formula covers goods. Repair work is a second income
 * stream for this kind of shop, so it is reported as its own line and folded
 * into gross profit rather than being left out of the owner's bottom line.
 * Labour on a repair carries no cost of goods — only the parts do.
 */
export function profitAndLoss(range: DayRange, db: Db = getDatabase()): ProfitAndLoss {
  const sales = salesSummary(range, db);
  const services = serviceSummary(range, db);
  const expenses = expenseSummary(range, db);

  const totalGrossProfit = addMoney(sales.grossProfit, services.grossProfit);

  return {
    range,
    goods: {
      netSales: sales.netSales,
      cogs: sales.cogs,
      grossProfit: sales.grossProfit,
    },
    services: {
      revenue: services.revenue,
      partsCost: services.partsCost,
      grossProfit: services.grossProfit,
    },
    totalGrossProfit,
    expenses: expenses.total,
    netProfit: subtractMoney(totalGrossProfit, expenses.total),
    taxCollected: sales.tax,
  };
}

// -----------------------------------------------------------------------------
// Dashboard (spec §31, §72)
// -----------------------------------------------------------------------------

export interface RecentSale {
  id: string;
  invoiceNumber: string;
  customerName: string;
  grandTotal: number;
  status: string;
  saleDate: string;
  cashierName: string | null;
}

export interface RecentExpense {
  id: string;
  expenseNumber: string;
  categoryName: string;
  description: string;
  amount: number;
  expenseDay: string;
}

export interface RecentService {
  id: string;
  serviceNumber: string;
  customerName: string;
  deviceBrand: string;
  deviceModel: string;
  status: string;
  finalCost: number;
  receivedDate: string;
}

/** A trend needs more than one point to be a trend. */
const MIN_TREND_DAYS = 7;

export interface Dashboard {
  range: DayRange;
  /**
   * The window the by-day charts actually cover. Equal to `range` unless the
   * selected period was shorter than a week, in which case it is widened so the
   * trend has something to show. The UI labels it, so the two are never confused.
   */
  trendRange: DayRange;
  currency: string;
  cards: {
    transactions: number;
    itemsSold: number;
    revenue: number;
    expenses: number;
    grossProfit: number;
    netProfit: number;
    serviceRevenue: number;
    outstandingServiceBalance: number;
    lowStockCount: number;
  };
  charts: {
    salesByDay: DayPoint[];
    revenueVsExpenses: Array<{ day: string; revenue: number; expenses: number }>;
    topProducts: ProductPoint[];
    salesByCategory: CategoryPoint[];
    paymentMethods: PaymentPoint[];
  };
  recent: {
    sales: RecentSale[];
    expenses: RecentExpense[];
    services: RecentService[];
  };
  lowStock: Array<{
    id: string;
    sku: string;
    name: string;
    stockQuantity: number;
    minimumStock: number;
    categoryName: string | null;
  }>;
}

/**
 * Everything the dashboard shows, for whatever range it was asked for.
 *
 * Deliberately takes a range rather than assuming today (spec §72): the same
 * function serves "Today", "This Month" and a custom period.
 */
export function dashboard(range: DayRange, db: Db = getDatabase()): Dashboard {
  const settings = getShopSettings(db);
  const sales = salesSummary(range, db);
  const expenses = expenseSummary(range, db);
  const services = serviceSummary(range, db);
  const pl = profitAndLoss(range, db);

  // The cards answer the exact period asked for; the trend charts widen to at
  // least a week so "Today" does not render as a single unconnected dot.
  const trendRange: DayRange =
    eachDay(range).length >= MIN_TREND_DAYS
      ? range
      : { from: addDays(range.to, -(MIN_TREND_DAYS - 1)), to: range.to };

  const byDay = salesByDay(trendRange, db);
  const trendExpenses = expenseSummary(trendRange, db);
  const expensesByDay = new Map(trendExpenses.byDay.map((row) => [row.day, row.total]));

  const lowStockRows = lowStock(settings.lowStockThreshold, db);

  const recentSales = db
    .prepare(
      `SELECT s.id, s.invoiceNumber, s.customerName, s.grandTotal, s.status, s.saleDate,
              u.fullName AS cashierName
         FROM "Sale" s
         LEFT JOIN "User" u ON u.id = s.createdBy
        ORDER BY s.saleDate DESC
        LIMIT 8`,
    )
    .all() as RecentSale[];

  const recentExpenses = db
    .prepare(
      `SELECT e.id, e.expenseNumber, c.name AS categoryName, e.description, e.amount, e.expenseDay
         FROM "Expense" e
         JOIN "ExpenseCategory" c ON c.id = e.categoryId
        WHERE e.isDeleted = 0
        ORDER BY e.expenseDate DESC
        LIMIT 8`,
    )
    .all() as RecentExpense[];

  const recentServices = db
    .prepare(
      `SELECT id, serviceNumber, customerName, deviceBrand, deviceModel, status, finalCost,
              receivedDate
         FROM "ServiceOrder"
        ORDER BY receivedDate DESC
        LIMIT 8`,
    )
    .all() as RecentService[];

  return {
    range,
    trendRange,
    currency: settings.currency,
    cards: {
      transactions: sales.transactions,
      itemsSold: sales.itemsSold,
      revenue: sales.netSales,
      expenses: expenses.total,
      grossProfit: pl.totalGrossProfit,
      netProfit: pl.netProfit,
      serviceRevenue: services.revenue,
      outstandingServiceBalance: services.outstanding,
      lowStockCount: lowStockRows.length,
    },
    charts: {
      salesByDay: byDay,
      revenueVsExpenses: byDay.map((point) => ({
        day: point.day,
        revenue: point.netSales,
        expenses: expensesByDay.get(point.day) ?? 0,
      })),
      topProducts: topProducts(range, 8, db),
      salesByCategory: salesByCategory(range, db),
      paymentMethods: salesByPaymentMethod(range, db),
    },
    recent: {
      sales: recentSales,
      expenses: recentExpenses,
      services: recentServices,
    },
    lowStock: lowStockRows.slice(0, 10),
  };
}
