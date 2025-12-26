/**
 * Live-game leak guard for `GET /packs/:id/pairs` (api-contract.md §1: "owner
 * sees all; non-owners only for official/shared packs, and **never during a
 * live game they're in**"). Without this, a player
 * mid-game could fetch the very pack their room is drawing from and read
 * every pair in it — including the pair the room actually dealt — ahead of
 * any in-game reveal. A real information leak, not a style nit.
 *
 * Implementation: a bounded cursor SCAN over `room:*:state` (never `KEYS`),
 * the exact technique `services/stats.ts`'s `roomsActive` gauge already uses
 * at this project's "~50-100 active rooms" scale (system-design.md §0) — this
 * only runs on the one read path it guards, never the per-action hot loop.
 */
import type { GameState } from '@sketchy/engine/types';
import { getRedis } from '../db/client.js';

const ROOM_STATE_KEY_PATTERN = 'room:*:state';
const SCAN_COUNT_HINT = 200;

/** Phases where a room's `settings.packIds` are actively being drawn from /
 * could still expose the dealt pair — i.e. everything except the two phases
 * that bookend a game (nothing dealt yet / everything already revealed). */
function isMidGame(phase: GameState['phase']): boolean {
  return phase !== 'lobby' && phase !== 'game_over';
}

/**
 * True if `playerId` is currently seated in a mid-game room whose settings
 * reference `packId`. Reads live Redis room state directly (no DB join
 * needed — `GameState.settings.packIds` and `GameState.players` already
 * carry everything this check needs).
 */
export async function isPackInPlayForPlayer(packId: string, playerId: string): Promise<boolean> {
  const redis = getRedis();
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', ROOM_STATE_KEY_PATTERN, 'COUNT', SCAN_COUNT_HINT);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');

  if (keys.length === 0) {
    return false;
  }

  const raws = await redis.mget(...keys);
  for (const raw of raws) {
    if (!raw) {
      continue;
    }
    let state: GameState;
    try {
      state = JSON.parse(raw) as GameState;
    } catch {
      continue;
    }
    if (!isMidGame(state.phase)) {
      continue;
    }
    if (!state.settings.packIds.includes(packId)) {
      continue;
    }
    if (state.players.some((player) => player.id === playerId)) {
      return true;
    }
  }
  return false;
}
