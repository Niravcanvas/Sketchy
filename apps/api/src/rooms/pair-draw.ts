import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { DealtPair } from '@sketchy/engine/actions';
import type { GameSettings } from '@sketchy/engine/types';
import { getDb, getRedis } from '../db/client.js';
import { wordPairs } from '../db/schema.js';
import { ROOM_TTL_SECONDS, usedPairsKey } from './room-store.js';

/**
 * One SQL draw against `settings.packIds` × `settings.difficulties`, excluding
 * pair ids already recorded in `room:{code}:usedPairs` (data-model.md §2 —
 * "recently-used word-pair IDs per room ... prevent repeats within a
 * session"). Only `status:'active'` pairs are eligible, mirroring
 * `GET /packs/:id/pairs` (routes/packs.ts) and letting Postgres use
 * `idx_pairs_pack`'s partial index. `ORDER BY random() LIMIT 1` is the
 * pinned draw strategy (small pack sizes at this project's scale — a
 * `TABLESAMPLE` optimization isn't warranted yet).
 */
async function drawOnce(code: string, settings: GameSettings): Promise<DealtPair | null> {
  // Empty selection can't match anything — and an empty `inArray` would
  // otherwise compile to a `IN ()`/always-false SQL fragment we'd rather not
  // rely on drizzle's handling of.
  if (settings.packIds.length === 0 || settings.difficulties.length === 0) {
    return null;
  }

  const usedIds = await getRedis().smembers(usedPairsKey(code));
  const conditions = [
    inArray(wordPairs.packId, settings.packIds),
    inArray(wordPairs.difficulty, settings.difficulties),
    eq(wordPairs.status, 'active'),
  ];
  if (usedIds.length > 0) {
    conditions.push(notInArray(wordPairs.id, usedIds));
  }

  const [row] = await getDb()
    .select({ id: wordPairs.id, wordA: wordPairs.wordA, wordB: wordPairs.wordB })
    .from(wordPairs)
    .where(and(...conditions))
    .orderBy(sql`random()`)
    .limit(1);

  if (!row) {
    return null;
  }

  // Record the draw BEFORE handing it back — a successful draw is spent
  // immediately, not just once the caller's `start`/`rematch` action lands
  // (matches the pinned recycle semantics: this function owns the used-set).
  await getRedis().multi().sadd(usedPairsKey(code), row.id).expire(usedPairsKey(code), ROOM_TTL_SECONDS).exec();

  return { wordA: row.wordA, wordB: row.wordB, pairId: row.id };
}

/**
 * Draws one word pair for room `code` from `settings.packIds`/`difficulties`,
 * excluding pairs already used this room session. If the eligible pool is
 * exhausted (every matching pair already played), RECYCLES — `DEL`s
 * `room:{code}:usedPairs` and retries once — mirroring pass-and-play's pinned
 * recycle semantics (`apps/web/src/lib/pair-pool.ts` `drawPair`: "recycles
 * the whole pool rather than throwing or blocking"). Returns `null` only when
 * even a fresh (recycled) draw comes up empty — i.e. `packIds`/`difficulties`
 * themselves select no pairs at all (bad settings), which recycling can't fix.
 */
export async function drawPairForRoom(
  code: string,
  settings: GameSettings,
): Promise<DealtPair | null> {
  const first = await drawOnce(code, settings);
  if (first) {
    return first;
  }
  await getRedis().del(usedPairsKey(code));
  return drawOnce(code, settings);
}
