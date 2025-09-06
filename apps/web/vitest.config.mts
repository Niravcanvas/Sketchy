import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    // Playwright specs live in e2e/ (P&P golden path) and e2e-online/ (live-API
    // online golden path, phase 7) — both run via their own Playwright configs
    // (`test:e2e` / `test:e2e:online`), never under vitest (they need a browser +
    // running servers). e2e-online was added in phase 7 without this exclude, so
    // vitest was collecting its Playwright spec and failing (fixed phase 8).
    exclude: ['**/node_modules/**', 'e2e/**', 'e2e-online/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
