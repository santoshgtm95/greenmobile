/**
 * Backup and restore over the bridge (spec §53–§55).
 *
 * Every channel here needs `backup.manage`, which only an administrator holds:
 * restoring is the single most destructive thing this application can do, and
 * deleting a backup is not far behind.
 */
import { dialog, shell } from 'electron';
import { z } from 'zod';
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import { zNoPayload } from '../../shared/validation';
import type { BackupOverview } from '../../shared/backup';
import {
  createBackup,
  deleteBackup,
  databaseSize,
  inspectBackup,
  isWritable,
  listBackups,
  pruneAutomaticBackups,
  resolveBackupDir,
  restoreBackup,
  backupFileName,
} from '../services/backup.service';
import { getRaw, getShopSettings, setSetting } from '../services/settings.service';
import { recordAudit } from '../services/audit.service';
import { setSessionUser } from '../session';
import { requireUser } from '../session';
import { backupsDir, databaseFile, migrationsDir } from '../utils/paths';
import { logger } from '../utils/logger';
import path from 'node:path';

const zPath = z.object({ path: z.string().min(1).max(4096) });

/** The shop's chosen folder, or null when it is not set. */
function customDir(): string | null {
  const configured = getShopSettings().backupLocation.trim();
  return configured ? configured : null;
}

export function registerBackupIpc(): void {
  /** Everything the Backup screen needs in one call. */
  handle(
    CHANNELS.backup.overview,
    { access: 'permission', permission: 'backup.manage' },
    zNoPayload,
    (): BackupOverview => {
      const settings = getShopSettings();
      const custom = customDir();
      const defaultDir = backupsDir();

      return {
        folders: {
          defaultDir,
          customDir: custom,
          effectiveDir: resolveBackupDir(defaultDir, settings.backupLocation),
          customDirWritable: custom ? isWritable(custom) : true,
        },
        backups: listBackups(defaultDir, custom),
        databaseSizeBytes: databaseSize(databaseFile()),
        autoBackupFrequency: settings.autoBackupFrequency,
        autoBackupKeep: settings.autoBackupKeep,
        lastAutoBackupDay: getRaw('lastAutoBackupDay'),
      };
    },
  );

  /**
   * Creates a backup now (spec §53).
   *
   * With chooseLocation the user picks the file, which is how a backup reaches
   * a USB stick that is not the configured folder.
   */
  handle(
    CHANNELS.backup.create,
    { access: 'permission', permission: 'backup.manage' },
    z.object({ chooseLocation: z.boolean().default(false) }),
    async (input) => {
      const actor = requireUser();
      const settings = getShopSettings();
      const dir = resolveBackupDir(backupsDir(), settings.backupLocation);

      let targetPath: string | undefined;
      if (input.chooseLocation) {
        const result = await dialog.showSaveDialog({
          title: 'Save a backup of the POS database',
          defaultPath: path.join(dir, backupFileName('MANUAL')),
          filters: [{ name: 'POS backup', extensions: ['db'] }],
        });
        if (result.canceled || !result.filePath) return { created: false as const, file: null };
        targetPath = result.filePath;
      }

      const file = createBackup({ dir, kind: 'MANUAL', targetPath });
      pruneAutomaticBackups(dir, settings.autoBackupKeep);

      recordAudit({
        userId: actor.id,
        action: 'BACKUP',
        entityName: 'Database',
        summary: `Created a manual backup at ${file.path}`,
      });

      return { created: true as const, file };
    },
  );

  /** Reads a candidate file without touching the live database (spec §55). */
  handle(
    CHANNELS.backup.inspect,
    { access: 'permission', permission: 'backup.manage' },
    zPath,
    (input) => inspectBackup(input.path, migrationsDir()),
  );

  /**
   * Replaces the live database (spec §55).
   *
   * The service takes its own safety backup first and rolls back if the swap
   * fails, so the only thing left to do here is make sure nobody is still
   * signed in to a shop that no longer exists: the restored database has its
   * own users, and the current session's id may mean nothing in it.
   */
  handle(
    CHANNELS.backup.restore,
    { access: 'permission', permission: 'backup.manage' },
    zPath,
    (input) => {
      const actor = requireUser();

      const result = restoreBackup({
        file: input.path,
        targetFile: databaseFile(),
        backupDir: backupsDir(),
        migrationsDir: migrationsDir(),
      });

      // Written into the *restored* database, which is the one that will be
      // read from here on — so the record lands where someone will look for it.
      recordAudit({
        userId: null,
        action: 'RESTORE',
        entityName: 'Database',
        summary:
          `Database restored from ${input.path} by ${actor.username}. ` +
          `The data replaced was saved to ${result.safetyBackup.path}.`,
      });

      setSessionUser(null);
      logger.info('Session cleared after restore');
      return result;
    },
  );

  handle(
    CHANNELS.backup.delete,
    { access: 'permission', permission: 'backup.manage' },
    zPath,
    (input) => {
      const actor = requireUser();
      deleteBackup(input.path, [backupsDir(), customDir()]);
      recordAudit({
        userId: actor.id,
        action: 'DELETE',
        entityName: 'Backup',
        summary: `Deleted the backup ${input.path}`,
      });
      return { deleted: true as const };
    },
  );

  /** Picks the folder backups are written to — a USB drive or a second disk. */
  handle(
    CHANNELS.backup.chooseFolder,
    { access: 'permission', permission: 'backup.manage' },
    zNoPayload,
    async () => {
      const actor = requireUser();
      const result = await dialog.showOpenDialog({
        title: 'Choose a folder for backups',
        defaultPath: customDir() ?? backupsDir(),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { chosen: false as const, path: null, writable: false };
      }

      const chosen = result.filePaths[0];
      const writable = isWritable(chosen);
      if (writable) {
        setSetting('backupLocation', chosen, actor.id);
        recordAudit({
          userId: actor.id,
          action: 'SETTINGS_UPDATE',
          entityName: 'Setting',
          entityId: 'backupLocation',
          summary: `Backup folder set to ${chosen}`,
        });
      }
      return { chosen: true as const, path: chosen, writable };
    },
  );

  handle(
    CHANNELS.backup.openFolder,
    { access: 'permission', permission: 'backup.manage' },
    zNoPayload,
    async () => {
      const folder = resolveBackupDir(backupsDir(), getShopSettings().backupLocation);
      const error = await shell.openPath(folder);
      if (error) logger.warn('Could not open the backups folder', { folder, error });
      return { opened: error === '', path: folder };
    },
  );
}
