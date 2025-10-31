import { getRedis } from '../db/client.js';

/**
 * The quick-join queue (data-model.md §2 `mm:queue`). Two keys:
 *
 * - `mm:queue` — zset, member = playerId, score = enqueue time (ms). Ordering
 *   = FIFO fairness; membership = "am I queued"; removal = cancel/match.
 * - `mm:queue:lang` — hash, playerId → language (the grouping dimension the
 *   single zset can't carry). A companion key documented alongside `mm:queue`.
 *
 * Both are pruned together on dequeue/match, and the matcher drops entries
 * older than a staleness bound (a crashed client that never cancelled).
 */
const QUEUE_KEY = 'mm:queue';
const LANG_KEY = 'mm:queue:lang';

export interface QueueEntry {
  playerId: string;
  language: string;
  enqueuedAt: number;
}

/** Enqueues `playerId` for `language`. Re-enqueue keeps the original FIFO
 * position (`ZADD NX`) but refreshes the language, so a cancel/re-enqueue churn
 * (rate-limited anyway) can't be used to jump the line. */
export async function enqueue(playerId: string, language: string, at: number): Promise<void> {
  await getRedis()
    .multi()
    .zadd(QUEUE_KEY, 'NX', at, playerId)
    .hset(LANG_KEY, playerId, language)
    .exec();
}

/** Removes a player from the queue (cancel or matched). Idempotent. */
export async function dequeue(playerId: string): Promise<void> {
  await getRedis().multi().zrem(QUEUE_KEY, playerId).hdel(LANG_KEY, playerId).exec();
}

/** Bulk removal after a room is formed/filled (one pipeline). */
export async function dequeueMany(playerIds: string[]): Promise<void> {
  if (playerIds.length === 0) {
    return;
  }
  const redis = getRedis();
  const pipeline = redis.multi();
  pipeline.zrem(QUEUE_KEY, ...playerIds);
  pipeline.hdel(LANG_KEY, ...playerIds);
  await pipeline.exec();
}

/** Every queued entry, FIFO (oldest first), joined with its language. */
export async function listQueue(): Promise<QueueEntry[]> {
  const redis = getRedis();
  const [flat, langs] = await Promise.all([
    redis.zrange(QUEUE_KEY, 0, -1, 'WITHSCORES'),
    redis.hgetall(LANG_KEY),
  ]);
  const entries: QueueEntry[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const playerId = flat[i];
    const enqueuedAt = Number.parseInt(flat[i + 1] ?? '', 10);
    if (playerId === undefined || !Number.isFinite(enqueuedAt)) {
      continue;
    }
    entries.push({ playerId, language: langs[playerId] ?? 'en', enqueuedAt });
  }
  return entries;
}
