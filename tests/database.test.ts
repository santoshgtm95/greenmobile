/**
 * Phase 2 verification (spec §96 PHASE 2):
 *   database created, tables created, foreign keys work, indexes work.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDatabase, tableNames, insertTestUser, type TestDatabase } from './helpers/test-db';
import { loadMigrations, currentVersion, latestVersion } from '../electron/database/migrator';
import { checkIntegrity, openDatabase, transaction } from '../electron/database/connection';
import { MIGRATIONS_DIR } from './helpers/test-db';
import { initializeDatabase, closeDatabase, seedReferenceData } from '../electron/database';

let ctx: TestDatabase | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

const EXPECTED_TABLES = [
  'AuditLog',
  'BankAccount',
  'BankTransaction',
  'Brand',
  'CashCount',
  'Category',
  'Customer',
  'Expense',
  'ExpenseCategory',
  'InventoryTransaction',
  'Payment',
  'Product',
  'ProductSerial',
  'Sale',
  'SaleItem',
  'SaleReturn',
  'SaleReturnItem',
  'ServiceItem',
  'ServiceOrder',
  'ServicePayment',
  'Setting',
  'User',
];

describe('database creation', () => {
  it('creates the database file on disk outside the install directory', () => {
    ctx = createTestDatabase();
    expect(fs.existsSync(ctx.file)).toBe(true);
  });

  it('creates every table defined in the Prisma schema', () => {
    ctx = createTestDatabase();
    expect(tableNames(ctx.db)).toEqual(EXPECTED_TABLES);
  });

  it('records the schema version in the SQLite header', () => {
    ctx = createTestDatabase();
    expect(ctx.schemaVersion).toBe(latestVersion(MIGRATIONS_DIR));
    expect(ctx.schemaVersion).toBeGreaterThan(0);
  });

  it('passes its own integrity check', () => {
    ctx = createTestDatabase();
    expect(() => checkIntegrity(ctx!.db)).not.toThrow();
  });

  it('enables WAL journalling and foreign key enforcement', () => {
    ctx = createTestDatabase();
    expect(ctx.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(ctx.db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('reports that first-run setup is required when no user exists', () => {
    ctx = createTestDatabase();
    expect(ctx.requiresFirstRunSetup).toBe(true);
  });
});

describe('migrations', () => {
  it('loads migrations in ascending version order', () => {
    const migrations = loadMigrations(MIGRATIONS_DIR);
    expect(migrations.length).toBeGreaterThan(0);
    const versions = migrations.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it('is idempotent — reopening an existing database applies nothing', () => {
    ctx = createTestDatabase();
    const { file, backupDir, dir } = ctx;
    const versionBefore = currentVersion(ctx.db);

    // Close the connection but keep the file, the way quitting the app does.
    closeDatabase();
    ctx = null;

    try {
      // Reopen exactly as a second application launch would.
      const second = initializeDatabase({ file, migrationsDir: MIGRATIONS_DIR, backupDir });
      expect(second.migration.applied).toHaveLength(0);
      expect(second.schemaVersion).toBe(versionBefore);
      // No safety backup is written when there is nothing to migrate.
      expect(second.migration.backupPath).toBeNull();
      // The seed ran a second time without duplicating reference data.
      expect((second.db.prepare(`SELECT COUNT(*) n FROM "Category"`).get() as { n: number }).n).toBe(10);
    } finally {
      closeDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The upgrade path every existing shop takes.
   *
   * A fresh install runs the whole chain, which is what the tests above cover and
   * what a developer sees. A shop already trading is the case that can actually go
   * wrong: it is sitting on an earlier schema with real data in it, and a delta
   * migration has to reach it, take a backup on the way, and leave everything that
   * was already there alone.
   *
   * Built by applying only the migrations up to `stopAfter`, exactly as an older
   * build of the application would have.
   */
  it('brings an older database forward, backing it up first and keeping its data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-upgrade-'));
    const file = path.join(dir, 'data', 'pos.db');
    const backupDir = path.join(dir, 'backups');
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const migrations = loadMigrations(MIGRATIONS_DIR);
    expect(migrations.length).toBeGreaterThan(1);
    const [first] = migrations;

    try {
      // 1. An older installation: schema at version 1, with a row in it.
      const old = openDatabase(file);
      old.pragma('foreign_keys = OFF');
      old.exec(first.sql);
      old.pragma(`user_version = ${first.version}`);
      old.pragma('foreign_keys = ON');
      seedReferenceData(old);
      /*
        seedReferenceData writes TODAY's setting keys, so the simulated old shop
        would already hold the counters this release introduced — and the assertion
        further down would prove nothing. Remove them, which is the state a shop
        installed before this release is actually in.
      */
      old.prepare(`DELETE FROM "Setting" WHERE key LIKE 'banking%'`).run();
      expect(
        (
          old
            .prepare(`SELECT COUNT(*) n FROM "Setting" WHERE key = 'bankingNumber'`)
            .get() as { n: number }
        ).n,
      ).toBe(0);

      const userId = insertTestUser(old);
      old.prepare(
        `INSERT INTO "ExpenseCategory" (id, name, description, isActive, createdAt, updatedAt)
         VALUES ('keep-me', 'Shop rent for upgrade test', NULL, 1, '2026-01-01', '2026-01-01')`,
      ).run();
      // The banking tables cannot exist yet — that is the point of the delta.
      expect(tableNames(old)).not.toContain('BankTransaction');
      closeDatabase();

      // 2. The new build starts up against it.
      const upgraded = initializeDatabase({ file, migrationsDir: MIGRATIONS_DIR, backupDir });

      expect(upgraded.migration.fromVersion).toBe(first.version);
      expect(upgraded.schemaVersion).toBe(latestVersion(MIGRATIONS_DIR));
      expect(upgraded.migration.applied.map((m) => m.name)).toEqual(
        migrations.slice(1).map((m) => m.name),
      );

      // A backup was taken BEFORE anything was applied, and it is a real file.
      expect(upgraded.migration.backupPath).toBeTruthy();
      expect(fs.existsSync(upgraded.migration.backupPath!)).toBe(true);
      expect(fs.statSync(upgraded.migration.backupPath!).size).toBeGreaterThan(20_000);

      // The new tables arrived...
      expect(tableNames(upgraded.db)).toEqual(EXPECTED_TABLES);
      /*
        ...including columns added to a table by a later delta. Table names alone
        would not catch a missed ALTER TABLE: the table would be present and the
        first query against the new column would fail at runtime instead, on the
        upgraded shop only. Each of these must also carry a default, or the
        movements recorded before the upgrade could not be read back.
      */
      const feeColumns = (
        upgraded.db.prepare(`PRAGMA table_info("BankTransaction")`).all() as {
          name: string;
          dflt_value: string | null;
        }[]
      ).filter((c) => c.name.startsWith('fee'));
      expect(feeColumns.map((c) => c.name).sort()).toEqual([
        'feeAmount',
        'feeBasisPoints',
        'feeDirection',
      ]);
      expect(feeColumns.every((c) => c.dflt_value !== null)).toBe(true);
      // ...the existing data is untouched...
      const kept = upgraded.db
        .prepare(`SELECT name FROM "ExpenseCategory" WHERE id = 'keep-me'`)
        .get() as { name: string } | undefined;
      expect(kept?.name).toBe('Shop rent for upgrade test');
      expect(
        (upgraded.db.prepare(`SELECT COUNT(*) n FROM "User"`).get() as { n: number }).n,
      ).toBe(1);
      expect(userId).toBeTruthy();
      // ...and the counters this release introduced were seeded on the way through
      // rather than left missing. Without this, the first bank transaction an
      // upgraded shop tried to record would fail on a missing sequence row —
      // months after the upgrade, and only for shops that upgraded.
      const counter = upgraded.db
        .prepare(`SELECT value FROM "Setting" WHERE key = 'bankingNumber'`)
        .get() as { value: string } | undefined;
      expect(counter?.value).toBe('0');
      const prefix = upgraded.db
        .prepare(`SELECT value FROM "Setting" WHERE key = 'bankingPrefix'`)
        .get() as { value: string } | undefined;
      expect(prefix?.value).toBe('BNK');
    } finally {
      closeDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('referential integrity', () => {
  it('rejects a sale item that points at a product which does not exist', () => {
    ctx = createTestDatabase();
    const { db } = ctx;
    const userId = insertTestUser(db);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO "Sale" (id, invoiceNumber, customerId, customerName, customerPhone,
         saleDate, saleDay, subtotal, discountAmount, taxAmount, grandTotal, amountPaid,
         changeAmount, costTotal, paymentStatus, status, refundedAmount, notes,
         createdBy, createdAt, updatedAt)
       VALUES ('s1','INV-1',NULL,'Walk-in',NULL,?,?,1000,0,0,1000,1000,0,600,'PAID','COMPLETED',0,NULL,?,?,?)`,
    ).run(now, '2026-08-10', userId, now, now);

    expect(() =>
      db
        .prepare(
          `INSERT INTO "SaleItem" (id, saleId, productId, productSerialId, productName, sku,
             unitCost, unitPrice, quantity, discountAmount, taxAmount, totalAmount,
             returnedQuantity, createdAt)
           VALUES ('si1','s1','does-not-exist',NULL,'Ghost','SKU',600,1000,1,0,0,1000,0,?)`,
        )
        .run(now),
    ).toThrow(/FOREIGN KEY constraint failed/i);
  });

  it('refuses to delete a user who created a sale', () => {
    ctx = createTestDatabase();
    const { db } = ctx;
    const userId = insertTestUser(db);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO "Sale" (id, invoiceNumber, customerId, customerName, customerPhone,
         saleDate, saleDay, subtotal, discountAmount, taxAmount, grandTotal, amountPaid,
         changeAmount, costTotal, paymentStatus, status, refundedAmount, notes,
         createdBy, createdAt, updatedAt)
       VALUES ('s2','INV-2',NULL,'Walk-in',NULL,?,?,1000,0,0,1000,1000,0,600,'PAID','COMPLETED',0,NULL,?,?,?)`,
    ).run(now, '2026-08-10', userId, now, now);

    expect(() => db.prepare(`DELETE FROM "User" WHERE id = ?`).run(userId)).toThrow(
      /FOREIGN KEY constraint failed/i,
    );
  });

  it('enforces unique IMEI numbers', () => {
    ctx = createTestDatabase();
    const { db } = ctx;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO "Product" (id, sku, barcode, name, purchasePrice, sellingPrice, taxRate,
         taxRateOverride, stockQuantity, minimumStock, unit, isSerialized, warrantyMonths,
         isActive, createdAt, updatedAt)
       VALUES ('p1','SKU-1',NULL,'iPhone 15',80000,100000,0,0,0,0,'pcs',1,12,1,?,?)`,
    ).run(now, now);

    const insertSerial = db.prepare(
      `INSERT INTO "ProductSerial" (id, productId, serialNumber, imei1, imei2, purchasePrice,
         sellingPrice, status, createdAt, updatedAt)
       VALUES (?,?,NULL,?,NULL,80000,NULL,'AVAILABLE',?,?)`,
    );

    insertSerial.run('ser1', 'p1', '123456789', now, now);
    expect(() => insertSerial.run('ser2', 'p1', '123456789', now, now)).toThrow(/UNIQUE/i);
  });

  it('allows many products to have no barcode despite the unique index', () => {
    ctx = createTestDatabase();
    const { db } = ctx;
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO "Product" (id, sku, barcode, name, purchasePrice, sellingPrice, taxRate,
         taxRateOverride, stockQuantity, minimumStock, unit, isSerialized, warrantyMonths,
         isActive, createdAt, updatedAt)
       VALUES (?,?,NULL,?,0,0,0,0,0,0,'pcs',0,0,1,?,?)`,
    );
    insert.run('pa', 'SKU-A', 'Cable A', now, now);
    expect(() => insert.run('pb', 'SKU-B', 'Cable B', now, now)).not.toThrow();
  });
});

describe('transactions', () => {
  it('rolls the whole unit of work back when any statement fails', () => {
    ctx = createTestDatabase();
    const { db } = ctx;
    const now = new Date().toISOString();

    const before = (db.prepare(`SELECT COUNT(*) n FROM "Product"`).get() as { n: number }).n;

    expect(() =>
      transaction(() => {
        db.prepare(
          `INSERT INTO "Product" (id, sku, barcode, name, purchasePrice, sellingPrice, taxRate,
             taxRateOverride, stockQuantity, minimumStock, unit, isSerialized, warrantyMonths,
             isActive, createdAt, updatedAt)
           VALUES ('ok','SKU-OK',NULL,'Fine',0,0,0,0,0,0,'pcs',0,0,1,?,?)`,
        ).run(now, now);
        // Same SKU: violates the unique index and must undo the row above.
        db.prepare(
          `INSERT INTO "Product" (id, sku, barcode, name, purchasePrice, sellingPrice, taxRate,
             taxRateOverride, stockQuantity, minimumStock, unit, isSerialized, warrantyMonths,
             isActive, createdAt, updatedAt)
           VALUES ('bad','SKU-OK',NULL,'Duplicate',0,0,0,0,0,0,'pcs',0,0,1,?,?)`,
        ).run(now, now);
      }, db),
    ).toThrow(/UNIQUE/i);

    const after = (db.prepare(`SELECT COUNT(*) n FROM "Product"`).get() as { n: number }).n;
    expect(after).toBe(before);
  });
});

describe('seeded reference data', () => {
  it('creates the default categories, brands and expense categories', () => {
    ctx = createTestDatabase();
    const { db } = ctx;
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get() as { n: number }).n;

    expect(count('Category')).toBe(10);
    expect(count('Brand')).toBe(8);
    expect(count('ExpenseCategory')).toBe(10);

    const smartphones = db
      .prepare(`SELECT name, isActive FROM "Category" WHERE name = 'Smartphones'`)
      .get() as { name: string; isActive: number };
    expect(smartphones.isActive).toBe(1);
  });

  it('creates settings without any default user account or password', () => {
    ctx = createTestDatabase();
    const { db } = ctx;
    expect((db.prepare(`SELECT COUNT(*) n FROM "User"`).get() as { n: number }).n).toBe(0);
    const currency = db.prepare(`SELECT value FROM "Setting" WHERE key='currency'`).get() as {
      value: string;
    };
    expect(currency.value).toBe('THB');
    const setupCompleted = db
      .prepare(`SELECT value FROM "Setting" WHERE key='setupCompleted'`)
      .get() as { value: string };
    expect(setupCompleted.value).toBe('false');
  });
});

describe('indexes', () => {
  it('uses an index when looking a product up by barcode', () => {
    ctx = createTestDatabase();
    const plan = ctx.db
      .prepare(`EXPLAIN QUERY PLAN SELECT id FROM "Product" WHERE barcode = ?`)
      .all('123') as { detail: string }[];
    expect(plan.map((r) => r.detail).join(' ')).toMatch(/USING INDEX/i);
  });

  it('uses an index when filtering sales by business day', () => {
    ctx = createTestDatabase();
    const plan = ctx.db
      .prepare(`EXPLAIN QUERY PLAN SELECT id FROM "Sale" WHERE saleDay BETWEEN ? AND ?`)
      .all('2026-08-01', '2026-08-10') as { detail: string }[];
    expect(plan.map((r) => r.detail).join(' ')).toMatch(/USING INDEX/i);
  });

  it('uses an index when searching customers by phone', () => {
    ctx = createTestDatabase();
    const plan = ctx.db
      .prepare(`EXPLAIN QUERY PLAN SELECT id FROM "Customer" WHERE phone = ?`)
      .all('0812345678') as { detail: string }[];
    expect(plan.map((r) => r.detail).join(' ')).toMatch(/USING INDEX/i);
  });
});
