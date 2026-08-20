/**
 * Staff accounts (spec §8, §29, §30, §31).
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT
 *
 * There is no support line, no password-reset email and no way in from outside:
 * if the last administrator is deactivated, demoted or deleted, **nobody can ever
 * change a setting, take a backup or reset a password on this installation
 * again**. The database would still be there and the till would still work, but
 * the shop would be permanently locked out of its own administration.
 *
 * So every path that could remove the last administrator is refused here, in the
 * main process, with a message that explains what to do instead. The renderer
 * disables those controls too, but that is a courtesy — this is the boundary.
 *
 * Deletion is soft for the same reason it is soft for products (spec §74): a
 * user who has rung up a sale is named on that sale forever, so they are
 * deactivated rather than removed. An account created by mistake, which has
 * touched nothing, is deleted outright.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase, transaction } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant } from '../../shared/datetime';
import { errors } from '../../shared/errors';
import { USER_ROLES, type UserRole } from '../../shared/domain';
import { hashPassword } from './auth.service';
import { recordAudit } from './audit.service';
import { logger } from '../utils/logger';
import type { SessionUser } from '../session';
import type { CreateUserInput, UpdateUserInput } from '../../shared/validation';

export interface UserRow {
  id: string;
  username: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  isActive: number;
  lastLoginAt: string | null;
  createdAt: string;
  /** Sales rung up by this account. Drives "deactivate rather than delete". */
  salesCount: number;
  /** Repair jobs taken in by this account. */
  serviceCount: number;
}

const USER_SELECT = `
  SELECT u.id, u.username, u.fullName, u.phone, u.role, u.isActive, u.lastLoginAt, u.createdAt,
         (SELECT COUNT(*) FROM "Sale" s WHERE s.createdBy = u.id) AS salesCount,
         (SELECT COUNT(*) FROM "ServiceOrder" o WHERE o.createdBy = u.id) AS serviceCount
    FROM "User" u
`;

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export function listUsers(
  query: { includeInactive?: boolean } = {},
  db: Db = getDatabase(),
): UserRow[] {
  const where = query.includeInactive ? '' : 'WHERE u.isActive = 1';
  return db
    .prepare(
      `${USER_SELECT} ${where}
        ORDER BY u.isActive DESC,
                 CASE u.role WHEN 'ADMIN' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END,
                 u.fullName ASC`,
    )
    .all() as UserRow[];
}

export function getUser(id: string, db: Db = getDatabase()): UserRow {
  const row = db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) as UserRow | undefined;
  if (!row) throw errors.notFound('user');
  return row;
}

/** Active administrators. The number this file exists to keep above zero. */
export function activeAdminCount(db: Db = getDatabase()): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM "User" WHERE role = 'ADMIN' AND isActive = 1`)
      .get() as { n: number }
  ).n;
}

/**
 * True when this account is the only administrator who can still sign in.
 *
 * Exported because the renderer asks the same question to disable the controls,
 * and the answer must not be computed two different ways.
 */
export function isLastActiveAdmin(id: string, db: Db = getDatabase()): boolean {
  const row = db.prepare(`SELECT role, isActive FROM "User" WHERE id = ?`).get(id) as
    | { role: string; isActive: number }
    | undefined;
  if (!row || row.role !== 'ADMIN' || row.isActive !== 1) return false;
  return activeAdminCount(db) <= 1;
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

function assertUsernameFree(username: string, exceptId: string | null, db: Db): void {
  const clash = db
    .prepare(`SELECT id FROM "User" WHERE username = ? COLLATE NOCASE AND id IS NOT ?`)
    .get(username, exceptId) as { id: string } | undefined;
  if (clash) {
    throw errors.validation('That username is already taken.', { username: 'Already taken' });
  }
}

export function createUser(
  input: CreateUserInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): UserRow {
  const username = input.username.trim();

  return transaction(() => {
    assertUsernameFree(username, null, db);

    const id = newId();
    const now = nowInstant();

    db.prepare(
      `INSERT INTO "User" (id, username, passwordHash, fullName, phone, role, isActive,
         createdAt, updatedAt, lastLoginAt, createdBy, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?)`,
    ).run(
      id,
      username,
      hashPassword(input.password),
      input.fullName,
      input.phone ?? null,
      input.role,
      now,
      now,
      actor.id,
      actor.id,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'User',
        entityId: id,
        summary: `Created the ${input.role.toLowerCase()} account "${username}"`,
        // The password is redacted by the audit layer, but it is not passed at all.
        newValues: { username, fullName: input.fullName, role: input.role },
      },
      db,
    );
    logger.info('User created', { username, role: input.role, by: actor.username });

    return getUser(id, db);
  }, db);
}

/**
 * Edits an account's name, phone, role and active state.
 *
 * Not the password — that is resetPassword() in auth.service.ts, which requires
 * the administrator to re-enter their own, so an unattended session cannot be
 * used to take over an account (spec §30).
 */
export function updateUser(
  input: UpdateUserInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): UserRow {
  return transaction(() => {
    const before = getUser(input.id, db);

    if (!(USER_ROLES as readonly string[]).includes(input.role)) {
      throw errors.validation('That is not a valid role.', { role: 'Unknown role' });
    }

    const losesAdmin = before.role === 'ADMIN' && input.role !== 'ADMIN';
    const isBeingDeactivated = before.isActive === 1 && !input.isActive;

    // The lock-out guard. Checked against the state *before* the write, and
    // covering both ways the last administrator could stop being one.
    if ((losesAdmin || isBeingDeactivated) && isLastActiveAdmin(input.id, db)) {
      throw errors.invalidState(
        `"${before.username}" is the only administrator who can still sign in. ` +
          'Create or promote another administrator first, otherwise nobody would be ' +
          'able to change settings, take backups or reset passwords.',
      );
    }

    // Signing yourself out by deactivating your own account is a footgun with no
    // legitimate use: an administrator leaving asks someone else to do it.
    if (isBeingDeactivated && input.id === actor.id) {
      throw errors.invalidState('You cannot deactivate the account you are signed in with.');
    }

    db.prepare(
      `UPDATE "User"
          SET fullName = ?, phone = ?, role = ?, isActive = ?, updatedAt = ?, updatedBy = ?
        WHERE id = ?`,
    ).run(
      input.fullName,
      input.phone ?? null,
      input.role,
      input.isActive ? 1 : 0,
      nowInstant(),
      actor.id,
      input.id,
    );

    const changes: string[] = [];
    if (before.fullName !== input.fullName) changes.push('name');
    if (before.role !== input.role) changes.push(`role to ${input.role.toLowerCase()}`);
    if (Boolean(before.isActive) !== input.isActive) {
      changes.push(input.isActive ? 'reactivated' : 'deactivated');
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'User',
        entityId: input.id,
        summary:
          changes.length > 0
            ? `Updated "${before.username}" — ${changes.join(', ')}`
            : `Updated "${before.username}"`,
        oldValues: { fullName: before.fullName, role: before.role, isActive: before.isActive },
        newValues: { fullName: input.fullName, role: input.role, isActive: input.isActive },
      },
      db,
    );
    logger.info('User updated', { username: before.username, by: actor.username, changes });

    return getUser(input.id, db);
  }, db);
}

/**
 * Every column in the database that points at a User, asked of SQLite itself.
 *
 * Written this way after getting it wrong by hand: an enumerated list of tables
 * missed Product.createdBy, Payment.createdBy, SaleReturn.createdBy and
 * ServicePayment.createdBy — all of which are ON DELETE RESTRICT, so a delete
 * would have been refused by the database and surfaced to the user as a baffling
 * "cannot be deleted because it is used by existing records".
 *
 * Deriving it from `PRAGMA foreign_key_list` means a table added later is covered
 * without anyone remembering to come back here. The table and column names come
 * from SQLite's own catalogue, never from a payload.
 */
function userReferences(db: Db): Array<{ table: string; column: string }> {
  const tables = (
    db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'User'`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);

  const references: Array<{ table: string; column: string }> = [];
  for (const table of tables) {
    const keys = db.pragma(`foreign_key_list("${table}")`) as Array<{
      table: string;
      from: string;
    }>;
    for (const key of keys) {
      if (key.table === 'User') references.push({ table, column: key.from });
    }
  }
  return references;
}

/** Where this user is named, and how many times. Empty means safe to delete. */
function countReferences(id: string, db: Db): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { table, column } of userReferences(db)) {
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" = ?`)
      .get(id) as { n: number };
    if (n > 0) counts[`${table}.${column}`] = n;
  }
  return counts;
}

/**
 * Removes an account, or deactivates it when it has trading history.
 *
 * Returns what actually happened so the UI can say so, exactly as product
 * deletion does.
 */
export function deleteUser(
  id: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): { deactivated: boolean } {
  return transaction(() => {
    const user = getUser(id, db);

    if (id === actor.id) {
      throw errors.invalidState('You cannot remove the account you are signed in with.');
    }
    if (isLastActiveAdmin(id, db)) {
      throw errors.invalidState(
        `"${user.username}" is the only administrator who can still sign in. ` +
          'Create or promote another administrator first.',
      );
    }

    // Anything that names this user is history somebody may need to read back.
    const usage = countReferences(id, db);
    const hasHistory = Object.keys(usage).length > 0;

    if (hasHistory) {
      db.prepare(`UPDATE "User" SET isActive = 0, updatedAt = ?, updatedBy = ? WHERE id = ?`).run(
        nowInstant(),
        actor.id,
        id,
      );
      recordAudit(
        {
          userId: actor.id,
          action: 'UPDATE',
          entityName: 'User',
          entityId: id,
          summary: `Deactivated "${user.username}" (the account appears in trading history)`,
          oldValues: { username: user.username, role: user.role },
        },
        db,
      );
      logger.info('User deactivated instead of deleted', { username: user.username, usage });
      return { deactivated: true };
    }

    db.prepare(`DELETE FROM "User" WHERE id = ?`).run(id);
    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'User',
        entityId: id,
        summary: `Deleted the unused account "${user.username}"`,
        oldValues: { username: user.username, role: user.role },
      },
      db,
    );
    logger.info('Unused user deleted', { username: user.username, by: actor.username });
    return { deactivated: false };
  }, db);
}
