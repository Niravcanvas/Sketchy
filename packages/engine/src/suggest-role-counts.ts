/**
 * Suggests default role counts for a given player count (research/01 §3 formula): +1
 * Undercover per ~4 players (floor, minimum 1), 1 Mr. White once the table
 * reaches 5+ players. Used to seed `GameSettings.undercoverCount` / `mrWhiteCount` before
 * the host overrides them — never validated here, `updateSettings`/`start` do that.
 */
export function suggestRoleCounts(playerCount: number): {
  undercoverCount: number;
  mrWhiteCount: number;
} {
  return {
    undercoverCount: Math.max(1, Math.floor(playerCount / 4)),
    mrWhiteCount: playerCount >= 5 ? 1 : 0,
  };
}
