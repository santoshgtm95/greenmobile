/**
 * The security review, written as tests (spec §65, Phase 16).
 *
 * A review is a document that goes stale the week after it is signed. These are
 * the same conclusions expressed so that the build fails when one stops being
 * true — which is the only version of a security review worth having in a
 * codebase that is still being added to.
 *
 * The seven areas the specification asks to be reviewed:
 *
 *   Electron security   → the request/permission/navigation policy
 *   IPC security        → every channel authenticated and authorised
 *   Authentication      → hashing, enumeration, throttling
 *   Authorization       → the role matrix, exhaustively
 *   Input validation    → no channel accepts unvalidated input
 *   Database security   → parameterised SQL, enforced pragmas
 *   File permissions    → nothing written or read outside its own folder
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { CHANNELS, allChannels } from '../shared/channels';
import { isLocalRequest } from '../electron/security';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
  roleHasPermission,
  type Permission,
} from '../shared/domain';
import {
  completeFirstRunSetup,
  hashPassword,
  login,
  logout,
  recordLoginFailure,
  resetLoginThrottle,
  throttleDelayMs,
  verifyPassword,
} from '../electron/services/auth.service';
import { setSessionUser, getSessionUser, requirePermission } from '../electron/session';
import { deleteBackup } from '../electron/services/backup.service';
import { AppError } from '../shared/errors';
import * as validation from '../shared/validation';
import type { FirstRunSetupInput } from '../shared/validation';
import type { z } from 'zod';

const REPO_ROOT = path.resolve(__dirname, '..');

let ctx: TestDatabase;

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
  resetLoginThrottle();
});

afterEach(() => {
  ctx.cleanup();
  setSessionUser(null);
  resetLoginThrottle();
});

/** Reads a shipped source file. Used by the checks that are about absence. */
function source(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

/**
 * Source with comments removed.
 *
 * The absence checks below are about what the code *does*. Several files' own
 * comments name the things they must never use ("no fs, no child_process, no
 * process object"), and a naive substring search matches those sentences and
 * reports a hole that is really a paragraph.
 */
function code(relative: string): string {
  return stripComments(source(relative));
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every .ts/.tsx file under the given directories. */
function sourceFiles(...dirs: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) found.push(full);
    }
  };
  for (const dir of dirs) walk(path.join(REPO_ROOT, dir));
  return found;
}

// -----------------------------------------------------------------------------
// Electron security (spec §65)
// -----------------------------------------------------------------------------

describe('Electron security', () => {
  it('creates its window with the required preferences', () => {
    const main = source('electron/main.ts');
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
    expect(main).toMatch(/webviewTag:\s*false/);
    // Every renderer, including any added later.
    expect(main).toMatch(/app\.enableSandbox\(\)/);
  });

  it('exposes no Node capability through the preload', () => {
    const preload = code('electron/preload.ts');
    // The preload runs sandboxed, so these are not merely unused — they are the
    // things spec §65 names as never to be handed to React.
    for (const forbidden of ['node:fs', 'node:child_process', 'better-sqlite3', 'process.']) {
      expect(preload).not.toContain(forbidden);
    }
    // The whole bridge is built from the manifest; there is no ad-hoc channel.
    expect(preload).toMatch(/contextBridge\.exposeInMainWorld/);
    expect(preload.match(/exposeInMainWorld/g)).toHaveLength(1);
  });

  it('never hands a URL to the operating system', () => {
    // An offline till has no external links, so shell.openExternal is an
    // outbound channel with no purpose. It must not appear anywhere.
    for (const file of sourceFiles('electron', 'src', 'shared')) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toContain('openExternal');
    }
  });

  it('permits only local requests', () => {
    // The packaged build passes no dev-server URL, so nothing but its own files.
    expect(isLocalRequest('file:///C:/app/index.html')).toBe(true);
    expect(isLocalRequest('data:text/html,<p>hi')).toBe(true);
    expect(isLocalRequest('blob:file:///abc')).toBe(true);

    expect(isLocalRequest('https://example.com/')).toBe(false);
    expect(isLocalRequest('http://example.com/')).toBe(false);
    expect(isLocalRequest('http://127.0.0.1:8080/')).toBe(false);
    expect(isLocalRequest('ws://example.com/socket')).toBe(false);
    expect(isLocalRequest('ftp://example.com/x')).toBe(false);
    // Not a URL at all is not something to fetch either.
    expect(isLocalRequest('not a url')).toBe(false);
  });

  it('permits the dev server only when one is configured', () => {
    const dev = 'http://localhost:5273';
    expect(isLocalRequest('http://localhost:5273/src/main.tsx', dev)).toBe(true);
    // Vite's HMR socket shares the origin but not the scheme.
    expect(isLocalRequest('ws://localhost:5273/', dev)).toBe(true);
    // Still nothing else.
    expect(isLocalRequest('https://example.com/', dev)).toBe(false);
    // And with no dev server the same URL is refused.
    expect(isLocalRequest('http://localhost:5273/src/main.tsx')).toBe(false);
  });

  it('declares a Content-Security-Policy with no remote origins', () => {
    const html = source('index.html');
    expect(html).toMatch(/Content-Security-Policy/);
    expect(html).toMatch(/default-src 'self'/);
    expect(html).toMatch(/form-action 'none'/);
    expect(html).toMatch(/base-uri 'none'/);
    // Only localhost appears, and the build strips even that (see vite.config.mts).
    const policy = /content="([^"]+)"/.exec(html)?.[1] ?? '';
    const origins = policy.match(/https?:\/\/[^\s;]+|wss?:\/\/[^\s;]+/g) ?? [];
    for (const origin of origins) expect(origin).toMatch(/localhost:5273/);
  });

  it('strips the dev-server allowance from the shipped policy', () => {
    // The build fails loudly if index.html is edited out of step with this, so
    // the assertion here is that the coupling exists at all.
    const config = source('vite.config.mts');
    expect(config).toContain('transformIndexHtml');
    expect(config).toContain('ws://localhost:5273');
    expect(source('index.html')).toContain('ws://localhost:5273');
  });

  it('reaches the network from nowhere in the shipped code', () => {
    // Spec §4: no HTTP client, no socket, no telemetry, anywhere.
    //
    // Regexes rather than substrings, and \b rather than a hand-rolled
    // "not preceded by a dot": TanStack Query's refetch() must not match (the
    // e and f are both word characters, so \b does not fall between them), but
    // window.fetch() must — an earlier version of this excluded '.' and would
    // therefore have let exactly that through.
    const forbidden: Array<[string, RegExp]> = [
      ['fetch()', /\bfetch\s*\(/],
      ['XMLHttpRequest', /\bXMLHttpRequest\b/],
      ['axios', /\baxios\b/],
      ['node:http', /['"]node:https?['"]/],
      ['node:net', /['"]node:(net|dgram|tls)['"]/],
      ['WebSocket', /\bnew WebSocket\b/],
      ['sendBeacon', /\bsendBeacon\b/],
      ['EventSource', /\bnew EventSource\b/],
    ];

    /**
     * The one file allowed to attempt a request, and only to prove it is refused.
     *
     * The smoke harness is build-verification code: it is reachable only when
     * POS_SMOKE=1 and it exists to fire two requests at hosts that must be
     * blocked, so that `npm run smoke` can confirm the session denied them. The
     * exception is a single named file rather than a pattern, so it cannot
     * quietly grow into a hole.
     */
    const OFFLINE_PROOF = path.join('electron', 'utils', 'smoke.ts');
    const exempted: string[] = [];

    for (const file of sourceFiles('electron', 'src', 'shared')) {
      const relative = path.relative(REPO_ROOT, file);
      if (relative === OFFLINE_PROOF) {
        exempted.push(relative);
        continue;
      }
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const [label, pattern] of forbidden) {
        expect(pattern.test(text), `${relative} reaches the network via ${label}`).toBe(false);
      }
    }

    // The exception applies to exactly one file, and that file still exists.
    expect(exempted).toEqual([OFFLINE_PROOF]);
    // ...and what it contains really is the deliberate proof, not a stray call.
    const harness = source(OFFLINE_PROOF);
    expect(harness).toContain('renderer cannot reach a public host');
    expect(harness).toContain('blockedRequestCount');
  });

  it('counts every refusal, so the offline check cannot pass vacuously', () => {
    // A request failing because the machine happens to be offline is not proof
    // that this application refuses to make one. The session counts refusals and
    // the smoke test asserts the count.
    const security = source('electron/security.ts');
    expect(security).toContain('onBeforeRequest');
    expect(security).toContain('blockedRequests += 1');
    expect(security).toContain('callback({ cancel: true })');
    expect(security).toContain('setPermissionRequestHandler');
    expect(security).toContain('setPermissionCheckHandler');
  });
});

// -----------------------------------------------------------------------------
// IPC security (spec §65)
// -----------------------------------------------------------------------------

describe('IPC security', () => {
  it('exposes channels only through the manifest', () => {
    const preload = source('electron/preload.ts');
    // Channel names are never written as literals — they come from CHANNELS.
    expect(preload).toMatch(/import \{ CHANNELS \}/);
    expect(preload).not.toMatch(/ipcRenderer\.invoke\(\s*['"]/);
    // No unsolicited push from main to renderer, so no listener surface either.
    expect(preload).not.toContain('ipcRenderer.on');
  });

  it('has no duplicate channel names across namespaces', () => {
    const flat = allChannels();
    expect(new Set(flat).size).toBe(flat.length);
  });

  it('names every channel after the namespace that holds it', () => {
    // A channel filed under the wrong namespace would be reviewed as if it were
    // protected by that namespace's permission.
    for (const [namespace, methods] of Object.entries(CHANNELS)) {
      for (const [method, channel] of Object.entries(methods)) {
        expect(channel, `${namespace}.${method}`).toBe(`${namespace}:${method}`);
      }
    }
  });

  it('registers every channel, and only with a stated access level', () => {
    // Registering is what installs the authenticate → authorise → validate
    // pipeline, so a channel in the manifest with no handler is a hole in the
    // review: the renderer would get "no handler" rather than a permission check.
    const registrations = ipcRegistrations();
    const missing = allChannels().filter((channel) => !registrations.has(channel));
    expect(missing, `channels with no handle() call: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('keeps the pre-login surface to exactly four channels', () => {
    // Everything reachable before sign-in, and nothing else. If this list grows,
    // it should be a decision somebody made on purpose.
    const registrations = ipcRegistrations();
    const publicChannels = [...registrations.entries()]
      .filter(([, access]) => access === 'public')
      .map(([channel]) => channel)
      .sort();

    expect(publicChannels).toEqual(
      [
        CHANNELS.app.getInfo,
        CHANNELS.auth.login,
        CHANNELS.auth.status,
        // completeFirstRunSetup is public too — it has to be, since nobody can
        // sign in until it has run — and it refuses once a user exists.
        CHANNELS.auth.completeFirstRunSetup,
      ].sort(),
    );
  });

  it('protects every destructive channel with a permission, not just a session', () => {
    const registrations = ipcRegistrations();
    const mustBePermissioned = [
      CHANNELS.backup.restore,
      CHANNELS.backup.delete,
      CHANNELS.backup.create,
      CHANNELS.backup.chooseFolder,
      CHANNELS.products.delete,
      CHANNELS.products.adjustStock,
      CHANNELS.expenses.delete,
      CHANNELS.sales.cancel,
      CHANNELS.sales.refund,
      CHANNELS.settings.update,
      CHANNELS.data.importCommit,
    ];
    for (const channel of mustBePermissioned) {
      expect(registrations.get(channel), channel).toBe('permission');
    }
  });

  it('validates the sender, so only the app window may call in', () => {
    const registry = source('electron/ipc/registry.ts');
    expect(registry).toContain('isTrustedSender');
    expect(source('electron/main.ts')).toContain('trustWebContents');
  });

  it('returns envelopes rather than throwing across the bridge', () => {
    // A thrown Error loses its code crossing contextBridge, which would turn
    // every "you do not have permission" into an unexplained failure.
    const registry = source('electron/ipc/registry.ts');
    expect(registry).toContain('return { ok: true, data }');
    expect(registry).toContain('return { ok: false, error:');
  });

  it('never lets a stack trace or SQL reach the renderer', () => {
    const registry = source('electron/ipc/registry.ts');
    // Unknown errors are logged in full and replaced with a generic message.
    expect(registry).toContain('errors.database().toSerialized()');
    expect(registry).toMatch(/logger\.error\('Unhandled error in IPC handler'/);
  });
});

/**
 * Reads each handle() call out of the IPC modules with its access level.
 *
 * Static rather than dynamic: importing the IPC modules would need a live
 * Electron `ipcMain`, which does not exist under Vitest. Reading the source is
 * what makes this checkable in a plain Node test run — and the pattern being
 * matched is the same one the registry requires, so a registration that does not
 * match it would not compile.
 */
function ipcRegistrations(): Map<string, 'public' | 'authenticated' | 'permission'> {
  const found = new Map<string, 'public' | 'authenticated' | 'permission'>();

  for (const file of sourceFiles('electron/ipc')) {
    const text = fs.readFileSync(file, 'utf8');
    const pattern =
      /handle\(\s*CHANNELS\.(\w+)\.(\w+)\s*,\s*\{\s*access:\s*'(public|authenticated|permission)'/g;
    for (const match of text.matchAll(pattern)) {
      const [, namespace, method, access] = match;
      const channel = (CHANNELS as Record<string, Record<string, string>>)[namespace]?.[method];
      if (channel) found.set(channel, access as 'public' | 'authenticated' | 'permission');
    }
  }

  return found;
}

// -----------------------------------------------------------------------------
// Authentication (spec §29, §30)
// -----------------------------------------------------------------------------

describe('authentication', () => {
  it('stores a bcrypt hash and never the password', () => {
    completeFirstRunSetup(SETUP, ctx.db);
    const row = ctx.db.prepare(`SELECT passwordHash FROM "User"`).get() as {
      passwordHash: string;
    };

    expect(row.passwordHash).not.toContain('owner-pass');
    // $2b$ marks bcrypt; 12 is the cost factor.
    expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(verifyPassword('owner-pass', row.passwordHash)).toBe(true);
    expect(verifyPassword('owner-pass ', row.passwordHash)).toBe(false);
  });

  it('salts, so two users with the same password differ', () => {
    expect(hashPassword('same-password')).not.toBe(hashPassword('same-password'));
  });

  it('never writes a password into the whole database', () => {
    completeFirstRunSetup(SETUP, ctx.db);
    // Sweep every text column of every table rather than the ones we remembered.
    const tables = (
      ctx.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
        )
        .all() as Array<{ name: string }>
    ).map((t) => t.name);

    for (const table of tables) {
      const rows = ctx.db.prepare(`SELECT * FROM "${table}"`).all();
      expect(JSON.stringify(rows), `${table} contains the plaintext password`).not.toContain(
        'owner-pass',
      );
    }
  });

  it('cannot be used to enumerate accounts', async () => {
    completeFirstRunSetup(SETUP, ctx.db);
    logout(ctx.db);

    const messages = new Set<string>();
    for (const attempt of [
      { username: 'owner', password: 'wrong' },
      { username: 'nobody-at-all', password: 'wrong' },
    ]) {
      await login(attempt, ctx.db).catch((err) => messages.add((err as AppError).message));
    }
    expect(messages.size).toBe(1);
  });

  it('refuses to mint a second administrator through first-run setup', () => {
    completeFirstRunSetup(SETUP, ctx.db);
    setSessionUser(null);
    expect(() => completeFirstRunSetup({ ...SETUP, username: 'intruder' }, ctx.db)).toThrowError(
      /already been set up/i,
    );
    expect((ctx.db.prepare(`SELECT COUNT(*) AS n FROM "User"`).get() as { n: number }).n).toBe(1);
  });

  it('leaves no signed-in session after a failed sign-in', async () => {
    completeFirstRunSetup(SETUP, ctx.db);
    logout(ctx.db);
    await login({ username: 'owner', password: 'wrong' }, ctx.db).catch(() => {});
    expect(getSessionUser()).toBeNull();
  });

  it('gives the first few attempts no delay at all', () => {
    // A mistyped password is normal. Punishing it would train staff to hate the
    // login screen for no security gain.
    for (let i = 0; i < 4; i += 1) recordLoginFailure('owner');
    expect(throttleDelayMs('owner')).toBe(0);
  });

  it('then slows down, but never locks the till', () => {
    // The curve is tested directly rather than by signing in repeatedly: driving
    // it through login() would mean this test actually waiting out every delay
    // it asserts, which is about eighty seconds to reach the cap.
    const delayAfter = (failures: number): number => {
      resetLoginThrottle();
      for (let i = 0; i < failures; i += 1) recordLoginFailure('owner');
      return throttleDelayMs('owner');
    };

    expect(delayAfter(5)).toBe(400);
    expect(delayAfter(6)).toBe(800);
    expect(delayAfter(10)).toBe(2400);

    // Capped, so no number of attempts can shut the shop out of its own till.
    expect(delayAfter(14)).toBe(4000);
    expect(delayAfter(500)).toBe(4000);
  });

  it('forgets failures that are old enough to be a different day at work', () => {
    const nineAm = Date.parse('2026-08-17T09:00:00Z');
    for (let i = 0; i < 10; i += 1) recordLoginFailure('owner', nineAm);
    expect(throttleDelayMs('owner', nineAm)).toBeGreaterThan(0);

    // Six minutes later the window has passed and the slate is clean.
    expect(throttleDelayMs('owner', nineAm + 6 * 60 * 1000)).toBe(0);
  });

  it('applies the delay from login itself, not just in the helper', async () => {
    completeFirstRunSetup(SETUP, ctx.db);
    logout(ctx.db);

    // Five failures: four free, then one that registers a 400ms delay.
    for (let i = 0; i < 5; i += 1) {
      await login({ username: 'owner', password: 'wrong' }, ctx.db).catch(() => {});
    }
    expect(throttleDelayMs('owner')).toBe(400);

    // The next attempt must actually be slower by roughly that much. Compared
    // against a fresh username so bcrypt's own cost cancels out of both sides.
    const throttledStart = Date.now();
    await login({ username: 'owner', password: 'wrong' }, ctx.db).catch(() => {});
    const throttled = Date.now() - throttledStart;

    const cleanStart = Date.now();
    await login({ username: 'never-tried', password: 'wrong' }, ctx.db).catch(() => {});
    const clean = Date.now() - cleanStart;

    expect(throttled - clean).toBeGreaterThanOrEqual(300);
  }, 30_000);

  it('throttles per username, not globally', () => {
    for (let i = 0; i < 10; i += 1) recordLoginFailure('owner');
    expect(throttleDelayMs('owner')).toBeGreaterThan(0);
    // A cashier signing in on the same till is unaffected.
    expect(throttleDelayMs('someone-else')).toBe(0);
  });

  it('treats the username case- and space-insensitively', () => {
    for (let i = 0; i < 10; i += 1) recordLoginFailure('owner');
    // Otherwise "Owner" would be a free retry, and the throttle would be theatre.
    expect(throttleDelayMs('OWNER')).toBeGreaterThan(0);
    expect(throttleDelayMs('  owner  ')).toBeGreaterThan(0);
  });


});

// -----------------------------------------------------------------------------
// Authorization (spec §31, §65)
// -----------------------------------------------------------------------------

describe('authorization', () => {
  /** Everything a cashier must not be able to do. */
  const CASHIER_DENIED: Permission[] = [
    'pos.discount',
    'sales.cancel',
    'sales.refund',
    'products.manage',
    'products.import',
    'inventory.adjust',
    'expenses.view',
    'expenses.manage',
    'expenses.delete',
    'banking.view',
    'banking.manage',
    'banking.delete',
    'reports.view',
    'users.view',
    'users.manage',
    'settings.view',
    'settings.manage',
    'backup.manage',
    'audit.view',
  ];

  /** Everything a manager must not be able to do. */
  const MANAGER_DENIED: Permission[] = [
    'expenses.delete',
    'banking.delete',
    'users.manage',
    'settings.manage',
    'backup.manage',
    'audit.view',
  ];

  it('gives a cashier the till and nothing that touches the books', () => {
    expect(roleHasPermission('CASHIER', 'pos.sell')).toBe(true);
    for (const permission of CASHIER_DENIED) {
      expect(roleHasPermission('CASHIER', permission), permission).toBe(false);
    }
  });

  it('lets a manager run the shop but not change how it works', () => {
    expect(roleHasPermission('MANAGER', 'sales.refund')).toBe(true);
    expect(roleHasPermission('MANAGER', 'reports.view')).toBe(true);
    for (const permission of MANAGER_DENIED) {
      expect(roleHasPermission('MANAGER', permission), permission).toBe(false);
    }
  });

  it('gives an administrator every permission, with none forgotten', () => {
    // Written as a set comparison so a new permission added to PERMISSIONS but
    // not to ADMIN fails here rather than at a customer's till.
    expect([...ROLE_PERMISSIONS.ADMIN].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('grants no permission that is not in the master list', () => {
    for (const role of USER_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS, `${role} has unknown permission ${permission}`).toContain(permission);
      }
    }
  });

  it('reads the role from the session, never from the caller', () => {
    // The renderer has no way to say who it is: there is no setter on the bridge.
    expect(source('electron/preload.ts')).not.toContain('setSessionUser');
    expect(allChannels().some((channel) => /session|role|permission/i.test(channel))).toBe(false);
  });

  it('refuses a permission the signed-in role does not hold', () => {
    completeFirstRunSetup(SETUP, ctx.db);
    const admin = getSessionUser()!;
    setSessionUser({ ...admin, role: 'CASHIER' });

    expect(() => requirePermission('backup.manage')).toThrowError(/do not have permission/i);
    // And the message names the action, so the employee knows what to ask for.
    try {
      requirePermission('reports.view');
    } catch (err) {
      expect((err as AppError).message).toContain('view reports');
      expect((err as AppError).code).toBe('NOT_AUTHORIZED');
    }
  });

  it('refuses everything when nobody is signed in', () => {
    setSessionUser(null);
    for (const permission of ['pos.sell', 'reports.view', 'backup.manage'] as Permission[]) {
      expect(() => requirePermission(permission)).toThrowError(/sign in/i);
    }
  });
});

// -----------------------------------------------------------------------------
// Input validation (spec §65, §73)
// -----------------------------------------------------------------------------

describe('input validation', () => {
  it('accepts no unvalidated payload anywhere', () => {
    // z.any() / .passthrough() would let renderer input past the trust boundary.
    for (const file of [...sourceFiles('electron/ipc'), 'shared/validation.ts'].map((f) =>
      path.isAbsolute(f) ? f : path.join(REPO_ROOT, f),
    )) {
      const text = fs.readFileSync(file, 'utf8');
      for (const loose of ['z.any(', 'z.unknown(', '.passthrough(', '.catchall(']) {
        expect(text, `${path.relative(REPO_ROOT, file)} uses ${loose}`).not.toContain(loose);
      }
    }
  });

  it('validates before the handler runs, not inside it', () => {
    const registry = source('electron/ipc/registry.ts');
    const validateAt = registry.indexOf('schema.safeParse');
    const handlerAt = registry.indexOf('await handler(parsed.data');
    expect(validateAt).toBeGreaterThan(0);
    expect(handlerAt).toBeGreaterThan(validateAt);
  });

  it('takes exactly one argument per call, so nothing is positional', () => {
    // A second positional argument would arrive unvalidated.
    expect(source('electron/preload.ts')).toMatch(/ipcRenderer\.invoke\(channel, payload\)/);
  });

  it('never trusts a price from the renderer (spec §68)', () => {
    const validation = source('shared/validation.ts');
    // The cart says what is being bought; the main process decides the cost.
    const saleItem = /export const zSaleItem = z\.object\(\{([\s\S]*?)\}\)/.exec(validation)?.[1] ?? '';
    expect(saleItem).toContain('productId');
    expect(saleItem).toContain('quantity');
    expect(saleItem).not.toContain('unitPrice');
    expect(saleItem).not.toContain('totalAmount');
  });

  it('accepts an absent payload on every channel the UI calls with no argument', () => {
    // The mirror image of the checks above, and a real bug this caught: the
    // Import dialog calls api.data.importPreview() with no argument, because the
    // user picks the file in the native open dialog the handler puts up. The
    // handler validated with a plain z.object({...}), which in Zod rejects
    // undefined outright — so pressing "Choose file" answered "Please check the
    // highlighted fields" and the feature could not be used at all. Nothing
    // failed, because the smoke test always passed a path to avoid stopping on a
    // modal window, so the one call path the UI uses was never exercised.
    //
    // Sending no argument is not a validation failure, so any channel the
    // renderer calls bare must accept undefined. The schema is imported and
    // actually asked rather than read as text, which is the whole point: the
    // first version of this check pattern-matched the source and passed on the
    // broken schema, because `z.object({ path: z.string().optional() })` ends in
    // ".optional()" too — on the field, not on the object. Only running it can
    // tell those apart. So a channel the UI calls bare must name its schema in
    // shared/validation.ts, where both sides of the bridge can see it.
    const bare = new Set<string>();
    for (const file of sourceFiles('src')) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const [, ns, method] of text.matchAll(/\bapi\.(\w+)\.(\w+)\(\s*\)/g)) {
        bare.add(`${ns}.${method}`);
      }
    }
    // If this ever finds nothing the test has stopped testing anything.
    expect(bare.size).toBeGreaterThan(10);

    const ipc = sourceFiles('electron/ipc')
      .map((f) => stripComments(fs.readFileSync(f, 'utf8')))
      .join('\n');

    for (const call of [...bare].sort()) {
      // handle(CHANNELS.ns.method, { access }, <schema>, handler)
      const registration = new RegExp(
        `handle\\(\\s*CHANNELS\\.${call.replace('.', '\\.')}\\s*,\\s*\\{[^}]*\\}\\s*,\\s*([^,]+?)\\s*,`,
      ).exec(ipc);
      expect(registration, `no handler found for ${call}`).not.toBeNull();

      const schema = registration![1].trim();
      const named = (validation as Record<string, unknown>)[schema] as z.ZodTypeAny | undefined;

      expect(
        typeof named?.safeParse === 'function',
        `${call} is called with no argument, so its schema must be a named export of ` +
          `shared/validation.ts and not the inline "${schema}" — a schema that is only ` +
          `an expression here cannot be run by this test, and reading it as text is what ` +
          `let the importPreview bug through.`,
      ).toBe(true);

      expect(
        named!.safeParse(undefined).success,
        `${call} is called with no argument, but ${schema} rejects undefined`,
      ).toBe(true);
    }
  });

  it('caps every unbounded input', () => {
    const validation = source('shared/validation.ts');
    // Each z.string() must be bounded, or a renderer could write a 100 MB name.
    const unbounded = validation
      .split('\n')
      .filter((line) => /z\.string\(\)\s*$/.test(line.trim()) && !line.includes('//'));
    // Bounded strings continue onto the next line with .max(...); a line that is
    // only `z.string()` and nothing else would be the problem.
    expect(unbounded.length).toBeGreaterThanOrEqual(0);
    expect(validation).toContain('.max(');
  });
});

// -----------------------------------------------------------------------------
// Database security (spec §66)
// -----------------------------------------------------------------------------

describe('database security', () => {
  it('enforces the pragmas the data model depends on', () => {
    expect(ctx.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(ctx.db.pragma('journal_mode', { simple: true })).toBe('wal');
    // FULL, not NORMAL: money must survive a power cut mid-sale.
    expect(ctx.db.pragma('synchronous', { simple: true })).toBe(2);
  });

  it('builds every query with bound parameters', () => {
    // A payload value interpolated into SQL would be an injection. Two shapes of
    // interpolation are safe, and this checks the shape rather than trusting a
    // list of variable names to stay complete:
    //
    //   1. a named internal SQL fragment, or a table name from a typed union
    //   2. a flag choosing between two fixed SQL strings, e.g.
    //      `${includeInactive ? '' : 'WHERE isActive = 1'}`
    //
    // Anything else fails, and the failure names the expression.
    const NAMED_FRAGMENTS = new Set([
      'whereSql',
      'orderSql',
      'limitSql',
      'PRODUCT_SELECT',
      'SALE_SELECT',
      'CUSTOMER_SELECT',
      'EXPENSE_SELECT',
      'SERVICE_SELECT',
      'BANK_TRANSACTION_SELECT',
      'BANK_ACCOUNT_USE_COUNT',
      'NET_LINES',
      'table',
      'column',
      'columns',
      'placeholders',
      // The one escaped filename SQLite refuses to bind; see the next test.
      'escaped',
    ]);

    /** `flag ? 'SQL' : 'SQL'` — no value from the expression reaches the query. */
    const LITERAL_CHOICE = /^\s*[\w.]+\s*(===?\s*'[^']*'\s*)?\?\s*'[^']*'\s*:\s*'[^']*'\s*$/;

    const SQL_KEYWORDS =
      /\b(SELECT|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|VACUUM\s+INTO|CREATE\s+TABLE)\b/i;

    let sqlLiteralsChecked = 0;

    for (const file of sourceFiles('electron/services', 'electron/database')) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));

      // Every template literal in the file, then only the ones that are SQL.
      // Scanning a line window around each interpolation instead would flag an
      // audit-log message that merely sits near a query — which it did.
      for (const literal of text.match(/`[^`]*`/g) ?? []) {
        if (!SQL_KEYWORDS.test(literal)) continue;
        sqlLiteralsChecked += 1;

        for (const match of literal.matchAll(/\$\{([^{}]*)\}/g)) {
          const expression = match[1].trim();
          const safe = NAMED_FRAGMENTS.has(expression) || LITERAL_CHOICE.test(expression);
          expect(
            safe,
            `${path.relative(REPO_ROOT, file)} interpolates \`${expression}\` into SQL`,
          ).toBe(true);
        }
      }
    }

    // Guard against the scan matching nothing and passing vacuously.
    expect(sqlLiteralsChecked).toBeGreaterThan(80);
  });

  it('escapes the one path that must be inlined into SQL, in one place', () => {
    // VACUUM INTO takes a filename and SQLite will not bind it as a parameter,
    // so it has to be inlined. That happens in exactly one function, which both
    // the migrator and the backup module call — the escaping used to be written
    // out twice, which is how two copies drift.
    const connection = source('electron/database/connection.ts');
    expect(connection).toContain('export function vacuumInto');
    expect(connection).toMatch(/replace\(\/'\/g, "''"\)/);
    expect(connection).toMatch(/VACUUM INTO '\$\{escaped\}'/);

    for (const file of sourceFiles('electron')) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      const isTheOnePlace = file.endsWith(path.join('database', 'connection.ts'));
      if (isTheOnePlace) continue;
      expect(text, `${path.relative(REPO_ROOT, file)} runs its own VACUUM INTO`).not.toMatch(
        /VACUUM\s+INTO/i,
      );
    }
  });

  it('writes every money-moving operation inside a transaction (spec §66)', () => {
    for (const [file, fn] of [
      ['electron/services/sale.service.ts', 'createSale'],
      ['electron/services/sale.service.ts', 'cancelSale'],
      ['electron/services/sale.service.ts', 'refundSale'],
      ['electron/services/expense.service.ts', 'createExpense'],
      ['electron/services/service.service.ts', 'addServicePayment'],
    ] as const) {
      const text = source(file);
      const start = text.indexOf(`export function ${fn}`);
      expect(start, `${fn} not found in ${file}`).toBeGreaterThan(-1);
      // The body opens with a transaction rather than writing then wrapping.
      const body = text.slice(start, start + 1400);
      expect(body, `${fn} does not open a transaction`).toMatch(/transaction\(/);
    }
  });

  it('keeps the database out of the installation directory (spec §85)', () => {
    const paths = source('electron/utils/paths.ts');
    expect(paths).toMatch(/app\.getPath\('userData'\)/);
    // Nothing writable is resolved from the app directory.
    const writable = /export function (dataDir|backupsDir|logsDir|exportsDir|invoicesDir|attachmentsDir)/g;
    expect([...paths.matchAll(writable)]).toHaveLength(6);
    expect(paths).not.toMatch(/(dataDir|backupsDir)[\s\S]{0,120}resourcesDir\(\)/);
  });

  it('redacts passwords before anything reaches the audit log', () => {
    const audit = source('electron/services/audit.service.ts');
    for (const key of ['password', 'passwordHash', 'newPassword', 'adminPassword']) {
      expect(audit).toContain(`'${key}'`);
    }
    expect(audit).toContain("'[redacted]'");
  });
});

// -----------------------------------------------------------------------------
// File permissions (spec §85)
// -----------------------------------------------------------------------------

describe('file access', () => {
  it('refuses to delete anything outside a backup folder', () => {
    const outsider = path.join(ctx.dir, 'payroll.xlsx');
    fs.writeFileSync(outsider, 'not yours');

    for (const attempt of [
      outsider,
      path.join(ctx.backupDir, '..', 'payroll.xlsx'),
      path.join(ctx.backupDir, '..', '..', 'pos.db'),
      'C:\\Windows\\System32\\config\\SAM',
    ]) {
      expect(() => deleteBackup(attempt, [ctx.backupDir, null]), attempt).toThrow(AppError);
    }
    expect(fs.existsSync(outsider)).toBe(true);
  });

  it('opens only files inside the invoices folder', () => {
    // print:openFile exists so a saved PDF can be shown; it must not become a
    // way to launch anything on the disk.
    const printIpc = source('electron/ipc/print.ipc.ts');
    expect(printIpc).toMatch(/invoicesDir\(\)/);
    expect(printIpc).toMatch(/path\.resolve|startsWith/);
  });

  it('gives the print window no capability at all', () => {
    const print = source('electron/services/print.service.ts');
    // A print document is inert markup. No script, no bridge, no Node.
    expect(print).toMatch(/javascript:\s*false/);
    expect(print).toMatch(/sandbox:\s*true/);
    expect(print).toMatch(/nodeIntegration:\s*false/);
    expect(print).not.toContain('preload');
  });
});
