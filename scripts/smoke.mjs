/**
 * Launches the built application with POS_SMOKE=1 against a throwaway data
 * directory, and reports whether the window, the preload bridge, the database
 * and the authentication flow all work.
 *
 * Requires `npm run build` first. Exits non-zero on failure, so it can gate a
 * release.
 */
import { spawn } from 'node:child_process';
import electronPath from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSmokeFixtures } from './smoke-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const required of ['dist/index.html', 'dist-electron/main.js', 'dist-electron/preload.js']) {
  if (!fs.existsSync(path.join(root, required))) {
    console.error(`[smoke] missing ${required} — run "npm run build" first`);
    process.exit(1);
  }
}

// A fresh directory per run, so the smoke test always exercises a brand-new
// shop and never touches the developer's or the shop's real data.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-smoke-'));
console.log(`[smoke] using throwaway data directory ${userDataDir}`);

writeSmokeFixtures(userDataDir);

const child = spawn(electronPath, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, POS_SMOKE: '1', POS_USER_DATA_DIR: userDataDir },
});

child.on('close', (code) => {
  // The renderer can only report what the bridge told it. Confirm from outside
  // the app that the PDFs it claimed to write are real files with real bytes.
  let pdfCode = 0;
  try {
    const invoices = path.join(userDataDir, 'invoices');
    const pdfs = fs.existsSync(invoices)
      ? fs.readdirSync(invoices).filter((name) => name.toLowerCase().endsWith('.pdf'))
      : [];

    if (pdfs.length === 0) {
      console.error('[smoke] FAIL no PDF was written to the invoices folder');
      pdfCode = 1;
    } else {
      for (const name of pdfs) {
        const file = path.join(invoices, name);
        const { size } = fs.statSync(file);
        const header = fs.readFileSync(file).subarray(0, 5).toString('latin1');
        const valid = header === '%PDF-' && size > 800;
        console.log(
          `[smoke] ${valid ? 'ok  ' : 'FAIL'} PDF on disk ${name} — ${size} bytes, header ${JSON.stringify(header)}`,
        );
        if (!valid) pdfCode = 1;
      }
    }
  } catch (err) {
    console.error(`[smoke] FAIL could not verify the PDFs — ${err.message}`);
    pdfCode = 1;
  }

  // The A4 invoice carries the shop logo (spec §35). A logo referenced by path
  // would render as a broken image in the offscreen print window and leave no
  // trace in the PDF, so confirm an image object actually reached the page —
  // this is the one check that would have caught that.
  try {
    const invoices = path.join(userDataDir, 'invoices');
    const a4 = fs.existsSync(invoices)
      ? fs.readdirSync(invoices).find((name) => /^INV-.*\.pdf$/i.test(name))
      : undefined;

    if (!a4) {
      console.error('[smoke] FAIL no A4 invoice PDF to check for the logo');
      pdfCode = 1;
    } else {
      const bytes = fs.readFileSync(path.join(invoices, a4)).toString('latin1');
      const hasImage = bytes.includes('/Image');
      console.log(
        `[smoke] ${hasImage ? 'ok  ' : 'FAIL'} logo embedded in ${a4} — ${
          hasImage ? 'image object present' : 'no image object in the PDF'
        }`,
      );
      if (!hasImage) pdfCode = 1;
    }
  } catch (err) {
    console.error(`[smoke] FAIL could not check the invoice logo — ${err.message}`);
    pdfCode = 1;
  }

  // Same again for the exported reports: confirm from outside the app that the
  // spreadsheet and CSV are real files with the right magic bytes.
  try {
    const exportsFolder = path.join(userDataDir, 'exports');
    const files = fs.existsSync(exportsFolder) ? fs.readdirSync(exportsFolder) : [];

    const expect = [
      { ext: '.xlsx', magic: 'PK', minBytes: 3000 },
      { ext: '.csv', magic: '﻿', minBytes: 100 },
      { ext: '.pdf', magic: '%PDF-', minBytes: 800 },
    ];

    for (const { ext, magic, minBytes } of expect) {
      const name = files.find((f) => f.toLowerCase().endsWith(ext));
      if (!name) {
        console.error(`[smoke] FAIL no ${ext} export was written`);
        pdfCode = 1;
        continue;
      }
      const file = path.join(exportsFolder, name);
      const { size } = fs.statSync(file);
      const head = fs.readFileSync(file).subarray(0, 8).toString('utf8');
      const valid = head.startsWith(magic) && size >= minBytes;
      console.log(
        `[smoke] ${valid ? 'ok  ' : 'FAIL'} export on disk ${name} — ${size} bytes`,
      );
      if (!valid) pdfCode = 1;
    }
  } catch (err) {
    console.error(`[smoke] FAIL could not verify the exports — ${err.message}`);
    pdfCode = 1;
  }

  // And the backups: a backup the application only *claims* to have written is
  // worth nothing, so confirm from outside that the files are real databases.
  try {
    const backupsFolder = path.join(userDataDir, 'backups');
    const files = fs.existsSync(backupsFolder) ? fs.readdirSync(backupsFolder) : [];
    const manual = files.find((name) => name.startsWith('MobileShopPOS_Backup_'));
    const safety = files.find((name) => name.startsWith('MobileShopPOS_Safety_'));

    for (const [label, name] of [
      ['manual backup', manual],
      ['pre-restore safety backup', safety],
    ]) {
      if (!name) {
        console.error(`[smoke] FAIL no ${label} was written`);
        pdfCode = 1;
        continue;
      }
      const file = path.join(backupsFolder, name);
      const { size } = fs.statSync(file);
      // Every SQLite database begins with this 16-byte header.
      const header = fs.readFileSync(file).subarray(0, 15).toString('latin1');
      const valid = header === 'SQLite format 3' && size > 20000;
      console.log(
        `[smoke] ${valid ? 'ok  ' : 'FAIL'} ${label} on disk ${name} — ${size} bytes`,
      );
      if (!valid) pdfCode = 1;
    }
  } catch (err) {
    console.error(`[smoke] FAIL could not verify the backups — ${err.message}`);
    pdfCode = 1;
  }

  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    console.warn(`[smoke] could not remove ${userDataDir}`);
  }
  process.exit(code || pdfCode);
});
