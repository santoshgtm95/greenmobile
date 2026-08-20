/**
 * Electron-side startup wiring (spec §87).
 *
 * Turns the platform paths into the arguments the platform-agnostic data layer
 * expects, and turns any failure into the plain restore-or-exit choice the spec
 * requires — never a stack trace in the user's face.
 */
import { app, dialog } from "electron";
import path from "node:path";
import {
  ensureDirectories,
  databaseFile,
  migrationsDir,
  backupsDir,
  logsDir,
  userDataDir,
} from "./utils/paths";
import { configureLogger, logger } from "./utils/logger";
import { initializeDatabase, type DatabaseStartupResult } from "./database";
import { DatabaseIntegrityError, closeDatabase } from "./database/connection";
import { MigrationError } from "./database/migrator";
import {
  inspectBackup,
  replaceUnopenableDatabase,
  runAutomaticBackupIfDue,
} from "./services/backup.service";

export interface StartupContext {
  database: DatabaseStartupResult;
}

/** What the user chose on the fatal-startup dialog. */
type FatalChoice = "restore" | "exit";

function showFatalDatabaseDialog(
  title: string,
  message: string,
  detail: string,
): FatalChoice {
  const response = dialog.showMessageBoxSync({
    type: "error",
    title,
    message,
    detail,
    buttons: ["Restore from Backup…", "Exit"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return response === 0 ? "restore" : "exit";
}

/**
 * Prepares directories, logging and the database.
 *
 * Returns null when the user chose to exit rather than continue, in which case
 * the caller should quit. Returning a context means the application is safe to
 * show its window.
 */
export function startup(): StartupContext | null {
  ensureDirectories();
  configureLogger(logsDir());
  logger.prune();
  logger.info("Application starting", {
    version: app.getVersion(),
    userData: userDataDir(),
    packaged: app.isPackaged,
  });

  try {
    const database = initializeDatabase({
      file: databaseFile(),
      migrationsDir: migrationsDir(),
      backupDir: backupsDir(),
    });

    // Scheduled backup (spec §54). Never allowed to stop the shop opening, so
    // the service logs and swallows its own failures.
    runAutomaticBackupIfDue(backupsDir(), database.db);

    return { database };
  } catch (err) {
    if (err instanceof DatabaseIntegrityError) {
      logger.error("Startup aborted: database integrity check failed", {
        details: err.details,
      });
      const choice = showFatalDatabaseDialog(
        "Database problem",
        "Database integrity check failed.\n\nPlease restore from a backup.",
        `The POS database at:\n${databaseFile()}\n\nis damaged and cannot be opened safely.\n\n` +
          `Your backups are in:\n${backupsDir()}\n\n` +
          'Choosing "Restore from Backup" will let you pick a backup file to restore.',
      );
      return choice === "restore" ? handleRestoreAndRetry() : null;
    }

    if (err instanceof MigrationError) {
      logger.error("Startup aborted: migration failed", {
        migration: err.migration.name,
        backupPath: err.backupPath,
      });
      showFatalDatabaseDialog(
        "Update problem",
        "The database could not be updated to the new version.",
        `${err.message}\n\nPlease restore that backup, or contact support before using the POS again.`,
      );
      return null;
    }

    logger.error("Startup aborted: unexpected database error", err);
    dialog.showErrorBox(
      "Green Mobile POS could not start",
      "The application could not open its database.\n\n" +
        `Technical details were written to:\n${logsDir()}`,
    );
    return null;
  }
}

/**
 * Restore before anyone has signed in (spec §55, §87).
 *
 * This runs when the database could not be opened at all, so it cannot use the
 * normal restore path — that one begins by taking a consistent copy of the live
 * database, and there is no readable database here. The damaged file is copied
 * aside instead, then the chosen backup is put in its place and the ordinary
 * startup sequence runs again.
 */
function handleRestoreAndRetry(): StartupContext | null {
  const chosen = dialog.showOpenDialogSync({
    title: "Choose a backup to restore",
    defaultPath: backupsDir(),
    properties: ["openFile"],
    filters: [{ name: "POS backup", extensions: ["db"] }],
  });

  if (!chosen || chosen.length === 0) return null;
  const backupFile = chosen[0];

  // Never overwrite on the strength of a filename: prove it opens and holds a
  // POS schema this build understands before the damaged file goes anywhere.
  const inspection = inspectBackup(backupFile, migrationsDir());
  if (!inspection.ok) {
    dialog.showErrorBox(
      "That backup cannot be used",
      `${inspection.problem ?? "The file could not be read."}\n\n` +
        "Start Green Mobile POS again to choose a different one.",
    );
    return null;
  }

  const confirmed = dialog.showMessageBoxSync({
    type: "warning",
    title: "Restore this backup?",
    message: "Restoring will replace the damaged database.",
    detail:
      `${path.basename(backupFile)}\n\n` +
      `Contains ${inspection.contents.products} products, ` +
      `${inspection.contents.sales} sales, ` +
      `${inspection.contents.customers} customers and ` +
      `${inspection.contents.services} repair jobs.\n\n` +
      "A copy of the damaged file will be kept in your backups folder.",
    buttons: ["Restore", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (confirmed !== 0) return null;

  // The failed attempt above may have left a connection open on the bad file.
  closeDatabase();

  try {
    replaceUnopenableDatabase(backupFile, databaseFile(), backupsDir());
  } catch (err) {
    logger.error("Pre-login restore failed", err);
    dialog.showErrorBox(
      "Restore failed",
      "The backup could not be put in place. The damaged database has not been changed.\n\n" +
        `Technical details were written to:\n${logsDir()}`,
    );
    return null;
  }

  try {
    const database = initializeDatabase({
      file: databaseFile(),
      migrationsDir: migrationsDir(),
      backupDir: backupsDir(),
    });
    logger.info("Pre-login restore succeeded", { backupFile });
    dialog.showMessageBoxSync({
      type: "info",
      title: "Backup restored",
      message: "Your backup has been restored.",
      detail:
        "Sign in with the username and password that were in use when the backup was made.",
      buttons: ["Continue"],
      noLink: true,
    });
    return { database };
  } catch (err) {
    logger.error("Restored backup would not start either", err);
    dialog.showErrorBox(
      "Restore failed",
      "The restored backup could not be opened either.\n\n" +
        `Your original damaged file was kept in:\n${backupsDir()}`,
    );
    return null;
  }
}
