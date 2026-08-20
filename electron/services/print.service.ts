/**
 * Printing and PDF generation (spec §38).
 *
 * Documents are rendered in a hidden, offscreen BrowserWindow and then handed to
 * Electron's own print pipeline, which talks to the printers already installed in
 * Windows. Nothing here reaches the network, and no external PDF library is
 * needed — Chromium's print engine is already in the application.
 *
 * The HTML is written to a temp file and loaded over file://, rather than as a
 * data: URL, because Chromium restricts what it will render and print from a
 * data URL.
 */
import { BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger';
import { errors } from '../../shared/errors';

export interface PrinterInfo {
  /** Name as the OS understands it — this is what deviceName expects. */
  name: string;
  /** Name as shown in Windows print preview. */
  displayName: string;
  description: string;
  /**
   * Best-effort. Electron 43 dropped the isDefault field from PrinterInfo and
   * moved platform details into `options`, whose keys differ per OS, so this is
   * read from there when present and false otherwise.
   */
  isDefault: boolean;
}

export interface PrintOptions {
  /** Windows printer name. Omitted means the system default. */
  deviceName?: string;
  /** false shows the Windows print dialog. */
  silent?: boolean;
  pageSize?: { width: number; height: number } | 'A4';
  landscape?: boolean;
  copies?: number;
}

/** Temp directory for the HTML being rendered. Cleared as we go. */
function printTempDir(): string {
  const dir = path.join(app.getPath('temp'), 'MobileShopPOS-print');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Renders `html` in an offscreen window and runs `action` against it.
 * The window and its temp file are always cleaned up, including on failure.
 */
async function withRenderedDocument<T>(
  html: string,
  action: (win: BrowserWindow) => Promise<T>,
): Promise<T> {
  const file = path.join(printTempDir(), `${randomUUID()}.html`);
  fs.writeFileSync(file, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      // A print document is inert markup: it needs no bridge and no Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      javascript: false,
      offscreen: true,
    },
  });

  try {
    await win.loadFile(file);
    // Give Chromium a beat to finish layout before measuring pages.
    await new Promise((resolve) => setTimeout(resolve, 120));
    return await action(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    try {
      fs.unlinkSync(file);
    } catch {
      // A leftover temp file is harmless; Windows will clear it.
    }
  }
}

/** Printers installed in Windows. */
export async function listPrinters(): Promise<PrinterInfo[]> {
  const probe = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    const printers = await probe.webContents.getPrintersAsync();
    return printers.map((printer) => {
      const options = (printer.options ?? {}) as Record<string, unknown>;
      const defaultFlag = options['printer-is-default'] ?? options['is-default'];
      return {
        name: printer.name,
        displayName: printer.displayName || printer.name,
        description: printer.description ?? '',
        isDefault: defaultFlag === true || defaultFlag === 'true',
      };
    });
  } catch (err) {
    logger.error('Unable to list printers', err);
    return [];
  } finally {
    if (!probe.isDestroyed()) probe.destroy();
  }
}

/**
 * Sends a document to a printer.
 *
 * `silent: true` prints straight to the chosen printer, which is what a busy
 * till wants. `silent: false` opens the Windows dialog so the user can pick.
 */
export async function printDocument(html: string, options: PrintOptions = {}): Promise<void> {
  await withRenderedDocument(html, async (win) => {
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: options.silent ?? false,
          printBackground: true,
          deviceName: options.deviceName || undefined,
          copies: Math.min(Math.max(options.copies ?? 1, 1), 10),
          landscape: options.landscape ?? false,
          margins: { marginType: 'default' },
          ...(options.pageSize ? { pageSize: options.pageSize } : {}),
        },
        (success, failureReason) => {
          if (success) {
            resolve();
            return;
          }
          // Cancelling the Windows dialog is a normal outcome, not an error.
          if (/cancel/i.test(failureReason ?? '')) {
            logger.info('Print cancelled by the user');
            resolve();
            return;
          }
          logger.error('Printing failed', { failureReason, deviceName: options.deviceName });
          reject(errors.printFailed());
        },
      );
    });
  });
}

/** Renders a document to PDF and returns the bytes. */
export async function renderPdf(html: string, options: PrintOptions = {}): Promise<Buffer> {
  return withRenderedDocument(html, async (win) => {
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      landscape: options.landscape ?? false,
      ...(options.pageSize === 'A4' || options.pageSize === undefined
        ? { pageSize: 'A4' }
        : {
            // printToPDF wants inches, unlike print() which uses microns.
            pageSize: {
              width: options.pageSize.width / 25_400,
              height: options.pageSize.height / 25_400,
            },
          }),
    });
    return pdf;
  });
}

/** Renders to PDF and writes it, returning the path written. */
export async function savePdf(
  html: string,
  targetPath: string,
  options: PrintOptions = {},
): Promise<string> {
  const pdf = await renderPdf(html, options);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, pdf);
  logger.info('PDF written', { targetPath, bytes: pdf.byteLength });
  return targetPath;
}
