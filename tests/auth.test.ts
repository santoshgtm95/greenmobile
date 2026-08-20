/**
 * Phase 3 verification (spec §29, §30, §88): first-run setup, login, logout,
 * roles, permissions and password hashing.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import {
  authStatus,
  login,
  logout,
  completeFirstRunSetup,
  changeOwnPassword,
  resetPassword,
  hashPassword,
  verifyPassword,
} from '../electron/services/auth.service';
import { setSessionUser, getSessionUser, requirePermission, sessionHasPermission } from '../electron/session';
import { getShopSettings } from '../electron/services/settings.service';
import { roleHasPermission, ROLE_PERMISSIONS } from '../shared/domain';
import { AppError } from '../shared/errors';
import type { FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;

const SETUP: FirstRunSetupInput = {
  shopName: 'Green Mobile',
  shopAddress: '12 Market Road',
  shopPhone: '0812345678',
  shopEmail: 'shop@example.com',
  fullName: 'Somchai Owner',
  username: 'admin',
  password: 'correct-horse',
  confirmPassword: 'correct-horse',
  currency: 'THB',
  taxEnabled: true,
  taxRate: 700,
  taxMode: 'EXCLUSIVE',
  receiptWidth: '80mm',
  backupLocation: undefined,
};

beforeEach(() => {
  ctx = createTestDatabase();
  setSessionUser(null);
});

afterEach(() => {
  setSessionUser(null);
  ctx.cleanup();
});

describe('password hashing', () => {
  it('never stores the plaintext', () => {
    const hash = hashPassword('correct-horse');
    expect(hash).not.toContain('correct-horse');
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('verifies the right password and rejects the wrong one', () => {
    const hash = hashPassword('correct-horse');
    expect(verifyPassword('correct-horse', hash)).toBe(true);
    expect(verifyPassword('Correct-Horse', hash)).toBe(false);
    expect(verifyPassword('', hash)).toBe(false);
  });

  it('produces a different hash each time (salted)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('does not blow up on a malformed stored hash', () => {
    expect(verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false);
  });
});

describe('first-run setup', () => {
  it('reports that setup is required on a fresh database', () => {
    expect(authStatus(ctx.db).requiresFirstRunSetup).toBe(true);
    expect(authStatus(ctx.db).user).toBeNull();
  });

  it('creates the administrator, applies shop settings and signs them in', () => {
    const status = completeFirstRunSetup(SETUP, ctx.db);

    expect(status.requiresFirstRunSetup).toBe(false);
    expect(status.user).toMatchObject({ username: 'admin', role: 'ADMIN', fullName: 'Somchai Owner' });
    expect(status.permissions).toContain('settings.manage');

    const settings = getShopSettings(ctx.db);
    expect(settings.shopName).toBe('Green Mobile');
    expect(settings.currency).toBe('THB');
    expect(settings.taxEnabled).toBe(true);
    expect(settings.taxRate).toBe(700);
    expect(settings.setupCompleted).toBe(true);
  });

  it('stores only a hash, never the password', () => {
    completeFirstRunSetup(SETUP, ctx.db);
    const row = ctx.db.prepare(`SELECT passwordHash FROM "User" WHERE username='admin'`).get() as {
      passwordHash: string;
    };
    expect(row.passwordHash).not.toContain('correct-horse');
    expect(verifyPassword('correct-horse', row.passwordHash)).toBe(true);
  });

  it('refuses to run twice, so an admin cannot be minted on a live shop', () => {
    completeFirstRunSetup(SETUP, ctx.db);
    setSessionUser(null);
    expect(() => completeFirstRunSetup({ ...SETUP, username: 'sneaky' }, ctx.db)).toThrow(AppError);
    expect((ctx.db.prepare(`SELECT COUNT(*) n FROM "User"`).get() as { n: number }).n).toBe(1);
  });

  it('rolls back completely if the user insert fails', () => {
    completeFirstRunSetup(SETUP, ctx.db);
    const settingsBefore = getShopSettings(ctx.db).shopName;
    setSessionUser(null);
    try {
      completeFirstRunSetup({ ...SETUP, shopName: 'Should Not Apply' }, ctx.db);
    } catch {
      // expected
    }
    expect(getShopSettings(ctx.db).shopName).toBe(settingsBefore);
  });

  it('writes an audit entry for the setup', () => {
    completeFirstRunSetup(SETUP, ctx.db);
    const row = ctx.db
      .prepare(`SELECT action, entityName, summary FROM "AuditLog" ORDER BY createdAt DESC LIMIT 1`)
      .get() as { action: string; entityName: string; summary: string };
    expect(row.action).toBe('CREATE');
    expect(row.entityName).toBe('User');
    expect(row.summary).toContain('First-run setup');
  });
});

describe('login', () => {
  beforeEach(() => {
    completeFirstRunSetup(SETUP, ctx.db);
    logout(ctx.db);
  });

  it('signs in with correct credentials and records lastLoginAt', async () => {
    const status = await login({ username: 'admin', password: 'correct-horse' }, ctx.db);
    expect(status.user?.username).toBe('admin');

    const row = ctx.db.prepare(`SELECT lastLoginAt FROM "User" WHERE username='admin'`).get() as {
      lastLoginAt: string | null;
    };
    expect(row.lastLoginAt).toBeTruthy();
  });

  it('accepts the username case-insensitively', async () => {
    await expect(login({ username: 'ADMIN', password: 'correct-horse' }, ctx.db)).resolves.toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    await expect(login({ username: 'admin', password: 'wrong' }, ctx.db)).rejects.toThrow(AppError);
    expect(getSessionUser()).toBeNull();
  });

  it('gives the same message for an unknown user as for a bad password', async () => {
    const unknown = await captureAsyncError(() => login({ username: 'nobody', password: 'x' }, ctx.db));
    const wrongPass = await captureAsyncError(() => login({ username: 'admin', password: 'x' }, ctx.db));
    expect(unknown.message).toBe(wrongPass.message);
    expect(unknown.code).toBe('INVALID_CREDENTIALS');
  });

  it('records failed attempts in the audit log', async () => {
    await captureAsyncError(() => login({ username: 'admin', password: 'wrong' }, ctx.db));
    const row = ctx.db
      .prepare(`SELECT COUNT(*) n FROM "AuditLog" WHERE action='LOGIN_FAILED'`)
      .get() as { n: number };
    expect(row.n).toBe(1);
  });

  it('never writes the attempted password into the audit log', async () => {
    await captureAsyncError(() => login({ username: 'admin', password: 'super-secret-guess' }, ctx.db));
    const rows = ctx.db.prepare(`SELECT oldValues, newValues, summary FROM "AuditLog"`).all();
    expect(JSON.stringify(rows)).not.toContain('super-secret-guess');
  });

  it('refuses a deactivated account', async () => {
    ctx.db.prepare(`UPDATE "User" SET isActive = 0 WHERE username='admin'`).run();
    const err = await captureAsyncError(() => login({ username: 'admin', password: 'correct-horse' }, ctx.db));
    expect(err.code).toBe('INVALID_STATE');
    expect(getSessionUser()).toBeNull();
  });

  it('clears the session on logout', async () => {
    await login({ username: 'admin', password: 'correct-horse' }, ctx.db);
    expect(getSessionUser()).not.toBeNull();
    logout(ctx.db);
    expect(getSessionUser()).toBeNull();
  });
});

describe('changing passwords', () => {
  beforeEach(() => {
    completeFirstRunSetup(SETUP, ctx.db);
  });

  it('lets a user change their own password with the current one', async () => {
    const actor = getSessionUser()!;
    changeOwnPassword(
      { currentPassword: 'correct-horse', newPassword: 'new-battery', confirmPassword: 'new-battery' },
      actor,
      ctx.db,
    );
    logout(ctx.db);
    await expect(login({ username: 'admin', password: 'new-battery' }, ctx.db)).resolves.toBeTruthy();
    logout(ctx.db);
    await expect(login({ username: 'admin', password: 'correct-horse' }, ctx.db)).rejects.toThrow();
  });

  it('refuses when the current password is wrong', () => {
    const actor = getSessionUser()!;
    const err = captureError(() =>
      changeOwnPassword(
        { currentPassword: 'nope', newPassword: 'new-battery', confirmPassword: 'new-battery' },
        actor,
        ctx.db,
      ),
    );
    expect(err.code).toBe('VALIDATION');
    expect(err.fields?.currentPassword).toBeTruthy();
  });

  it('requires the admin password before resetting someone else (spec §30)', async () => {
    const admin = getSessionUser()!;
    const cashierId = 'cashier-1';
    const now = new Date().toISOString();
    ctx.db
      .prepare(
        `INSERT INTO "User" (id, username, passwordHash, fullName, phone, role, isActive, createdAt, updatedAt)
         VALUES (?,?,?,?,NULL,'CASHIER',1,?,?)`,
      )
      .run(cashierId, 'nok', hashPassword('old-pass'), 'Nok Cashier', now, now);

    const err = captureError(() =>
      resetPassword(
        {
          userId: cashierId,
          adminPassword: 'wrong-admin-password',
          newPassword: 'fresh-pass',
          confirmPassword: 'fresh-pass',
        },
        admin,
        ctx.db,
      ),
    );
    expect(err.code).toBe('VALIDATION');

    // With the correct admin password it goes through.
    resetPassword(
      {
        userId: cashierId,
        adminPassword: 'correct-horse',
        newPassword: 'fresh-pass',
        confirmPassword: 'fresh-pass',
      },
      admin,
      ctx.db,
    );
    logout(ctx.db);
    await expect(login({ username: 'nok', password: 'fresh-pass' }, ctx.db)).resolves.toBeTruthy();
  });
});

describe('roles and permissions', () => {
  it('gives a cashier the till but not the books', () => {
    expect(roleHasPermission('CASHIER', 'pos.sell')).toBe(true);
    expect(roleHasPermission('CASHIER', 'sales.refund')).toBe(false);
    expect(roleHasPermission('CASHIER', 'reports.view')).toBe(false);
    expect(roleHasPermission('CASHIER', 'settings.manage')).toBe(false);
    expect(roleHasPermission('CASHIER', 'users.manage')).toBe(false);
  });

  it('gives a manager refunds and stock but not users or backups', () => {
    expect(roleHasPermission('MANAGER', 'sales.refund')).toBe(true);
    expect(roleHasPermission('MANAGER', 'inventory.adjust')).toBe(true);
    expect(roleHasPermission('MANAGER', 'reports.view')).toBe(true);
    expect(roleHasPermission('MANAGER', 'users.manage')).toBe(false);
    expect(roleHasPermission('MANAGER', 'backup.manage')).toBe(false);
    expect(roleHasPermission('MANAGER', 'settings.manage')).toBe(false);
  });

  it('gives an admin everything', () => {
    for (const permission of ROLE_PERMISSIONS.ADMIN) {
      expect(roleHasPermission('ADMIN', permission)).toBe(true);
    }
  });

  it('throws NOT_AUTHENTICATED when nobody is signed in', () => {
    setSessionUser(null);
    const err = captureError(() => requirePermission('pos.sell'));
    expect(err.code).toBe('NOT_AUTHENTICATED');
  });

  it('throws NOT_AUTHORIZED for a role that lacks the permission', () => {
    setSessionUser({ id: 'c1', username: 'nok', fullName: 'Nok', role: 'CASHIER' });
    const err = captureError(() => requirePermission('sales.refund'));
    expect(err.code).toBe('NOT_AUTHORIZED');
    expect(err.message).toMatch(/permission to refund sales/i);
    expect(sessionHasPermission('sales.refund')).toBe(false);
    expect(sessionHasPermission('pos.sell')).toBe(true);
  });
});

/** Runs `fn`, expecting it to throw an AppError, and returns it. */
function captureError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('Expected the call to throw an AppError, but it succeeded');
}

/** login() is async (it may delay after repeated failures), so it needs this. */
async function captureAsyncError(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('Expected the call to reject with an AppError, but it resolved');
}
