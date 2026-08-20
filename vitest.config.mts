import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The data layer is synchronous and file-backed; running suites in one
    // thread keeps temp databases predictable.
    pool: 'threads',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
