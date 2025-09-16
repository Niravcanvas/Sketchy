import type { Faction, GameState } from './types.js';

/**
 * Evaluates whether `state` has a winning faction yet, counting only ALIVE players
 * (data-model.md §3). Checked in this exact priority order (research/01 §5, generalized
 * from "exactly 1 Civilian" to "<= 1 Civilian" so multiple simultaneous departures can't
 * skip past the win check):
 *
 * 1. Civilians win once no Undercover and no Mr. White remain.
 * 2. Infiltrators (Undercover + Mr. White) win jointly once <=1 Civilian remains alongside
 *    at least one of each.
 * 3. Undercover wins once <=1 Civilian remains, >=1 Undercover, and 0 Mr. White.
 * 4. Mr. White wins once <=1 Civilian remains, 0 Undercover, and >=1 Mr. White.
 * 5. Otherwise the game continues.
 *
 * Exposed standalone (rather than folded invisibly into `applyAction`) so the win-condition
 * table test (conventions.md §1) can exercise it directly.
 */
export function checkWin(state: GameState): Faction | null {
  let civilianAlive = 0;
  let undercoverAlive = 0;
  let mrWhiteAlive = 0;

  for (const player of state.players) {
    if (!player.alive) continue;
    if (player.role === 'civilian') civilianAlive++;
    else if (player.role === 'undercover') undercoverAlive++;
    else if (player.role === 'mrwhite') mrWhiteAlive++;
  }

  if (undercoverAlive === 0 && mrWhiteAlive === 0) return 'civilian';
  if (civilianAlive <= 1 && undercoverAlive >= 1 && mrWhiteAlive >= 1) return 'infiltrators';
  if (civilianAlive <= 1 && undercoverAlive >= 1 && mrWhiteAlive === 0) return 'undercover';
  if (civilianAlive <= 1 && undercoverAlive === 0 && mrWhiteAlive >= 1) return 'mrwhite';
  return null;
}
