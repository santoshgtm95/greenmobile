/**
 * Database backup and restore (spec §53–§55, §86).
 *
 * Every path is injected rather than read from Electron, so the whole module
 * runs unchanged under plain Node in the test suite — which matters more here
 * than anywhere else in the application, because this is the code that is
 * allowed to overwrite the shop's only copy of its trading history.
 *
 * THE TWO RULES THIS FILE EXISTS TO ENFORCE
 *
 *   1. A backup is a *consistent* copy. Not a file copy — SQLite in WAL mode
 *      keeps recent commits in a sidecar file, so copying pos.db on its own can
 *      produce a database missing today's sales. VACUUM INTO reads through the
 *      WAL and writes a complete, already-compacted database.
 *
 *   2. Nothing overwrites the live database until a safety backup of it exists
 *      and the replacement has been proven to be a readable POS database. If
 *      the restore then fails anyway, the safety copy goes back.
 */
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger";
import {
  getDatabase,
  openDatabase,
  closeDatabase,
  checkIntegrity,
  vacuumInto,
} from "../database/connection";
import { migrate, currentVersion, latestVersion } from "../database/migrator";
import { seedReferenceData } from "../database/seed";
import { getShopSettings, getRaw, setSetting } from "./settings.service";
import { recordAudit } from "./audit.service";
import { errors } from "../../shared/errors";
import { businessDay, addDays } from "../../shared/datetime";
import type {
  BackupFile,
  BackupInspection,
  BackupKind,
  RestoreResult,
} from "../../shared/backup";
import type { ShopSettings } from "../../shared/settings";

const FILE_PREFIX = "MobileShopPOS";

/** Filename fragment per kind. Read back by classifyBackup(). */
const KIND_TAG: Record<Exclude<BackupKind, "UNKNOWN">, string> = {
  MANUAL: "Backup",
  AUTOMATIC: "Auto",
  PRE_MIGRATION: "PreMigration",
  SAFETY: "Safety",
};

/**
 * `2026-08-10_083000` — sortable, and legal in a Windows filename, which rules
 * out the colons an ISO timestamp would bring.
 */
export function backupStamp(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `_${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  );
}

export function backupFileName(
  kind: Exclude<BackupKind, "UNKNOWN">,
  at: Date = new Date(),
): string {
  return `${FILE_PREFIX}_${KIND_TAG[kind]}_${backupStamp(at)}.db`;
}

/**
 * Works out what a file in the backups folder is from its name.
 *
 * The migrator writes `MobileShopPOS_PreMigration_v3_2026-08-10_083000.db`, so
 * the tag is matched rather than the whole name.
 */
export function classifyBackup(fileName: string): BackupKind {
  if (!fileName.startsWith(`${FILE_PREFIX}_`)) return "UNKNOWN";
  for (const [kind, tag] of Object.entries(KIND_TAG) as Array<
    [Exclude<BackupKind, "UNKNOWN">, string]
  >) {
    if (fileName.startsWith(`${FILE_PREFIX}_${tag}_`)) return kind;
  }
  return "UNKNOWN";
}

function toBackupFile(
  file: string,
  folder: "DEFAULT" | "CUSTOM",
  stats: fs.Stats = fs.statSync(file),
): BackupFile {
  const name = path.basename(file);
  return {
    name,
    path: file,
    sizeBytes: stats.size,
    createdAt: stats.mtime.toISOString(),
    kind: classifyBackup(name),
    folder,
  };
}

// -----------------------------------------------------------------------------
// Listing
// -----------------------------------------------------------------------------

function listInFolder(
  dir: string | null,
  folder: "DEFAULT" | "CUSTOM",
): BackupFile[] {
  if (!dir) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // An unplugged USB drive is a normal state, not an error worth a dialog.
    return [];
  }

  const files: BackupFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".db")) continue;
    try {
      files.push(toBackupFile(path.join(dir, entry.name), folder));
    } catch {
      // Vanished between readdir and stat.
    }
  }
  return files;
}

/** Newest first, across both the default folder and the shop's own. */
export function listBackups(
  defaultDir: string,
  customDir: string | null,
): BackupFile[] {
  const custom =
    customDir && path.resolve(customDir) !== path.resolve(defaultDir)
      ? customDir
      : null;
  return [
    ...listInFolder(defaultDir, "DEFAULT"),
    ...listInFolder(custom, "CUSTOM"),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** True when a new file can actually be written to `dir`. */
export function isWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where a backup should be written: the shop's own folder when it is set and
 * reachable, otherwise the application folder. A USB stick that is not plugged
 * in must not stop the shop from taking a backup.
 */
export function resolveBackupDir(
  defaultDir: string,
  configured: string,
): string {
  const custom = configured.trim();
  if (!custom) return defaultDir;
  return isWritable(custom) ? custom : defaultDir;
}

// -----------------------------------------------------------------------------
// Creating
// -----------------------------------------------------------------------------

export interface CreateBackupOptions {
  dir: string;
  kind: Exclude<BackupKind, "UNKNOWN">;
  /** Overrides the generated name. Used by the Save As dialog. */
  targetPath?: string;
}

/**
 * Writes a consistent snapshot of the live database.
 *
 * VACUUM INTO refuses to overwrite an existing file, which is a feature: it
 * means a backup can never silently replace another one.
 */
export function createBackup(
  options: CreateBackupOptions,
  db: Db = getDatabase(),
): BackupFile {
  const target =
    options.targetPath ?? path.join(options.dir, backupFileName(options.kind));

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // VACUUM INTO refuses to overwrite, which is a feature — but the caller may
    // legitimately be replacing a file they just chose in a Save As dialog.
    if (fs.existsSync(target)) fs.rmSync(target);
    vacuumInto(target, db);
  } catch (err) {
    logger.error("Backup failed", {
      target,
      error: err instanceof Error ? err.message : String(err),
    });
    throw errors.backupFailed(
      "The backup file could not be written. Check that the folder exists and has free space.",
    );
  }

  const file = toBackupFile(target, options.targetPath ? "CUSTOM" : "DEFAULT");
  logger.info("Backup created", {
    path: target,
    kind: options.kind,
    bytes: file.sizeBytes,
  });
  return file;
}

/**
 * Retention (spec §54).
 *
 * Only AUTOMATIC files are ever deleted. A manual backup, a pre-migration copy
 * and a pre-restore safety copy all represent a decision somebody made, and
 * housekeeping does not get to undo those.
 */
export function pruneAutomaticBackups(dir: string, keep: number): string[] {
  const limit = Math.max(1, keep);
  const automatic = listInFolder(dir, "DEFAULT")
    .filter((file) => file.kind === "AUTOMATIC")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const removed: string[] = [];
  for (const file of automatic.slice(limit)) {
    try {
      fs.rmSync(file.path);
      removed.push(file.path);
    } catch (err) {
      logger.warn("Could not remove an old automatic backup", {
        path: file.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (removed.length > 0)
    logger.info("Old automatic backups removed", { count: removed.length });
  return removed;
}

/** True when the schedule says a backup is owed today. */
export function automaticBackupDue(
  frequency: ShopSettings["autoBackupFrequency"],
  lastDay: string,
  today: string = businessDay(),
): boolean {
  if (frequency === "DISABLED") return false;
  if (!lastDay) return true;
  if (frequency === "DAILY") return today > lastDay;
  return today >= addDays(lastDay, 7);
}

/**
 * Takes the scheduled backup if one is owed, then prunes (spec §54).
 *
 * Called during startup. A failure here is logged and swallowed: a shop that
 * cannot reach its USB drive this morning must still be able to open the till.
 */
export function runAutomaticBackupIfDue(
  defaultDir: string,
  db: Db = getDatabase(),
): BackupFile | null {
  const settings = getShopSettings(db);

  // Nothing worth backing up before the shop has been set up.
  if (!settings.setupCompleted) return null;
  if (
    !automaticBackupDue(
      settings.autoBackupFrequency,
      getRaw("lastAutoBackupDay", db),
    )
  ) {
    return null;
  }

  const dir = resolveBackupDir(defaultDir, settings.backupLocation);
  try {
    const file = createBackup({ dir, kind: "AUTOMATIC" }, db);
    pruneAutomaticBackups(dir, settings.autoBackupKeep);
    // Stamped after the file exists, so a failure retries on the next start.
    setSetting("lastAutoBackupDay", businessDay(), null, db);
    recordAudit(
      {
        userId: null,
        action: "BACKUP",
        entityName: "Database",
        summary: `Automatic backup (${settings.autoBackupFrequency.toLowerCase()}) written to ${file.path}`,
      },
      db,
    );
    return file;
  } catch (err) {
    logger.error("Automatic backup did not run", {
      dir,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// -----------------------------------------------------------------------------
// Inspecting a candidate
// -----------------------------------------------------------------------------

/**
 * Opens a file read-only and decides whether it is safe to restore.
 *
 * A backup taken by a *newer* build is rejected outright: this build's migrator
 * only moves a schema forward, so it has no way to make sense of a database
 * from the future, and pretending otherwise would corrupt it.
 */
export function inspectBackup(
  file: string,
  migrationsDir: string,
): BackupInspection {
  const expectedSchemaVersion = latestVersion(migrationsDir);
  const empty: BackupInspection = {
    ok: false,
    schemaVersion: 0,
    expectedSchemaVersion,
    sizeBytes: 0,
    contents: { products: 0, sales: 0, customers: 0, services: 0 },
  };

  let stats: fs.Stats;
  try {
    stats = fs.statSync(file);
  } catch {
    return { ...empty, problem: "That file no longer exists." };
  }

  let candidate: Db | null = null;
  try {
    candidate = new Database(file, { readonly: true, fileMustExist: true });

    const integrity = candidate.pragma("integrity_check", {
      simple: true,
    }) as string;
    if (integrity !== "ok") {
      return {
        ...empty,
        sizeBytes: stats.size,
        problem: "This backup file is damaged and cannot be restored.",
      };
    }

    const hasSales = (
      candidate
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'Sale'`,
        )
        .get() as { n: number }
    ).n;
    if (hasSales === 0) {
      return {
        ...empty,
        sizeBytes: stats.size,
        problem: "This is not a Green Mobile POS backup.",
      };
    }

    const schemaVersion = candidate.pragma("user_version", {
      simple: true,
    }) as number;
    if (schemaVersion > expectedSchemaVersion) {
      return {
        ...empty,
        schemaVersion,
        sizeBytes: stats.size,
        problem:
          `This backup was made by a newer version of the application ` +
          `(database version ${schemaVersion}; this version understands ${expectedSchemaVersion}). ` +
          "Update Green Mobile POS before restoring it.",
      };
    }

    const count = (table: string): number =>
      (
        candidate!.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as {
          n: number;
        }
      ).n;

    return {
      ok: true,
      schemaVersion,
      expectedSchemaVersion,
      sizeBytes: stats.size,
      contents: {
        products: count("Product"),
        sales: count("Sale"),
        customers: count("Customer"),
        services: count("ServiceOrder"),
      },
    };
  } catch (err) {
    logger.warn("Backup inspection failed", {
      file,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ...empty,
      sizeBytes: stats.size,
      problem: "This file could not be opened as a database.",
    };
  } finally {
    candidate?.close();
  }
}

// -----------------------------------------------------------------------------
// Restoring
// -----------------------------------------------------------------------------

/** Removes the WAL sidecars, which belong to the file being replaced. */
function removeSidecars(databaseFile: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    try {
      fs.rmSync(`${databaseFile}${suffix}`, { force: true });
    } catch {
      // Best effort: SQLite recreates them on open.
    }
  }
}

export interface RestoreOptions {
  /** The backup to restore. */
  file: string;
  /** The live database this will replace. */
  targetFile: string;
  /** Where the safety copy of the current data is written. */
  backupDir: string;
  migrationsDir: string;
}

/**
 * Replaces the live database with a backup (spec §55).
 *
 * The connection is closed and reopened around the swap, so callers must treat
 * any database handle they were holding as stale — which is why this is only
 * ever reached through the IPC layer, where the session is cleared and the
 * renderer reloads afterwards.
 */
export function restoreBackup(options: RestoreOptions): RestoreResult {
  const inspection = inspectBackup(options.file, options.migrationsDir);
  if (!inspection.ok) {
    throw errors.restoreFailed(inspection.problem);
  }

  // Rule 2: the current data is safe before anything is overwritten.
  const safetyBackup = createBackup({ dir: options.backupDir, kind: "SAFETY" });
  logger.info("Restore starting", {
    from: options.file,
    safetyBackup: safetyBackup.path,
    fromSchemaVersion: inspection.schemaVersion,
  });

  closeDatabase();
  removeSidecars(options.targetFile);

  try {
    fs.copyFileSync(options.file, options.targetFile);

    const db = openDatabase(options.targetFile);
    checkIntegrity(db);
    const migration = migrate(db, {
      migrationsDir: options.migrationsDir,
      backupDir: options.backupDir,
    });
    seedReferenceData(db);

    const result: RestoreResult = {
      safetyBackup,
      restoredFrom: options.file,
      schemaVersion: currentVersion(db),
      migrated: migration.applied.length > 0,
    };
    logger.info("Restore complete", {
      from: options.file,
      schemaVersion: result.schemaVersion,
      migrated: result.migrated,
    });
    return result;
  } catch (err) {
    logger.error("Restore failed — putting the safety backup back", {
      from: options.file,
      safetyBackup: safetyBackup.path,
      error: err instanceof Error ? err.message : String(err),
    });

    // Put the shop back exactly where it was. If even this fails the safety
    // file is still on disk, and its path is in the message and the log.
    try {
      closeDatabase();
      removeSidecars(options.targetFile);
      fs.copyFileSync(safetyBackup.path, options.targetFile);
      openDatabase(options.targetFile);
    } catch (rollbackErr) {
      logger.error("Rollback after a failed restore also failed", rollbackErr);
      throw errors.restoreFailed(
        `The database could not be restored and the original could not be put back. ` +
          `Your data is safe in:\n${safetyBackup.path}`,
      );
    }

    throw errors.restoreFailed(
      `Your previous data has been put back. The backup was not restored. ` +
        `A copy of your data before the attempt is in:\n${safetyBackup.path}`,
    );
  }
}

/**
 * Moves a database that failed its integrity check out of the way.
 *
 * A plain file copy, deliberately: VACUUM INTO needs a readable database, and
 * this one by definition is not. The goal is only to keep the damaged bytes —
 * a specialist can sometimes recover rows from them — not to produce something
 * the application could open.
 */
export function quarantineDatabase(
  databaseFile: string,
  backupDir: string,
): string | null {
  if (!fs.existsSync(databaseFile)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(
    backupDir,
    `${FILE_PREFIX}_Damaged_${backupStamp()}.db`,
  );
  try {
    fs.copyFileSync(databaseFile, target);
    logger.info("Damaged database kept", { target });
    return target;
  } catch (err) {
    logger.error("Could not keep a copy of the damaged database", {
      databaseFile,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Puts a backup in place of a database that could not be opened at all.
 *
 * Separate from restoreBackup() because that one starts by making a consistent
 * copy of the live database, which is exactly what is impossible here. This
 * runs before the application has a connection, so it does no reopening — the
 * caller runs the normal startup sequence afterwards.
 */
export function replaceUnopenableDatabase(
  backupFile: string,
  databaseFile: string,
  backupDir: string,
): { quarantined: string | null } {
  const quarantined = quarantineDatabase(databaseFile, backupDir);
  removeSidecars(databaseFile);
  fs.rmSync(databaseFile, { force: true });
  fs.copyFileSync(backupFile, databaseFile);
  logger.info("Unopenable database replaced from a backup", {
    backupFile,
    databaseFile,
    quarantined,
  });
  return { quarantined };
}

// -----------------------------------------------------------------------------
// Deleting
// -----------------------------------------------------------------------------

/**
 * Removes a backup file.
 *
 * Confined to the two known backup folders and to .db files: the renderer
 * supplies this path, and a delete is not something to take on trust.
 */
export function deleteBackup(
  file: string,
  allowedDirs: Array<string | null>,
): void {
  const resolved = path.resolve(file);
  const permitted = allowedDirs
    .filter((dir): dir is string => Boolean(dir))
    .some((dir) => path.dirname(resolved) === path.resolve(dir));

  if (!permitted || !resolved.toLowerCase().endsWith(".db")) {
    logger.warn("Refused to delete a file outside the backup folders", {
      file,
    });
    throw errors.validation("That file is not in a backup folder.");
  }

  try {
    fs.rmSync(resolved);
  } catch (err) {
    logger.error("Could not delete backup", {
      file: resolved,
      error: err instanceof Error ? err.message : String(err),
    });
    throw errors.validation(
      "That backup could not be deleted. It may be open in another program.",
    );
  }
  logger.info("Backup deleted", { path: resolved });
}

/** Bytes on disk for the live database, including its WAL sidecar. */
export function databaseSize(databaseFile: string): number {
  let total = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      total += fs.statSync(`${databaseFile}${suffix}`).size;
    } catch {
      // Sidecars only exist while the database is open.
    }
  }
  return total;
}
