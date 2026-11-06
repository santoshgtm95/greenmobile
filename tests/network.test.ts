/**
 * Network access: each browser on the shop network signs in on its own, goes
 * through the same checks as the desktop window, and cannot reach the actions
 * that need the main computer's screen.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { registerAuthIpc } from '../electron/ipc/auth.ipc';
import { handle } from '../electron/ipc/registry';
import { startNetworkAccess, stopNetworkAccess } from '../electron/network';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser } from '../electron/session';
import { CHANNELS } from '../shared/channels';
import { zNoPayload } from '../shared/validation';

const PORT = 18765;
let ctx: TestDatabase;
let site: string;

type Reply = { ok: boolean; data: { user: { username: string } | null }; error: { message: string } };
const reply = async (response: Promise<Response>) => (await (await response).json()) as Reply;

const call = (token: string, channel: string, payload?: unknown) =>
  fetch(`http://127.0.0.1:${PORT}/api/${channel}`, {
    method: 'POST',
    headers: { 'X-Pos-Session': token, 'Content-Type': 'application/json' },
    body: payload === undefined ? '' : JSON.stringify(payload),
  });

beforeAll(async () => {
  ctx = createTestDatabase();
  completeFirstRunSetup(
    {
      shopName: 'Green Mobile', shopAddress: '', shopPhone: undefined, shopEmail: undefined, fullName: 'Owner',
      username: 'owner', password: 'owner-pass', confirmPassword: 'owner-pass', currency: 'THB', taxEnabled: false,
      taxRate: 0, taxMode: 'EXCLUSIVE', receiptWidth: '80mm', backupLocation: undefined,
    },
    ctx.db,
  );
  setSessionUser(null); // the desktop window starts signed out
  registerAuthIpc();
  handle(CHANNELS.backup.restore, { access: 'public' }, zNoPayload, () => 'restored');

  site = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-site-'));
  fs.writeFileSync(path.join(site, 'index.html'), '<p>POS</p>');
  await startNetworkAccess(site, PORT);
});

afterAll(async () => {
  await stopNetworkAccess();
  ctx.cleanup();
  fs.rmSync(site, { recursive: true, force: true });
});

describe('network access', () => {
  const tablet = 'a'.repeat(32);
  const laptop = 'b'.repeat(32);

  it('signs each device in on its own, never the desktop', async () => {
    const login = await reply(call(tablet, CHANNELS.auth.login, { username: 'owner', password: 'owner-pass' }));
    expect(login.ok).toBe(true);

    expect((await reply(call(tablet, CHANNELS.auth.status))).data.user?.username).toBe('owner');
    expect((await reply(call(laptop, CHANNELS.auth.status))).data.user).toBeNull();
    expect(getSessionUser()).toBeNull();
  });

  it('refuses requests without the app header, unknown channels and main-computer actions', async () => {
    const bare = await fetch(`http://127.0.0.1:${PORT}/api/${CHANNELS.auth.status}`, { method: 'POST' });
    expect(bare.status).toBe(403);
    expect((await call(tablet, 'nope:nothing')).status).toBe(404);
    const restore = await reply(call(tablet, CHANNELS.backup.restore));
    expect(restore.error.message).toMatch(/main computer/);
  });

  it('serves the app, and nothing outside it', async () => {
    expect(await (await fetch(`http://127.0.0.1:${PORT}/`)).text()).toBe('<p>POS</p>');
    const escape = await fetch(`http://127.0.0.1:${PORT}/..%2f..%2fwindows%2fwin.ini`);
    expect(await escape.text()).toBe('<p>POS</p>');
  });
});
