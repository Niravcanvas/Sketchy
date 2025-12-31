import type { Env } from './env.js';

/**
 * Fail-fast startup guard (pinned decision): `getEnv()` itself never throws
 * (mirrors the store-URL pattern — see env.ts), so misconfigured production
 * secrets are caught here at boot rather than there. Both secrets fall back to
 * the same `dev-only-change-me` dev default, which is silently insecure in
 * production and worth crashing loudly for rather than serving traffic:
 *   - JWT_SECRET: a prod process with no secret would sign/verify every guest
 *     and player token with the dev fallback.
 *   - ADMIN_TOKEN: a prod process with no token would gate `GET /v1/admin/stats`
 *     and the admin reports queue behind the publicly known dev default.
 *
 * Also enforces a config-consistency invariant for the flag-gated Google
 * sign-in: turning it ON without a client ID would leave `POST /auth/google`
 * unable to verify any token (a silently broken feature), so a prod process
 * that sets `GOOGLE_SIGNIN_ENABLED=true` with no `GOOGLE_CLIENT_ID` fails fast
 * here rather than serving a dead button. (Off — the default — needs no client
 * ID: the feature is simply dormant, which is the intended shipped state.)
 */
export function assertProductionSecretsConfigured(env: Env): void {
  if (process.env.NODE_ENV === 'production' && !env.jwtSecret) {
    throw new Error('JWT_SECRET must be set in production');
  }
  if (process.env.NODE_ENV === 'production' && !env.adminToken) {
    throw new Error('ADMIN_TOKEN must be set in production');
  }
  if (process.env.NODE_ENV === 'production' && env.googleSigninEnabled && !env.googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID must be set when GOOGLE_SIGNIN_ENABLED=true in production');
  }
}
