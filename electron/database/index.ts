/**
 * Startup sequence for the data layer (spec §87):
 *
 *   1. locate the database under %APPDATA%\MobileShopPOS\data
 *   2. open it with the required pragmas
 *   3. verify its integrity
 *   4. back up, then migrate to the current schema
 *   5. ensure default reference data and settings exist
 *
 * All paths are injected rather than read from Electron, so the whole data
 * layer runs unchanged under plain Node in the test suite. Electron wiring
 * lives in electron/bootstrap.ts.
 *
 * Any failure here is fatal and surfaced to the user as a restore-or-exit
 * choice, never as a stack trace.
 */
import type { Database as Db } from 'better-sqlite3';
import { logger } from '../utils/logger';
import { openDatabase, checkIntegrity, closeDatabase } from './connection';
import { migrate, currentVersion, type MigrationResult } from './migrator';
import { seedReferenceData, needsFirstRunSetup } from './seed';

export interface InitializeDatabaseOptions {
  /** Full path to pos.db. */
  file: string;
  /** Directory holding the generated migration SQL. */
  migrationsDir: string;
  /** Where pre-migration safety backups are written. */
  backupDir: string;
}

export interface DatabaseStartupResult {
  db: Db;
  file: string;
  schemaVersion: number;
  migration: MigrationResult;
  requiresFirstRunSetup: boolean;
}

export function initializeDatabase(options: InitializeDatabaseOptions): DatabaseStartupResult {
  const db = openDatabase(options.file);

  checkIntegrity(db);

  const migration = migrate(db, {
    migrationsDir: options.migrationsDir,
    backupDir: options.backupDir,
  });

  seedReferenceData(db);

  const result: DatabaseStartupResult = {
    db,
    file: options.file,
    schemaVersion: currentVersion(db),
    migration,
    requiresFirstRunSetup: needsFirstRunSetup(db),
  };

  logger.info('Database ready', {
    file: options.file,
    schemaVersion: result.schemaVersion,
    migrationsApplied: migration.applied.length,
    requiresFirstRunSetup: result.requiresFirstRunSetup,
  });

  return result;
}

export { closeDatabase };
export * from './connection';
export * from './migrator';
export * from './seed';
