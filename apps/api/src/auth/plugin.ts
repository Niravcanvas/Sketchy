import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../error-envelope.js';
import { isSuspended } from '../moderation/suspension.js';
import { verifyPlayerToken } from './jwt.js';

/** What every route sees as the authenticated caller (or lack thereof). */
export interface RequestPlayer {
  id: string;
  guest: boolean;
  /** `true` when this player is moderation-suspended. Resolved once
   * per request (a fast Redis `mod:suspended` check, only when a token is
   * present) and enforced by `requireAuth`, so a suspended player is rejected
   * at every auth-required route with the sanitized `suspended` error. */
  suspended: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    player: RequestPlayer | null;
  }
}

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

/**
 * Exported so routes that need the RAW token (not just the resolved
 * `request.player`) — today, only `GET /players/me`'s silent token-refresh
 * check — can pull it back out of the header without re-implementing this
 * parsing.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = BEARER_PATTERN.exec(header);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

async function resolvePlayerFromToken(
  token: string,
  request: FastifyRequest,
): Promise<RequestPlayer | null> {
  const claims = await verifyPlayerToken(token);
  if (!claims) {
    return null;
  }
  const suspended = await isSuspended(claims.playerId, request.log);
  return { id: claims.playerId, guest: claims.guest, suspended };
}

/**
 * Decorates `request.player` ({id, guest} | null) from the
 * `Authorization: Bearer <jwt>` header (system-design.md §6) on every
 * request in `instance`'s scope. Call this directly on the `v1` instance in
 * server.ts — NOT via `fastify.register()` as a nested plugin. A plain
 * `.register()` call creates a new encapsulated child context, which would
 * hide the decoration/hook from `v1`'s OTHER children (health, auth,
 * players, packs routes are all separate `register()` calls, i.e. sibling
 * contexts); calling this directly on `v1` attaches it to the scope they
 * all descend from instead.
 */
export function registerAuthDecoration(instance: FastifyInstance): void {
  instance.decorateRequest('player', null);
  instance.addHook('onRequest', async (request) => {
    const token = extractBearerToken(request.headers.authorization);
    request.player = token ? await resolvePlayerFromToken(token, request) : null;
  });
}

/**
 * Route preHandler: sends the 401 `unauthorized` envelope (copy.md §9) when
 * `request.player` is absent — no token, malformed token, expired token, or
 * a token whose secret doesn't verify against either `JWT_SECRET` or
 * `JWT_SECRET_PREVIOUS`. Attach via `{ preHandler: requireAuth }` on every
 * auth-required route.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.player) {
    sendError(
      reply,
      401,
      'unauthorized',
      "Your session went stale. Refresh and you'll be back in.",
    );
    return;
  }
  // A moderation-suspended player has a VALID token but is blocked
  // from every auth-required action with a sanitized message (the reason is
  // never disclosed). 403 with the dedicated
  // `suspended` code so the client can render the right screen (copy.md §9).
  if (request.player.suspended) {
    sendError(
      reply,
      403,
      'suspended',
      'Your access to Sketchy has been suspended. If you think this is a mistake, contact support.',
    );
  }
}
