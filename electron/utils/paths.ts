/**
 * Every writable path the application uses.
 *
 * All application data lives OUTSIDE the installation directory so that it
 * survives upgrades and never hits Program Files permission problems.
 *
 *   %APPDATA%\MobileShopPOS\
 *   ├── data/            pos.db (+ WAL sidecar files)
 *   ├── backups/
 *   ├── logs/
 *   ├── exports/
 *   ├── invoices/
 *   └── attachments/
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/** Root of all user data. Set via app.setName() before this is first read. */
export function userDataDir(): string {
  return app.getPath('userData');
}

export function dataDir(): string {
  return path.join(userDataDir(), 'data');
}

export function databaseFile(): string {
  return path.join(dataDir(), 'pos.db');
}

export function backupsDir(): string {
  return path.join(userDataDir(), 'backups');
}

export function logsDir(): string {
  return path.join(userDataDir(), 'logs');
}

export function exportsDir(): string {
  return path.join(userDataDir(), 'exports');
}

export function invoicesDir(): string {
  return path.join(userDataDir(), 'invoices');
}

export function attachmentsDir(): string {
  return path.join(userDataDir(), 'attachments');
}

/**
 * Read-only resources shipped with the app (migration SQL, report templates).
 * In development these live in the repo; in production electron-builder copies
 * them next to the packaged app via extraResources.
 */
export function resourcesDir(): string {
  return app.isPackaged
    ? process.resourcesPath
    : path.resolve(app.getAppPath());
}

/**
 * Where the generated migration SQL lives.
 *   development : <repo>/prisma/migrations
 *   packaged    : <install>/resources/migrations  (electron-builder extraResources)
 */
export function migrationsDir(): string {
  const packaged = path.join(resourcesDir(), 'migrations');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(resourcesDir(), 'prisma', 'migrations');
}

export function ensureDirectories(): void {
  for (const dir of [
    dataDir(),
    backupsDir(),
    logsDir(),
    exportsDir(),
    invoicesDir(),
    attachmentsDir(),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
