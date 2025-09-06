import { defineConfig } from 'vitest/config';

/**
 * Integration tests hit REAL Postgres + Redis from `deploy/compose.dev.yml`
 * (conventions.md §1: "API: integration tests against real Postgres+Redis
 * from compose"). `globalSetup` provisions a dedicated `sketchy_test`
 * database and points `DATABASE_URL`/`REDIS_URL` at it before any test file
 * runs; `setupFiles` closes connections after each file.
 */
export default defineConfig({
  test: {
    globalSetup: ['./vitest.global-setup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    // All test files share ONE `sketchy_test` Postgres database and ONE
    // Redis db (1) for the whole run (globalSetup provisions them once,
    // not per file) — running files sequentially avoids real concurrent
    // writes/rate-limit-bucket races between otherwise-independent files.
    fileParallelism: false,
  },
});
