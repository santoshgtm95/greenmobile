/**
 * Expenses (spec §19, §43, §48, §73, §74).
 *
 * The important guarantee here is that deleting an expense never removes the
 * row: a profit and loss report run last month must still be reproducible.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import {
  createExpense,
  updateExpense,
  deleteExpense,
  listExpenses,
  expenseSummary,
  listExpenseCategories,
  saveExpenseCategory,
} from '../electron/services/expense.service';
import { AppError } from '../shared/errors';
import { businessDay, addDays } from '../shared/datetime';
import type { FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let actor: SessionUser;
let rentCategoryId: string;

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
  rentCategoryId = listExpenseCategories(false, ctx.db).find((c) => c.name === 'Rent')!.id;
});

afterEach(() => {
  setSessionUser(null);
  ctx.cleanup();
});

function addExpense(overrides: Partial<{ amount: number; day: string; description: string; categoryId: string; method: 'CASH' | 'BANK_TRANSFER' }> = {}) {
  return createExpense(
    {
      categoryId: overrides.categoryId ?? rentCategoryId,
      expenseDay: overrides.day ?? businessDay(),
      description: overrides.description ?? 'Monthly shop rent',
      amount: overrides.amount ?? 1_500_000,
      paymentMethod: overrides.method ?? 'CASH',
      referenceNumber: undefined,
      notes: undefined,
    },
    actor,
    ctx.db,
  );
}

describe('recording expenses', () => {
  it('creates an expense with a sequential number', () => {
    const first = addExpense();
    const second = addExpense({ description: 'Electricity' });

    expect(first.expenseNumber).toMatch(/^EXP-\d{6}-0001$/);
    expect(second.expenseNumber).toMatch(/^EXP-\d{6}-0002$/);
    expect(first.amount).toBe(1_500_000);
    expect(first.categoryName).toBe('Rent');
    expect(first.createdByName).toBe('Owner');
    expect(first.isDeleted).toBe(0);
  });

  it('rejects an unknown category', () => {
    expect(() =>
      createExpense(
        {
          categoryId: 'no-such-category',
          expenseDay: businessDay(),
          description: 'Something',
          amount: 1000,
          paymentMethod: 'CASH',
          referenceNumber: undefined,
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    ).toThrow(AppError);
  });

  it('records the business day it was spent on, not just today', () => {
    const lastWeek = addDays(businessDay(), -7);
    const expense = addExpense({ day: lastWeek });
    expect(expense.expenseDay).toBe(lastWeek);
    // The instant agrees with the business day rather than contradicting it.
    expect(expense.expenseDate.slice(0, 4)).toBe(lastWeek.slice(0, 4));
  });

  it('writes an audit entry', () => {
    const expense = addExpense();
    const row = ctx.db
      .prepare(
        `SELECT action, summary FROM "AuditLog"
          WHERE entityName='Expense' AND entityId=? ORDER BY createdAt DESC LIMIT 1`,
      )
      .get(expense.id) as { action: string; summary: string };
    expect(row.action).toBe('CREATE');
    expect(row.summary).toContain('Rent');
  });

  it('updates an expense and keeps the number', () => {
    const expense = addExpense();
    const updated = updateExpense(
      {
        id: expense.id,
        categoryId: rentCategoryId,
        expenseDay: expense.expenseDay,
        description: 'Rent — corrected',
        amount: 1_600_000,
        paymentMethod: 'BANK_TRANSFER',
        referenceNumber: 'TRX-1',
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    expect(updated.expenseNumber).toBe(expense.expenseNumber);
    expect(updated.amount).toBe(1_600_000);
    expect(updated.description).toBe('Rent — corrected');
    expect(updated.referenceNumber).toBe('TRX-1');
  });
});

describe('deleting expenses (spec §74)', () => {
  it('soft-deletes: the row survives but stops counting', () => {
    const expense = addExpense({ amount: 500_000 });
    expect(expenseSummary({ from: businessDay(), to: businessDay() }, ctx.db).total).toBe(500_000);

    deleteExpense(expense.id, 'Entered twice by mistake', actor, ctx.db);

    // The row is still there…
    const raw = ctx.db.prepare(`SELECT isDeleted FROM "Expense" WHERE id = ?`).get(expense.id) as {
      isDeleted: number;
    };
    expect(raw.isDeleted).toBe(1);

    // …but no longer visible or counted.
    expect(listExpenses(
      { includeDeleted: false, page: 0, pageSize: 50 },
      ctx.db,
    ).total).toBe(0);
    expect(expenseSummary({ from: businessDay(), to: businessDay() }, ctx.db).total).toBe(0);
  });

  it('can still be listed deliberately, for an audit', () => {
    const expense = addExpense();
    deleteExpense(expense.id, 'Duplicate', actor, ctx.db);

    const withDeleted = listExpenses({ includeDeleted: true, page: 0, pageSize: 50 }, ctx.db);
    expect(withDeleted.total).toBe(1);
    expect(withDeleted.rows[0].isDeleted).toBe(1);
  });

  it('refuses to edit a deleted expense', () => {
    const expense = addExpense();
    deleteExpense(expense.id, 'Duplicate', actor, ctx.db);

    expect(() =>
      updateExpense(
        {
          id: expense.id,
          categoryId: rentCategoryId,
          expenseDay: businessDay(),
          description: 'Trying to revive it',
          amount: 1000,
          paymentMethod: 'CASH',
          referenceNumber: undefined,
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    ).toThrow(/deleted/i);
  });

  it('records who deleted it and why', () => {
    const expense = addExpense();
    deleteExpense(expense.id, 'Recorded against the wrong shop', actor, ctx.db);

    const row = ctx.db
      .prepare(`SELECT action, summary, userId FROM "AuditLog" WHERE action='DELETE' LIMIT 1`)
      .get() as { action: string; summary: string; userId: string };
    expect(row.summary).toContain('Recorded against the wrong shop');
    expect(row.userId).toBe(actor.id);
  });

  it('deleting twice is harmless', () => {
    const expense = addExpense();
    deleteExpense(expense.id, 'First', actor, ctx.db);
    expect(() => deleteExpense(expense.id, 'Second', actor, ctx.db)).not.toThrow();
  });
});

describe('filtering and summarising (spec §48)', () => {
  it('filters by category, method, search and date range', () => {
    const electricity = listExpenseCategories(false, ctx.db).find((c) => c.name === 'Electricity')!.id;
    const today = businessDay();
    const lastMonth = addDays(today, -40);

    addExpense({ amount: 1_500_000, description: 'Shop rent' });
    addExpense({ amount: 300_000, categoryId: electricity, description: 'Power bill', method: 'BANK_TRANSFER' });
    addExpense({ amount: 900_000, day: lastMonth, description: 'Old rent' });

    expect(listExpenses({ categoryId: electricity, page: 0, pageSize: 50, includeDeleted: false }, ctx.db).total).toBe(1);
    expect(listExpenses({ paymentMethod: 'BANK_TRANSFER', page: 0, pageSize: 50, includeDeleted: false }, ctx.db).total).toBe(1);
    expect(listExpenses({ search: 'power', page: 0, pageSize: 50, includeDeleted: false }, ctx.db).total).toBe(1);
    expect(listExpenses({ from: today, to: today, page: 0, pageSize: 50, includeDeleted: false }, ctx.db).total).toBe(2);
  });

  it('reports the total amount alongside the page of rows', () => {
    addExpense({ amount: 100_000 });
    addExpense({ amount: 250_000 });

    const result = listExpenses({ page: 0, pageSize: 1, includeDeleted: false }, ctx.db);
    // One row on the page, but the total reflects everything that matched.
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.totalAmount).toBe(350_000);
  });

  it('summarises by category, day and payment method', () => {
    const salary = listExpenseCategories(false, ctx.db).find((c) => c.name === 'Salary')!.id;
    const today = businessDay();
    const yesterday = addDays(today, -1);

    // Deliberately distinct totals per category, so the "biggest first" ordering
    // below is unambiguous rather than a tie broken arbitrarily by SQLite.
    addExpense({ amount: 1_500_000, description: 'Rent' });
    addExpense({ amount: 2_500_000, categoryId: salary, description: 'Wages', method: 'BANK_TRANSFER' });
    addExpense({ amount: 500_000, day: yesterday, description: 'Rent part payment' });

    const summary = expenseSummary({ from: yesterday, to: today }, ctx.db);

    expect(summary.total).toBe(4_500_000);
    expect(summary.count).toBe(3);

    // Ordered by size, biggest first: Salary 25,000 then Rent 20,000.
    expect(summary.byCategory).toHaveLength(2);
    expect(summary.byCategory[0]).toMatchObject({ categoryName: 'Salary', total: 2_500_000, count: 1 });
    expect(summary.byCategory[1]).toMatchObject({ categoryName: 'Rent', total: 2_000_000, count: 2 });

    expect(summary.byDay).toHaveLength(2);
    expect(summary.byDay[0]).toMatchObject({ day: yesterday, total: 500_000 });

    const cash = summary.byPaymentMethod.find((m) => m.paymentMethod === 'CASH');
    expect(cash?.total).toBe(2_000_000);
  });

  it('excludes days outside the range', () => {
    const today = businessDay();
    addExpense({ amount: 100_000, day: addDays(today, -10) });
    const summary = expenseSummary({ from: today, to: today }, ctx.db);
    expect(summary.total).toBe(0);
    expect(summary.byCategory).toHaveLength(0);
  });
});

describe('expense categories (spec §18)', () => {
  it('seeds the ten default categories', () => {
    const categories = listExpenseCategories(false, ctx.db);
    expect(categories).toHaveLength(10);
    expect(categories.map((c) => c.name)).toContain('Rent');
    expect(categories.map((c) => c.name)).toContain('Repair Cost');
  });

  it('creates a category and reports its usage', () => {
    const created = saveExpenseCategory(
      { name: 'Bank Charges', description: 'Fees', isActive: true },
      actor,
      ctx.db,
    );
    expect(created.name).toBe('Bank Charges');
    expect(created.expenseCount).toBe(0);

    addExpense({ amount: 5_000, categoryId: created.id, description: 'Transfer fee' });

    const reread = listExpenseCategories(false, ctx.db).find((c) => c.id === created.id)!;
    expect(reread.expenseCount).toBe(1);
    expect(reread.totalAmount).toBe(5_000);
  });

  it('rejects a duplicate name, case-insensitively', () => {
    expect(() =>
      saveExpenseCategory({ name: 'rent', description: undefined, isActive: true }, actor, ctx.db),
    ).toThrow(AppError);
  });

  it('hides a deactivated category from the active list but keeps its expenses', () => {
    const category = saveExpenseCategory(
      { name: 'Temporary', description: undefined, isActive: true },
      actor,
      ctx.db,
    );
    addExpense({ amount: 1_000, categoryId: category.id, description: 'One off' });

    saveExpenseCategory(
      { id: category.id, name: 'Temporary', description: undefined, isActive: false },
      actor,
      ctx.db,
    );

    expect(listExpenseCategories(false, ctx.db).some((c) => c.id === category.id)).toBe(false);
    expect(listExpenseCategories(true, ctx.db).some((c) => c.id === category.id)).toBe(true);
    // The expense still reports under its category name.
    expect(listExpenses({ page: 0, pageSize: 50, includeDeleted: false }, ctx.db).rows[0].categoryName).toBe(
      'Temporary',
    );
  });
});
