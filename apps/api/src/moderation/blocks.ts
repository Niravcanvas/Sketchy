import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { playerBlocks } from '../db/schema.js';

/**
 * Block-list data helpers. Blocks are stored
 * directional (`blocker` → `blocked`) but enforced SYMMETRICALLY: the matcher
 * treats a pair as blocked if EITHER direction exists.
 */

/** Unordered pair key so `(a,b)` and `(b,a)` collapse to one entry. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Given a candidate set of player ids, returns the set of unordered pair keys
 * (`pairKey`) that are blocked in EITHER direction — everything the matcher
 * needs to avoid seating a blocked pair together. One query, scoped to pairs
 * where BOTH sides are in the candidate set (the only pairs that could matter
 * for this grouping).
 */
export async function blockedPairsWithin(playerIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (playerIds.length < 2) {
    return out;
  }
  const rows = await getDb()
    .select({ blockerId: playerBlocks.blockerId, blockedId: playerBlocks.blockedId })
    .from(playerBlocks)
    .where(
      and(inArray(playerBlocks.blockerId, playerIds), inArray(playerBlocks.blockedId, playerIds)),
    );
  for (const row of rows) {
    out.add(pairKey(row.blockerId, row.blockedId));
  }
  return out;
}

/** True if `a` and `b` have a block in either direction — used to keep the
 * matcher from adding a candidate to a group containing someone they've blocked
 * (or who blocked them). Pure set lookup over a precomputed `blockedPairsWithin`. */
export function isPairBlocked(blocked: Set<string>, a: string, b: string): boolean {
  return blocked.has(pairKey(a, b));
}

export interface BlockRow {
  blockedPlayerId: string;
  createdAt: number;
}

/** The caller's block list (for `GET /v1/blocks` + the client-side chat filter). */
export async function listBlocksFor(playerId: string): Promise<BlockRow[]> {
  const rows = await getDb()
    .select({ blockedId: playerBlocks.blockedId, createdAt: playerBlocks.createdAt })
    .from(playerBlocks)
    .where(eq(playerBlocks.blockerId, playerId));
  return rows.map((r) => ({ blockedPlayerId: r.blockedId, createdAt: r.createdAt.getTime() }));
}

/** Idempotent block insert (`ON CONFLICT DO NOTHING` on the composite PK). */
export async function addBlock(blockerId: string, blockedId: string): Promise<void> {
  await getDb().insert(playerBlocks).values({ blockerId, blockedId }).onConflictDoNothing();
}

/** Removes a block (existence-hiding: a no-op delete is fine). */
export async function removeBlock(blockerId: string, blockedId: string): Promise<void> {
  await getDb()
    .delete(playerBlocks)
    .where(and(eq(playerBlocks.blockerId, blockerId), eq(playerBlocks.blockedId, blockedId)));
}
