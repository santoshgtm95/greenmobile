import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * The Content-Security-Policy in index.html has to allow the dev server's HMR
 * socket, which a shipped build must not carry. Rather than keep two copies of
 * the policy in step by hand, the dev allowances are written once in index.html
 * and stripped from the production output here.
 *
 * The shipped policy therefore reduces to `connect-src 'self'`, which — together
 * with the session-level request blocking in electron/security.ts — is what makes
 * the offline guarantee (spec §4) hold at two independent layers.
 */
const DEV_CONNECT_SRC = " ws://localhost:5273 http://localhost:5273";

function tightenCspForProduction(): Plugin {
  return {
    name: 'pos-tighten-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes(DEV_CONNECT_SRC)) {
        // Fail the build rather than ship a policy nobody checked: if the CSP in
        // index.html is edited, this plugin must be updated with it.
        throw new Error(
          'pos-tighten-csp: the dev connect-src allowance was not found in index.html. ' +
            'Update vite.config.mts to match the policy.',
        );
      }
      return html.replace(DEV_CONNECT_SRC, '');
    },
  };
}

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react(), tightenCspForProduction()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome128',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5273,
    strictPort: true,
  },
  clearScreen: false,
});
