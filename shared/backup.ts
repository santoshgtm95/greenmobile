/**
 * Backup vocabulary shared by the main process and the renderer (spec §53–§55).
 *
 * All data lives on one computer, so a backup is the only thing standing between
 * a failed disk and a shop with no trading history. The kinds below exist so the
 * retention policy can be honest about what it is allowed to delete: automatic
 * backups are housekeeping and get pruned, everything a person or a migration
 * deliberately created is kept until they remove it themselves.
 */

export const BACKUP_KINDS = [
  /** Created by someone pressing "Create Backup". */
  'MANUAL',
  /** Created on a schedule. The only kind retention ever deletes. */
  'AUTOMATIC',
  /** Taken by the migrator before the schema changed (spec §86). */
  'PRE_MIGRATION',
  /** Taken immediately before a restore overwrote the live database (spec §55). */
  'SAFETY',
  /** A .db file in the folder that this application did not name. */
  'UNKNOWN',
] as const;

export type BackupKind = (typeof BACKUP_KINDS)[number];

export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  MANUAL: 'Manual',
  AUTOMATIC: 'Automatic',
  PRE_MIGRATION: 'Before update',
  SAFETY: 'Before restore',
  UNKNOWN: 'Other',
};

export interface BackupFile {
  /** File name only. */
  name: string;
  /** Full path, used to restore or delete. */
  path: string;
  sizeBytes: number;
  /** UTC instant, from the file's modification time. */
  createdAt: string;
  kind: BackupKind;
  /** Whether it sits in the application folder or the shop's chosen folder. */
  folder: 'DEFAULT' | 'CUSTOM';
}

export interface BackupFolders {
  /** %APPDATA%\MobileShopPOS\backups — always exists. */
  defaultDir: string;
  /** The shop's own folder (USB stick, second disk), if one is configured. */
  customDir: string | null;
  /** Where a new backup will actually be written. */
  effectiveDir: string;
  /** False when a custom folder is set but could not be written to. */
  customDirWritable: boolean;
}

export interface BackupOverview {
  folders: BackupFolders;
  backups: BackupFile[];
  /** Size of the live database, so the user can judge free space. */
  databaseSizeBytes: number;
  autoBackupFrequency: 'DISABLED' | 'DAILY' | 'WEEKLY';
  autoBackupKeep: number;
  /** Business day the last automatic backup ran, or '' if never. */
  lastAutoBackupDay: string;
}

/** What a candidate file turned out to be, before anything is overwritten. */
export interface BackupInspection {
  ok: boolean;
  /** Human explanation when ok is false. */
  problem?: string;
  schemaVersion: number;
  /** Schema version this build of the application expects. */
  expectedSchemaVersion: number;
  sizeBytes: number;
  /** Row counts for the tables an owner would recognise. */
  contents: { products: number; sales: number; customers: number; services: number };
}

export interface RestoreResult {
  /** The safety copy taken of the data that was replaced (spec §55). */
  safetyBackup: BackupFile;
  restoredFrom: string;
  schemaVersion: number;
  /** True when the restored file was older than this build and had to migrate. */
  migrated: boolean;
}

/** Retention choices offered in Settings (spec §54). */
export const BACKUP_KEEP_OPTIONS = [5, 10, 20] as const;
