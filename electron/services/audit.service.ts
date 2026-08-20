/**
 * Append-only audit trail (spec §25).
 *
 * Records who did what, when, and what the values were before and after.
 * Writes are best-effort by design: failing to log must never roll back a sale
 * that otherwise succeeded, so the only caller that shares a transaction is one
 * that explicitly passes the transactional connection.
 *
 * Password hashes are stripped before anything is written.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant, businessDay } from '../../shared/datetime';
import { logger } from '../utils/logger';
import type { AuditAction } from '../../shared/domain';

export interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  entityName: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  summary?: string;
}

/** Fields that must never reach the audit log. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'adminPassword',
]);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_KEYS.has(key) ? '[redacted]' : redact(inner);
    }
    return result;
  }
  return value;
}

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(redact(value));
  } catch {
    return null;
  }
}

export function recordAudit(entry: AuditEntry, db: Db = getDatabase()): void {
  try {
    db.prepare(
      `INSERT INTO "AuditLog" (id, userId, action, entityName, entityId, oldValues, newValues,
         summary, createdAt, createdDay)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId(),
      entry.userId,
      entry.action,
      entry.entityName,
      entry.entityId ?? null,
      serialize(entry.oldValues),
      serialize(entry.newValues),
      entry.summary ?? null,
      nowInstant(),
      businessDay(),
    );
  } catch (err) {
    // Never let auditing break the operation it is describing.
    logger.error('Failed to write audit log entry', {
      action: entry.action,
      entityName: entry.entityName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface AuditLogRow {
  id: string;
  userId: string | null;
  username: string | null;
  fullName: string | null;
  action: string;
  entityName: string;
  entityId: string | null;
  summary: string | null;
  oldValues: string | null;
  newValues: string | null;
  createdAt: string;
}

export interface AuditQuery {
  from?: string;
  to?: string;
  action?: string;
  entityName?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

export function listAudit(
  query: AuditQuery = {},
  db: Db = getDatabase(),
): { rows: AuditLogRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.from) {
    where.push('a.createdDay >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('a.createdDay <= ?');
    params.push(query.to);
  }
  if (query.action) {
    where.push('a.action = ?');
    params.push(query.action);
  }
  if (query.entityName) {
    where.push('a.entityName = ?');
    params.push(query.entityName);
  }
  if (query.userId) {
    where.push('a.userId = ?');
    params.push(query.userId);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const offset = Math.max(query.offset ?? 0, 0);

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM "AuditLog" a ${whereSql}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT a.id, a.userId, u.username, u.fullName, a.action, a.entityName, a.entityId,
              a.summary, a.oldValues, a.newValues, a.createdAt
         FROM "AuditLog" a
         LEFT JOIN "User" u ON u.id = a.userId
         ${whereSql}
        ORDER BY a.createdAt DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as AuditLogRow[];

  return { rows, total };
}
