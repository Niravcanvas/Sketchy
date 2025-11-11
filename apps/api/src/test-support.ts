/**
 * Shared integration-test helpers (not itself a test file — mirrors
 * packages/engine/src/test-support.ts). Every route test file builds a real
 * `buildServer()` instance and drives it via `.inject()` against the real
 * Postgres/Redis provisioned by `vitest.global-setup.ts`.
 */
import type { FastifyInstance } from 'fastify';

/**
 * A fresh-enough fake IP per call (random, not sequential — this must stay
 * unique ACROSS test files too, which each get their own module instance
 * and thus their own counter if this were one, and files may run in either
 * order). The auth-rate-limit (5/min) and global-rate-limit (60/min)
 * buckets are both keyed by IP for unauthenticated requests
 * (rate-limit.ts) — without this, every test's guest-creation calls would
 * share one bucket (light-my-request's default `remoteAddress`) and
 * spuriously trip the limit outside the one test that means to.
 */
export function uniqueIp(): string {
  const octet = (): number => Math.floor(Math.random() * 256);
  return `10.${octet()}.${octet()}.${octet()}`;
}

export interface GuestSession {
  token: string;
  playerId: string;
  displayName: string;
}

/** Creates a guest player through the real `POST /v1/auth/guest` route (not a DB shortcut). */
export async function createGuest(
  server: FastifyInstance,
  options: { displayName?: string; ip?: string } = {},
): Promise<GuestSession> {
  const displayName = options.displayName ?? 'TestPlayer';
  const res = await server.inject({
    method: 'POST',
    url: '/v1/auth/guest',
    payload: { displayName },
    remoteAddress: options.ip ?? uniqueIp(),
  });
  if (res.statusCode !== 200) {
    throw new Error(`createGuest failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as { token: string; player: { id: string; displayName: string } };
  return { token: body.token, playerId: body.player.id, displayName: body.player.displayName };
}
