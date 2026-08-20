/**
 * Bundles the Electron main and preload processes with esbuild.
 *
 * Native / awkward-to-bundle modules stay external; electron-builder ships them
 * from node_modules (they are listed in package.json "dependencies").
 */
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Modules that must never be inlined into the bundle. */
export const EXTERNALS = ['electron', 'better-sqlite3', 'exceljs', 'bcryptjs'];

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  external: EXTERNALS,
  logLevel: 'info',
  absWorkingDir: root,
};

export const configs = [
  {
    ...shared,
    entryPoints: [path.join(root, 'electron/main.ts')],
    outfile: path.join(root, 'dist-electron/main.js'),
  },
  {
    ...shared,
    entryPoints: [path.join(root, 'electron/preload.ts')],
    outfile: path.join(root, 'dist-electron/preload.js'),
  },
];

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  console.log('[build-electron] main + preload bundled to dist-electron/');
}
