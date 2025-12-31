import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getRedis } from './db/client.js';
import { sendError } from './error-envelope.js';

/** Fixed window size for both buckets (data-model.md §2 `rl:{scope}:{key}`). */
const WINDOW_MS = 60_000;

/** Bucket TTL: window + slack, so a bucket always outlives its use as "previous". */
const BUCKET_TTL_SECONDS = 130;

/**
 * Weighted sliding-window check against two fixed 60s Redis INT counters:
 * `estimate = previousCount * overlap + currentCount`, where `overlap` is
 * how much of the trailing 60s window still falls inside the previous
 * bucket. This approximates a true sliding log without storing individual
 * request timestamps (data-model.md §2). Fails OPEN on any Redis error —
 * logs a warning and allows the request; availability over strictness at
 * this scale (pinned decision).
 *
 * Exported so the Socket.IO layer (`sockets/`) can reuse the exact
 * same limiter for per-event scopes (`join`/`action`/`chat`, data-model.md
 * §2's `rl:{scope}:{key}` table) instead of re-implementing sliding-window
 * counting — behavior here is unchanged from the REST-only version.
 */
export async function checkRateLimit(
  scope: string,
  key: string,
  limit: number,
  logger: FastifyBaseLogger,
): Promise<boolean> {
  try {
    const redis = getRedis();
    const now = Date.now();
    const windowIndex = Math.floor(now / WINDOW_MS);
    const currentKey = `rl:${scope}:${key}:${windowIndex}`;
    const previousKey = `rl:${scope}:${key}:${windowIndex - 1}`;

    const [currentRaw, previousRaw] = await redis.mget(currentKey, previousKey);
    const current = Number.parseInt(currentRaw ?? '', 10) || 0;
    const previous = Number.parseInt(previousRaw ?? '', 10) || 0;

    const elapsedIntoCurrentMs = now - windowIndex * WINDOW_MS;
    const overlap = (WINDOW_MS - elapsedIntoCurrentMs) / WINDOW_MS;
    const estimate = previous * overlap + current;

    if (estimate >= limit) {
      return false;
    }

    await redis.multi().incr(currentKey).expire(currentKey, BUCKET_TTL_SECONDS).exec();
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'rate limiter: Redis unavailable, failing open');
    return true;
  }
}

async function sendRateLimited(reply: FastifyReply): Promise<void> {
  sendError(reply, 429, 'rate_limited', 'Easy there. Give it a few seconds and try again.');
}

/**
 * 5/min per IP (pinned decision). Attach as `{ preHandler: authRateLimit }`
 * on `POST /v1/auth/guest` only — it's not registered globally.
 */
export async function authRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const allowed = await checkRateLimit('auth', request.ip, 5, request.log);
  if (!allowed) {
    await sendRateLimited(reply);
  }
}

/**
 * Public games-today counter — 20/min per IP (pinned decision, same dedicated-ceiling
 * reasoning as `lobbiesRateLimit`/`packsBrowseRateLimit`: above one-shot action limits, well
 * under the 60/min global). `GET /v1/stats/games-today` carries no `requireAuth` (it's the
 * public, low-privilege stats endpoint from post-launch-backlog.md item 4), so there is no
 * player identity to key on — IP is the only option, same as `authRateLimit`. Kept as its own
 * scope rather than reusing `authRateLimit`'s `'auth'` bucket so a burst against one endpoint
 * never eats into the other's budget for the same caller.
 */
export async function statsRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const allowed = await checkRateLimit('stats', request.ip, 20, request.log);
  if (!allowed) {
    await sendRateLimited(reply);
  }
}

/**
 * 5/min per authenticated player (pinned decision, api-contract.md §1
 * `POST /v1/rooms`). Keyed by playerId, not IP — `requireAuth` has already run
 * by the time this preHandler is attached, so `request.player` is always set.
 */
export async function roomCreateRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = request.player?.id ?? request.ip;
  const allowed = await checkRateLimit('roomCreate', key, 5, request.log);
  if (!allowed) {
    await sendRateLimited(reply);
  }
}

/**
 * Account-link magic-link requests — 3/min per authenticated
 * player. Keyed by playerId (the request requires auth), which caps how fast
 * one identity can trigger link emails to arbitrary addresses (anti-bombing),
 * on top of the global 60/min. The verify endpoint reuses `authRateLimit`
 * (per-IP) instead, since it's unauthenticated. Enumeration-safety is handled
 * in the route itself (a constant `{ ok: true }` response); this just blunts
 * volume.
 */
export async function accountLinkRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = request.player?.id ?? request.ip;
  const allowed = await checkRateLimit('accountLink', key, 3, request.log);
  if (!allowed) {
    await sendRateLimited(reply);
  }
}

/**
 * Self-service account deletion — 3/min per authenticated player. A
 * legitimate delete happens once, so this exists only to blunt abuse of a
 * sensitive, irreversible write (matching the magic-link limiter's tightness);
 * keyed by playerId, since `requireAuth` runs first.
 */
export async function accountDeleteRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = request.player?.id ?? request.ip;
  const allowed = await checkRateLimit('accountDelete', key, 3, request.log);
  if (!allowed) {
    await sendRateLimited(reply);
  }
}

/**
 * Player reports — 10/min per authenticated player. Generous enough
 * for a legitimately bad room, tight enough that a single account can't flood
 * the moderation queue.
 */
export async function reportRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = request.player?.id ?? request.ip;
  const allowed = await checkRateLimit('report', key, 10, request.log);
  if (!allowed) {
    await sendRateLimited(reply);
  }
}

/**
 * Quick-join enqueue — 10/min per authenticated player, so rapid
 * re-queueing (cancel/re-enqueue churn) can't hammer the matcher or the queue
 * zset.
 */
export async function matchmakingRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = request.player?.id ?? request.ip;
  const allowed = await checkRateLimit('matchmaking', key, 10, request.log);
  if (!allowed) {
    await sendRateLimited(reply);
  }
}

/**
 * Public-lobby browser — 20/min per authenticated player. Browsing
 * legitimately needs more headroom than one-shot actions (initial load + paging
 * through the open lobbies + periodic refresh), so it sits above
 * matchmaking/report (10/min) yet well under the 60/min global. That dedicated
 * ceiling caps a single account's scrape at ~1k lobby records/min (down from
 * ~3k under the global limiter alone, at 50 rows/page) against a system sized
 * for ~50–100 rooms — real paging/refresh is unaffected, bulk scraping isn't.
 */
export async function lobbiesRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = request.player?.id ?? request.ip;
  const allowed = await checkRateLimit('lobbies', key, 20, request.log);
  if (!allowed) {
    await sendRateLimited(reply);
  }
}

/**
 * Public-catalog browser — 20/min per authenticated player. `GET
 * /packs/public` is a scrape-able list surface exactly like `/lobbies` (initial
 * load + `q` searches + paging through the catalog), so it gets the same
 * dedicated ceiling: above the one-shot action limits (matchmaking/report at
 * 10/min) yet well under the 60/min global, capping a single account's scrape
 * of the public catalog without touching real browsing/paging. Keyed by
 * playerId (`requireAuth` runs first). Reused as the write limiter on
 * `POST /packs/:id/import` — there's no dedicated import limiter, and the
 * add-to-set action is naturally paced by browsing anyway.
 */
export async function packsBrowseRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = request.player?.id ?? request.ip;
  const allowed = await checkRateLimit('packsBrowse', key, 20, request.log);
  if (!allowed) {
    await sendRateLimited(reply);
  }
}

/**
 * Every route EXCEPT these gets the global limit (pinned decision) — ops
 * endpoints are exempt so uptime probes and the mobile team's OpenAPI
 * fetches never get throttled.
 */
const GLOBAL_LIMIT_EXCLUDED_PATHS = new Set(['/v1/health', '/v1/ready', '/v1/openapi.json']);

/**
 * Registers the 60/min global limiter directly on `instance` (call this the
 * same way as `registerAuthDecoration` in `auth/plugin.ts` — NOT via
 * `.register()` — so the hook covers every route in `v1`'s scope,
 * including sibling route plugins registered afterward). Keyed by playerId
 * when authenticated, else by IP. MUST be registered after
 * `registerAuthDecoration` so `request.player` is already populated when
 * this hook runs.
 */
export function registerGlobalRateLimit(instance: FastifyInstance): void {
  instance.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path !== undefined && GLOBAL_LIMIT_EXCLUDED_PATHS.has(path)) {
      return;
    }
    const key = request.player?.id ?? request.ip;
    const allowed = await checkRateLimit('global', key, 60, request.log);
    if (!allowed) {
      await sendRateLimited(reply);
    }
  });
}
