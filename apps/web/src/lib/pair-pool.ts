import type { ApiClient } from '@sketchy/shared/client';
import type { DealtPair } from '@sketchy/engine/actions';
import type { Difficulty } from '@sketchy/engine/types';
import starterPack from '@/data/starter-pack.json';

/**
 * A word pair as offered by a pool, before it's drawn into play. Carries `difficulty` (a
 * pool-selection concern) on top of the engine's `DealtPair` shape — `drawPair` strips it
 * back down to `DealtPair` when a pair is actually dealt (api-contract.md §3: pass-and-play
 * fetches packs over REST / bundles the starter pack, then hands the engine only what it
 * needs — `wordA`/`wordB`/`pairId`).
 */
export interface PoolPair {
  wordA: string;
  wordB: string;
  /** Null for pairs that didn't come from a persisted pack (the bundled starter pack). */
  pairId: string | null;
  difficulty: Difficulty;
}

export type PairPool = PoolPair[];

interface StarterPackPair {
  wordA: string;
  wordB: string;
  difficulty: Difficulty;
}

/**
 * The official starter pack, bundled with the client for a fully offline path
 * (api-contract.md §3). `pairId` is always null — it isn't a persisted pack row.
 */
export function bundledPairPool(difficulties: Difficulty[]): PoolPair[] {
  const allowed = new Set(difficulties);
  return (starterPack.pairs as StarterPackPair[])
    .filter((pair) => allowed.has(pair.difficulty))
    .map((pair) => ({
      wordA: pair.wordA,
      wordB: pair.wordB,
      pairId: null,
      difficulty: pair.difficulty,
    }));
}

/**
 * Pages through every pack in `packIds` (`GET /packs/:id/pairs`, cursor pagination per
 * `ApiClient`), concatenating and filtering by `difficulties`. Errors (network, auth, a
 * pack the caller can no longer read) propagate as-is — the setup screen falls back to
 * `bundledPairPool` rather than this function retrying or swallowing anything.
 */
export async function fetchPairPool(
  client: ApiClient,
  packIds: string[],
  difficulties: Difficulty[],
): Promise<PoolPair[]> {
  const allowed = new Set(difficulties);
  const pool: PoolPair[] = [];

  for (const packId of packIds) {
    let cursor: string | undefined;
    do {
      const page = await client.listPackPairs(packId, { cursor });
      for (const pair of page.items) {
        if (allowed.has(pair.difficulty)) {
          pool.push({
            wordA: pair.wordA,
            wordB: pair.wordB,
            pairId: pair.id,
            difficulty: pair.difficulty,
          });
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  return pool;
}

/** Case-insensitive, side-order-sensitive identity for a pair — used for used/unused tracking. */
export function pairKey(pair: { wordA: string; wordB: string }): string {
  return `${pair.wordA.toLowerCase()}|${pair.wordB.toLowerCase()}`;
}

/**
 * Draws one pair uniformly at random from `pool`, excluding anything whose key is already in
 * `usedKeys`. If every pair has been used (a rematch-heavy session outlasting the pool),
 * recycles the whole pool rather than throwing or blocking the rematch — `usedKeys` tracking
 * then effectively restarts (game-design.md §4.5: "fresh pair" per rematch, not a
 * game-spanning uniqueness guarantee once the pool runs dry). `random` is injectable for
 * deterministic tests; defaults to `Math.random` (the engine-only RNG ban doesn't apply to
 * apps/web — conventions.md §4).
 *
 * `pool` is typed down to the bare `DealtPair` shape (not `PoolPair`) because the draw never
 * looks at `difficulty` — filtering already happened when the pool was built. `PoolPair[]`
 * (from `bundledPairPool`/`fetchPairPool`) and the pared-down `DealtPair[]` the store persists
 * across a rematch both satisfy this structurally.
 */
export function drawPair(
  pool: DealtPair[],
  usedKeys: string[],
  random: () => number = Math.random,
): { pair: DealtPair; key: string } {
  if (pool.length === 0) {
    throw new Error('pair-pool: cannot draw from an empty pool');
  }

  const used = new Set(usedKeys);
  const unused = pool.filter((pair) => !used.has(pairKey(pair)));
  const candidates = unused.length > 0 ? unused : pool;

  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  const chosen = candidates[index] as DealtPair;

  return {
    pair: { wordA: chosen.wordA, wordB: chosen.wordB, pairId: chosen.pairId },
    key: pairKey(chosen),
  };
}
