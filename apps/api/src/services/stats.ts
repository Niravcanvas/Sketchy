import { sql } from 'drizzle-orm';
import { getDb, getRedis } from '../db/client.js';
import { games } from '../db/schema.js';
import { socketsConnected } from '../sockets/namespace-registry.js';

/**
 * Operational stat gauges for `GET /v1/admin/stats` (api-contract.md §1).
 * Kept redaction-safe by construction: every value is a
 * COUNT — never a word, role, vote, or player identity.
 *
 * - `roomsActive`: live `room:*:state` keys (a bounded cursor SCAN, never KEYS).
 * - `socketsConnected`: this process's live `/game` sockets (namespace-registry).
 * - `actionsPerMin`: the last COMPLETED minute's socket-action count, from a
 *   per-minute Redis counter (`stats:actions:{minute}`) bumped by `recordAction`.
 * - `gamesToday`: `games` rows started since local midnight (Postgres). `countGamesToday`
 *   is exported so the public, unauthenticated `GET /v1/stats/games-today` route
 *   (`routes/stats.ts`, post-launch-backlog.md item 4) reuses this EXACT query instead of
 *   duplicating it — the two endpoints can never drift on what "today" or "started" means.
 */

const ACTION_BUCKET_TTL_SECONDS = 180;

function actionBucketKey(minuteIndex: number): string {
  return `stats:actions:${minuteIndex}`;
}

/** Bumps the current minute's action counter. Fire-and-forget from `wireHandler`
 * (a failed stat write must never affect an action's ack). */
export async function recordAction(): Promise<void> {
  const minuteIndex = Math.floor(Date.now() / 60_000);
  const key = actionBucketKey(minuteIndex);
  await getRedis().multi().incr(key).expire(key, ACTION_BUCKET_TTL_SECONDS).exec();
}

async function countActiveRooms(): Promise<number> {
  const redis = getRedis();
  let cursor = '0';
  let count = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'room:*:state', 'COUNT', 200);
    cursor = next;
    count += keys.length;
  } while (cursor !== '0');
  return count;
}

async function actionsPerMinute(): Promise<number> {
  // The previous, fully-elapsed minute is a stable rate (the current minute is
  // still filling). Falls back to 0 when nothing happened.
  const previousMinute = Math.floor(Date.now() / 60_000) - 1;
  const raw = await getRedis().get(actionBucketKey(previousMinute));
  return raw ? Number.parseInt(raw, 10) : 0;
}

export async function countGamesToday(): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(games)
    .where(sql`${games.startedAt} >= date_trunc('day', now())`);
  return rows[0]?.n ?? 0;
}

export interface AdminStats {
  roomsActive: number;
  socketsConnected: number;
  gamesToday: number;
  actionsPerMin: number;
}

export async function readAdminStats(): Promise<AdminStats> {
  const [roomsActive, gamesToday, actionsPerMin] = await Promise.all([
    countActiveRooms(),
    countGamesToday(),
    actionsPerMinute(),
  ]);
  return {
    roomsActive,
    socketsConnected: socketsConnected(),
    gamesToday,
    actionsPerMin,
  };
}
