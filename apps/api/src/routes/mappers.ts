/**
 * DB row → contract shape mapping, in one place (pinned decision). The only
 * transformation needed today: `timestamptz` columns come back as `Date`
 * objects from `pg`/Drizzle, but every timestamp on the wire is epoch ms
 * (api-contract.md §0).
 */
import type { GameState } from '@sketchy/engine/types';
import type { Pack, Pair } from '@sketchy/shared/contract/packs';
import type {
  GameHistoryItem,
  GameRound,
  GameRoundSummaryResponse,
  Player,
  RoleStats,
} from '@sketchy/shared/contract/players';
import type { gamePlayers, games, players, wordPacks, wordPairs } from '../db/schema.js';

type PlayerRow = typeof players.$inferSelect;
type PackRow = typeof wordPacks.$inferSelect;
type PairRow = typeof wordPairs.$inferSelect;
type GameRow = typeof games.$inferSelect;
type GamePlayerRow = typeof gamePlayers.$inferSelect;

export function mapPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    displayName: row.displayName,
    avatar: row.avatar,
    isGuest: row.isGuest,
    createdAt: row.createdAt.getTime(),
  };
}

/**
 * `ownerName` is an ADDITIVE optional field on `Pack` beyond the
 * shape api-contract.md's §1 table first sketched — added per the
 * contract-change checklist (schema in packages/shared first, api-contract.md
 * updated to match) because "imported packs listed with owner attribution"
 * has no other way to resolve `ownerId` → a display
 * name without a second round-trip. Omitted (not merely `null`) when the
 * caller didn't resolve it — every call site that cares passes it explicitly.
 */
export function mapPack(row: PackRow, ownerName?: string | null): Pack {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    language: row.language,
    isOfficial: row.isOfficial,
    ownerId: row.ownerId,
    visibility: row.visibility,
    reviewStatus: row.reviewStatus,
    shareCode: row.shareCode,
    coverUrl: row.coverUrl,
    pairCount: row.pairCount,
    createdAt: row.createdAt.getTime(),
    ...(ownerName !== undefined ? { ownerName } : {}),
  };
}

export function mapPair(row: PairRow): Pair {
  return {
    id: row.id,
    packId: row.packId,
    wordA: row.wordA,
    wordB: row.wordB,
    difficulty: row.difficulty,
  };
}

/**
 * "The scrapbook" — response shaping for the read-only
 * stats/history layer over data `rooms/persist-game.ts` already writes. No new
 * Postgres schema; everything below reshapes existing `games`/`game_players`/`players` rows.
 */

/** One `GROUP BY role` aggregate row from `game_players` (route query), scoped to finished
 * games only (see `players.ts` route doc comment for why). */
export interface RoleStatsRow {
  role: GamePlayerRow['role'];
  played: number;
  won: number;
  points: number;
}

/** Fills in the three `byRole` buckets, defaulting any role the player has never played to
 * all-zero rather than omitting it (api-contract.md §1 `RoleStats` — the shape always has
 * all three keys). */
export function mapByRole(rows: RoleStatsRow[]): {
  civilian: RoleStats;
  undercover: RoleStats;
  mrwhite: RoleStats;
} {
  const zero: RoleStats = { played: 0, won: 0, points: 0 };
  const byRole = { civilian: { ...zero }, undercover: { ...zero }, mrwhite: { ...zero } };
  for (const row of rows) {
    byRole[row.role] = { played: row.played, won: row.won, points: row.points };
  }
  return byRole;
}

/** The flat row shape `players.ts`'s `GET /players/me/games` query produces: a `game_players`
 * row joined to its `games` row, plus a separately-fetched `playerCount` (see the route's doc
 * comment for why that's a second query rather than a correlated subquery). */
export interface GameHistoryRow {
  gameId: GameRow['id'];
  endedAt: NonNullable<GameRow['endedAt']>;
  mode: GameRow['mode'];
  roomCode: GameRow['roomCode'];
  winnerFaction: GameRow['winnerFaction'];
  civilianWord: GameRow['civilianWord'];
  undercoverWord: GameRow['undercoverWord'];
  roundsPlayed: GameRow['roundsPlayed'];
  myRole: NonNullable<GamePlayerRow['role']>;
  mySpecialRole: GamePlayerRow['specialRole'];
  myPoints: GamePlayerRow['points'];
  won: GamePlayerRow['won'];
  playerCount: number;
}

export function mapGameHistoryItem(row: GameHistoryRow): GameHistoryItem {
  return {
    gameId: row.gameId,
    endedAt: row.endedAt.getTime(),
    mode: row.mode,
    roomCode: row.roomCode,
    myRole: row.myRole,
    mySpecialRole: row.mySpecialRole as GameHistoryItem['mySpecialRole'],
    myPoints: row.myPoints,
    won: row.won,
    winnerFaction: row.winnerFaction,
    civilianWord: row.civilianWord,
    undercoverWord: row.undercoverWord,
    playerCount: row.playerCount,
    roundsPlayed: row.roundsPlayed,
  };
}

/**
 * Redacted round-by-round summary from a finished game's `games.summary` (the full
 * unredacted final `GameState`, data-model.md §1 "safe once game is over"). This is the ONE
 * place that reads `GameState.voteHistory` — its raw `votes: Record<voterId,targetId>` ballot
 * map is collapsed into per-target counts before anything leaves this function. Never return
 * `VoteRecord.votes` (or any voterId) to a caller — conventions.md §1's redaction rule ("never
 * expose who voted for whom") applies to a FINISHED game's history exactly as much as a live
 * one; data-model.md §4's redaction matrix only ever promises "per-round tallies" at
 * `game_over`, never the ballot map itself.
 *
 * One entry per distinct round number seen across `clues`/`voteHistory`. A round that went to
 * sudden-death (tiebreak clue + re-vote) keeps the SAME round number for both ballots
 * (`round` only increments when the clue phase restarts, data-model.md §3) — the LAST
 * `VoteRecord` for that round (the deciding one) is the tally shown, so a round with a
 * first-vote tie followed by a decisive re-vote reports the re-vote's counts, not a
 * double-counted merge of both ballots.
 */
export function mapGameRoundSummary(gameId: string, state: GameState): GameRoundSummaryResponse {
  const nameById = new Map(state.players.map((player) => [player.id, player.name]));
  const roleById = new Map(state.players.map((player) => [player.id, player.role]));

  const roundNumbers = new Set<number>();
  for (const clue of state.clues) roundNumbers.add(clue.round);
  for (const record of state.voteHistory) roundNumbers.add(record.round);

  const rounds: GameRound[] = [...roundNumbers]
    .sort((a, b) => a - b)
    .map((round) => {
      const clues = state.clues
        .filter((clue) => clue.round === round)
        .map((clue) => ({
          playerId: clue.playerId,
          playerName: nameById.get(clue.playerId) ?? 'Unknown player',
          text: clue.text,
        }));

      const recordsForRound = state.voteHistory.filter((record) => record.round === round);
      const decidingRecord = recordsForRound.at(-1);

      const tallies = new Map<string, number>();
      for (const targetId of Object.values(decidingRecord?.votes ?? {})) {
        tallies.set(targetId, (tallies.get(targetId) ?? 0) + 1);
      }
      const voteTally = [...tallies.entries()]
        .map(([playerId, votes]) => ({
          playerId,
          playerName: nameById.get(playerId) ?? 'Unknown player',
          votes,
        }))
        .sort((a, b) => b.votes - a.votes);

      const eliminatedId = decidingRecord?.eliminated ?? null;
      const eliminatedRole = eliminatedId ? (roleById.get(eliminatedId) ?? null) : null;
      const eliminated =
        eliminatedId && eliminatedRole
          ? {
              playerId: eliminatedId,
              playerName: nameById.get(eliminatedId) ?? 'Unknown player',
              role: eliminatedRole,
            }
          : null;

      return { round, clues, eliminated, voteTally };
    });

  return { gameId, rounds };
}
