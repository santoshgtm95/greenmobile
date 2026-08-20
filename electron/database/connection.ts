/**
 * The single SQLite connection used by the whole main process.
 *
 * better-sqlite3 ships Node-API prebuilt binaries, so nothing is compiled on
 * the user's machine and no Electron rebuild step is required.
 *
 * Everything here is synchronous. For a single-till desktop POS that is a
 * feature, not a limitation: a sale either commits completely or not at all,
 * with no chance of an await landing halfway through a transaction.
 */
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger';

let db: Db | null = null;

export class DatabaseIntegrityError extends Error {
  constructor(public readonly details: string) {
    super('The POS database failed its integrity check.');
    this.name = 'DatabaseIntegrityError';
  }
}

/**
 * Opens the database, applying the pragmas the application depends on.
 *
 * foreign_keys  ON     — referential integrity is enforced by SQLite itself.
 * journal_mode  WAL    — a crash mid-sale cannot corrupt the file, and reads
 *                        never block the write that is committing a sale.
 * synchronous   FULL   — money must survive a power cut, so we accept the
 *                        extra fsync. A shop does a few sales a minute, not
 *                        thousands a second.
 * busy_timeout  5000   — wait rather than fail if a backup holds a read lock.
 */
export function openDatabase(file: string): Db {
  if (db) return db;

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const connection = new Database(file);
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('synchronous = FULL');
  connection.pragma('busy_timeout = 5000');
  // Keep temp b-trees in memory; sorting big reports should not touch disk.
  connection.pragma('temp_store = MEMORY');

  db = connection;
  logger.info('Database opened', {
    file,
    journalMode: connection.pragma('journal_mode', { simple: true }),
    foreignKeys: connection.pragma('foreign_keys', { simple: true }),
  });
  return connection;
}

export function getDatabase(): Db {
  if (!db) {
    throw new Error('Database has not been opened yet. Call openDatabase() during startup.');
  }
  return db;
}

export function isDatabaseOpen(): boolean {
  return db !== null;
}

/**
 * Verifies the file is a usable SQLite database before the app trusts it.
 * Runs on every startup — spec step 4 of the startup sequence.
 */
export function checkIntegrity(connection: Db = getDatabase()): void {
  const result = connection.pragma('integrity_check', { simple: true }) as string;
  if (result !== 'ok') {
    logger.error('Database integrity check failed', { result });
    throw new DatabaseIntegrityError(result);
  }

  const fkViolations = connection.pragma('foreign_key_check') as unknown[];
  if (fkViolations.length > 0) {
    const details = `${fkViolations.length} foreign key violation(s)`;
    logger.error('Database foreign key check failed', { count: fkViolations.length });
    throw new DatabaseIntegrityError(details);
  }
}

/**
 * Runs `fn` inside an IMMEDIATE transaction. Every money-moving operation goes
 * through here: sales, refunds, cancellations, stock adjustments, payments and
 * service completion. If `fn` throws, SQLite rolls the whole thing back and no
 * partial sale is ever left behind.
 *
 * IMMEDIATE (rather than DEFERRED) takes the write lock up front, so two
 * concurrent writers fail fast instead of deadlocking mid-transaction.
 */
export function transaction<T>(fn: () => T, connection: Db = getDatabase()): T {
  return connection.transaction(fn).immediate();
}

/** Flushes the WAL into the main file. Called before copying it for a backup. */
export function checkpoint(connection: Db = getDatabase()): void {
  connection.pragma('wal_checkpoint(TRUNCATE)');
}

/**
 * Writes a consistent snapshot of the database to `target`.
 *
 * THE ONLY PLACE IN THE APPLICATION THAT PUTS A VALUE INTO SQL TEXT.
 *
 * SQLite will not accept a bound parameter for VACUUM INTO's filename, so the
 * path has to be inlined and therefore escaped. Both callers — the pre-migration
 * backup and the backup module — go through here, so that escaping exists once
 * rather than being written out twice and diverging. The security suite asserts
 * that no other SQL in the codebase interpolates anything at all.
 *
 * VACUUM INTO, rather than a file copy, because in WAL mode recent commits live
 * in a sidecar file: copying the database alone can produce a file missing the
 * last few sales.
 */
export function vacuumInto(target: string, connection: Db = getDatabase()): void {
  checkpoint(connection);
  const escaped = target.replace(/'/g, "''");
  connection.exec(`VACUUM INTO '${escaped}'`);
}

export function closeDatabase(): void {
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    logger.info('Database closed');
  } catch (err) {
    logger.error('Error while closing database', err);
  } finally {
    db = null;
  }
}

/** True when the database file does not exist yet (fresh installation). */
export function databaseFileExists(file: string): boolean {
  return fs.existsSync(file);
}
