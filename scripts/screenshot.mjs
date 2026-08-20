/**
 * Seeds a throwaway shop, then photographs every screen of the running app.
 *
 * The palette validator checks colour, not layout — this is how a headless
 * session actually looks at the result: label collisions, clipped axes and
 * overflow only show up in a real render.
 *
 *   npm run build && npm run screenshot
 */
import { spawn } from 'node:child_process';
import electronPath from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSmokeFixtures } from './smoke-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] ?? path.join(root, 'screenshots');

if (!fs.existsSync(path.join(root, 'dist/index.html'))) {
  console.error('[screenshot] run "npm run build" first');
  process.exit(1);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-shot-'));

// The screenshot run drives the same in-app script, so it needs the same
// fixtures the smoke run writes.
writeSmokeFixtures(userDataDir);

const child = spawn(electronPath, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    POS_SMOKE: '1',
    POS_USER_DATA_DIR: userDataDir,
    POS_SCREENSHOT: outDir,
  },
});

child.on('close', (code) => {
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* a stale temp dir is harmless */
  }
  console.log(`[screenshot] images in ${outDir}`);
  process.exit(code ?? 1);
});
