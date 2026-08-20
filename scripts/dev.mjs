/**
 * Development launcher.
 *
 * Starts the Vite dev server for the renderer, watches/rebuilds the Electron
 * main + preload bundles, then launches Electron pointing at the dev server.
 * Restarts Electron whenever the main-process code changes.
 */
import { createServer } from 'vite';
import esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import electronPath from 'electron';
import { configs } from './build-electron.mjs';

let electronProc = null;
let restarting = false;

function launchElectron(devServerUrl) {
  if (electronProc) {
    restarting = true;
    electronProc.kill();
    electronProc = null;
  }
  electronProc = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl, NODE_ENV: 'development' },
  });
  restarting = false;
  electronProc.on('close', (code) => {
    if (!restarting) {
      process.exit(code ?? 0);
    }
  });
}

const server = await createServer();
await server.listen();
server.printUrls();

const devServerUrl = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5273/';

let firstBuild = true;
const restartPlugin = {
  name: 'relaunch-electron',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        console.error('[dev] main-process build failed, keeping previous build running');
        return;
      }
      if (firstBuild) {
        firstBuild = false;
        launchElectron(devServerUrl);
      } else {
        console.log('[dev] main process changed — restarting Electron');
        launchElectron(devServerUrl);
      }
    });
  },
};

// Only the main bundle triggers a relaunch; both are watched.
const contexts = await Promise.all(
  configs.map((c, i) =>
    esbuild.context({
      ...c,
      logLevel: 'warning',
      plugins: i === 0 ? [restartPlugin] : [],
    }),
  ),
);
await Promise.all(contexts.map((c) => c.watch()));

const shutdown = async () => {
  restarting = true;
  electronProc?.kill();
  await Promise.all(contexts.map((c) => c.dispose()));
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
