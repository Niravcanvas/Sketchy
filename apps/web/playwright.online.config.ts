import { defineConfig, devices } from '@playwright/test';

/**
 * ONLINE golden-path e2e — separate from the
 * pass-and-play `playwright.config.ts` because, unlike the P&P specs (which BLOCK
 * the :4000 API to force the offline path), the online spec needs a LIVE API +
 * Postgres + Redis. Kept in its own `e2e-online/` dir + config so the P&P specs
 * keep passing unmodified (they never see this, and this never blocks :4000).
 *
 * Requires the project compose stack up first (`docker compose -f
 * deploy/compose.dev.yml up -d postgres`, Redis on 6379) with migrations + the
 * official word packs seeded — the API dev server here talks to that dev DB
 * (its env dev-defaults, apps/api/src/env.ts). CI runs this against compose.
 */
export default defineConfig({
  testDir: './e2e-online',
  // The voice specs live in this dir too but have their OWN config
  // (`playwright.voice.config.ts` — they need a dedicated LiveKit container + fake-media
  // Chromium flags this config doesn't provide). Exclude them here so `test:e2e:online`
  // stays the pure REST/socket online-game golden path; voice runs via `test:e2e:voice`.
  testIgnore: /voice.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
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
  webServer: [
    {
      // The live API the browser + socket bots play against.
      command: 'pnpm --filter @sketchy/api dev',
      url: 'http://localhost:4000/v1/health',
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        // The web app is served from :3000 — the API must allow that origin for
        // both REST (POST /rooms, /auth/guest) and the socket handshake.
        CORS_ORIGINS: 'http://localhost:3000',
        NODE_ENV: 'development',
      },
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
