/**
 * Staff accounts (spec §8, §29, §30, §31).
 *
 * Most of this file is about one thing: **a shop must not be able to lock itself
 * out of its own administration.** There is no support line, no reset email and
 * no way in from outside, so if the last administrator is deactivated, demoted or
 * deleted then settings, backups, user management and the audit log are gone for
 * good on that installation.
 *
 * Every route to that state is tested here, from both directions — that the
 * refusal happens, and that it stops happening the moment a second administrator
 * exists (a guard that never lets go would be its own kind of broken).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup, login, logout, verifyPassword } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  activeAdminCount,
  isLastActiveAdmin,
} from '../electron/services/user.service';
import { resetPassword } from '../electron/services/auth.service';
import { createProduct } from '../electron/services/product.service';
import { createSale } from '../electron/services/sale.service';
import { AppError } from '../shared/errors';
import type { CreateUserInput, FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let admin: SessionUser;

const SETUP: FirstRunSetupInput = {
  shopName: 'Green Mobile',
  shopAddress: undefined,
  shopPhone: undefined,
  shopEmail: undefined,
  fullName: 'Owner',
  username: 'owner',
  password: 'owner-pass',
  confirmPassword: 'owner-pass',
  currency: 'THB',
  taxEnabled: false,
  taxRate: 0,
  taxMode: 'EXCLUSIVE',
  receiptWidth: '80mm',
  backupLocation: undefined,
};

beforeEach(() => {
  ctx = createTestDatabase();
  setSessionUser(null);
  completeFirstRunSetup(SETUP, ctx.db);
  admin = getSessionUser()!;
});

afterEach(() => {
  ctx.cleanup();
  setSessionUser(null);
});

function newUser(overrides: Partial<CreateUserInput> = {}) {
  const input: CreateUserInput = {
    username: overrides.username ?? 'nok',
    fullName: overrides.fullName ?? 'Nok Cashier',
    phone: overrides.phone,
    role: overrides.role ?? 'CASHIER',
    password: overrides.password ?? 'cashier-pass',
    confirmPassword: overrides.password ?? 'cashier-pass',
  };
  return createUser(input, admin, ctx.db);
}

/** A sale rung up by `who`, so their account acquires trading history. */
function sellSomethingAs(who: SessionUser) {
  const product = createProduct(
    {
      sku: `CBL-${who.id.slice(0, 6)}`,
      name: 'USB-C Cable',
      purchasePrice: 80000,
      sellingPrice: 100000,
      taxRate: 0,
      taxRateOverride: false,
      minimumStock: 0,
      unit: 'pcs',
      isSerialized: false,
      warrantyMonths: 0,
      initialStock: 5,
    },
    admin,
    ctx.db,
  );
  return createSale(
    {
      items: [{ productId: product.id, quantity: 1 }],
      discountAmount: 0,
      payments: [{ amount: 100000, paymentMethod: 'CASH' }],
    },
    who,
    ctx.db,
  );
}

// -----------------------------------------------------------------------------
// Creating
// -----------------------------------------------------------------------------

describe('creating an account', () => {
  it('creates an active account with a hashed password', () => {
    const created = newUser({ username: 'nok', role: 'CASHIER' });

    expect(created.username).toBe('nok');
    expect(created.role).toBe('CASHIER');
    expect(created.isActive).toBe(1);
    expect(created.lastLoginAt).toBeNull();

    const stored = ctx.db
      .prepare(`SELECT passwordHash FROM "User" WHERE username = 'nok'`)
      .get() as { passwordHash: string };
    expect(stored.passwordHash).not.toContain('cashier-pass');
    expect(verifyPassword('cashier-pass', stored.passwordHash)).toBe(true);
  });

  it('lets the new account sign in immediately', async () => {
    newUser({ username: 'nok', password: 'cashier-pass' });
    logout(ctx.db);

    const status = await login({ username: 'nok', password: 'cashier-pass' }, ctx.db);
    expect(status.user?.username).toBe('nok');
    expect(status.user?.role).toBe('CASHIER');
    // And the role's permissions come with it.
    expect(status.permissions).toContain('pos.sell');
    expect(status.permissions).not.toContain('backup.manage');
  });

  it('refuses a username that is already taken, whatever the case', () => {
    newUser({ username: 'nok' });
    expect(() => newUser({ username: 'NOK' })).toThrowError(/already taken/i);
    // The failed attempt left nothing behind.
    expect(listUsers({ includeInactive: true }, ctx.db)).toHaveLength(2);
  });

  it('never writes the password into the audit log', () => {
    newUser({ username: 'nok', password: 'very-secret-password' });
    const rows = ctx.db.prepare(`SELECT oldValues, newValues, summary FROM "AuditLog"`).all();
    expect(JSON.stringify(rows)).not.toContain('very-secret-password');
  });

  it('records who created the account', () => {
    const created = newUser({ username: 'nok' });
    const row = ctx.db
      .prepare(`SELECT createdBy FROM "User" WHERE id = ?`)
      .get(created.id) as { createdBy: string };
    expect(row.createdBy).toBe(admin.id);
  });
});

// -----------------------------------------------------------------------------
// The lock-out guard
// -----------------------------------------------------------------------------

describe('the shop cannot lock itself out', () => {
  it('knows which account is the last active administrator', () => {
    expect(activeAdminCount(ctx.db)).toBe(1);
    expect(isLastActiveAdmin(admin.id, ctx.db)).toBe(true);

    const cashier = newUser({ username: 'nok', role: 'CASHIER' });
    // A cashier is never load-bearing, and adding one changes nothing.
    expect(isLastActiveAdmin(cashier.id, ctx.db)).toBe(false);
    expect(isLastActiveAdmin(admin.id, ctx.db)).toBe(true);

    newUser({ username: 'boss', role: 'ADMIN' });
    expect(activeAdminCount(ctx.db)).toBe(2);
    // With two, neither is the last.
    expect(isLastActiveAdmin(admin.id, ctx.db)).toBe(false);
  });

  it('refuses to demote the last administrator', () => {
    const before = getUser(admin.id, ctx.db);
    expect(() =>
      updateUser(
        { id: admin.id, fullName: before.fullName, phone: undefined, role: 'MANAGER', isActive: true },
        admin,
        ctx.db,
      ),
    ).toThrowError(/only administrator/i);

    // Still an administrator.
    expect(getUser(admin.id, ctx.db).role).toBe('ADMIN');
  });

  it('refuses to deactivate the last administrator', () => {
    const other = newUser({ username: 'boss', role: 'ADMIN' });
    // Deactivate the second one, leaving the first as the last.
    updateUser(
      { id: other.id, fullName: other.fullName, phone: undefined, role: 'ADMIN', isActive: false },
      admin,
      ctx.db,
    );
    expect(activeAdminCount(ctx.db)).toBe(1);

    // Now the first cannot be deactivated either — by anyone.
    setSessionUser({ ...admin, id: other.id, username: 'boss' });
    expect(() =>
      updateUser(
        { id: admin.id, fullName: 'Owner', phone: undefined, role: 'ADMIN', isActive: false },
        getSessionUser()!,
        ctx.db,
      ),
    ).toThrowError(/only administrator/i);
    expect(getUser(admin.id, ctx.db).isActive).toBe(1);
  });

  it('refuses to delete the last administrator', () => {
    const cashier = newUser({ username: 'nok', role: 'CASHIER' });
    setSessionUser({ ...admin, id: cashier.id });

    expect(() => deleteUser(admin.id, getSessionUser()!, ctx.db)).toThrowError(
      /only administrator/i,
    );
    expect(getUser(admin.id, ctx.db).isActive).toBe(1);
  });

  it('allows all of it once a second administrator exists', () => {
    // The guard must let go, or the first administrator is trapped forever.
    newUser({ username: 'boss', role: 'ADMIN', password: 'boss-pass' });
    expect(activeAdminCount(ctx.db)).toBe(2);

    const demoted = updateUser(
      { id: admin.id, fullName: 'Owner', phone: undefined, role: 'MANAGER', isActive: true },
      admin,
      ctx.db,
    );
    expect(demoted.role).toBe('MANAGER');
    expect(activeAdminCount(ctx.db)).toBe(1);
  });

  it('counts only administrators who can actually sign in', () => {
    // A deactivated administrator is not a way back in, so it must not count.
    const other = newUser({ username: 'boss', role: 'ADMIN' });
    ctx.db.prepare(`UPDATE "User" SET isActive = 0 WHERE id = ?`).run(other.id);

    expect(activeAdminCount(ctx.db)).toBe(1);
    expect(isLastActiveAdmin(admin.id, ctx.db)).toBe(true);
  });

  it('refuses to deactivate or remove the account you are signed in with', () => {
    // Two admins, so the last-admin rule is not what is doing the work here.
    newUser({ username: 'boss', role: 'ADMIN' });

    expect(() =>
      updateUser(
        { id: admin.id, fullName: 'Owner', phone: undefined, role: 'ADMIN', isActive: false },
        admin,
        ctx.db,
      ),
    ).toThrowError(/signed in with/i);

    expect(() => deleteUser(admin.id, admin, ctx.db)).toThrowError(/signed in with/i);
  });
});

// -----------------------------------------------------------------------------
// Editing
// -----------------------------------------------------------------------------

describe('editing an account', () => {
  it('changes name, phone and role', () => {
    const cashier = newUser({ username: 'nok' });
    const updated = updateUser(
      { id: cashier.id, fullName: 'Nok Manager', phone: '0812345678', role: 'MANAGER', isActive: true },
      admin,
      ctx.db,
    );

    expect(updated.fullName).toBe('Nok Manager');
    expect(updated.phone).toBe('0812345678');
    expect(updated.role).toBe('MANAGER');
  });

  it('does not touch the password', () => {
    const cashier = newUser({ username: 'nok', password: 'cashier-pass' });
    const before = ctx.db
      .prepare(`SELECT passwordHash FROM "User" WHERE id = ?`)
      .get(cashier.id) as { passwordHash: string };

    updateUser(
      { id: cashier.id, fullName: 'Renamed', phone: undefined, role: 'CASHIER', isActive: true },
      admin,
      ctx.db,
    );

    const after = ctx.db
      .prepare(`SELECT passwordHash FROM "User" WHERE id = ?`)
      .get(cashier.id) as { passwordHash: string };
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('stops a deactivated account from signing in', async () => {
    newUser({ username: 'nok', password: 'cashier-pass' });
    const cashier = getUser(
      listUsers({}, ctx.db).find((u) => u.username === 'nok')!.id,
      ctx.db,
    );

    updateUser(
      { id: cashier.id, fullName: cashier.fullName, phone: undefined, role: 'CASHIER', isActive: false },
      admin,
      ctx.db,
    );
    logout(ctx.db);

    await expect(login({ username: 'nok', password: 'cashier-pass' }, ctx.db)).rejects.toThrowError(
      /deactivated/i,
    );
  });

  it('lets a reactivated account back in', async () => {
    const cashier = newUser({ username: 'nok', password: 'cashier-pass' });
    updateUser(
      { id: cashier.id, fullName: cashier.fullName, phone: undefined, role: 'CASHIER', isActive: false },
      admin,
      ctx.db,
    );
    updateUser(
      { id: cashier.id, fullName: cashier.fullName, phone: undefined, role: 'CASHIER', isActive: true },
      admin,
      ctx.db,
    );

    logout(ctx.db);
    await expect(
      login({ username: 'nok', password: 'cashier-pass' }, ctx.db),
    ).resolves.toBeTruthy();
  });

  it('records what changed in the audit log', () => {
    const cashier = newUser({ username: 'nok' });
    updateUser(
      { id: cashier.id, fullName: 'Nok', phone: undefined, role: 'MANAGER', isActive: true },
      admin,
      ctx.db,
    );

    const entry = ctx.db
      .prepare(
        `SELECT summary FROM "AuditLog"
          WHERE entityName = 'User' AND action = 'UPDATE' ORDER BY createdAt DESC`,
      )
      .get() as { summary: string };
    expect(entry.summary).toContain('role to manager');
  });

  it('refuses an unknown role', () => {
    const cashier = newUser({ username: 'nok' });
    expect(() =>
      updateUser(
        // Bypassing the Zod boundary, which is what the service guard is for.
        { id: cashier.id, fullName: 'Nok', phone: undefined, role: 'SUPERUSER', isActive: true } as never,
        admin,
        ctx.db,
      ),
    ).toThrowError(/not a valid role/i);
  });
});

// -----------------------------------------------------------------------------
// Removing
// -----------------------------------------------------------------------------

describe('removing an account', () => {
  it('deletes an account that has done nothing', () => {
    const cashier = newUser({ username: 'nok' });
    const result = deleteUser(cashier.id, admin, ctx.db);

    expect(result.deactivated).toBe(false);
    expect(listUsers({ includeInactive: true }, ctx.db).map((u) => u.username)).toEqual(['owner']);
  });

  it('deactivates instead when the account is named on a sale', () => {
    const cashier = newUser({ username: 'nok' });
    const cashierSession: SessionUser = {
      id: cashier.id,
      username: cashier.username,
      fullName: cashier.fullName,
      role: 'CASHIER',
    };
    sellSomethingAs(cashierSession);

    const result = deleteUser(cashier.id, admin, ctx.db);
    expect(result.deactivated).toBe(true);

    // The account survives, deactivated, and the sale still names them.
    const still = getUser(cashier.id, ctx.db);
    expect(still.isActive).toBe(0);
    expect(still.salesCount).toBe(1);
  });

  it('deactivates an account that has only ever signed in', async () => {
    // Logging in writes an audit row, which is a record worth keeping attributed.
    newUser({ username: 'nok', password: 'cashier-pass' });
    logout(ctx.db);
    await login({ username: 'nok', password: 'cashier-pass' }, ctx.db);
    setSessionUser(admin);

    const cashier = listUsers({}, ctx.db).find((u) => u.username === 'nok')!;
    expect(deleteUser(cashier.id, admin, ctx.db).deactivated).toBe(true);
  });

  it('deactivates rather than hitting a foreign key, whatever names the user', () => {
    // The reference check is derived from the schema, so a column this test does
    // not know about is still covered. Product.createdBy is one the first,
    // hand-written version of that check missed.
    const cashier = newUser({ username: 'nok' });
    const cashierSession: SessionUser = {
      id: cashier.id,
      username: cashier.username,
      fullName: cashier.fullName,
      role: 'CASHIER',
    };
    createProduct(
      {
        sku: 'MADE-BY-NOK',
        name: 'Thing',
        purchasePrice: 100,
        sellingPrice: 200,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        initialStock: 0,
      },
      cashierSession,
      ctx.db,
    );

    // Not a sale, not a service job, not an audit row — but still referenced.
    const result = deleteUser(cashier.id, admin, ctx.db);
    expect(result.deactivated).toBe(true);
    expect(getUser(cashier.id, ctx.db).isActive).toBe(0);
  });

  it('records the removal either way', () => {
    const cashier = newUser({ username: 'nok' });
    deleteUser(cashier.id, admin, ctx.db);

    const entry = ctx.db
      .prepare(`SELECT action, summary FROM "AuditLog" WHERE entityName = 'User' AND action = 'DELETE'`)
      .get() as { action: string; summary: string };
    expect(entry.summary).toContain('nok');
  });
});

// -----------------------------------------------------------------------------
// Password reset (spec §30)
// -----------------------------------------------------------------------------

describe('resetting a password', () => {
  it('requires the administrator’s own password', () => {
    const cashier = newUser({ username: 'nok', password: 'old-pass' });

    expect(() =>
      resetPassword(
        {
          userId: cashier.id,
          adminPassword: 'not-my-password',
          newPassword: 'new-pass',
          confirmPassword: 'new-pass',
        },
        admin,
        ctx.db,
      ),
    ).toThrowError(/password is not correct/i);
  });

  it('sets the new password once confirmed', async () => {
    const cashier = newUser({ username: 'nok', password: 'old-pass' });

    resetPassword(
      {
        userId: cashier.id,
        adminPassword: 'owner-pass',
        newPassword: 'brand-new-pass',
        confirmPassword: 'brand-new-pass',
      },
      admin,
      ctx.db,
    );

    logout(ctx.db);
    await expect(
      login({ username: 'nok', password: 'brand-new-pass' }, ctx.db),
    ).resolves.toBeTruthy();
    logout(ctx.db);
    await expect(login({ username: 'nok', password: 'old-pass' }, ctx.db)).rejects.toThrow();
  });

  it('leaves the administrator’s own password alone', () => {
    const cashier = newUser({ username: 'nok' });
    resetPassword(
      {
        userId: cashier.id,
        adminPassword: 'owner-pass',
        newPassword: 'their-new-pass',
        confirmPassword: 'their-new-pass',
      },
      admin,
      ctx.db,
    );

    const own = ctx.db
      .prepare(`SELECT passwordHash FROM "User" WHERE id = ?`)
      .get(admin.id) as { passwordHash: string };
    expect(verifyPassword('owner-pass', own.passwordHash)).toBe(true);
  });

  it('records the reset against the administrator, without the password', () => {
    const cashier = newUser({ username: 'nok' });
    resetPassword(
      {
        userId: cashier.id,
        adminPassword: 'owner-pass',
        newPassword: 'secret-new-pass',
        confirmPassword: 'secret-new-pass',
      },
      admin,
      ctx.db,
    );

    const entry = ctx.db
      .prepare(`SELECT userId, entityId, summary FROM "AuditLog" WHERE action = 'RESET_PASSWORD'`)
      .get() as { userId: string; entityId: string; summary: string };

    expect(entry.userId).toBe(admin.id);
    expect(entry.entityId).toBe(cashier.id);
    expect(JSON.stringify(entry)).not.toContain('secret-new-pass');
  });

  it('refuses to reset a password for an account that does not exist', () => {
    expect(() =>
      resetPassword(
        {
          userId: 'no-such-user',
          adminPassword: 'owner-pass',
          newPassword: 'whatever-pass',
          confirmPassword: 'whatever-pass',
        },
        admin,
        ctx.db,
      ),
    ).toThrowError(AppError);
  });
});

// -----------------------------------------------------------------------------
// Listing
// -----------------------------------------------------------------------------

describe('the staff list', () => {
  it('hides deactivated accounts unless asked for them', () => {
    const cashier = newUser({ username: 'nok' });
    updateUser(
      { id: cashier.id, fullName: 'Nok', phone: undefined, role: 'CASHIER', isActive: false },
      admin,
      ctx.db,
    );

    expect(listUsers({}, ctx.db).map((u) => u.username)).toEqual(['owner']);
    expect(listUsers({ includeInactive: true }, ctx.db)).toHaveLength(2);
  });

  it('puts active accounts first, then administrators, then by name', () => {
    newUser({ username: 'zoe', role: 'CASHIER', fullName: 'Zoe' });
    newUser({ username: 'amy', role: 'CASHIER', fullName: 'Amy' });
    newUser({ username: 'boss', role: 'ADMIN', fullName: 'Boss' });
    const gone = newUser({ username: 'gone', role: 'MANAGER', fullName: 'Gone' });
    updateUser(
      { id: gone.id, fullName: 'Gone', phone: undefined, role: 'MANAGER', isActive: false },
      admin,
      ctx.db,
    );

    expect(listUsers({ includeInactive: true }, ctx.db).map((u) => u.username)).toEqual([
      // Administrators first, alphabetically...
      'boss',
      'owner',
      // ...then cashiers...
      'amy',
      'zoe',
      // ...and the deactivated manager last, whatever its role.
      'gone',
    ]);
  });

  it('counts what each account has done', () => {
    const cashier = newUser({ username: 'nok' });
    sellSomethingAs({
      id: cashier.id,
      username: cashier.username,
      fullName: cashier.fullName,
      role: 'CASHIER',
    });

    const row = listUsers({}, ctx.db).find((u) => u.username === 'nok')!;
    expect(row.salesCount).toBe(1);
    expect(row.serviceCount).toBe(0);
  });

  it('never includes a password hash in the list', () => {
    newUser({ username: 'nok' });
    const rows = listUsers({ includeInactive: true }, ctx.db);
    // The hash must not cross the bridge, even though the renderer would ignore it.
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('passwordHash');
    }
    expect(JSON.stringify(rows)).not.toContain('$2');
  });
});
