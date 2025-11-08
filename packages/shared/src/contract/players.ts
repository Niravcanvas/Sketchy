import { z } from 'zod';
import type { AvatarConfig, Faction, GamePlayer, GameState } from '@sketchy/engine/types';
import { specialRoleSchema } from './rooms.js';

/**
 * Doodle avatar config (conventions.md §2, data-model.md §1 `players.avatar`
 * jsonb). Field shape must match the engine's canonical `AvatarConfig`
 * (packages/engine/src/types.ts) — the `assertAvatarConfigMatchesEngine`
 * helper below is a compile-time proof of that; it fails to typecheck the
 * moment the two shapes drift.
 */
export const avatarConfigSchema = z.object({
  head: z.string().max(40),
  face: z.string().max(40),
  accessory: z.string().max(40),
  inkColor: z.string().max(40),
});

export type AvatarConfigContract = z.infer<typeof avatarConfigSchema>;

/**
 * Compile-time-only check (never called at runtime): the zod-inferred
 * contract type must structurally satisfy the engine's `AvatarConfig`.
 * Exported so it counts as "used" and can't be lint-stripped.
 */
export function assertAvatarConfigMatchesEngine(config: AvatarConfigContract): AvatarConfig {
  return config satisfies AvatarConfig;
}

/** `Player` shape (api-contract.md §1) — `createdAt` is epoch ms (§0 convention). */
export const playerSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  avatar: avatarConfigSchema,
  isGuest: z.boolean(),
  createdAt: z.number(),
});

export type Player = z.infer<typeof playerSchema>;

/** `POST /v1/auth/guest` request body — name is trimmed before length validation. */
export const guestAuthRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(20),
});

export type GuestAuthRequest = z.infer<typeof guestAuthRequestSchema>;

/** `POST /v1/auth/guest` response body. */
export const guestAuthResponseSchema = z.object({
  token: z.string(),
  player: playerSchema,
});

export type GuestAuthResponse = z.infer<typeof guestAuthResponseSchema>;

/** `PATCH /v1/players/me` request body — both fields optional, at least one expected. */
export const patchMeRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(20).optional(),
  avatar: avatarConfigSchema.optional(),
});

export type PatchMeRequest = z.infer<typeof patchMeRequestSchema>;

/** `GET /v1/players/me` and `PATCH /v1/players/me` response body. */
export const meResponseSchema = z.object({
  player: playerSchema,
});

export type MeResponse = z.infer<typeof meResponseSchema>;

/**
 * `GET /v1/players/me/stats` and
 * `GET /v1/players/me/games` per api-contract.md §1's already-frozen shapes. Everything
 * below is a pure READ layer over data `rooms/persist-game.ts` already writes
 * (`game_players` rows + denormalized `players.total_points/games_played/games_won`) — no
 * new Postgres schema.
 */

/** Mirrors the Postgres `base_role` enum / `GamePlayer.role` (data-model.md §1, non-null —
 * `game_players.role` is `NOT NULL`, only ever unset while a game is still in flight, which
 * never has a `game_players` row yet). */
export const baseRoleSchema = z.enum(['civilian', 'undercover', 'mrwhite']) satisfies z.ZodType<
  NonNullable<GamePlayer['role']>
>;

export type BaseRole = z.infer<typeof baseRoleSchema>;

/** Mirrors the engine `Faction` union (data-model.md §1 `faction` enum, packages/engine/src/types.ts). */
export const factionSchema = z.enum([
  'civilian',
  'undercover',
  'mrwhite',
  'infiltrators',
]) satisfies z.ZodType<Faction>;

/** Mirrors the Postgres `game_mode` enum / `GameState.mode` (data-model.md §1). Pass-and-play
 * games are never persisted server-side (data-model.md §1 `games` table note), so `'pass_play'`
 * is included for type-completeness but never actually appears in a stored row today. */
export const gameModeSchema = z.enum([
  'pass_play',
  'online_private',
  'online_public',
]) satisfies z.ZodType<GameState['mode']>;

/** `RoleStats` (api-contract.md §1) — one bucket of `GET /players/me/stats`'s `byRole`. */
export const roleStatsSchema = z.object({
  played: z.number().int(),
  won: z.number().int(),
  points: z.number().int(),
});

export type RoleStats = z.infer<typeof roleStatsSchema>;

/** `GET /v1/players/me/stats` response body (api-contract.md §1) — header totals are the
 * denormalized `players` columns verbatim (no aggregate query); `byRole` is a `GROUP BY role`
 * over `game_players`, both scoped to FINISHED games only (`games.winner_faction IS NOT
 * NULL`) so the two halves stay reconcilable. */
export const statsResponseSchema = z.object({
  totalPoints: z.number().int(),
  gamesPlayed: z.number().int(),
  gamesWon: z.number().int(),
  byRole: z.object({
    civilian: roleStatsSchema,
    undercover: roleStatsSchema,
    mrwhite: roleStatsSchema,
  }),
});

export type StatsResponse = z.infer<typeof statsResponseSchema>;

/** `GameHistoryItem` (api-contract.md §1) — one row of `GET /players/me/games`. `winnerFaction`
 * is nullable: `null` marks an abandoned game (data-model.md §1 `games.winner_faction` note) —
 * still shown in history (it happened), just with no winner and no points. */
export const gameHistoryItemSchema = z.object({
  gameId: z.uuid(),
  endedAt: z.number(),
  mode: gameModeSchema,
  roomCode: z.string(),
  myRole: baseRoleSchema,
  mySpecialRole: specialRoleSchema.nullable(),
  myPoints: z.number().int(),
  won: z.boolean(),
  winnerFaction: factionSchema.nullable(),
  civilianWord: z.string(),
  undercoverWord: z.string(),
  playerCount: z.number().int(),
  roundsPlayed: z.number().int(),
});

export type GameHistoryItem = z.infer<typeof gameHistoryItemSchema>;

/** `GET /v1/players/me/games` response body — cursor pagination envelope (api-contract.md §0). */
export const gamesPageSchema = z.object({
  items: z.array(gameHistoryItemSchema),
  nextCursor: z.string().nullable(),
});

export type GamesPage = z.infer<typeof gamesPageSchema>;

/**
 * One closed vote's REDACTED tally for the round-summary detail view:
 * counts per target only. Deliberately NOT a mirror of the
 * engine's `VoteRecord` (`{round, votes: Record<voterId,targetId>, ...}`) — that raw
 * voter→target ballot map is exactly what conventions.md §1's redaction rule forbids
 * exposing, even for a finished game the caller played in ("ballots stay aggregate").
 */
export const roundVoteTallySchema = z.object({
  playerId: z.uuid(),
  playerName: z.string(),
  votes: z.number().int(),
});

export type RoundVoteTally = z.infer<typeof roundVoteTallySchema>;

/** One round's public log entries for the round-summary detail view: who said what, and
 * (if the round ended in an elimination) who went out. */
export const gameRoundSchema = z.object({
  round: z.number().int(),
  clues: z.array(
    z.object({
      playerId: z.uuid(),
      playerName: z.string(),
      text: z.string(),
    }),
  ),
  eliminated: z
    .object({
      playerId: z.uuid(),
      playerName: z.string(),
      role: baseRoleSchema,
    })
    .nullable(),
  voteTally: z.array(roundVoteTallySchema),
});

export type GameRound = z.infer<typeof gameRoundSchema>;

/**
 * `GET /v1/players/me/games/:gameId` response body — additive endpoint beyond
 * api-contract.md §1's frozen `GameHistoryItem` list shape, needed for an
 * expandable round-by-round summary from `games.summary`. Kept as its own
 * request (rather than inlined onto every `GameHistoryItem`) because it's rarely opened
 * and would otherwise multiply the paginated list's payload size for no reason. See
 * api-contract.md §1 for the doc-side half of this addition (contract checklist, §4).
 */
export const gameRoundSummaryResponseSchema = z.object({
  gameId: z.uuid(),
  rounds: z.array(gameRoundSchema),
});

export type GameRoundSummaryResponse = z.infer<typeof gameRoundSummaryResponseSchema>;
