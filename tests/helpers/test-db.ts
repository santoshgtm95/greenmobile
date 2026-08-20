/**
 * Spins up a real, file-backed POS database in a temp directory using the exact
 * same migration SQL and seed data the shipped application uses.
 *
 * Tests run against real SQLite — foreign keys, transactions and constraints all
 * behave as they will in production. Nothing is mocked.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database as Db } from 'better-sqlite3';
import { initializeDatabase, closeDatabase } from '../../electron/database';
import { silenceLogger } from '../../electron/utils/logger';

silenceLogger();

const REPO_ROOT = path.resolve(__dirname, '../..');
export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'prisma/migrations');

export interface TestDatabase {
  db: Db;
  dir: string;
  file: string;
  backupDir: string;
  requiresFirstRunSetup: boolean;
  schemaVersion: number;
  cleanup(): void;
}

export function createTestDatabase(): TestDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-test-'));
  const file = path.join(dir, 'data', 'pos.db');
  const backupDir = path.join(dir, 'backups');

  const result = initializeDatabase({ file, migrationsDir: MIGRATIONS_DIR, backupDir });

  return {
    db: result.db,
    dir,
    file,
    backupDir,
    requiresFirstRunSetup: result.requiresFirstRunSetup,
    schemaVersion: result.schemaVersion,
    cleanup() {
      closeDatabase();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows occasionally holds the file briefly; a stale temp dir is harmless.
      }
    },
  };
}

/** Inserts a user directly, for tests that need an actor but not the auth flow. */
export function insertTestUser(
  db: Db,
  overrides: Partial<{ id: string; username: string; fullName: string; role: string }> = {},
): string {
  const id = overrides.id ?? randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO "User" (id, username, passwordHash, fullName, phone, role, isActive, createdAt, updatedAt)
     VALUES (?, ?, 'not-a-real-hash', ?, NULL, ?, 1, ?, ?)`,
  ).run(
    id,
    overrides.username ?? `user_${id.slice(0, 8)}`,
    overrides.fullName ?? 'Test User',
    overrides.role ?? 'ADMIN',
    now,
    now,
  );
  return id;
}

export function tableNames(db: Db): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}
