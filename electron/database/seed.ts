/**
 * Reference data written on first run.
 *
 * Everything here is idempotent (INSERT ... ON CONFLICT DO NOTHING) so it is
 * safe to call on every startup: a shop that renames or deactivates a default
 * category will never have it silently resurrected or overwritten.
 *
 * Deliberately absent: any user account. There is no default password in this
 * application — the administrator is created by the first-run wizard (spec §88).
 */
import type { Database as Db } from 'better-sqlite3';
import { newId } from '../utils/id';
import { nowInstant } from '../../shared/datetime';
import { DEFAULT_SETTINGS, SETTING_KEYS } from '../../shared/settings';
import { logger } from '../utils/logger';

/** Spec §11 */
const DEFAULT_CATEGORIES = [
  'Smartphones',
  'Tablets',
  'Accessories',
  'Chargers',
  'Cables',
  'Earphones',
  'Power Banks',
  'Smart Watches',
  'Spare Parts',
  'Other',
];

/** Spec §12 */
const DEFAULT_BRANDS = [
  'Apple',
  'Samsung',
  'Xiaomi',
  'OPPO',
  'Vivo',
  'Huawei',
  'Realme',
  'Other',
];

/** Spec §18 */
const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Internet',
  'Salary',
  'Transportation',
  'Marketing',
  'Office Supplies',
  'Repair Cost',
  'Maintenance',
  'Other',
];

export function seedReferenceData(db: Db): void {
  const now = nowInstant();

  const insertCategory = db.prepare(
    `INSERT INTO "Category" (id, name, description, isActive, createdAt, updatedAt)
     VALUES (?, ?, NULL, 1, ?, ?)
     ON CONFLICT(name) DO NOTHING`,
  );
  const insertBrand = db.prepare(
    `INSERT INTO "Brand" (id, name, description, isActive, createdAt, updatedAt)
     VALUES (?, ?, NULL, 1, ?, ?)
     ON CONFLICT(name) DO NOTHING`,
  );
  const insertExpenseCategory = db.prepare(
    `INSERT INTO "ExpenseCategory" (id, name, description, isActive, createdAt, updatedAt)
     VALUES (?, ?, NULL, 1, ?, ?)
     ON CONFLICT(name) DO NOTHING`,
  );
  const insertSetting = db.prepare(
    `INSERT INTO "Setting" (id, key, value, updatedAt, updatedBy)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(key) DO NOTHING`,
  );

  db.transaction(() => {
    for (const name of DEFAULT_CATEGORIES) insertCategory.run(newId(), name, now, now);
    for (const name of DEFAULT_BRANDS) insertBrand.run(newId(), name, now, now);
    for (const name of DEFAULT_EXPENSE_CATEGORIES) insertExpenseCategory.run(newId(), name, now, now);
    for (const key of SETTING_KEYS) insertSetting.run(newId(), key, DEFAULT_SETTINGS[key], now);
  }).immediate();

  logger.info('Reference data ensured', {
    categories: DEFAULT_CATEGORIES.length,
    brands: DEFAULT_BRANDS.length,
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES.length,
    settings: SETTING_KEYS.length,
  });
}

/** True when no user account exists yet, i.e. the first-run wizard must run. */
export function needsFirstRunSetup(db: Db): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "User"`).get() as { n: number };
  return row.n === 0;
}
