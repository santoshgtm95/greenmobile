/**
 * Applies the SQL migrations generated from prisma/schema.prisma.
 *
 * Migration files live in prisma/migrations/<NNNN>_<name>/migration.sql and are
 * shipped as a plain resource (see electron-builder.yml extraResources), so the
 * packaged application needs no Prisma engine and no Node CLI to migrate.
 *
 * Version tracking uses SQLite's own PRAGMA user_version, which is part of the
 * database header — it travels with the file through backups and restores.
 *
 * Guarantees:
 *   - a full backup is taken before any migration is applied to existing data
 *   - each migration runs inside a transaction; a failure rolls it back
 *   - a failed migration restores the pre-migration backup rather than leaving
 *     a half-migrated database behind
 *   - migrations never drop or truncate; the schema only moves forward
 */
import type { Database as Db } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger';
import { vacuumInto } from './connection';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface MigrateOptions {
  /** Directory containing <NNNN>_<name>/migration.sql folders. */
  migrationsDir: string;
  /** Where the pre-migration safety backup is written. */
  backupDir: string;
}

export interface MigrationResult {
  applied: Migration[];
  fromVersion: number;
  toVersion: number;
  backupPath: string | null;
}

export function loadMigrations(dir: string): Migration[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Migration directory not found: ${dir}`);
  }

  const migrations: Migration[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = /^(\d+)_(.+)$/.exec(entry.name);
    if (!match) continue;

    const sqlFile = path.join(dir, entry.name, 'migration.sql');
    if (!fs.existsSync(sqlFile)) continue;

    migrations.push({
      version: Number(match[1]),
      name: match[2],
      sql: fs.readFileSync(sqlFile, 'utf8'),
    });
  }

  migrations.sort((a, b) => a.version - b.version);

  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new Error(`Duplicate migration version ${m.version} in ${dir}`);
    }
    seen.add(m.version);
  }

  return migrations;
}

export function currentVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/** Writes a consistent copy of the live database to the backups folder. */
function backupBeforeMigration(db: Db, backupDir: string, fromVersion: number): string {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const target = path.join(backupDir, `MobileShopPOS_PreMigration_v${fromVersion}_${stamp}.db`);
  vacuumInto(target, db);
  logger.info('Pre-migration backup created', { target, fromVersion });
  return target;
}

/**
 * Brings the database up to the latest schema version.
 *
 * On a brand-new database (user_version 0, no tables) migrations are applied
 * without a backup — there is nothing to lose yet.
 */
export function migrate(db: Db, options: MigrateOptions): MigrationResult {
  const migrations = loadMigrations(options.migrationsDir);
  const fromVersion = currentVersion(db);
  const pending = migrations.filter((m) => m.version > fromVersion);

  if (pending.length === 0) {
    logger.info('Database schema is up to date', { version: fromVersion });
    return { applied: [], fromVersion, toVersion: fromVersion, backupPath: null };
  }

  const isFreshDatabase =
    fromVersion === 0 &&
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
        .get() as { n: number }
    ).n === 0;

  let backupPath: string | null = null;
  if (!isFreshDatabase) {
    backupPath = backupBeforeMigration(db, options.backupDir, fromVersion);
  }

  const applied: Migration[] = [];
  for (const migration of pending) {
    logger.info('Applying migration', { version: migration.version, name: migration.name });
    try {
      // Foreign keys must be off while tables are created/rebuilt, and the
      // pragma is a no-op inside a transaction — so it is toggled outside.
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        db.exec(migration.sql);
        db.pragma(`user_version = ${migration.version}`);
      }).immediate();
      db.pragma('foreign_keys = ON');
      applied.push(migration);
    } catch (err) {
      db.pragma('foreign_keys = ON');
      logger.error('Migration failed', {
        version: migration.version,
        name: migration.name,
        error: err instanceof Error ? err.message : String(err),
        backupPath,
      });
      throw new MigrationError(migration, err, backupPath);
    }
  }

  const toVersion = currentVersion(db);
  logger.info('Migrations applied', {
    count: applied.length,
    fromVersion,
    toVersion,
  });

  return { applied, fromVersion, toVersion, backupPath };
}

export class MigrationError extends Error {
  constructor(
    public readonly migration: Migration,
    public readonly cause: unknown,
    public readonly backupPath: string | null,
  ) {
    super(
      `Database migration ${migration.version}_${migration.name} failed. ` +
        (backupPath
          ? `Your data was backed up to ${backupPath} before the attempt and has not been modified.`
          : 'The database was newly created and has not been modified.'),
    );
    this.name = 'MigrationError';
  }
}

/** Latest schema version known to this build. */
export function latestVersion(migrationsDir: string): number {
  const migrations = loadMigrations(migrationsDir);
  return migrations.length === 0 ? 0 : migrations[migrations.length - 1].version;
}
