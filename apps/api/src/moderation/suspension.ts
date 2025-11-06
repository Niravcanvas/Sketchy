import { isNotNull } from 'drizzle-orm';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { getDb, getRedis } from '../db/client.js';
import { players } from '../db/schema.js';

/**
 * Player suspension. The durable source of
 * truth is `players.suspended_at` (data-model.md §1); this module keeps a fast
 * Redis set (`mod:suspended`) so the every-request check on the auth hot path
 * (auth plugin + socket handshake) is a single O(1) `SISMEMBER`, not a DB
 * round-trip. The set is rehydrated from Postgres on boot (`loadSuspendedIntoRedis`),
 * so a flushed Redis never silently un-suspends anyone.
 *
 * `isSuspended` fails OPEN on a Redis error — availability over strictness at
 * this scale, exactly like the rate limiter (`rate-limit.ts`): a Redis outage
 * lets a suspended player through rather than locking everyone out. Accepted,
 * documented trade-off; the durable DB flag still blocks them the moment Redis
 * recovers and re-seeds.
 */
const SUSPENDED_SET_KEY = 'mod:suspended';

/** Fast membership check for the auth boundary. Fails open (returns `false`)
 * if Redis is unreachable. */
export async function isSuspended(playerId: string, logger?: FastifyBaseLogger): Promise<boolean> {
  try {
    const member = await getRedis().sismember(SUSPENDED_SET_KEY, playerId);
    return member === 1;
  } catch (error) {
    logger?.warn({ err: error }, 'suspension check: Redis unavailable, failing open');
    return false;
  }
}

/**
 * Suspends a player: stamps `players.suspended_at` (idempotent — only sets it
 * if not already set, so a re-suspend doesn't rewrite the original timestamp)
 * and adds them to the fast Redis set. Returns `true` if a player row was
 * found and suspended (or was already suspended).
 */
export async function suspendPlayer(playerId: string): Promise<boolean> {
  const updated = await getDb()
    .update(players)
    .set({ suspendedAt: sql`COALESCE(${players.suspendedAt}, now())` })
    .where(eq(players.id, playerId))
    .returning({ id: players.id });
  if (updated.length === 0) {
    return false;
  }
  await getRedis().sadd(SUSPENDED_SET_KEY, playerId);
  return true;
}

/**
 * Boot rehydrate (called once from `registerSockets`, alongside the timer-wheel
 * re-arm): loads every currently-suspended player id from Postgres into the
 * Redis set so the fast path is correct even after a Redis flush/restart.
 * Returns the count for the boot log.
 */
export async function loadSuspendedIntoRedis(): Promise<number> {
  const rows = await getDb()
    .select({ id: players.id })
    .from(players)
    .where(isNotNull(players.suspendedAt));
  if (rows.length === 0) {
    return 0;
  }
  await getRedis().sadd(SUSPENDED_SET_KEY, ...rows.map((r) => r.id));
  return rows.length;
}
