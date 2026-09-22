import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Suites that need real PDFs, which are not in this repository.
 *
 * The documents they run against are third-party — a bank's news releases,
 * among others — so neither they nor the suites written around them are
 * published: both would say which documents were used. They live next to each
 * other outside the repository, and this glob picks them up when they are
 * there. It matches nothing when they are not, which is the normal case for
 * anyone who is not the author, and `npm test` stays complete either way.
 *
 * `APV_LOCAL_SUITES` overrides the location.
 */
const localSuites =
  process.env.APV_LOCAL_SUITES ?? fileURLToPath(new URL('../private/tests', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': root,
      '~': root,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // PDF.js reads canvas globals while its display module is evaluated, so
    // anything importing it needs these present before the test file loads.
    setupFiles: ['tests/setup/jsdom-canvas.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', `${localSuites}/**/*.test.ts`],
  },
});
