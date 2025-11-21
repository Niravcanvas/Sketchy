import { defineConfig, devices } from '@playwright/test';

/**
 * Voice E2E — a REAL browser, REAL API, REAL LiveKit container (not the vitest
 * mocks in `src/lib/voice.test.ts`). Separate config from `playwright.online.config.ts`
 * because the API webServer here needs `LIVEKIT_*` env pointed at a dedicated local LiveKit
 * container (`docker run ... --name sketchy-livekit-e2e`) rather than whatever the
 * default dev port happens to hold — keeping this
 * config's env block separate avoids ever silently pointing an unrelated test run at a
 * throwaway voice container.
 *
 * Two projects, not one, because they need OPPOSITE Chromium launch flags:
 * - `voice-connected` (`voice.spec.ts`) needs `--use-fake-device-for-media-stream` (a
 *   synthetic mic so getUserMedia() really succeeds) AND `--use-fake-ui-for-media-stream`
 *   (auto-accepts the permission prompt).
 * - `voice-denied` (`voice-denied.spec.ts`) uses the fake DEVICE flag but NOT fake-ui: the
 *   device lets LiveKit's connect() reach `Connected` (with none at all it stalls forever in
 *   'connecting'), while the denial itself is forced deterministically in that spec by
 *   overriding `navigator.mediaDevices.getUserMedia` to reject with `NotAllowedError`. fake-ui
 *   is omitted on purpose — it would auto-ACCEPT and make a denial impossible to observe.
 *
 * Requires: Postgres/Redis up (shared dev infra), AND a LiveKit container reachable at
 * `ws://localhost:7893` with API key/secret `devkey` / `devsecret-do-not-use-in-prod-32chars`
 * (matching this file's env block below) BEFORE running `pnpm test:e2e:voice`.
 */
export default defineConfig({
  testDir: './e2e-online',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [
    {
      name: 'voice-connected',
      testMatch: /\/voice\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
    {
      name: 'voice-denied',
      testMatch: /\/voice-denied\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        // Fake DEVICE only, NO fake-ui. The device is needed so LiveKit's connect()/WebRTC
        // actually reaches `Connected` (with no audio device at all, connect() stalls in
        // 'connecting' and the mic step is never reached). The denial itself is forced
        // deterministically in voice-denied.spec.ts by overriding getUserMedia to reject with
        // NotAllowedError — fake-ui would auto-ACCEPT, so it's deliberately omitted.
        launchOptions: {
          args: ['--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @sketchy/api dev',
      url: 'http://localhost:4000/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        CORS_ORIGINS: 'http://localhost:3000',
        NODE_ENV: 'development',
        LIVEKIT_URL: 'ws://localhost:7893',
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'devsecret-do-not-use-in-prod-32chars',
        VOICE_ENABLED: 'true',
      },
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_LIVEKIT_URL: 'ws://localhost:7893',
      },
    },
  ],
});
