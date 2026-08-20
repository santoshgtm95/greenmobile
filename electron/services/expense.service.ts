/**
 * Shop running costs (spec §18, §19, §43).
 *
 * Expenses are the "operating expenses" line of the profit and loss report, so
 * they are never hard-deleted: an expense that has already been counted in a
 * report is flagged isDeleted and excluded from then on, which keeps a report run
 * last month reproducible (spec §74).
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase, transaction } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant, businessDay } from '../../shared/datetime';
import { errors } from '../../shared/errors';
import { recordAudit } from './audit.service';
import { nextNumber } from './sequence.service';
import type { SessionUser } from '../session';
import type { PaymentMethod } from '../../shared/domain';
import type {
  CreateExpenseInput,
  UpdateExpenseInput,
  ExpenseListQuery,
  SaveLookupInput,
} from '../../shared/validation';

export interface ExpenseRow {
  id: string;
  expenseNumber: string;
  categoryId: string;
  categoryName: string;
  expenseDate: string;
  expenseDay: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  notes: string | null;
  isDeleted: number;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

const EXPENSE_SELECT = `
  SELECT e.id, e.expenseNumber, e.categoryId, c.name AS categoryName, e.expenseDate, e.expenseDay,
         e.description, e.amount, e.paymentMethod, e.referenceNumber, e.notes, e.isDeleted,
         e.createdBy, u.fullName AS createdByName, e.createdAt
    FROM "Expense" e
    JOIN "ExpenseCategory" c ON c.id = e.categoryId
    LEFT JOIN "User" u ON u.id = e.createdBy
`;

export function listExpenses(
  query: ExpenseListQuery,
  db: Db = getDatabase(),
): { rows: ExpenseRow[]; total: number; totalAmount: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  // Deleted expenses stay in the table but are out of sight and out of reports.
  if (!query.includeDeleted) where.push('e.isDeleted = 0');

  if (query.from) {
    where.push('e.expenseDay >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('e.expenseDay <= ?');
    params.push(query.to);
  }
  if (query.categoryId) {
    where.push('e.categoryId = ?');
    params.push(query.categoryId);
  }
  if (query.paymentMethod) {
    where.push('e.paymentMethod = ?');
    params.push(query.paymentMethod);
  }
  if (query.search) {
    where.push('(e.description LIKE ? COLLATE NOCASE OR e.expenseNumber LIKE ? COLLATE NOCASE OR e.referenceNumber LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const aggregate = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(e.amount), 0) AS total FROM "Expense" e ${whereSql}`,
    )
    .get(...params) as { n: number; total: number };

  const rows = db
    .prepare(`${EXPENSE_SELECT} ${whereSql} ORDER BY e.expenseDate DESC LIMIT ? OFFSET ?`)
    .all(...params, query.pageSize, query.page * query.pageSize) as ExpenseRow[];

  return { rows, total: aggregate.n, totalAmount: aggregate.total };
}

export function getExpense(id: string, db: Db = getDatabase()): ExpenseRow {
  const row = db.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).get(id) as ExpenseRow | undefined;
  if (!row) throw errors.notFound('expense');
  return row;
}

export function createExpense(
  input: CreateExpenseInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ExpenseRow {
  return transaction(() => {
    const category = db
      .prepare(`SELECT id, name FROM "ExpenseCategory" WHERE id = ?`)
      .get(input.categoryId) as { id: string; name: string } | undefined;
    if (!category) throw errors.notFound('expense category');

    const id = newId();
    const number = nextNumber('expense', db);
    const now = nowInstant();

    // The date comes from the form as a business day; the instant is derived so
    // ordering still works for several expenses entered on the same day.
    const expenseDay = input.expenseDay;
    const expenseDate = businessDayToInstant(expenseDay, now);

    db.prepare(
      `INSERT INTO "Expense" (id, expenseNumber, categoryId, expenseDate, expenseDay, description,
         amount, paymentMethod, referenceNumber, notes, isDeleted, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(
      id,
      number,
      input.categoryId,
      expenseDate,
      expenseDay,
      input.description,
      input.amount,
      input.paymentMethod,
      input.referenceNumber ?? null,
      input.notes ?? null,
      actor.id,
      now,
      now,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'Expense',
        entityId: id,
        summary: `Expense ${number} — ${category.name}, ${input.amount} (${input.description})`,
        newValues: input,
      },
      db,
    );

    return getExpense(id, db);
  }, db);
}

export function updateExpense(
  input: UpdateExpenseInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ExpenseRow {
  return transaction(() => {
    const before = getExpense(input.id, db);
    if (before.isDeleted) {
      throw errors.invalidState('This expense has been deleted and can no longer be edited.');
    }

    const now = nowInstant();
    const expenseDate = businessDayToInstant(input.expenseDay, before.expenseDate);

    db.prepare(
      `UPDATE "Expense"
          SET categoryId = ?, expenseDate = ?, expenseDay = ?, description = ?, amount = ?,
              paymentMethod = ?, referenceNumber = ?, notes = ?, updatedAt = ?
        WHERE id = ?`,
    ).run(
      input.categoryId,
      expenseDate,
      input.expenseDay,
      input.description,
      input.amount,
      input.paymentMethod,
      input.referenceNumber ?? null,
      input.notes ?? null,
      now,
      input.id,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'Expense',
        entityId: input.id,
        summary: `Updated expense ${before.expenseNumber}`,
        oldValues: before,
        newValues: input,
      },
      db,
    );

    return getExpense(input.id, db);
  }, db);
}

/** Soft delete. The row stays so past reports remain reproducible. */
export function deleteExpense(
  id: string,
  reason: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): void {
  transaction(() => {
    const before = getExpense(id, db);
    if (before.isDeleted) return;

    db.prepare(`UPDATE "Expense" SET isDeleted = 1, updatedAt = ? WHERE id = ?`).run(
      nowInstant(),
      id,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'Expense',
        entityId: id,
        summary: `Deleted expense ${before.expenseNumber} — ${reason}`,
        oldValues: before,
      },
      db,
    );
  }, db);
}

/**
 * Turns a business day into a UTC instant.
 *
 * When the day is today the current time is kept, so several expenses entered in
 * one session stay in the order they were added. For any other day it anchors at
 * midday local time — far enough from either boundary that the instant and the
 * business day never disagree about which day it was.
 */
function businessDayToInstant(day: string, fallbackInstant: string): string {
  if (day === businessDay()) return nowInstant();
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return fallbackInstant;
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

// -----------------------------------------------------------------------------
// Summaries — used by the expense report and the dashboard
// -----------------------------------------------------------------------------

export interface ExpenseSummary {
  total: number;
  count: number;
  byCategory: Array<{ categoryId: string; categoryName: string; total: number; count: number }>;
  byDay: Array<{ day: string; total: number }>;
  byPaymentMethod: Array<{ paymentMethod: string; total: number; count: number }>;
}

export function expenseSummary(
  range: { from: string; to: string },
  db: Db = getDatabase(),
): ExpenseSummary {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM "Expense"
        WHERE isDeleted = 0 AND expenseDay BETWEEN ? AND ?`,
    )
    .get(range.from, range.to) as { total: number; count: number };

  const byCategory = db
    .prepare(
      `SELECT e.categoryId, c.name AS categoryName, SUM(e.amount) AS total, COUNT(*) AS count
         FROM "Expense" e
         JOIN "ExpenseCategory" c ON c.id = e.categoryId
        WHERE e.isDeleted = 0 AND e.expenseDay BETWEEN ? AND ?
        GROUP BY e.categoryId, c.name
        ORDER BY total DESC`,
    )
    .all(range.from, range.to) as ExpenseSummary['byCategory'];

  const byDay = db
    .prepare(
      `SELECT expenseDay AS day, SUM(amount) AS total
         FROM "Expense"
        WHERE isDeleted = 0 AND expenseDay BETWEEN ? AND ?
        GROUP BY expenseDay
        ORDER BY expenseDay ASC`,
    )
    .all(range.from, range.to) as ExpenseSummary['byDay'];

  const byPaymentMethod = db
    .prepare(
      `SELECT paymentMethod, SUM(amount) AS total, COUNT(*) AS count
         FROM "Expense"
        WHERE isDeleted = 0 AND expenseDay BETWEEN ? AND ?
        GROUP BY paymentMethod
        ORDER BY total DESC`,
    )
    .all(range.from, range.to) as ExpenseSummary['byPaymentMethod'];

  return { total: totals.total, count: totals.count, byCategory, byDay, byPaymentMethod };
}

// -----------------------------------------------------------------------------
// Expense categories
// -----------------------------------------------------------------------------

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  description: string | null;
  isActive: number;
  expenseCount: number;
  totalAmount: number;
}

export function listExpenseCategories(
  includeInactive = false,
  db: Db = getDatabase(),
): ExpenseCategoryRow[] {
  return db
    .prepare(
      `SELECT c.id, c.name, c.description, c.isActive,
              (SELECT COUNT(*) FROM "Expense" e WHERE e.categoryId = c.id AND e.isDeleted = 0)
                AS expenseCount,
              COALESCE((SELECT SUM(e.amount) FROM "Expense" e
                         WHERE e.categoryId = c.id AND e.isDeleted = 0), 0) AS totalAmount
         FROM "ExpenseCategory" c
        ${includeInactive ? '' : 'WHERE c.isActive = 1'}
        ORDER BY c.name ASC`,
    )
    .all() as ExpenseCategoryRow[];
}

export function saveExpenseCategory(
  input: SaveLookupInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ExpenseCategoryRow {
  return transaction(() => {
    const clash = db
      .prepare(`SELECT id FROM "ExpenseCategory" WHERE name = ? COLLATE NOCASE AND id IS NOT ?`)
      .get(input.name, input.id ?? null) as { id: string } | undefined;
    if (clash) {
      throw errors.validation('An expense category with that name already exists.', {
        name: 'Already in use',
      });
    }

    const now = nowInstant();
    const id = input.id ?? newId();

    if (input.id) {
      db.prepare(
        `UPDATE "ExpenseCategory" SET name = ?, description = ?, isActive = ?, updatedAt = ?
          WHERE id = ?`,
      ).run(input.name, input.description ?? null, input.isActive ? 1 : 0, now, id);
    } else {
      db.prepare(
        `INSERT INTO "ExpenseCategory" (id, name, description, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, input.name, input.description ?? null, input.isActive ? 1 : 0, now, now);
    }

    recordAudit(
      {
        userId: actor.id,
        action: input.id ? 'UPDATE' : 'CREATE',
        entityName: 'ExpenseCategory',
        entityId: id,
        summary: `Saved expense category "${input.name}"`,
        newValues: input,
      },
      db,
    );

    const row = listExpenseCategories(true, db).find((c) => c.id === id);
    if (!row) throw errors.notFound('expense category');
    return row;
  }, db);
}
