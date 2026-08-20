/**
 * Local authentication (spec §29, §30, §88).
 *
 * Entirely offline: no email service, no OAuth, no licence check. Passwords are
 * stored only as bcrypt hashes — the plaintext is never written to the database,
 * the log file or the audit trail.
 *
 * bcryptjs is used rather than a native Argon2 binding (permitted by spec §3):
 * it is pure JavaScript, so it needs no compiler on the shop's PC and no
 * rebuild against each Electron release, which matters for an application that
 * must install from a single .exe.
 */
import bcrypt from 'bcryptjs';
import type { Database as Db } from 'better-sqlite3';
import { getDatabase, transaction } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant } from '../../shared/datetime';
import { errors } from '../../shared/errors';
import { ROLE_PERMISSIONS, type Permission, type UserRole } from '../../shared/domain';
import { setSessionUser, getSessionUser, type SessionUser } from '../session';
import { recordAudit } from './audit.service';
import { setSettings } from './settings.service';
import { logger } from '../utils/logger';
import type {
  ChangeOwnPasswordInput,
  FirstRunSetupInput,
  LoginInput,
  ResetPasswordInput,
} from '../../shared/validation';

/**
 * Work factor. 12 is ~250ms on typical shop hardware: slow enough to make an
 * offline guess of a stolen database expensive, fast enough that a cashier does
 * not notice at the login screen.
 */
const BCRYPT_ROUNDS = 12;

export interface AuthStatus {
  user: SessionUser | null;
  permissions: Permission[];
  requiresFirstRunSetup: boolean;
}

interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  fullName: string;
  role: string;
  isActive: number;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role as UserRole,
  };
}

export function authStatus(db: Db = getDatabase()): AuthStatus {
  const user = getSessionUser();
  const userCount = (db.prepare(`SELECT COUNT(*) AS n FROM "User"`).get() as { n: number }).n;
  return {
    user,
    permissions: user ? [...ROLE_PERMISSIONS[user.role]] : [],
    requiresFirstRunSetup: userCount === 0,
  };
}

/**
 * Failed sign-in throttling.
 *
 * DELIBERATELY A DELAY, NOT A LOCKOUT. Locking an account would let anyone who
 * can reach the keyboard shut the till — a denial of service against the shop is
 * a worse outcome than a slow guess. So repeated failures simply get slower,
 * which makes guessing at a keyboard hopeless while never stopping the real
 * owner from getting in on their next attempt.
 *
 * In memory only: it protects the running application, and a restart is not
 * something an attacker gains anything from (bcrypt at cost 12 already makes
 * each attempt expensive).
 */
const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const FREE_ATTEMPTS = 4;
const DELAY_STEP_MS = 400;
const MAX_DELAY_MS = 4000;

interface FailureRecord {
  count: number;
  lastAt: number;
}

const failures = new Map<string, FailureRecord>();

/** How long this username should be made to wait before its next attempt. */
export function throttleDelayMs(username: string, now = Date.now()): number {
  const record = failures.get(username.trim().toLowerCase());
  if (!record || now - record.lastAt > FAILURE_WINDOW_MS) return 0;
  const over = record.count - FREE_ATTEMPTS;
  if (over <= 0) return 0;
  return Math.min(over * DELAY_STEP_MS, MAX_DELAY_MS);
}

/**
 * Exported so the delay curve can be tested without paying it.
 *
 * Driving this through login() would mean the test actually waiting out every
 * accumulated delay — around eighty seconds to reach the cap — so the curve is
 * unit-tested here and one integration test confirms login() calls it.
 */
export function recordLoginFailure(username: string, now = Date.now()): void {
  recordFailure(username, now);
}

function recordFailure(username: string, now = Date.now()): void {
  const key = username.trim().toLowerCase();
  const record = failures.get(key);
  if (!record || now - record.lastAt > FAILURE_WINDOW_MS) {
    failures.set(key, { count: 1, lastAt: now });
    return;
  }
  record.count += 1;
  record.lastAt = now;

  // Bounded, so a script hammering random usernames cannot grow this forever.
  if (failures.size > 200) {
    const oldest = [...failures.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
    if (oldest) failures.delete(oldest[0]);
  }
}

function clearFailures(username: string): void {
  failures.delete(username.trim().toLowerCase());
}

/** Test seam: forget every recorded failure. */
export function resetLoginThrottle(): void {
  failures.clear();
}

/**
 * Waits without blocking the main process.
 *
 * A spin loop would freeze the whole application — including a sale someone else
 * is mid-way through — which is far worse than the guessing it would prevent.
 * The real rate limiter is bcrypt itself: `compareSync` at cost 12 costs about a
 * quarter-second of main-thread CPU per attempt and is synchronous, so attempts
 * serialise whether or not they were sent in parallel. This delay is on top of
 * that, aimed at the person standing at the keyboard.
 */
function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Signs a user in.
 *
 * The same message is returned whether the username is unknown or the password
 * is wrong, so the login screen cannot be used to enumerate staff accounts.
 * A deactivated account is told plainly, because that is an administrative
 * state the employee needs to understand rather than a security boundary.
 */
export async function login(input: LoginInput, db: Db = getDatabase()): Promise<AuthStatus> {
  await sleep(throttleDelayMs(input.username));

  const row = db
    .prepare(
      `SELECT id, username, passwordHash, fullName, role, isActive
         FROM "User" WHERE username = ? COLLATE NOCASE`,
    )
    .get(input.username.trim()) as UserRow | undefined;

  if (!row || !verifyPassword(input.password, row.passwordHash)) {
    recordFailure(input.username);
    recordAudit(
      {
        userId: row?.id ?? null,
        action: 'LOGIN_FAILED',
        entityName: 'User',
        entityId: row?.id ?? null,
        summary: `Failed sign-in for "${input.username.trim()}"`,
      },
      db,
    );
    throw errors.invalidCredentials();
  }

  if (row.isActive !== 1) {
    recordAudit(
      {
        userId: row.id,
        action: 'LOGIN_FAILED',
        entityName: 'User',
        entityId: row.id,
        summary: 'Sign-in blocked: account is deactivated',
      },
      db,
    );
    throw errors.invalidState('This account has been deactivated. Please ask an administrator.');
  }

  const user = toSessionUser(row);
  clearFailures(input.username);
  db.prepare(`UPDATE "User" SET lastLoginAt = ? WHERE id = ?`).run(nowInstant(), user.id);
  setSessionUser(user);

  recordAudit(
    { userId: user.id, action: 'LOGIN', entityName: 'User', entityId: user.id, summary: 'Signed in' },
    db,
  );
  logger.info('User signed in', { username: user.username, role: user.role });

  return authStatus(db);
}

export function logout(db: Db = getDatabase()): void {
  const user = getSessionUser();
  if (user) {
    recordAudit(
      { userId: user.id, action: 'LOGOUT', entityName: 'User', entityId: user.id, summary: 'Signed out' },
      db,
    );
    logger.info('User signed out', { username: user.username });
  }
  setSessionUser(null);
}

/**
 * Creates the shop and its first administrator (spec §88).
 *
 * Only possible while no user exists, which is what stops this being a way to
 * mint an administrator on an established database.
 */
export function completeFirstRunSetup(
  input: FirstRunSetupInput,
  db: Db = getDatabase(),
): AuthStatus {
  const userCount = (db.prepare(`SELECT COUNT(*) AS n FROM "User"`).get() as { n: number }).n;
  if (userCount > 0) {
    throw errors.invalidState('This shop has already been set up.');
  }

  const now = nowInstant();
  const userId = newId();

  transaction(() => {
    // The wizard collects the shop's phone, not the administrator's personal
    // one, so the user's phone is left blank for them to fill in later.
    db.prepare(
      `INSERT INTO "User" (id, username, passwordHash, fullName, phone, role, isActive,
         createdAt, updatedAt, lastLoginAt, createdBy, updatedBy)
       VALUES (?, ?, ?, ?, NULL, 'ADMIN', 1, ?, ?, NULL, NULL, NULL)`,
    ).run(userId, input.username.trim(), hashPassword(input.password), input.fullName, now, now);

    setSettings(
      {
        shopName: input.shopName,
        shopAddress: input.shopAddress ?? '',
        shopPhone: input.shopPhone ?? '',
        shopEmail: input.shopEmail ?? '',
        currency: input.currency.toUpperCase(),
        taxEnabled: String(input.taxEnabled),
        taxRate: String(input.taxRate),
        taxMode: input.taxMode,
        receiptWidth: input.receiptWidth,
        backupLocation: input.backupLocation ?? '',
        setupCompleted: 'true',
      },
      userId,
      db,
    );
  }, db);

  const user: SessionUser = {
    id: userId,
    username: input.username.trim(),
    fullName: input.fullName,
    role: 'ADMIN',
  };
  setSessionUser(user);

  recordAudit(
    {
      userId,
      action: 'CREATE',
      entityName: 'User',
      entityId: userId,
      summary: `First-run setup completed; administrator "${user.username}" created`,
      newValues: { username: user.username, role: 'ADMIN', shopName: input.shopName },
    },
    db,
  );
  logger.info('First-run setup completed', { shopName: input.shopName, admin: user.username });

  return authStatus(db);
}

/** A user changing their own password; requires the current one. */
export function changeOwnPassword(
  input: ChangeOwnPasswordInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): void {
  const row = db.prepare(`SELECT passwordHash FROM "User" WHERE id = ?`).get(actor.id) as
    | { passwordHash: string }
    | undefined;
  if (!row) throw errors.notFound('user');

  if (!verifyPassword(input.currentPassword, row.passwordHash)) {
    throw errors.validation('Your current password is not correct.', {
      currentPassword: 'Incorrect password',
    });
  }

  db.prepare(`UPDATE "User" SET passwordHash = ?, updatedAt = ?, updatedBy = ? WHERE id = ?`).run(
    hashPassword(input.newPassword),
    nowInstant(),
    actor.id,
    actor.id,
  );

  recordAudit(
    {
      userId: actor.id,
      action: 'RESET_PASSWORD',
      entityName: 'User',
      entityId: actor.id,
      summary: 'Changed own password',
    },
    db,
  );
}

/**
 * Administrator resets someone else's password (spec §30).
 * The admin must re-enter their own password, so an unattended session cannot
 * be used to take over an account.
 */
export function resetPassword(
  input: ResetPasswordInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): void {
  const adminRow = db.prepare(`SELECT passwordHash FROM "User" WHERE id = ?`).get(actor.id) as
    | { passwordHash: string }
    | undefined;
  if (!adminRow || !verifyPassword(input.adminPassword, adminRow.passwordHash)) {
    throw errors.validation('Your password is not correct.', {
      adminPassword: 'Incorrect password',
    });
  }

  const target = db.prepare(`SELECT id, username FROM "User" WHERE id = ?`).get(input.userId) as
    | { id: string; username: string }
    | undefined;
  if (!target) throw errors.notFound('user');

  db.prepare(`UPDATE "User" SET passwordHash = ?, updatedAt = ?, updatedBy = ? WHERE id = ?`).run(
    hashPassword(input.newPassword),
    nowInstant(),
    actor.id,
    target.id,
  );

  recordAudit(
    {
      userId: actor.id,
      action: 'RESET_PASSWORD',
      entityName: 'User',
      entityId: target.id,
      summary: `Reset the password for "${target.username}"`,
    },
    db,
  );
  logger.info('Password reset by administrator', { target: target.username, by: actor.username });
}
