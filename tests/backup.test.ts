/**
 * Backup and restore (spec §53–§55, §80).
 *
 * These are the tests that matter most in the whole suite, because this is the
 * only code allowed to overwrite the shop's single copy of its trading history.
 * The two invariants under test are:
 *
 *   - a backup is a *consistent* snapshot, taken through the WAL, so a sale
 *     committed a moment ago is in it
 *   - a restore never destroys what it replaces, even when it fails
 *
 * Everything runs against real SQLite files in a temp directory. Nothing here
 * is mocked — a mocked filesystem would pass while the real one lost data.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createTestDatabase, MIGRATIONS_DIR, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import { createProduct } from '../electron/services/product.service';
import { createSale } from '../electron/services/sale.service';
import { getDatabase } from '../electron/database/connection';
import { setSettings, getShopSettings } from '../electron/services/settings.service';
import {
  automaticBackupDue,
  backupFileName,
  classifyBackup,
  createBackup,
  databaseSize,
  deleteBackup,
  inspectBackup,
  isWritable,
  listBackups,
  pruneAutomaticBackups,
  replaceUnopenableDatabase,
  resolveBackupDir,
  restoreBackup,
  runAutomaticBackupIfDue,
} from '../electron/services/backup.service';
import { businessDay, addDays } from '../shared/datetime';
import { PosApiError, AppError } from '../shared/errors';
import type { FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let actor: SessionUser;

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
});

afterEach(() => {
  ctx.cleanup();
  setSessionUser(null);
});

/** A product with stock, so a backup has something recognisable inside it. */
function seedProduct(sku = 'CBL-1', stock = 10) {
  return createProduct(
    {
      sku,
      name: `Product ${sku}`,
      purchasePrice: 80000,
      sellingPrice: 100000,
      taxRate: 0,
      taxRateOverride: false,
      minimumStock: 0,
      unit: 'pcs',
      isSerialized: false,
      warrantyMonths: 0,
      initialStock: stock,
    },
    actor,
    ctx.db,
  );
}

function countProducts(db = getDatabase()): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM "Product"`).get() as { n: number }).n;
}

// -----------------------------------------------------------------------------

describe('naming', () => {
  it('produces a Windows-legal, sortable filename', () => {
    const name = backupFileName('MANUAL', new Date(2026, 7, 10, 8, 30, 0));
    expect(name).toBe('MobileShopPOS_Backup_2026-08-10_083000.db');
    // Colons would make this unopenable on Windows.
    expect(name).not.toContain(':');
  });

  it('reads its own filenames back', () => {
    expect(classifyBackup('MobileShopPOS_Backup_2026-08-10_083000.db')).toBe('MANUAL');
    expect(classifyBackup('MobileShopPOS_Auto_2026-08-10_083000.db')).toBe('AUTOMATIC');
    expect(classifyBackup('MobileShopPOS_Safety_2026-08-10_083000.db')).toBe('SAFETY');
  });

  it('recognises the migrator’s pre-migration backups', () => {
    // Written by database/migrator.ts, which includes the schema version.
    expect(classifyBackup('MobileShopPOS_PreMigration_v3_2026-08-10_083000.db')).toBe(
      'PRE_MIGRATION',
    );
  });

  it('treats a stranger’s .db file as unknown rather than guessing', () => {
    expect(classifyBackup('someone-elses-database.db')).toBe('UNKNOWN');
  });
});

describe('creating a backup', () => {
  it('captures data committed a moment earlier', () => {
    seedProduct('CBL-1');
    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);

    expect(fs.existsSync(file.path)).toBe(true);
    expect(file.sizeBytes).toBeGreaterThan(1000);
    expect(file.kind).toBe('MANUAL');

    // The real test: read the backup as its own database. In WAL mode a naive
    // file copy could miss this row entirely.
    const copy = new Database(file.path, { readonly: true });
    try {
      const found = copy.prepare(`SELECT sku FROM "Product" WHERE sku = ?`).get('CBL-1');
      expect(found).toBeTruthy();
    } finally {
      copy.close();
    }
  });

  it('writes a complete database, not a fragment needing a WAL', () => {
    seedProduct();
    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);
    // VACUUM INTO output has no sidecars of its own.
    expect(fs.existsSync(`${file.path}-wal`)).toBe(false);
    expect(inspectBackup(file.path, MIGRATIONS_DIR).ok).toBe(true);
  });

  it('honours an explicit target path, for "Back up to…"', () => {
    const target = path.join(ctx.dir, 'usb-stick', 'my-shop.db');
    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL', targetPath: target }, ctx.db);
    expect(file.path).toBe(target);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('reports a friendly error when the folder cannot be written', () => {
    // A path whose parent is a file, not a directory — mkdir must fail.
    const blocker = path.join(ctx.dir, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    expect(() =>
      createBackup({ dir: ctx.backupDir, kind: 'MANUAL', targetPath: path.join(blocker, 'x.db') }, ctx.db),
    ).toThrowError(/Backup failed/);
  });
});

describe('listing and folders', () => {
  it('returns newest first across both folders', async () => {
    const custom = path.join(ctx.dir, 'usb');
    fs.mkdirSync(custom, { recursive: true });

    createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);
    // mtime has second resolution on some filesystems, so space them out.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    createBackup({ dir: custom, kind: 'MANUAL', targetPath: path.join(custom, 'later.db') }, ctx.db);

    const files = listBackups(ctx.backupDir, custom);
    expect(files).toHaveLength(2);
    expect(files[0].name).toBe('later.db');
    expect(files[0].folder).toBe('CUSTOM');
    expect(files[1].folder).toBe('DEFAULT');
  });

  it('does not list the same folder twice when the custom path is the default', () => {
    createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);
    expect(listBackups(ctx.backupDir, ctx.backupDir)).toHaveLength(1);
  });

  it('treats an unreachable custom folder as empty rather than failing', () => {
    expect(listBackups(ctx.backupDir, path.join(ctx.dir, 'no-such-drive'))).toHaveLength(0);
  });

  it('falls back to the application folder when the USB drive is gone', () => {
    const missing = path.join(ctx.dir, 'nested', 'gone');
    // isWritable creates the folder, so use a path that cannot be created.
    const blocker = path.join(ctx.dir, 'file-not-folder');
    fs.writeFileSync(blocker, 'x');

    expect(resolveBackupDir(ctx.backupDir, path.join(blocker, 'sub'))).toBe(ctx.backupDir);
    // A folder that can be created is used.
    expect(resolveBackupDir(ctx.backupDir, missing)).toBe(missing);
    expect(isWritable(missing)).toBe(true);
  });

  it('uses the application folder when no custom folder is set', () => {
    expect(resolveBackupDir(ctx.backupDir, '')).toBe(ctx.backupDir);
    expect(resolveBackupDir(ctx.backupDir, '   ')).toBe(ctx.backupDir);
  });

  it('measures the live database including its WAL sidecar', () => {
    seedProduct();
    expect(databaseSize(ctx.file)).toBeGreaterThan(fs.statSync(ctx.file).size - 1);
  });
});

describe('retention', () => {
  /** Writes n automatic backups with distinct, ordered names. */
  function writeAutomatic(count: number): string[] {
    const paths: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const at = new Date(2026, 0, 1 + i, 9, 0, 0);
      const target = path.join(ctx.backupDir, backupFileName('AUTOMATIC', at));
      const file = createBackup({ dir: ctx.backupDir, kind: 'AUTOMATIC', targetPath: target }, ctx.db);
      // mtime drives the sort, so make it match the name.
      fs.utimesSync(file.path, at, at);
      paths.push(file.path);
    }
    return paths;
  }

  it('keeps only the newest N automatic backups', () => {
    const written = writeAutomatic(8);
    const removed = pruneAutomaticBackups(ctx.backupDir, 5);

    expect(removed).toHaveLength(3);
    // The three oldest went; the five newest stayed.
    for (const gone of written.slice(0, 3)) expect(fs.existsSync(gone)).toBe(false);
    for (const kept of written.slice(3)) expect(fs.existsSync(kept)).toBe(true);
  });

  it('never deletes a manual, safety or pre-migration backup', () => {
    writeAutomatic(6);
    const manual = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);
    const safety = createBackup({ dir: ctx.backupDir, kind: 'SAFETY' }, ctx.db);
    const preMigration = createBackup(
      {
        dir: ctx.backupDir,
        kind: 'PRE_MIGRATION',
        targetPath: path.join(ctx.backupDir, 'MobileShopPOS_PreMigration_v1_2026-01-01_090000.db'),
      },
      ctx.db,
    );

    pruneAutomaticBackups(ctx.backupDir, 1);

    expect(fs.existsSync(manual.path)).toBe(true);
    expect(fs.existsSync(safety.path)).toBe(true);
    expect(fs.existsSync(preMigration.path)).toBe(true);
    expect(listBackups(ctx.backupDir, null).filter((f) => f.kind === 'AUTOMATIC')).toHaveLength(1);
  });

  it('always keeps at least one, whatever it is asked', () => {
    writeAutomatic(3);
    pruneAutomaticBackups(ctx.backupDir, 0);
    expect(listBackups(ctx.backupDir, null).filter((f) => f.kind === 'AUTOMATIC')).toHaveLength(1);
  });
});

describe('the automatic schedule', () => {
  const TODAY = businessDay();

  it('is never due when switched off', () => {
    expect(automaticBackupDue('DISABLED', '', TODAY)).toBe(false);
    expect(automaticBackupDue('DISABLED', addDays(TODAY, -30), TODAY)).toBe(false);
  });

  it('is due immediately when it has never run', () => {
    expect(automaticBackupDue('DAILY', '', TODAY)).toBe(true);
    expect(automaticBackupDue('WEEKLY', '', TODAY)).toBe(true);
  });

  it('runs a daily backup once per day, not once per launch', () => {
    expect(automaticBackupDue('DAILY', TODAY, TODAY)).toBe(false);
    expect(automaticBackupDue('DAILY', addDays(TODAY, -1), TODAY)).toBe(true);
  });

  it('waits a full seven days on the weekly schedule', () => {
    expect(automaticBackupDue('WEEKLY', addDays(TODAY, -6), TODAY)).toBe(false);
    expect(automaticBackupDue('WEEKLY', addDays(TODAY, -7), TODAY)).toBe(true);
  });

  it('takes the backup, prunes, and stamps the day', () => {
    seedProduct();
    setSettings({ autoBackupFrequency: 'DAILY', autoBackupKeep: '5' }, actor.id, ctx.db);

    const file = runAutomaticBackupIfDue(ctx.backupDir, ctx.db);
    expect(file).not.toBeNull();
    expect(file!.kind).toBe('AUTOMATIC');
    expect(fs.existsSync(file!.path)).toBe(true);

    // Second call the same day must be a no-op.
    expect(runAutomaticBackupIfDue(ctx.backupDir, ctx.db)).toBeNull();
  });

  it('does nothing before the shop has been set up', () => {
    setSettings({ setupCompleted: 'false', autoBackupFrequency: 'DAILY' }, actor.id, ctx.db);
    expect(runAutomaticBackupIfDue(ctx.backupDir, ctx.db)).toBeNull();
  });

  it('writes to the shop’s own folder when one is configured', () => {
    const usb = path.join(ctx.dir, 'usb-drive');
    setSettings(
      { autoBackupFrequency: 'DAILY', backupLocation: usb, lastAutoBackupDay: '' },
      actor.id,
      ctx.db,
    );
    expect(getShopSettings(ctx.db).backupLocation).toBe(usb);

    const file = runAutomaticBackupIfDue(ctx.backupDir, ctx.db);
    expect(file).not.toBeNull();
    expect(path.dirname(file!.path)).toBe(usb);
  });
});

describe('inspecting a candidate', () => {
  it('reports what is inside a real backup', () => {
    seedProduct('CBL-1');
    seedProduct('CBL-2');
    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);

    const inspection = inspectBackup(file.path, MIGRATIONS_DIR);
    expect(inspection.ok).toBe(true);
    expect(inspection.contents.products).toBe(2);
    expect(inspection.schemaVersion).toBe(ctx.schemaVersion);
    expect(inspection.expectedSchemaVersion).toBe(ctx.schemaVersion);
  });

  it('refuses a file that is not a database', () => {
    const junk = path.join(ctx.dir, 'not-a-database.db');
    fs.writeFileSync(junk, 'this is a text file pretending to be a database');
    const inspection = inspectBackup(junk, MIGRATIONS_DIR);
    expect(inspection.ok).toBe(false);
    expect(inspection.problem).toBeTruthy();
  });

  it('refuses a valid SQLite database that is not a POS backup', () => {
    const other = path.join(ctx.dir, 'someone-elses.db');
    const db = new Database(other);
    db.exec(`CREATE TABLE Notes (id INTEGER PRIMARY KEY, body TEXT)`);
    db.close();

    const inspection = inspectBackup(other, MIGRATIONS_DIR);
    expect(inspection.ok).toBe(false);
    expect(inspection.problem).toMatch(/not a Mobile Shop POS backup/i);
  });

  it('refuses a backup from a newer build rather than corrupting it', () => {
    seedProduct();
    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);

    // Pretend it came from a future version with a higher schema.
    const future = new Database(file.path);
    future.pragma(`user_version = ${ctx.schemaVersion + 5}`);
    future.close();

    const inspection = inspectBackup(file.path, MIGRATIONS_DIR);
    expect(inspection.ok).toBe(false);
    expect(inspection.problem).toMatch(/newer version/i);
  });

  it('reports a missing file without throwing', () => {
    const inspection = inspectBackup(path.join(ctx.dir, 'nope.db'), MIGRATIONS_DIR);
    expect(inspection.ok).toBe(false);
    expect(inspection.problem).toMatch(/no longer exists/i);
  });
});

describe('restoring', () => {
  it('puts the shop back to the moment the backup was taken', () => {
    seedProduct('CBL-1');
    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);

    // Trade on after the backup.
    seedProduct('CBL-2');
    seedProduct('CBL-3');
    expect(countProducts()).toBe(3);

    const result = restoreBackup({
      file: file.path,
      targetFile: ctx.file,
      backupDir: ctx.backupDir,
      migrationsDir: MIGRATIONS_DIR,
    });

    expect(result.restoredFrom).toBe(file.path);
    expect(result.migrated).toBe(false);
    // The two later products are gone; the one in the backup is back.
    expect(countProducts()).toBe(1);
    expect(
      getDatabase().prepare(`SELECT sku FROM "Product"`).get(),
    ).toMatchObject({ sku: 'CBL-1' });
  });

  it('leaves a working connection behind, not a closed one', () => {
    seedProduct();
    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);

    restoreBackup({
      file: file.path,
      targetFile: ctx.file,
      backupDir: ctx.backupDir,
      migrationsDir: MIGRATIONS_DIR,
    });

    // The old ctx.db handle is stale by design; getDatabase() is the live one.
    expect(() => getDatabase().prepare(`SELECT COUNT(*) FROM "Sale"`).get()).not.toThrow();
  });

  it('saves the data it is about to replace (spec §55)', () => {
    seedProduct('OLD-1');
    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);
    seedProduct('ONLY-IN-CURRENT');

    const result = restoreBackup({
      file: file.path,
      targetFile: ctx.file,
      backupDir: ctx.backupDir,
      migrationsDir: MIGRATIONS_DIR,
    });

    expect(result.safetyBackup.kind).toBe('SAFETY');
    expect(fs.existsSync(result.safetyBackup.path)).toBe(true);

    // The product that only existed after the backup is recoverable.
    const safety = new Database(result.safetyBackup.path, { readonly: true });
    try {
      expect(
        safety.prepare(`SELECT sku FROM "Product" WHERE sku = ?`).get('ONLY-IN-CURRENT'),
      ).toBeTruthy();
    } finally {
      safety.close();
    }
  });

  it('refuses to restore a damaged file, and leaves the live data alone', () => {
    seedProduct('STILL-HERE');
    const junk = path.join(ctx.dir, 'corrupt.db');
    fs.writeFileSync(junk, 'garbage');

    expect(() =>
      restoreBackup({
        file: junk,
        targetFile: ctx.file,
        backupDir: ctx.backupDir,
        migrationsDir: MIGRATIONS_DIR,
      }),
    ).toThrowError(/Restore failed/);

    // Nothing was touched — not even a safety backup was needed.
    expect(countProducts()).toBe(1);
    expect(listBackups(ctx.backupDir, null).filter((f) => f.kind === 'SAFETY')).toHaveLength(0);
  });

  it('carries the sales history across, not just the catalogue', () => {
    const product = seedProduct('CBL-1', 10);
    createSale(
      {
        items: [{ productId: product.id, quantity: 2 }],
        discountAmount: 0,
        payments: [{ amount: 200000, paymentMethod: 'CASH' }],
      },
      actor,
      ctx.db,
    );

    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);
    restoreBackup({
      file: file.path,
      targetFile: ctx.file,
      backupDir: ctx.backupDir,
      migrationsDir: MIGRATIONS_DIR,
    });

    const db = getDatabase();
    expect((db.prepare(`SELECT COUNT(*) AS n FROM "Sale"`).get() as { n: number }).n).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM "SaleItem"`).get() as { n: number }).n).toBe(1);
    // Stock went down with the sale and came back with the backup as it was.
    expect(
      (db.prepare(`SELECT stockQuantity AS q FROM "Product"`).get() as { q: number }).q,
    ).toBe(8);
  });
});

describe('replacing a database that will not open', () => {
  it('keeps the damaged file and puts the backup in its place', () => {
    seedProduct('CBL-1');
    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);

    // Simulate the startup path: connection closed, file unreadable.
    ctx.db.close();
    fs.writeFileSync(ctx.file, 'this database is toast');

    const { quarantined } = replaceUnopenableDatabase(file.path, ctx.file, ctx.backupDir);

    expect(quarantined).toBeTruthy();
    expect(fs.existsSync(quarantined!)).toBe(true);
    expect(fs.readFileSync(quarantined!, 'utf8')).toBe('this database is toast');
    // The replacement is a real POS database again.
    expect(inspectBackup(ctx.file, MIGRATIONS_DIR).ok).toBe(true);
  });
});

describe('deleting', () => {
  it('removes a backup from a known folder', () => {
    const file = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);
    deleteBackup(file.path, [ctx.backupDir, null]);
    expect(fs.existsSync(file.path)).toBe(false);
  });

  it('refuses a path outside the backup folders', () => {
    const outsider = path.join(ctx.dir, 'important.db');
    fs.writeFileSync(outsider, 'not yours to delete');

    expect(() => deleteBackup(outsider, [ctx.backupDir, null])).toThrowError(
      /not in a backup folder/i,
    );
    expect(fs.existsSync(outsider)).toBe(true);
  });

  it('refuses anything that is not a .db file', () => {
    const notADatabase = path.join(ctx.backupDir, 'notes.txt');
    fs.mkdirSync(ctx.backupDir, { recursive: true });
    fs.writeFileSync(notADatabase, 'keep me');

    expect(() => deleteBackup(notADatabase, [ctx.backupDir, null])).toThrow();
    expect(fs.existsSync(notADatabase)).toBe(true);
  });

  it('refuses a traversal attempt dressed up as a backup path', () => {
    const outsider = path.join(ctx.dir, 'escape.db');
    fs.writeFileSync(outsider, 'x');
    // ...\backups\..\escape.db resolves outside the folder, and must be caught
    // after resolution rather than by looking at the raw string.
    const sneaky = path.join(ctx.backupDir, '..', 'escape.db');

    expect(() => deleteBackup(sneaky, [ctx.backupDir, null])).toThrow();
    expect(fs.existsSync(outsider)).toBe(true);
  });
});

describe('error surface', () => {
  it('reports failures as AppErrors so the message reaches the user', () => {
    const junk = path.join(ctx.dir, 'corrupt.db');
    fs.writeFileSync(junk, 'garbage');

    try {
      restoreBackup({
        file: junk,
        targetFile: ctx.file,
        backupDir: ctx.backupDir,
        migrationsDir: MIGRATIONS_DIR,
      });
      throw new Error('should have thrown');
    } catch (err) {
      // AppError survives the IPC registry with its code; a plain Error would
      // be replaced by "Database error. Please try again."
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('RESTORE_FAILED');
      expect(err).not.toBeInstanceOf(PosApiError);
    }
  });
});
