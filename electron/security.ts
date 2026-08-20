/**
 * Process-wide security posture (spec §4, §65, §83).
 *
 * The window options in main.ts (contextIsolation, sandbox, no nodeIntegration)
 * are the well-known half. This file is the other half — the parts that hold
 * even if a future change to the renderer goes wrong:
 *
 *   1. NETWORK IS BLOCKED AT THE SESSION LEVEL.
 *      A Content-Security-Policy is a instruction to a cooperating page. This is
 *      not: every request Chromium makes for anything other than the application's
 *      own local files is denied by the network stack itself. That turns "works
 *      offline" from a design intention into something the process enforces and
 *      a test can prove.
 *
 *   2. EVERY DEVICE PERMISSION IS DENIED.
 *      A POS needs no camera, microphone, location, notifications or clipboard
 *      read. Denying the whole list is shorter and safer than allowing some.
 *
 *   3. NO WINDOW MAY NAVIGATE OR OPEN ANOTHER.
 *      The renderer is an application shell, not a browser. It has no external
 *      links, so nothing is opened externally either — an offline till has no
 *      business handing a URL to the operating system.
 */
import { app, session, type BrowserWindow, type WebContents } from 'electron';
import { logger } from './utils/logger';

/** Schemes the application legitimately loads from. */
const LOCAL_SCHEMES = new Set(['file:', 'devtools:', 'blob:', 'data:']);

/** Requests denied so far, for the diagnostics panel and the smoke test. */
let blockedRequests = 0;

export function blockedRequestCount(): number {
  return blockedRequests;
}

/**
 * True when `url` is something this application is allowed to load.
 *
 * Exported so the offline test can assert the decision table directly rather
 * than trying to make real requests.
 */
export function isLocalRequest(url: string, devServerUrl?: string): boolean {
  if (devServerUrl && url.startsWith(devServerUrl)) return true;
  // The dev server's HMR socket shares its origin but uses the ws: scheme.
  if (devServerUrl) {
    const ws = devServerUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    if (url.startsWith(ws)) return true;
  }

  try {
    return LOCAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    // An unparseable URL is not something we should be fetching.
    return false;
  }
}

/**
 * Installs the session-level guards. Call once, after app.whenReady().
 *
 * `devServerUrl` is only ever set in development; a packaged build passes
 * undefined and therefore permits nothing but its own files.
 */
export function applySecurityPolicy(devServerUrl?: string): void {
  const defaultSession = session.defaultSession;

  // (1) Nothing leaves this machine.
  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (isLocalRequest(details.url, devServerUrl)) {
      callback({ cancel: false });
      return;
    }
    blockedRequests += 1;
    // Logged at warn: in a correct build this never fires, so if it does it is
    // worth seeing in the log file.
    logger.warn('Blocked a network request', {
      url: details.url.slice(0, 200),
      resourceType: details.resourceType,
      total: blockedRequests,
    });
    callback({ cancel: true });
  });

  // (2) No device permissions, ever.
  defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    logger.warn('Denied a permission request', { permission });
    callback(false);
  });
  defaultSession.setPermissionCheckHandler((_contents, permission) => {
    logger.warn('Denied a permission check', { permission });
    return false;
  });

  // No proxy, no DNS-over-HTTPS lookups, no certificate fetches.
  void defaultSession.setProxy({ mode: 'direct' });

  logger.info('Security policy applied', {
    devServer: Boolean(devServerUrl),
    packaged: app.isPackaged,
  });
}

/**
 * Locks down one window's contents.
 *
 * Applied to the main window and, defensively, to any window the application
 * creates later.
 */
export function hardenWindow(win: BrowserWindow, devServerUrl?: string): void {
  const contents = win.webContents;

  // (3) No child windows and no navigation away from the app shell.
  contents.setWindowOpenHandler(({ url }) => {
    logger.warn('Blocked an attempt to open a window', { url: url.slice(0, 200) });
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (isLocalRequest(url, devServerUrl)) return;
    logger.warn('Blocked a navigation', { url: url.slice(0, 200) });
    event.preventDefault();
  });

  // A renderer must never be able to attach a webview with its own preferences.
  contents.on('will-attach-webview', (event) => {
    logger.warn('Blocked a webview attachment');
    event.preventDefault();
  });

  blockDevToolsInProduction(contents);
}

/**
 * Keeps the developer tools out of a shop's hands.
 *
 * Not a security boundary — anyone at the keyboard already has the database
 * file. It is there so a curious employee cannot poke at the bridge and put the
 * shop's records into a state nobody can explain.
 */
function blockDevToolsInProduction(contents: WebContents): void {
  if (!app.isPackaged) return;

  contents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const isDevToolsChord =
      key === 'f12' || (input.control && input.shift && (key === 'i' || key === 'c' || key === 'j'));
    if (isDevToolsChord) event.preventDefault();
  });

  contents.on('devtools-opened', () => {
    contents.closeDevTools();
  });
}

/**
 * Refuses every certificate error rather than offering to continue.
 *
 * Unreachable in normal operation — there are no network requests to fail — but
 * a silent "proceed anyway" default is exactly the kind of thing that turns into
 * a hole the day someone adds a feature that does reach out.
 */
export function refuseCertificateErrors(): void {
  app.on('certificate-error', (event, _contents, url, error, _certificate, callback) => {
    event.preventDefault();
    logger.warn('Refused a certificate error', { url: url.slice(0, 200), error });
    callback(false);
  });

  // Nothing in this application authenticates to anything.
  app.on('login', (event) => {
    event.preventDefault();
    logger.warn('Refused an HTTP authentication prompt');
  });

  app.on('select-client-certificate', (event) => {
    event.preventDefault();
    logger.warn('Refused a client-certificate selection');
  });
}
