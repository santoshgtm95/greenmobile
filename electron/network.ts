/**
 * Network access: other laptops and tablets on the shop's own Wi-Fi use the POS
 * in a web browser, while this computer keeps the only copy of the database.
 *
 * Off unless Settings › Network access turns it on. No internet is involved:
 * browsers reach this computer by its address on the local network. Every call
 * goes through the same sign-in, permission and validation checks as the
 * desktop window (electron/ipc/registry.ts), and each browser signs in on its
 * own session.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invokeChannel } from './ipc/registry';
import { runInSession, type Session } from './session';
import { CHANNELS } from '../shared/channels';
import { errors } from '../shared/errors';
import { logger } from './utils/logger';

// shortcut: fixed port; make it a setting if another program ever needs 8765.
export const NETWORK_PORT = 8765;

/** These need this computer's own screen (file dialogs, folders) or replace the database under everyone. */
const LOCAL_ONLY = new Set<string>([
  CHANNELS.backup.create,
  CHANNELS.backup.restore,
  CHANNELS.backup.chooseFolder,
  CHANNELS.backup.openFolder,
  CHANNELS.data.importPreview,
  CHANNELS.data.importTemplate,
  CHANNELS.print.savePdf,
  CHANNELS.print.openFile,
  CHANNELS.reports.openExportsFolder,
  CHANNELS.settings.chooseLogo,
]);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** The largest request body: the shop logo (512 KB as text) plus room. */
const MAX_BODY = 2 * 1024 * 1024;

const sessions = new Map<string, Session>();
let server: http.Server | null = null;

/** Sign every network device out (after a restore, or when access is turned off). */
export function endNetworkSessions(): void {
  sessions.clear();
}

export function isNetworkAccessRunning(): boolean {
  return server?.listening ?? false;
}

/** Addresses other devices type into their browser. */
export function networkUrls(port = NETWORK_PORT): string[] {
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) =>
    (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, url: `http://${a.address}:${port}` })),
  );
  // Virtual adapters (VMware, Hyper-V, WSL, VirtualBox) are not the shop's Wi-Fi; show them only if nothing else exists.
  const real = all.filter((a) => !/vEthernet|VMware|VirtualBox|WSL|Hyper-V|Loopback|Bluetooth/i.test(a.name));
  return (real.length ? real : all).map((a) => a.url);
}

export function startNetworkAccess(staticDir: string, port = NETWORK_PORT): Promise<void> {
  if (server) return Promise.resolve();
  const s = http.createServer((req, res) => {
    handleRequest(staticDir, req, res).catch((err) => {
      logger.error('Network request failed', err);
      if (!res.headersSent) send(res, 500, 'text/plain', 'Something went wrong.');
    });
  });
  server = s;
  return new Promise((resolve, reject) => {
    s.once('error', (err) => {
      server = null;
      logger.error('Network access could not start', err);
      reject(err);
    });
    s.listen(port, '0.0.0.0', () => {
      logger.info('Network access on', { urls: networkUrls(port) });
      resolve();
    });
  });
}

/** Turns access on or off to match the setting. A failed start is logged and shows as off in Settings. */
export async function applyNetworkAccess(on: boolean): Promise<void> {
  if (!on) return stopNetworkAccess();
  // The same build the desktop window loads (see main.ts).
  await startNetworkAccess(path.join(__dirname, '../dist')).catch(() => undefined);
}

export function networkStatus(): { running: boolean; urls: string[] } {
  return { running: isNetworkAccessRunning(), urls: isNetworkAccessRunning() ? networkUrls() : [] };
}

export function stopNetworkAccess(): Promise<void> {
  const s = server;
  server = null;
  endNetworkSessions();
  if (!s) return Promise.resolve();
  s.closeAllConnections();
  return new Promise((resolve) => s.close(() => resolve()));
}

function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function handleRequest(staticDir: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://pos');

  if (url.pathname.startsWith('/api/')) {
    // Only the app's own fetch sends this header, and a page from anywhere else
    // cannot without a CORS preflight this server never answers.
    const token = req.headers['x-pos-session'];
    if (req.method !== 'POST' || typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) {
      return send(res, 403, 'text/plain', 'Forbidden');
    }
    const channel = decodeURIComponent(url.pathname.slice('/api/'.length));
    const body = await readBody(req);
    if (body === null) return send(res, 413, 'text/plain', 'Too large');

    let payload: unknown;
    try {
      payload = body.length ? JSON.parse(body) : undefined;
    } catch {
      return send(res, 400, 'text/plain', 'Bad request');
    }

    let session = sessions.get(token);
    if (!session) sessions.set(token, (session = { user: null }));
    const result = LOCAL_ONLY.has(channel)
      ? { ok: false as const, error: errors.invalidState('This can only be done on the main computer.').toSerialized() }
      : await runInSession(session, () => invokeChannel(channel, payload));
    if (!result) return send(res, 404, 'text/plain', 'Not found');
    return send(res, 200, 'application/json', JSON.stringify(result));
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'Not allowed');

  // The app uses hash routes, so every page is index.html; anything outside the build is refused.
  const root = path.resolve(staticDir);
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  const target = file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()
    ? file
    : path.join(root, 'index.html');
  if (!fs.existsSync(target)) return send(res, 404, 'text/plain', 'The app has not been built.');
  send(res, 200, TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream', fs.readFileSync(target));
}

function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
