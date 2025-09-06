/**
 * Typed, frozen snapshot of the process env this app actually reads
 * (conventions.md §4 documents every var in `.env.example`). Missing
 * `DATABASE_URL`/`REDIS_URL` must NOT crash the process — the
 * `/v1/ready` check just reports those deps as down (routes/health.ts).
 */
export interface Env {
  port: number;
  databaseUrl: string | undefined;
  redisUrl: string | undefined;
  corsOrigins: string[];
  logLevel: string;
  /**
   * HS256 secret signing guest/player JWTs (system-design.md §6). Falls back
   * to a dev-only default outside production; a missing value IN production
   * is a fail-fast startup error (checked in index.ts, not here — `getEnv()`
   * never throws, mirroring the store-URL pattern above).
   */
  jwtSecret: string | undefined;
  /** Previous HS256 secret, still accepted during a rotation window (dual-secret verify). */
  jwtSecretPrevious: string | undefined;
  /**
   * Public URL of the Next.js web app (conventions.md §4 — already documented in
   * `.env.example`), used for `POST /v1/rooms`'s `joinUrl` (api-contract.md §1).
   * Dev-defaults to the local Next.js port so
   * `docker compose up + pnpm dev` needs zero flag plumbing, same pattern as the
   * store URLs above.
   */
  publicWebUrl: string;
  /** Sentry DSN for API error tracking (conventions.md §4). Empty/undefined disables
   * Sentry entirely (pino logs remain the source of truth). */
  sentryDsn: string | undefined;
  /** Bearer token gating `GET /v1/admin/stats` (api-contract.md §1 "Ops"). Dev-defaults
   * so the endpoint is reachable locally; production must set a real value. */
  adminToken: string | undefined;
  /**
   * Cloudflare R2 (system-design.md §9, used by `POST /v1/uploads/presign`).
   * Dev-defaults to the documented `.env.example` PLACEHOLDER values
   * ("changeme") — presigning is a pure crypto operation (no network call),
   * so the endpoint still mints a syntactically valid URL against these
   * placeholders; it simply won't accept a real PUT against an account that
   * doesn't exist. That's an accepted dev limitation
   * (routes/uploads.ts documents it), not a startup failure — unlike
   * `databaseUrl`/`redisUrl`, nothing here throws.
   */
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  /** Public base URL reads are served from (custom CDN domain) — also the ONLY
   * domain `PATCH /packs/:id`'s `coverUrl` is allowed to point at
   * (system-design.md §9, api-contract.md §1). No trailing slash. */
  r2PublicBaseUrl: string;
  /**
   * Self-hosted LiveKit SFU (system-design.md §8). `livekitUrl` is
   * BOTH the URL the API returns to clients as `GET
   * /rooms/:code/voice-token`'s `url` field AND (if a later need arises for
   * server→LiveKit REST calls, e.g. `RoomServiceClient`) the one the
   * API itself would dial — in this project's topology (dev: docker exposes
   * LiveKit straight to the host; prod: `voice.<domain>` is a directly
   * reachable public hostname, deploy/RUNBOOK.md's voice section) API and
   * browser always reach the SAME LiveKit endpoint, so there is no separate
   * internal-only URL to track. Dev-defaults mirror `deploy/compose.dev.yml`'s
   * `livekit` service (dev API key/secret baked into its `--dev` flag).
   */
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  /** `VOICE_ENABLED` kill-switch — `false` makes
   * `GET /rooms/:code/voice-token` and the `voice:state` socket event both
   * fail clean with `voice_disabled` (copy.md §9); the game itself is
   * completely unaffected either way (voice is cosmetic to the engine). */
  voiceEnabled: boolean;
  /**
   * Transactional-email provider for magic-link account linking
   * (system-design.md §6). `'log'` (the dev/default) NEVER sends a real email
   * — it writes the magic link to the API log (clearly labeled) and a small
   * in-process dev sink (`accounts/email-provider.ts`) so the flow is
   * end-to-end testable with zero credentials. `'resend'`/`'postmark'` select
   * the real HTTP-provider shape, which is wired but not usable yet (needs
   * `EMAIL_API_KEY` — there are no provider credentials in this environment).
   * Anything unset ⇒ `'log'`.
   */
  emailProvider: 'log' | 'resend' | 'postmark';
  /** From address the real providers send as (ignored by the `'log'` provider). */
  emailFrom: string;
  /** API key/server token for the selected real provider — empty for `'log'`. */
  emailApiKey: string | undefined;
  /**
   * "Sign in with Google" as an ADDITIONAL identity-link method alongside the
   * magic link (system-design.md §6). `googleClientId` is the OAuth client ID
   * the server verifies browser-minted ID tokens against (as the `audience`);
   * `undefined` until an operator provisions one. There is no dev default — the
   * feature is meaningless without a real Google project, so it stays off
   * everywhere until configured (deploy/RUNBOOK.md's Google section).
   */
  googleClientId: string | undefined;
  /**
   * `GOOGLE_SIGNIN_ENABLED` kill-switch — the INVERSE of `VOICE_ENABLED`'s
   * default: this feature ships DORMANT, so it defaults OFF and an operator opts
   * IN with `GOOGLE_SIGNIN_ENABLED=true` (only after provisioning a client ID).
   * Off ⇒ `POST /auth/google` returns a clean `not_found` and the web renders no
   * button / loads no Google script. A prod process with the flag ON but no
   * `googleClientId` is a fail-fast startup error (startup-guards.ts).
   */
  googleSigninEnabled: boolean;
}

/**
 * Outside production, unset store URLs fall back to the compose.dev.yml
 * defaults (mirroring .env.example) so `docker compose up + pnpm dev` works
 * with zero flag plumbing. Production must set every var explicitly.
 */
function devDefault(value: string): string | undefined {
  return process.env.NODE_ENV === 'production' ? undefined : value;
}

export function getEnv(): Env {
  const port = Number.parseInt(process.env.PORT ?? '', 10) || 4000;
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return Object.freeze({
    port,
    databaseUrl:
      process.env.DATABASE_URL ?? devDefault('postgres://sketchy:sketchy@localhost:5432/sketchy'),
    redisUrl: process.env.REDIS_URL ?? devDefault('redis://localhost:6379'),
    corsOrigins,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    jwtSecret: process.env.JWT_SECRET ?? devDefault('dev-only-change-me'),
    jwtSecretPrevious: process.env.JWT_SECRET_PREVIOUS || undefined,
    publicWebUrl:
      process.env.PUBLIC_WEB_URL ?? devDefault('http://localhost:3000') ?? 'http://localhost:3000',
    sentryDsn: process.env.SENTRY_DSN || undefined,
    adminToken: process.env.ADMIN_TOKEN ?? devDefault('dev-only-change-me'),
    r2AccountId: process.env.R2_ACCOUNT_ID ?? devDefault('changeme') ?? 'changeme',
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? devDefault('changeme') ?? 'changeme',
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? devDefault('changeme') ?? 'changeme',
    r2Bucket: process.env.R2_BUCKET ?? devDefault('sketchy-dev') ?? 'sketchy-dev',
    r2PublicBaseUrl:
      process.env.R2_PUBLIC_BASE_URL ??
      devDefault('https://cdn.example.com') ??
      'https://cdn.example.com',
    livekitUrl:
      process.env.LIVEKIT_URL ?? devDefault('ws://localhost:7880') ?? 'ws://localhost:7880',
    livekitApiKey: process.env.LIVEKIT_API_KEY ?? devDefault('devkey') ?? 'devkey',
    livekitApiSecret:
      process.env.LIVEKIT_API_SECRET ??
      devDefault('devsecret-do-not-use-in-prod-32chars') ??
      'devsecret-do-not-use-in-prod-32chars',
    // Default ON in dev (so the feature is exercisable with zero flag plumbing, matching
    // every other dev-default above); an operator flips it off with VOICE_ENABLED=false.
    voiceEnabled: process.env.VOICE_ENABLED !== 'false',
    emailProvider: parseEmailProvider(process.env.EMAIL_PROVIDER),
    emailFrom: process.env.EMAIL_FROM || 'Sketchy <no-reply@sketchy.example>',
    emailApiKey: process.env.EMAIL_API_KEY || undefined,
    googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,
    // Default OFF (dormant until an operator provisions a Google client ID and
    // opts in) — deliberately the inverse of VOICE_ENABLED's default-on above.
    googleSigninEnabled: process.env.GOOGLE_SIGNIN_ENABLED === 'true',
  });
}

/** `EMAIL_PROVIDER` is a small closed set; anything unrecognized (or unset)
 * falls back to the credential-free dev `'log'` provider rather than throwing —
 * mirroring every other dev-safe default in this file. */
function parseEmailProvider(raw: string | undefined): 'log' | 'resend' | 'postmark' {
  return raw === 'resend' || raw === 'postmark' ? raw : 'log';
}
