/**
 * Settings — the trust boundary and the typed read (spec §58–§62, §67).
 *
 * The interesting failures here are not "does a value round-trip". They are:
 *
 *   a PARTIAL save must be accepted, because every screen saves the two or three
 *   fields it owns and nothing else. This was broken and unnoticed: the schema
 *   demanded all thirty-odd keys, so saving a backup schedule was refused at the
 *   boundary while the compiler saw nothing wrong.
 *
 *   the LOGO is the one value that ends up inside an <img src> on a printed
 *   invoice, and the one big enough to be worth abusing, so its size and shape are
 *   settled here rather than downstream.
 *
 *   an UNKNOWN key must never reach the table, or the renderer could grow the
 *   settings store into arbitrary storage.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, insertTestUser, type TestDatabase } from './helpers/test-db';
import {
  getAllRaw,
  getRaw,
  getShopSettings,
  setSettings,
} from '../electron/services/settings.service';
import { zUpdateSettings } from '../shared/validation';
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  PUBLIC_SETTING_KEYS,
  settingValueLimit,
  isStorableLogo,
} from '../shared/settings';

let ctx: TestDatabase;
let actorId: string;

beforeEach(() => {
  ctx = createTestDatabase();
  actorId = insertTestUser(ctx.db);
});

afterEach(() => {
  ctx.cleanup();
});

/** A valid inlined image: a 1×1 PNG. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

// -----------------------------------------------------------------------------
// The boundary
// -----------------------------------------------------------------------------

describe('the settings payload schema', () => {
  it('accepts a save of one key on its own', () => {
    // The bug this pins. Every settings panel sends only what it owns.
    const result = zUpdateSettings.safeParse({ values: { autoBackupFrequency: 'WEEKLY' } });
    expect(result.success).toBe(true);
    expect(result.success && result.data.values).toEqual({ autoBackupFrequency: 'WEEKLY' });
  });

  it('accepts an empty save', () => {
    expect(zUpdateSettings.safeParse({ values: {} }).success).toBe(true);
  });

  it('refuses a key that is not a setting', () => {
    expect(zUpdateSettings.safeParse({ values: { evilKey: 'x' } }).success).toBe(false);
  });

  it('refuses a value that is not a string', () => {
    expect(zUpdateSettings.safeParse({ values: { currency: 123 } }).success).toBe(false);
  });

  it('holds each key to its own length limit', () => {
    // The default is deliberately mean; a long value has to be a key that needs it.
    expect(settingValueLimit('currency')).toBeLessThan(settingValueLimit('shopAddress'));
    expect(settingValueLimit('shopAddress')).toBeLessThan(settingValueLimit('shopLogo'));

    const tooLong = 'x'.repeat(settingValueLimit('currency') + 1);
    const refused = zUpdateSettings.safeParse({ values: { currency: tooLong } });
    expect(refused.success).toBe(false);
    expect(refused.success === false && refused.error.issues[0].path).toEqual(['values', 'currency']);

    // And the generous one really is generous, so a logo fits.
    expect(zUpdateSettings.safeParse({ values: { shopLogo: TINY_PNG } }).success).toBe(true);
  });

  it('refuses a logo that is not an inlined image', () => {
    // Each of these would otherwise be interpolated into an <img src> on an
    // invoice. Refused where it would be stored, not where it is rendered.
    const hostile = [
      'javascript:alert(1)',
      'https://example.com/logo.png',
      '../../windows/system32/calc.exe',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
      '" onerror="alert(1)',
    ];
    for (const value of hostile) {
      expect(isStorableLogo(value), value).toBe(false);
      expect(zUpdateSettings.safeParse({ values: { shopLogo: value } }).success, value).toBe(false);
    }
  });

  it('accepts an empty logo, which means "use the built-in mark"', () => {
    expect(isStorableLogo('')).toBe(true);
    expect(zUpdateSettings.safeParse({ values: { shopLogo: '' } }).success).toBe(true);
  });

  it('accepts the three raster formats and nothing else', () => {
    for (const type of ['png', 'jpeg', 'webp']) {
      expect(isStorableLogo(`data:image/${type};base64,AAAA`), type).toBe(true);
    }
    for (const type of ['svg+xml', 'gif', 'bmp']) {
      expect(isStorableLogo(`data:image/${type};base64,AAAA`), type).toBe(false);
    }
  });
});

// -----------------------------------------------------------------------------
// Storing and reading
// -----------------------------------------------------------------------------

describe('storing settings', () => {
  it('writes only the keys given, leaving the rest alone', () => {
    const before = getAllRaw(ctx.db);
    setSettings({ shopName: 'Green Mobile Yangon' }, actorId, ctx.db);

    const after = getAllRaw(ctx.db);
    expect(after.shopName).toBe('Green Mobile Yangon');
    for (const key of SETTING_KEYS) {
      if (key !== 'shopName') expect(after[key], key).toBe(before[key]);
    }
  });

  it('ignores a key that is not a setting rather than storing it', () => {
    // Belt and braces behind the schema: the service is also reachable directly.
    setSettings({ notASetting: 'x' } as never, actorId, ctx.db);
    const rows = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM "Setting" WHERE key = 'notASetting'`)
      .get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('records who changed a value', () => {
    setSettings({ receiptFooter: 'Thank you!' }, actorId, ctx.db);
    const row = ctx.db
      .prepare(`SELECT updatedBy FROM "Setting" WHERE key = 'receiptFooter'`)
      .get() as { updatedBy: string };
    expect(row.updatedBy).toBe(actorId);
  });

  it('falls back to the default when a row is missing', () => {
    ctx.db.prepare(`DELETE FROM "Setting" WHERE key = 'currency'`).run();
    // A missing row must never crash a sale, so the read is defaulted, not thrown.
    expect(getRaw('currency', ctx.db)).toBe(DEFAULT_SETTINGS.currency);
    expect(getShopSettings(ctx.db).currency).toBe(DEFAULT_SETTINGS.currency);
  });

  it('round-trips a logo of a realistic size', () => {
    // 200 KB of base64 — a real downscaled photograph, well past the old cap.
    const big = `data:image/png;base64,${'A'.repeat(200_000)}`;
    expect(zUpdateSettings.safeParse({ values: { shopLogo: big } }).success).toBe(true);

    setSettings({ shopLogo: big }, actorId, ctx.db);
    expect(getShopSettings(ctx.db).shopLogo).toBe(big);
  });
});

// -----------------------------------------------------------------------------
// The typed read
// -----------------------------------------------------------------------------

describe('reading settings as typed values', () => {
  it('parses flags, whole numbers and enums', () => {
    setSettings(
      {
        taxEnabled: 'true',
        taxRate: '750',
        taxMode: 'INCLUSIVE',
        receiptWidth: '58mm',
        lowStockThreshold: '3',
        allowNegativeStock: 'true',
        autoBackupKeep: '20',
      },
      actorId,
      ctx.db,
    );

    const settings = getShopSettings(ctx.db);
    expect(settings.taxEnabled).toBe(true);
    expect(settings.taxRate).toBe(750);
    expect(settings.taxMode).toBe('INCLUSIVE');
    expect(settings.receiptWidth).toBe('58mm');
    expect(settings.lowStockThreshold).toBe(3);
    expect(settings.allowNegativeStock).toBe(true);
    expect(settings.autoBackupKeep).toBe(20);
  });

  it('refuses to believe a nonsense value, so the till keeps working', () => {
    // These columns are TEXT, so anything could be in them — a bad migration, a
    // hand-edited database. A sale must not fail because of it.
    setSettings(
      {
        taxRate: 'not a number',
        taxMode: 'SIDEWAYS',
        receiptWidth: '32mm',
        lowStockThreshold: '-5',
        autoBackupFrequency: 'HOURLY',
      },
      actorId,
      ctx.db,
    );

    const settings = getShopSettings(ctx.db);
    expect(settings.taxRate).toBe(0);
    expect(settings.taxMode).toBe('EXCLUSIVE');
    expect(settings.receiptWidth).toBe('80mm');
    expect(settings.lowStockThreshold).toBe(0);
    expect(settings.autoBackupFrequency).toBe('DAILY');
  });

  it('keeps the backup path out of the non-admin subset', () => {
    // What settings:getAll hands a cashier. A till has no business knowing where
    // the shop's backups live, or which printer the office uses.
    for (const key of ['backupLocation', 'defaultPrinter', 'invoiceNumber'] as const) {
      expect(PUBLIC_SETTING_KEYS, key).not.toContain(key);
    }
    // But it must include everything needed to draw a price.
    for (const key of ['currency', 'taxEnabled', 'taxRate', 'taxMode'] as const) {
      expect(PUBLIC_SETTING_KEYS, key).toContain(key);
    }
  });
});
