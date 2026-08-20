/**
 * Every configurable value in the application, with its default.
 *
 * Nothing about the shop — currency, tax, prefixes, receipt width, stock policy
 * — is hard-coded anywhere else. Settings are stored one row per key in the
 * Setting table as TEXT and parsed through the accessors in
 * electron/services/settings.service.ts.
 */

import { DEFAULT_CURRENCY } from './money';

export const SETTING_KEYS = [
  // Shop identity (spec §58)
  'shopName',
  'shopAddress',
  'shopPhone',
  'shopEmail',
  'shopLogo',

  // Money (spec §59, §60)
  'currency',
  'taxEnabled',
  'taxRate',
  'taxMode',

  // Documents (spec §26)
  'invoicePrefix',
  'invoiceNumber',
  'servicePrefix',
  'serviceNumber',
  'expensePrefix',
  'expenseNumber',
  'returnPrefix',
  'returnNumber',
  'customerPrefix',
  'customerNumber',
  'bankingPrefix',
  'bankingNumber',

  // Printing (spec §37, §38)
  'receiptWidth',
  'receiptFooter',
  'defaultPrinter',
  'printerAutoPrint',

  // Stock policy (spec §67)
  'lowStockThreshold',
  'allowNegativeStock',

  // Backup (spec §53, §54)
  'backupLocation',
  'autoBackupFrequency',
  'autoBackupKeep',
  'lastAutoBackupDay',

  // First-run state (spec §88)
  'setupCompleted',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  shopName: 'Mobile Shop',
  shopAddress: '',
  shopPhone: '',
  shopEmail: '',
  shopLogo: '',

  currency: DEFAULT_CURRENCY,
  taxEnabled: 'false',
  /** Basis points. 700 == 7%. */
  taxRate: '0',
  /** EXCLUSIVE adds tax on top; INCLUSIVE means prices already contain it. */
  taxMode: 'EXCLUSIVE',

  invoicePrefix: 'INV',
  invoiceNumber: '0',
  servicePrefix: 'SRV',
  serviceNumber: '0',
  expensePrefix: 'EXP',
  expenseNumber: '0',
  returnPrefix: 'RET',
  returnNumber: '0',
  customerPrefix: 'CUS',
  customerNumber: '0',
  bankingPrefix: 'BNK',
  bankingNumber: '0',

  receiptWidth: '80mm',
  receiptFooter: 'Thank you for your purchase!',
  defaultPrinter: '',
  printerAutoPrint: 'false',

  lowStockThreshold: '5',
  allowNegativeStock: 'false',

  backupLocation: '',
  autoBackupFrequency: 'DAILY',
  autoBackupKeep: '10',
  lastAutoBackupDay: '',

  setupCompleted: 'false',
};

/**
 * How long a stored value may be, per key.
 *
 * One blanket limit does not work here. Almost every setting is a word or a
 * number, and a generous cap on all of them is a place to hide data; but
 * `shopLogo` holds an inlined image (see shared/logo.ts for why a path will not
 * do) and needs six figures of room. So the default is deliberately mean and the
 * one key that needs space is named.
 */
export const SETTING_VALUE_LIMITS: Partial<Record<SettingKey, number>> = {
  shopLogo: 512 * 1024,
  shopAddress: 500,
  receiptFooter: 500,
  backupLocation: 400,
};

/** Applies to every key not named above. */
export const DEFAULT_SETTING_VALUE_LIMIT = 200;

export function settingValueLimit(key: SettingKey): number {
  return SETTING_VALUE_LIMITS[key] ?? DEFAULT_SETTING_VALUE_LIMIT;
}

/**
 * The only shapes `shopLogo` may take: empty, or an inlined raster image.
 *
 * The value is interpolated into an `<img src>` when a document is printed, so
 * anything else — a `javascript:` URI, a remote URL, an SVG carrying script — is
 * refused here rather than escaped later. document.service.ts checks the same
 * prefix again at render time; this is the boundary that stops it being stored.
 */
export const LOGO_DATA_URI_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function isStorableLogo(value: string): boolean {
  return value === '' || LOGO_DATA_URI_PATTERN.test(value);
}

/** Settings a non-admin may read (the renderer needs these to render prices). */
export const PUBLIC_SETTING_KEYS: readonly SettingKey[] = [
  'shopName',
  'shopAddress',
  'shopPhone',
  'shopEmail',
  'shopLogo',
  'currency',
  'taxEnabled',
  'taxRate',
  'taxMode',
  'receiptWidth',
  'receiptFooter',
  'lowStockThreshold',
  'allowNegativeStock',
  'setupCompleted',
];

/** Strongly-typed view of the settings the application reads most often. */
export interface ShopSettings {
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  shopEmail: string;
  shopLogo: string;
  currency: string;
  taxEnabled: boolean;
  /** Basis points. */
  taxRate: number;
  taxMode: 'EXCLUSIVE' | 'INCLUSIVE';
  invoicePrefix: string;
  receiptWidth: '58mm' | '80mm';
  receiptFooter: string;
  defaultPrinter: string;
  printerAutoPrint: boolean;
  lowStockThreshold: number;
  allowNegativeStock: boolean;
  backupLocation: string;
  autoBackupFrequency: 'DISABLED' | 'DAILY' | 'WEEKLY';
  autoBackupKeep: number;
  setupCompleted: boolean;
}
