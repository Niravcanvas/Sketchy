import { defineConfig, devices } from '@playwright/test';

/**
 * Pass-and-play e2e layer (arch/game-design.md §4). One project (Desktop Chrome)
 * against the real Next dev server — no mocked engine, no jsdom; `apps/web/e2e/helpers.ts`
 * blocks the :4000 API origin per-test so every spec exercises the real offline/bundled-pack
 * fallback instead of depending on a live API server.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
