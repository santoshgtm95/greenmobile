/**
 * Expenses and expense categories (spec §28, §43).
 *
 * Deleting an expense needs its own permission, separate from creating and
 * editing them, because it changes what a profit and loss report will say.
 */
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import {
  zExpenseListQuery,
  zCreateExpense,
  zUpdateExpense,
  zDeleteExpense,
  zIdOnly,
  zSaveLookup,
  zLookupQuery,
  zDayRange,
} from '../../shared/validation';
import {
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  deleteExpense,
  expenseSummary,
  listExpenseCategories,
  saveExpenseCategory,
} from '../services/expense.service';
import { requireUser } from '../session';

export function registerExpensesIpc(): void {
  handle(CHANNELS.expenses.list, { access: 'permission', permission: 'expenses.view' }, zExpenseListQuery, (q) =>
    listExpenses(q),
  );

  handle(CHANNELS.expenses.get, { access: 'permission', permission: 'expenses.view' }, zIdOnly, ({ id }) =>
    getExpense(id),
  );

  handle(
    CHANNELS.expenses.create,
    { access: 'permission', permission: 'expenses.manage' },
    zCreateExpense,
    (input) => createExpense(input, requireUser()),
  );

  handle(
    CHANNELS.expenses.update,
    { access: 'permission', permission: 'expenses.manage' },
    zUpdateExpense,
    (input) => updateExpense(input, requireUser()),
  );

  handle(
    CHANNELS.expenses.delete,
    { access: 'permission', permission: 'expenses.delete' },
    zDeleteExpense,
    ({ id, reason }) => {
      deleteExpense(id, reason, requireUser());
    },
  );

  handle(CHANNELS.expenses.summary, { access: 'permission', permission: 'expenses.view' }, zDayRange, (range) =>
    expenseSummary(range),
  );

  handle(
    CHANNELS.expenseCategories.list,
    { access: 'permission', permission: 'expenses.view' },
    zLookupQuery,
    ({ includeInactive }) => listExpenseCategories(includeInactive),
  );

  handle(
    CHANNELS.expenseCategories.save,
    { access: 'permission', permission: 'expenses.manage' },
    zSaveLookup,
    (input) => saveExpenseCategory(input, requireUser()),
  );
}
