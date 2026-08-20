/**
 * Typed access to the Setting table.
 *
 * Nothing in the application hard-codes a currency, tax rate, receipt width or
 * stock policy (spec §59, §60, §67) — it all comes from here. Values are stored
 * as TEXT and parsed on read, with the defaults in shared/settings.ts as the
 * fallback so a missing row can never crash a sale.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant } from '../../shared/datetime';
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  type SettingKey,
  type ShopSettings,
} from '../../shared/settings';
import { RECEIPT_WIDTHS, TAX_MODES, AUTO_BACKUP_FREQUENCIES } from '../../shared/domain';
import { CURRENCY_DECIMALS } from '../../shared/money';

function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

export function getRaw(key: SettingKey, db: Db = getDatabase()): string {
  const row = db.prepare(`SELECT value FROM "Setting" WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? DEFAULT_SETTINGS[key];
}

export function getAllRaw(db: Db = getDatabase()): Record<SettingKey, string> {
  const rows = db.prepare(`SELECT key, value FROM "Setting"`).all() as {
    key: string;
    value: string;
  }[];
  const result = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (isSettingKey(row.key)) result[row.key] = row.value;
  }
  return result;
}

function toBoolean(value: string): boolean {
  return value === 'true' || value === '1';
}

function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The strongly-typed view used throughout the application. */
export function getShopSettings(db: Db = getDatabase()): ShopSettings {
  const raw = getAllRaw(db);

  const currency = raw.currency.toUpperCase();
  const receiptWidth = (RECEIPT_WIDTHS as readonly string[]).includes(raw.receiptWidth)
    ? (raw.receiptWidth as ShopSettings['receiptWidth'])
    : '80mm';
  const taxMode = (TAX_MODES as readonly string[]).includes(raw.taxMode)
    ? (raw.taxMode as ShopSettings['taxMode'])
    : 'EXCLUSIVE';
  const autoBackupFrequency = (AUTO_BACKUP_FREQUENCIES as readonly string[]).includes(
    raw.autoBackupFrequency,
  )
    ? (raw.autoBackupFrequency as ShopSettings['autoBackupFrequency'])
    : 'DAILY';

  return {
    shopName: raw.shopName,
    shopAddress: raw.shopAddress,
    shopPhone: raw.shopPhone,
    shopEmail: raw.shopEmail,
    shopLogo: raw.shopLogo,
    currency: currency in CURRENCY_DECIMALS ? currency : currency || 'THB',
    taxEnabled: toBoolean(raw.taxEnabled),
    taxRate: Math.max(0, toInt(raw.taxRate, 0)),
    taxMode,
    invoicePrefix: raw.invoicePrefix,
    receiptWidth,
    receiptFooter: raw.receiptFooter,
    defaultPrinter: raw.defaultPrinter,
    printerAutoPrint: toBoolean(raw.printerAutoPrint),
    lowStockThreshold: Math.max(0, toInt(raw.lowStockThreshold, 5)),
    allowNegativeStock: toBoolean(raw.allowNegativeStock),
    backupLocation: raw.backupLocation,
    autoBackupFrequency,
    autoBackupKeep: Math.max(1, toInt(raw.autoBackupKeep, 10)),
    setupCompleted: toBoolean(raw.setupCompleted),
  };
}

/**
 * Writes settings. Unknown keys are ignored rather than stored, so the renderer
 * cannot grow the settings table with arbitrary data.
 */
export function setSettings(
  values: Partial<Record<SettingKey, string>>,
  updatedBy: string | null,
  db: Db = getDatabase(),
): void {
  const now = nowInstant();
  const upsert = db.prepare(
    `INSERT INTO "Setting" (id, key, value, updatedAt, updatedBy)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                    updatedAt = excluded.updatedAt,
                                    updatedBy = excluded.updatedBy`,
  );

  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      if (!isSettingKey(key) || value === undefined) continue;
      upsert.run(newId(), key, value, now, updatedBy);
    }
  }).immediate();
}

/** Convenience for a single value. */
export function setSetting(
  key: SettingKey,
  value: string,
  updatedBy: string | null,
  db: Db = getDatabase(),
): void {
  setSettings({ [key]: value }, updatedBy, db);
}

/** The effective tax rate for a product, in basis points. */
export function effectiveTaxRate(
  product: { taxRate: number; taxRateOverride: boolean },
  settings: ShopSettings,
): number {
  if (!settings.taxEnabled) return 0;
  return product.taxRateOverride ? Math.max(0, product.taxRate) : settings.taxRate;
}
